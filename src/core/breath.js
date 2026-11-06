'use strict';

// Breathing, while you listen.
//
// The SDK's breathing rate is a 30-second average and, per Presage's model
// card, it does not hold while the person is talking. A radio exchange is a
// few seconds of listening between two transmissions, so Readback reads the
// chest movement trace the SDK streams alongside the rate, keeps only the
// stretch since you last released the push-to-talk, and counts breaths in it.
// That gives a quicker, rougher rate for the moment before your readback,
// compared with the same measure taken during the calm minute at the start.

const { mean } = require('./stats');

/** Least-squares line through (t, value); returns the residuals. */
function detrend(points) {
  const n = points.length;
  const tm = mean(points.map((p) => p.t));
  const vm = mean(points.map((p) => p.value));
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - tm) * (p.value - vm);
    den += (p.t - tm) ** 2;
  }
  const slope = den ? num / den : 0;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = { t: points[i].t, value: points[i].value - (vm + slope * (points[i].t - tm)) };
  }
  return out;
}

/** Centered moving average over a time window (ms). */
function smooth(points, windowMs) {
  const half = windowMs / 2;
  const out = new Array(points.length);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const t = points[i].t;
    while (hi < points.length && points[hi].t <= t + half) sum += points[hi++].value;
    while (points[lo].t < t - half) sum -= points[lo++].value;
    out[i] = { t, value: sum / (hi - lo) };
  }
  return out;
}

/**
 * Breaths per minute from a stretch of chest trace.
 * Counts rising crossings with hysteresis (so small wobbles don't count as
 * breaths) and divides the whole breaths between the first and the last
 * crossing by the time between them. Returns null when the stretch is too
 * short or too flat to say.
 *
 * @param {{t:number, value:number}[]} points sorted by time (ms)
 */
function breathRateFromTrace(points, opts = {}) {
  const minSpanMs = opts.minSpanMs ?? 8000;
  const smoothMs = opts.smoothMs ?? 600;
  const pts = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.value));
  if (pts.length < 8) return null;
  const span = pts[pts.length - 1].t - pts[0].t;
  if (span < minSpanMs) return null;

  const x = smooth(detrend(pts), smoothMs);
  const sd = Math.sqrt(mean(x.map((p) => p.value * p.value)));
  if (!(sd > 0)) return null;
  const h = (opts.hysteresis ?? 0.3) * sd;

  const rises = [];
  let state = x[0].value > h ? 'high' : x[0].value < -h ? 'low' : 'mid';
  let lastZeroUp = null;
  for (let i = 1; i < x.length; i++) {
    const v = x[i].value;
    if (x[i - 1].value < 0 && v >= 0) {
      // time of the upward zero crossing, interpolated
      const a = x[i - 1];
      const b = x[i];
      lastZeroUp = a.t + ((0 - a.value) / (b.value - a.value)) * (b.t - a.t);
    }
    if (v < -h) state = 'low';
    else if (v > h) {
      if (state === 'low' && lastZeroUp !== null) rises.push(lastZeroUp);
      state = 'high';
    }
  }
  if (rises.length < 2) return null;
  const dt = rises[rises.length - 1] - rises[0];
  if (dt <= 0) return null;
  const rate = ((rises.length - 1) / dt) * 60000;
  if (rate < 3 || rate > 60) return null;
  return { rate, breaths: rises.length - 1, spanMs: span };
}

/**
 * The stretch of trace since the pilot last stopped talking.
 * @param {{t0:number, t1:number|null}[]} talk push-to-talk intervals; t1 null while held
 * @returns the points, or [] while the pilot is talking
 */
function listeningStretch(points, talk, now, opts = {}) {
  const settleMs = opts.settleMs ?? 2000;
  const maxMs = opts.maxMs ?? 30000;
  let from = now - maxMs;
  for (const k of talk) {
    if (k.t0 > now) continue;
    if (k.t1 === null || k.t1 === undefined || k.t1 > now) return [];
    from = Math.max(from, k.t1 + settleMs);
  }
  return points.filter((p) => p.t >= from && p.t <= now);
}

/**
 * Should the breathing guide be offered before the pilot's turn?
 * Only ever relative to the pilot's own calm minute, with a rise they can
 * change in the settings. It is an offer: the pilot can skip it.
 */
function guideAdvice(currentRate, baselineRate, settings = {}) {
  const rise = settings.rise ?? 4;
  if (!Number.isFinite(currentRate) || !Number.isFinite(baselineRate)) {
    return { offer: false, rise: null };
  }
  const delta = currentRate - baselineRate;
  return { offer: delta >= rise, rise: delta };
}

const DEFAULT_PATTERN = { inMs: 4000, outMs: 6000, cycles: 3 };

/** Where the guide is after `elapsedMs`: breathe in, breathe out, or done. */
function guidePhase(elapsedMs, pattern = DEFAULT_PATTERN) {
  const cycle = pattern.inMs + pattern.outMs;
  const total = cycle * pattern.cycles;
  if (elapsedMs >= total) return { phase: 'done', progress: 1, cycle: pattern.cycles, remainingMs: 0 };
  const e = Math.max(0, elapsedMs);
  const n = Math.floor(e / cycle);
  const within = e - n * cycle;
  const remainingMs = total - e;
  if (within < pattern.inMs) return { phase: 'in', progress: within / pattern.inMs, cycle: n, remainingMs };
  return { phase: 'out', progress: (within - pattern.inMs) / pattern.outMs, cycle: n, remainingMs };
}

module.exports = {
  detrend,
  smooth,
  breathRateFromTrace,
  listeningStretch,
  guideAdvice,
  guidePhase,
  DEFAULT_PATTERN,
};
