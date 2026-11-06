'use strict';

// After the session: which messages made your pulse or your breathing climb,
// next to what the tower said and what you read back.
//
// The SDK's pulse is a 12-second average, so a reaction to a message shows up
// over the next several seconds. Each tower message gets the time from its
// first word to the end of your readback, plus that lag (cut at the next
// message). Its climb is the highest pulse in that time minus the pulse when
// the message started, so a message does not inherit the climb of the one
// before it; the level against the calm minute is given too. Your breathing is counted only while you were listening, before
// the breathing guide if it came up.

const { usable } = require('./baseline');
const { breathRateFromTrace } = require('./breath');
const { classify } = require('./messages');

const PULSE_LAG_MS = 12000;
const LISTEN_MAX_MS = 15000;

function peak(samples) {
  let best = null;
  for (const s of samples) if (!best || s.value > best.value) best = s;
  return best;
}

/**
 * @param {object[]} events session events, each with a type and t0/t1 (ms):
 *   tower {speaker, text, toPilot}, talk {transcript, accepted, sayAgain},
 *   guide {skipped}, calm
 * @param {{pulse: object[], breathing: object[], chest: object[]}} series
 * @param {{pulse: {value:number}|null, traceBreathing: number|null}} baseline
 */
function buildTimeline(events, series, baseline, opts = {}) {
  const lag = opts.pulseLagMs ?? PULSE_LAG_MS;
  const sorted = [...events].sort((a, b) => a.t0 - b.t0);
  const tower = sorted.filter((e) => e.type === 'tower' && e.toPilot !== false);
  const talks = sorted.filter((e) => e.type === 'talk');
  const guides = sorted.filter((e) => e.type === 'guide');
  const basePulse = baseline && baseline.pulse ? baseline.pulse.value : null;
  const baseBreath = baseline ? baseline.traceBreathing : null;

  return tower.map((m, i) => {
    const next = tower[i + 1] ? tower[i + 1].t0 : Infinity;
    const talk = talks.find((k) => k.t0 >= m.t0 && k.t0 < next) || null;
    const end = Math.min(next, (talk ? talk.t1 : m.t1) + lag);
    const usablePulse = series.pulse.filter((s) => usable(s));
    const pulse = peak(usablePulse.filter((s) => s.t >= m.t0 && s.t <= end));
    const start = lastBefore(usablePulse, m.t0);
    const guide = guides.find((g) => g.t0 >= m.t0 && g.t0 < next) || null;
    // Breathing in reaction to the message: from its first word until you
    // speak, or until the breathing guide starts, whichever comes first.
    const listenEnd = Math.min(talk ? talk.t0 : next, guide ? guide.t0 : Infinity, m.t1 + LISTEN_MAX_MS);
    const breath = breathRateFromTrace(series.chest.filter((s) => s.t >= m.t0 && s.t <= listenEnd), {
      minSpanMs: 6000,
    });
    const { kind, label, load } = classify(m);
    return {
      t0: m.t0,
      speaker: m.speaker,
      text: m.text,
      kind,
      label,
      load,
      readback: talk
        ? { transcript: talk.transcript ?? '', accepted: talk.accepted ?? null, sayAgain: Boolean(talk.sayAgain) }
        : null,
      pulsePeak: pulse ? pulse.value : null,
      pulseRise: pulse && start ? Math.max(0, pulse.value - start.value) : null,
      pulseDelta: pulse && basePulse !== null ? pulse.value - basePulse : null,
      breathRate: breath ? breath.rate : null,
      breathDelta: breath && Number.isFinite(baseBreath) ? breath.rate - baseBreath : null,
      guide: guide ? { skipped: Boolean(guide.skipped) } : null,
    };
  });
}

/** The latest sample at or before t (or the first one just after, within 3 s). */
function lastBefore(samples, t) {
  let best = null;
  for (const s of samples) {
    if (s.t <= t) best = s;
    else {
      if (!best && s.t - t <= 3000) best = s;
      break;
    }
  }
  return best;
}

/** The messages after which your pulse climbed the most, at least `minRise` bpm. */
function highlights(rows, n = 3, minRise = 2) {
  return rows
    .filter((r) => Number.isFinite(r.pulseRise) && r.pulseRise >= minRise)
    .sort((a, b) => b.pulseRise - a.pulseRise)
    .slice(0, n);
}

module.exports = { buildTimeline, highlights, PULSE_LAG_MS };
