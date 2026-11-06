'use strict';

// Installs the simulated tower (phraseology) into tower/.venv and downloads
// its speech models once: Whisper small.en for speech recognition and two
// Piper voices. After this, the tower runs offline.
//
//   npm run setup:tower                 # Whisper small.en (default)
//   npm run setup:tower -- --model base.en   # lighter, for an older machine

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOWER = 'phraseology @ git+https://github.com/dsiacci/phraseology@01c90a9dd0bba6b9eb61d561636ad7242056bbaf';
const root = path.resolve(__dirname, '..');
const venv = path.join(root, 'tower', '.venv');
const win = process.platform === 'win32';
const venvPython = win ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');

const argv = process.argv.slice(2);
const modelArg = argv.indexOf('--model');
const model = modelArg >= 0 ? argv[modelArg + 1] : 'small.en';
if (!['small.en', 'base.en', 'tiny.en'].includes(model)) {
  console.error('--model is one of small.en, base.en, tiny.en');
  process.exit(2);
}

function run(cmd, args) {
  console.log(`\n$ ${[path.basename(cmd), ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, HF_HUB_DISABLE_TELEMETRY: '1' } });
  if (r.status !== 0) {
    console.error(`\nFailed: ${path.basename(cmd)} ${args.join(' ')}`);
    process.exit(r.status || 1);
  }
}

function version(cmd) {
  const r = spawnSync(cmd, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const [major, minor] = r.stdout.trim().split('.').map(Number);
  return { major, minor, text: r.stdout.trim() };
}

function findPython() {
  const candidates = [process.env.READBACK_BOOTSTRAP_PYTHON, 'python3.12', 'python3.13', 'python3.11', 'python3.10', 'python3', 'python']
    .filter(Boolean);
  for (const c of candidates) {
    const v = version(c);
    if (v && v.major === 3 && v.minor >= 10) return { cmd: c, v };
  }
  return null;
}

if (!fs.existsSync(venvPython)) {
  const py = findPython();
  if (!py) {
    console.error('Readback needs Python 3.10 or newer for the tower (3.12 recommended).');
    console.error('On a Mac: brew install python@3.12, then run this again.');
    process.exit(1);
  }
  console.log(`Using ${py.cmd} (Python ${py.v.text}) to create tower/.venv`);
  run(py.cmd, ['-m', 'venv', venv]);
}
run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
run(venvPython, ['-m', 'pip', 'install', TOWER]);
run(venvPython, ['-m', 'phraseology', 'download', '--models', model]);
console.log('\nThe tower is ready. Start Readback with: npm start');
