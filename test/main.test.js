'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readKey } = require('../src/main/key');
const { towerArgs, cleanSettings, pythonPath } = require('../src/main/tower');
const { SessionStore, sanitize } = require('../src/main/sessions');
const { encodeWav, peak } = require('../src/core/wav');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'readback-test-'));
}

test('the key comes from the environment first, then from the key file', () => {
  const home = tmp();
  assert.deepEqual(readKey({ env: {}, home }), { key: null, source: null, warning: null });
  const dir = path.join(home, '.config', 'readback');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'presage.key'), 'test-key-not-real\n', { mode: 0o600 });
  assert.deepEqual(readKey({ env: {}, home, platform: 'linux' }), { key: 'test-key-not-real', source: 'file', warning: null });
  assert.equal(readKey({ env: { PRESAGE_API_KEY: ' from-env ' }, home }).key, 'from-env');
  fs.chmodSync(path.join(dir, 'presage.key'), 0o644);
  assert.match(readKey({ env: {}, home, platform: 'linux' }).warning, /chmod 600/);
});

test('tower settings are checked before they reach the command line', () => {
  assert.deepEqual(cleanSettings({ callsign: 'g-abcd', aerodrome: 'Isola', altimeter: 'qfe', model: 'base.en' }),
    { callsign: 'G-ABCD', aerodrome: 'Isola', altimeter: 'QFE', model: 'base.en', noSpeech: false });
  const bad = cleanSettings({ callsign: 'F-ABCD; rm -rf', aerodrome: '--public', altimeter: 'x', model: 'large' });
  assert.deepEqual(bad, { callsign: 'F-ABCD', aerodrome: 'Isola', altimeter: 'QNH', model: 'small.en', noSpeech: false });
  const args = towerArgs(4242, { noSpeech: true });
  assert.deepEqual(args.slice(0, 7), ['-m', 'phraseology', 'serve', '--host', '127.0.0.1', '--port', '4242']);
  assert.ok(args.includes('--no-speech'));
  assert.ok(!args.includes('--public'));
  assert.equal(pythonPath({ READBACK_PYTHON: '/x/python' }), '/x/python');
  assert.match(pythonPath({}, 'linux', '/r'), /tower\/\.venv\/bin\/python$/);
});

test('a saved session keeps no transcript, and deleting removes them all', () => {
  const clean = sanitize({
    startedAt: '2026-11-06T10:00:00Z',
    settings: { callsign: 'F-ABCD', aerodrome: 'Isola', secret: 'x' },
    baseline: { pulse: 66.2, breathing: 12.1 },
    rows: [{ t0: 1, text: 'F-ABCD, negative, QNH 1013', kind: 'negative', pulseDelta: 9,
      readback: { transcript: 'what the pilot said', accepted: true }, guide: null }],
    video: 'nope',
  });
  const json = JSON.stringify(clean);
  assert.ok(!json.includes('what the pilot said'));
  assert.ok(!json.includes('secret'));
  assert.ok(!json.includes('nope'));
  assert.equal(clean.rows[0].accepted, true);
  const store = new SessionStore(tmp());
  assert.deepEqual(store.list(), []);
  store.save(clean);
  assert.equal(store.list().length, 1);
  assert.equal(store.deleteAll(), 1);
  assert.deepEqual(store.list(), []);
});

test('recordings are encoded as 16-bit mono WAV', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
  const buf = Buffer.from(encodeWav(samples, 16000));
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  assert.equal(buf.readUInt16LE(22), 1);
  assert.equal(buf.readUInt32LE(24), 16000);
  assert.equal(buf.readUInt16LE(34), 16);
  assert.equal(buf.readUInt32LE(40), 12);
  assert.equal(buf.readInt16LE(44 + 2 * 3), 0x7fff);
  assert.equal(buf.readInt16LE(44 + 2 * 4), -0x8000);
  assert.equal(buf.readInt16LE(44 + 2 * 5), 0x7fff, 'clipped');
  assert.equal(peak(samples), 2);
});
