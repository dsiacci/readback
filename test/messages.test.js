'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../src/core/messages');

const t = (text, extra = {}) => ({ speaker: 'tower', toPilot: true, text, ...extra });

test('tower messages are sorted by what they ask of the pilot', () => {
  assert.equal(classify(t('F-ABCD, negative, QNH 1013, F-ABCD')).kind, 'negative');
  assert.equal(classify(t('F-CD, read back squawk')).kind, 'readback');
  assert.equal(classify(t('F-CD, number 2, follow the Cherokee on base')).kind, 'change');
  assert.equal(classify(t('F-CD, unable to approve touch and go due traffic, make full stop landing')).kind, 'change');
  assert.equal(classify(t('F-CD, extend downwind, number 1 is a Robin on final')).kind, 'change');
  assert.equal(classify(t('F-CD, runway 27, cleared for take-off, wind 250 degrees 8 knots')).kind, 'clearance');
  assert.equal(classify(t('F-ABCD, runway 27, QNH 1013, taxi holding point A1 via Bravo')).kind, 'clearance');
  assert.equal(classify(t('F-CD, squawk 4521, contact Tower 118.505')).kind, 'instruction');
  assert.equal(classify(t('F-CD, vacate right via Charlie, contact Ground 121.805')).kind, 'instruction');
  assert.equal(classify(t('F-CD, roger')).kind, 'information');
});

test('the other aircraft on the frequency is not a message to the pilot', () => {
  assert.equal(classify({ speaker: 'traffic', toPilot: false, text: 'F-GXYZ, runway 27, cleared to land' }).kind, 'traffic');
});

test('load counts the items packed into a message', () => {
  assert.equal(classify(t('F-ABCD, runway 27, QNH 1013, taxi holding point A1 via Bravo')).load, 3);
  assert.equal(classify(t('')).load, 0);
});
