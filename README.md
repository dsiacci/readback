# Readback

A radio practice partner for student and private pilots. A simulated tower talks to you, you read back out loud, and the camera follows your pulse and your breathing while you do, with the [Presage SmartSpectra SDK](https://smartspectra.presagetech.com/docs). Before your readback, if your breathing has picked up while you listened, a short breathing guide offers itself: the tower can wait. After the circuit, a timeline shows which messages made your pulse climb, next to what the tower said and what you read back.

> **A mirror for practice, not a measure of health.** Readback compares you only with yourself, with a calm minute taken at the start of each session. It makes no medical claim, shows no normal or abnormal value, and never says whether anyone is fit to fly. It is a practice game, not an approved training device: your flight instructor and your country's official phraseology manual are the reference.

Built for the DEV "Presage SmartSpectra SDK Challenge" (November 2026).

## What a session looks like

1. **Consent first.** A screen says what is measured, what stays on your computer, what goes to Presage and how to stop. The camera and the microphone stay off, and the app's main process refuses them, until you agree.
2. **A calm minute.** You sit the way you will for the radio and breathe normally. Your pulse and breathing in that minute become the reference for this session, and only for it. The camera preview is blurred by default (you can hide it or show it).
3. **The circuit.** You are F-ABCD at Isola (ZZZZ), a made-up controlled aerodrome: ask to taxi, read back the taxi clearance, line up, take off, fly a touch and go and a full-stop circuit, vacate, taxi back. Hold the space bar like a push-to-talk switch. Runway, QNH, squawk and wind change every game, and up to three surprises can change the plan ("number 2, follow the Cherokee on base", "extend downwind", "unable to approve touch and go"). A wrong readback gets "negative" and the correct version.
4. **Live, and discreet.** On the side, your pulse and your breathing as differences from your calm minute, with a two-minute trace. Breathing is shown only while you listen, never while you talk (see [Limits](#limits)).
5. **The breathing guide.** When it is your turn and your breathing while listening is up by 4 breaths per minute or more against your calm minute, the guide offers three slow breaths (4 seconds in, 6 out), with your chest movement drawn live under it. "I'm ready" or the space bar skips it.
6. **The timeline.** After the circuit, the camera turns off and you see the three messages after which your pulse climbed most, a chart of the whole session with the tower's messages, your transmissions and the guide, and every message with its climb, its level against the calm minute and your breathing while listening. You can save the session on your computer to compare with the next ones, and delete every saved session with one button.

No camera at hand? "Try with simulated signals" runs the whole experience with made-up signals, labelled as such on every screen.

## How it responds to the signals

Readback asks the SDK for three metrics only, and reads them from each `metrics` event: the pulse rate (a 12-second average), the breathing rate (a 30-second average) and the chest movement trace. Nothing else is computed: no apnea detection, no HRV, no face analysis.

```js
// src/renderer/signals.js
const sdk = new SmartSpectraSDK({
  apiKey,                                   // read by the main process from your key file
  requestedMetrics: [MetricType.CHEST_BREATHING, MetricType.BREATHING_RATE, MetricType.PULSE_RATE],
  enableTelemetry: false,                   // no usage summary goes to Presage
});
sdk.on('metrics', (buf) => handlers.onPayload(decodeMetrics(buf)));
sdk.on('validationStatus', (code) => handlers.onHint(...HINTS[code]));
await sdk.start();                          // opens the camera, after consent
```

- **The calm minute** takes the median of the stable pulse samples, and counts breaths on the last 30 seconds of chest trace (`src/core/baseline.js`).
- **Breathing while you listen.** Presage's model card says the breathing rate does not hold while the person talks. A radio exchange is a few seconds of listening between two transmissions, too short for a 30-second average. So Readback takes the chest trace since you last released the push-to-talk (plus two seconds to settle), removes its slow drift, and counts breaths with a hysteresis so that small wobbles do not count (`src/core/breath.js`). The same count, on the calm minute, is the reference.
- **The guide** is offered on that count, against your own calm minute, with a rise you can change (3, 4, 6 breaths per minute, or never). Never more than once a minute.
- **The timeline** gives each tower message the time from its first word to the end of your readback, plus 12 seconds for the pulse average to catch up, cut at the next message. Its climb is the highest pulse in that time minus the pulse when the message started, so a message does not inherit the climb of the one before it (`src/core/timeline.js`).
- **Framing feedback** from the SDK (`validationStatus`) is shown in plain words during the calm minute: face the camera, more light, keep your upper chest in view.

HRV and facial expressions are left out on purpose: HRV needs a 60-second window, longer than an exchange, and an expression label on a trainee would be a judgement without anything true to add to the practice.

## Run it on a Mac

Readback runs on a Mac with Apple Silicon, with a webcam (the built-in one is fine) and a microphone (a headset is better: the tower's voice does not get back into the microphone).

You need:

- Node.js 22.12 or newer (`brew install node`),
- Python 3.10 or newer for the tower, 3.12 recommended (`brew install python@3.12`; the Python that comes with macOS is too old),
- a Presage API key (free developer account at [physiology.presagetech.com](https://physiology.presagetech.com/auth/register)),
- about 2 GB of disk for the app, the tower and its speech models.

```bash
git clone https://github.com/dsiacci/readback.git
cd readback
npm install                 # Electron, esbuild and the Presage SDK (its native runtime comes from npm)
npm run setup:tower         # the tower in tower/.venv, plus Whisper small.en and two Piper voices (once)

mkdir -p ~/.config/readback && chmod 700 ~/.config/readback
pbpaste > ~/.config/readback/presage.key     # after copying your key from Presage's dashboard
chmod 600 ~/.config/readback/presage.key

npm start
```

The first `npm start` downloads the Electron binary. When you turn the camera on, macOS asks once whether Electron may use the camera, then the microphone.

On an older or smaller machine, `npm run setup:tower -- --model base.en` installs a lighter speech model; pick "base.en" in the settings of the calm-minute screen.

The Presage SDK also supports Linux (x64 and arm64, glibc 2.35 or newer) and Windows (x64), and the same commands should work there; only the Mac has been tried so far.

### Your Presage key

Readback reads the key from the `PRESAGE_API_KEY` environment variable or, if it is not set, from the first line of `~/.config/readback/presage.key`. It never writes it, never logs it, and the repository ignores `*.key` files. The consent screen tells you whether a key was found and warns if the file can be read by other users.

### Options

| Where | What |
|---|---|
| Calm-minute screen, "Your aircraft and the aerodrome" | callsign (`F-xxxx` or `G-xxxx`), the fictional aerodrome's name, QNH or QFE, speech model, when to offer the breathing guide |
| Circuit screen | "Show values instead of differences" |
| `READBACK_SEED=71 npm start` | replays the same circuit every time, to rehearse or to record a demo |
| `READBACK_PYTHON=/path/to/python` | runs the tower with another Python environment that has `phraseology` installed |

## Consent and data handling

- **Consent before the camera.** The first screen explains what is measured, what stays on the computer, what goes to Presage and how to stop. The camera opens only after "I agree, turn the camera on". The microphone is a separate choice: without it you type your readbacks. Until you agree, the main process refuses every camera and microphone request (`src/main/main.js`), and it grants them only to the app's own page.
- **Always visible, always stoppable.** "Camera on" and a "Stop camera" button stay at the top while the camera runs; the system's camera indicator is on too. Closing the window stops everything, and the camera turns off by itself at the end of each circuit.
- **Images.** Never recorded, never saved, never sent by Readback. The frames go from the camera to the SDK inside the app.
- **Your voice.** Recorded in memory while you hold the key, sent to the tower on `127.0.0.1` (this computer), transcribed there by Whisper, then dropped. It is never written to disk. The tower process listens only on this computer.
- **Measurements.** Kept in memory during the session. Saved only if you press "Save on this computer" at the end, as a small JSON file in the app's folder (on a Mac, `~/Library/Application Support/readback/sessions/`): the calm-minute reference, the tower's messages, whether each readback was accepted, and the climbs. No image, no audio, no transcript of what you said. "Delete all saved sessions" removes them all.
- **What goes to Presage.** The SDK computes the pulse and breathing on this computer; it contacts Presage's service to authenticate your API key and check your plan while it measures. The SDK's telemetry (an aggregate summary per session: SDK version, platform, frame rates, counts of quality states, never images or measured values) is on by default in the SDK, and **Readback turns it off** (`enableTelemetry: false`), so it sends nothing. See Presage's [SDK telemetry and privacy page](https://smartspectra.presagetech.com/docs/telemetry-and-privacy) and their [privacy policy](https://api.physiology.presagetech.com/privacypolicy).
- **No AI service.** No language model writes anything about you. The tower's rules check the readback; Presage's optional "LLM Insights" are not used.
- **Nothing else leaves the computer.** The page runs under a content security policy that lets it contact nothing on the network; it reaches the SDK and the tower only through the app's main process. Setup downloads packages from npm and PyPI and the speech models from Hugging Face, once; after that the tower runs with `HF_HUB_OFFLINE=1`.
- **One person, in view, who agreed.** The SDK expects one face; if it sees more, the app asks for one person at a time.

## How it works

```
camera ──► Presage SmartSpectra SDK (in the app, on this computer) ──► pulse, breathing rate, chest trace
                    │ authenticates the key with Presage; telemetry off
                    ▼
        Readback (Electron) ── calm minute · live differences · breathing guide · timeline
                    ▲ │
   tower's messages │ │ your readback (16 kHz WAV, in memory)
                    │ ▼
        the tower: phraseology, a separate program on 127.0.0.1
        Piper (voice) · Whisper (speech recognition) · plain rules check the readback
```

The tower is [phraseology](https://github.com/dsiacci/phraseology), the open-source practice tower I built in October for a friend learning to fly. Readback runs it unchanged, as its own program, from a pinned commit: `npm run setup:tower` installs it into `tower/.venv`, and the app starts it on a free port of `127.0.0.1` and uses its JSON API. Everything that reacts to the camera is new in Readback: the Electron app, the SDK integration, the calm minute, the breathing count while listening, the guide, the timeline.

```
src/main/       Electron main process: consent-gated camera and microphone, the key, the tower, saved sessions
src/preload/    the SDK's bridge for the camera frames, and a small API for the page
src/renderer/   the page: screens, sound, the SDK or simulated signals, drawings
src/core/       the logic, tested without a camera: baseline, breathing count, guide, timeline, message kinds
```

## Tests

```bash
npm test
```

They run in under a second, on simulated signals only: no camera, no microphone, no call to Presage's service. They cover reading the SDK's payloads, the calm-minute reference, counting breaths on a chest trace (clean, noisy, drifting, too short, flat), the listening stretch, the guide's offer and pacing, the tower message kinds, the timeline (a climb tied to the right message, and not inherited by the next one), the key file, the tower's command line, what a saved session may hold, and the WAV encoding.

## Limits

- **The SDK's own limits apply** ([model cards](https://smartspectra.presagetech.com/docs/model-cards-and-limitations)): the pulse is a 12-second average between 40 and 110 bpm; the breathing rate needs 30 seconds and does not hold while you talk, with large movements, dark or tightly striped clothing; good, steady light helps. Presage's metrics are for general wellness and information, not cleared by the FDA, and not for diagnosis.
- **Breathing during an exchange is a rough count** on a few seconds of chest movement. It is good enough to notice that you breathe faster than in your calm minute, not to give a precise rate.
- **Talking moves your pulse too.** Every message includes your own readback, so compare messages with each other rather than reading one climb alone.
- **A climb is tied to a message by time**, within the 12 seconds the pulse average takes to catch up. It says what happened after a message, not why.
- **One circuit, one phraseology.** The tower covers the radio calls of one traffic circuit in English; see its [README](https://github.com/dsiacci/phraseology#readme) for what its checker does and does not do.

## Credits

- [Presage SmartSpectra SDK](https://github.com/Presage-Security/SmartSpectra) (`@smartspectra/node-sdk`), proprietary software of Presage Technologies, installed from npm and used under their [terms](https://physiology.presagetech.com/tos). Readback's SDK wiring follows their Electron quickstart.
- [phraseology](https://github.com/dsiacci/phraseology) (GPL-3.0-or-later), the tower, run as a separate program, with its own credits: [Whisper](https://github.com/openai/whisper) (MIT) through [faster-whisper](https://github.com/SYSTRAN/faster-whisper) and [CTranslate2](https://github.com/OpenNMT/CTranslate2) (MIT), [Silero VAD](https://github.com/snakers4/silero-vad) (MIT), [Piper](https://github.com/OHF-Voice/piper1-gpl) and [espeak-ng](https://github.com/espeak-ng/espeak-ng) (GPL-3.0-or-later) on [ONNX Runtime](https://onnxruntime.ai) (MIT), and the Piper voices `en_US-norman-medium` and `en_GB-cori-medium` from [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices).
- [B612](https://github.com/polarsys/b612), the typeface designed for cockpit displays, under the SIL Open Font License 1.1 ([`src/renderer/fonts/OFL.txt`](src/renderer/fonts/OFL.txt)).
- [Electron](https://www.electronjs.org) (MIT) and [esbuild](https://esbuild.github.io) (MIT).

## License

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). Readback contains no code from the tower, which keeps its own license, and none from the Presage SDK, which is installed from npm under Presage's terms.

## Challenge window

Built for the DEV "Presage SmartSpectra SDK Challenge". The repository was started on 6 November 2026, inside the challenge window (4 November 2026, 2:00 PM PST, to 22 November 2026, 11:59 PM PST). Any commit made after the deadline will be listed here.
