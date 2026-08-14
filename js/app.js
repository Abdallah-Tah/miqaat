/* Miqaat — application controller.
   Screen routing, the dashboard, and the athan flow that ties the scheduler to
   the interruption machinery. ES5 only: 2017 TVs run Chromium M47. */
(function () {
  "use strict";

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, EXIT: 10182,
    PLAY: 415, PAUSE: 19, STOP: 413, PLAYPAUSE: 10252,
    N0: 48, N1: 49, N2: 50, N3: 51, N4: 52, N5: 53, N6: 54, N7: 55, N8: 56, N9: 57
  };

  var SPLASH_MS = 2400;
  var TOAST_MS = 4200;
  var ATHAN_FALLBACK_SEC = 120;   // used when no athan audio is bundled
  var LOG_KEY = "miqaat-log-v1";
  var MAX_LOG = 400;   // a whole athan cycle plus relaunches has to fit

  /* Reciters map to assets/athan/<file>.mp3, fetched by ./fetch-athan.sh.
     Names are AlAdhan's own attribution from aladhan.com/download-adhans.

     `fajr: true` marks a recording that contains "as-salatu khayrun min
     an-nawm" — prayer is better than sleep — which belongs only in the Fajr
     adhan. Playing one at Maghrib is simply wrong, so those are kept out of
     the regular list and offered for Fajr instead. */
  var ATHAN_VOICES = [
    { key: "alafasy-dubai", label: "Mishary Rashid Alafasy — Dubai One TV · 3:35" },
    { key: "alafasy-2",     label: "Mishary Rashid Alafasy — II · 4:02" },
    { key: "alafasy-3",     label: "Mishary Rashid Alafasy — III · 4:17" },
    { key: "ozcan",         label: "Hafiz Mustafa Özcan — Turkey · 3:57" },
    { key: "zahrani",       label: "Mansour Al-Zahrani · 2:11" },
    { key: "nafees-fajr",   label: "Ahmad al-Nafees — Fajr adhan · 3:33", fajr: true }
  ];

  function voiceEntry(key) {
    for (var i = 0; i < ATHAN_VOICES.length; i++) {
      if (ATHAN_VOICES[i].key === key) { return ATHAN_VOICES[i]; }
    }
    return null;
  }

  function voiceLabel(key) {
    var e = voiceEntry(key);
    return e ? e.label : key;
  }

  /* Built-in knowledge OR the user's own correction. The built-in flags come
     from what has actually been heard on this TV, not from guesswork — the
     files carry no metadata saying so, and silence-segmentation cannot count
     the utterances reliably enough to detect the extra phrase. */
  function isFajrVoiceEntry(key) {
    var e = voiceEntry(key);
    if (e && e.fajr) { return true; }
    var marked = settings.fajrVoices || [];
    for (var i = 0; i < marked.length; i++) {
      if (marked[i] === key) { return true; }
    }
    return false;
  }

  function markVoiceAsFajr(key, isFajr) {
    var marked = (settings.fajrVoices || []).slice();
    var at = -1;
    for (var i = 0; i < marked.length; i++) { if (marked[i] === key) { at = i; } }
    if (isFajr && at < 0) { marked.push(key); }
    if (!isFajr && at >= 0) { marked.splice(at, 1); }
    MiqaatSettings.set("fajrVoices", marked);

    // Never leave the regular slot pointing at a Fajr-only recording.
    if (isFajrVoiceEntry(settings.athanVoice)) {
      var alt = voiceKeys(false);
      MiqaatSettings.set("athanVoice", alt.length ? alt[0] : settings.athanVoice);
      toast("Regular athan switched to " + voiceLabel(settings.athanVoice));
    }
  }

  /* forFajr = true lists everything (a regular adhan at Fajr is acceptable —
     the tathwib is recommended, not required). forFajr = false hides the
     Fajr-only recordings, because using one at Dhuhr..Isha is not. */
  function voiceKeys(forFajr) {
    var out = [];
    for (var i = 0; i < ATHAN_VOICES.length; i++) {
      // isFajrVoiceEntry, not the raw flag: a reciter the user has marked must
      // disappear from the Dhuhr-Isha list too, which is the whole point.
      if (!forFajr && isFajrVoiceEntry(ATHAN_VOICES[i].key)) { continue; }
      out.push(ATHAN_VOICES[i].key);
    }
    return out.length ? out : [ATHAN_VOICES[0].key];
  }

  /* The adhan, phrase by phrase, so the screen can follow the recitation.
     Repeated utterances are listed separately rather than collapsed with a
     "×2" — the line re-animating is what makes it track the voice.

     `w` is a relative duration weight: the takbir and shahada lines are drawn
     out, the hayya-'ala lines are quicker. There is no per-file timing data,
     so phrases are mapped proportionally onto the audio's real duration. It
     follows the recitation closely enough to read along, but it is an
     approximation, not a forced alignment. */
  var ATHAN_PHRASES = [
    { ar: "اللهُ أَكْبَر، اللهُ أَكْبَر", tr: "Allāhu akbar, Allāhu akbar", en: "God is the greatest", w: 2.2 },
    { ar: "اللهُ أَكْبَر، اللهُ أَكْبَر", tr: "Allāhu akbar, Allāhu akbar", en: "God is the greatest", w: 2.2 },
    { ar: "أَشْهَدُ أَنْ لَا إِلَهَ إِلَّا الله", tr: "Ash-hadu an lā ilāha illā-llāh", en: "I bear witness that there is no god but God", w: 2.4 },
    { ar: "أَشْهَدُ أَنْ لَا إِلَهَ إِلَّا الله", tr: "Ash-hadu an lā ilāha illā-llāh", en: "I bear witness that there is no god but God", w: 2.4 },
    { ar: "أَشْهَدُ أَنَّ مُحَمَّدًا رَسُولُ الله", tr: "Ash-hadu anna Muḥammadan rasūlu-llāh", en: "I bear witness that Muhammad is the Messenger of God", w: 2.4 },
    { ar: "أَشْهَدُ أَنَّ مُحَمَّدًا رَسُولُ الله", tr: "Ash-hadu anna Muḥammadan rasūlu-llāh", en: "I bear witness that Muhammad is the Messenger of God", w: 2.4 },
    { ar: "حَيَّ عَلَى الصَّلَاة", tr: "Ḥayya ʿalā-ṣ-ṣalāh", en: "Come to prayer", w: 1.7 },
    { ar: "حَيَّ عَلَى الصَّلَاة", tr: "Ḥayya ʿalā-ṣ-ṣalāh", en: "Come to prayer", w: 1.7 },
    { ar: "حَيَّ عَلَى الْفَلَاح", tr: "Ḥayya ʿalā-l-falāḥ", en: "Come to success", w: 1.7 },
    { ar: "حَيَّ عَلَى الْفَلَاح", tr: "Ḥayya ʿalā-l-falāḥ", en: "Come to success", w: 1.7 },
    { ar: "اللهُ أَكْبَر، اللهُ أَكْبَر", tr: "Allāhu akbar, Allāhu akbar", en: "God is the greatest", w: 2.0 },
    { ar: "لَا إِلَهَ إِلَّا الله", tr: "Lā ilāha illā-llāh", en: "There is no god but God", w: 2.0 }
  ];

  // Said twice at Fajr only, after the second "come to success".
  var TATHWIB = [
    { ar: "الصَّلَاةُ خَيْرٌ مِنَ النَّوْم", tr: "Aṣ-ṣalātu khayrun mina-n-nawm", en: "Prayer is better than sleep", w: 2.2 },
    { ar: "الصَّلَاةُ خَيْرٌ مِنَ النَّوْم", tr: "Aṣ-ṣalātu khayrun mina-n-nawm", en: "Prayer is better than sleep", w: 2.2 }
  ];

  function phrasesFor(prayerKey, voiceKey) {
    // Only insert the tathwib when the chosen recording actually contains it.
    if (prayerKey === "fajr" && isFajrVoiceEntry(voiceKey)) {
      return ATHAN_PHRASES.slice(0, 10).concat(TATHWIB, ATHAN_PHRASES.slice(10));
    }
    return ATHAN_PHRASES;
  }

  // Cumulative weight boundaries, normalised to 0..1.
  function phraseBounds(phrases) {
    var total = 0, i;
    for (i = 0; i < phrases.length; i++) { total += phrases[i].w; }
    var bounds = [], acc = 0;
    for (i = 0; i < phrases.length; i++) {
      acc += phrases[i].w;
      bounds.push(acc / total);
    }
    return bounds;
  }

  var DUAS = [
    { ar: "اللَّهُمَّ بَارِكْ لَنَا فِيمَا رَزَقْتَنَا وَقِنَا عَذَابَ النَّارِ",
      en: "O Allah, bless what You have provided us and protect us from the punishment of the Fire.",
      src: "Dua before eating" },
    { ar: "اللَّهُمَّ لَكَ صُمْتُ وَعَلَى رِزْقِكَ أَفْطَرْتُ",
      en: "O Allah, for You I have fasted and with Your provision I break my fast.",
      src: "Dua for breaking the fast" },
    { ar: "رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ",
      en: "Our Lord, give us good in this world and good in the Hereafter, and protect us from the punishment of the Fire.",
      src: "Surah al-Baqarah 2:201" },
    { ar: "حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ",
      en: "Allah is sufficient for us, and He is the best disposer of affairs.",
      src: "Surah Aal-Imran 3:173" },
    { ar: "اللَّهُمَّ أَعِنِّي عَلَى ذِكْرِكَ وَشُكْرِكَ وَحُسْنِ عِبَادَتِكَ",
      en: "O Allah, help me to remember You, to thank You, and to worship You well.",
      src: "Said after every prayer" },
    { ar: "رَبِّ زِدْنِي عِلْمًا",
      en: "My Lord, increase me in knowledge.",
      src: "Surah Ta-Ha 20:114" }
  ];

  // ---- state ---------------------------------------------------------------
  var settings = MiqaatSettings.get();
  var loc = null;
  var screen = "splash";
  var navIndex = 0;
  var actionIndex = 0;
  var settingIndex = 0;
  var duaIndex = 0;
  var ticker = null;
  var toastTimer = null;
  var currentBg = "";
  var bgFlip = false;
  var logLines = [];

  var syncState = { ok: false, at: null, delta: null, error: null };
  var athanCtx = null;   // {prayer, startedAt, durationSec, timer}
  var flowTimer = null;  // iqamah / kids / resume countdowns

  var NAV = [
    { key: "home",     label: "Home" },
    { key: "qibla",    label: "Qibla" },
    { key: "dua",      label: "Dua" },
    { key: "settings", label: "Settings" }
  ];

  // ---- elements ------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var bgA = $("bgA"), bgB = $("bgB");
  var audio = $("athanAudio");

  // ---- logging -------------------------------------------------------------
  /* Every line is flushed to localStorage immediately, because the interesting
     part of the athan flow is exactly where we lose control: handing the TV
     back to Netflix backgrounds us and freezes JS mid-function. Anything not
     already persisted at that instant is gone. Lines carry the date as well as
     the time so a trace spanning several relaunches still reads in order. */
  function log(msg) {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    var line = p(d.getMonth() + 1) + "/" + p(d.getDate()) + " "
      + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
      + "  " + msg;
    logLines.push(line);
    while (logLines.length > MAX_LOG) { logLines.shift(); }
    if (screen === "debug") { renderLog(); }
    try { console.log("[miqaat] " + line); } catch (e) { }
    try { localStorage.setItem(LOG_KEY, JSON.stringify(logLines)); } catch (e) { }
  }

  function loadLog() {
    try {
      var raw = localStorage.getItem(LOG_KEY);
      if (raw) { logLines = JSON.parse(raw) || []; }
    } catch (e) { logLines = []; }
  }

  /* The Diagnostics panel is the only usable console on this TV — `sdb dlog`
     drops its connection on this firmware — so the log has to be scrollable
     and filterable on screen. */
  var logScroll = 0;          // lines from the bottom
  var logFilter = "";         // "" = everything, otherwise a prefix match
  var LOG_ROWS = 22;

  function filteredLog() {
    if (!logFilter) { return logLines; }
    var out = [];
    for (var i = 0; i < logLines.length; i++) {
      if (logLines[i].indexOf(logFilter) !== -1) { out.push(logLines[i]); }
    }
    return out;
  }

  function renderLog() {
    var el = $("log");
    if (!el) { return; }
    var lines = filteredLog();
    var maxScroll = Math.max(0, lines.length - LOG_ROWS);
    if (logScroll > maxScroll) { logScroll = maxScroll; }
    if (logScroll < 0) { logScroll = 0; }
    var end = lines.length - logScroll;
    var start = Math.max(0, end - LOG_ROWS);

    var header = lines.length + " line" + (lines.length === 1 ? "" : "s")
      + (logFilter ? " matching \"" + logFilter + "\"" : "")
      + (logScroll > 0 ? "   ↑ " + logScroll + " newer below" : "   (latest)");

    el.textContent = header + "\n" + new Array(header.length + 1).join("─") + "\n"
      + lines.slice(start, end).join("\n");
  }

  // ---- helpers -------------------------------------------------------------
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function fmtClock(date) {
    var h = date.getHours(), m = date.getMinutes();
    if (!settings.twentyFourHour) {
      var ampm = h >= 12 ? "PM" : "AM";
      h = h % 12; if (h === 0) { h = 12; }
      return { hm: h + ":" + pad2(m), suffix: ampm };
    }
    return { hm: pad2(h) + ":" + pad2(m), suffix: null };
  }

  function fmtMinutes(mins) {
    if (isNaN(mins)) { return "--:--"; }
    var total = Math.round(mins);
    var h = Math.floor(total / 60) % 24, m = total % 60;
    if (!settings.twentyFourHour) {
      var ampm = h >= 12 ? "pm" : "am";
      var hh = h % 12; if (hh === 0) { hh = 12; }
      return hh + ":" + pad2(m) + ampm;
    }
    return pad2(h) + ":" + pad2(m);
  }

  // toLocaleDateString is unreliable on M47; spell it out.
  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
                     "July", "August", "September", "October", "November", "December"];

  function fmtGregorian(d) {
    return DAY_NAMES[d.getDay()] + ", " + MONTH_NAMES[d.getMonth()] + " "
         + d.getDate() + " " + d.getFullYear();
  }

  function fmtCountdown(ms) {
    if (ms < 0) { ms = 0; }
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    if (h > 0) { return "in " + h + "h " + m + "m"; }
    if (m > 0) { return "in " + m + "m"; }
    return "in " + (total % 60) + "s";
  }

  function fmtMMSS(ms) {
    if (ms < 0) { ms = 0; }
    var total = Math.ceil(ms / 1000);
    return pad2(Math.floor(total / 60)) + ":" + pad2(total % 60);
  }

  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.className = "toast on";
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { el.className = "toast"; }, TOAST_MS);
  }

  function show(name) {
    screen = name;
    document.body.className = "screen-" + name;
    // Force reflow to restart CSS transition on rapid screen changes
    void document.body.offsetWidth;
  }

  function context() {
    return { loc: loc, settings: settings };
  }

  // ---- background ----------------------------------------------------------
  /* Three scenes per time-of-day band. The band follows the sun; which of the
     three you get is random and re-rolled periodically, so a dashboard that
     may be on screen all day doesn't sit on one image. */
  // Populated by js/bgmanifest.js, regenerated by ./import-bg.sh. Falls back to
  // the generated art if the manifest is missing.
  var BG_SETS = (window.MIQAAT_BACKGROUNDS && window.MIQAAT_BACKGROUNDS.sets) || {
    dawn:  ["dawn1", "dawn2", "dawn3"],
    day:   ["day1", "day2", "day3"],
    dusk:  ["dusk1", "dusk2", "dusk3"],
    night: ["night1", "night2", "night3"]
  };
  var BG_ROTATE_MS = 7 * 60 * 1000;
  var currentBand = "";
  var nextRotateAt = 0;

  function pickBand(now) {
    if (!loc) { return "night"; }
    var t = MiqaatScheduler.dayTimes(now, loc, settings);
    var mins = now.getHours() * 60 + now.getMinutes();
    var r = t.raw;
    if (mins < r.fajr || mins >= r.isha) { return "night"; }
    if (mins < r.sunrise) { return "dawn"; }
    if (mins < r.asr) { return "day"; }
    if (mins < r.maghrib) { return "dusk"; }
    return "night";
  }

  function randomFrom(list, avoid) {
    var choices = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] !== avoid) { choices.push(list[i]); }
    }
    if (!choices.length) { choices = list; }
    return choices[Math.floor(Math.random() * choices.length)];
  }

  /* Called every tick; only actually swaps when the band changes or the
     rotation timer is due. */
  function updateBackground(now) {
    var band = pickBand(now);
    var t = now.getTime();
    if (band !== currentBand) {
      currentBand = band;
      nextRotateAt = t + BG_ROTATE_MS;
      applyBackground(randomFrom(BG_SETS[band], currentBg));
    } else if (t >= nextRotateAt) {
      nextRotateAt = t + BG_ROTATE_MS;
      applyBackground(randomFrom(BG_SETS[band], currentBg));
    }
  }

  function applyBackground(name) {
    if (name === currentBg) { return; }
    currentBg = name;
    var incoming = bgFlip ? bgA : bgB;
    var outgoing = bgFlip ? bgB : bgA;
    incoming.style.backgroundImage = "url('assets/bg/" + name + ".jpg')";
    incoming.className = "bg on";
    outgoing.className = "bg";
    bgFlip = !bgFlip;
  }

  // ---- dashboard rendering -------------------------------------------------
  /* innerHTML on every tick is wasted work on an M47 TV that may sit on this
     screen for days. Rebuild only when the rendered content would differ. */
  var lastStripKey = "";
  var lastNavIndex = -1;

  function renderStrip(now) {
    var day = MiqaatScheduler.dayTimes(now, loc, settings);
    var next = MiqaatScheduler.nextPrayer(now, loc, settings);

    var key = (next ? next.key + next.date.getTime() : "none")
      + "|" + day.prayers.length + "|" + now.getMinutes()
      + "|" + [settings.interrupt.fajr, settings.interrupt.dhuhr, settings.interrupt.asr,
               settings.interrupt.maghrib, settings.interrupt.isha].join(",");
    if (key === lastStripKey) { return; }
    lastStripKey = key;

    var html = "";
    for (var i = 0; i < day.prayers.length; i++) {
      var p = day.prayers[i];
      var cls = "slot";
      if (next && p.key === next.key && p.date.getTime() === next.date.getTime()) { cls += " next"; }
      else if (p.date.getTime() < now.getTime()) { cls += " past"; }
      if (!settings.interrupt[p.key]) { cls += " muted"; }
      html += '<div class="' + cls + '">'
            + '<div class="slot-name">' + p.label + '</div>'
            + '<div class="slot-time">' + fmtMinutes(p.minutes) + '</div>'
            + '<div class="slot-begins">iqamah ' + fmtMinutes(p.minutes + settings.iqamahOffset[p.key]) + '</div>'
            + '</div>';
    }
    $("strip").innerHTML = html;
  }

  function renderNav() {
    if (navIndex === lastNavIndex) { return; }
    lastNavIndex = navIndex;
    var html = "";
    for (var i = 0; i < NAV.length; i++) {
      html += '<div class="navitem' + (i === navIndex ? " focused" : "") + '">' + NAV[i].label + '</div>';
    }
    $("nav").innerHTML = html;
  }

  /* tizen.alarm.getAll() is a synchronous platform call; once every 15s is
     plenty for a status line. */
  var armedCache = { at: 0, value: -1 };

  function cachedArmedCount(now) {
    var t = now.getTime();
    if (t - armedCache.at > 15000) {
      armedCache.at = t;
      armedCache.value = MiqaatScheduler.armedCount();
    }
    return armedCache.value;
  }

  function renderDashboard(now) {
    now = now || new Date();

    var c = fmtClock(now);
    $("clockHM").textContent = c.hm;
    $("clockS").textContent = c.suffix ? c.suffix : pad2(now.getSeconds());

    var h = MiqaatHijri.fromDate(now, settings.hijriOffset);
    $("dateHijri").textContent = MiqaatHijri.formatAr(h);
    $("dateGreg").textContent = fmtGregorian(now);

    if (!loc) { return; }

    var next = MiqaatScheduler.nextPrayer(now, loc, settings);
    if (next) {
      var ramadan = settings.ramadanAuto && h.isRamadan;
      if (ramadan && next.key === "fajr") {
        $("heroLabel").textContent = "SUHOOR ENDS";
      } else if (ramadan && next.key === "maghrib") {
        $("heroLabel").textContent = "IFTAR";
      } else {
        $("heroLabel").textContent = "NEXT PRAYER";
      }
      $("heroName").textContent = next.label;
      $("heroIn").textContent = fmtCountdown(next.date.getTime() - now.getTime());
    }
    $("heroLoc").textContent = MiqaatLocation.label(loc);

    renderStrip(now);
    renderNav();

    var armed = cachedArmedCount(now);
    var dot = $("statusDot");
    var bits = [];
    if (armed > 0) {
      dot.className = "dot";
      bits.push("live · " + armed + " alarms armed");
    } else if (armed === 0) {
      dot.className = "dot warn";
      bits.push("no alarms armed");
    } else {
      dot.className = "dot bad";
      bits.push("alarm api unavailable");
    }
    if (syncState.ok && syncState.at) {
      bits.push("synced " + fmtClock(syncState.at).hm);
    } else if (settings.aladhanSync) {
      bits.push("offline times");
    }
    $("statusText").textContent = bits.join("  ·  ");

    $("athanState").textContent = MiqaatInterrupt.isSuppressed()
      ? "INTERRUPTION PAUSED TODAY"
      : "ATHAN READY";

    updateBackground(now);
  }

  // ---- actions (focusable button rows) ------------------------------------
  function renderActions(containerId, labels) {
    var html = "";
    for (var i = 0; i < labels.length; i++) {
      html += '<div class="action' + (i === actionIndex ? " focused" : "") + '">' + labels[i] + '</div>';
    }
    $(containerId).innerHTML = html;
  }

  // ---- athan flow ----------------------------------------------------------
  function shouldInterrupt(prayerKey) {
    return settings.interrupt[prayerKey] === true && !MiqaatInterrupt.isSuppressed();
  }

  function athanSrcFor(prayer) {
    return "assets/athan/" + voiceForPrayer(prayer) + ".mp3";
  }

  function startAthan(prayer, wokenByAlarm) {
    stopFlowTimer();
    actionIndex = 0;

    $("athanName").textContent = prayer.label;
    $("athanTime").textContent = fmtMinutes(prayer.minutes);
    $("athanAr").textContent = "اللهُ أَكْبَر";
    $("athanProgress").style.width = "0%";
    renderActions("athanActions", ["Dismiss", "Don't interrupt today"]);
    show("athan");
    updateBackground(new Date());

    var src = athanSrcFor(prayer);
    var durationSec = ATHAN_FALLBACK_SEC;
    var usingAudio = false;
    try {
      audio.src = src;
      audio.volume = settings.athanVolume;
      audio.currentTime = 0;
      var playPromise = audio.play();
      if (playPromise && playPromise["catch"]) {
        playPromise["catch"](function (e) {
          // Autoplay refusal looks identical to silence from the sofa, and it
          // resolves after athanCtx is assigned — so correct the record too,
          // otherwise the end-of-athan line claims audio played when it didn't.
          if (athanCtx) { athanCtx.usingAudio = false; }
          log("ATHAN ✗ play() rejected: " + (e && e.name ? e.name : "unknown")
            + " — no sound will come out");
        });
      }
      usingAudio = true;
    } catch (e) {
      usingAudio = false;
      log("ATHAN play() threw: " + e.name + " " + e.message);
    }

    var phrases = phrasesFor(prayer.key, voiceForPrayer(prayer));
    athanCtx = {
      prayer: prayer,
      startedAt: new Date().getTime(),
      durationSec: durationSec,
      usingAudio: usingAudio,
      wokenByAlarm: wokenByAlarm,
      src: src,
      phrases: phrases,
      bounds: phraseBounds(phrases),
      phraseIndex: -1
    };
    showPhrase(0);

    log("ATHAN ▶ " + prayer.label + " at " + fmtMinutes(prayer.minutes)
      + " · " + (wokenByAlarm ? "alarm wake" : "in-app tick")
      + " · mode=" + settings.mode
      + " · src=" + src.split("/").pop()
      + " · vol=" + Math.round(settings.athanVolume * 100) + "%");

    audio.onloadedmetadata = function () {
      if (athanCtx && audio.duration && isFinite(audio.duration)) {
        athanCtx.durationSec = audio.duration;
        log("ATHAN audio ready, " + Math.round(audio.duration) + "s");
      }
    };
    audio.onplaying = function () { log("ATHAN audio playing"); };

    /* Decisive diagnostic: if currentTime advances but nothing is audible the
       problem is routing or volume; if it stays at 0 the decoder never started.
       Silence alone cannot tell those apart from the sofa. */
    [2, 6, 20].forEach(function (at) {
      setTimeout(function () {
        if (!athanCtx) { return; }
        log("ATHAN +" + at + "s currentTime=" + (audio.currentTime || 0).toFixed(1)
          + " paused=" + audio.paused
          + " readyState=" + audio.readyState
          + " vol=" + audio.volume
          + " muted=" + audio.muted);
      }, at * 1000);
    });

    /* We arrive here straight from another app that just lost the audio
       channel. If nothing has advanced after a moment, ask once more. */
    setTimeout(function () {
      if (!athanCtx) { return; }
      if (!audio.paused && audio.currentTime > 0) { return; }
      log("ATHAN retrying play() — currentTime still 0");
      try {
        var p2 = audio.play();
        if (p2 && p2["catch"]) {
          p2["catch"](function (e) {
            log("ATHAN ✗ retry rejected: " + (e && e.name ? e.name : "unknown"));
          });
        }
      } catch (e) {
        log("ATHAN ✗ retry threw: " + e.name);
      }
    }, 1500);
    audio.onstalled = function () { log("ATHAN audio stalled"); };
    audio.onerror = function () {
      if (!athanCtx) { return; }
      athanCtx.usingAudio = false;
      $("athanProgressLabel").textContent = "Athan (no audio file)";
      var code = (audio.error && audio.error.code) ? audio.error.code : "?";
      log("ATHAN ✗ no audio at " + src + " (err " + code + ") — visual only, "
        + ATHAN_FALLBACK_SEC + "s");
    };
    audio.onended = function () {
      log("ATHAN audio ended naturally");
      finishAthan("audio-ended");
    };

    $("athanProgressLabel").textContent = "Athan in progress";

    flowTimer = setInterval(function () {
      if (!athanCtx) { return; }
      var elapsed = (new Date().getTime() - athanCtx.startedAt) / 1000;
      var pct = Math.min(100, (elapsed / athanCtx.durationSec) * 100);
      $("athanProgress").style.width = pct + "%";

      /* Follow the recitation. Prefer the media element's own clock over
         wall-clock elapsed: if the audio buffers or starts late, the words
         should track the voice rather than drift away from it. */
      var progress = athanCtx.usingAudio && audio.duration && audio.currentTime > 0
        ? audio.currentTime / audio.duration
        : elapsed / athanCtx.durationSec;
      var idx = 0;
      while (idx < athanCtx.bounds.length - 1 && progress > athanCtx.bounds[idx]) { idx++; }
      if (idx !== athanCtx.phraseIndex) { showPhrase(idx); }
      $("athanElapsed").textContent = fmtMMSS((athanCtx.durationSec - elapsed) * 1000);
      if (elapsed >= athanCtx.durationSec) { finishAthan("duration-elapsed"); }
    }, 500);
  }

  /* Swap in a line of the adhan and replay the entrance animation. The class
     has to be removed and reflowed before re-adding, or the browser coalesces
     it into no change at all. */
  function showPhrase(idx) {
    if (!athanCtx || !athanCtx.phrases[idx]) { return; }
    athanCtx.phraseIndex = idx;
    var p = athanCtx.phrases[idx];
    var ids = ["athanAr", "athanTr", "athanEn"];
    var vals = [p.ar, p.tr, p.en];
    for (var i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (!el) { continue; }
      el.textContent = vals[i];
      el.className = el.className.replace(/\s*phrase-in/, "");
      void el.offsetWidth;                       // force reflow
      el.className += " phrase-in";
    }
  }

  function voiceForPrayer(prayer) {
    return (prayer.key === "fajr" && settings.fajrAthan)
      ? settings.fajrAthan : settings.athanVoice;
  }

  function stopAudio() {
    try { audio.pause(); audio.currentTime = 0; } catch (e) { }
  }

  // ---- reciter preview -----------------------------------------------------
  var previewing = false;

  function stopPreview() {
    previewing = false;
    stopAudio();
    audio.onerror = null;
    audio.onended = null;
    if (screen === "settings") { renderSettings(); }
  }

  /* Play a reciter so the picker can be judged by ear rather than by filename.
     A missing file is reported plainly — silence would look like a bug. */
  function previewAthan(voiceKey) {
    var src = "assets/athan/" + voiceKey + ".mp3";
    stopAudio();
    previewing = true;
    try {
      audio.src = src;
      audio.volume = settings.athanVolume;
      audio.currentTime = 0;
      audio.onerror = function () {
        previewing = false;
        toast("No audio file at " + src);
        log("PREVIEW missing " + src);
        if (screen === "settings") { renderSettings(); }
      };
      audio.onended = function () { stopPreview(); };
      var p = audio.play();
      if (p && p["catch"]) { p["catch"](function () { }); }
      log("PREVIEW " + voiceKey);
    } catch (e) {
      previewing = false;
      toast("Couldn't play " + src);
    }
    if (screen === "settings") { renderSettings(); }
  }

  function stopFlowTimer() {
    if (flowTimer) { clearInterval(flowTimer); flowTimer = null; }
  }

  function finishAthan(reason) {
    if (!athanCtx) {
      log("ATHAN finish ignored — no athan in progress (" + (reason || "?") + ")");
      return;
    }
    var prayer = athanCtx.prayer;
    var ranSec = Math.round((new Date().getTime() - athanCtx.startedAt) / 1000);
    log("ATHAN ■ " + prayer.label + " ended after " + ranSec + "s"
      + " (expected " + Math.round(athanCtx.durationSec) + "s)"
      + " · reason=" + (reason || "unspecified")
      + " · audio=" + (athanCtx.usingAudio ? "yes" : "no"));
    athanCtx = null;
    stopFlowTimer();
    stopAudio();
    afterAthan(prayer);
  }

  /* What happens once the call ends is the whole difference between the modes. */
  function afterAthan(prayer) {
    var rec = MiqaatInterrupt.pending();
    log("AFTER " + prayer.label + " · mode=" + settings.mode
      + " · interrupted=" + (rec ? rec.label + " (" + rec.appId + ")" : "nothing")
      + " · suppressedToday=" + MiqaatInterrupt.isSuppressed());
    if (settings.mode === "mosque") {
      startIqamah(prayer);
    } else if (settings.mode === "kids") {
      startKids(prayer);
    } else {
      startResume(prayer);
    }
  }

  function startIqamah(prayer) {
    stopFlowTimer();
    var offset = settings.iqamahOffset[prayer.key] || 10;
    var endsAt = prayer.date.getTime() + offset * 60000;
    $("iqamahName").textContent = prayer.label;
    show("iqamah");
    log("IQAMAH " + prayer.label + " +" + offset + "m");

    flowTimer = setInterval(function () {
      var left = endsAt - new Date().getTime();
      $("iqamahCount").textContent = fmtMMSS(left);
      if (left <= 0) {
        stopFlowTimer();
        show("salah");
        // Mosque mode never hands control back — it returns to its own board.
        flowTimer = setTimeout(function () { goHome(); }, 8 * 60000);
      }
    }, 500);
  }

  function startKids(prayer) {
    stopFlowTimer();
    var endsAt = new Date().getTime() + settings.kidsDelayMinutes * 60000;
    $("kidsTitle").textContent = "It's " + prayer.label + " time";
    show("kids");
    log("KIDS hold " + settings.kidsDelayMinutes + "m");

    flowTimer = setInterval(function () {
      var left = endsAt - new Date().getTime();
      $("kidsCount").textContent = fmtMMSS(left);
      if (left <= 0) { stopFlowTimer(); startResume(prayer); }
    }, 500);
  }

  /* Hand the TV back to whatever we interrupted. */
  /* The athan has finished. Before giving the TV back, say plainly that it is
     time to pray and hold the screen for a moment — handing straight back to
     Netflix undercuts the whole point of interrupting it. */
  function startResume(prayer) {
    stopFlowTimer();
    actionIndex = 0;

    var rec = MiqaatInterrupt.pending();
    $("prayName").textContent = prayer ? prayer.label : "Prayer";
    $("resumeCount").textContent = settings.prayReminderSeconds;
    renderActions("resumeActions", rec ? ["Resume now", "Stay on Miqaat"] : ["Done"]);

    if (!rec) {
      $("resumeSub").textContent = "Nothing to resume.";
      log("PRAY  ▶ " + (prayer ? prayer.label : "?") + " reminder · nothing to resume");
    } else {
      var ageSec = Math.round((new Date().getTime() - rec.at) / 1000);
      $("resumeSub").textContent = "Resuming " + rec.label + " afterwards…";
      log("PRAY  ▶ " + (prayer ? prayer.label : "?") + " reminder for "
        + settings.prayReminderSeconds + "s · will resume " + rec.label
        + " (" + rec.appId + "), captured " + ageSec + "s ago");
    }
    show("resume");

    var n = settings.prayReminderSeconds;
    flowTimer = setInterval(function () {
      n--;
      $("resumeCount").textContent = n > 0 ? n : 0;
      if (n <= 0) { stopFlowTimer(); doResume(); }
    }, 1000);
  }

  function doResume() {
    stopFlowTimer();
    var rec = MiqaatInterrupt.pending();
    if (!rec) {
      log("RESUME ✗ nothing recorded to return to — staying on the dashboard");
      goHome();
      return;
    }
    /* Last line guaranteed to be written while we are still alive: the launch
       below foregrounds the other app, which suspends us. */
    log("RESUME calling launch(" + rec.appId + ")");
    MiqaatInterrupt.resume(function (ok, r) {
      log(ok ? ("RESUME ✓ launched " + r.label + " — Miqaat backgrounding now")
             : ("RESUME ✗ launch failed for " + (r ? r.appId : "?")));
      if (!ok) { toast("Couldn't reopen " + (r ? r.label : "the app")); }
      goHome();
    });
  }

  function goHome() {
    stopFlowTimer();
    stopAudio();
    athanCtx = null;
    navIndex = 0;
    show("dashboard");
    renderDashboard();
  }

  // ---- reminder ------------------------------------------------------------
  function showReminder(prayer, minutes) {
    if (!shouldInterrupt(prayer.key)) { return; }
    actionIndex = 0;
    $("remKicker").textContent = prayer.label.toUpperCase() + " IN";
    $("remMinutes").textContent = minutes;
    $("remTime").textContent = fmtMinutes(prayer.minutes);
    renderActions("remActions", ["Dismiss", "Don't interrupt today"]);
    show("reminder");
    log("REMIND " + prayer.label + " -" + minutes + "m");
    // Auto-dismiss so a reminder can never strand the screen.
    stopFlowTimer();
    flowTimer = setTimeout(function () { if (screen === "reminder") { goHome(); } }, 30000);
  }

  // ---- qibla / dua ---------------------------------------------------------
  function renderQibla() {
    if (!loc) { return; }
    var deg = MiqaatQibla.bearing(loc.lat, loc.lng);
    $("needle").style.webkitTransform = "rotate(" + deg + "deg)";
    $("needle").style.transform = "rotate(" + deg + "deg)";
    $("qiblaDeg").textContent = deg.toFixed(1) + "°";
    $("qiblaPoint").textContent = MiqaatQibla.compassPoint(deg);
    $("qiblaDist").textContent = MiqaatQibla.distanceKm(loc.lat, loc.lng).toLocaleString
      ? MiqaatQibla.distanceKm(loc.lat, loc.lng).toLocaleString() + " km to Makkah"
      : MiqaatQibla.distanceKm(loc.lat, loc.lng) + " km to Makkah";
  }

  function renderDua() {
    var d = DUAS[duaIndex % DUAS.length];
    $("duaAr").textContent = d.ar;
    $("duaEn").textContent = d.en;
    $("duaSrc").textContent = d.src;
  }

  // ---- settings screen -----------------------------------------------------
  function methodKeys() {
    var keys = [];
    for (var k in MiqaatTimes.METHODS) {
      if (MiqaatTimes.METHODS.hasOwnProperty(k)) { keys.push(k); }
    }
    return keys;
  }

  function cycle(list, current, dir) {
    var i = 0;
    for (var j = 0; j < list.length; j++) { if (list[j] === current) { i = j; } }
    i = (i + dir + list.length) % list.length;
    return list[i];
  }

  function clampStep(value, dir, min, max, step) {
    var v = value + dir * step;
    if (v < min) { v = min; }
    if (v > max) { v = max; }
    return v;
  }

  function settingRows() {
    var s = settings;
    var rows = [];

    rows.push({ heading: "Prayer times" });
    rows.push({
      label: "Calculation method",
      value: function () { return MiqaatTimes.METHODS[s.method].label; },
      change: function (d) { MiqaatSettings.set("method", cycle(methodKeys(), s.method, d)); }
    });
    rows.push({
      label: "Asr madhab",
      // One shadow-length vs two. The first covers three of the four schools,
      // so name them rather than calling it "Standard".
      value: function () { return s.asr === "hanafi" ? "Hanafi" : "Shafi'i / Maliki / Hanbali"; },
      change: function () { MiqaatSettings.set("asr", s.asr === "hanafi" ? "shafii" : "hanafi"); }
    });
    rows.push({
      label: "Hijri date offset",
      value: function () { return (s.hijriOffset > 0 ? "+" : "") + s.hijriOffset + " days"; },
      change: function (d) { MiqaatSettings.set("hijriOffset", clampStep(s.hijriOffset, d, -2, 2, 1)); }
    });
    rows.push({
      label: "Sync with aladhan.com",
      value: function () {
        if (!s.aladhanSync) { return "Off — offline only"; }
        if (syncState.ok) { return "On · agrees within " + syncState.delta + " min"; }
        return "On · " + (syncState.error ? "last try failed" : "not synced yet");
      },
      change: function () {
        MiqaatSettings.set("aladhanSync", !s.aladhanSync);
        if (!s.aladhanSync) {
          MiqaatScheduler.clearSyncedTimes();
          syncState = { ok: false, at: null, delta: null, error: null };
          rearm();
        } else {
          syncTimes();
        }
      }
    });
    rows.push({
      label: "Clock",
      value: function () { return s.twentyFourHour ? "24-hour" : "12-hour"; },
      change: function () { MiqaatSettings.set("twentyFourHour", !s.twentyFourHour); }
    });

    rows.push({ heading: "Mode" });
    rows.push({
      label: "Mode",
      value: function () {
        return { home: "Home — pause & resume", mosque: "Mosque — dashboard stays",
                 kids: "Kids — hold then resume" }[s.mode];
      },
      change: function (d) { MiqaatSettings.set("mode", cycle(["home", "mosque", "kids"], s.mode, d)); }
    });
    rows.push({
      label: "Ramadan dashboard",
      value: function () { return s.ramadanAuto ? "Automatic" : "Off"; },
      change: function () { MiqaatSettings.set("ramadanAuto", !s.ramadanAuto); }
    });
    rows.push({
      label: "Warn before the athan",
      value: function () {
        return s.reminderMinutes > 0 ? s.reminderMinutes + " min before" : "Off";
      },
      change: function (d) {
        MiqaatSettings.set("reminderMinutes", clampStep(s.reminderMinutes, d, 0, 30, 1));
        rearm();   // the warning is a real alarm, so it has to be re-scheduled
      }
    });
    rows.push({
      label: "\"Go and pray\" reminder",
      value: function () { return s.prayReminderSeconds + " s before resuming"; },
      change: function (d) {
        MiqaatSettings.set("prayReminderSeconds", clampStep(s.prayReminderSeconds, d, 5, 300, 5));
      }
    });
    rows.push({
      label: "Kids hold",
      value: function () { return s.kidsDelayMinutes + " min"; },
      change: function (d) { MiqaatSettings.set("kidsDelayMinutes", clampStep(s.kidsDelayMinutes, d, 1, 45, 1)); }
    });

    rows.push({ heading: "Interrupt my media for" });
    var prayers = MiqaatScheduler.PRAYERS;
    for (var i = 0; i < prayers.length; i++) {
      (function (p) {
        rows.push({
          label: p.label,
          value: function () { return s.interrupt[p.key] ? "Yes" : "No"; },
          change: function () { MiqaatSettings.set("interrupt." + p.key, !s.interrupt[p.key]); rearm(); }
        });
      }(prayers[i]));
    }

    rows.push({ heading: "Athan" });
    rows.push({
      label: "Volume",
      value: function () { return Math.round(s.athanVolume * 100) + "%"; },
      change: function (d) { MiqaatSettings.set("athanVolume", clampStep(s.athanVolume, d, 0, 1, 0.05)); }
    });
    rows.push({
      label: "Reciter (Dhuhr–Isha)",
      value: function () {
        return voiceLabel(s.athanVoice)
          + (isFajrVoiceEntry(s.athanVoice) ? "   ⚠ Fajr adhan" : "");
      },
      change: function (d) {
        // Fajr-only recordings are excluded from this list on purpose.
        MiqaatSettings.set("athanVoice", cycle(voiceKeys(false), s.athanVoice, d));
        previewAthan(s.athanVoice);   // hear the change as you scroll through
      }
    });
    rows.push({
      label: "  ↳ says \"khayrun min an-nawm\"?",
      value: function () {
        return isFajrVoiceEntry(s.athanVoice) ? "Yes — Fajr only" : "No — fine for all prayers";
      },
      change: function () {
        markVoiceAsFajr(s.athanVoice, !isFajrVoiceEntry(s.athanVoice));
      }
    });
    rows.push({
      label: "Reciter (Fajr)",
      value: function () {
        return voiceLabel(s.fajrAthan)
          + (isFajrVoiceEntry(s.fajrAthan) ? "" : "   (no tathwib)");
      },
      change: function (d) {
        MiqaatSettings.set("fajrAthan", cycle(voiceKeys(true), s.fajrAthan, d));
        previewAthan(s.fajrAthan);
      }
    });
    rows.push({
      label: "Play selected reciter",
      value: function () { return previewing ? "Playing… (ENTER to stop)" : "Press ENTER"; },
      change: function () { },
      enter: function () {
        if (previewing) { stopPreview(); } else { previewAthan(s.athanVoice); }
      }
    });

    rows.push({ heading: "Location" });
    rows.push({
      label: "Source",
      value: function () {
        return s.locationMode === "home"
          ? "Home — " + MiqaatLocation.label(MiqaatLocation.FALLBACK)
          : "Auto-detect (by IP)";
      },
      change: function () {
        MiqaatSettings.set("locationMode", s.locationMode === "home" ? "auto" : "home");
        MiqaatLocation.clear();
        resolveLocation();
      }
    });
    rows.push({
      label: "Current location",
      value: function () { return loc ? MiqaatLocation.label(loc) + " (" + loc.source + ")" : "—"; },
      change: function () { }
    });
    rows.push({
      label: "Re-detect now",
      value: function () { return "Press ENTER"; },
      change: function () { },
      enter: function () {
        MiqaatLocation.clear();
        resolveLocation();
        toast("Re-detecting location…");
      }
    });

    rows.push({ heading: "Maintenance" });
    rows.push({
      label: "Re-arm alarms",
      value: function () { return MiqaatScheduler.armedCount() + " armed"; },
      change: function () { },
      enter: function () { rearm(); toast("Re-armed " + MiqaatScheduler.armedCount() + " alarms"); }
    });
    rows.push({
      label: "Allow interruption today",
      value: function () { return MiqaatInterrupt.isSuppressed() ? "Paused" : "Active"; },
      change: function () { },
      enter: function () {
        if (MiqaatInterrupt.isSuppressed()) { MiqaatInterrupt.clearSuppression(); toast("Interruption re-enabled"); }
        else { MiqaatInterrupt.suppressToday(); toast("Interruption paused for today"); }
      }
    });
    rows.push({
      label: "Diagnostics",
      value: function () { return "Press ENTER"; },
      change: function () { },
      enter: function () { logScroll = 0; show("debug"); renderLog(); }
    });
    rows.push({
      label: "Reset all settings",
      value: function () { return "Press ENTER"; },
      change: function () { },
      enter: function () { settings = MiqaatSettings.reset(); rearm(); renderSettings(); toast("Settings reset"); }
    });

    return rows;
  }

  var cachedRows = null;

  function renderSettings() {
    cachedRows = settingRows();
    var html = "";
    for (var i = 0; i < cachedRows.length; i++) {
      var r = cachedRows[i];
      if (r.heading) {
        html += '<div class="setting heading">' + r.heading + '</div>';
      } else {
        html += '<div class="setting' + (i === settingIndex ? " focused" : "") + '">'
              + '<span class="setting-label">' + r.label + '</span>'
              + '<span class="setting-value">' + r.value() + '</span>'
              + '</div>';
      }
    }
    $("settingsList").innerHTML = html;
    scrollSettingIntoView();
  }

  function scrollSettingIntoView() {
    var list = $("settingsList");
    var nodes = list.childNodes;
    if (!nodes[settingIndex]) { return; }
    var top = nodes[settingIndex].offsetTop;
    var h = list.clientHeight;
    var target = Math.max(0, top - h / 2);
    list.scrollTop = target;
  }

  function moveSetting(dir) {
    var i = settingIndex;
    do {
      i += dir;
      if (i < 0) { i = cachedRows.length - 1; }
      if (i >= cachedRows.length) { i = 0; }
    } while (cachedRows[i].heading);
    settingIndex = i;
    renderSettings();
  }

  // ---- aladhan.com sync ----------------------------------------------------
  /* Cross-check the offline calculation against aladhan.com once a day and
     adopt their minutes when they differ, so the dashboard agrees with the
     timetable people actually read. Never blocking: a failure just leaves the
     locally computed times in place. */
  function syncTimes(onDone) {
    if (!settings.aladhanSync || !loc) { onDone && onDone(); return; }

    var today = new Date();
    var localMins = MiqaatTimes.calculate(today, loc, settings);

    MiqaatAladhan.sync(today, loc, settings, function (entry, err) {
      if (!entry) {
        syncState = { ok: false, at: null, delta: null, error: err ? err.message : "failed" };
        log("SYNC  failed (" + syncState.error + ") — using offline times");
        onDone && onDone();
        return;
      }
      var delta = MiqaatAladhan.maxDelta(entry, localMins);
      MiqaatScheduler.setSyncedTimes(entry.day, entry.times);
      syncState = { ok: true, at: new Date(entry.at), delta: delta, error: null };
      log("SYNC  aladhan.com ok, max delta " + delta + " min");
      rearm();
      if (screen === "dashboard") { renderDashboard(); }
      onDone && onDone();
    });
  }

  // ---- scheduling glue -----------------------------------------------------
  function rearm() {
    if (!loc) { return; }
    var n = MiqaatScheduler.armAlarms(loc, settings);
    armedCache.at = 0;   // status line should reflect this immediately
    log("ARM   " + n + " alarms");
  }

  function onPrayerReached(prayer) {
    if (screen === "athan" || screen === "iqamah" || screen === "kids" || screen === "salah") { return; }
    if (!shouldInterrupt(prayer.key) && settings.mode !== "mosque") {
      log("SKIP  " + prayer.label + " (interruption off)");
      return;
    }
    startAthan(prayer, false);
  }

  // ---- boot ----------------------------------------------------------------
  function resolveLocation() {
    /* IP geolocation resolves to the ISP's city, which can be tens of km off
       (Augusta rather than Brunswick here — under a minute of prayer-time
       difference, but the wrong name on screen). "Home" pins it instead. */
    if (settings.locationMode === "home") {
      loc = MiqaatLocation.FALLBACK;
      MiqaatLocation.save(loc);
      log("LOC   " + MiqaatLocation.label(loc) + " (home)");
      if (screen === "dashboard") { renderDashboard(); }
      if (screen === "qibla") { renderQibla(); }
      rearm();
      syncTimes();
      return;
    }
    MiqaatLocation.resolve(function (found, isUpdate) {
      loc = found;
      if (isUpdate) {
        toast("Location: " + MiqaatLocation.label(loc));
        log("LOC   " + MiqaatLocation.label(loc) + " (" + loc.source + ")");
        rearm();
        syncTimes();
      } else {
        log("LOC   " + MiqaatLocation.label(loc) + " (" + loc.source + ")");
        syncTimes();
      }
      if (screen === "dashboard") { renderDashboard(); }
      if (screen === "qibla") { renderQibla(); }
    });
  }

  function handleWake() {
    var wake = MiqaatScheduler.wakeReason();
    if (!wake.reason) {
      log("BOOT  cold start");
      return false;
    }
    log("WAKE  " + wake.reason + " / " + wake.prayer);

    var prayerKey = wake.prayer;
    var now = new Date();
    var day = MiqaatScheduler.dayTimes(now, loc, settings).prayers;
    var prayer = null;
    for (var i = 0; i < day.length; i++) { if (day[i].key === prayerKey) { prayer = day[i]; } }
    if (!prayer) { return false; }

    // We are in the foreground now, which means Tizen has already suspended
    // whatever was playing. Work out what that was before doing anything else.
    MiqaatInterrupt.capture(function (rec, seen) {
      log("CAPTURE running: " + (seen && seen.length ? seen.join(" | ") : "(none)"));
      if (rec) {
        log("CAPTURE → " + rec.label + " (" + rec.appId + ")"
          + (rec.guessed ? "  ⚠ unrecognised app, guessed" : ""));
      } else {
        log("CAPTURE → nothing to resume");
      }

      if (!shouldInterrupt(prayerKey)) {
        // We were not supposed to interrupt this one — give the TV straight back.
        log("SKIP  " + prayerKey + " — handing back immediately");
        MiqaatInterrupt.resume(function () { });
        goHome();
        return;
      }

      if (wake.reason === "reminder") {
        var minutes = Math.max(1, Math.round((prayer.date.getTime() - now.getTime()) / 60000));
        showReminder(prayer, minutes);
      } else {
        startAthan(prayer, true);
      }
    });
    return true;
  }

  function boot() {
    // reminderMinutes used to be an array of offsets; coerce any stored value
    // so an upgrade doesn't feed NaN into the alarm scheduling.
    if (typeof settings.reminderMinutes !== "number") {
      var legacy = settings.reminderMinutes;
      MiqaatSettings.set("reminderMinutes",
        (legacy && legacy.length) ? Math.min.apply(Math, legacy) : 2);
    }
    if (!voiceEntry(settings.athanVoice) || isFajrVoiceEntry(settings.athanVoice)) {
      MiqaatSettings.set("athanVoice", "alafasy-dubai");
    }
    if (!voiceEntry(settings.fajrAthan)) {
      MiqaatSettings.set("fajrAthan", "nafees-fajr");
    }

    loadLog();
    registerRemoteKeys();
    log("───── launch ─────");

    loc = MiqaatLocation.load() || MiqaatLocation.FALLBACK;
    resolveLocation();

    var handled = handleWake();
    rearm();

    ticker = MiqaatScheduler.createTicker(context, {
      onTick: function (now) {
        if (screen === "dashboard") { renderDashboard(now); }
      },
      onPrayer: onPrayerReached,
      onReminder: function (prayer, minutes) {
        if (screen === "dashboard") { showReminder(prayer, minutes); }
      }
    });
    ticker.start();

    if (!handled) {
      show("splash");
      setTimeout(function () { goHome(); }, SPLASH_MS);
    }

    // Re-arm after midnight so the horizon keeps rolling forward.
    setInterval(function () {
      var n = new Date();
      if (n.getHours() === 0 && n.getMinutes() === 1) { rearm(); }
    }, 60000);
  }

  // ---- input ---------------------------------------------------------------
  function registerRemoteKeys() {
    if (window.tizen && tizen.tvinputdevice) {
      var keys = ["MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop"];
      for (var i = 0; i < keys.length; i++) {
        try { tizen.tvinputdevice.registerKey(keys[i]); } catch (e) { /* older firmware */ }
      }
    }
  }

  function exitApp() {
    try { tizen.application.getCurrentApplication().exit(); }
    catch (e) { toast("Press EXIT on the remote to close."); }
  }

  function handleDashboardKey(code) {
    if (code === KEY.LEFT) { navIndex = (navIndex - 1 + NAV.length) % NAV.length; renderNav(); return true; }
    if (code === KEY.RIGHT) { navIndex = (navIndex + 1) % NAV.length; renderNav(); return true; }
    if (code === KEY.ENTER) {
      var target = NAV[navIndex].key;
      if (target === "home") { renderDashboard(); return true; }
      if (target === "qibla") { renderQibla(); show("qibla"); return true; }
      if (target === "dua") { renderDua(); show("dua"); return true; }
      if (target === "settings") { settingIndex = 1; renderSettings(); show("settings"); return true; }
      return true;
    }
    if (code === KEY.BACK) { exitApp(); return true; }
    return true;
  }

  function handleActionKey(code, labels, onChoose) {
    if (code === KEY.LEFT) { actionIndex = (actionIndex - 1 + labels.length) % labels.length; return "render"; }
    if (code === KEY.RIGHT) { actionIndex = (actionIndex + 1) % labels.length; return "render"; }
    if (code === KEY.ENTER) { onChoose(actionIndex); return true; }
    return false;
  }

  function handleAthanKey(code) {
    var labels = ["Dismiss", "Don't interrupt today"];
    var r = handleActionKey(code, labels, function (i) {
      if (i === 1) {
        MiqaatInterrupt.suppressToday();
        toast("Interruption paused for today");
        log("ATHAN user chose: don't interrupt today");
      } else {
        log("ATHAN user chose: dismiss");
      }
      finishAthan(i === 1 ? "user-suppressed" : "user-dismissed");
    });
    if (r === "render") { renderActions("athanActions", labels); return true; }
    if (r === true) { return true; }
    if (code === KEY.BACK || code === KEY.STOP) {
      log("ATHAN user pressed " + (code === KEY.STOP ? "STOP" : "BACK"));
      finishAthan("user-back");
      return true;
    }
    return true;
  }

  function handleReminderKey(code) {
    var labels = ["Dismiss", "Don't interrupt today"];
    var r = handleActionKey(code, labels, function (i) {
      if (i === 1) { MiqaatInterrupt.suppressToday(); toast("Interruption paused for today"); }
      goHome();
    });
    if (r === "render") { renderActions("remActions", labels); return true; }
    if (r === true) { return true; }
    if (code === KEY.BACK) { goHome(); return true; }
    return true;
  }

  function handleSettingsKey(code) {
    if (code === KEY.UP) { moveSetting(-1); return true; }
    if (code === KEY.DOWN) { moveSetting(1); return true; }
    if (code === KEY.LEFT || code === KEY.RIGHT) {
      var row = cachedRows[settingIndex];
      if (row && row.change) { row.change(code === KEY.RIGHT ? 1 : -1); renderSettings(); }
      return true;
    }
    if (code === KEY.ENTER) {
      var r2 = cachedRows[settingIndex];
      if (r2 && r2.enter) { r2.enter(); if (screen === "settings") { renderSettings(); } }
      else if (r2 && r2.change) { r2.change(1); renderSettings(); }
      return true;
    }
    if (code === KEY.BACK) { stopPreview(); rearm(); goHome(); return true; }
    return true;
  }

  function handleDebugKey(code) {
    var now = new Date();
    switch (code) {
      case KEY.N1:
        var p = MiqaatScheduler.nextPrayer(now, loc, settings);
        MiqaatInterrupt.capture(function (rec, seen) {
          log("TEST  running: " + (seen && seen.length ? seen.join(" | ") : "(none)"));
          log("TEST  capture -> " + (rec ? rec.label + " (" + rec.appId + ")" : "nothing"));
          startAthan(p, false);
        });
        return true;
      case KEY.N2:
        try {
          var when = new Date(now.getTime() + 60000);
          tizen.alarm.add(new tizen.AlarmAbsolute(when), MiqaatInterrupt.ownAppId(),
            new tizen.ApplicationControl("http://tizen.org/appcontrol/operation/default", null, null, null,
              [new tizen.ApplicationControlData("reason", ["athan"]),
               new tizen.ApplicationControlData("prayer", ["maghrib"])]));
          log("TEST  alarm armed for " + when.toTimeString().slice(0, 8) + " — switch to Netflix now");
          toast("Alarm in 60s — switch to Netflix now");
        } catch (e) { log("TEST  arm failed: " + e.name + " " + e.message); }
        return true;
      case KEY.N3:
        MiqaatInterrupt.capture(function (rec, seen) {
          log("TEST  contexts: " + (seen && seen.length ? seen.join(" | ") : "(none)"));
          log("TEST  would resume: " + (rec ? rec.label + " (" + rec.appId + ")" : "nothing"));
        });
        return true;
      case KEY.N4:
        log("TEST  " + MiqaatScheduler.armedCount() + " alarms armed");
        return true;
      case KEY.N5:
        rearm();
        return true;
      case KEY.N6:
        showReminder(MiqaatScheduler.nextPrayer(now, loc, settings), 10);
        return true;
      case KEY.N7:
        MiqaatAladhan.clear();
        MiqaatScheduler.clearSyncedTimes();
        log("TEST  forcing aladhan re-sync");
        syncTimes();
        return true;
      case KEY.N8:
        // The post-athan chain only; this is the trace worth reading.
        logFilter = (logFilter === "" ? "ATHAN" : "");
        logScroll = 0;
        renderLog();
        return true;
      case KEY.N9:
        logFilter = (logFilter === "RESUME" ? "" : "RESUME");
        logScroll = 0;
        renderLog();
        return true;
      case KEY.UP:
        logScroll += 5; renderLog(); return true;
      case KEY.DOWN:
        logScroll -= 5; renderLog(); return true;
      case KEY.N0:
        logLines = []; logScroll = 0; logFilter = "";
        renderLog();
        try { localStorage.removeItem(LOG_KEY); } catch (e) { }
        return true;
      case KEY.BACK:
        logFilter = ""; logScroll = 0;
        renderSettings(); show("settings"); return true;
    }
    return true;
  }

  document.addEventListener("keydown", function (ev) {
    var code = ev.keyCode;
    var handled = true;

    switch (screen) {
      case "splash":   if (code === KEY.BACK) { exitApp(); } else { goHome(); } break;
      case "dashboard": handled = handleDashboardKey(code); break;
      case "athan":    handled = handleAthanKey(code); break;
      case "reminder": handled = handleReminderKey(code); break;
      case "settings": handled = handleSettingsKey(code); break;
      case "debug":    handled = handleDebugKey(code); break;
      case "qibla":
        if (code === KEY.BACK) { goHome(); }
        break;
      case "dua":
        if (code === KEY.BACK) { goHome(); }
        else if (code === KEY.LEFT) { duaIndex = (duaIndex - 1 + DUAS.length) % DUAS.length; renderDua(); }
        else if (code === KEY.RIGHT) { duaIndex = (duaIndex + 1) % DUAS.length; renderDua(); }
        break;
      case "kids":
        // Deliberately hard to skip — that's the point of Kids mode.
        if (code === KEY.BACK) { toast("Kids mode — the timer has to finish."); }
        break;
      case "iqamah":
      case "salah":
        if (code === KEY.BACK) { goHome(); }
        break;
      case "resume": {
        var rlabels = MiqaatInterrupt.pending() ? ["Resume now", "Stay on Miqaat"] : ["Done"];
        var rr = handleActionKey(code, rlabels, function (i) {
          stopFlowTimer();
          if (rlabels.length === 1 || i === 0) {
            log("PRAY  user chose: resume now");
            doResume();
          } else {
            log("PRAY  user chose: stay on Miqaat");
            MiqaatInterrupt.clear();
            goHome();
          }
        });
        if (rr === "render") { renderActions("resumeActions", rlabels); }
        else if (code === KEY.BACK) { stopFlowTimer(); log("PRAY  dismissed with BACK"); goHome(); }
        break;
      }
    }

    if (handled) { ev.preventDefault(); }
  });

  /* JS is frozen while backgrounded, so on the way back everything time-based
     must be recomputed rather than resumed.

     Also capture what we're interrupting when we go to background — this is a
     safety net for cases where the alarm fires but handleWake() didn't get a
     clean context (e.g. race during relaunch). The capture happens here as a
     fallback, not as the primary mechanism. */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      log("HIDE  backgrounded");
      // Capture-and-store as a safety net: if the athan flow didn't manage to
      // record what we interrupted, this gives resume() something to work with.
      MiqaatInterrupt.captureAndStore();
      return;
    }
    log("SHOW  foregrounded");
    if (ticker) { ticker.resync(); }
    if (screen === "dashboard") { renderDashboard(); }
  });

  boot();
}());
