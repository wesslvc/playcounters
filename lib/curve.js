/**
 * An SVG path through points as one smooth curve (monotone cubic,
 * Fritsch–Carlson): round at every bend, but never overshooting a point —
 * a running total drawn this way never appears to dip, and a rank never
 * swings past where it actually finished.
 */
export function smoothPath(pts) {
  const n = pts.length;
  if (!n) return '';
  if (n === 1) return `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  const dx = [], slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    slope.push(dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0);
  }
  const m = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (!slope[i]) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i], b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * slope[i]; m[i + 1] = t * b * slope[i]; }
  }
  const f = (v) => v.toFixed(1);
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = dx[i] / 3;
    d += ` C${f(x0 + h)},${f(y0 + m[i] * h)} ${f(x1 - h)},${f(y1 - m[i + 1] * h)} ${f(x1)},${f(y1)}`;
  }
  return d;
}

/**
 * Every `step`-th index of a long series, always keeping the last — few
 * enough points that a curve through them reads as a shape rather than a
 * staircase of single days.
 */
export function sampleIdx(n, max = 72) {
  if (n <= max) return [...Array(n).keys()];
  const step = (n - 1) / (max - 1);
  const out = [];
  for (let k = 0; k < max; k++) out.push(Math.round(k * step));
  return [...new Set(out)];
}
