'use strict';

// Small SVG drawings: the live sparklines and the timeline after the session.
// Built with DOM calls (no inline styles), so the page's strict CSP holds.

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
}

function clear(svg) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function pathFrom(points, sx, sy) {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (p === null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/**
 * A sparkline of values over the last `spanMs`, with the zero line (your calm
 * minute) dashed. `points` are {t, y}; null breaks the line (e.g. talking).
 */
function sparkline(svg, points, { spanMs = 120000, now = Date.now(), minRange = 10 } = {}) {
  clear(svg);
  const [, , W, H] = svg.getAttribute('viewBox').split(' ').map(Number);
  const vis = points.filter((p) => p === null || p.t >= now - spanMs);
  const ys = vis.filter(Boolean).map((p) => p.y);
  const lo = Math.min(0, ...ys, -minRange / 2);
  const hi = Math.max(0, ...ys, minRange / 2);
  const sx = (t) => ((t - (now - spanMs)) / spanMs) * W;
  const sy = (y) => H - 4 - ((y - lo) / (hi - lo || 1)) * (H - 8);
  el('line', { class: 'zero', x1: 0, x2: W, y1: sy(0), y2: sy(0) }, svg);
  const d = pathFrom(vis.map((p) => (p ? { x: p.t, y: p.y } : null)), sx, sy);
  if (d) el('path', { class: 'line', d }, svg);
}

/** A raw trace (the chest movement) scaled to fit, newest on the right. */
function trace(svg, points, { spanMs = 20000, now = Date.now() } = {}) {
  clear(svg);
  const [, , W, H] = svg.getAttribute('viewBox').split(' ').map(Number);
  const vis = points.filter((p) => p.t >= now - spanMs);
  if (vis.length < 2) return;
  const ys = vis.map((p) => p.value);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const sx = (t) => ((t - (now - spanMs)) / spanMs) * W;
  const sy = (y) => H - 4 - ((y - lo) / (hi - lo || 1)) * (H - 8);
  el('path', { class: 'line', d: pathFrom(vis.map((p) => ({ x: p.t, y: p.value })), sx, sy) }, svg);
}

const KIND_COLOR = {
  negative: '#ffb547',
  change: '#ffb547',
  readback: '#ffb547',
  clearance: '#c89443',
  instruction: '#a07a3e',
  information: '#7d6640',
};

/**
 * The session: pulse minus the calm minute over time, with the tower's
 * messages, your transmissions and the breathing guide as bands.
 */
function timelineChart(svg, { events, pulse, basePulse, t0, t1 }) {
  clear(svg);
  const W = 1000;
  const H = 240;
  const top = 34;
  const bottom = H - 22;
  const span = Math.max(1, t1 - t0);
  const sx = (t) => ((t - t0) / span) * W;
  const deltas = pulse.map((s) => s.value - basePulse);
  const lo = Math.min(-5, ...deltas);
  const hi = Math.max(10, ...deltas);
  const sy = (y) => bottom - ((y - lo) / (hi - lo)) * (bottom - top);

  for (let m = 0; m <= span / 60000; m++) {
    const x = sx(t0 + m * 60000);
    el('line', { class: 'grid', x1: x, x2: x, y1: top - 6, y2: bottom }, svg);
    const label = el('text', { class: 'axis', x: x + 4, y: H - 6 }, svg);
    label.textContent = `${m} min`;
  }
  for (const e of events) {
    const x = sx(e.t0);
    const w = Math.max(2, sx(e.t1 || e.t0) - x);
    if (e.type === 'tower' && e.toPilot !== false) {
      el('rect', { x, y: 4, width: w, height: 10, rx: 2, fill: KIND_COLOR[e.kind] || '#7d6640' }, svg);
    } else if (e.type === 'talk') {
      el('rect', { x, y: 18, width: w, height: 10, rx: 2, fill: '#8ab4ff' }, svg);
    } else if (e.type === 'guide') {
      el('rect', { x, y: top, width: w, height: bottom - top, fill: '#4fd1c5', opacity: 0.08 }, svg);
    }
  }
  el('line', { class: 'zero', x1: 0, x2: W, y1: sy(0), y2: sy(0) }, svg);
  const d = pathFrom(pulse.map((s) => ({ x: s.t, y: s.value - basePulse })), sx, sy);
  if (d) el('path', { class: 'pulse', d }, svg);
  for (const y of [0, 10, 20].filter((v) => v <= hi)) {
    const label = el('text', { class: 'axis', x: 4, y: sy(y) - 4 }, svg);
    label.textContent = y === 0 ? 'calm' : `+${y}`;
  }
}

module.exports = { sparkline, trace, timelineChart };
