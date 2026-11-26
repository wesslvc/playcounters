/**
 * The 필름곳간 frame, drawn on a canvas.
 *
 * Tight white (or black) margins around the photo, film edge print along the
 * top margin the way a negative carries its stock name and frame number,
 * and one bar under the photo split in two by a hairline: on the left who
 * shot it, with the camera, lens and settings; on the right who edited it
 * and when it was taken. Each side leads with the member's logo. The
 * channel's own mark closes the bar on the right.
 *
 * The canvas follows the photo instead of padding it out to a fixed shape:
 * as wide as Instagram allows (2160 px, twice 1080), as tall as the photo
 * needs, held between Instagram's 1.91:1 and 4:5 so nothing gets cropped.
 * Every slide of a post comes out the same size, since a carousel takes its
 * shape from the first.
 */

export const W = 2160;
const FONT = '"Pretendard Variable", Pretendard, -apple-system, "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const EDGE = '#d9822b'; // the orange of film edge print

export const palette = (frame) => (frame === 'black'
  ? { bg: '#111111', ink: '#f3f1ec', soft: '#8f8b84', line: '#3a3835' }
  : { bg: '#fbfaf7', ink: '#161514', soft: '#8a857d', line: '#dedad3' });

/** The canvas size for a photo of this shape, and where the photo goes. */
export function layout(img) {
  const m = Math.round(W * 0.032); // margin around the photo
  const edge = Math.round(W * 0.028); // the edge-print strip above it
  const bar = Math.round(W * 0.155);
  const aspect = img.naturalHeight / img.naturalWidth;
  let pw = W - m * 2;
  let ph = pw * aspect;
  let h = edge + m + ph + bar;
  const maxH = Math.round(W * 1.25);
  const minH = Math.round(W / 1.91);
  if (h > maxH) { // a tall photo: shrink it to fit, centred
    ph = maxH - edge - m - bar;
    pw = ph / aspect;
    h = maxH;
  }
  h = Math.max(minH, Math.round(h));
  const px = (W - pw) / 2;
  const py = edge + m + (h - edge - m - bar - ph) / 2;
  return { w: W, h, m, edge, bar, photo: { x: px, y: py, w: pw, h: ph } };
}

function text(ctx, s, x, y, { size, weight = 500, color, align = 'left', font = FONT, track = 0 }) {
  ctx.font = `${weight} ${Math.round(size)}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${track}px`;
  ctx.fillText(s || '', x, y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  return ctx.measureText(s || '').width;
}

/** A member's logo in a circle; their initial when no logo was given. */
function mark(ctx, logo, name, cx, cy, r, c) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  if (logo) {
    ctx.clip();
    const s = Math.min((r * 2) / logo.naturalWidth, (r * 2) / logo.naturalHeight);
    ctx.drawImage(logo, cx - (logo.naturalWidth * s) / 2, cy - (logo.naturalHeight * s) / 2, logo.naturalWidth * s, logo.naturalHeight * s);
  } else {
    ctx.strokeStyle = c.line;
    ctx.lineWidth = r * 0.08;
    ctx.stroke();
    text(ctx, (name || '?').slice(0, 1).toUpperCase(), cx, cy + r * 0.04, { size: r * 0.95, weight: 700, color: c.ink, align: 'center' });
  }
  ctx.restore();
}

/** Film edge print along the top margin: the stock, the post number, the frame. */
function edgePrint(ctx, L, info, c) {
  const y = L.edge * 0.62 + L.m * 0.35;
  const size = W * 0.0105;
  const o = { size, weight: 600, color: EDGE, font: MONO, track: size * 0.18 };
  text(ctx, `FILM GOTGAN ${info.stock || '400'}`, L.photo.x, y, o);
  text(ctx, `▸ ${info.no || '01'}${info.frameTag || ''}`, L.photo.x + L.photo.w, y, { ...o, align: 'right' });
  text(ctx, info.taken ? info.taken.slice(0, 10).replace(/\./g, ' ') : '', W / 2, y, { ...o, align: 'center', color: c.soft });
}

/** One side of the credit: label, logo and name, then up to two lines of detail. */
function credit(ctx, x, top, width, who, logo, label, lines, c) {
  const u = W / 100;
  text(ctx, label, x, top, { size: u * 0.95, weight: 700, color: c.soft, track: u * 0.22 });
  const r = u * 1.75;
  mark(ctx, logo, who, x + r, top + u * 3.3, r, c);
  text(ctx, who, x + r * 2 + u * 1.1, top + u * 3.3, { size: u * 2.1, weight: 700, color: c.ink });
  lines.filter(Boolean).slice(0, 2).forEach((l, k) => {
    let s = l;
    ctx.font = `500 ${Math.round(u * 1.45)}px ${FONT}`;
    while (s.length > 1 && ctx.measureText(s).width > width) s = s.slice(0, -1);
    if (s !== l) s = `${s.slice(0, -1)}…`;
    text(ctx, s, x, top + u * (6.6 + k * 2.2), { size: u * 1.45, weight: 500, color: k === 0 ? c.ink : c.soft });
  });
}

/** The channel's mark at the right end of the bar; its name when no logo was given. */
function channelMark(ctx, logo, channel, right, cy, c) {
  const u = W / 100;
  if (logo) {
    const h = u * 4.2;
    const w = (logo.naturalWidth / logo.naturalHeight) * h;
    ctx.drawImage(logo, right - w, cy - h / 2, w, h);
    return w;
  }
  return text(ctx, channel, right, cy, { size: u * 1.6, weight: 800, color: c.ink, align: 'right', track: u * 0.05 });
}

/**
 * One edit framed. `info`: camera, lens, settings, taken, shooter, editor,
 * channel, no, stock; `logos`: { shooter, editor, channel } (Images or null).
 */
export function drawFrame(canvas, img, info, logos, frame, L = layout(img)) {
  const c = palette(frame);
  canvas.width = L.w;
  canvas.height = L.h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, L.w, L.h);
  edgePrint(ctx, L, info, c);
  const p = L.photo;
  ctx.drawImage(img, p.x, p.y, p.w, p.h);

  // the bar: shot | edited, split by a hairline, the channel mark at the end
  const u = W / 100;
  const top = p.y + p.h + L.m * 0.95;
  const left = p.x;
  const right = p.x + p.w;
  const brandW = (logos.channel ? (logos.channel.naturalWidth / logos.channel.naturalHeight) * u * 4.2 : u * 12) + u * 2.5;
  const mid = left + (p.w - brandW) * 0.56;
  ctx.fillStyle = c.line;
  ctx.fillRect(mid, top - u * 0.3, Math.max(2, u * 0.08), u * 9.4);
  credit(ctx, left, top, mid - left - u * 2, info.shooter, logos.shooter, 'SHOT BY',
    [[info.camera, info.lens].filter(Boolean).join(' · '), info.settings], c);
  credit(ctx, mid + u * 2, top, right - brandW - mid - u * 3, info.editor, logos.editor, 'EDITED BY',
    [info.taken, ''], c);
  channelMark(ctx, logos.channel, info.channel, right, top + u * 4.3, c);
}

/** The first slide: the three edits together, each under its editor's mark, and who shot it. */
export function drawCompare(canvas, edits, info, logos, frame, L) {
  const c = palette(frame);
  canvas.width = L.w;
  canvas.height = L.h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, L.w, L.h);
  edgePrint(ctx, L, { ...info, frameTag: '' }, c);
  const u = W / 100;
  const label = u * 4.4;
  const gap = u * 1.6;
  const n = edits.length;
  const a = edits[0].img.naturalHeight / edits[0].img.naturalWidth;
  const top = L.edge + L.m;
  const inner = { x: L.photo.x, w: L.photo.w };

  // three ways to lay them out; the one that shows the photos biggest wins.
  // in a row or a column the shooter goes in a line underneath; in a 2x2 grid
  // the shooter takes the fourth cell
  const under = L.bar * 0.62;
  const fit = (cols, rows, reserve) => {
    const cw = (inner.w - gap * (cols - 1)) / cols;
    const ch = (L.h - top - L.m - reserve - gap * (rows - 1)) / rows - label;
    return Math.min(cw, ch / a);
  };
  const options = [
    { kind: 'row', cols: n, rows: 1, pw: fit(n, 1, under) },
    { kind: 'col', cols: 1, rows: n, pw: fit(1, n, under) },
    ...(n === 3 ? [{ kind: 'grid', cols: 2, rows: 2, pw: fit(2, 2, 0) }] : []),
  ];
  const best = options.reduce((x, y) => (y.pw > x.pw ? y : x));
  const pw = best.pw;
  const ph = pw * a;
  const cellW = (inner.w - gap * (best.cols - 1)) / best.cols;
  const blockH = (ph + label) * best.rows + gap * (best.rows - 1);
  const room = L.h - top - L.m - (best.kind === 'grid' ? 0 : under);
  const y0 = top + (room - blockH) / 2;
  const cell = (k) => ({
    x: inner.x + (k % best.cols) * (cellW + gap) + (cellW - pw) / 2,
    y: y0 + Math.floor(k / best.cols) * (ph + label + gap),
  });

  edits.forEach((e, k) => {
    const { x, y } = cell(k);
    ctx.drawImage(e.img, x, y, pw, ph);
    const r = u * 1.2;
    const cy = y + ph + label * 0.5;
    ctx.font = `700 ${Math.round(u * 1.5)}px ${FONT}`;
    const nameW = ctx.measureText(e.name).width;
    const startX = x + pw / 2 - (r * 2 + u * 0.8 + nameW) / 2;
    mark(ctx, e.logo, e.name, startX + r, cy, r, c);
    text(ctx, e.name, startX + r * 2 + u * 0.8, cy, { size: u * 1.5, weight: 700, color: c.ink });
  });

  if (best.kind === 'grid') {
    // the fourth cell: who shot it, large, and the channel's mark
    const { x, y } = cell(3);
    ctx.fillStyle = c.line;
    ctx.fillRect(x, y, pw, Math.max(2, u * 0.08));
    text(ctx, 'SHOT BY', x, y + ph * 0.22, { size: u * 1.1, weight: 700, color: c.soft, track: u * 0.25 });
    const r = u * 2.4;
    mark(ctx, logos.shooter, info.shooter, x + r, y + ph * 0.44, r, c);
    text(ctx, info.shooter, x + r * 2 + u * 1.3, y + ph * 0.44, { size: u * 2.6, weight: 700, color: c.ink });
    text(ctx, [info.camera, info.lens].filter(Boolean).join(' · '), x, y + ph * 0.66, { size: u * 1.4, weight: 500, color: c.ink });
    text(ctx, info.settings, x, y + ph * 0.66 + u * 2.2, { size: u * 1.4, weight: 500, color: c.soft });
    channelMark(ctx, logos.channel, info.channel, x + pw, y + ph + label * 0.5, c);
    return;
  }
  const by = L.h - L.m - under * 0.45;
  const r = u * 1.4;
  text(ctx, 'SHOT BY', inner.x, by, { size: u * 0.95, weight: 700, color: c.soft, track: u * 0.22 });
  mark(ctx, logos.shooter, info.shooter, inner.x + u * 9.6 + r, by, r, c);
  text(ctx, info.shooter, inner.x + u * 9.6 + r * 2 + u * 0.9, by, { size: u * 1.7, weight: 700, color: c.ink });
  channelMark(ctx, logos.channel, info.channel, inner.x + inner.w, by, c);
}
