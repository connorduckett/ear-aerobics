# Ear Aerobics

Ear training for audio engineers. Drill your ears on EQ, level, panning and compression, with
progress tracking, unlockable difficulty levels and a daily workout.

## For volunteers: how to get it

### Option 1: Use it in your browser (easiest, nothing to download)

Open **https://connorduckett.github.io/ear-aerobics/** in Chrome, Edge, Safari or Firefox. Works on
computers, tablets and phones.

### Option 2: Download it to use offline

1. Go to the **[latest release](https://github.com/connorduckett/ear-aerobics/releases/latest)** and download **`EarAerobics.zip`**.
2. Unzip it (double-click the zip file).
3. Open the unzipped folder and start the app:
   - **Mac:** double-click **`Start Ear Aerobics (Mac).command`**.
     The first time, macOS may say it can't verify the developer. If so, right-click the file,
     choose **Open**, then click **Open** again. You only need to do this once.
   - **Windows:** double-click **`Start Ear Aerobics (Windows).bat`**.
     If Windows shows a blue "Windows protected your PC" box, click **More info**, then **Run anyway**.
4. Your browser opens with the app. Keep the small black window open while you practice and close it when you're done.

**Tips:** use headphones or studio monitors, and start with the volume low. Your progress (XP, streaks,
unlocked levels) is saved in your browser on that computer.

## Running it (developers)

It's a plain web app with no build step and no dependencies. Serve the folder with any static server:

```bash
python3 -m http.server 8642
```

Then open http://localhost:8642. You can also double-click `index.html`, but some browsers block the
Sandbox's real-time audio for files opened that way.

## Drills

| Muscle group | Drill | What you identify |
|---|---|---|
| EQ & Frequency | Peak Finder | Exact frequency of a bell boost, anywhere from 80 Hz to 12 kHz |
| | Dip Finder | Exact frequency of a bell cut, 80 Hz to 12 kHz |
| | Filter Sweep | Exact cutoff of a 24 dB/oct high-pass or low-pass filter, 80 Hz to 12 kHz |
| Level | Gain Detective | Which of two amounts B was turned up or down by |
| Stereo Image | Pan Position | Exact pan position of a mono source, L100 to R100 |
| Dynamics | Spot the Squeeze | Which of A or B is compressed |
| | Ratio / Attack / Release / Threshold | The value of one compressor parameter |

The frequency and pan drills use a continuous strip. Click or drag to place your answer, use the arrow
keys to fine-tune, and press Enter to lock it in. Points scale with how close you land. Each level
tightens the scoring window (for example, full credit within 1/3 octave on Easy and 1/12 octave on Pro).

Each drill has **Easy, Medium, Hard and Pro** levels. Score 70% or better on a level (5+ questions)
to unlock the next one. After a miss, an **L** button lets you hear *your* pick next to the real answer.
A ding plays for a good answer and a dull thud for a miss. Toggle these with the bell in the header.

The **daily workout** runs four drills, one from each muscle group, with five questions each. Before
each drill you choose its sound source, and after each drill you see your score for it. The results
page breaks the workout down by drill.

## Sandbox

A free-play tab with real-time processors modeled on classic Waves plugins:

| Plugin | Modeled on | What you can do |
|---|---|---|
| EQ-6 | Q6 | 6-band parametric EQ (bell, shelves, cuts). Drag points on the graph over a live spectrum |
| DynEQ-6 | F6 | 6-band dynamic EQ with per-band threshold, range, attack and release. Shows the live dynamic curve |
| Comp-1 | C1 Compressor | Threshold, ratio, attack, release, knee, makeup, sidechain HPF, with a transfer curve and GR meter |
| Gate-1 | C1 Gate | Gate or expander with range, hold and key filters |
| De-Esser | DeEsser | Split or wideband, high-pass or band-pass sidechain, and audition of what it's listening to |
| Strip-1 | SSL EV2 Channel | A full console channel strip: mic preamp gain, HPF/LPF, 4-band EQ, compressor, gate/expander and fader |

**Strip-1** starts the way a real input does. The source arrives at mic level (around −40 dBFS),
so you set the preamp **Gain** first. A coach under the input meter tells you when the level is too
quiet, in the sweet spot (peaks between −18 and −6 dBFS), hot, or clipping. Push the gain too far and
the preamp distorts. Turn it up and the hiss rises with it. **New input** swaps in a performer at a
different level so you can practice again. The filters can be sent to the dynamics sidechain, and the
dynamics can sit before or after the EQ. A monitor protection limiter keeps a cranked preamp from
blasting your ears.

Each plugin has presets, a "Try this" list, and help text for every control. Press `B` to bypass
and compare. The Sandbox uses AudioWorklet. If your browser blocks it when the app is opened as a
file, run the local server above.

Compressor drills are **loudness-matched** (RMS) and the dry signal is delayed to match the
compressor's 6 ms look-ahead, so level and timing never give the answer away.

## Sound sources

All practice audio is synthesized in the browser (no copyrighted audio is included):
**Full mix**, **Drums**, **Bass & keys**, **Vocal** (with sibilance and a quiet hiss/hum floor for the
de-esser and gate) and **Pink noise**. Choose **Your audio** to train on
your own song (MP3, WAV, AIFF, M4A or FLAC). You can also drag a file onto the page. A 12-second
excerpt from about 30% into the track is used.

## Keyboard

`Space` play/stop · `J` `K` `L` switch versions · `1`–`9` answer · `Enter` next question

## Project layout

```
index.html          app shell
css/styles.css      styling
js/dsp.js           offline rendering, RMS/peak, normalization
js/audio.js         sample-aligned A/B/C playback with click-free crossfades
js/sources.js       synthesized practice loops + user file loading
js/exercises.js     drill definitions (add new drills here)
js/store.js         progress, XP, streaks, unlocks (localStorage)
js/app.js           UI, routing, sessions, daily workout
js/plugins-dsp.js   AudioWorklet processors: EQ/dynamic EQ, compressor/gate, de-esser
js/sandbox.js       Sandbox UI: knobs, graphs, meters, presets
```

Progress is saved in your browser's local storage on this device.
