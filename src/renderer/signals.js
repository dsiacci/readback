'use strict';

// Where the signals come from: the Presage SmartSpectra SDK with the camera,
// or a simulation for trying the app without one. Both hand the app the same
// decoded payloads.

const {
  SmartSpectraSDK,
  ProcessingStatus,
  ValidationCode,
  MetricType,
} = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
const { makeSimulator } = require('../core/simulate');

// Only what Readback uses: the chest movement trace, the breathing rate and
// the pulse rate. Nothing else is computed (no apnea detection, no HRV, no
// face analysis).
const METRICS = [MetricType.CHEST_BREATHING, MetricType.BREATHING_RATE, MetricType.PULSE_RATE];

const STATUS = Object.fromEntries(Object.entries(ProcessingStatus).map(([k, v]) => [v, k.replace(/^k/, '')]));

// Plain-language hints for the SDK's framing feedback.
const HINTS = {
  [ValidationCode.kOk]: ['ok', 'Good framing. Stay still and breathe normally.'],
  [ValidationCode.kNoFaceFound]: ['warn', 'No face found. Face the camera.'],
  [ValidationCode.kMultipleFacesFound]: ['warn', 'More than one face in view. Only one person at a time.'],
  [ValidationCode.kFaceNotCentered]: ['warn', 'Move to the center of the picture.'],
  [ValidationCode.kFaceSizeOutOfRange]: ['warn', 'Move a little closer or further away.'],
  [ValidationCode.kTooDark]: ['warn', 'Too dark. More light on your face helps.'],
  [ValidationCode.kTooBright]: ['warn', 'Too bright. Avoid a light source behind or right in front of the camera.'],
  [ValidationCode.kChestNotVisible]: ['warn', 'Your upper chest should be in view too, for the breathing.'],
  [ValidationCode.kCameraTuning]: ['warn', 'The camera is adjusting…'],
  [ValidationCode.kFrameRateTooLow]: ['warn', 'The camera is too slow. Close other apps using it.'],
  [ValidationCode.kExcessiveMotion]: ['warn', 'Too much movement. Settle and stay still.'],
  [ValidationCode.kFaceTooClose]: ['warn', 'A little further from the camera.'],
  [ValidationCode.kFaceTooFar]: ['warn', 'A little closer to the camera.'],
  [ValidationCode.kFaceTooHigh]: ['warn', 'Lower the camera or yourself a little.'],
  [ValidationCode.kFaceTooLow]: ['warn', 'Raise the camera or yourself a little.'],
  [ValidationCode.kFaceNotForward]: ['warn', 'Face the camera.'],
};

/**
 * @typedef {object} Handlers
 * @property {(decoded: object) => void} onPayload
 * @property {(stream: MediaStream) => void} onStream
 * @property {(level: string, text: string) => void} onHint
 * @property {(status: string) => void} onStatus
 * @property {(message: string) => void} onError
 */

class PresageSource {
  /** @param {Handlers} h */
  constructor(h) {
    this.h = h;
    this.sdk = null;
    this.kind = 'camera';
  }

  async start() {
    const apiKey = await window.readback.presageKey();
    if (!apiKey) throw new Error('No Presage API key found. See "Your Presage key" in the README.');
    const sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: METRICS,
      enableTelemetry: false, // no usage summary goes to Presage
    });
    this.sdk = sdk;
    sdk.on('streamAvailable', (stream) => this.h.onStream(stream));
    sdk.on('metrics', (buf) => {
      try {
        this.h.onPayload(decodeMetrics(buf));
      } catch {
        // a payload that does not decode is skipped
      }
    });
    sdk.on('validationStatus', (code, _ts, hint) => {
      const [level, text] = HINTS[code] || ['warn', hint || 'Adjusting…'];
      this.h.onHint(level, text);
    });
    sdk.on('processingStatus', (s) => this.h.onStatus(STATUS[s] || String(s)));
    sdk.on('error', (code, message) => this.h.onError(`Presage SDK error ${code}: ${message}`));
    await sdk.start();
  }

  async stop() {
    const sdk = this.sdk;
    this.sdk = null;
    if (!sdk) return;
    try { await sdk.stop(); } catch { /* already stopped */ }
    try { sdk.destroy(); } catch { /* already gone */ }
  }
}

/**
 * Simulated signals that react a little like a person might: a quiet start,
 * a climb after a "negative" or a change of plan, a smaller one when talking,
 * and slower breathing during the guide. Clearly labelled in the app.
 */
class SimulatedSource {
  constructor(h) {
    this.h = h;
    this.kind = 'simulated';
    this.arousal = 0;
    this.talking = false;
    this.guiding = false;
    this.timer = null;
    this.last = null;
  }

  /** The app tells the simulation what just happened. */
  nudge(event) {
    const kicks = { negative: 0.8, change: 0.6, readback: 0.45, clearance: 0.22, instruction: 0.12, information: 0.05 };
    if (event.type === 'tower') this.arousal = Math.min(1.2, this.arousal + (kicks[event.kind] || 0.05) + 0.03 * (event.load || 0));
    if (event.type === 'talk-start') this.talking = true;
    if (event.type === 'talk-end') this.talking = false;
    if (event.type === 'guide-start') this.guiding = true;
    if (event.type === 'guide-end') this.guiding = false;
  }

  async start() {
    const wander = (t) => 1.5 * Math.sin(t / 23000) + 0.8 * Math.sin(t / 7100);
    const sim = makeSimulator({
      pulse: (t) => 66 + 17 * this.arousal + (this.talking ? 4 : 0) + wander(t),
      breathing: () => (this.guiding ? 7 : 12.5 + 10 * this.arousal),
      noise: 0.08,
    });
    this.h.onStatus('Running');
    this.h.onHint('ok', 'Simulated signals: no camera is used.');
    this.last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = (now - this.last) / 1000;
      this.last = now;
      const tau = this.guiding ? 9 : 26; // seconds to settle back
      this.arousal *= Math.exp(-dt / tau);
      this.h.onPayload(sim.packet(now));
    }, 100);
  }

  async stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { PresageSource, SimulatedSource };
