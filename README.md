# Readback

A radio practice partner for student and private pilots. You talk to a simulated tower, out loud, and the camera follows your pulse and your breathing while you do, with the Presage SmartSpectra SDK.

> **Work in progress** for the DEV "Presage SmartSpectra SDK Challenge" (November 2026). Setup instructions, the consent and data handling details and the demo come with the app.

> **A mirror for practice, not a measure of health.** Readback compares you only with yourself, with a calm minute taken at the start of each session. It makes no medical claim, uses no normal or abnormal threshold, and never says whether anyone is fit to fly. It is a practice game, not an approved training device: your flight instructor and your country's official phraseology manual are the reference.

## What it does

- **A calm minute first.** Your pulse and breathing at rest, for this session only.
- **Radio exchanges with a simulated tower.** The tower is [phraseology](https://github.com/dsiacci/phraseology), the open-source practice tower I built in October: a synthetic voice speaks, you hold the push-to-talk key and read back, speech recognition and plain rules check your readback, all on your machine.
- **Live, and discreet.** Your pulse and breathing next to the radio, as a difference from your calm minute.
- **A breathing guide before your turn.** If your breathing has quickened while you listened, a short guide offers itself before you press the key. The tower can wait.
- **A timeline after the session.** Which messages made your pulse or breathing climb, next to what the tower said and what you read back.

## License

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). The Presage SmartSpectra SDK is proprietary software of Presage Technologies, installed from npm under its own terms; the tower runs as a separate program under its own license (GPL-3.0-or-later).
