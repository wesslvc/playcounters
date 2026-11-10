'use client';

/**
 * Story-sized share images (1080×1920), drawn on a canvas in the browser:
 * the lead picture blown up and blurred as the background, a kicker and a
 * big title, the picture itself, a row of figures and a short ranked list.
 * Covers come from CDNs that allow cross-origin use, so the canvas can be
 * exported; one that fails to load is simply left out.
 */

const W = 1080;
const H = 1920;
const FONT = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

function load(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function cover(ctx, img, x, y, w, h, r = 0) {
  ctx.save();
  if (r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip(); }
  if (img) {
    const s = Math.max(w / img.width, h / img.height);
    const iw = img.width * s;
    const ih = img.height * s;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

/**
 * The background picture, blurred. Safari's canvas ignores ctx.filter, so
 * the blur comes from shrinking the picture to a few dozen pixels and
 * scaling it back up in steps, which looks the same everywhere.
 */
function soften(ctx, img) {
  const steps = [[9, 16], [36, 64], [135, 240], [540, 960]];
  let src = img;
  let sw = img.width;
  let sh = img.height;
  steps.forEach(([w, h], i) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    if (i === 0) cover(x, src, -2, -2, w + 4, h + 4);
    else x.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
    src = c;
    sw = w;
    sh = h;
  });
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = 0.9;
  ctx.drawImage(src, -60, -60, W + 120, H + 120);
  ctx.restore();
}

/** Text cut to fit a width, with an ellipsis. */
function fit(ctx, text, max) {
  let t = String(text ?? '');
  if (ctx.measureText(t).width <= max) return t;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Up to `lines` lines of wrapped text, the last cut with an ellipsis. */
function wrap(ctx, text, max, lines) {
  const words = String(text ?? '').split(' ');
  const out = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= max) { cur = next; continue; }
    if (cur) out.push(cur);
    cur = w;
    if (out.length === lines) break;
  }
  if (out.length < lines && cur) out.push(cur);
  if (out.length > lines) out.length = lines;
  const used = out.join(' ').length;
  if (used < String(text).length) out[out.length - 1] = fit(ctx, `${out[out.length - 1]}…`, max);
  return out;
}

/**
 * @param card { kicker, title, sub, image, round, stats: [[value, label]], list: [{ rank, title, sub, value, image }], foot }
 * @returns a PNG Blob
 */
export async function drawCard(card) {
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const [lead, ...rows] = await Promise.all([load(card.image), ...(card.list ?? []).map((x) => load(x.image))]);

  // the background: the lead picture, huge and soft, under a dark wash
  ctx.fillStyle = '#121214';
  ctx.fillRect(0, 0, W, H);
  if (lead) soften(ctx, lead);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,.35)');
  g.addColorStop(0.55, 'rgba(0,0,0,.55)');
  g.addColorStop(1, 'rgba(0,0,0,.85)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  // the mark
  ctx.font = `700 34px ${FONT}`;
  ctx.globalAlpha = 0.85;
  ctx.fillText('playcounters', 80, 120);
  ctx.globalAlpha = 1;

  // the picture
  const size = 560;
  const px = (W - size) / 2;
  const py = 210;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 80;
  ctx.shadowOffsetY = 30;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  if (card.round) ctx.arc(px + size / 2, py + size / 2, size / 2, 0, Math.PI * 2);
  else ctx.roundRect(px, py, size, size, 36);
  ctx.fill();
  ctx.restore();
  if (card.round) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(px + size / 2, py + size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    cover(ctx, lead, px, py, size, size);
    ctx.restore();
  } else {
    cover(ctx, lead, px, py, size, size, 36);
  }

  // kicker, title, sub
  let y = py + size + 110;
  ctx.textAlign = 'center';
  ctx.font = `700 34px ${FONT}`;
  ctx.globalAlpha = 0.75;
  ctx.fillText(card.kicker ?? '', W / 2, y);
  ctx.globalAlpha = 1;
  y += 92;
  ctx.font = `800 84px ${FONT}`;
  for (const line of wrap(ctx, card.title, W - 160, 2)) { ctx.fillText(line, W / 2, y); y += 96; }
  if (card.sub) {
    ctx.font = `500 38px ${FONT}`;
    ctx.globalAlpha = 0.8;
    ctx.fillText(fit(ctx, card.sub, W - 160), W / 2, y - 18);
    ctx.globalAlpha = 1;
    y += 50;
  }

  // the figures
  const stats = card.stats ?? [];
  if (stats.length) {
    y += 30;
    const cw = (W - 160) / stats.length;
    stats.forEach(([v, label], i) => {
      const cx = 80 + cw * i + cw / 2;
      ctx.font = `800 72px ${FONT}`;
      ctx.fillText(String(v), cx, y + 60);
      ctx.font = `700 26px ${FONT}`;
      ctx.globalAlpha = 0.6;
      ctx.fillText(label, cx, y + 104);
      ctx.globalAlpha = 1;
      if (i) {
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        ctx.fillRect(80 + cw * i, y + 10, 2, 100);
        ctx.fillStyle = '#fff';
      }
    });
    y += 160;
  }

  // the list
  ctx.textAlign = 'left';
  const list = (card.list ?? []).slice(0, 5);
  const rowH = 104;
  const room = H - 150 - y;
  const fits = Math.max(0, Math.min(list.length, Math.floor(room / rowH)));
  list.slice(0, fits).forEach((x, i) => {
    const ry = y + i * rowH;
    ctx.font = `800 40px ${FONT}`;
    ctx.globalAlpha = 0.7;
    ctx.fillText(String(x.rank), 80, ry + 56);
    ctx.globalAlpha = 1;
    cover(ctx, rows[i], 150, ry + 8, 76, 76, 12);
    ctx.font = `700 36px ${FONT}`;
    ctx.fillText(fit(ctx, x.title, 560), 252, ry + 44);
    ctx.font = `500 28px ${FONT}`;
    ctx.globalAlpha = 0.65;
    ctx.fillText(fit(ctx, x.sub ?? '', 560), 252, ry + 82);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'right';
    ctx.font = `800 36px ${FONT}`;
    ctx.fillText(String(x.value ?? ''), W - 80, ry + 58);
    ctx.textAlign = 'left';
  });

  // the foot
  ctx.textAlign = 'center';
  ctx.font = `600 28px ${FONT}`;
  ctx.globalAlpha = 0.55;
  ctx.fillText(card.foot ?? '', W / 2, H - 80);
  ctx.globalAlpha = 1;

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Hands the image to the phone's share sheet, or saves it where there's none. */
export async function shareCard(card, name) {
  const blob = await drawCard(card);
  if (!blob) return;
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: card.title }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
