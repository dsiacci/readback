'use strict';

// With the real tower (phraseology, installed by `npm run setup:tower`), in
// its text mode: no speech model is loaded, nothing is spoken or recorded.
// Checks that Readback starts it, plays a circuit through its API, and reads
// its messages the way the timeline expects.
//
//   npm run test:tower

const test = require('node:test');
const assert = require('node:assert/strict');
const { Tower } = require('../src/main/tower');
const { classify } = require('../src/core/messages');

const tower = new Tower();

test('a circuit through the real tower', { skip: !tower.installed() && 'the tower is not installed' }, async (t) => {
  t.after(() => tower.stop());
  const cfg = await tower.start({ callsign: 'F-ABCD', aerodrome: 'Isola', noSpeech: true });
  assert.equal(cfg.callsign, 'F-ABCD');
  assert.equal(cfg.speech, false);

  let body = await tower.request('POST', '/api/game', { seed: 71, surprises: true });
  const game = body.game;
  assert.ok(game);
  assert.equal(body.step, 1);
  assert.equal(body.station, 'ground');

  const say = async (text) => tower.request('POST', '/api/text', { game, text });

  body = await say('Isola Ground, F-ABCD, at the flying club, request taxi for circuits');
  assert.equal(body.accepted, true);
  const clearance = body.transmissions.find((m) => m.toPilot);
  assert.equal(classify(clearance).kind, 'clearance');
  assert.ok(classify(clearance).load >= 3);

  body = await say('Runway 27, QNH 1001, holding point A1, via Bravo, F-ABCD');
  assert.equal(body.accepted, false);
  assert.equal(classify(body.transmissions.find((m) => m.toPilot)).kind, 'negative');
  assert.ok(body.findings.some((f) => /QNH/.test(f.text)));

  body = await say('Runway 27, QNH 1010, holding point A1, via Bravo, F-ABCD');
  assert.equal(body.accepted, true);

  // the tower refuses a path outside its API
  await assert.rejects(tower.request('GET', '/etc/passwd'), /Unknown tower path/);
});
