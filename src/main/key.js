'use strict';

// The Presage API key: read from the environment or from a file in the
// user's home, never written by the app, never logged, never in the
// repository. The key only authenticates the SDK's session with Presage.

const fs = require('fs');
const os = require('os');
const path = require('path');

function keyFile(home = os.homedir()) {
  return path.join(home, '.config', 'readback', 'presage.key');
}

/**
 * @returns {{key: string|null, source: 'environment'|'file'|null, warning: string|null}}
 *   `source` and `warning` are safe to show; `key` never leaves the app's processes.
 */
function readKey({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const fromEnv = (env.PRESAGE_API_KEY || '').trim();
  if (fromEnv) return { key: fromEnv, source: 'environment', warning: null };
  const file = keyFile(home);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { key: null, source: null, warning: null };
  }
  const key = text.split(/\r?\n/)[0].trim();
  if (!key) return { key: null, source: null, warning: 'The key file is empty.' };
  let warning = null;
  if (platform !== 'win32') {
    const mode = fs.statSync(file).mode & 0o777;
    if (mode & 0o077) warning = 'The key file can be read by other users on this computer: run chmod 600 on it.';
  }
  return { key, source: 'file', warning };
}

module.exports = { readKey, keyFile };
