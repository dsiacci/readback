'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { breathRateFromTrace, listeningStretch, guideAdvice, guidePhase } = require('../src/core/breath');
const { seeded } = require('../src/core/simulate');

function sine(ratePerMin, seconds, { hz = 30, noise = 0.1, drift = 0, seed = 1 } = {}) {
  const rnd = seeded(seed);
  const pts = [];
  for (let i = 0; i <= seconds * hz; i++) {
    const t = (i * 1000) / hz;
    const v = Math.sin((2 * Math.PI * ratePerMin * t) / 60000) + noise * (rnd() * 2 - 1) + drift * t / 1000;
    pts.push({ t, value: v });
  }
  return pts;
}

test('breaths are counted on a clean chest trace', () => {
  for (const rate of [8, 12, 18, 24, 30]) {
    const r = breathRateFromTrace(sine(rate, 20));
    assert.ok(r, `rate ${rate}`);
    assert.ok(Math.abs(r.rate - rate) < 1, `expected ${rate}, got ${r.rate}`);
  }
});

test('noise and a slow drift of the trace do not add breaths', () => {
  const r = breathRateFromTrace(sine(15, 20, { noise: 0.4, drift: 0.05, seed: 7 }));
  assert.ok(r);
  assert.ok(Math.abs(r.rate - 15) < 1.5, `got ${r.rate}`);
});

test('too short or flat gives no rate rather than a guess', () => {
  assert.equal(breathRateFromTrace(sine(15, 5)), null);
  const flat = sine(15, 20, { noise: 0 }).map((p) => ({ t: p.t, value: 1 }));
  assert.equal(breathRateFromTrace(flat), null);
  assert.equal(breathRateFromTrace([]), null);
});

test('the listening stretch starts after the last transmission and is empty while talking', () => {
  const pts = sine(15, 40);
  const talk = [{ t0: 5000, t1: 10000 }];
  const s = listeningStretch(pts, talk, 30000);
  assert.ok(s[0].t >= 12000);
  assert.ok(s[s.length - 1].t <= 30000);
  assert.deepEqual(listeningStretch(pts, [{ t0: 25000, t1: null }], 30000), []);
  // a transmission that has not started yet does not count
  assert.ok(listeningStretch(pts, [{ t0: 35000, t1: 37000 }], 30000).length > 0);
});

test('the guide is offered only for a rise above your own calm minute', () => {
  assert.equal(guideAdvice(20, 14).offer, true);
  assert.equal(guideAdvice(16, 14).offer, false);
  assert.equal(guideAdvice(16, 14, { rise: 2 }).offer, true);
  assert.equal(guideAdvice(null, 14).offer, false);
  assert.equal(guideAdvice(20, NaN).offer, false);
});

test('the guide breathes in for 4 s and out for 6 s, three times', () => {
  assert.equal(guidePhase(0).phase, 'in');
  assert.equal(guidePhase(3999).phase, 'in');
  assert.equal(guidePhase(4000).phase, 'out');
  assert.equal(guidePhase(9000).progress, 5 / 6);
  assert.equal(guidePhase(10000).cycle, 1);
  assert.equal(guidePhase(30000).phase, 'done');
  assert.equal(guidePhase(25000).remainingMs, 5000);
});
