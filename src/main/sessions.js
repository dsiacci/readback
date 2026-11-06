'use strict';

// Saved sessions: only when the user asks, only on this computer, deleted
// with one button. A saved session holds the calm-minute reference, the tower
// messages, whether each readback was accepted, and the climbs in pulse and
// breathing. No image, no video, no audio, no transcript of your voice.

const fs = require('fs');
const path = require('path');

const ROW_FIELDS = ['t0', 'speaker', 'text', 'kind', 'label', 'load', 'pulsePeak', 'pulseDelta', 'breathRate', 'breathDelta'];

function finite(x) {
  return Number.isFinite(x) ? x : null;
}

/** Keeps only what a saved session is allowed to hold. */
function sanitize(session) {
  const s = session || {};
  const b = s.baseline || {};
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    startedAt: String(s.startedAt || ''),
    settings: {
      callsign: String((s.settings && s.settings.callsign) || ''),
      aerodrome: String((s.settings && s.settings.aerodrome) || ''),
    },
    simulated: Boolean(s.simulated),
    baseline: {
      pulse: finite(b.pulse),
      breathing: finite(b.breathing),
    },
    rows: (Array.isArray(s.rows) ? s.rows : []).slice(0, 200).map((r) => {
      const out = {};
      for (const k of ROW_FIELDS) out[k] = typeof r[k] === 'string' ? r[k].slice(0, 300) : finite(r[k]);
      out.accepted = r.readback ? (r.readback.accepted === null ? null : Boolean(r.readback.accepted)) : null;
      out.guide = r.guide ? { skipped: Boolean(r.guide.skipped) } : null;
      return out;
    }),
  };
}

class SessionStore {
  constructor(dir) {
    this.dir = dir;
  }

  save(session) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const clean = sanitize(session);
    const name = `session-${clean.savedAt.replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(path.join(this.dir, name), JSON.stringify(clean, null, 1), { mode: 0o600 });
    return { name };
  }

  list() {
    let names = [];
    try {
      names = fs.readdirSync(this.dir).filter((n) => /^session-[\w-]+\.json$/.test(n)).sort();
    } catch {
      return [];
    }
    const out = [];
    for (const n of names) {
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(this.dir, n), 'utf8')));
      } catch {
        // a damaged file is skipped, not fatal
      }
    }
    return out;
  }

  /** Deletes every saved session. Returns how many files went. */
  deleteAll() {
    let n = 0;
    try {
      for (const name of fs.readdirSync(this.dir)) {
        if (/^session-[\w-]+\.json$/.test(name)) {
          fs.rmSync(path.join(this.dir, name));
          n++;
        }
      }
    } catch {
      return 0;
    }
    return n;
  }
}

module.exports = { SessionStore, sanitize };
