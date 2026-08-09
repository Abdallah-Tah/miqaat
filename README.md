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

## Athan audio is a placeholder

`assets/athan/` ships four **text-to-speech placeholders** that announce which
reciter slot is playing — enough to test the picker by ear on the TV, but not
athan recitations. Real recordings are not mine to redistribute.

Replace each, keeping the filename:

```
assets/athan/makkah.mp3    Makkah - Haram
assets/athan/madinah.mp3   Madinah - Masjid an-Nabawi
assets/athan/aqsa.mp3      Al-Aqsa
assets/athan/short.mp3     Short call (Fajr default)
```

Settings → **Reciter** cycles them and plays each as you scroll; **Play selected
reciter** replays on demand. A missing file is reported on screen rather than
failing silently, and the athan falls back to a 120-second visual call.

Asr madhab is **Shafi'i / Maliki / Hanbali** (one shadow length) or **Hanafi**
(two) — the first covers three of the four schools, hence the compound label.

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
index.html      every screen as a hidden <section>
styles.css      body-class screen switching; .focused for D-pad, never :focus
js/praytimes.js solar-position prayer times — offline, ±1 min vs aladhan.com
js/hijri.js     Umm al-Qura, exact vs ICU for 1400–1500 AH (1979–2076 CE)
js/qibla.js     great-circle bearing to the Kaaba
js/location.js  saved -> IP lookup -> Brunswick, ME fallback
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

`2` is the only real test of the headline feature.

## Verified

- Prayer times within **±1 min of aladhan.com** across 9 cities, 7 methods, both
  madhabs, summer and winter (`worst delta -1 min`).
- Hijri dates **exactly match ICU's islamic-umalqura** across 5,010 weekly
  samples spanning 96 years.
- Qibla: Brunswick ME 61.2°, Toronto 54.6°, London 119.0°, Cape Town 23.4°.
- Every screen rendered at 1920×1080 in headless Chrome with **0 JS errors**.

Still unverified — needs the TV powered on: whether a `tizen.alarm` actually
preempts a foreground Netflix on 2017 firmware. See the deploy notes above.
