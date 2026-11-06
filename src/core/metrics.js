'use strict';

// Reads the decoded SmartSpectra metrics payload into plain time series.
//
// Every 'metrics' event from the SDK carries arrays of recent samples. A
// sample can show up again in the next packet, so the store keeps one series
// per signal and only appends samples newer than the last one it holds.
// Times are milliseconds since the Unix epoch, the same clock as Date.now(),
// so they line up with what the app records (tower messages, push-to-talk).

/** Converts an SDK timestamp (microseconds since the epoch) to milliseconds. */
function toMs(ts) {
  if (ts === null || ts === undefined) return NaN;
  if (typeof ts === 'number') return ts / 1000;
  if (typeof ts === 'bigint') return Number(ts) / 1000;
  if (typeof ts.toNumber === 'function') return ts.toNumber() / 1000; // protobufjs Long
  return Number(ts) / 1000;
}

function list(x) {
  return Array.isArray(x) ? x : [];
}

/**
 * Pulls the signals Readback uses out of one decoded payload.
 * Missing fields give empty arrays: cardio is empty until a pulse metric is
 * requested, breathing has no confidence before its 30-second window fills.
 */
function readPayload(m) {
  const cardio = (m && m.cardio) || {};
  const breathing = (m && m.breathing) || {};
  const withConfidence = (s) => ({
    t: toMs(s.timestamp),
    value: Number(s.value),
    confidence: Number(s.confidence || 0),
    stable: Boolean(s.stable),
  });
  return {
    pulse: list(cardio.pulseRate).map(withConfidence),
    breathing: list(breathing.rate).map(withConfidence),
    chest: list(breathing.upperTrace).map((s) => ({
      t: toMs(s.timestamp),
      value: Number(s.value),
      stable: Boolean(s.stable),
    })),
  };
}

const CHANNELS = ['pulse', 'breathing', 'chest'];

class SignalStore {
  /** @param {{maxAgeMs?: number}} [opts] samples older than this are dropped */
  constructor(opts = {}) {
    this.maxAgeMs = opts.maxAgeMs ?? 60 * 60 * 1000;
    this.series = { pulse: [], breathing: [], chest: [] };
  }

  /** Adds a decoded payload; returns the samples that were new. */
  add(decoded) {
    const fresh = readPayload(decoded);
    const added = {};
    for (const ch of CHANNELS) {
      const s = this.series[ch];
      let last = s.length ? s[s.length - 1].t : -Infinity;
      added[ch] = [];
      const incoming = fresh[ch]
        .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.value))
        .sort((a, b) => a.t - b.t);
      for (const x of incoming) {
        if (x.t > last) {
          s.push(x);
          added[ch].push(x);
          last = x.t;
        }
      }
      this._trim(ch);
    }
    return added;
  }

  _trim(ch) {
    const s = this.series[ch];
    if (!s.length) return;
    const cutoff = s[s.length - 1].t - this.maxAgeMs;
    let i = 0;
    while (i < s.length && s[i].t < cutoff) i++;
    if (i) s.splice(0, i);
  }

  /** Samples with t0 <= t <= t1. */
  window(ch, t0, t1) {
    return this.series[ch].filter((x) => x.t >= t0 && x.t <= t1);
  }

  latest(ch) {
    const s = this.series[ch];
    return s.length ? s[s.length - 1] : null;
  }

  /** A plain copy, for saving a session or drawing the timeline. */
  toJSON() {
    return { pulse: [...this.series.pulse], breathing: [...this.series.breathing], chest: [...this.series.chest] };
  }

  clear() {
    for (const ch of CHANNELS) this.series[ch] = [];
  }
}

module.exports = { toMs, readPayload, SignalStore };
