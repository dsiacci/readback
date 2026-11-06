'use strict';

// The page: consent, the calm minute, the circuit with the tower, the
// breathing guide, and the timeline after the session.

const { SignalStore } = require('../core/metrics');
const { calmBaseline, usable } = require('../core/baseline');
const { breathRateFromTrace, listeningStretch, guideAdvice, guidePhase } = require('../core/breath');
const { classify } = require('../core/messages');
const { buildTimeline, highlights } = require('../core/timeline');
const { playTransmission, Recorder, audio } = require('./audio');
const { PresageSource, SimulatedSource } = require('./signals');
const charts = require('./charts');

const $ = (id) => document.getElementById(id);
const CALM_MS = 60000;
const CALM_MAX_MS = 120000;
const GUIDE_GAP_MS = 60000;

const S = {
  status: null,
  view: 'consent',
  source: null,
  stream: null,
  mic: null,
  recorder: null,
  store: new SignalStore(),
  events: [],
  calmStart: null,
  calm: null,
  towerReady: null,
  towerConfig: null,
  game: null,
  sessionStart: null,
  turn: false,
  talking: null,
  guide: null,
  lastGuide: 0,
  breathPoints: [],
  finishing: false,
  timer: null,
  previewMode: 'blurred',
  settings: { showValues: false, rise: 4 },
};

// ------------------------------------------------------------------ helpers

function show(view) {
  for (const v of ['consent', 'calm', 'radio', 'timeline']) $(`view-${v}`).hidden = v !== view;
  S.view = view;
}

let toastTimer = null;
function toast(text, level = '') {
  const t = $('toast');
  t.textContent = text;
  t.className = `toast ${level}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, level === 'bad' ? 9000 : 4500);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function signed(x, digits = 0) {
  if (!Number.isFinite(x)) return '—';
  const v = Number(x.toFixed(digits));
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}`;
}

function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function node(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setCamera(on) {
  const c = $('cam-indicator');
  c.dataset.on = String(on);
  c.querySelector('span').textContent = on ? 'Camera on' : 'Camera off';
  $('btn-stop').hidden = !on && !S.source;
}

function nudge(e) {
  if (S.source && typeof S.source.nudge === 'function') S.source.nudge(e);
}

// ------------------------------------------------------------------ consent

async function init() {
  S.status = await window.readback.status();
  const st = S.status;
  const checks = $('setup-checks');
  const item = (level, html) => {
    const li = node('li', level);
    li.textContent = html;
    checks.appendChild(li);
  };
  if (st.sdk.available) item('ok', `Presage SmartSpectra SDK loaded (${st.platform}).`);
  else item('bad', `The Presage SDK cannot run here (${st.platform}). Simulated signals still work.`);
  if (st.key.found) item(st.key.warning ? 'warn' : 'ok', `Presage key found (${st.key.source === 'environment' ? 'PRESAGE_API_KEY' : '~/.config/readback/presage.key'}).${st.key.warning ? ' ' + st.key.warning : ''}`);
  else item('warn', 'No Presage key yet: put yours in ~/.config/readback/presage.key (see the README).');
  if (st.tower.installed) item('ok', 'The tower is installed.');
  else item('bad', 'The tower is not installed: run "npm run setup:tower" in the readback folder.');

  $('btn-camera').disabled = !(st.sdk.available && st.key.found && st.tower.installed);
  $('btn-simulated').disabled = !st.tower.installed;
  $('btn-camera').addEventListener('click', () => startSession('camera'));
  $('btn-simulated').addEventListener('click', () => startSession('simulated'));
  $('btn-stop').addEventListener('click', stopCamera);
  $('btn-circuit').addEventListener('click', startCircuit);
  $('btn-skip-calm').addEventListener('click', () => finishCalm(true));
  $('btn-end').addEventListener('click', () => finishCircuit());
  $('btn-say-again').addEventListener('click', sayAgain);
  $('type-form').addEventListener('submit', (e) => { e.preventDefault(); sendTyped(); });
  $('btn-save').addEventListener('click', saveSession);
  $('btn-new').addEventListener('click', () => { show('consent'); $('bar-mid').textContent = ''; });
  $('btn-delete').addEventListener('click', deleteSessions);
  $('guide-ready').addEventListener('click', () => endGuide(true));
  $('show-values').addEventListener('change', (e) => { S.settings.showValues = e.target.checked; });
  $('set-rise').addEventListener('change', (e) => { S.settings.rise = Number(e.target.value); });
  for (const b of document.querySelectorAll('.preview-modes button')) {
    b.addEventListener('click', () => setPreviewMode(b.dataset.mode));
  }
  setPreviewMode('blurred');

  const ptt = $('ptt');
  ptt.addEventListener('mousedown', pttDown);
  ptt.addEventListener('mouseup', pttUp);
  ptt.addEventListener('mouseleave', () => { if (S.talking) pttUp(); });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    if (S.guide) endGuide(true);
    else if (S.view === 'radio') pttDown();
  });
  document.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    if (S.talking) pttUp();
  });
}

function setPreviewMode(mode) {
  S.previewMode = mode;
  $('preview-frame').dataset.mode = mode;
  $('mini-frame').dataset.mode = mode;
  for (const b of document.querySelectorAll('.preview-modes button')) b.classList.toggle('on', b.dataset.mode === mode);
}

function towerSettings() {
  return {
    callsign: $('set-callsign').value,
    aerodrome: $('set-aerodrome').value,
    altimeter: $('set-altimeter').value,
    model: $('set-model').value,
  };
}

async function startSession(kind) {
  audio(); // unlock sound on this click
  const wantMic = $('use-mic').checked;
  await window.readback.consent({ camera: kind === 'camera', microphone: wantMic });
  S.recorder = null;
  if (wantMic) {
    try {
      S.mic = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      S.recorder = new Recorder(S.mic);
    } catch {
      toast('The microphone is not available: you can type your readbacks.', 'bad');
    }
  }
  S.store.clear();
  S.events = [];
  S.calm = null;
  S.calmStart = null;
  S.game = null;
  S.breathPoints = [];
  S.lastGuide = 0;
  S.sessionStart = null;
  $('btn-save').disabled = false;
  $('log').replaceChildren();
  $('sim-badge').hidden = kind !== 'simulated';
  $('btn-skip-calm').hidden = kind !== 'simulated';
  $('btn-circuit').disabled = true;
  $('preview-frame').dataset.sim = String(kind !== 'camera');
  $('mini-frame').hidden = kind !== 'camera';
  $('mask-text').textContent = kind === 'camera' ? 'Preview hidden' : 'No camera: simulated signals';
  $('validation').textContent = kind === 'camera' ? 'Starting the camera…' : 'Simulated signals: no camera is used.';
  $('tower-note').textContent = 'Warming up the tower (the speech model takes a few seconds to load)…';
  show('calm');
  startTower();

  const handlers = {
    onPayload: (decoded) => {
      const added = S.store.add(decoded);
      if (!S.calmStart && (added.pulse.length || added.chest.length)) S.calmStart = Date.now();
    },
    onStream: (stream) => {
      S.stream = stream;
      $('preview').srcObject = stream;
      $('preview-mini').srcObject = stream;
      setCamera(true);
    },
    onHint: (level, text) => {
      const v = $('validation');
      v.textContent = text;
      v.className = `hint ${level}`;
    },
    onStatus: (status) => {
      if (status === 'Error') toast('The measurement stopped with an error.', 'bad');
    },
    onError: (message) => toast(message, 'bad'),
  };
  S.source = kind === 'camera' ? new PresageSource(handlers) : new SimulatedSource(handlers);
  $('btn-stop').hidden = false;
  try {
    await S.source.start();
  } catch (err) {
    toast(String(err.message || err), 'bad');
    await stopCamera();
    show('consent');
    return;
  }
  clearInterval(S.timer);
  S.timer = setInterval(tick, 500);
}

function startTower() {
  S.towerConfig = null;
  S.towerReady = window.readback.tower.start(towerSettings()).then((cfg) => {
    S.towerConfig = cfg;
    $('tower-note').textContent = cfg.speech
      ? `The tower is ready (speech recognition: Whisper ${cfg.model}, on this computer).`
      : 'The tower is ready, without speech: type your transmissions.';
    updateCalmButton();
    return cfg;
  });
  S.towerReady.catch((err) => {
    $('tower-note').textContent = `The tower did not start: ${String(err.message || err).split('\n')[0]}`;
  });
}

async function stopCamera() {
  const src = S.source;
  S.source = null;
  if (src) await src.stop();
  if (S.stream) for (const t of S.stream.getTracks()) t.stop();
  S.stream = null;
  if (S.mic) for (const t of S.mic.getTracks()) t.stop();
  S.mic = null;
  S.recorder = null;
  $('preview').srcObject = null;
  $('preview-mini').srcObject = null;
  await window.readback.consent({ camera: false, microphone: false });
  setCamera(false);
  $('btn-stop').hidden = true;
  if (S.view === 'radio' && !S.finishing) finishCircuit(true);
  else if (S.view === 'calm') { clearInterval(S.timer); show('consent'); }
}

// ------------------------------------------------------------------ calm minute

function updateCalmButton() {
  $('btn-circuit').disabled = !(S.calm && S.towerConfig);
}

function finishCalm(skipped = false) {
  if (S.calm || !S.calmStart) return;
  const t1 = Date.now();
  const baseline = calmBaseline(S.store.toJSON(), S.calmStart, t1);
  S.calm = { t0: S.calmStart, t1, baseline, skipped };
  S.events.push({ type: 'calm', t0: S.calmStart, t1 });
  const b = baseline;
  $('calm-note').textContent = b.ready
    ? 'Your reference for this session is set. Everything from here is compared with it, and only with it.'
    : 'No steady pulse came through: the circuit works, but without the comparison. Check the light and the framing next time.';
  updateCalmButton();
}

function tickCalm(now) {
  if (!S.calmStart) return;
  const elapsed = now - S.calmStart;
  const left = Math.max(0, CALM_MS - elapsed);
  $('calm-seconds').textContent = String(Math.ceil(left / 1000));
  $('ring').style.strokeDashoffset = String(326.7 * (1 - Math.min(1, elapsed / CALM_MS)));
  const p = S.store.latest('pulse');
  const chest = S.store.window('chest', now - 30000, now);
  const br = breathRateFromTrace(chest, { minSpanMs: 15000 });
  const show = S.settings.showValues || $('show-values').checked;
  const reading = (id, value, unit) => {
    const b = $(id);
    b.textContent = value === null ? '…' : show ? String(Math.round(value)) : '✓';
    b.classList.toggle('found', value !== null && !show);
    $(`${id}-unit`).textContent = value === null ? 'waiting' : show ? unit : 'found';
  };
  reading('calm-pulse', p && usable(p) ? p.value : null, 'bpm');
  reading('calm-breath', br ? br.rate : null, 'per min');
  if (S.calm) return;
  if (elapsed >= CALM_MS) {
    const b = calmBaseline(S.store.toJSON(), S.calmStart, now);
    if (b.ready || elapsed >= CALM_MAX_MS) finishCalm();
    else $('calm-note').textContent = 'Still settling: stay still, face the camera, keep your upper chest in view.';
  }
}

// ------------------------------------------------------------------ the circuit

async function startCircuit() {
  show('radio');
  S.sessionStart = Date.now();
  const cfg = await S.towerReady;
  $('bar-mid').textContent = `${cfg.aerodrome} (${cfg.icao}) · ${cfg.callsign}`;
  setState('tower', 'The tower is setting up the circuit…');
  try {
    const game = { surprises: true };
    if (S.status && S.status.seed !== null && S.status.seed !== undefined) game.seed = S.status.seed;
    const body = await window.readback.tower.post('/api/game', game);
    S.game = body.game;
    await handleTower(body);
  } catch (err) {
    toast(String(err.message || err), 'bad');
  }
}

function setState(state, text) {
  const e = $('you-state');
  e.dataset.state = state;
  e.textContent = text;
}

function setTurn(on) {
  S.turn = on;
  const ptt = $('ptt');
  ptt.disabled = !on || !S.recorder;
  ptt.classList.toggle('ready', on && Boolean(S.recorder));
  $('ptt-label').textContent = S.recorder ? 'Hold to talk' : 'Microphone off';
  $('type-input').disabled = !on;
  $('btn-say-again').disabled = !on;
  if (on) setState('turn', S.recorder ? 'Your turn: hold Space to talk' : 'Your turn: type your transmission');
}

function updateComms(body) {
  const cfg = S.towerConfig || {};
  if (body.station) $('station').textContent = `${(cfg.aerodrome || '').toUpperCase()} ${body.station.toUpperCase()}`;
  if (body.frequency) $('freq').textContent = body.frequency;
  if (body.steps) $('step').textContent = `${body.step}/${body.steps}`;
  $('task').textContent = body.done ? 'Circuit complete.' : body.hint || '';
}

function logTower(t, c) {
  const li = node('li', `msg tower ${t.toPilot === false ? 'traffic' : ''}`);
  li.appendChild(node('div', 'who', t.speaker === 'traffic' ? 'Traffic' : t.speaker));
  const body = node('div', 'body');
  body.appendChild(node('div', 'text', t.text));
  if (t.toPilot !== false && ['negative', 'change', 'readback'].includes(c.kind)) {
    const meta = node('div', 'meta');
    meta.appendChild(node('span', `chip kind-${c.kind}`, c.label));
    body.appendChild(meta);
  }
  li.appendChild(body);
  $('log').appendChild(li);
  li.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

function logPilot(body, typed) {
  const li = node('li', 'msg pilot');
  li.appendChild(node('div', 'who', 'You'));
  const b = node('div', 'body');
  b.appendChild(node('div', 'text', body.transcript || '(nothing understood)'));
  const meta = node('div', 'meta');
  if (body.sayAgain) meta.appendChild(node('span', 'chip', 'Say again'));
  else meta.appendChild(node('span', `chip ${body.accepted ? 'ok' : 'bad'}`, body.accepted ? 'Accepted' : 'Not accepted'));
  if (typed) meta.appendChild(node('span', 'chip', 'Typed'));
  b.appendChild(meta);
  if (body.findings && body.findings.length) {
    const ul = node('ul', 'findings');
    for (const f of body.findings) ul.appendChild(node('li', '', f.text));
    b.appendChild(ul);
  }
  if (!body.accepted && body.example) b.appendChild(node('div', 'meta', `Standard form: ${body.example}`));
  li.appendChild(b);
  $('log').appendChild(li);
  li.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

/** Plays the tower's transmissions, records when each one was said, then hands over. */
async function handleTower(body) {
  setTurn(false);
  setState('tower', 'The tower is talking');
  for (const t of body.transmissions || []) {
    const c = classify(t);
    logTower(t, c);
    let times = null;
    if (t.audio) {
      try {
        times = await playTransmission(await window.readback.tower.get(t.audio));
      } catch {
        times = null;
      }
    }
    if (!times) {
      const t0 = Date.now();
      await sleep(Math.min(6000, 600 + 60 * t.text.length));
      times = { t0, t1: Date.now() };
    }
    S.events.push({ type: 'tower', ...times, speaker: t.speaker, text: t.text, toPilot: t.toPilot, kind: c.kind, load: c.load, step: body.step });
    if (t.toPilot !== false) nudge({ type: 'tower', kind: c.kind, load: c.load });
  }
  updateComms(body);
  if (body.done) {
    await sleep(1500);
    finishCircuit();
    return;
  }
  await maybeGuide();
  if (S.view === 'radio') setTurn(true);
}

// ------------------------------------------------------------------ breathing guide

function listeningRate(now = Date.now()) {
  const talks = S.events.filter((e) => e.type === 'talk' && !e.typed);
  const live = S.talking ? [...talks, { t0: S.talking.t0, t1: null }] : talks;
  const stretch = listeningStretch(S.store.series.chest, live, now);
  const r = breathRateFromTrace(stretch, { minSpanMs: 6000 });
  return r ? r.rate : null;
}

async function maybeGuide() {
  const base = S.calm && S.calm.baseline ? S.calm.baseline.traceBreathing : null;
  if (!Number.isFinite(base) || Date.now() - S.lastGuide < GUIDE_GAP_MS) return;
  const advice = guideAdvice(listeningRate(), base, { rise: S.settings.rise });
  if (!advice.offer) return;
  await runGuide();
}

function runGuide() {
  return new Promise((resolve) => {
    const ev = { type: 'guide', t0: Date.now(), t1: null, skipped: false };
    S.guide = { ev, resolve, raf: null };
    $('guide').hidden = false;
    setState('turn', 'Breathing guide: the tower is waiting');
    nudge({ type: 'guide-start' });
    const orb = $('orb');
    const label = $('orb-label');
    const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
    const frame = () => {
      if (!S.guide) return;
      const now = Date.now();
      const g = guidePhase(now - ev.t0);
      if (g.phase === 'done') { endGuide(false); return; }
      const s = g.phase === 'in' ? 1 + 0.9 * ease(g.progress) : 1.9 - 0.9 * ease(g.progress);
      orb.style.transform = `scale(${s.toFixed(3)})`;
      label.textContent = g.phase === 'in' ? 'Breathe in' : 'Breathe out';
      charts.trace($('guide-trace'), S.store.series.chest, { now, spanMs: 20000 });
      S.guide.raf = requestAnimationFrame(frame);
    };
    frame();
  });
}

function endGuide(skipped) {
  const g = S.guide;
  if (!g) return;
  S.guide = null;
  cancelAnimationFrame(g.raf);
  g.ev.t1 = Date.now();
  g.ev.skipped = skipped;
  S.events.push(g.ev);
  S.lastGuide = g.ev.t1;
  nudge({ type: 'guide-end' });
  $('guide').hidden = true;
  g.resolve();
}

// ------------------------------------------------------------------ talking

let maxTimer = null;

function pttDown() {
  if (!S.turn || S.talking || !S.recorder) return;
  try {
    S.recorder.start();
  } catch (err) {
    toast(`The microphone did not start: ${err.message}`, 'bad');
    return;
  }
  S.talking = { type: 'talk', t0: Date.now(), t1: null };
  nudge({ type: 'talk-start' });
  $('ptt').classList.add('talking');
  $('ptt-label').textContent = 'Talking… release to send';
  setState('talking', 'Talking: breathing paused');
  maxTimer = setTimeout(() => {
    toast('Transmissions are limited to 10 seconds.');
    pttUp();
  }, 9800);
}

async function pttUp() {
  if (!S.talking) return;
  clearTimeout(maxTimer);
  const talk = S.talking;
  S.talking = null;
  talk.t1 = Date.now();
  nudge({ type: 'talk-end' });
  $('ptt').classList.remove('talking');
  setTurn(false);
  setState('tower', 'The tower is listening to your readback…');
  let rec = null;
  try {
    rec = await S.recorder.stop();
  } catch {
    rec = null;
  }
  if (!rec || rec.seconds < 0.3 || rec.level < 0.02) {
    toast('Nothing heard. Hold the key while you speak, release when you are done.');
    setTurn(true);
    return;
  }
  S.events.push(talk);
  try {
    const body = await window.readback.tower.post(`/api/turn?game=${S.game}`, rec.wav);
    Object.assign(talk, { transcript: body.transcript, accepted: body.accepted, sayAgain: body.sayAgain });
    logPilot(body, false);
    await handleTower(body);
  } catch (err) {
    S.events.splice(S.events.indexOf(talk), 1);
    toast(String(err.message || err), 'bad');
    setTurn(true);
  }
}

async function sendTyped() {
  const input = $('type-input');
  const text = input.value.trim();
  if (!S.turn || !text) return;
  input.value = '';
  setTurn(false);
  const now = Date.now();
  const talk = { type: 'talk', t0: now, t1: now, typed: true };
  S.events.push(talk);
  try {
    const body = await window.readback.tower.post('/api/text', { game: S.game, text });
    Object.assign(talk, { transcript: body.transcript, accepted: body.accepted, sayAgain: body.sayAgain });
    logPilot(body, true);
    await handleTower(body);
  } catch (err) {
    toast(String(err.message || err), 'bad');
    setTurn(true);
  }
}

async function sayAgain() {
  if (!S.turn) return;
  setTurn(false);
  try {
    await handleTower(await window.readback.tower.post('/api/say-again', { game: S.game }));
  } catch (err) {
    toast(String(err.message || err), 'bad');
    setTurn(true);
  }
}

// ------------------------------------------------------------------ live display

function tickRadio(now) {
  const base = S.calm ? S.calm.baseline : null;
  const showValues = S.settings.showValues;
  const p = S.store.latest('pulse');
  const bp = base && base.pulse ? base.pulse.value : null;
  if (p && usable(p)) {
    $('pulse-val').textContent = showValues || bp === null ? String(Math.round(p.value)) : signed(p.value - bp);
  }
  $('pulse-sub').textContent = showValues || bp === null ? 'beats per minute' : 'bpm, compared with your calm minute';
  const pulsePts = S.store.window('pulse', now - 120000, now).filter((s) => usable(s))
    .map((s) => ({ t: s.t, y: bp === null ? 0 : s.value - bp }));
  charts.sparkline($('pulse-spark'), pulsePts, { now, minRange: 12 });

  const bb = base ? base.traceBreathing : null;
  const bv = $('breath-val');
  if (S.talking) {
    bv.textContent = 'paused';
    bv.classList.add('paused');
    S.breathPoints.push(null);
  } else {
    const rate = listeningRate(now);
    bv.classList.toggle('paused', rate === null);
    if (rate === null) bv.textContent = '…';
    else bv.textContent = showValues || !Number.isFinite(bb) ? String(Math.round(rate)) : signed(rate - bb);
    S.breathPoints.push(rate === null ? null : { t: now, y: Number.isFinite(bb) ? rate - bb : 0 });
  }
  if (S.breathPoints.length > 600) S.breathPoints.splice(0, S.breathPoints.length - 600);
  charts.sparkline($('breath-spark'), S.breathPoints, { now, minRange: 8 });
}

function tick() {
  const now = Date.now();
  if (S.view === 'calm') tickCalm(now);
  if (S.view === 'radio') tickRadio(now);
}

// ------------------------------------------------------------------ after the session

async function finishCircuit(cameraAlreadyOff = false) {
  if (S.view !== 'radio' || S.finishing) return;
  S.finishing = true;
  if (S.guide) endGuide(true);
  if (S.talking) { clearTimeout(maxTimer); S.talking = null; try { await S.recorder.stop(); } catch { /* dropped */ } }
  setTurn(false);
  clearInterval(S.timer);
  S.timer = null;
  if (!cameraAlreadyOff) await stopCamera();
  show('timeline');
  S.finishing = false;
  await renderTimeline();
}

function currentRows() {
  return buildTimeline(S.events, S.store.toJSON(), S.calm ? S.calm.baseline : null);
}

async function renderTimeline() {
  const base = S.calm ? S.calm.baseline : null;
  const rows = currentRows();
  const top = highlights(rows);
  const t0 = S.sessionStart || (rows[0] && rows[0].t0) || Date.now();
  const sv = S.settings.showValues;
  $('tl-reference').textContent = base && base.pulse
    ? (sv
      ? `Your calm minute: ${Math.round(base.pulse.value)} bpm${Number.isFinite(base.traceBreathing) ? `, ${Math.round(base.traceBreathing)} breaths per minute` : ''}. A climb counts from the moment a message started; "vs calm" compares with that minute.`
      : 'A climb counts from the moment a message started. "vs calm" compares with your own calm minute at the start of this session, and with nothing else.')
    : 'No calm-minute reference this time, so there is nothing to compare with.';

  const hl = $('highlights');
  hl.replaceChildren();
  if (!top.length) {
    hl.appendChild(node('div', 'card hl empty', 'No message stood out: your pulse did not climb by more than 2 bpm after any of them.'));
  }
  for (const r of top) {
    const c = node('div', 'card hl');
    const num = node('div', 'num', signed(r.pulseRise));
    num.appendChild(node('small', '', 'bpm after this message'));
    c.appendChild(num);
    if (r.pulseDelta !== null) c.appendChild(node('div', 'sub', `${signed(r.pulseDelta)} bpm against your calm minute at its highest`));
    c.appendChild(node('div', 'text', r.text));
    const meta = node('div', 'meta');
    meta.appendChild(node('span', `chip kind-${r.kind}`, r.label));
    if (r.readback) meta.appendChild(node('span', `chip ${r.readback.accepted ? 'ok' : 'bad'}`, r.readback.accepted ? 'Read back' : 'Readback not accepted'));
    if (r.guide) meta.appendChild(node('span', 'chip', r.guide.skipped ? 'Guide skipped' : 'Breathing guide'));
    c.appendChild(meta);
    hl.appendChild(c);
  }

  const lastT = Math.max(t0 + 60000, ...S.events.map((e) => e.t1 || e.t0)) + 15000;
  const series = S.store.toJSON();
  charts.timelineChart($('tl-chart'), {
    events: S.events.filter((e) => e.t0 >= t0),
    pulse: series.pulse.filter((s) => s.t >= t0 && s.t <= lastT && usable(s)),
    basePulse: base && base.pulse ? base.pulse.value : 0,
    t0,
    t1: lastT,
  });

  const list = $('tl-rows');
  list.replaceChildren();
  const topSet = new Set(top);
  for (const r of rows) {
    const li = node('li', `row ${topSet.has(r) ? 'top' : ''}`);
    li.appendChild(node('div', 'time', clock(r.t0 - t0)));
    const mid = node('div');
    mid.appendChild(node('div', 'text', r.text));
    mid.appendChild(node('div', 'rb', r.readback
      ? `You: ${r.readback.transcript || '(typed or not understood)'} · ${r.readback.accepted ? 'accepted' : 'not accepted'}`
      : 'No readback'));
    li.appendChild(mid);
    const p = node('div', 'v p', r.pulseRise === null ? '—' : signed(r.pulseRise));
    p.appendChild(node('small', '', r.pulseDelta === null ? 'pulse climb' : `climb · ${signed(r.pulseDelta)} vs calm`));
    li.appendChild(p);
    const b = node('div', 'v b', r.breathDelta === null ? '—' : signed(r.breathDelta));
    b.appendChild(node('small', '', 'breathing vs calm'));
    li.appendChild(b);
    list.appendChild(li);
  }
  await renderHistory();
}

function summarize(rows) {
  const climbs = rows.filter((r) => Number.isFinite(r.pulseRise));
  const max = climbs.reduce((m, r) => (!m || r.pulseRise > m.pulseRise ? r : m), null);
  const answered = rows.filter((r) => r.accepted !== undefined ? r.accepted !== null : r.readback);
  const accepted = rows.filter((r) => (r.accepted !== undefined ? r.accepted === true : r.readback && r.readback.accepted));
  return {
    max: max ? max.pulseRise : null,
    maxLabel: max ? max.label : '',
    accepted: `${accepted.length}/${answered.length}`,
    guides: rows.filter((r) => r.guide).length,
  };
}

async function renderHistory() {
  const past = await window.readback.sessions.list();
  const h = $('history');
  h.replaceChildren();
  if (!past.length) return;
  h.appendChild(node('h2', '', 'Your saved sessions'));
  const table = node('table');
  const head = node('tr');
  for (const t of ['Date', 'Biggest climb in pulse', 'Readbacks accepted', 'Breathing guides']) head.appendChild(node('th', '', t));
  table.appendChild(head);
  for (const s of past.slice(-8)) {
    const sum = summarize(s.rows || []);
    const tr = node('tr');
    tr.appendChild(node('td', '', `${new Date(s.savedAt).toLocaleString()}${s.simulated ? ' (simulated)' : ''}`));
    tr.appendChild(node('td', '', sum.max === null ? '—' : `${signed(sum.max)} bpm · ${sum.maxLabel}`));
    tr.appendChild(node('td', '', sum.accepted));
    tr.appendChild(node('td', '', String(sum.guides)));
    table.appendChild(tr);
  }
  h.appendChild(table);
}

async function saveSession() {
  const base = S.calm ? S.calm.baseline : null;
  await window.readback.sessions.save({
    startedAt: new Date(S.sessionStart || Date.now()).toISOString(),
    settings: towerSettings(),
    simulated: $('sim-badge').hidden === false,
    baseline: { pulse: base && base.pulse ? base.pulse.value : null, breathing: base ? base.traceBreathing : null },
    rows: currentRows(),
  });
  toast('Saved on this computer: the climbs and the tower messages, no transcript, no image, no sound.');
  $('btn-save').disabled = true;
  await renderHistory();
}

async function deleteSessions() {
  if (!window.confirm('Delete every saved session from this computer?')) return;
  const n = await window.readback.sessions.deleteAll();
  toast(n ? `Deleted ${n} saved session${n > 1 ? 's' : ''}.` : 'There was nothing saved.');
  await renderHistory();
}

window.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => toast(String(err.message || err), 'bad'));
});
