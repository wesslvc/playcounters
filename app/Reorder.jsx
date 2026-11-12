'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Cover } from './ui';
import { smoothness } from '@/lib/reorder';

const MODES = [
  ['flow', '흐름 좋게', '템포와 에너지가 자연스럽게 이어지게'],
  ['rise', '점점 신나게', '차분하게 시작해서 끝으로 갈수록 올라가게'],
  ['calm', '점점 차분하게', '신나게 시작해서 점점 가라앉게'],
  ['group', '비슷한 곡끼리', '분위기와 장르가 닮은 곡끼리 묶어서'],
  ['plays', '많이 들은 순', '내 재생 횟수가 많은 곡부터 (AI 없이)'],
  ['custom', '직접 쓰기', '원하는 순서를 말로 적어서'],
];

const undoKey = (id) => `pc-plundo-${id}`;
const readUndo = (id) => { try { return JSON.parse(localStorage.getItem(undoKey(id)) ?? 'null'); } catch { return null; } };
const writeUndo = (id, v) => { try { if (v) localStorage.setItem(undoKey(id), JSON.stringify(v)); else localStorage.removeItem(undoKey(id)); } catch { /* private mode */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, body, signal) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal });
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || j.error) { const e = new Error(j.error || `HTTP ${res.status}`); e.reauth = j.reauth; throw e; }
  return j;
}

/** Indices into `entries` in the order `uris` lists them; a song in twice is matched twice, anything unlisted goes last. */
function orderFrom(entries, uris) {
  const at = new Map();
  entries.forEach((e, i) => { if (!at.has(e.uri)) at.set(e.uri, []); at.get(e.uri).push(i); });
  const out = [];
  const used = new Set();
  for (const u of uris) {
    const l = at.get(u);
    if (l?.length) { const i = l.shift(); out.push(i); used.add(i); }
  }
  entries.forEach((_, i) => { if (!used.has(i)) out.push(i); });
  return out;
}

/** Energy along the list, the playlist's order faint and the edited one bold. */
function Curve({ before, after }) {
  const W = 600;
  const H = 120;
  const line = (seq) => {
    const n = Math.max(1, seq.length - 1);
    return seq.map((s, i) => (s.energy == null ? null : `${((i / n) * W).toFixed(1)},${(H - 8 - s.energy * (H - 16)).toFixed(1)}`))
      .filter(Boolean).join(' ');
  };
  return (
    <svg className="ro-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="곡 순서에 따른 에너지">
      <polyline points={line(before)} className="was" vectorEffect="non-scaling-stroke" />
      <polyline points={line(after)} className="now" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * An order to look over and change by hand before anything happens: rows are
 * dragged by their handle (the rest of the row still scrolls the page), the
 * energy curve and the jumps between neighbours follow the edits, and only
 * the save button puts it on Spotify.
 */
function Editor({ plan, kind, onSave, onCancel, onRedo }) {
  const bySong = useMemo(() => new Map(plan.songs.map((s) => [s.i, s])), [plan]);
  const base = useMemo(() => plan.songs.map((s) => s.i), [plan]);
  const [seq, setSeq] = useState(() => plan.order.filter((i) => bySong.has(i)));
  const [drag, setDrag] = useState(null);
  const d = useRef(null);
  useEffect(() => () => cancelAnimationFrame(d.current?.raf), []);

  const rest = plan.order.filter((i) => !bySong.has(i));
  const place = useMemo(() => new Map(base.map((i, j) => [i, j])), [base]);
  const changed = seq.some((i, j) => i !== base[j]);
  const movedCount = seq.filter((i, j) => place.get(i) !== j).length;
  const before = smoothness(base.map((i) => bySong.get(i)));
  const after = smoothness(seq.map((i) => bySong.get(i)));
  const n = seq.length;

  const update = () => {
    const x = d.current;
    if (!x) return;
    const dy = x.y - x.y0 + (window.scrollY - x.s0);
    const to = Math.max(0, Math.min(n - 1, x.from + Math.round(dy / x.h)));
    x.to = to;
    setDrag({ from: x.from, to, dy, h: x.h });
  };
  const start = (e, j) => {
    e.preventDefault();
    const h = e.currentTarget.closest('li').getBoundingClientRect().height;
    e.currentTarget.setPointerCapture(e.pointerId);
    d.current = { from: j, to: j, y0: e.clientY, y: e.clientY, s0: window.scrollY, h, raf: 0 };
    setDrag({ from: j, to: j, dy: 0, h });
    // near the top or bottom of the screen the page scrolls along
    const tick = () => {
      const x = d.current;
      if (!x) return;
      if (x.y < 110) window.scrollBy(0, -10);
      else if (x.y > window.innerHeight - 110) window.scrollBy(0, 10);
      update();
      x.raf = requestAnimationFrame(tick);
    };
    d.current.raf = requestAnimationFrame(tick);
  };
  const move = (e) => { if (d.current) { d.current.y = e.clientY; update(); } };
  const end = () => {
    const x = d.current;
    if (!x) return;
    cancelAnimationFrame(x.raf);
    d.current = null;
    setDrag(null);
    if (x.to !== x.from) setSeq((s) => { const a = [...s]; const [v] = a.splice(x.from, 1); a.splice(x.to, 0, v); return a; });
  };
  const shift = (j) => {
    if (!drag || j === drag.from) return 0;
    if (drag.from < drag.to && j > drag.from && j <= drag.to) return -drag.h;
    if (drag.to < drag.from && j >= drag.to && j < drag.from) return drag.h;
    return 0;
  };

  const title = kind === 'ai' ? '새 순서' : kind === 'undo' ? '바꾸기 전 순서' : '지금 순서';
  const better = (a, b) => (a != null && b != null ? `${a} → ${b}` : null);
  return (
    <div className="ro">
      <p className="ro-k">{title}</p>
      {kind === 'ai' && plan.note && <p className="ro-note">{plan.note}</p>}
      {kind === 'undo' && <p className="ro-note">바꾸기 전 순서를 불러왔어요. 저장을 눌러야 Spotify에 적용돼요.</p>}
      <p className="ro-sub">오른쪽 손잡이를 끌어서 곡을 옮길 수 있어요.</p>
      {plan.numbers > 1 && changed && (
        <>
          <Curve before={base.map((i) => bySong.get(i))} after={seq.map((i) => bySong.get(i))} />
          <p className="ro-legend"><i className="was" />지금 순서 <i className="now" />바뀐 순서 · 곡 순서에 따른 에너지</p>
          <div className="ro-stats">
            {better(before.bpm, after.bpm) && <span><b>{better(before.bpm, after.bpm)}</b><small>앞뒤 곡 템포 차이 (BPM)</small></span>}
            {better(before.energy, after.energy) && <span><b>{better(before.energy, after.energy)}</b><small>앞뒤 곡 에너지 차이</small></span>}
          </div>
        </>
      )}
      <ol className="ro-list" data-dragging={drag ? '' : undefined}>
        {seq.map((i, j) => {
          const s = bySong.get(i);
          const moved = place.get(i) - j;
          const lifted = drag?.from === j;
          return (
            <li key={i} data-lifted={lifted || undefined}
                style={drag ? { transform: `translateY(${lifted ? drag.dy : shift(j)}px)`, transition: lifted ? 'none' : undefined } : undefined}>
              <span className="ro-n">{j + 1}</span>
              <Cover src={s.image} size={36} />
              <span className="ro-nm"><b>{s.track}</b><small>{[s.artist, s.tempo && `${s.tempo} BPM`, s.key].filter(Boolean).join(' · ')}</small></span>
              <span className="ro-mv" data-up={moved > 0 || undefined} data-down={moved < 0 || undefined}>
                {moved === 0 ? '' : `${moved > 0 ? '▲' : '▼'}${Math.abs(moved)}`}
              </span>
              <button className="ro-grip" aria-label={`${s.track} 옮기기`}
                      onPointerDown={(e) => start(e, j)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
                <svg viewBox="0 0 12 20" aria-hidden="true">{[4, 10, 16].flatMap((y) => [<circle key={`a${y}`} cx="3" cy={y} r="1.6" />, <circle key={`b${y}`} cx="9" cy={y} r="1.6" />])}</svg>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="ro-save">
        <span>{changed ? `${movedCount}곡 자리가 바뀌어요` : '바뀐 곳이 없어요'}</span>
        <div>
          <button className="btn ghost" onClick={onCancel}>취소</button>
          {kind === 'ai' && <button className="btn ghost" onClick={onRedo}>다시 짜기</button>}
          <button className="btn" disabled={!changed} onClick={() => onSave([...seq, ...rest].map((x) => plan.entries[x].uri))}>저장</button>
        </div>
      </div>
      <p className="ro-sub">저장하면 Spotify에 적용돼요. 곡마다 추가된 날짜는 그대로이고, 바꾸기 전 순서는 이 기기에 남겨 둬요.</p>
    </div>
  );
}

/**
 * Reordering one of your playlists: by the model from each song's numbers
 * (tempo, energy, key), or by hand from the order it's in now. Either way the
 * order opens in the editor first and nothing reaches Spotify until it's
 * saved. The order before a save is kept on this device and can be loaded
 * back into the editor — loaded, not applied.
 */
export default function Reorder({ id, estimate }) {
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(null);
  const [mode, setMode] = useState('flow');
  const [prompt, setPrompt] = useState('');
  const [plan, setPlan] = useState(null);
  const [kind, setKind] = useState(null);
  const [error, setError] = useState(null);
  const [undo, setUndo] = useState(null);
  const [saved, setSaved] = useState(false);
  const ctl = useRef(null);

  useEffect(() => { setUndo(readUndo(id)); return () => ctl.current?.abort(); }, [id]);
  const fresh = () => { ctl.current?.abort(); ctl.current = new AbortController(); return ctl.current.signal; };
  const fail = (e) => { if (e.name !== 'AbortError') { setError(e); setPhase('error'); } };
  const url = (what) => `/api/playlists/${encodeURIComponent(id)}/${what}`;

  async function analyse() {
    const signal = fresh();
    setError(null);
    setSaved(false);
    setPhase('analysing');
    try {
      for (let round = 0; round < 30; round += 1) {
        const j = await post(url('analyze'), {}, signal);
        setProgress(j);
        if (!j.pending) break;
      }
      setPhase('pick');
    } catch (e) { fail(e); }
  }

  async function think() {
    const signal = fresh();
    setError(null);
    setPhase('thinking');
    try {
      const j = await post(url('order'), { mode, prompt, estimate }, signal);
      setPlan(j);
      setKind('ai');
      setPhase('edit');
    } catch (e) { fail(e); }
  }

  // the playlist as it is now, for editing by hand or for the old order to be laid over
  async function current(as) {
    const signal = fresh();
    setError(null);
    setSaved(false);
    setPhase('loading');
    try {
      const j = await post(url('order'), { mode: 'current', estimate }, signal);
      setPlan(as === 'undo' ? { ...j, order: orderFrom(j.entries, undo.uris) } : j);
      setKind(as);
      setPhase('edit');
    } catch (e) { fail(e); }
  }

  async function save(target) {
    const signal = fresh();
    setError(null);
    // what to come back to: the playlist as it stood when the editor opened
    const kept = { uris: plan.entries.map((x) => x.uri), at: new Date().toISOString() };
    writeUndo(id, kept);
    setUndo(kept);
    setPhase('applying');
    setProgress({ done: 0, total: null });
    try {
      let done = 0;
      for (let round = 0; round < 40; round += 1) {
        const j = await post(url('apply'), { target }, signal);
        done += j.done ?? 0;
        setProgress({ done, total: done + (j.left ?? 0) });
        if (!j.left) break;
        if (j.wait) await sleep(j.wait * 1000);
      }
      setSaved(true);
      setPhase('idle');
    } catch (e) { fail(e); }
  }

  if (phase === 'idle') {
    return (
      <div className="ro">
        {saved && <p className="ro-ok">새 순서를 Spotify에 저장했어요.</p>}
        <button className="ro-open" onClick={analyse}>
          <span><b>AI로 순서 바꾸기</b><small>곡마다 템포·에너지·조성을 보고 순서를 다시 짜요</small></span>
          <i aria-hidden="true">›</i>
        </button>
        <button className="ro-open" onClick={() => current('current')}>
          <span><b>직접 순서 바꾸기</b><small>지금 순서를 보면서 곡을 끌어 옮겨요</small></span>
          <i aria-hidden="true">›</i>
        </button>
        {undo && (
          <button className="linkish ro-undo" onClick={() => current('undo')}>
            바꾸기 전 순서 불러오기
          </button>
        )}
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="ro">
        <p className="err">{error?.message}</p>
        {error?.reauth ? <a className="btn" href="/api/auth/login">Spotify 다시 연결</a> : <button className="btn ghost" onClick={() => setPhase(plan ? 'edit' : 'idle')}>돌아가기</button>}
      </div>
    );
  }

  if (phase === 'analysing' || phase === 'applying' || phase === 'loading') {
    const p = progress ?? {};
    const of = phase === 'loading' ? null : p.total;
    const at = phase === 'analysing' ? p.ready : p.done;
    const label = phase === 'analysing' ? '곡마다 템포와 에너지를 알아보는 중' : phase === 'applying' ? 'Spotify에 저장하는 중' : '지금 순서를 불러오는 중';
    return (
      <div className="ro">
        <p className="ro-k">{label}</p>
        <div className="ro-bar"><i style={{ width: of ? `${Math.min(100, (at / of) * 100)}%` : '8%' }} /></div>
        <p className="ro-sub">{of ? `${(at ?? 0).toLocaleString()} / ${of.toLocaleString()}${phase === 'analysing' ? '곡' : '번 이동'}` : '잠시만요…'}
          {phase === 'analysing' && ' · 처음 한 번만 오래 걸려요'}</p>
        {phase !== 'applying' && <button className="linkish" onClick={() => { ctl.current?.abort(); setPhase('idle'); }}>그만두기</button>}
      </div>
    );
  }

  if (phase === 'pick' || phase === 'thinking') {
    const p = progress ?? {};
    return (
      <div className="ro">
        <p className="ro-k">어떻게 짤까요?</p>
        {p.total != null && <p className="ro-sub">{p.total}곡 중 {p.placed ?? p.ready}곡은 템포·에너지 수치가 있어요{p.placed < p.total ? ' · 나머지는 AI가 곡을 보고 판단해요' : ''}</p>}
        <div className="ro-modes" role="radiogroup" aria-label="정렬 방식">
          {MODES.map(([k, label, sub]) => (
            <button key={k} role="radio" aria-checked={mode === k} onClick={() => setMode(k)}>
              <b>{label}</b><small>{sub}</small>
            </button>
          ))}
        </div>
        {mode === 'custom' && (
          <textarea className="ro-prompt" value={prompt} maxLength={200} rows={2} onChange={(e) => setPrompt(e.target.value)}
                    placeholder="예: 운동할 때 듣게 처음부터 세게, 마지막 세 곡은 쿨다운" />
        )}
        <div className="ro-actions">
          <button className="btn" onClick={think} disabled={phase === 'thinking' || (mode === 'custom' && !prompt.trim())}>
            {phase === 'thinking' ? '순서를 짜는 중…' : '순서 짜기'}
          </button>
          <button className="btn ghost" onClick={() => setPhase('idle')} disabled={phase === 'thinking'}>닫기</button>
        </div>
        <p className="ro-sub">짠 순서는 바로 적용되지 않고, 한 번 보고 손으로 고친 뒤 저장할 수 있어요.</p>
      </div>
    );
  }

  return (
    <Editor key={`${kind}|${plan.order.join(',')}`} plan={plan} kind={kind}
            onSave={save} onCancel={() => setPhase('idle')} onRedo={() => setPhase('pick')} />
  );
}
