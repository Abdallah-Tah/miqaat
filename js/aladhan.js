/* Miqaat — AlAdhan API sync.
   https://aladhan.com/prayer-times-api

   The offline solar calculation in praytimes.js stays the source of truth,
   because Fajr must be right at 4am with the router down. This layer fetches
   the same day from AlAdhan and, when it differs, adopts their minute values
   for that day — so the dashboard agrees with the printed timetable people
   actually use, while never depending on the network to function.

   Cached per day in localStorage, so it costs one request per day.
   ES5 only. */
var MiqaatAladhan = (function () {
  "use strict";

  var STORE_KEY = "miqaat-aladhan-v1";
  var TIMEOUT_MS = 10000;
  var BASE = "https://api.aladhan.com/v1/timings/";

  // Our method keys -> AlAdhan's numeric method ids.
  var METHOD_ID = {
    Jafari: 0, Karachi: 1, ISNA: 2, MWL: 3, Makkah: 4,
    Egypt: 5, Tehran: 7
  };

  var FIELDS = {
    Fajr: "fajr", Sunrise: "sunrise", Dhuhr: "dhuhr",
    Asr: "asr", Maghrib: "maghrib", Isha: "isha"
  };

  function dayKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // AlAdhan wants DD-MM-YYYY.
  function apiDate(d) {
    return pad(d.getDate()) + "-" + pad(d.getMonth() + 1) + "-" + d.getFullYear();
  }

  function toMinutes(hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
    if (!m) { return NaN; }
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function save(entry) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(entry)); } catch (e) { }
  }

  function clear() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { }
  }

  /* Today's cached sync, or null. Callers treat null as "use local times". */
  function cached(date, loc, settings) {
    var e = load();
    if (!e) { return null; }
    if (e.day !== dayKey(date)) { return null; }
    if (e.method !== settings.method || e.asr !== settings.asr) { return null; }
    // A meaningful location change invalidates it; rounding keeps tiny IP drift
    // from re-fetching every launch.
    if (e.lat !== round3(loc.lat) || e.lng !== round3(loc.lng)) { return null; }
    return e;
  }

  function round3(v) { return Math.round(v * 1000) / 1000; }

  function getJSON(url, onDone) {
    var done = false;
    function finish(err, data) {
      if (done) { return; }
      done = true;
      onDone(err, data);
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.timeout = TIMEOUT_MS;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) { return; }
        if (xhr.status >= 200 && xhr.status < 300) {
          try { finish(null, JSON.parse(xhr.responseText)); }
          catch (e) { finish(new Error("bad JSON")); }
        } else {
          finish(new Error("HTTP " + xhr.status));
        }
      };
      xhr.ontimeout = function () { finish(new Error("timeout")); };
      xhr.onerror = function () { finish(new Error("network")); };
      xhr.send();
      setTimeout(function () { finish(new Error("timeout")); }, TIMEOUT_MS + 500);
    } catch (e) {
      finish(e);
    }
  }

  /* Fetch today's timings. onDone(entry|null, err).
     entry = {day, lat, lng, method, asr, times:{fajr..isha}, hijri, at} */
  function sync(date, loc, settings, onDone) {
    var hit = cached(date, loc, settings);
    if (hit) { onDone(hit, null); return; }

    var methodId = METHOD_ID[settings.method];
    if (methodId === undefined) { methodId = 2; }

    var url = BASE + apiDate(date)
      + "?latitude=" + loc.lat
      + "&longitude=" + loc.lng
      + "&method=" + methodId
      + "&school=" + (settings.asr === "hanafi" ? 1 : 0);

    getJSON(url, function (err, json) {
      if (err || !json || !json.data || !json.data.timings) {
        onDone(null, err || new Error("unexpected response"));
        return;
      }
      var t = json.data.timings;
      var times = {};
      var ok = true;
      for (var apiKey in FIELDS) {
        if (!FIELDS.hasOwnProperty(apiKey)) { continue; }
        var mins = toMinutes(t[apiKey]);
        if (isNaN(mins)) { ok = false; break; }
        times[FIELDS[apiKey]] = mins;
      }
      if (!ok) { onDone(null, new Error("unparseable timings")); return; }

      var hijri = null;
      try {
        var h = json.data.date.hijri;
        hijri = { day: parseInt(h.day, 10), month: parseInt(h.month.number, 10),
                  year: parseInt(h.year, 10), monthEn: h.month.en };
      } catch (e) { hijri = null; }

      var entry = {
        day: dayKey(date),
        lat: round3(loc.lat), lng: round3(loc.lng),
        method: settings.method, asr: settings.asr,
        times: times, hijri: hijri,
        at: new Date().getTime()
      };
      save(entry);
      onDone(entry, null);
    });
  }

  /* Largest absolute difference, in minutes, between a synced entry and our
     locally computed times. Used for the status line and diagnostics. */
  function maxDelta(entry, localMins) {
    var worst = 0;
    for (var k in entry.times) {
      if (!entry.times.hasOwnProperty(k)) { continue; }
      if (isNaN(localMins[k])) { continue; }
      var d = Math.abs(entry.times[k] - localMins[k]);
      if (d > worst) { worst = d; }
    }
    return worst;
  }

  return {
    METHOD_ID: METHOD_ID,
    sync: sync,
    cached: cached,
    clear: clear,
    maxDelta: maxDelta,
    dayKey: dayKey
  };
}());

if (typeof module !== "undefined" && module.exports) { module.exports = MiqaatAladhan; }
