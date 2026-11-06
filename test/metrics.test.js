'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toMs, readPayload, SignalStore } = require('../src/core/metrics');

test('timestamps in microseconds become milliseconds, whatever their type', () => {
  assert.equal(toMs(1_700_000_000_000_000), 1_700_000_000_000);
  assert.equal(toMs(1_700_000_000_000_000n), 1_700_000_000_000);
  assert.equal(toMs({ toNumber: () => 2_000_000 }), 2000);
  assert.equal(toMs('3000000'), 3000);
  assert.ok(Number.isNaN(toMs(undefined)));
});

test('a payload without cardio gives no pulse, and nothing breaks', () => {
  const r = readPayload({ breathing: { rate: [{ value: 14, confidence: 0, timestamp: 1000 }] } });
  assert.deepEqual(r.pulse, []);
  assert.equal(r.breathing[0].value, 14);
  assert.equal(r.breathing[0].t, 1);
  assert.deepEqual(readPayload(null), { pulse: [], breathing: [], chest: [] });
});

test('the store keeps each sample once, in time order', () => {
  const s = new SignalStore();
  const p = (t, v) => ({ cardio: { pulseRate: [{ value: v, confidence: 90, stable: true, timestamp: t * 1000 }] } });
  assert.equal(s.add(p(1000, 70)).pulse.length, 1);
  assert.equal(s.add(p(1000, 70)).pulse.length, 0);
  s.add({ cardio: { pulseRate: [
    { value: 71, confidence: 90, timestamp: 2000 * 1000 },
    { value: 70, confidence: 90, timestamp: 1000 * 1000 },
  ] } });
  assert.deepEqual(s.series.pulse.map((x) => x.value), [70, 71]);
  assert.equal(s.latest('pulse').value, 71);
  assert.equal(s.window('pulse', 1500, 2500).length, 1);
});

test('old samples are dropped past the maximum age', () => {
  const s = new SignalStore({ maxAgeMs: 10_000 });
  for (let t = 0; t <= 20_000; t += 1000) {
    s.add({ cardio: { pulseRate: [{ value: 60, confidence: 90, timestamp: t * 1000 }] } });
  }
  assert.equal(s.series.pulse[0].t, 10_000);
});
