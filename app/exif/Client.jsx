'use client';

import { useEffect, useRef, useState } from 'react';
import { readExif, caption } from './exif';

/**
 * A photo in a frame with its shooting details underneath: pick a photo, the
 * camera, lens and settings are read from its EXIF, every line can be edited,
 * and the framed picture is drawn on a canvas at full resolution to save.
 * Plain for now; the look is still to be decided.
 */

const FRAMES = [['white', '흰색'], ['black', '검정']];

function draw(canvas, img, lines, frame) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const unit = Math.max(w, h) / 100;
  const pad = Math.round(unit * 3);
  const bar = Math.round(unit * 11);
  canvas.width = w + pad * 2;
  canvas.height = h + pad + bar;
  const ctx = canvas.getContext('2d');
  const bg = frame === 'black' ? '#111' : '#fff';
  const ink = frame === 'black' ? '#f2f2f2' : '#111';
  const soft = frame === 'black' ? '#9a9a9a' : '#777';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, pad, pad, w, h);

  const font = '-apple-system, "Pretendard Variable", Pretendard, "Helvetica Neue", Arial, sans-serif';
  const mid = h + pad + bar / 2;
  const big = Math.round(unit * 2.6);
  const small = Math.round(unit * 2);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  ctx.font = `700 ${big}px ${font}`;
  ctx.textAlign = 'left';
  ctx.fillText(lines.camera || '', pad, mid - big * 0.55);
  ctx.fillStyle = soft;
  ctx.font = `500 ${small}px ${font}`;
  ctx.fillText(lines.lens || '', pad, mid + big * 0.6);
  ctx.textAlign = 'right';
  ctx.fillStyle = ink;
  ctx.font = `600 ${big}px ${font}`;
  ctx.fillText(lines.settings || '', pad + w, mid - big * 0.55);
  ctx.fillStyle = soft;
  ctx.font = `500 ${small}px ${font}`;
  ctx.fillText(lines.taken || '', pad + w, mid + big * 0.6);
}

export default function Client() {
  const [img, setImg] = useState(null);
  const [name, setName] = useState('photo');
  const [lines, setLines] = useState({ camera: '', lens: '', settings: '', taken: '' });
  const [frame, setFrame] = useState('white');
  const [note, setNote] = useState(null);
  const canvas = useRef(null);

  async function pick(file) {
    if (!file) return;
    setNote(null);
    setName(file.name.replace(/\.[^.]+$/, '') || 'photo');
    const buf = await file.arrayBuffer();
    const found = readExif(buf);
    setLines(caption(found));
    if (!Object.keys(found).length) setNote('이 사진에서 EXIF 정보를 찾지 못했어요. 아래 칸에 직접 적을 수 있어요.');
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => setImg(im);
    im.onerror = () => setNote('이 형식은 이 브라우저에서 열 수 없어요. JPEG로 올려 주세요.');
    im.src = url;
  }

  useEffect(() => { if (img && canvas.current) draw(canvas.current, img, lines, frame); }, [img, lines, frame]);

  function save() {
    canvas.current.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}-frame.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/jpeg', 0.95);
  }

  const set = (k) => (e) => setLines((l) => ({ ...l, [k]: e.target.value }));
  return (
    <main className="ex">
      <h1>EXIF 프레임</h1>
      <p className="ex-sub">사진을 고르면 촬영 정보를 읽어 프레임에 넣어요. 사진은 이 기기 밖으로 나가지 않아요.</p>
      <label className="ex-pick">
        <input type="file" accept="image/jpeg,image/*" onChange={(e) => pick(e.target.files?.[0])} />
        <span>{img ? '다른 사진 고르기' : '사진 고르기'}</span>
      </label>
      {note && <p className="ex-note">{note}</p>}
      {img && (
        <>
          <div className="ex-fields">
            <label>카메라<input value={lines.camera} onChange={set('camera')} /></label>
            <label>렌즈<input value={lines.lens} onChange={set('lens')} /></label>
            <label>설정<input value={lines.settings} onChange={set('settings')} /></label>
            <label>날짜<input value={lines.taken} onChange={set('taken')} /></label>
          </div>
          <div className="ex-frames" role="radiogroup" aria-label="프레임 색">
            {FRAMES.map(([k, label]) => (
              <button key={k} role="radio" aria-checked={frame === k} onClick={() => setFrame(k)}>{label}</button>
            ))}
          </div>
          <canvas ref={canvas} className="ex-canvas" />
          <button className="ex-save" onClick={save}>저장하기</button>
        </>
      )}
    </main>
  );
}
