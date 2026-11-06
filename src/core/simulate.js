'use strict';

// Simulated signals, shaped like the SDK's decoded metrics payload.
// Used by the tests and by the app's "simulated signals" mode, so the whole
// experience can be built and checked without a camera and without spending
// any measurement time on Presage's service. Nothing here is a real person.

/**
 * @param {object} spec
 * @param {(t:number)=>number} spec.pulse     pulse at time t (ms) in beats per minute
 * @param {(t:number)=>number} spec.breathing breathing rate at time t in breaths per minute
 * @param {number} [spec.traceHz=30]          chest trace sample rate
 * @param {number} [spec.noise=0.05]          trace noise, relative to the breath amplitude
 * @param {()=>number} [spec.random]          random source (0..1), for repeatable runs
 */
function makeSimulator(spec) {
  const traceHz = spec.traceHz ?? 30;
  const noise = spec.noise ?? 0.05;
  const random = spec.random ?? Math.random;
  let phase = 0;
  let lastTraceT = null;
  let lastRateT = -Infinity;

  /** All samples between the previous call and t (ms since the epoch). */
  function packet(t) {
    const upperTrace = [];
    const start = lastTraceT === null ? t - 1000 : lastTraceT;
    const step = 1000 / traceHz;
    for (let s = start + step; s <= t; s += step) {
      const rate = spec.breathing(s);
      phase += (2 * Math.PI * rate * step) / 60000;
      const value = Math.sin(phase) + noise * (random() * 2 - 1);
      upperTrace.push({ value, stable: true, timestamp: Math.round(s * 1000) });
      lastTraceT = s;
    }
    const out = { breathing: { upperTrace }, cardio: {} };
    if (t - lastRateT >= 1000) {
      lastRateT = t;
      out.cardio.pulseRate = [{ value: spec.pulse(t), confidence: 90, stable: true, timestamp: t * 1000 }];
      out.breathing.rate = [{ value: spec.breathing(t), confidence: 80, stable: true, timestamp: t * 1000 }];
    }
    return out;
  }

  return { packet };
}

/** A small seeded random generator (mulberry32), for repeatable tests. */
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { makeSimulator, seeded };
