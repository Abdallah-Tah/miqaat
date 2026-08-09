/* Miqaat — settings store.
   localStorage with try/catch and a defaults merge, same approach as the IPTV
   app. ES5 only. */
var MiqaatSettings = (function () {
  "use strict";

  var STORE_KEY = "miqaat-settings-v1";

  var DEFAULTS = {
    locationMode: "auto",      // "auto" = IP lookup, "home" = the hardcoded home town
    method: "ISNA",            // North America; see MiqaatTimes.METHODS
    asr: "standard",           // "standard" | "hanafi"
    hijriOffset: 0,            // ±days, local moon sighting
    mode: "home",              // "home" | "mosque" | "kids"
    ramadanAuto: true,         // switch to Ramadan dashboard during Ramadan
    adjust: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },

    athanVoice: "makkah",
    athanVolume: 0.85,
    fajrAthan: "short",        // Fajr often wants a quieter/shorter call

    // Fajr defaults off: nobody wants the TV shouting at 4am in a bedroom.
    interrupt: { fajr: false, dhuhr: true, asr: true, maghrib: true, isha: true },
    reminderMinutes: [10, 5],

    iqamahOffset: { fajr: 20, dhuhr: 10, asr: 10, maghrib: 5, isha: 10 },
    kidsDelayMinutes: 10,

    twentyFourHour: true
  };

  var cache = null;

  function clone(o) {
    // Shallow-enough deep copy for our plain-data settings tree.
    var out = {};
    for (var k in o) {
      if (!o.hasOwnProperty(k)) { continue; }
      var v = o[k];
      if (v && typeof v === "object" && !(v instanceof Array)) {
        out[k] = clone(v);
      } else if (v instanceof Array) {
        out[k] = v.slice();
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function merge(base, over) {
    for (var k in over) {
      if (!over.hasOwnProperty(k) || !base.hasOwnProperty(k)) { continue; }
      var b = base[k], o = over[k];
      if (b && typeof b === "object" && !(b instanceof Array) &&
          o && typeof o === "object" && !(o instanceof Array)) {
        merge(b, o);
      } else if (typeof b === typeof o || b === null) {
        base[k] = o;
      }
    }
    return base;
  }

  function get() {
    if (cache) { return cache; }
    cache = clone(DEFAULTS);
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { merge(cache, JSON.parse(raw)); }
    } catch (e) { /* defaults stand */ }
    return cache;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(get())); } catch (e) { }
  }

  function set(path, value) {
    var s = get();
    var parts = path.split(".");
    var node = s;
    for (var i = 0; i < parts.length - 1; i++) { node = node[parts[i]]; }
    node[parts[parts.length - 1]] = value;
    save();
    return s;
  }

  function reset() {
    cache = clone(DEFAULTS);
    save();
    return cache;
  }

  return { DEFAULTS: DEFAULTS, get: get, set: set, save: save, reset: reset };
}());

if (typeof module !== "undefined" && module.exports) { module.exports = MiqaatSettings; }
