/* Miqaat — application controller.
   Screen routing, the dashboard, and the athan flow that ties the scheduler to
   the interruption machinery. ES5 only: 2017 TVs run Chromium M47. */
(function () {
  "use strict";

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, EXIT: 10182,
    PLAY: 415, PAUSE: 19, STOP: 413, PLAYPAUSE: 10252,
    N0: 48, N1: 49, N2: 50, N3: 51, N4: 52, N5: 53, N6: 54
  };

  var SPLASH_MS = 2400;
  var TOAST_MS = 4200;
  var RESUME_COUNTDOWN = 5;
  var ATHAN_FALLBACK_SEC = 120;   // used when no athan audio is bundled
  var LOG_KEY = "miqaat-log-v1";
  var MAX_LOG = 24;

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
  function log(msg) {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    var line = p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) + "  " + msg;
    logLines.push(line);
    while (logLines.length > MAX_LOG) { logLines.shift(); }
    var el = $("log");
    if (el) { el.textContent = logLines.join("\n"); }
    try { console.log("[miqaat] " + line); } catch (e) { }
    try { localStorage.setItem(LOG_KEY, JSON.stringify(logLines)); } catch (e) { }
  }

  function loadLog() {
    try {
      var raw = localStorage.getItem(LOG_KEY);
      if (raw) { logLines = JSON.parse(raw) || []; }
    } catch (e) { logLines = []; }
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
  }

  function context() {
    return { loc: loc, settings: settings };
  }

  // ---- background ----------------------------------------------------------
  function pickBackground(now) {
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
    if (armed > 0) {
      dot.className = "dot";
      $("statusText").textContent = "live · " + armed + " alarms armed";
    } else if (armed === 0) {
      dot.className = "dot warn";
      $("statusText").textContent = "no alarms armed";
    } else {
      dot.className = "dot bad";
      $("statusText").textContent = "alarm api unavailable";
    }

    $("athanState").textContent = MiqaatInterrupt.isSuppressed()
      ? "INTERRUPTION PAUSED TODAY"
      : "ATHAN READY";

    applyBackground(pickBackground(now));
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
    var voice = (prayer.key === "fajr" && settings.fajrAthan) ? settings.fajrAthan : settings.athanVoice;
    return "assets/athan/" + voice + ".mp3";
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
    applyBackground(pickBackground(new Date()));

    var durationSec = ATHAN_FALLBACK_SEC;
    var usingAudio = false;
    try {
      audio.src = athanSrcFor(prayer);
      audio.volume = settings.athanVolume;
      audio.currentTime = 0;
      var playPromise = audio.play();
      if (playPromise && playPromise.catch) { playPromise["catch"](function () { }); }
      usingAudio = true;
    } catch (e) {
      usingAudio = false;
    }

    athanCtx = {
      prayer: prayer,
      startedAt: new Date().getTime(),
      durationSec: durationSec,
      usingAudio: usingAudio,
      wokenByAlarm: wokenByAlarm
    };

    audio.onloadedmetadata = function () {
      if (athanCtx && audio.duration && isFinite(audio.duration)) {
        athanCtx.durationSec = audio.duration;
      }
    };
    audio.onerror = function () {
      if (!athanCtx) { return; }
      athanCtx.usingAudio = false;
      $("athanProgressLabel").textContent = "Athan (no audio bundled)";
      log("ATHAN no audio at " + athanSrcFor(prayer) + " — running visual only");
    };
    audio.onended = function () { finishAthan(); };

    $("athanProgressLabel").textContent = "Athan in progress";
    log("ATHAN " + prayer.label + (wokenByAlarm ? " (alarm wake)" : " (in-app)"));

    flowTimer = setInterval(function () {
      if (!athanCtx) { return; }
      var elapsed = (new Date().getTime() - athanCtx.startedAt) / 1000;
      var pct = Math.min(100, (elapsed / athanCtx.durationSec) * 100);
      $("athanProgress").style.width = pct + "%";
      $("athanElapsed").textContent = fmtMMSS((athanCtx.durationSec - elapsed) * 1000);
      if (elapsed >= athanCtx.durationSec) { finishAthan(); }
    }, 500);
  }

  function stopAudio() {
    try { audio.pause(); audio.currentTime = 0; } catch (e) { }
  }

  function stopFlowTimer() {
    if (flowTimer) { clearInterval(flowTimer); flowTimer = null; }
  }

  function finishAthan() {
    if (!athanCtx) { return; }
    var prayer = athanCtx.prayer;
    athanCtx = null;
    stopFlowTimer();
    stopAudio();
    afterAthan(prayer);
  }

  /* What happens once the call ends is the whole difference between the modes. */
  function afterAthan(prayer) {
    if (settings.mode === "mosque") {
      startIqamah(prayer);
    } else if (settings.mode === "kids") {
      startKids(prayer);
    } else {
      startResume();
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
      if (left <= 0) { stopFlowTimer(); startResume(); }
    }, 500);
  }

  /* Hand the TV back to whatever we interrupted. */
  function startResume() {
    stopFlowTimer();
    var rec = MiqaatInterrupt.pending();
    if (!rec) {
      log("RESUME nothing to return to");
      goHome();
      return;
    }

    $("resumeSub").textContent = "Resuming " + rec.label + "…";
    show("resume");
    var n = RESUME_COUNTDOWN;
    $("resumeCount").textContent = n;
    log("RESUME " + rec.label + " in " + n + "s");

    flowTimer = setInterval(function () {
      n--;
      $("resumeCount").textContent = n > 0 ? n : 0;
      if (n <= 0) {
        stopFlowTimer();
        MiqaatInterrupt.resume(function (ok, r) {
          log(ok ? ("RESUME launched " + r.label) : "RESUME launch failed");
          if (!ok) { toast("Couldn't reopen " + (r ? r.label : "the app")); }
          goHome();
        });
      }
    }, 1000);
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
      value: function () { return s.asr === "hanafi" ? "Hanafi" : "Standard"; },
      change: function () { MiqaatSettings.set("asr", s.asr === "hanafi" ? "standard" : "hanafi"); }
    });
    rows.push({
      label: "Hijri date offset",
      value: function () { return (s.hijriOffset > 0 ? "+" : "") + s.hijriOffset + " days"; },
      change: function (d) { MiqaatSettings.set("hijriOffset", clampStep(s.hijriOffset, d, -2, 2, 1)); }
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
      label: "Voice",
      value: function () { return s.athanVoice; },
      change: function (d) { MiqaatSettings.set("athanVoice", cycle(["makkah", "madinah", "short"], s.athanVoice, d)); }
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
      enter: function () { show("debug"); $("log").textContent = logLines.join("\n"); }
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
      return;
    }
    MiqaatLocation.resolve(function (found, isUpdate) {
      loc = found;
      if (isUpdate) {
        toast("Location: " + MiqaatLocation.label(loc));
        log("LOC   " + MiqaatLocation.label(loc) + " (" + loc.source + ")");
        rearm();
      } else {
        log("LOC   " + MiqaatLocation.label(loc) + " (" + loc.source + ")");
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
    MiqaatInterrupt.capture(function (rec) {
      if (rec) { log("CAPTURE " + rec.label); } else { log("CAPTURE nothing running"); }

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
    loadLog();
    registerRemoteKeys();

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
      if (i === 1) { MiqaatInterrupt.suppressToday(); toast("Interruption paused for today"); }
      finishAthan();
    });
    if (r === "render") { renderActions("athanActions", labels); return true; }
    if (r === true) { return true; }
    if (code === KEY.BACK || code === KEY.STOP) { finishAthan(); return true; }
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
    if (code === KEY.BACK) { rearm(); goHome(); return true; }
    return true;
  }

  function handleDebugKey(code) {
    var now = new Date();
    switch (code) {
      case KEY.N1:
        var p = MiqaatScheduler.nextPrayer(now, loc, settings);
        MiqaatInterrupt.capture(function (rec) {
          log("TEST  capture -> " + (rec ? rec.label : "nothing"));
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
        MiqaatInterrupt.capture(function (rec) { log("TEST  contexts -> " + (rec ? rec.appId : "none")); });
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
      case KEY.N0:
        logLines = []; $("log").textContent = "";
        try { localStorage.removeItem(LOG_KEY); } catch (e) { }
        return true;
      case KEY.BACK:
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
      case "resume":
        if (code === KEY.BACK) { stopFlowTimer(); goHome(); }
        break;
    }

    if (handled) { ev.preventDefault(); }
  });

  /* JS is frozen while backgrounded, so on the way back everything time-based
     must be recomputed rather than resumed. */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      log("HIDE  backgrounded");
      return;
    }
    log("SHOW  foregrounded");
    if (ticker) { ticker.resync(); }
    if (screen === "dashboard") { renderDashboard(); }
  });

  boot();
}());
