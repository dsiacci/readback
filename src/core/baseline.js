'use strict';

// The calm minute at the start of a session: your own reference point for
// this session, nothing else. It is never compared with a norm.

const { median, mad } = require('./stats');
const { breathRateFromTrace } = require('./breath');

/** A rate sample Readback trusts: the SDK marks it stable, or its confidence is high enough. */
function usable(s, minConfidence = 60) {
  return s && Number.isFinite(s.value) && (s.stable || s.confidence >= minConfidence);
}

function summary(samples) {
  const values = samples.map((s) => s.value);
  if (!values.length) return null;
  return { value: median(values), spread: mad(values), n: values.length };
}

/**
 * @param {{pulse: object[], breathing: object[], chest: object[]}} series
 * @param {number} t0 start of the calm minute (ms)
 * @param {number} t1 end of the calm minute (ms)
 */
function calmBaseline(series, t0, t1, opts = {}) {
  const minConfidence = opts.minConfidence ?? 60;
  const minPulse = opts.minPulseSamples ?? 5;
  const inside = (s) => s.t >= t0 && s.t <= t1;
  const pulse = summary(series.pulse.filter(inside).filter((s) => usable(s, minConfidence)));
  const breathing = summary(series.breathing.filter(inside).filter((s) => usable(s, minConfidence)));
  // Same measure as during the exchanges: breaths counted on the chest trace,
  // over the last 30 seconds of the calm minute.
  const chest = series.chest.filter((s) => s.t >= Math.max(t0, t1 - 30000) && s.t <= t1);
  const fromTrace = breathRateFromTrace(chest, { minSpanMs: 15000 });
  return {
    t0,
    t1,
    pulse: pulse && pulse.n >= minPulse ? pulse : null,
    breathing,
    traceBreathing: fromTrace ? fromTrace.rate : null,
    ready: Boolean(pulse && pulse.n >= minPulse),
  };
}

module.exports = { calmBaseline, usable };
