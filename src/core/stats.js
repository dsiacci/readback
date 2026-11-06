'use strict';

function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Median absolute deviation: a spread that a few odd samples don't move. */
function mad(values) {
  const m = median(values);
  return median(values.map((x) => Math.abs(x - m)));
}

function mean(values) {
  const v = values.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

function round(x, digits = 0) {
  if (!Number.isFinite(x)) return null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

module.exports = { median, mad, mean, round };
