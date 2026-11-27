/**
 * The 필름곳간 frame, drawn on a canvas. Always black: the members' marks are
 * glowing line drawings made for a dark ground.
 *
 * Tight margins around the photo and one bar under it. On the left, who shot
 * it and who edited it, each with their mark, big enough to read at a
 * glance; on the shooter's own edit the two are one ("SHOT · EDITED BY").
 * On the right, the camera: its maker as a wordmark and the model under it,
 * and, on the shooter's own edit only, the settings.
 *
 * The canvas follows the photo instead of padding it out to a fixed shape:
 * as wide as Instagram allows (2160 px, twice 1080), as tall as the photo
 * needs, held between Instagram's 1.91:1 and 4:5 so nothing gets cropped.
 * Every slide of a post comes out the same size, since a carousel takes its
 * shape from the first.
 */

export const W = 2160;
const U = W / 100;
const FONT = '"Pretendard Variable", Pretendard, -apple-system, "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SERIF = 'Georgia, "Times New Roman", Times, serif';
const C = { bg: '#000000', ink: '#F3F1EC', soft: '#8F8B84', line: '#34312E' };

/** The canvas size for a photo of this shape, and where the photo goes. */
export function layout(img) {
  const m = Math.round(W * 0.028); // margin around the photo
  const bar = Math.round(W * 0.12);
  const aspect = img.naturalHeight / img.naturalWidth;
  let pw = W - m * 2;
  let ph = pw * aspect;
  let h = m + ph + bar;
  const maxH = Math.round(W * 1.25);
  const minH = Math.round(W / 1.91);
  if (h > maxH) { // a tall photo: shrink it to fit, centred
    ph = maxH - m - bar;
    pw = ph / aspect;
    h = maxH;
  }
  h = Math.max(minH, Math.round(h));
  const px = (W - pw) / 2;
  const py = m + (h - m - bar - ph) / 2;
  return { w: W, h, m, bar, photo: { x: px, y: py, w: pw, h: ph } };
}

// fonts swap "1x0" for "1×0" (a contextual alternate meant for sizes); a zero-width
// non-joiner after each letter keeps names and models exactly as typed
const asTyped = (s) => (s || '').replace(/x/gi, (c) => `\u200C${c}\u200C`);

// and large text gets the font's optional features switched on; keep them off
function plain(ctx) {
  if ('textRendering' in ctx) ctx.textRendering = 'optimizeSpeed';
  if ('fontVariantLigatures' in ctx) ctx.fontVariantLigatures = 'none';
}

function text(ctx, s, x, y, { size, weight = 500, color = C.ink, align = 'left', font = FONT, track = 0, style = '' }) {
  s = asTyped(s);
  plain(ctx);
  ctx.font = `${style} ${weight} ${Math.round(size)}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${track}px`;
  ctx.fillText(s || '', x, y);
  const width = ctx.measureText(s || '').width;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  return width;
}

function measure(ctx, s, o) {
  s = asTyped(s);
  plain(ctx);
  ctx.font = `${o.style ?? ''} ${o.weight ?? 500} ${Math.round(o.size)}px ${o.font ?? FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${o.track ?? 0}px`;
  const w = ctx.measureText(s || '').width;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  return w;
}

/** The longest start of `s` that fits in `max`, with an ellipsis when cut. */
function fit(ctx, s, max, o) {
  if (!s || measure(ctx, s, o) <= max) return s;
  let t = s;
  while (t.length > 1 && measure(ctx, `${t}…`, o) > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** A member's mark, whole, inside a square (no circle: the marks are long and low). */
function mark(ctx, logo, name, x, cy, s) {
  if (logo) {
    const k = Math.min(s / logo.naturalWidth, s / logo.naturalHeight);
    const w = logo.naturalWidth * k;
    const h = logo.naturalHeight * k;
    ctx.drawImage(logo, x + (s - w) / 2, cy - h / 2, w, h);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + s / 2, cy, s * 0.4, 0, Math.PI * 2);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = s * 0.03;
  ctx.stroke();
  ctx.restore();
  text(ctx, (name || '?').slice(0, 1).toUpperCase(), x + s / 2, cy + s * 0.02, { size: s * 0.38, weight: 700, align: 'center' });
}

/** One credit: the mark, then a small label over the name. Returns its width. */
function credit(ctx, x, cy, label, name, logo, scale = 1) {
  const s = U * 5.2 * scale;
  mark(ctx, logo, name, x, cy, s);
  const tx = x + s + U * 1.0 * scale;
  const lo = { size: U * 0.82 * scale, weight: 700, color: C.soft, track: U * 0.24 * scale };
  const no = { size: U * 1.9 * scale, weight: 700 };
  const lw = text(ctx, label, tx, cy - U * 1.05 * scale, lo);
  const nw = text(ctx, name, tx, cy + U * 0.85 * scale, no);
  return s + U * 1.0 * scale + Math.max(lw, nw);
}

/** Who shot it and who edited it, from x. Returns where the credits end. */
function credits(ctx, x, cy, info, logos, scale = 1) {
  if (info.own) return x + credit(ctx, x, cy, 'SHOT · EDITED BY', info.shooter, logos.shooter, scale);
  const a = credit(ctx, x, cy, 'SHOT BY', info.shooter, logos.shooter, scale);
  const div = x + a + U * 2.2 * scale;
  ctx.fillStyle = C.line;
  ctx.fillRect(div, cy - U * 2.3 * scale, Math.max(2, U * 0.09), U * 4.6 * scale);
  const b = credit(ctx, div + U * 2.2 * scale, cy, 'EDITED BY', info.editor, logos.editor, scale);
  return div + U * 2.2 * scale + b;
}

/**
 * The camera maker as a wordmark: its name set the way the maker sets it
 * (case, weight, slant, spacing), in plain type rather than the maker's artwork.
 */
const MAKERS = [
  [/fuji/i, 'FUJIFILM', { weight: 800, track: 0.02 }],
  [/canon/i, 'Canon', { weight: 700, style: 'italic', font: SERIF }],
  [/nikon/i, 'Nikon', { weight: 800, style: 'italic' }],
  [/sony/i, 'SONY', { weight: 700, font: SERIF, track: 0.16 }],
  [/leica/i, 'Leica', { weight: 600, style: 'italic', font: SERIF }],
  [/hasselblad/i, 'HASSELBLAD', { weight: 600, track: 0.2 }],
  [/om digital|om system/i, 'OM SYSTEM', { weight: 700, track: 0.08 }],
  [/olympus/i, 'OLYMPUS', { weight: 700, font: SERIF, track: 0.1 }],
  [/panasonic|lumix/i, 'LUMIX', { weight: 800, track: 0.06 }],
  [/ricoh/i, 'RICOH', { weight: 800, track: 0.08 }],
  [/pentax/i, 'PENTAX', { weight: 800, track: 0.08 }],
  [/minolta/i, 'MINOLTA', { weight: 700, track: 0.1 }],
  [/contax/i, 'CONTAX', { weight: 600, font: SERIF, track: 0.14 }],
  [/kodak/i, 'Kodak', { weight: 800 }],
  [/sigma/i, 'SIGMA', { weight: 700, track: 0.14 }],
  [/apple/i, 'Apple', { weight: 600 }],
  [/samsung/i, 'SAMSUNG', { weight: 700, track: 0.16 }],
  [/google/i, 'Google', { weight: 500 }],
];

export function wordmark(make) {
  const m = (make || '').trim();
  if (!m) return null;
  const hit = MAKERS.find(([re]) => re.test(m));
  if (hit) return { text: hit[1], ...hit[2] };
  return { text: m.split(/\s+/)[0].toUpperCase(), weight: 700, track: 0.08 };
}

/** The camera at the right end of the bar: maker, model, and (if asked) the settings. */
function camera(ctx, right, cy, info, room, withSettings, scale = 1) {
  const wm = wordmark(info.make);
  const rows = [];
  if (wm) {
    const size = U * 1.75 * scale;
    const o = { size, weight: wm.weight, style: wm.style ?? '', font: wm.font ?? FONT, track: (wm.track ?? 0) * size };
    // a long maker name shrinks to fit rather than running into the credits
    const w = measure(ctx, wm.text, o);
    rows.push({ s: wm.text, o: w > room ? { ...o, size: size * (room / w) } : o, h: size * 1.25 });
  }
  if (info.model) {
    const o = { size: U * 1.15 * scale, weight: 500, color: C.soft };
    rows.push({ s: fit(ctx, info.model, room, o), o, h: U * 1.6 * scale });
  }
  if (withSettings && info.settings) {
    const o = { size: U * 1.0 * scale, weight: 500, color: C.soft, font: MONO };
    rows.push({ s: fit(ctx, info.settings, room, o), o, h: U * 1.5 * scale });
  }
  if (!rows.length) return;
  const total = rows.reduce((a, r) => a + r.h, 0);
  let y = cy - total / 2;
  rows.forEach((r) => {
    text(ctx, r.s, right, y + r.h / 2, { ...r.o, color: r.o.color ?? C.ink, align: 'right' });
    y += r.h;
  });
}

/**
 * One edit framed. `info`: shooter, editor, own (the shooter's own edit),
 * make, model, settings; `logos`: { shooter, editor } (Images or null).
 */
export function drawFrame(canvas, img, info, logos, L = layout(img)) {
  canvas.width = L.w;
  canvas.height = L.h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, L.w, L.h);
  const p = L.photo;
  ctx.drawImage(img, p.x, p.y, p.w, p.h);

  const top = p.y + p.h;
  const cy = top + (L.h - top) / 2 - U * 0.1;
  const end = credits(ctx, p.x, cy, info, logos);
  camera(ctx, p.x + p.w, cy, info, p.x + p.w - end - U * 3, info.own);
}

/**
 * Everything about the shot, as a small table: the camera (maker's wordmark
 * and model), lens, settings and when it was taken. Rows with nothing in
 * them are left out. Drawn from (x, y) down; returns the height used.
 */
function specs(ctx, x, y, w, info, scale = 1) {
  const rowH = U * 2.5 * scale;
  const labelW = U * 7.2 * scale;
  const lo = { size: U * 0.78 * scale, weight: 700, color: C.soft, track: U * 0.22 * scale };
  const vo = { size: U * 1.25 * scale, weight: 500 };
  const room = w - labelW;
  const rows = [
    ['CAMERA', info.make || info.model ? 'camera' : null],
    ['LENS', info.lens],
    ['SETTINGS', info.settings],
    ['DATE', info.taken],
  ].filter(([, v]) => v);
  rows.forEach(([label, v], i) => {
    const cy = y + rowH * (i + 0.5);
    text(ctx, label, x, cy, lo);
    const vx = x + labelW;
    if (v === 'camera') {
      const wm = wordmark(info.make);
      let used = 0;
      if (wm) {
        const size = U * 1.45 * scale;
        used = text(ctx, wm.text, vx, cy, { size, weight: wm.weight, style: wm.style ?? '', font: wm.font ?? FONT, track: (wm.track ?? 0) * size }) + U * 0.9 * scale;
      }
      if (info.model) text(ctx, fit(ctx, info.model, room - used, vo), vx + used, cy, { ...vo, color: C.soft });
      return;
    }
    const o = label === 'SETTINGS' ? { ...vo, font: MONO, size: vo.size * 0.92 } : vo;
    text(ctx, fit(ctx, v, room, o), vx, cy, o);
  });
  return rowH * rows.length;
}

/**
 * The first slide: the edits together, each under its editor's mark, and
 * then everything else in full: who shot it, the camera, lens, settings and
 * the date.
 */
export function drawCompare(canvas, edits, info, logos, L) {
  canvas.width = L.w;
  canvas.height = L.h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, L.w, L.h);
  const label = U * 4.4;
  const gap = U * 1.6;
  const n = edits.length;
  const a = edits[0].img.naturalHeight / edits[0].img.naturalWidth;
  const top = L.m;
  const inner = { x: L.photo.x, w: L.photo.w };

  // three ways to lay them out; the one that shows the photos biggest wins.
  // in a row or a column the details go in a band underneath; in a 2x2 grid
  // they take the fourth cell
  const under = U * 13;
  const fitTo = (cols, rows, reserve) => {
    const cw = (inner.w - gap * (cols - 1)) / cols;
    const ch = (L.h - top - reserve - gap * (rows - 1)) / rows - label;
    return Math.min(cw, ch / a);
  };
  const options = [
    { kind: 'row', cols: n, rows: 1, pw: fitTo(n, 1, under) },
    { kind: 'col', cols: 1, rows: n, pw: fitTo(1, n, under) },
    ...(n === 3 ? [{ kind: 'grid', cols: 2, rows: 2, pw: fitTo(2, 2, L.m) }] : []),
  ];
  const best = options.reduce((x, y) => (y.pw > x.pw ? y : x));
  const pw = best.pw;
  const ph = pw * a;
  const cellW = (inner.w - gap * (best.cols - 1)) / best.cols;
  const blockH = (ph + label) * best.rows + gap * (best.rows - 1);
  const room = L.h - top - (best.kind === 'grid' ? L.m : under);
  const y0 = top + (room - blockH) / 2;
  const cell = (k) => ({
    x: inner.x + (k % best.cols) * (cellW + gap) + (cellW - pw) / 2,
    y: y0 + Math.floor(k / best.cols) * (ph + label + gap),
  });

  edits.forEach((e, k) => {
    const { x, y } = cell(k);
    ctx.drawImage(e.img, x, y, pw, ph);
    const s = U * 2.6;
    const cy = y + ph + label * 0.5;
    const nw = measure(ctx, e.name, { size: U * 1.5, weight: 700 });
    const startX = x + pw / 2 - (s + U * 0.7 + nw) / 2;
    mark(ctx, e.logo, e.name, startX, cy, s);
    text(ctx, e.name, startX + s + U * 0.7, cy, { size: U * 1.5, weight: 700 });
  });

  if (best.kind === 'grid') {
    // the fourth cell: who shot it, a hairline, then the details
    const { x, y } = cell(3);
    const scale = Math.min(1.25, ph / (U * 22));
    const credY = y + U * 3.2 * scale;
    credit(ctx, x, credY, 'SHOT BY', info.shooter, logos.shooter, scale);
    const lineY = credY + U * 4.2 * scale;
    ctx.fillStyle = C.line;
    ctx.fillRect(x, lineY, pw, Math.max(2, U * 0.08));
    specs(ctx, x, lineY + U * 1.4 * scale, pw, info, scale);
    return;
  }
  // a band under the edits: who shot it on the left, the details on the right
  const bandTop = L.h - under;
  ctx.fillStyle = C.line;
  ctx.fillRect(inner.x, bandTop + U * 0.6, inner.w, Math.max(2, U * 0.08));
  const end = inner.x + credit(ctx, inner.x, bandTop + under / 2, 'SHOT BY', info.shooter, logos.shooter);
  const sx = Math.max(end + U * 4, inner.x + inner.w * 0.42);
  const rows = ['make', 'lens', 'settings', 'taken'].filter((k) => info[k] || (k === 'make' && info.model)).length;
  specs(ctx, sx, bandTop + under / 2 - (U * 2.5 * rows) / 2 + U * 0.3, inner.x + inner.w - sx, info);
}
