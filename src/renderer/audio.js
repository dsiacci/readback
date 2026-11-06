'use strict';

// Sound: the tower's voice through a radio-like band-pass with a squelch
// tail, and the pilot's push-to-talk recording, turned into the 16 kHz mono
// WAV the tower's speech recognition takes. Recordings live in memory only.

const { encodeWav, peak } = require('../core/wav');

const RATE = 16000;
let ctx = null;

function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** A short burst of filtered noise, like a squelch opening or closing. */
function squelch(level = 0.05, ms = 110) {
  const ac = audio();
  const n = Math.floor((ac.sampleRate * ms) / 1000);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2400;
  bp.Q.value = 0.8;
  const g = ac.createGain();
  g.gain.value = level;
  src.connect(bp).connect(g).connect(ac.destination);
  src.start();
  return new Promise((r) => { src.onended = r; });
}

/**
 * Plays a WAV from the tower. Resolves with when it started and ended
 * (Date.now() milliseconds), the clock the signals use too.
 */
async function playTransmission(wav, { radio = true } = {}) {
  const ac = audio();
  const buffer = await ac.decodeAudioData(wav.slice(0));
  const src = ac.createBufferSource();
  src.buffer = buffer;
  let node = src;
  if (radio) {
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 320;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3300;
    const g = ac.createGain();
    g.gain.value = 1.15;
    node = node.connect(hp).connect(lp).connect(g);
  }
  node.connect(ac.destination);
  if (radio) await squelch(0.04, 70);
  const t0 = Date.now();
  await new Promise((resolve) => {
    src.onended = resolve;
    src.start();
  });
  const t1 = Date.now();
  if (radio) squelch(0.06, 140);
  return { t0, t1 };
}

/** Push-to-talk recorder over a microphone stream. */
class Recorder {
  constructor(stream) {
    this.stream = stream;
    this.rec = null;
    this.chunks = [];
  }

  start() {
    this.chunks = [];
    const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    this.rec = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start();
    squelch(0.03, 60);
  }

  get active() {
    return Boolean(this.rec && this.rec.state === 'recording');
  }

  /** Stops and returns {wav, seconds, level}, or null if nothing was recorded. */
  async stop() {
    if (!this.active) return null;
    const rec = this.rec;
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.stop();
    await stopped;
    this.rec = null;
    const blob = new Blob(this.chunks, { type: rec.mimeType });
    this.chunks = [];
    if (!blob.size) return null;
    const decoded = await audio().decodeAudioData(await blob.arrayBuffer());
    const frames = Math.max(1, Math.ceil(decoded.duration * RATE));
    const off = new OfflineAudioContext(1, frames, RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    const samples = rendered.getChannelData(0);
    return { wav: encodeWav(samples, RATE), seconds: decoded.duration, level: peak(samples) };
  }
}

module.exports = { playTransmission, squelch, Recorder, audio };
