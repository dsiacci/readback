'use strict';

// The simulated tower is phraseology, a separate open-source program
// (GPL-3.0-or-later) installed into tower/.venv by `npm run setup:tower`.
// Readback starts it on 127.0.0.1 and a free port, talks to its JSON API, and
// stops it when the app quits. Speech recognition and the tower's voice run
// inside that process, on this machine; with HF_HUB_OFFLINE it does not go
// online once the models are downloaded.

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const DEFAULT_SETTINGS = {
  callsign: 'F-ABCD',
  aerodrome: 'Isola',
  altimeter: 'QNH',
  model: 'small.en',
};

function pythonPath(env = process.env, platform = process.platform, root = ROOT) {
  if (env.READBACK_PYTHON) return env.READBACK_PYTHON;
  return platform === 'win32'
    ? path.join(root, 'tower', '.venv', 'Scripts', 'python.exe')
    : path.join(root, 'tower', '.venv', 'bin', 'python');
}

/** Checks a setting before it goes on the tower's command line. */
function cleanSettings(s = {}) {
  const out = { ...DEFAULT_SETTINGS };
  const cs = String(s.callsign || '').toUpperCase().trim();
  if (/^[FG]-[A-Z]{4}$/.test(cs)) out.callsign = cs;
  const ad = String(s.aerodrome || '').trim();
  if (/^[A-Za-z][A-Za-z '-]{1,23}$/.test(ad)) out.aerodrome = ad;
  if (['QNH', 'QFE'].includes(String(s.altimeter || '').toUpperCase())) out.altimeter = s.altimeter.toUpperCase();
  if (['small.en', 'base.en', 'tiny.en'].includes(s.model)) out.model = s.model;
  out.noSpeech = Boolean(s.noSpeech);
  return out;
}

function towerArgs(port, settings) {
  const s = cleanSettings(settings);
  const args = ['-m', 'phraseology', 'serve', '--host', '127.0.0.1', '--port', String(port),
    '--callsign', s.callsign, '--aerodrome', s.aerodrome, '--altimeter', s.altimeter, '--model', s.model];
  if (s.noSpeech) args.push('--no-speech');
  return args;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

class Tower {
  constructor({ env = process.env, log = () => {} } = {}) {
    this.env = env;
    this.log = log;
    this.proc = null;
    this.port = null;
    this.settings = null;
    this.starting = null;
  }

  installed() {
    return fs.existsSync(pythonPath(this.env));
  }

  get base() {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Starts the tower with these settings, or restarts it if they changed. */
  async start(settings) {
    const wanted = cleanSettings(settings);
    if (this.proc && JSON.stringify(wanted) === JSON.stringify(this.settings)) return this.config();
    if (this.starting) await this.starting.catch(() => {});
    await this.stop();
    this.starting = this._start(wanted);
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async _start(settings) {
    if (!this.installed()) {
      throw new Error('The tower is not installed yet. Run `npm run setup:tower` in the readback folder.');
    }
    this.port = await freePort();
    this.settings = settings;
    const env = { ...this.env, HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONUNBUFFERED: '1' };
    delete env.PRESAGE_API_KEY; // the tower has no use for it
    const proc = spawn(pythonPath(this.env), towerArgs(this.port, settings), { env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    let tail = '';
    const keep = (chunk) => {
      tail = (tail + chunk.toString()).slice(-2000);
    };
    proc.stdout.on('data', keep);
    proc.stderr.on('data', keep);
    const exited = new Promise((_, reject) => {
      proc.once('exit', (code) => {
        if (this.proc === proc) this.proc = null;
        reject(new Error(`The tower stopped (exit ${code}). Last output:\n${tail.trim()}`));
      });
    });
    exited.catch(() => {});
    // Loading Whisper and the voices can take a while on the first start.
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const ok = await Promise.race([this._health(), exited, sleep(500).then(() => false)]);
      if (ok) return this.config();
      await sleep(400);
    }
    await this.stop();
    throw new Error('The tower did not start within two minutes.');
  }

  async _health() {
    try {
      const r = await fetch(`${this.base}/healthz`);
      return r.ok;
    } catch {
      return false;
    }
  }

  async config() {
    return this.request('GET', '/api/config');
  }

  /**
   * One call to the tower's API. JSON in and out, except /api/turn (a WAV
   * recording goes in) and /api/audio (a WAV comes out, as an ArrayBuffer).
   */
  async request(method, apiPath, body) {
    if (!this.proc) throw new Error('The tower is not running.');
    if (!/^\/(api\/[a-z-]+(\/[A-Za-z0-9_-]+)?|healthz)(\?game=[A-Za-z0-9_-]+)?$/.test(apiPath)) {
      throw new Error('Unknown tower path.');
    }
    const init = { method };
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      init.body = body instanceof ArrayBuffer ? Buffer.from(body) : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
      init.headers = { 'Content-Type': 'audio/wav' };
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    const r = await fetch(this.base + apiPath, init);
    const type = r.headers.get('content-type') || '';
    if (type.startsWith('audio/')) {
      if (!r.ok) throw new Error(`Tower audio: HTTP ${r.status}`);
      return await r.arrayBuffer();
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Tower: HTTP ${r.status}`);
    return data;
  }

  async stop() {
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;
    await new Promise((resolve) => {
      const done = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* gone */ }
        resolve();
      }, 3000);
      proc.once('exit', () => {
        clearTimeout(done);
        resolve();
      });
      try { proc.kill('SIGTERM'); } catch { resolve(); }
    });
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { Tower, towerArgs, cleanSettings, pythonPath, DEFAULT_SETTINGS };
