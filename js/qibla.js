/* Miqaat — qibla direction.
   Initial great-circle bearing from the viewer to the Kaaba, in degrees
   clockwise from TRUE north (not magnetic — there's no compass in a TV, so the
   UI must say which north it means). ES5 only. */
var MiqaatQibla = (function () {
  "use strict";

  var KAABA = { lat: 21.4225, lng: 39.8262 };
  var DEG = Math.PI / 180;

  // 16-point compass, enough to give a human-readable hint next to the arrow.
  var POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

  function bearing(lat, lng) {
    var p1 = lat * DEG;
    var p2 = KAABA.lat * DEG;
    var dl = (KAABA.lng - lng) * DEG;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    var deg = Math.atan2(y, x) / DEG;
    return (deg + 360) % 360;
  }

  // Great-circle distance in km, shown under the arrow.
  function distanceKm(lat, lng) {
    var R = 6371;
    var p1 = lat * DEG, p2 = KAABA.lat * DEG;
    var dp = (KAABA.lat - lat) * DEG;
    var dl = (KAABA.lng - lng) * DEG;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2)
          + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  function compassPoint(deg) {
    return POINTS[Math.round(deg / 22.5) % 16];
  }

  return {
    KAABA: KAABA,
    bearing: bearing,
    distanceKm: distanceKm,
    compassPoint: compassPoint
  };
}());

if (typeof module !== "undefined" && module.exports) { module.exports = MiqaatQibla; }
