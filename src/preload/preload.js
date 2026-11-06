'use strict';

// Bundled by esbuild into dist/preload.js (the window runs sandboxed, so the
// preload must be a single file). It carries the Presage SDK's own bridge for
// the camera frames, and a small `readback` API for the rest.

require('@smartspectra/node-sdk/preload');

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('readback', {
  status: () => ipcRenderer.invoke('readback:status'),
  presageKey: () => ipcRenderer.invoke('readback:presage-key'),
  consent: (c) => ipcRenderer.invoke('readback:consent', c),
  tower: {
    start: (settings) => ipcRenderer.invoke('readback:tower-start', settings),
    get: (p) => ipcRenderer.invoke('readback:tower', 'GET', p),
    post: (p, body) => ipcRenderer.invoke('readback:tower', 'POST', p, body),
  },
  sessions: {
    save: (s) => ipcRenderer.invoke('readback:sessions-save', s),
    list: () => ipcRenderer.invoke('readback:sessions-list'),
    deleteAll: () => ipcRenderer.invoke('readback:sessions-delete-all'),
  },
});
