'use client';

import { useEffect, useRef, useState } from 'react';
import { readExif, caption } from './exif';
import { drawFrame, drawCompare, layout } from './frame';

/**
 * 필름곳간: one person shoots, all three edit the same photo, and the three
 * edits go up together. A post here is that set — who shot it, each
 * member's edit — and comes out as one framed picture per edit, credited
 * (shot by on one side, edited by on the other, each with the member's
 * logo) with the shooting details, plus a first slide with the three
 * together. The frame itself is in frame.js. EXIF comes from the original
 * if given, else from whichever edit still carries it (editing apps often
 * strip it). Logos are kept on the device.
 */

const KEEP = 'pc-exif-members';
const LOGOS = 'pc-exif-logos';

const loadImage = (file) => new Promise((resolve, reject) => {
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = () => reject(new Error('이 형식은 이 브라우저에서 열 수 없어요. JPEG로 올려 주세요.'));
  im.src = typeof file === 'string' ? file : URL.createObjectURL(file);
});

/** A logo shrunk to 512 px and kept as a data URL, small enough to remember on the device. */
async function logoData(file) {
  const im = await loadImage(file);
  const s = Math.min(1, 512 / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(im.naturalWidth * s);
  c.height = Math.round(im.naturalHeight * s);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

const toFile = (canvas, name) => new Promise((resolve) => canvas.toBlob((b) => resolve(new File([b], name, { type: 'image/jpeg' })), 'image/jpeg', 0.95));

export default function Client() {
  const [members, setMembers] = useState(['1.slvc', 'x1x0xn', 'rock__eeeyeee']);
  const [channel, setChannel] = useState('필름곳간');
  const [shooter, setShooter] = useState(0);
  const [edits, setEdits] = useState([null, null, null]); // { img, exif }
  const [original, setOriginal] = useState(null);
  const [lines, setLines] = useState({ camera: '', lens: '', settings: '', taken: '' });
  const [frame, setFrame] = useState('white');
  const [no, setNo] = useState('01'); // the post's number, printed on the film edge
  const [logoData_, setLogoData] = useState({ members: [null, null, null], channel: null });
  const [logos, setLogos] = useState({ members: [null, null, null], channel: null });
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

  // logos: kept on the device as data URLs, turned into images to draw with
  useEffect(() => {
    try { const kept = JSON.parse(localStorage.getItem(LOGOS) ?? 'null'); if (kept) setLogoData(kept); } catch { /* none yet */ }
  }, []);
  useEffect(() => {
    const load = (d) => (d ? loadImage(d).catch(() => null) : Promise.resolve(null));
    Promise.all([...logoData_.members.map(load), load(logoData_.channel)])
      .then(([a, b, c, ch]) => setLogos({ members: [a, b, c], channel: ch }));
  }, [logoData_]);
  async function pickLogo(which, file) {
    if (!file) return;
    try {
      const d = await logoData(file);
      const next = which === 'channel'
        ? { ...logoData_, channel: d }
        : { ...logoData_, members: logoData_.members.map((x, i) => (i === which ? d : x)) };
      setLogoData(next);
      try { localStorage.setItem(LOGOS, JSON.stringify(next)); } catch { setNote('로고가 너무 커서 이 기기에 저장하지 못했어요.'); }
    } catch (e) { setNote(e.message); }
  }

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

  const ready = edits.map((e, k) => (e ? { ...e, k, name: members[k], logo: logos.members[k] } : null)).filter(Boolean);
  const noExif = ready.length > 0 && !lines.camera && !lines.settings;

  useEffect(() => {
    if (!ready.length) return;
    // every slide the size of the first edit's, so the carousel keeps one shape
    const L = layout(ready[0].img);
    const base = { ...lines, shooter: members[shooter], channel, no };
    ready.forEach((e) => {
      const c = frames.current[e.k];
      if (c) drawFrame(c, e.img, { ...base, editor: e.name, frameTag: 'ABC'[e.k] }, { shooter: logos.members[shooter], editor: e.logo, channel: logos.channel }, frame, L);
    });
    if (compare.current && ready.length >= 2) drawCompare(compare.current, ready, base, { shooter: logos.members[shooter], channel: logos.channel }, frame, L);
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
        <div className="ex-logos">
          {members.map((m, k) => (
            <label key={k} className="ex-logo">
              <input type="file" accept="image/png,image/*" onChange={(e) => pickLogo(k, e.target.files?.[0])} />
              {logoData_.members[k] ? <img src={logoData_.members[k]} alt="" /> : <i>{(m || '?').slice(0, 1).toUpperCase()}</i>}
              <span>{m} 로고</span>
            </label>
          ))}
          <label className="ex-logo">
            <input type="file" accept="image/png,image/*" onChange={(e) => pickLogo('channel', e.target.files?.[0])} />
            {logoData_.channel ? <img src={logoData_.channel} alt="" /> : <i>곳</i>}
            <span>채널 로고</span>
          </label>
        </div>
        <label className="ex-row">채널 이름<input value={channel} onChange={(e) => setChannel(e.target.value)} /></label>
      </section>

      <section className="ex-sec">
        <h2>이번 사진</h2>
        <label className="ex-row">게시물 번호<input value={no} onChange={(e) => setNo(e.target.value.slice(0, 4))} /></label>
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
