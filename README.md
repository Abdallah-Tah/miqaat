# Miqaat

Prayer-times dashboard for a Samsung Tizen TV, with **automatic media interruption**:
when a prayer time arrives, whatever is playing is suspended, the athan plays
fullscreen, and playback is handed back afterwards.

Built for a **Samsung UN55MU6290 (2017, Tizen 3.0, Chromium M47)** — the same TV
as the sibling `iptv-player` project, and the reason everything here is **ES5
only**: no `let`/`const`, no arrow functions, no template literals, no CSS Grid.

## How the interruption actually works

Tizen gives a third-party app no way to pause Netflix, and it **freezes your
JavaScript** the moment you are backgrounded — so a background timer cannot fire
the athan either. The mechanism is indirect:

```
Netflix playing
  → tizen.alarm relaunches Miqaat at the prayer time
  → Miqaat foregrounds; Tizen suspends Netflix   ← this IS the pause
  → getAppsContext() records what was interrupted
  → athan screen + audio
  → tizen.application.launch(<that app>)         ← this IS the resume
```

Two limitations that follow from this and cannot be engineered away:

- **The TV must be on.** An alarm cannot wake a powered-off set.
- **Resume position for Netflix/YouTube is whatever their own app remembers.**
  Miqaat does not control it. Live IPTV is unaffected — it resumes at the live edge.

## Deploy

```sh
./tvctl.sh deploy      # find TV, connect, build, push, install, launch
./tvctl.sh logs        # tail app logs
./tvctl.sh applist     # every installed app id (used to build the label map)
```

Signed with the `iptv-samsung` profile — deliberately the **same Samsung cert as
the IPTV player**, so the two apps coexist without tripping install error 118.

## Athan audio

```sh
./fetch-athan.sh
```

Downloads five adhans from `cdn.aladhan.com` and re-encodes them to 56 kbps
mono (~1.4 MB each, 7.3 MB total). They are **not committed** — third-party
audio — so run this once after a fresh clone. Without them the app still
works: it falls back to a 120-second visual athan and says so.

They are numbered, not named after mosques. AlAdhan publishes no reciter
attribution for these files, so any mosque name would be invented. Settings →
**Reciter** plays each as you scroll, so you choose by ear; **Fajr reciter** is
a separate pick.

(`a3` on the CDN is skipped deliberately — it is tagged *The Armed Man: A Mass
For Peace*, a Karl Jenkins choral piece, not a call to prayer.)

Asr madhab is **Shafi'i / Maliki / Hanbali** (one shadow length) or **Hanafi**
(two) — the first covers three of the four schools, hence the compound label.

## Backgrounds

Twelve generated scenes ship in `assets/bg` — three per time-of-day band
(dawn / day / dusk / night), about 1.1 MB total. The band follows the sun; which
of the three you get is random, re-rolled every 7 minutes so a dashboard left on
all day never sits on one image.

To use your own photos instead:

```sh
mkdir -p incoming/dusk
cp ~/Downloads/mosque-sunset.jpg incoming/dusk/
./import-bg.sh
```

Images are centre-cropped to 1920×1080, re-encoded, and registered in
`js/bgmanifest.js`. Nothing hardcodes filenames, so this needs no code change,
and any band you leave empty keeps its generated scenes.

Composition: the wordmark sits top-left, the clock top-right, and an opaque
prayer strip spans y=648–790. Pick images with calm corners.

## Prayer times: offline first, aladhan.com as a cross-check

The solar calculation in `js/praytimes.js` is the source of truth — Fajr has to
be right at 4am with the router down. On top of that, `js/aladhan.js` fetches
the same day from <https://aladhan.com/prayer-times-api> once daily and adopts
their minutes when they differ, so the dashboard agrees with the timetable
people actually read. A failed sync silently leaves the offline times in place.

The status line shows `synced HH:MM` or `offline times`. Settings →
**Sync with aladhan.com** turns it off, and reports how far the two agree
(measured: **0–1 min**).

## Modes

| Mode | After the athan |
|---|---|
| **Home** | Resumes whatever was interrupted. |
| **Mosque** | Never resumes. Athan → iqamah countdown → salah screen → dashboard. |
| **Kids** | Holds on "Let's pray together" for a configurable delay, then resumes. |
| **Ramadan** | Not a mode — the dashboard auto-switches to Suhoor/Iftar countdowns when the Hijri month is Ramadan. |

## Layout

```
config.xml      app id Miqaat0001.Miqaat; alarm + application.info privileges
tvctl.sh        deploy CLI (copy of the IPTV one, retargeted)
fetch-athan.sh  pull + transcode adhan audio from cdn.aladhan.com
import-bg.sh    crop your own photos into assets/bg and write the manifest
index.html      every screen as a hidden <section>
styles.css      body-class screen switching; .focused for D-pad, never :focus
js/praytimes.js solar-position prayer times — offline, ±1 min vs aladhan.com
js/hijri.js     Umm al-Qura, exact vs ICU for 1400–1500 AH (1979–2076 CE)
js/qibla.js     great-circle bearing to the Kaaba
js/location.js  saved -> IP lookup -> Brunswick, ME fallback
js/aladhan.js   daily cross-check against aladhan.com, cached per day
js/bgmanifest.js  generated: which images belong to which time-of-day band
js/scheduler.js tizen alarms (48h horizon) + in-app tick + wake dispatch
js/interrupt.js capture / suspend / resume, with real app ids read off the TV
js/settings.js  localStorage with a defaults merge
js/app.js       screen router, dashboard, athan flow
```

## Diagnostics

Settings → **Diagnostics** (bottom of the list). Never wait for Maghrib to test:

| Key | Does |
|---|---|
| `1` | Full capture → athan → resume path, right now |
| `2` | Arms a **real** alarm 60s out — then switch to Netflix and watch |
| `3` | Dump running app contexts |
| `4` / `5` | Count / re-arm alarms |
| `6` | Fire a 10-minute reminder |
| `7` | Force an aladhan.com re-sync |
| `8` / `9` | Filter the log to the athan chain / the resume steps |
| `UP` / `DOWN` | Scroll the log |

`2` is the only real test of the headline feature.

### Reading the athan trace

Every step from the call starting to control being handed back is logged, and
each line is flushed to `localStorage` **as it happens** — the moment we relaunch
the interrupted app, Tizen backgrounds us and freezes JS mid-function, so
anything not already persisted is lost. The log survives that, and survives the
relaunch afterwards; `───── launch ─────` marks each session boundary.

A healthy Dhuhr cycle reads:

```
ATHAN ▶ Dhuhr at 12:45 · alarm wake · mode=home · src=adhan1.mp3 · vol=85%
ATHAN audio ready, 213s
ATHAN audio playing
ATHAN audio ended naturally
ATHAN ■ Dhuhr ended after 214s (expected 213s) · reason=audio-ended · audio=yes
AFTER Dhuhr · mode=home · interrupted=Netflix (org.tizen.netflix-app) · suppressedToday=false
RESUME ▶ Netflix (org.tizen.netflix-app) captured 217s ago · counting down 5s
RESUME calling launch(org.tizen.netflix-app)
RESUME ✓ launched Netflix — Miqaat backgrounding now
```

What the failure modes look like:

| Line | Means |
|---|---|
| `ATHAN ✗ play() rejected: NotAllowedError` | Autoplay was blocked — screen runs, no sound |
| `ATHAN ✗ no audio at … (err 4)` | File missing or undecodable; run `./fetch-athan.sh` |
| `reason=duration-elapsed` with `audio=no` | Ran the 120s visual fallback, never played |
| `AFTER … interrupted=nothing` | `getAppsContext()` saw nothing to resume |
| `RESUME calling launch(…)` with no line after | The launch never returned — the interesting failure |

Press `8` in Diagnostics to filter to exactly these lines.

## Verified

- Prayer times within **±1 min of aladhan.com** across 9 cities, 7 methods, both
  madhabs, summer and winter (`worst delta -1 min`).
- Hijri dates **exactly match ICU's islamic-umalqura** across 5,010 weekly
  samples spanning 96 years.
- Qibla: Brunswick ME 61.2°, Toronto 54.6°, London 119.0°, Cape Town 23.4°.
- Live aladhan.com sync agrees with the offline engine to **0–1 min**.
- Every screen rendered at 1920×1080 in headless Chrome with **0 JS errors**.

Still unverified — needs the TV powered on: whether a `tizen.alarm` actually
preempts a foreground Netflix on 2017 firmware. See the deploy notes above.
