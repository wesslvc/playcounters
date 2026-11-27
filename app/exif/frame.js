/**
 * The 필름곳간 frame, drawn on a canvas. Always black: the members' marks are
 * glowing line drawings made for a dark ground.
 *
 * Tight margins around the photo and one bar under it. On the left, who shot
 * it and who edited it, each with their mark, big enough to read at a
 * glance; on the shooter's own edit the two are one ("SHOT · EDITED BY").
 * On the right, the camera: its maker's logo (or wordmark), the model under
 * it, and the settings.
 *
 * The canvas follows the photo instead of padding it out to a fixed shape:
 * as wide as Instagram allows (2160 px, twice 1080), as tall as the photo
 * needs, held between Instagram's 1.91:1 and 4:5 so nothing gets cropped.
 * Every slide of a post comes out the same size, since a carousel takes its
 * shape from the first.
 */

export const W = 2160;
const U = W / 100;
// type: names in a slim display serif, everything else in a compact sans
// (Korean, as in a typed place, falls to Wanted Sans), settings in a mono.
// All three are loaded by the page (see page.jsx) before the frame is drawn
// (Newsreader: an elegant serif whose 1 never reads as l, which names like
// x1x0xn and 1.slvc need)
// every word on the frame is in one serif: Newsreader for Latin, Nanum
// Myeongjo for Korean (a typed place), the way a printed photo book is set
const DISPLAY = '"Newsreader", "Nanum Myeongjo", "Times New Roman", serif';
const FONT = DISPLAY;
const MONO = DISPLAY;
const NAME = (k = 1) => ({ size: U * 2.3 * k, weight: 400, font: DISPLAY });
const SERIF = 'Georgia, "Times New Roman", Times, serif';
const C = { bg: '#000000', ink: '#F3F1EC', soft: '#8F8B84', line: '#34312E' };

/**
 * The 필름곳간 frame is a strip of film. Across the top and the bottom runs
 * film's rebate: a row of sprocket holes, and under the top row the edge
 * print in film's orange (the channel and the frame number). The photo sits
 * in the strip like a frame on a negative, and the bar under it carries the
 * credits and the camera. The storehouse mark is on the first slide only.
 */
const EDGE = 'rgba(214, 128, 52, 0.85)';
const HOLE = '#1E1C1A';
const REBATE = U * 2.4; // the strip holding a row of holes
const PRINT = U * 1.9; // the edge print under the top row

function holes(ctx, y, w) {
  // 35 mm perforations: rounded, a little taller than wide, evenly pitched
  const hw = U * 0.95;
  const hh = U * 1.25;
  const pitch = U * 2.05;
  const n = Math.floor((w - pitch * 0.5) / pitch);
  const x0 = (w - (n - 1) * pitch) / 2;
  ctx.fillStyle = HOLE;
  for (let i = 0; i < n; i += 1) {
    const x = x0 + i * pitch - hw / 2;
    const r = U * 0.22;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + hw, y, x + hw, y + hh, r);
    ctx.arcTo(x + hw, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r);
    ctx.arcTo(x, y, x + hw, y, r);
    ctx.fill();
  }
}

function rebate(ctx, L, left, right, frame) {
  holes(ctx, (REBATE - U * 1.25) / 2, L.w);
  holes(ctx, L.h - REBATE + (REBATE - U * 1.25) / 2, L.w);
  const y = REBATE + PRINT * 0.45;
  const o = { size: U * 0.9, weight: 500, color: EDGE, track: U * 0.3 };
  text(ctx, 'FILM GOTGAN  400', left, y, o);
  text(ctx, '필름곳간', (left + right) / 2, y, { ...o, track: U * 0.4, align: 'center' });
  if (frame) text(ctx, `▸ ${frame}`, right, y, { ...o, align: 'right' });
}

/** The canvas size for a photo of this shape, and where the photo goes. */
export function layout(img) {
  const m = Math.round(W * 0.028); // margin beside the photo
  const top = Math.round(REBATE + PRINT); // holes and edge print above it
  const bottom = Math.round(REBATE); // holes at the very bottom
  const bar = Math.round(U * 11);
  const aspect = img.naturalHeight / img.naturalWidth;
  let pw = W - m * 2;
  let ph = pw * aspect;
  let h = top + ph + bar + bottom;
  const maxH = Math.round(W * 1.25);
  const minH = Math.round(W / 1.91);
  if (h > maxH) { // a tall photo: shrink it to fit, centred
    ph = maxH - top - bar - bottom;
    pw = ph / aspect;
    h = maxH;
  }
  h = Math.max(minH, Math.round(h));
  const px = (W - pw) / 2;
  const py = top + (h - top - bar - bottom - ph) / 2;
  return { w: W, h, m, top, bottom, bar, photo: { x: px, y: py, w: pw, h: ph } };
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
  const no = NAME(scale);
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
 * For makers we have no logo for, a wordmark: the name set the way the maker
 * sets it (case, weight, slant, spacing), in plain type.
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

/**
 * The maker's own logo, for makers we have one for (white versions for a dark
 * ground, in public/exif/makers). Matched on the maker or the model, so a
 * phone that writes only "iPhone 15" still finds Apple.
 */
const LOGO_FILES = [
  [/apple|iphone/i, 'apple'], [/canon/i, 'canon'], [/contax/i, 'contax'], [/\bdji\b/i, 'dji'],
  [/epson/i, 'epson'], [/fuji/i, 'fujifilm'], [/goldstar/i, 'goldstar'], [/hasselblad/i, 'hasselblad'],
  [/leica/i, 'leica'], [/^lg\b|lg electronics/i, 'lg'], [/panasonic|lumix/i, 'lumix'], [/mamiya/i, 'mamiya'],
  [/nikon/i, 'nikon'], [/om digital|om system/i, 'om'], [/olympus/i, 'olympus'], [/pentax/i, 'pentax'],
  [/phase ?one/i, 'phaseone'], [/ricoh/i, 'ricoh'], [/samsung/i, 'samsung'], [/sigma/i, 'sigma'], [/sony/i, 'sony'],
];
export function makerLogoFile(make, model) {
  const hit = LOGO_FILES.find(([re]) => re.test(make || '') || re.test(model || ''));
  return hit ? `/exif/makers/${hit[1]}.png` : null;
}

/**
 * How big to draw a maker's logo so it weighs about as much as a wordmark of
 * the given type size: wide logos come out shorter, square ones taller, up to
 * a limit so a round badge does not tower over the text.
 */
function logoBox(img, size) {
  const aspect = img.naturalWidth / img.naturalHeight;
  const h = Math.min(size * 1.25, Math.max(size * 0.6, size * Math.sqrt(3.3 / aspect)));
  return { w: h * aspect, h };
}

/** The maker at (x, cy): its logo if we have one, else the wordmark. Returns the width. */
function maker(ctx, info, x, cy, size, align = 'left', maxW = Infinity) {
  if (info.makerLogo) {
    let { w, h } = logoBox(info.makerLogo, size);
    if (w > maxW) { h *= maxW / w; w = maxW; }
    ctx.drawImage(info.makerLogo, align === 'right' ? x - w : x, cy - h / 2, w, h);
    return w;
  }
  const wm = wordmark(info.make);
  if (!wm) return 0;
  let o = { size, weight: wm.weight, style: wm.style ?? '', font: wm.font ?? FONT, track: (wm.track ?? 0) * size };
  const w = measure(ctx, wm.text, o);
  if (w > maxW) o = { ...o, size: size * (maxW / w), track: o.track * (maxW / w) };
  return text(ctx, wm.text, x, cy, { ...o, align });
}

function makerSize(ctx, info, size) {
  if (info.makerLogo) return logoBox(info.makerLogo, size);
  const wm = wordmark(info.make);
  if (!wm) return { w: 0, h: 0 };
  return { w: measure(ctx, wm.text, { size, weight: wm.weight, style: wm.style ?? '', font: wm.font ?? FONT, track: (wm.track ?? 0) * size }), h: size };
}

export function wordmark(make) {
  const m = (make || '').trim();
  if (!m) return null;
  const hit = MAKERS.find(([re]) => re.test(m));
  if (hit) return { text: hit[1], ...hit[2] };
  return { text: m.split(/\s+/)[0].toUpperCase(), weight: 700, track: 0.08 };
}

/** The camera at the right end of the bar: maker, model, and (if asked) the settings. */
function camera(ctx, right, cy, info, room, withSettings, scale = 1) {
  const rows = [];
  const size = U * 1.75 * scale;
  const mk = makerSize(ctx, info, size);
  // a long maker name shrinks to fit rather than running into the credits
  if (mk.w) rows.push({ maker: true, h: Math.max(size, mk.h * Math.min(1, room / mk.w)) * 1.25 });
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
    if (r.maker) maker(ctx, info, right, y + r.h / 2, size, 'right', room);
    else text(ctx, r.s, right, y + r.h / 2, { ...r.o, color: r.o.color ?? C.ink, align: 'right' });
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
  rebate(ctx, L, p.x, p.x + p.w, info.frame);

  const top = p.y + p.h;
  const cy = top + (L.h - L.bottom - top) / 2;
  const end = credits(ctx, p.x, cy, info, logos);
  camera(ctx, p.x + p.w, cy, info, p.x + p.w - end - U * 3, true);
}

/** The 필름곳간 mark and name, centred on (cx, cy). */
function storehouse(ctx, logo, cx, cy) {
  const s = U * 4.4;
  const nameO = { size: U * 1.35, weight: 800, color: C.ink, track: U * 0.18, font: '"Nanum Myeongjo", serif' };
  const w = storehouseWidth(ctx, logo);
  const x = cx - w / 2;
  mark(ctx, logo, '곳', x, cy, s);
  text(ctx, '필름곳간', x + s + U * 0.6, cy - U * 0.45, nameO);
  text(ctx, 'FILM GOTGAN', x + s + U * 0.6, cy + U * 1.05, { size: U * 0.72, weight: 500, color: C.soft, track: U * 0.3 });
}
function storehouseWidth(ctx, logo) {
  if (!logo) return 0;
  const nameW = Math.max(measure(ctx, '필름곳간', { size: U * 1.35, weight: 800, track: U * 0.18, font: '"Nanum Myeongjo", serif' }),
    measure(ctx, 'FILM GOTGAN', { size: U * 0.72, weight: 500, track: U * 0.3 }));
  return U * 4.4 + U * 0.6 + nameW;
}

/** The rows of the details table, leaving out the ones with nothing in them. */
const specRows = (info) => [
  ['PLACE', info.place],
  ['CAMERA', info.make || info.model ? 'camera' : null],
  ['LENS', info.lens],
  ['SETTINGS', info.settings],
  ['DATE', info.taken],
].filter(([, v]) => v);

const LABEL = (k) => ({ size: U * 0.78 * k, weight: 700, color: C.soft, track: U * 0.22 * k });
const VALUE = (k) => ({ size: U * 1.25 * k, weight: 500 });
const SETTING = (k) => ({ ...VALUE(k), font: MONO, size: U * 1.15 * k });
const SIDE_ROW = 2.5; // row height, in U, with the label beside the value
const STACK_ROW = 3.4; // and with the label above it
const LABEL_COL = 7.2;

/** How wide one row's value is at scale 1. */
function valueWidth(ctx, info, label, v) {
  if (v !== 'camera') return measure(ctx, v, label === 'SETTINGS' ? SETTING(1) : VALUE(1));
  const mw = makerSize(ctx, info, U * 1.45).w;
  return (mw ? mw + U * 0.9 : 0) + (info.model ? measure(ctx, info.model, VALUE(1)) : 0);
}

/**
 * Everything about the shot, as a table: where (typed by hand), the camera
 * (maker's logo and model), lens, settings and when it was taken. `stacked` puts each label
 * above its value (for narrow spaces) instead of beside it.
 */
function specs(ctx, x, y, w, info, scale = 1, stacked = false) {
  const rowH = U * (stacked ? STACK_ROW : SIDE_ROW) * scale;
  const labelW = stacked ? 0 : U * LABEL_COL * scale;
  const vo = VALUE(scale);
  const room = w - labelW;
  specRows(info).forEach(([label, v], i) => {
    const top = y + rowH * i;
    const vy = stacked ? top + U * 2.15 * scale : top + rowH / 2;
    text(ctx, label, x, stacked ? top + U * 0.75 * scale : vy, LABEL(scale));
    const vx = x + labelW;
    if (v === 'camera') {
      let used = maker(ctx, info, vx, vy, U * 1.45 * scale, 'left', room);
      if (used) used += U * 0.9 * scale;
      if (info.model) text(ctx, fit(ctx, info.model, room - used, vo), vx + used, vy, { ...vo, color: C.soft });
      return;
    }
    const o = label === 'SETTINGS' ? SETTING(scale) : vo;
    text(ctx, fit(ctx, v, room, o), vx, vy, o);
  });
  return rowH * specRows(info).length;
}

/**
 * Who shot it and every detail, as large as the box (x, y, w, h) allows.
 * Three arrangements are measured at scale 1 and the one that can grow the
 * most is drawn, centred: the credit over the table with labels beside the
 * values; the same with labels above (narrow boxes); or the credit and the
 * table side by side (short, wide boxes).
 */
function infoBlock(ctx, x, y, w, h, info, logo) {
  const s = U * 5.2;
  const creditW = s + U * 1.0 + Math.max(measure(ctx, 'SHOT BY', LABEL(1)), measure(ctx, info.shooter, NAME()));
  const creditH = U * 5.6;
  const rows = specRows(info);
  const values = rows.map(([label, v]) => valueWidth(ctx, info, label, v));
  const widest = Math.max(0, ...values) + U * 0.6; // slack for rounded font sizes
  const labelsW = Math.max(0, ...rows.map(([label]) => measure(ctx, label, LABEL(1))));
  const head = U * 2.6 + U * 4.2 + U * 1.4; // credit, hairline, gap
  const ways = [
    { kind: 'side', w: Math.max(creditW, U * LABEL_COL + widest), h: head + rows.length * U * SIDE_ROW },
    { kind: 'stack', w: Math.max(creditW, widest, labelsW), h: head + rows.length * U * STACK_ROW },
    { kind: 'wide', w: creditW + U * 4 + U * LABEL_COL + widest, h: Math.max(creditH, rows.length * U * SIDE_ROW) },
  ].map((o) => ({ ...o, k: Math.min(3, (w / o.w) * 0.96, (h / o.h) * 0.92) }));
  const best = ways.reduce((a, b) => (b.k > a.k ? b : a));
  const k = best.k;
  const top = y + (h - best.h * k) / 2;
  const left = x + (w - best.w * k) / 2;
  ctx.fillStyle = C.line;
  if (best.kind === 'wide') {
    const cy = top + (best.h * k) / 2;
    credit(ctx, left, cy, 'SHOT BY', info.shooter, logo, k);
    const div = left + (creditW + U * 2) * k;
    ctx.fillStyle = C.line;
    ctx.fillRect(div, top, Math.max(2, U * 0.08), best.h * k);
    const tx = div + U * 2 * k;
    specs(ctx, tx, cy - (rows.length * U * SIDE_ROW * k) / 2, left + best.w * k - tx, info, k);
    return;
  }
  const credY = top + U * 2.6 * k;
  credit(ctx, left, credY, 'SHOT BY', info.shooter, logo, k);
  const lineY = credY + U * 4.2 * k;
  ctx.fillStyle = C.line;
  ctx.fillRect(left, lineY, best.w * k, Math.max(2, U * 0.08));
  specs(ctx, left, lineY + U * 1.4 * k, best.w * k, info, k, best.kind === 'stack');
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
  const top = L.top;
  const inner = { x: L.photo.x, w: L.photo.w };
  rebate(ctx, L, inner.x, inner.x + inner.w, '0');

  // three ways to lay them out; the one that shows the photos biggest wins.
  // in a row or a column the details go in a band underneath; in a 2x2 grid
  // they take the fourth cell
  const under = U * 13 + L.bottom;
  const fitTo = (cols, rows, reserve) => {
    const cw = (inner.w - gap * (cols - 1)) / cols;
    const ch = (L.h - top - reserve - gap * (rows - 1)) / rows - label;
    return Math.min(cw, ch / a);
  };
  const options = [
    { kind: 'row', cols: n, rows: 1, pw: fitTo(n, 1, under) },
    { kind: 'col', cols: 1, rows: n, pw: fitTo(1, n, under) },
    ...(n === 3 ? [{ kind: 'grid', cols: 2, rows: 2, pw: fitTo(2, 2, L.bottom + U) }] : []),
  ];
  const best = options.reduce((x, y) => (y.pw > x.pw ? y : x));
  const pw = best.pw;
  const ph = pw * a;
  const cellW = (inner.w - gap * (best.cols - 1)) / best.cols;
  const blockH = (ph + label) * best.rows + gap * (best.rows - 1);
  const room = L.h - top - (best.kind === 'grid' ? L.bottom + U : under);
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
    const nw = measure(ctx, e.name, NAME(0.75));
    const startX = x + pw / 2 - (s + U * 0.7 + nw) / 2;
    mark(ctx, e.logo, e.name, startX, cy, s);
    text(ctx, e.name, startX + s + U * 0.7, cy, NAME(0.75));
  });

  if (best.kind === 'grid') {
    // the fourth cell: who shot it and every detail, filling the cell
    const { x, y } = cell(3);
    // with the 필름곳간 mark at the foot of the cell: this slide is the post's
    // cover, and the only one that carries it
    const markH = logos.channel ? U * 6.5 : 0;
    infoBlock(ctx, x, y, pw, ph + label - markH, info, logos.shooter);
    if (logos.channel) storehouse(ctx, logos.channel, x + pw / 2, y + ph + label - markH / 2);
    return;
  }
  // a band under the edits with who shot it and every detail
  const bandTop = L.h - under;
  const markW = logos.channel ? storehouseWidth(ctx, logos.channel) + U * 4 : 0;
  infoBlock(ctx, inner.x, bandTop + U * 0.8, inner.w - markW, under - L.bottom - U * 1.6, info, logos.shooter);
  if (logos.channel) storehouse(ctx, logos.channel, inner.x + inner.w - markW / 2 + U * 2, bandTop + (under - L.bottom) / 2);
}
