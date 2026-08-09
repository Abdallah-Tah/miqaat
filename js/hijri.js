/* Miqaat — Hijri (Umm al-Qura) calendar.
   M47 has no Intl islamic calendar, so the month table is baked in: one 12-bit
   mask per Hijri year, bit m set = month m+1 has 30 days. Generated from ICU's
   islamic-umalqura data, so dates match Saudi Arabia's official calendar exactly
   for 1400-1500 AH (1979-2076 CE) — well past this TV's lifetime.
   ES5 only. */
var MiqaatHijri = (function () {
  "use strict";

  var FIRST_YEAR = 1400;
  var EPOCH_JDN = 2444199;          // 1 Muharram 1400 = 1979-11-21
  var MONTH_MASKS = [
    2725, 2635, 1175, 2359,  694, 2421, 3433, 3410, 3221, 2347,
     603, 1243, 2517, 1490, 3493, 3402, 2709, 1357, 2733,  938,
    3026, 3012, 2953, 2709, 1325, 1453, 2922, 1748, 3529, 3474,
    2726, 2390,  686, 1389,  874, 2901, 2730, 2381, 1181, 2397,
     698, 1461, 1450, 3413, 2714, 2350,  622, 1373, 2778, 1748,
    1701, 2855, 2637, 1197, 1389, 2906, 1876, 3913, 3730, 3366,
    2646,  854, 1717, 2986, 2962, 2853, 1675, 2715, 1370, 2778,
    1460, 3497, 2898, 2714, 1334,  630, 1397, 2802, 1748, 1705,
    1365,  685, 1213, 2490, 1396, 2921, 2898, 2709, 1325, 2653,
    1242, 2777, 1714, 3733, 3626, 3222, 2350, 2733, 1386, 3429,
    3402
  ];
  var LAST_YEAR = FIRST_YEAR + MONTH_MASKS.length - 1;

  var MONTHS_EN = [
    "Muharram", "Safar", "Rabi' al-Awwal", "Rabi' al-Thani",
    "Jumada al-Ula", "Jumada al-Akhirah", "Rajab", "Sha'ban",
    "Ramadan", "Shawwal", "Dhu al-Qi'dah", "Dhu al-Hijjah"
  ];
  var MONTHS_AR = [
    "محرم", "صفر", "ربيع الأول", "ربيع الآخر",
    "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان",
    "رمضان", "شوال", "ذو القعدة", "ذو الحجة"
  ];

  var RAMADAN = 9;   // 1-based month number, drives Ramadan mode

  function monthLength(yearIndex, month1) {
    return (MONTH_MASKS[yearIndex] & (1 << (month1 - 1))) ? 30 : 29;
  }

  function yearLength(yearIndex) {
    var total = 0;
    for (var m = 1; m <= 12; m++) { total += monthLength(yearIndex, m); }
    return total;
  }

  function gregorianToJDN(date) {
    var y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    if (m <= 2) { y -= 1; m += 12; }
    var a = Math.floor(y / 100);
    var b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (y + 4716))
         + Math.floor(30.6001 * (m + 1))
         + d + b - 1524;
  }

  /* date        — JS Date (local)
     dayOffset   — user's ±N day correction; local moon sighting varies, so every
                   prayer app needs this knob.
     returns {year, month, day, monthEn, monthAr, isRamadan, inRange} */
  function fromDate(date, dayOffset) {
    var days = gregorianToJDN(date) - EPOCH_JDN + (dayOffset || 0);

    if (days < 0) {
      return outOfRange(FIRST_YEAR);
    }
    var yi = 0;
    while (yi < MONTH_MASKS.length && days >= yearLength(yi)) {
      days -= yearLength(yi);
      yi++;
    }
    if (yi >= MONTH_MASKS.length) {
      return outOfRange(LAST_YEAR);
    }
    var m = 1;
    while (m <= 12 && days >= monthLength(yi, m)) {
      days -= monthLength(yi, m);
      m++;
    }
    return {
      year: FIRST_YEAR + yi,
      month: m,
      day: days + 1,
      monthEn: MONTHS_EN[m - 1],
      monthAr: MONTHS_AR[m - 1],
      isRamadan: m === RAMADAN,
      inRange: true
    };
  }

  // Past the baked-in table we can't be authoritative; say so rather than lie.
  function outOfRange(year) {
    return {
      year: year, month: 1, day: 1,
      monthEn: MONTHS_EN[0], monthAr: MONTHS_AR[0],
      isRamadan: false, inRange: false
    };
  }

  function format(h) {
    if (!h.inRange) { return "—"; }
    return h.day + " " + h.monthEn + " " + h.year;
  }

  function formatAr(h) {
    if (!h.inRange) { return "—"; }
    return h.day + " " + h.monthAr + " " + h.year;
  }

  return {
    fromDate: fromDate,
    format: format,
    formatAr: formatAr,
    MONTHS_EN: MONTHS_EN,
    MONTHS_AR: MONTHS_AR,
    RANGE: { first: FIRST_YEAR, last: LAST_YEAR }
  };
}());

if (typeof module !== "undefined" && module.exports) { module.exports = MiqaatHijri; }
