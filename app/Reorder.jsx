'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Cover } from './ui';
import { smoothness, tempoGap } from '@/lib/reorder';

const MODES = [
  ['flow', '흐름 좋게', '템포와 에너지가 자연스럽게 이어지게'],
  ['rise', '점점 신나게', '차분하게 시작해서 끝으로 갈수록 올라가게'],
  ['calm', '점점 차분하게', '신나게 시작해서 점점 가라앉게'],
  ['group', '비슷한 곡끼리', '분위기와 장르가 닮은 곡끼리 묶어서'],
  ['plays', '많이 들은 순', '내 재생 횟수가 많은 곡부터 (AI 없이)'],
  ['custom', '직접 쓰기', '원하는 순서를 말로 적어서'],
];

// one model call orders up to this many songs; past it only grouping and by-plays work (as on the server)
const ONE_CALL = 400;
const ANY_SIZE = ['group', 'plays'];

const undoKey = (id) => `pc-plundo-${id}`;
const readUndo = (id) => { try { return JSON.parse(localStorage.getItem(undoKey(id)) ?? 'null'); } catch { return null; } };
const writeUndo = (id, v) => { try { if (v) localStorage.setItem(undoKey(id), JSON.stringify(v)); else localStorage.removeItem(undoKey(id)); } catch { /* private mode */ } };
// a save that didn't finish (closed, timed out): kept so the page can carry on with it
const pendingKey = (id) => `pc-plsave-${id}`;
const readPending = (id) => { try { return JSON.parse(localStorage.getItem(pendingKey(id)) ?? 'null'); } catch { return null; } };
const writePending = (id, v) => { try { if (v) localStorage.setItem(pendingKey(id), JSON.stringify(v)); else localStorage.removeItem(pendingKey(id)); } catch { /* private mode */ } };
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

const JUMP = 20; // BPM apart (half or double time counts as the same pulse) to call it a jump

/** Two Camelot keys that mix: the same, its relative major/minor, or one step round the wheel. */
function keysMix(a, b) {
  if (!a || !b) return false;
  const [na, la] = [parseInt(a, 10), a.slice(-1)];
  const [nb, lb] = [parseInt(b, 10), b.slice(-1)];
  if (na === nb) return true;
  return la === lb && (Math.abs(na - nb) === 1 || Math.abs(na - nb) === 11);
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

const Grip = () => (
  <svg viewBox="0 0 12 20" aria-hidden="true">{[4, 10, 16].flatMap((y) => [<circle key={`a${y}`} cx="3" cy={y} r="1.6" />, <circle key={`b${y}`} cx="9" cy={y} r="1.6" />])}</svg>
);

/**
 * One row, redrawn only when something it shows changes: a playlist of two
 * thousand songs re-rendering every row on every pointer move would stutter.
 */
const Row = memo(function Row({ s, j, moved, prev, group, offset, lifted, on }) {
  const gap = tempoGap(prev?.tempo, s.tempo);
  return (
    <li data-lifted={lifted || undefined}
        style={offset != null ? { transform: `translateY(${offset}px)`, transition: lifted ? 'none' : undefined } : undefined}>
      {group && <p className="ro-gh"><b>{group.name}</b><small>{group.count}곡 · {group.about}</small></p>}
      <div className="ro-row">
        <span className="ro-n">
          {j + 1}
          {moved !== 0 && <small data-up={moved > 0 || undefined} data-down={moved < 0 || undefined}>{moved > 0 ? '▲' : '▼'}{Math.abs(moved)}</small>}
        </span>
        <Cover src={s.image} size={36} />
        <span className="ro-nm"><b>{s.track}</b><small>{s.artist}</small></span>
        <span className="ro-bpm" data-jump={gap != null && gap > JUMP ? '' : undefined} title={gap != null ? `앞 곡과 ${gap} BPM 차이` : undefined}>
          {s.tempo ?? '–'}<small>BPM</small>
        </span>
        <span className="ro-tone" data-mix={keysMix(prev?.key, s.key) ? '' : undefined} data-none={s.key ? undefined : ''}>
          {s.keyName ?? '–'}{s.key && <small>{s.key}</small>}
        </span>
        <button className="ro-grip" aria-label={`${s.track} 옮기기`}
                onPointerDown={(e) => on.start(e, j)} onPointerMove={on.move} onPointerUp={on.end} onPointerCancel={on.end}>
          <Grip />
        </button>
      </div>
    </li>
  );
});

/**
 * An order to look over and change by hand before anything happens: rows are
 * dragged by their handle (the rest of the row still scrolls the page), the
 * energy curve and the jumps between neighbours follow the edits, and only
 * the save button puts it on Spotify. Grouped orders show each group's name
 * where it starts.
 */
function Editor({ plan, kind, onSave, onCancel, onRedo }) {
  const bySong = useMemo(() => new Map(plan.songs.map((s) => [s.i, s])), [plan]);
  const base = useMemo(() => plan.songs.map((s) => s.i), [plan]);
  const [seq, setSeq] = useState(() => plan.order.filter((i) => bySong.has(i)));
  const [drag, setDrag] = useState(null);
  const d = useRef(null);
  const list = useRef(null);
  useEffect(() => () => cancelAnimationFrame(d.current?.raf), []);

  const rest = plan.order.filter((i) => !bySong.has(i));
  const place = useMemo(() => new Map(base.map((i, j) => [i, j])), [base]);
  const changed = seq.some((i, j) => i !== base[j]);
  const movedCount = seq.filter((i, j) => place.get(i) !== j).length;
  const before = useMemo(() => smoothness(base.map((i) => bySong.get(i))), [base, bySong]);
  const after = useMemo(() => smoothness(seq.map((i) => bySong.get(i))), [seq, bySong]);
  const n = seq.length;
  // rewriting the whole order is a handful of calls; moving one by one keeps added dates but is slow when much moves
  const canFast = plan.entries.every((e) => /^spotify:(track|episode):/.test(e.uri));
  const [fast, setFast] = useState(null);
  useEffect(() => { if (fast == null && changed) setFast(movedCount > 60); }, [fast, changed, movedCount]);

  // where the lifted row would land: past every other row whose middle is above its own middle
  const update = () => {
    const x = d.current;
    if (!x) return;
    const dy = x.y - x.y0 + (window.scrollY - x.s0);
    const mid = x.rects[x.from].top + x.rects[x.from].h / 2 + dy;
    let to = 0;
    for (let k = 0; k < n; k += 1) if (k !== x.from && x.rects[k].top + x.rects[k].h / 2 < mid) to += 1;
    x.to = to;
    setDrag({ from: x.from, to, dy, h: x.rects[x.from].h });
  };
  const api = useRef({});
  api.current.start = (e, j) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rects = [...list.current.children].map((li) => { const r = li.getBoundingClientRect(); return { top: r.top + window.scrollY, h: r.height }; });
    d.current = { from: j, to: j, y0: e.clientY, y: e.clientY, s0: window.scrollY, rects, raf: 0 };
    setDrag({ from: j, to: j, dy: 0, h: rects[j].h });
    // near the top or bottom of the screen the page scrolls along
    const tick = () => {
      const x = d.current;
      if (!x) return;
      if (x.y < 110) window.scrollBy(0, -12);
      else if (x.y > window.innerHeight - 110) window.scrollBy(0, 12);
      update();
      x.raf = requestAnimationFrame(tick);
    };
    d.current.raf = requestAnimationFrame(tick);
  };
  api.current.move = (e) => { if (d.current) { d.current.y = e.clientY; update(); } };
  api.current.end = () => {
    const x = d.current;
    if (!x) return;
    cancelAnimationFrame(x.raf);
    d.current = null;
    setDrag(null);
    if (x.to !== x.from) setSeq((s) => { const a = [...s]; const [v] = a.splice(x.from, 1); a.splice(x.to, 0, v); return a; });
  };
  const on = useMemo(() => ({
    start: (e, j) => api.current.start(e, j),
    move: (e) => api.current.move(e),
    end: () => api.current.end(),
  }), []);
  const offset = (j) => {
    if (!drag) return null;
    if (j === drag.from) return drag.dy;
    if (drag.from < drag.to && j > drag.from && j <= drag.to) return -drag.h;
    if (drag.to < drag.from && j >= drag.to && j < drag.from) return drag.h;
    return 0;
  };

  const groups = plan.groups ?? null;
  const groupAt = (j) => {
    if (!groups) return null;
    const g = bySong.get(seq[j])?.g;
    if (g == null || (j > 0 && bySong.get(seq[j - 1])?.g === g)) return null;
    return groups[g] ?? null;
  };
  const title = kind === 'ai' ? '새 순서' : kind === 'undo' ? '바꾸기 전 순서' : '지금 순서';
  const better = (a, b) => (a != null && b != null ? `${a} → ${b}` : null);
  return (
    <div className="ro">
      <p className="ro-k">{title}</p>
      {kind === 'ai' && plan.note && !groups && <p className="ro-note">{plan.note}</p>}
      {groups && (
        <ol className="ro-groups">
          {groups.map((g) => <li key={g.name}><b>{g.name}</b><span>{g.count}곡</span></li>)}
        </ol>
      )}
      {kind === 'undo' && <p className="ro-note">바꾸기 전 순서를 불러왔어요. 저장을 눌러야 Spotify에 적용돼요.</p>}
      <p className="ro-sub">오른쪽 손잡이를 끌어서 곡을 옮길 수 있어요.</p>
      {plan.numbers > 0 && (
        <p className="ro-key-legend">
          <span><em className="ro-bpm" data-jump="">128</em>앞 곡과 템포가 {JUMP} 넘게 차이</span>
          <span><em className="ro-tone" data-mix="">Am</em>앞 곡과 잘 어울리는 키</span>
        </p>
      )}
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
      <ol className="ro-list" ref={list} data-dragging={drag ? '' : undefined}>
        {seq.map((i, j) => (
          <Row key={i} s={bySong.get(i)} j={j} moved={place.get(i) - j} prev={j > 0 ? bySong.get(seq[j - 1]) : null}
               group={groupAt(j)} offset={offset(j)} lifted={drag?.from === j} on={on} />
        ))}
      </ol>
      <div className="ro-save">
        <span>{changed ? `${movedCount.toLocaleString()}곡 자리가 바뀌어요` : '바뀐 곳이 없어요'}</span>
        <div>
          <button className="btn ghost" onClick={onCancel}>취소</button>
          {kind === 'ai' && <button className="btn ghost" onClick={onRedo}>다시 짜기</button>}
          <button className="btn" disabled={!changed} onClick={() => onSave([...seq, ...rest].map((x) => plan.entries[x].uri), fast && canFast)}>저장</button>
        </div>
        {changed && (
          <label className="ro-fast" data-off={canFast ? undefined : ''}>
            <input type="checkbox" checked={fast && canFast} disabled={!canFast} onChange={(e) => setFast(e.target.checked)} />
            <span>빠르게 저장 <small>{canFast ? '몇 초면 끝나요 · 대신 곡마다 추가된 날짜가 오늘로 바뀌어요' : '로컬 파일이 있어서 쓸 수 없어요'}</small></span>
          </label>
        )}
      </div>
      <p className="ro-sub">저장하면 Spotify에 적용돼요. 바꾸기 전 순서는 이 기기에 남겨 둬요.{changed && !(fast && canFast) && movedCount > 60 ? ' 날짜를 지키며 옮기면 한 곡씩 옮겨서 몇 분 걸릴 수 있어요.' : ''}</p>
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

  const [pending, setPending] = useState(null);
  useEffect(() => { setUndo(readUndo(id)); setPending(readPending(id)); return () => ctl.current?.abort(); }, [id]);
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
        // a long playlist can only be grouped or sorted by plays, so grouping is where it starts
        if (j.total > ONE_CALL) setMode((m) => (ANY_SIZE.includes(m) ? m : 'group'));
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

  async function save(target, fast, resume = null) {
    const signal = fresh();
    setError(null);
    if (!resume) {
      // what to come back to: the playlist as it stood when the editor opened
      const kept = { uris: plan.entries.map((x) => x.uri), at: new Date().toISOString() };
      writeUndo(id, kept);
      setUndo(kept);
    }
    const job = resume ?? { target, fast, from: 0, at: new Date().toISOString() };
    writePending(id, job);
    setPending(job);
    setPhase('applying');
    setProgress({ done: 0, total: null, fast: job.fast });
    try {
      let state = { from: job.from ?? 0 };
      let done = 0;
      for (let round = 0; round < 200; round += 1) {
        const j = await post(url('apply'), job.fast
          ? { target: job.target, mode: 'replace', from: state.from }
          : { target: job.target, mode: 'move', current: state.current, snapshot: state.snapshot }, signal);
        if (job.fast) {
          state = { from: j.from };
          writePending(id, { ...job, from: j.from });
          setProgress({ done: j.total - j.left, total: j.total, fast: true });
        } else {
          state = { current: j.current, snapshot: j.snapshot };
          done += j.done ?? 0;
          setProgress({ done, total: done + (j.left ?? 0), wait: j.wait ?? null });
        }
        if (!j.left) break;
        // a long hold is sat out with the page closed: the save is kept to carry on with later
        if (j.wait > 90) throw new Error(`Spotify가 요청이 많다며 잠시 막았어요. 약 ${Math.ceil(j.wait / 60)}분 뒤에 '이어서 저장'을 눌러 주세요.`);
        if (j.wait) await sleep(j.wait * 1000);
      }
      writePending(id, null);
      setPending(null);
      setSaved(true);
      setPhase('idle');
    } catch (e) { fail(e); }
  }

  if (phase === 'idle') {
    return (
      <div className="ro">
        {saved && <p className="ro-ok">새 순서를 Spotify에 저장했어요.</p>}
        {pending && (
          <div className="ro-pending">
            <p>{pending.fast && pending.from > 0
              ? `빠르게 저장하다 멈춰서 지금 플리에 ${pending.from.toLocaleString()}곡만 들어 있어요. 이어서 저장하면 나머지 ${(pending.target.length - pending.from).toLocaleString()}곡이 들어가요.`
              : `저장이 끝나지 않았어요 (${pending.target.length.toLocaleString()}곡). 이어서 저장할까요?`}</p>
            <div className="ro-actions">
              <button className="btn" onClick={() => save(pending.target, pending.fast, pending)}>이어서 저장</button>
              {!pending.fast && <button className="btn ghost" onClick={() => save(pending.target, true, { ...pending, fast: true, from: 0 })}>빠르게 저장으로 마치기</button>}
              {/* a fast save cut off partway has left only part of the playlist: it has to be finished */}
              {!(pending.fast && pending.from > 0) && <button className="linkish" onClick={() => { writePending(id, null); setPending(null); }}>버리기</button>}
            </div>
          </div>
        )}
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
        <p className="ro-sub">{of ? `${(at ?? 0).toLocaleString()} / ${of.toLocaleString()}${phase === 'analysing' ? '곡' : p.fast ? '곡' : '번 이동'}` : '잠시만요…'}
          {phase === 'applying' && p.wait ? ` · Spotify가 잠깐 쉬어 가래요 (${p.wait}초)` : ''}
          {phase === 'applying' && ' · 창을 닫아도 다음에 이어서 저장할 수 있어요'}
          {phase === 'analysing' && ' · 처음 한 번만 오래 걸려요'}</p>
        <div className="ro-actions">
          {phase === 'analysing' && <button className="btn ghost" onClick={() => { ctl.current?.abort(); setPhase('pick'); }}>건너뛰고 바로 짜기</button>}
          {phase !== 'applying' && <button className="linkish" onClick={() => { ctl.current?.abort(); setPhase('idle'); }}>그만두기</button>}
        </div>
      </div>
    );
  }

  if (phase === 'pick' || phase === 'thinking') {
    const p = progress ?? {};
    const big = p.total > ONE_CALL;
    return (
      <div className="ro">
        <p className="ro-k">어떻게 짤까요?</p>
        {p.total != null && <p className="ro-sub">{p.total}곡 중 {p.placed ?? p.ready}곡은 템포·에너지 수치가 있어요{p.placed < p.total ? ' · 나머지는 AI가 곡을 보고 판단해요' : ''}</p>}
        {big && <p className="ro-sub">곡이 {p.total.toLocaleString()}곡이라 '비슷한 곡끼리'와 '많이 들은 순'만 쓸 수 있어요.</p>}
        <div className="ro-modes" role="radiogroup" aria-label="정렬 방식">
          {MODES.map(([k, label, sub]) => (
            <button key={k} role="radio" aria-checked={mode === k} onClick={() => setMode(k)} disabled={big && !ANY_SIZE.includes(k)}>
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
            {phase === 'thinking' ? (mode === 'group' ? '묶음을 나누는 중… (곡이 많으면 1분쯤)' : '순서를 짜는 중…') : '순서 짜기'}
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
