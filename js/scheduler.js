/* Miqaat — scheduling.
   Two layers, because neither is sufficient alone:

   A. an in-app tick, authoritative while Miqaat is on screen;
   B. tizen alarms, which relaunch the app at an exact time — the only thing
      that can reach us once Tizen freezes our JS in the background.

   ES5 only. */
var MiqaatScheduler = (function () {
  "use strict";

  var PRAYERS = [
    { key: "fajr",    label: "Fajr",    ar: "الفجر" },
    { key: "dhuhr",   label: "Dhuhr",   ar: "الظهر" },
    { key: "asr",     label: "Asr",     ar: "العصر" },
    { key: "maghrib", label: "Maghrib", ar: "المغرب" },
    { key: "isha",    label: "Isha",    ar: "العشاء" }
  ];

  var ALARM_HORIZON_HOURS = 48;   // one missed re-arm must not silence the app

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 0, 0, 0, 0);
  }

  /* The dashboard ticks once a second and asks for the day's times several
     times per tick. Recomputing solar positions that often visibly stutters a
     2017 TV that may be idling on this screen for days, so memoise on the
     inputs that actually change the answer. */
  /* Keyed, not single-entry: nextPrayer() alternates between today and
     tomorrow, which would thrash a one-slot cache down to no benefit. */
  var cache = {};
  var cacheKeys = [];
  var CACHE_MAX = 4;

  /* Times fetched from aladhan.com for a specific day, keyed "YYYY-MM-DD".
     When present they replace the locally computed minutes for that day — the
     local calculation still runs, so a sync failure degrades to offline rather
     than to nothing. `syncStamp` busts the memo cache when this changes. */
  var synced = {};
  var syncStamp = 0;

  function setSyncedTimes(dayKey, times) {
    synced[dayKey] = times;
    syncStamp++;
  }

  function clearSyncedTimes() {
    synced = {};
    syncStamp++;
  }

  function dayKeyOf(date) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate());
  }

  function cacheKey(date, loc, settings) {
    return date.getFullYear() + "-" + date.getMonth() + "-" + date.getDate()
      + "|" + loc.lat.toFixed(4) + "," + loc.lng.toFixed(4)
      + "|" + settings.method + "|" + settings.asr
      + "|" + [settings.adjust.fajr, settings.adjust.sunrise, settings.adjust.dhuhr,
               settings.adjust.asr, settings.adjust.maghrib, settings.adjust.isha].join(",")
      + "|s" + syncStamp;
  }

  /* All of a day's prayers as real Date objects.
     Returns [{key, label, ar, date, minutes}], plus sunrise separately since
     it's displayed but never prayed. */
  function dayTimes(date, loc, settings) {
    var key = cacheKey(date, loc, settings);
    if (cache[key]) { return cache[key]; }
    var result = computeDayTimes(date, loc, settings);
    cache[key] = result;
    cacheKeys.push(key);
    while (cacheKeys.length > CACHE_MAX) { delete cache[cacheKeys.shift()]; }
    return result;
  }

  function computeDayTimes(date, loc, settings) {
    var mins = MiqaatTimes.calculate(date, loc, settings);

    // A successful aladhan.com sync overrides the local minutes for that day.
    // The local values are still computed above, so losing the network simply
    // drops us back to them.
    var over = synced[dayKeyOf(date)];
    if (over) {
      for (var k in over) {
        if (over.hasOwnProperty(k) && typeof over[k] === "number") {
          mins[k] = over[k] + ((settings.adjust && settings.adjust[k]) || 0);
        }
      }
    }

    var base = startOfDay(date);
    var out = [];
    for (var i = 0; i < PRAYERS.length; i++) {
      var p = PRAYERS[i];
      var m = mins[p.key];
      if (isNaN(m)) { continue; }
      out.push({
        key: p.key, label: p.label, ar: p.ar, minutes: m,
        date: new Date(base.getTime() + m * 60000)
      });
    }
    return { prayers: out, sunrise: mins.sunrise, raw: mins };
  }

  /* The next prayer at or after `now`, rolling into tomorrow when Isha has
     passed. Never returns null for a habitable latitude. */
  function nextPrayer(now, loc, settings) {
    var today = dayTimes(now, loc, settings).prayers;
    for (var i = 0; i < today.length; i++) {
      if (today[i].date.getTime() > now.getTime()) { return today[i]; }
    }
    var tomorrow = dayTimes(addDays(now, 1), loc, settings).prayers;
    return tomorrow.length ? tomorrow[0] : null;
  }

  /* The prayer whose window we're currently in (the last one that started). */
  function currentPrayer(now, loc, settings) {
    var today = dayTimes(now, loc, settings).prayers;
    var cur = null;
    for (var i = 0; i < today.length; i++) {
      if (today[i].date.getTime() <= now.getTime()) { cur = today[i]; }
    }
    if (cur) { return cur; }
    var y = dayTimes(addDays(now, -1), loc, settings).prayers;
    return y.length ? y[y.length - 1] : null;
  }

  // ---- tizen alarms --------------------------------------------------------

  function ownAppId() {
    try { return tizen.application.getCurrentApplication().appInfo.id; }
    catch (e) { return "Miqaat0001.Miqaat"; }
  }

  function makeControl(reason, prayerKey, fireAt) {
    return new tizen.ApplicationControl(
      "http://tizen.org/appcontrol/operation/default",
      null, null, null,
      [
        new tizen.ApplicationControlData("reason", [reason]),
        new tizen.ApplicationControlData("prayer", [prayerKey]),
        new tizen.ApplicationControlData("fireAt", [String(fireAt.getTime())])
      ]
    );
  }

  /* Wipe and re-arm the next 48h. Called at boot and after midnight.
     Returns the number of alarms armed, or -1 if the API is unavailable. */
  function armAlarms(loc, settings) {
    if (!window.tizen || !tizen.alarm) { return -1; }
    var s = settings;
    try { tizen.alarm.removeAll(); } catch (e) { return -1; }

    var now = new Date();
    var horizon = now.getTime() + ALARM_HORIZON_HOURS * 3600 * 1000;
    var appId = ownAppId();
    var armed = 0;

    for (var dayOffset = 0; dayOffset <= 2; dayOffset++) {
      var day = dayTimes(addDays(now, dayOffset), loc, s).prayers;
      for (var i = 0; i < day.length; i++) {
        var p = day[i];

        var stamps = [{ reason: "athan", at: p.date }];
        for (var r = 0; r < s.reminderMinutes.length; r++) {
          stamps.push({
            reason: "reminder",
            at: new Date(p.date.getTime() - s.reminderMinutes[r] * 60000)
          });
        }

        for (var k = 0; k < stamps.length; k++) {
          var when = stamps[k].at;
          if (when.getTime() <= now.getTime() + 5000) { continue; }
          if (when.getTime() > horizon) { continue; }
          try {
            tizen.alarm.add(new tizen.AlarmAbsolute(when), appId,
              makeControl(stamps[k].reason, p.key, when));
            armed++;
          } catch (e) { /* one bad alarm must not stop the rest */ }
        }
      }
    }
    return armed;
  }

  function armedCount() {
    try { return tizen.alarm.getAll().length; } catch (e) { return -1; }
  }

  /* Why did this instance start? Cold launch, or one of our alarms firing? */
  function wakeReason() {
    var out = { reason: null, prayer: null, fireAt: null };
    try {
      var req = tizen.application.getCurrentApplication().getRequestedAppControl();
      if (!req || !req.appControl || !req.appControl.data) { return out; }
      var data = req.appControl.data;
      for (var i = 0; i < data.length; i++) {
        var v = data[i].value.join(",");
        if (data[i].key === "reason") { out.reason = v; }
        if (data[i].key === "prayer") { out.prayer = v; }
        if (data[i].key === "fireAt") { out.fireAt = parseInt(v, 10); }
      }
    } catch (e) { /* cold start */ }
    return out;
  }

  // ---- in-app tick ---------------------------------------------------------

  /* Fires onPrayer(prayer) when a prayer time is crossed and
     onReminder(prayer, minutesLeft) at each configured reminder offset.
     Everything recomputes from `new Date()` — never from elapsed counters,
     because JS is frozen while backgrounded and any counter would be wrong. */
  function createTicker(getContext, handlers) {
    var lastPrayerFired = null;
    var lastReminderFired = {};
    var timer = null;

    function keyFor(p) { return p.key + "@" + p.date.getTime(); }

    function tick() {
      var ctx = getContext();
      if (!ctx || !ctx.loc) { return; }
      var now = new Date();
      var s = ctx.settings;

      handlers.onTick && handlers.onTick(now, ctx);

      var day = dayTimes(now, ctx.loc, s).prayers;
      for (var i = 0; i < day.length; i++) {
        var p = day[i];
        var delta = now.getTime() - p.date.getTime();

        // Crossed within the last 90s: fire once. The window absorbs a slow
        // tick or a late relaunch without double-firing.
        if (delta >= 0 && delta < 90000 && lastPrayerFired !== keyFor(p)) {
          lastPrayerFired = keyFor(p);
          handlers.onPrayer && handlers.onPrayer(p, ctx);
          continue;
        }

        for (var r = 0; r < s.reminderMinutes.length; r++) {
          var mins = s.reminderMinutes[r];
          var target = p.date.getTime() - mins * 60000;
          var rk = keyFor(p) + "-" + mins;
          if (now.getTime() >= target && now.getTime() < target + 60000 &&
              lastReminderFired[rk] !== true) {
            lastReminderFired[rk] = true;
            handlers.onReminder && handlers.onReminder(p, mins, ctx);
          }
        }
      }
    }

    return {
      start: function () { if (!timer) { timer = setInterval(tick, 1000); tick(); } },
      stop: function () { if (timer) { clearInterval(timer); timer = null; } },
      tick: tick,
      // Called after a resume from background, where the frozen-JS gap means
      // we may have skipped a boundary entirely.
      resync: function () { lastPrayerFired = null; lastReminderFired = {}; tick(); }
    };
  }

  return {
    PRAYERS: PRAYERS,
    dayTimes: dayTimes,
    nextPrayer: nextPrayer,
    currentPrayer: currentPrayer,
    armAlarms: armAlarms,
    armedCount: armedCount,
    setSyncedTimes: setSyncedTimes,
    clearSyncedTimes: clearSyncedTimes,
    dayKeyOf: dayKeyOf,
    wakeReason: wakeReason,
    createTicker: createTicker,
    startOfDay: startOfDay,
    addDays: addDays
  };
}());
