'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { readExif, caption } from './exif';

/**
 * 필름곳간: one person shoots, all three edit the same photo, and the three
 * edits go up together. A post here is that set — who shot it, each
 * member's edit — and comes out as one framed picture per edit, credited
 * ("촬영 A · 보정 B") with the shooting details underneath, plus a slide
 * with the three side by side. Frames are 4:5 for Instagram by default.
 * EXIF comes from the original if given, else from whichever edit still
 * carries it (editing apps often strip it). Plain styling for now.
 */

const KEEP = 'pc-exif-members';
const W = 2160; // 4:5 at twice Instagram's 1080
const FONT = '-apple-system, "Pretendard Variable", Pretendard, "Helvetica Neue", Arial, sans-serif';

const loadImage = (file) => new Promise((resolve, reject) => {
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = () => reject(new Error('이 형식은 이 브라우저에서 열 수 없어요. JPEG로 올려 주세요.'));
  im.src = URL.createObjectURL(file);
});

/** One edit in its frame: the photo, then the details and the credit underneath. */
function drawFrame(canvas, img, info, frame, ratio) {
  const ink = frame === 'black' ? '#f2f2f2' : '#111';
  const soft = frame === 'black' ? '#9a9a9a' : '#777';
  let w;
  let h;
  let pad;
  let bar;
  let box;
  if (ratio === '4:5') {
    w = W; h = Math.round(W * 1.25); pad = Math.round(W * 0.06); bar = Math.round(W * 0.15);
    box = { x: pad, y: pad, w: w - pad * 2, h: h - pad - bar };
  } else {
    const unit = Math.max(img.naturalWidth, img.naturalHeight) / 100;
    pad = Math.round(unit * 3); bar = Math.round(unit * 12);
    w = img.naturalWidth + pad * 2; h = img.naturalHeight + pad + bar;
    box = { x: pad, y: pad, w: img.naturalWidth, h: img.naturalHeight };
  }
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = frame === 'black' ? '#111' : '#fff';
  ctx.fillRect(0, 0, w, h);
  const s = Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight);
  const pw = img.naturalWidth * s;
  const ph = img.naturalHeight * s;
  const px = box.x + (box.w - pw) / 2;
  const py = box.y + (box.h - ph) / 2;
  ctx.drawImage(img, px, py, pw, ph);

  // details under the photo, lined up with its edges
  const u = w / 100;
  const top = py + ph + bar * 0.28;
  ctx.textBaseline = 'middle';
  const line = (text, x, y, size, weight, color, align) => {
    ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(text || '', x, y);
  };
  line(info.camera, px, top, u * 2.3, 700, ink, 'left');
  line(info.lens, px, top + u * 3, u * 1.7, 500, soft, 'left');
  line(info.settings, px + pw, top, u * 2.1, 600, ink, 'right');
  line(info.taken, px + pw, top + u * 3, u * 1.7, 500, soft, 'right');
  line(info.credit, px, top + u * 6.6, u * 1.8, 600, ink, 'left');
}

/** The three edits on one slide, each with its editor's name. */
function drawCompare(canvas, edits, channel, frame) {
  const ink = frame === 'black' ? '#f2f2f2' : '#111';
  const h = Math.round(W * 1.25);
  canvas.width = W;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = frame === 'black' ? '#111' : '#fff';
  ctx.fillRect(0, 0, W, h);
  const pad = W * 0.06;
  const label = W * 0.035;
  const wide = edits[0].img.naturalWidth >= edits[0].img.naturalHeight;
  const n = edits.length;
  // landscape photos stacked, portrait ones side by side
  const cellW = wide ? W - pad * 2 : (W - pad * (n + 1)) / n;
  const cellH = wide ? (h - pad * (n + 1) - W * 0.06) / n - label : h - pad * 2 - W * 0.06 - label;
  ctx.textBaseline = 'middle';
  edits.forEach((e, k) => {
    const x = wide ? pad : pad + k * (cellW + pad);
    const y = wide ? pad + k * (cellH + label + pad) : pad;
    const s = Math.min(cellW / e.img.naturalWidth, cellH / e.img.naturalHeight);
    const pw = e.img.naturalWidth * s;
    const ph = e.img.naturalHeight * s;
    ctx.drawImage(e.img, x + (cellW - pw) / 2, y + (cellH - ph) / 2, pw, ph);
    ctx.font = `600 ${Math.round(W * 0.018)}px ${FONT}`;
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.fillText(`보정 ${e.name}`, x + cellW / 2, y + cellH + label * 0.6);
  });
  ctx.font = `700 ${Math.round(W * 0.022)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(channel, W / 2, h - W * 0.05);
}

const toFile = (canvas, name) => new Promise((resolve) => canvas.toBlob((b) => resolve(new File([b], name, { type: 'image/jpeg' })), 'image/jpeg', 0.95));

export default function Client() {
  const [members, setMembers] = useState(['A', 'B', 'C']);
  const [channel, setChannel] = useState('필름곳간');
  const [shooter, setShooter] = useState(0);
  const [edits, setEdits] = useState([null, null, null]); // { img, exif }
  const [original, setOriginal] = useState(null);
  const [lines, setLines] = useState({ camera: '', lens: '', settings: '', taken: '' });
  const [frame, setFrame] = useState('white');
  const [ratio, setRatio] = useState('4:5');
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const frames = useRef([]);
  const compare = useRef(null);

  useEffect(() => {
    try {
      const kept = JSON.parse(localStorage.getItem(KEEP) ?? 'null');
      if (kept?.members?.length === 3) setMembers(kept.members);
      if (kept?.channel) setChannel(kept.channel);
    } catch { /* first visit or private mode */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(KEEP, JSON.stringify({ members, channel })); } catch { /* private mode */ }
  }, [members, channel]);

  // the details: from the original if there is one, else the first edit that still has them
  useEffect(() => {
    const source = [original, ...edits].find((x) => x && Object.keys(x.exif).length);
    if (source) setLines(caption(source.exif));
  }, [original, edits]);

  async function read(file) {
    const exif = readExif(await file.arrayBuffer());
    return { img: await loadImage(file), exif };
  }
  async function pickEdit(k, file) {
    if (!file) return;
    setNote(null);
    try {
      const got = await read(file);
      setEdits((e) => e.map((x, i) => (i === k ? got : x)));
    } catch (e) { setNote(e.message); }
  }
  async function pickOriginal(file) {
    if (!file) return;
    try { setOriginal(await read(file)); } catch (e) { setNote(e.message); }
  }

  const ready = edits.map((e, k) => (e ? { ...e, k, name: members[k] } : null)).filter(Boolean);
  const credit = (k) => `${channel} · 촬영 ${members[shooter]} · 보정 ${members[k]}`;
  const noExif = ready.length > 0 && !lines.camera && !lines.settings;

  useEffect(() => {
    ready.forEach((e) => {
      const c = frames.current[e.k];
      if (c) drawFrame(c, e.img, { ...lines, credit: credit(e.k) }, frame, ratio);
    });
    if (compare.current && ready.length >= 2) drawCompare(compare.current, ready, channel, frame);
  });

  async function saveAll() {
    setBusy(true);
    try {
      const stamp = (lines.taken || new Date().toISOString().slice(0, 10)).replace(/[^\d]/g, '').slice(0, 8);
      const files = [];
      if (ready.length >= 2 && compare.current) files.push(await toFile(compare.current, `${stamp}-0-compare.jpg`));
      for (const e of ready) files.push(await toFile(frames.current[e.k], `${stamp}-${e.k + 1}.jpg`));
      // phones: one share sheet saves them all to the photo library; elsewhere, plain downloads
      if (navigator.canShare?.({ files })) {
        try { await navigator.share({ files }); return; } catch (err) { if (err.name === 'AbortError') return; }
      }
      for (const f of files) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(f);
        a.download = f.name;
        a.click();
        await new Promise((r) => setTimeout(r, 300));
      }
    } finally { setBusy(false); }
  }

  const set = (k) => (e) => setLines((l) => ({ ...l, [k]: e.target.value }));
  return (
    <main className="ex">
      <h1>{channel || '필름곳간'} 프레임</h1>
      <p className="ex-sub">한 사람이 찍고 세 사람이 보정한 사진을 한 번에 프레임에 넣어요. 사진은 이 기기 밖으로 나가지 않아요.</p>

      <section className="ex-sec">
        <h2>멤버</h2>
        <div className="ex-members">
          {members.map((m, k) => (
            <input key={k} value={m} aria-label={`멤버 ${k + 1}`}
                   onChange={(e) => setMembers((ms) => ms.map((x, i) => (i === k ? e.target.value : x)))} />
          ))}
        </div>
        <label className="ex-row">채널 이름<input value={channel} onChange={(e) => setChannel(e.target.value)} /></label>
      </section>

      <section className="ex-sec">
        <h2>이번 사진</h2>
        <div className="ex-choice" role="radiogroup" aria-label="촬영">
          <span>촬영</span>
          {members.map((m, k) => (
            <button key={k} role="radio" aria-checked={shooter === k} onClick={() => setShooter(k)}>{m}</button>
          ))}
        </div>
        <div className="ex-slots">
          {members.map((m, k) => (
            <label key={k} className="ex-slot" data-filled={edits[k] ? '' : undefined}>
              <input type="file" accept="image/jpeg,image/*" onChange={(e) => pickEdit(k, e.target.files?.[0])} />
              <b>{m} 보정본</b>
              <span>{edits[k] ? '바꾸기' : '고르기'}</span>
            </label>
          ))}
        </div>
        <label className="ex-orig">
          <input type="file" accept="image/jpeg,image/*" onChange={(e) => pickOriginal(e.target.files?.[0])} />
          <span>{original ? '원본 바꾸기' : '원본도 넣기 (선택)'}</span>
          <small>보정본에서 촬영 정보가 지워졌으면 원본에서 읽어요</small>
        </label>
        {note && <p className="ex-note">{note}</p>}
        {noExif && <p className="ex-note">촬영 정보를 찾지 못했어요. 원본을 넣거나 아래 칸에 직접 적어 주세요.</p>}
      </section>

      {ready.length > 0 && (
        <>
          <section className="ex-sec">
            <h2>촬영 정보</h2>
            <div className="ex-fields">
              <label>카메라<input value={lines.camera} onChange={set('camera')} /></label>
              <label>렌즈<input value={lines.lens} onChange={set('lens')} /></label>
              <label>설정<input value={lines.settings} onChange={set('settings')} /></label>
              <label>날짜<input value={lines.taken} onChange={set('taken')} /></label>
            </div>
            <div className="ex-choice">
              <span>프레임</span>
              {[['white', '흰색'], ['black', '검정']].map(([k, l]) => <button key={k} aria-checked={frame === k} onClick={() => setFrame(k)}>{l}</button>)}
              <span>비율</span>
              {[['4:5', '4:5 인스타'], ['orig', '원본']].map(([k, l]) => <button key={k} aria-checked={ratio === k} onClick={() => setRatio(k)}>{l}</button>)}
            </div>
          </section>

          <section className="ex-sec">
            <h2>미리보기</h2>
            <div className="ex-out">
              {ready.length >= 2 && <figure><canvas ref={compare} /><figcaption>비교 (첫 장)</figcaption></figure>}
              {ready.map((e) => (
                <figure key={e.k}><canvas ref={(c) => { frames.current[e.k] = c; }} /><figcaption>{members[e.k]} 보정</figcaption></figure>
              ))}
            </div>
            <button className="ex-save" onClick={saveAll} disabled={busy}>{busy ? '만드는 중…' : `${ready.length + (ready.length >= 2 ? 1 : 0)}장 저장하기`}</button>
          </section>
        </>
      )}
    </main>
  );
}
