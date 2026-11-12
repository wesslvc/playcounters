'use client';

import { useEffect, useRef, useState } from 'react';
import { Cover } from './ui';

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

/** Energy along the list, old order faint and new order bold: the shape a reorder gives the playlist. */
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
 * The model reorders one of your playlists: every song's numbers are fetched
 * first (tempo, energy, key), then you pick how it should run, see the new
 * order with its energy curve against the old one, and only then is it put
 * on Spotify. The old order is kept on this device to undo with.
 */
export default function Reorder({ id, estimate }) {
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(null);
  const [mode, setMode] = useState('flow');
  const [prompt, setPrompt] = useState('');
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [all, setAll] = useState(false);
  const [undo, setUndo] = useState(null);
  const ctl = useRef(null);

  useEffect(() => { setUndo(readUndo(id)); return () => ctl.current?.abort(); }, [id]);
  const fresh = () => { ctl.current?.abort(); ctl.current = new AbortController(); return ctl.current.signal; };
  const fail = (e) => { if (e.name !== 'AbortError') { setError(e); setPhase('error'); } };

  async function analyse() {
    const signal = fresh();
    setError(null);
    setPhase('analysing');
    try {
      for (let round = 0; round < 30; round += 1) {
        const j = await post(`/api/playlists/${encodeURIComponent(id)}/analyze`, {}, signal);
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
      const j = await post(`/api/playlists/${encodeURIComponent(id)}/order`, { mode, prompt, estimate }, signal);
      setPlan(j);
      setAll(false);
      setPhase('preview');
    } catch (e) { fail(e); }
  }

  async function put(target, isUndo) {
    const signal = fresh();
    setError(null);
    setPhase('applying');
    setProgress({ done: 0, total: null });
    try {
      let done = 0;
      for (let round = 0; round < 40; round += 1) {
        const j = await post(`/api/playlists/${encodeURIComponent(id)}/apply`, { target }, signal);
        done += j.done ?? 0;
        setProgress({ done, total: done + (j.left ?? 0) });
        if (!j.left) break;
        if (j.wait) await sleep(j.wait * 1000);
      }
      if (isUndo) { writeUndo(id, null); setUndo(null); setPhase('undone'); } else setPhase('done');
    } catch (e) { fail(e); }
  }

  function apply() {
    const original = plan.entries.map((x) => x.uri);
    const kept = { uris: original, at: new Date().toISOString() };
    writeUndo(id, kept);
    setUndo(kept);
    put(plan.order.map((i) => plan.entries[i].uri), false);
  }

  if (phase === 'idle' || phase === 'done' || phase === 'undone') {
    return (
      <div className="ro">
        {phase === 'done' && <p className="ro-ok">새 순서를 Spotify에 적용했어요.</p>}
        {phase === 'undone' && <p className="ro-ok">원래 순서로 되돌렸어요.</p>}
        <button className="ro-open" onClick={analyse}>
          <span><b>AI로 순서 바꾸기</b><small>곡마다 템포·에너지·조성을 보고 순서를 다시 짜요</small></span>
          <i aria-hidden="true">›</i>
        </button>
        {undo && <button className="linkish ro-undo" onClick={() => put(undo.uris, true)}>바꾸기 전 순서로 되돌리기</button>}
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="ro">
        <p className="err">{error?.message}</p>
        {error?.reauth ? <a className="btn" href="/api/auth/login">Spotify 다시 연결</a> : <button className="btn ghost" onClick={() => setPhase(plan ? 'preview' : 'idle')}>돌아가기</button>}
      </div>
    );
  }

  if (phase === 'analysing' || phase === 'applying') {
    const p = progress ?? {};
    const of = p.total;
    const at = phase === 'analysing' ? p.ready : p.done;
    return (
      <div className="ro">
        <p className="ro-k">{phase === 'analysing' ? '곡마다 템포와 에너지를 알아보는 중' : 'Spotify에서 곡을 옮기는 중'}</p>
        <div className="ro-bar"><i style={{ width: of ? `${Math.min(100, (at / of) * 100)}%` : '8%' }} /></div>
        <p className="ro-sub">{of ? `${(at ?? 0).toLocaleString()} / ${of.toLocaleString()}${phase === 'analysing' ? '곡' : '번 이동'}` : '준비하는 중…'}
          {phase === 'analysing' && ' · 처음 한 번만 오래 걸려요'}</p>
        <button className="linkish" onClick={() => { ctl.current?.abort(); setPhase(phase === 'analysing' ? 'idle' : 'preview'); }}>그만두기</button>
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
      </div>
    );
  }

  // preview
  const bySong = new Map(plan.songs.map((s) => [s.i, s]));
  const before = plan.songs;
  const after = plan.order.map((i) => bySong.get(i)).filter(Boolean);
  const oldPlace = new Map(plan.songs.map((s, j) => [s.i, j + 1]));
  const shown = all ? after : after.slice(0, 30);
  const better = (a, b) => (a != null && b != null ? `${a} → ${b}` : null);
  return (
    <div className="ro">
      <p className="ro-k">새 순서</p>
      {plan.note && <p className="ro-note">{plan.note}</p>}
      {plan.numbers > 1 && (
        <>
          <Curve before={before} after={after} />
          <p className="ro-legend"><i className="was" />원래 순서 <i className="now" />새 순서 · 곡 순서에 따른 에너지</p>
          <div className="ro-stats">
            {better(plan.before.bpm, plan.after.bpm) && <span><b>{better(plan.before.bpm, plan.after.bpm)}</b><small>앞뒤 곡 템포 차이 (BPM)</small></span>}
            {better(plan.before.energy, plan.after.energy) && <span><b>{better(plan.before.energy, plan.after.energy)}</b><small>앞뒤 곡 에너지 차이</small></span>}
          </div>
        </>
      )}
      <ol className="ro-list">
        {shown.map((s, j) => {
          const was = oldPlace.get(s.i);
          const moved = was - (j + 1);
          return (
            <li key={`${s.i}`}>
              <span className="ro-n">{j + 1}</span>
              <Cover src={s.image} size={36} />
              <span className="ro-nm"><b>{s.track}</b><small>{[s.artist, s.tempo && `${s.tempo} BPM`, s.key].filter(Boolean).join(' · ')}</small></span>
              <span className="ro-e" title="에너지">{s.energy != null && <i style={{ width: `${Math.round(s.energy * 100)}%` }} />}</span>
              <span className="ro-mv" data-up={moved > 0 || undefined} data-down={moved < 0 || undefined}>
                {moved === 0 ? '–' : `${moved > 0 ? '▲' : '▼'}${Math.abs(moved)}`}
              </span>
            </li>
          );
        })}
      </ol>
      {after.length > 30 && <button className="linkish" onClick={() => setAll(!all)}>{all ? '접기' : `${after.length}곡 모두 보기`}</button>}
      <div className="ro-actions">
        <button className="btn" onClick={apply}>Spotify에 적용</button>
        <button className="btn ghost" onClick={() => setPhase('pick')}>다시 짜기</button>
      </div>
      <p className="ro-sub">적용해도 곡마다 추가된 날짜는 그대로예요. 바꾸기 전 순서는 이 기기에 남겨 둬서 되돌릴 수 있어요.</p>
    </div>
  );
}
