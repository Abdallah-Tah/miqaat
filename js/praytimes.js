/* Miqaat — prayer time calculation.
   Solar-position astronomy, computed on-device so Fajr is still correct when
   the network is down at 4am. ES5 only: 2017 TVs run Chromium M47.

   Exposes: MiqaatTimes.calculate(date, {lat, lng, tzOffsetMinutes}, settings)
            -> {fajr, sunrise, dhuhr, asr, maghrib, isha} as minutes past local midnight */
var MiqaatTimes = (function () {
  "use strict";

  // fajr/isha are sun-depression angles below the horizon; conventions differ by
  // authority. "min" variants mean a fixed number of minutes after maghrib.
  var METHODS = {
    ISNA:   { label: "ISNA (North America)",     fajr: 15,   isha: 15 },
    MWL:    { label: "Muslim World League",      fajr: 18,   isha: 17 },
    Egypt:  { label: "Egyptian General Survey",  fajr: 19.5, isha: 17.5 },
    Makkah: { label: "Umm al-Qura, Makkah",      fajr: 18.5, isha: { min: 90 } },
    Karachi:{ label: "Univ. of Islamic Sciences, Karachi", fajr: 18, isha: 18 },
    Tehran: { label: "Inst. of Geophysics, Tehran", fajr: 17.7, isha: 14, maghrib: 4.5 },
    Jafari: { label: "Shia Ithna-Ashari",        fajr: 16,   isha: 14, maghrib: 4 }
  };

  var DEG = Math.PI / 180;
  function dsin(d) { return Math.sin(d * DEG); }
  function dcos(d) { return Math.cos(d * DEG); }
  function dtan(d) { return Math.tan(d * DEG); }
  function darcsin(x) { return Math.asin(x) / DEG; }
  function darccos(x) { return Math.acos(x) / DEG; }
  function darctan2(y, x) { return Math.atan2(y, x) / DEG; }
  function darccot(x) { return Math.atan2(1, x) / DEG; }

  function fixRange(a, range) {
    a = a - range * Math.floor(a / range);
    return a < 0 ? a + range : a;
  }
  function fixAngle(a) { return fixRange(a, 360); }
  function fixHour(a) { return fixRange(a, 24); }

  // Julian Day Number for 00:00 UT of the given calendar date.
  function julian(year, month, day) {
    if (month <= 2) { year -= 1; month += 12; }
    var a = Math.floor(year / 100);
    var b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (year + 4716))
         + Math.floor(30.6001 * (month + 1))
         + day + b - 1524.5;
  }

  // Low-precision solar coordinates (good to ~0.01°, far better than the
  // one-minute resolution we display).
  function sunPosition(jd) {
    var d = jd - 2451545.0;
    var g = fixAngle(357.529 + 0.98560028 * d);          // mean anomaly
    var q = fixAngle(280.459 + 0.98564736 * d);          // mean longitude
    var l = fixAngle(q + 1.915 * dsin(g) + 0.020 * dsin(2 * g)); // ecliptic longitude
    var e = 23.439 - 0.00000036 * d;                     // obliquity
    var ra = fixHour(darctan2(dcos(e) * dsin(l), dcos(l)) / 15);
    return {
      declination: darcsin(dsin(e) * dsin(l)),
      equation: q / 15 - ra                              // equation of time, hours
    };
  }

  function Calculator(jdate, lat, lng) {
    this.jdate = jdate;
    this.lat = lat;
    this.lng = lng;
  }

  // Solar noon in UT hours.
  Calculator.prototype.midDay = function (t) {
    var eqt = sunPosition(this.jdate + t).equation;
    return fixHour(12 - eqt);
  };

  // Time (UT hours) at which the sun sits `angle` degrees below the horizon.
  // direction "ccw" = before noon (Fajr, sunrise), otherwise after (Isha, sunset).
  Calculator.prototype.sunAngleTime = function (angle, t, direction) {
    var decl = sunPosition(this.jdate + t).declination;
    var noon = this.midDay(t);
    var numerator = -dsin(angle) - dsin(decl) * dsin(this.lat);
    var denominator = dcos(decl) * dcos(this.lat);
    var ratio = numerator / denominator;
    // |ratio| > 1 at extreme latitudes: the sun never reaches that depression.
    if (ratio > 1 || ratio < -1) { return NaN; }
    var hourAngle = darccos(ratio) / 15;
    return noon + (direction === "ccw" ? -hourAngle : hourAngle);
  };

  // Asr: when an object's shadow equals its own length times `factor`
  // (1 = majority, 2 = Hanafi), plus the noon shadow.
  Calculator.prototype.asrTime = function (factor, t) {
    var decl = sunPosition(this.jdate + t).declination;
    var angle = -darccot(factor + dtan(Math.abs(this.lat - decl)));
    return this.sunAngleTime(angle, t, "cw");
  };

  function isMinuteSpec(v) { return v && typeof v === "object" && typeof v.min === "number"; }

  /* date              — JS Date for the local day being computed
     loc.lat / loc.lng — degrees, north/east positive
     loc.tzOffsetMinutes — minutes to ADD to UTC for local time (i.e. -300 for EST).
                           Defaults to the TV's own clock, which handles DST for us.
     settings.method   — key of METHODS, default ISNA
     settings.asr      — "standard" | "hanafi"
     settings.adjust   — {fajr:0, sunrise:0, dhuhr:0, asr:0, maghrib:0, isha:0} minutes */
  function calculate(date, loc, settings) {
    settings = settings || {};
    var method = METHODS[settings.method] || METHODS.ISNA;
    var asrFactor = settings.asr === "hanafi" ? 2 : 1;
    var adjust = settings.adjust || {};

    var tz = typeof loc.tzOffsetMinutes === "number"
      ? loc.tzOffsetMinutes / 60
      : -date.getTimezoneOffset() / 60;

    var jdate = julian(date.getFullYear(), date.getMonth() + 1, date.getDate())
              - loc.lng / (15 * 24);
    var calc = new Calculator(jdate, loc.lat, loc.lng);

    // Iterate: each time depends on the sun's position at that time. Three passes
    // converges well below a minute.
    var t = { fajr: 5 / 24, sunrise: 6 / 24, dhuhr: 12 / 24, asr: 13 / 24, sunset: 18 / 24, isha: 18 / 24 };
    for (var pass = 0; pass < 3; pass++) {
      t.fajr    = calc.sunAngleTime(method.fajr, t.fajr, "ccw") / 24;
      t.sunrise = calc.sunAngleTime(0.833, t.sunrise, "ccw") / 24;
      t.dhuhr   = calc.midDay(t.dhuhr) / 24;
      t.asr     = calc.asrTime(asrFactor, t.asr) / 24;
      t.sunset  = calc.sunAngleTime(0.833, t.sunset, "cw") / 24;
      if (!isMinuteSpec(method.isha)) {
        t.isha = calc.sunAngleTime(method.isha, t.isha, "cw") / 24;
      }
    }

    // Convert UT day-fractions to local hours.
    function local(frac) { return frac * 24 + tz - loc.lng / 15; }

    var maghrib = typeof method.maghrib === "number"
      ? local(calc.sunAngleTime(method.maghrib, t.sunset, "cw") / 24)
      : local(t.sunset);

    var isha = isMinuteSpec(method.isha)
      ? maghrib + method.isha.min / 60
      : local(t.isha);

    var out = {
      fajr:    local(t.fajr),
      sunrise: local(t.sunrise),
      dhuhr:   local(t.dhuhr),
      asr:     local(t.asr),
      maghrib: maghrib,
      isha:    isha
    };

    // Return minutes past local midnight — easier to compare and format than
    // floating hours, and NaN survives so callers can detect polar failure.
    var result = {};
    for (var k in out) {
      if (!out.hasOwnProperty(k)) { continue; }
      result[k] = isNaN(out[k]) ? NaN : Math.round(out[k] * 60) + (adjust[k] || 0);
    }
    return result;
  }

  function format(minutes) {
    if (isNaN(minutes)) { return "--:--"; }
    var m = Math.round(fixRange(minutes, 1440));
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
  }

  return {
    METHODS: METHODS,
    calculate: calculate,
    format: format
  };
}());

if (typeof module !== "undefined" && module.exports) { module.exports = MiqaatTimes; }
