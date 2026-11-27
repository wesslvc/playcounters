'use client';

import { useEffect, useRef, useState } from 'react';
import { readExif, caption } from './exif';
import { drawFrame, drawCompare, layout, makerLogoFile } from './frame';

/**
 * 필름곳간: one person shoots, all three edit the same photo, and the three
 * edits go up together. A post here is that set — who shot it, each
 * member's edit — and comes out as one framed picture per edit, credited
 * with the members' marks and the camera, plus a first slide with the edits
 * together. The frame itself is in frame.js. EXIF comes from the original
 * if given, else from whichever edit still carries it (editing apps often
 * strip it). Each member has a mark built in; one picked here replaces it
 * on this device only.
 */

const KEEP = 'pc-exif-members';
const LOGOS = 'pc-exif-logos';
// the members' own marks, in the order of the default members
const BUILT_IN = ['/exif/logos/magpie-small.svg', '/exif/logos/pencil-small.svg', '/exif/logos/rock-small.svg'];

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
  const [shooter, setShooter] = useState(0);
  const [edits, setEdits] = useState([null, null, null]); // { img, exif }
  const [original, setOriginal] = useState(null);
  const [lines, setLines] = useState({ make: '', model: '', settings: '', lens: '', taken: '' });
  const [custom, setCustom] = useState([null, null, null]); // logos picked on this device, as data URLs
  const [logos, setLogos] = useState([null, null, null]);
  const [makerLogo, setMakerLogo] = useState(null); // the camera maker's logo, when we have one
  const [place, setPlace] = useState(''); // where it was taken, typed by hand, for the first slide
  const [, setFontReady] = useState(false);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const frames = useRef([]);
  const compare = useRef(null);

  useEffect(() => {
    try {
      const kept = JSON.parse(localStorage.getItem(KEEP) ?? 'null');
      if (kept?.members?.length === 3) setMembers(kept.members);
    } catch { /* first visit or private mode */ }
    try {
      const kept = JSON.parse(localStorage.getItem(LOGOS) ?? 'null');
      if (kept?.members?.length === 3) setCustom(kept.members);
    } catch { /* none yet */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(KEEP, JSON.stringify({ members })); } catch { /* private mode */ }
  }, [members]);

  // the frame's fonts come from the web: draw again once they have loaded
  useEffect(() => {
    const faces = ['400 40px "Newsreader"', '600 40px "Inter Tight"', '500 40px "Inter Tight"', '500 40px "IBM Plex Mono"', '600 40px "Wanted Sans Variable"'];
    Promise.all(faces.map((f) => document.fonts?.load?.(f, 'Aa가1'))).then(() => setFontReady(true)).catch(() => setFontReady(true));
  }, []);

  // each member's mark: the one picked on this device, else the built-in one
  const logoSrc = (k) => custom[k] || BUILT_IN[k];
  useEffect(() => {
    Promise.all([0, 1, 2].map((k) => loadImage(logoSrc(k)).catch(() => null))).then(setLogos);
  }, [custom]); // eslint-disable-line react-hooks/exhaustive-deps
  function keepCustom(next) {
    setCustom(next);
    try { localStorage.setItem(LOGOS, JSON.stringify({ members: next })); } catch { setNote('로고가 너무 커서 이 기기에 저장하지 못했어요.'); }
  }
  async function pickLogo(k, file) {
    if (!file) return;
    try {
      const d = await logoData(file);
      keepCustom(custom.map((x, i) => (i === k ? d : x)));
    } catch (e) { setNote(e.message); }
  }

  // the details: from the original if there is one, else the first edit that still has them
  useEffect(() => {
    const source = [original, ...edits].find((x) => x && Object.keys(x.exif).length);
    if (source) {
      const c = caption(source.exif);
      setLines({ make: c.make, model: c.model, settings: c.settings, lens: c.lens, taken: c.taken });
    }
  }, [original, edits]);

  const makerSrc = makerLogoFile(lines.make, lines.model);
  useEffect(() => {
    let live = true;
    if (!makerSrc) { setMakerLogo(null); return undefined; }
    loadImage(makerSrc).then((im) => { if (live) setMakerLogo(im); }).catch(() => { if (live) setMakerLogo(null); });
    return () => { live = false; };
  }, [makerSrc]);

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

  const ready = edits.map((e, k) => (e ? { ...e, k, name: members[k], logo: logos[k] } : null)).filter(Boolean);
  const noExif = ready.length > 0 && !lines.make && !lines.model && !lines.settings && !lines.lens;

  useEffect(() => {
    if (!ready.length) return;
    // every slide the size of the first edit's, so the carousel keeps one shape
    const L = layout(ready[0].img);
    const base = { ...lines, shooter: members[shooter], makerLogo, place };
    ready.forEach((e) => {
      const c = frames.current[e.k];
      if (c) drawFrame(c, e.img, { ...base, editor: e.name, own: e.k === shooter, frame: `${e.k + 1}A` }, { shooter: logos[shooter], editor: e.logo }, L);
    });
    if (compare.current && ready.length >= 2) drawCompare(compare.current, ready, base, { shooter: logos[shooter] }, L);
  });

  async function saveAll() {
    setBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
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
    <div className="ex-page">
    <main className="ex">
      <h1>필름곳간<em>frame</em></h1>
      <p className="ex-sub">한 사람이 찍고 세 사람이 보정한 사진을 한 번에 프레임에 넣어요. 사진은 이 기기 밖으로 나가지 않아요.</p>

      <section className="ex-sec">
        <h2><small>01</small>멤버</h2>
        <div className="ex-members">
          {members.map((m, k) => (
            <div key={k} className="ex-member">
              <label className="ex-logo">
                <input type="file" accept="image/png,image/svg+xml,image/*" onChange={(e) => pickLogo(k, e.target.files?.[0])} />
                <img src={logoSrc(k)} alt="" />
              </label>
              <input value={m} aria-label={`멤버 ${k + 1}`}
                     onChange={(e) => setMembers((ms) => ms.map((x, i) => (i === k ? e.target.value : x)))} />
              {custom[k] && <button className="ex-reset" onClick={() => keepCustom(custom.map((x, i) => (i === k ? null : x)))}>기본 로고로</button>}
            </div>
          ))}
        </div>
        <p className="ex-hint">로고를 누르면 다른 이미지로 바꿀 수 있어요.</p>
      </section>

      <section className="ex-sec">
        <h2><small>02</small>이번 사진</h2>
        <div className="ex-choice" role="radiogroup" aria-label="촬영">
          <span>촬영</span>
          {members.map((m, k) => (
            <button key={k} role="radio" aria-checked={shooter === k} onClick={() => setShooter(k)}>{m}</button>
          ))}
        </div>
        <div className="ex-slots">
          {members.map((m, k) => (
            <label key={k} className="ex-slot" data-filled={edits[k] ? '' : undefined}
                   style={edits[k] ? { backgroundImage: `url(${edits[k].img.src})` } : undefined}>
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
            <h2><small>03</small>촬영 정보</h2>
            <div className="ex-fields">
              <label>제조사<input value={lines.make} onChange={set('make')} placeholder="FUJIFILM" /></label>
              <label>기종<input value={lines.model} onChange={set('model')} placeholder="X100V" /></label>
              <label>설정<input value={lines.settings} onChange={set('settings')} placeholder="23mm  f/2  1/250s  ISO200" /></label>
              <label>렌즈<input value={lines.lens} onChange={set('lens')} placeholder="(선택)" /></label>
              <label>날짜<input value={lines.taken} onChange={set('taken')} placeholder="2026.11.27 14:03" /></label>
              <label className="ex-wide">장소<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="예: 서울 성수동, 제주 협재해변" /></label>
            </div>
            <p className="ex-hint">보정본마다 카메라, 기종, 설정값이 들어가요. 첫 장(세 장 모음)에는 장소, 렌즈, 날짜까지 전부 들어가요.</p>
          </section>

          <section className="ex-sec">
            <h2><small>04</small>미리보기</h2>
            <div className="ex-out">
              {ready.length >= 2 && <figure><canvas ref={compare} /><figcaption>비교 (첫 장)</figcaption></figure>}
              {ready.map((e) => (
                <figure key={e.k}><canvas ref={(c) => { frames.current[e.k] = c; }} /><figcaption>{members[e.k]} 보정{e.k === shooter ? ' (찍은 사람)' : ''}</figcaption></figure>
              ))}
            </div>
            <button className="ex-save" onClick={saveAll} disabled={busy}>{busy ? '만드는 중…' : `${ready.length + (ready.length >= 2 ? 1 : 0)}장 저장하기`}</button>
          </section>
        </>
      )}
    </main>
    </div>
  );
}
