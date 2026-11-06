'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SignalStore } = require('../src/core/metrics');
const { makeSimulator, seeded } = require('../src/core/simulate');
const { calmBaseline } = require('../src/core/baseline');
const { buildTimeline, highlights } = require('../src/core/timeline');

const T0 = 1_800_000_000_000; // an arbitrary epoch time, in ms

// A simulated session: calm minute at 66 bpm and 12 breaths/min, then three
// tower messages. The pulse climbs after the second one (a "negative") and the
// breathing quickens while listening to it.
function session() {
  const bump = (t, at, height, len = 25000) => (t >= at && t < at + len ? height * Math.sin((Math.PI * (t - at)) / len) : 0);
  const pulse = (t) => 66 + bump(t, T0 + 80000, 4) + bump(t, T0 + 110000, 14) + bump(t, T0 + 150000, 3);
  const breathing = (t) => (t >= T0 + 110000 && t < T0 + 120000 ? 22 : 12);
  const sim = makeSimulator({ pulse, breathing, random: seeded(3), noise: 0.1 });
  const store = new SignalStore();
  for (let t = T0; t <= T0 + 200000; t += 100) store.add(sim.packet(t));
  const events = [
    { type: 'calm', t0: T0, t1: T0 + 60000 },
    { type: 'tower', t0: T0 + 80000, t1: T0 + 86000, speaker: 'ground', toPilot: true, text: 'F-ABCD, runway 27, QNH 1013, taxi holding point A1 via Bravo' },
    { type: 'talk', t0: T0 + 90000, t1: T0 + 96000, transcript: 'runway 27 QNH 1003 ...', accepted: false },
    { type: 'tower', t0: T0 + 110000, t1: T0 + 114000, speaker: 'ground', toPilot: true, text: 'F-ABCD, negative, QNH 1013' },
    { type: 'guide', t0: T0 + 120000, t1: T0 + 150000, skipped: false },
    { type: 'talk', t0: T0 + 151000, t1: T0 + 155000, transcript: 'QNH 1013 F-ABCD', accepted: true },
    { type: 'tower', t0: T0 + 170000, t1: T0 + 174000, speaker: 'traffic', toPilot: false, text: 'F-GXYZ, downwind' },
    { type: 'tower', t0: T0 + 180000, t1: T0 + 184000, speaker: 'tower', toPilot: true, text: 'F-CD, squawk 4521, contact Tower 118.505' },
  ];
  return { store, events };
}

test('the calm minute gives this session its own reference', () => {
  const { store } = session();
  const b = calmBaseline(store.toJSON(), T0, T0 + 60000);
  assert.equal(b.ready, true);
  assert.equal(Math.round(b.pulse.value), 66);
  assert.equal(Math.round(b.breathing.value), 12);
  assert.ok(Math.abs(b.traceBreathing - 12) < 1, `trace breathing ${b.traceBreathing}`);
});

test('without pulse samples the calm minute is not ready', () => {
  const b = calmBaseline({ pulse: [], breathing: [], chest: [] }, T0, T0 + 60000);
  assert.equal(b.ready, false);
  assert.equal(b.pulse, null);
});

test('the timeline ties each climb to the message that came before it', () => {
  const { store, events } = session();
  const series = store.toJSON();
  const b = calmBaseline(series, T0, T0 + 60000);
  const rows = buildTimeline(events, series, b);
  assert.equal(rows.length, 3, 'the other aircraft is left out');
  const [taxi, negative, squawk] = rows;
  assert.equal(taxi.kind, 'clearance');
  assert.equal(taxi.readback.accepted, false);
  assert.equal(negative.kind, 'negative');
  assert.ok(negative.pulseDelta > 10, `negative pulse delta ${negative.pulseDelta}`);
  assert.ok(negative.breathDelta > 5, `negative breath delta ${negative.breathDelta}`);
  assert.deepEqual(negative.guide, { skipped: false });
  assert.equal(squawk.readback, null);
  const top = highlights(rows);
  assert.equal(top[0].text, 'F-ABCD, negative, QNH 1013');
});
