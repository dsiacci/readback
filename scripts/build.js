'use strict';

// Bundles the page script and the preload with esbuild.
// The page runs in a sandboxed renderer, so both must be single files.

const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');

Promise.all([
  esbuild.build({
    entryPoints: [path.join(root, 'src/renderer/app.js')],
    outfile: path.join(root, 'dist/renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
    logLevel: 'warning',
  }),
  esbuild.build({
    entryPoints: [path.join(root, 'src/preload/preload.js')],
    outfile: path.join(root, 'dist/preload.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    target: 'node22',
    logLevel: 'warning',
  }),
]).catch(() => process.exit(1));
