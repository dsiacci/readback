'use strict';

// Main process: one window, the Presage SDK's IPC binding, the tower, and a
// small IPC surface for the page. The camera and the microphone are refused
// until the person has said yes on the consent screen.

const path = require('path');
const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const { readKey } = require('./key');
const { Tower } = require('./tower');
const { SessionStore } = require('./sessions');

const ROOT = path.resolve(__dirname, '..', '..');

// The SDK ships its native runtime for macOS (Apple Silicon), Linux and
// Windows. Elsewhere, or if it fails to load, the app still opens with
// simulated signals so the rest can be tried.
let bindSmartSpectraIpc = null;
let sdkError = null;
try {
  ({ bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main'));
} catch (err) {
  sdkError = String((err && err.message) || err).split('\n')[0];
}

const tower = new Tower();
let sessions = null;
let consent = { camera: false, microphone: false };

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0d1117',
    title: 'Readback',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(ROOT, 'dist', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (bindSmartSpectraIpc) bindSmartSpectraIpc(win);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  if (process.env.READBACK_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
}

function mediaAllowed(details, url) {
  if (!url.startsWith('file://')) return false;
  const types = (details && details.mediaTypes) || [];
  if (!types.length) return false;
  return types.every((t) => (t === 'video' && consent.camera) || (t === 'audio' && consent.microphone));
}

ipcMain.handle('readback:status', () => {
  const k = readKey();
  return {
    platform: `${process.platform}-${process.arch}`,
    sdk: { available: Boolean(bindSmartSpectraIpc), error: sdkError },
    key: { found: Boolean(k.key), source: k.source, warning: k.warning },
    tower: { installed: tower.installed() },
    version: app.getVersion(),
  };
});

// The key goes to the page only when a measurement starts, for the SDK's
// configure message; it is never stored or logged by Readback.
ipcMain.handle('readback:presage-key', () => readKey().key);

ipcMain.handle('readback:consent', (_e, c) => {
  consent = { camera: Boolean(c && c.camera), microphone: Boolean(c && c.microphone) };
  return consent;
});

ipcMain.handle('readback:tower-start', async (_e, settings) => tower.start(settings));
ipcMain.handle('readback:tower', async (_e, method, apiPath, body) => {
  if (!['GET', 'POST'].includes(method)) throw new Error('Unsupported method.');
  return tower.request(method, apiPath, body);
});

ipcMain.handle('readback:sessions-save', (_e, s) => sessions.save(s));
ipcMain.handle('readback:sessions-list', () => sessions.list());
ipcMain.handle('readback:sessions-delete-all', () => sessions.deleteAll());

app.whenReady().then(() => {
  sessions = new SessionStore(path.join(app.getPath('userData'), 'sessions'));
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
    callback(permission === 'media' && mediaAllowed(details, url));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin, details) => {
    if (permission !== 'media') return false;
    const url = (details && details.requestingUrl) || origin || '';
    return url.startsWith('file://') && (consent.camera || consent.microphone);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  tower.stop();
});
