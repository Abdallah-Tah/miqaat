/* Miqaat — where are we?
   A TV has no GPS, so: saved choice -> IP geolocation -> hardcoded fallback.
   Same shape as the IPTV app's TV-discovery cascade: try the cheap known-good
   answer first, degrade to something that always works. ES5 only. */
var MiqaatLocation = (function () {
  "use strict";

  var STORE_KEY = "miqaat-location-v1";
  var LOOKUP_TIMEOUT_MS = 8000;

  // Where the user actually is, used when the network can't tell us.
  var FALLBACK = {
    lat: 43.9145,
    lng: -69.9653,
    city: "Brunswick",
    region: "Maine",
    country: "United States",
    source: "fallback"
  };

  /* Order matters and was measured, not guessed:
     - ip-api.com over HTTP works and sends Access-Control-Allow-Origin: *.
       Its HTTPS endpoint is 403 on the free tier, so http is deliberate — the
       widget is local, so there's no mixed-content downgrade to worry about.
     - ipapi.co is https but rate-limits aggressively (429), so it's the backup. */
  var PROVIDERS = [
    {
      url: "http://ip-api.com/json/",
      parse: function (j) {
        if (j.status !== "success") { return null; }
        return { lat: j.lat, lng: j.lon, city: j.city,
                 region: j.regionName, country: j.country };
      }
    },
    {
      url: "https://ipapi.co/json/",
      parse: function (j) {
        if (typeof j.latitude !== "number") { return null; }
        return { lat: j.latitude, lng: j.longitude, city: j.city,
                 region: j.region, country: j.country_name };
      }
    }
  ];

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) { return null; }
      var loc = JSON.parse(raw);
      return (loc && typeof loc.lat === "number" && typeof loc.lng === "number") ? loc : null;
    } catch (e) { return null; }
  }

  function save(loc) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(loc)); } catch (e) { }
  }

  function clear() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { }
  }

  function label(loc) {
    var bits = [];
    if (loc.city) { bits.push(loc.city); }
    if (loc.region && loc.region !== loc.city) { bits.push(loc.region); }
    if (!bits.length && loc.country) { bits.push(loc.country); }
    if (!bits.length) { bits.push(loc.lat.toFixed(3) + ", " + loc.lng.toFixed(3)); }
    return bits.join(", ");
  }

  // XHR rather than fetch: M47's fetch is patchy and we need a timeout anyway.
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
      xhr.timeout = LOOKUP_TIMEOUT_MS;
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
      setTimeout(function () { finish(new Error("timeout")); }, LOOKUP_TIMEOUT_MS + 500);
    } catch (e) {
      finish(e);
    }
  }

  function lookupChain(index, onDone) {
    if (index >= PROVIDERS.length) { onDone(null); return; }
    var provider = PROVIDERS[index];
    getJSON(provider.url, function (err, json) {
      var loc = null;
      if (!err && json) {
        try { loc = provider.parse(json); } catch (e) { loc = null; }
      }
      if (loc) {
        loc.source = "ip";
        onDone(loc);
      } else {
        lookupChain(index + 1, onDone);
      }
    });
  }

  /* Resolves immediately with whatever we can serve right now, then calls back
     again if a network lookup improves on it. The dashboard must never block on
     the network — a wrong-but-instant Fajr beats a spinner. */
  function resolve(onResult) {
    var saved = load();
    if (saved) {
      onResult(saved, false);
      return;
    }

    onResult(FALLBACK, false);
    lookupChain(0, function (loc) {
      if (!loc) { return; }
      save(loc);
      onResult(loc, true);   // second arg: this is an update, tell the user
    });
  }

  // Manual override from Settings; marks the location as user-chosen so the IP
  // lookup never silently overwrites it.
  function setManual(lat, lng, city) {
    var loc = { lat: lat, lng: lng, city: city || "", region: "", country: "", source: "manual" };
    save(loc);
    return loc;
  }

  return {
    FALLBACK: FALLBACK,
    resolve: resolve,
    load: load,
    save: save,
    clear: clear,
    setManual: setManual,
    label: label
  };
}());

if (typeof module !== "undefined" && module.exports) { module.exports = MiqaatLocation; }
