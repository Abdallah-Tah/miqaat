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
  var STALE_MS = 30 * 60 * 1000;   // older than this and we've lost the thread

  /* Real app ids read off the TV with `tvctl.sh applist` — three separate
     Netflix entries ship on this firmware, which is exactly why these are
     captured rather than guessed. Anything not listed still works; it just
     shows up by its raw id. */
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
    "rJeHak5zRg.Spotify": "Spotify",
    "IPTVply001.IPTVPlayer": "IPTV Player"
  };

  // Background helpers and the launcher itself are never "what was playing".
  function isSystemish(appId) {
    return /Service$|Preview|\.Widget|org\.tizen\.(menu|homescreen|volume|ime|quickpanel)/.test(appId);
  }

  function ownAppId() {
    try { return tizen.application.getCurrentApplication().appInfo.id; }
    catch (e) { return "Miqaat0001.Miqaat"; }
  }

  function labelFor(appId) {
    return KNOWN[appId] || appId;
  }

  /* Look at what's running and decide what we interrupted.
     Known media apps win; otherwise the first plausible non-system app. */
  function capture(onDone) {
    if (!window.tizen || !tizen.application || !tizen.application.getAppsContext) {
      onDone(null);
      return;
    }
    var mine = ownAppId();
    try {
      tizen.application.getAppsContext(function (contexts) {
        var best = null, fallback = null;
        for (var i = 0; i < contexts.length; i++) {
          var id = contexts[i].appId;
          if (id === mine || isSystemish(id)) { continue; }
          if (KNOWN[id] && !best) { best = id; }
          if (!fallback) { fallback = id; }
        }
        var chosen = best || fallback;
        if (!chosen) { onDone(null); return; }
        var record = { appId: chosen, label: labelFor(chosen), at: new Date().getTime() };
        try { localStorage.setItem(STORE_KEY, JSON.stringify(record)); } catch (e) { }
        onDone(record);
      }, function () { onDone(null); });
    } catch (e) {
      onDone(null);
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
  function resume(onDone) {
    var rec = pending();
    clear();
    if (!rec) { onDone && onDone(false, null); return; }
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
    suppressToday: suppressToday,
    isSuppressed: isSuppressed,
    clearSuppression: clearSuppression
  };
}());
