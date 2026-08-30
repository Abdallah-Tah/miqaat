/* Miqaat — media interruption.
   Tizen gives no way to pause another app. What it does give: foregrounding
   Miqaat suspends whatever was playing (that IS the pause), and
   tizen.application.launch() hands control back (that IS the resume).

   So the job here is narrow: work out what we just interrupted, remember it
   across the athan, and put it back. ES5 only. */
var MiqaatInterrupt = (function () {
  "use strict";

  var STORE_KEY = "miqaat-interrupted-v1";
  var SUPPRESS_KEY = "miqaat-suppress-v1";
  var PREFERRED_KEY = "miqaat-preferred-app-v1";
  var STALE_MS = 30 * 60 * 1000;   // older than this and we've lost the thread

  /* Real app ids read off the TV with `tvctl.sh applist` — three separate
     Netflix entries ship on this firmware, which is exactly why these are
     captured rather than guessed. Anything not listed still works; it just
     shows up by its raw id. */
  /* Apps that are always resident on this TV whether or not anyone is using
     them. org.tizen.tv-viewer (the tuner) is loaded from boot, so "it is
     running" says nothing about whether the viewer was watching it — picking
     it was why every resume landed on Live TV instead of Netflix.

     These stay valid resume targets, but only when nothing the user actually
     launched is running. */
  var AMBIENT = {
    "org.tizen.tv-viewer": true,
    "org.tizen.tv-viewer-sub": true,
    "org.tizen.browser": true,
    "org.tizen.pvrplayer": true,
    "org.tizen.bmplayer": true,
    "org.tizen.mycontent-video-player-tv": true,
    "org.volt.firstscreen": true
  };

  var KNOWN = {
    "org.tizen.netflix-app": "Netflix",
    "org.tizen.netflixlowmem": "Netflix",
    "RN1MCdNq8t.Netflix": "Netflix",
    "9Ur5IzDKqV.TizenYouTube": "YouTube",
    "PvWgqxV3Xa.YouTubeTV": "YouTube TV",
    "evKhCgZelL.AmazonIgnitionLauncher2": "Amazon Video",
    "MCmYXNxgcu.DisneyPlus": "Disney+",
    "LBUAQX1exg.Hulu": "Hulu",
    "Y6A54cEa22.AppleTV": "Apple TV+",
    "Ggl33q588H.MBC": "Shahid",
    "gzcc4LRFBF.Peacock": "Peacock TV",
    "3KA0pm7a7V.TubiTV": "Tubi",
    "XtU8fQk2gN.ESPN": "ESPN",
    "rJeHak5zRg.Spotify": "Spotify",
    "org.tizen.browser": "Internet",
    "org.tizen.tv-viewer": "Live TV",
    "org.tizen.pvrplayer": "Recorded TV",
    "org.tizen.bmplayer": "Music TV",
    "org.tizen.mycontent-video-player-tv": "Video player",
    "IPTVply001.IPTVPlayer": "IPTV Player"
  };

  /* Everything Tizen keeps running that is not "what the user was watching".
     This list is deliberately broad: picking a launcher or a background daemon
     to resume is worse than picking nothing, because it drops the user
     somewhere they never were. Derived from `tvctl.sh applist` on this set. */
  function isSystemish(appId) {
    return /Service$|Preview|Daemon$|daemon|-app$|syspopup|helper|Helper/.test(appId)
      || /^org\.tizen\./.test(appId)      // platform apps: menus, settings, tools
      || /^org\.volt\./.test(appId)       // Smart Hub launcher and friends
      || /^ise-|keyboard|^d75857a5-/.test(appId)
      || /AdPlayer|AdSuite|addrmplayer|ADPlayer/.test(appId);
  }

  function ownAppId() {
    try { return tizen.application.getCurrentApplication().appInfo.id; }
    catch (e) { return "Miqaat0001.Miqaat"; }
  }

  function labelFor(appId) {
    return KNOWN[appId] || appId;
  }

  /* Look at what's running and decide what we interrupted.

     A recognised app always wins, even one under org.tizen.* (Netflix, Live TV
     and the browser all live there) — so KNOWN is consulted before the
     system-app filter, never after.

     `onDone(record, contexts)` hands back every running context as well, so an
     app we don't recognise shows up in the log instead of silently causing a
     wrong resume. That is how Shahid was found missing.

     Called both when Miqaat foregrounds itself (to capture what we're about to
     interrupt) and when waking from an alarm (to capture what the alarm preempted).
     On alarm wake, the capture must happen immediately in handleWake() before any
     UI work — otherwise the context list may be stale. */
  function capture(onDone) {
    // Tolerate a missing callback: capture() is called from several paths and
    // an undefined onDone used to throw a TypeError from inside the platform's
    // async callback, where nothing catches it.
    if (typeof onDone !== "function") { onDone = function () { }; }
    if (!window.tizen || !tizen.application || !tizen.application.getAppsContext) {
      onDone(null, []);
      return;
    }
    var mine = ownAppId();
    try {
      tizen.application.getAppsContext(function (contexts) {
        var seen = [];
        var launched = [];   // apps the user actually opened
        var ambient = [];    // resident regardless of use
        var unknown = [];

        for (var i = 0; i < contexts.length; i++) {
          var id = contexts[i].appId;
          if (id === mine) { continue; }
          var ctxId = contexts[i].id;
          var known = !!KNOWN[id];
          var sys = isSystemish(id);
          var tag = known ? (AMBIENT[id] ? " [ambient:" + KNOWN[id] + "]" : " [app:" + KNOWN[id] + "]")
                          : (sys ? " [system]" : " [unknown]");
          // context id is logged so launch-order heuristics can be evaluated
          seen.push(id + tag + "#" + ctxId);

          var entry = { appId: id, label: labelFor(id), ctxId: ctxId };
          if (known && !AMBIENT[id]) { launched.push(entry); }
          else if (known) { ambient.push(entry); }
          else if (!sys) { unknown.push(entry); }
        }

        /* Order of preference:
             1. something the user opened (Netflix, Shahid, YouTube…)
             2. an unrecognised non-system app — also probably user-opened
             3. an always-resident one (Live TV, browser) as a last resort
           Within a tier, honour the app the viewer last chose to resume: when
           several streaming apps sit preloaded in memory, nothing in
           getAppsContext says which was on screen, so a remembered choice
           beats an arbitrary pick. */
        var candidates = launched.concat(unknown, ambient);
        if (!candidates.length) { onDone(null, seen); return; }

        /* Ambiguous when the strongest tier has more than one member. Tizen
           gives third-party apps no "which app was in front" signal — Netflix
           and Shahid can both sit resident at once, both genuinely apps the
           user opened, and getAppsContext() cannot tell them apart. Remembering
           the last choice is a reasonable tiebreaker when the SAME ambiguity
           recurs, but it is actively wrong the moment the user switches to a
           different one of the resident apps, which is what happened here:
           Netflix was resumed once, then remembered, then wrongly reused when
           the user had moved on to Shahid. There is no fix for that by
           guessing better — the honest fix is to stop guessing silently and
           ask, which is what the "ambiguous" flag drives in the UI. */
        var primaryTier = launched.length ? launched : (unknown.length ? unknown : ambient);
        var ambiguous = primaryTier.length > 1;

        var preferred = null;
        try { preferred = localStorage.getItem(PREFERRED_KEY); } catch (e) { }
        var chosen = candidates[0];
        if (preferred) {
          for (var j = 0; j < candidates.length; j++) {
            if (candidates[j].appId === preferred) { chosen = candidates[j]; break; }
          }
        }

        var record = {
          appId: chosen.appId,
          label: chosen.label,
          at: new Date().getTime(),
          guessed: !KNOWN[chosen.appId],
          ambient: !!AMBIENT[chosen.appId],
          ambiguous: ambiguous,
          candidates: candidates      // lets the UI offer alternatives
        };
        try { localStorage.setItem(STORE_KEY, JSON.stringify(record)); } catch (e) { }
        onDone(record, seen);
      }, function (err) { onDone(null, ["getAppsContext failed: " + err.name]); });
    } catch (e) {
      onDone(null, ["getAppsContext threw: " + e.name]);
    }
  }

  function pending() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) { return null; }
      var rec = JSON.parse(raw);
      if (!rec || !rec.appId) { return null; }
      // A stale record means the user moved on themselves; don't yank them back.
      if (new Date().getTime() - rec.at > STALE_MS) { clear(); return null; }
      return rec;
    } catch (e) { return null; }
  }

  function clear() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { }
  }

  /* Hand control back. Clears the record first so a failed launch can't leave
     us in a relaunch loop. */
  function setPreferred(appId) {
    try { localStorage.setItem(PREFERRED_KEY, appId); } catch (e) { }
  }

  function getPreferred() {
    try { return localStorage.getItem(PREFERRED_KEY); } catch (e) { return null; }
  }

  /* Swap the pending record to another running candidate, so the viewer can
     correct a wrong guess from the "go and pray" screen. */
  function choose(appId) {
    var rec = pending();
    if (!rec) { return null; }
    var list = rec.candidates || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].appId !== appId) { continue; }
      rec.appId = list[i].appId;
      rec.label = list[i].label;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(rec)); } catch (e) { }
      setPreferred(appId);
      return rec;
    }
    return rec;
  }

  function resume(onDone) {
    var rec = pending();
    clear();
    if (!rec) { onDone && onDone(false, null); return; }
    setPreferred(rec.appId);   // whatever we hand back to becomes the default
    try {
      tizen.application.launch(rec.appId,
        function () { onDone && onDone(true, rec); },
        function () { onDone && onDone(false, rec); });
    } catch (e) {
      onDone && onDone(false, rec);
    }
  }

  // ---- "don't interrupt today" --------------------------------------------
  // Suppression is stored as the date it applies to, so it expires on its own
  // at midnight without needing a timer.
  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function suppressToday() {
    try { localStorage.setItem(SUPPRESS_KEY, todayKey()); } catch (e) { }
  }

  function isSuppressed() {
    try { return localStorage.getItem(SUPPRESS_KEY) === todayKey(); }
    catch (e) { return false; }
  }

  function clearSuppression() {
    try { localStorage.removeItem(SUPPRESS_KEY); } catch (e) { }
  }

  return {
    KNOWN: KNOWN,
    ownAppId: ownAppId,
    labelFor: labelFor,
    capture: capture,
    pending: pending,
    clear: clear,
    resume: resume,
    choose: choose,
    setPreferred: setPreferred,
    getPreferred: getPreferred,
    AMBIENT: AMBIENT,
    suppressToday: suppressToday,
    isSuppressed: isSuppressed,
    clearSuppression: clearSuppression
  };
}());
