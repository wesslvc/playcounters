'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_PREFS, OTHERS, axesOf, axisRanks, buildModel, deltaOf, edgeChips, fillFromPredecessor, fitOf, normalizePrefs, passes } from './score';
import Controls from './Controls';
import Tile from './Tile';
import Drawer from './Drawer';
import CompareView from './CompareView';
import MatrixView from './MatrixView';
import TimelineView from './TimelineView';
import WatchView from './WatchView';
import CandidatesView from './CandidatesView';
import { CAT, when } from './parts';

const BRANDS = [
  ['Samsung', '삼성'], ['Apple', '애플'], ['Google', '구글'], ['Xiaomi', '샤오미'], ['OnePlus', '원플러스'],
  ['OPPO', '오포'], ['vivo', '비보'], ['Honor', '아너'], ['Nothing', '나싱'], ['Motorola', '모토로라'], ['Sony', '소니'],
];
const EXAMPLES = [
  '게임 많이 하는데 가벼운 폰',
  '카메라가 제일 중요하고 7년 업데이트',
  '갤럭시 S27 울트라 vs 아이폰 18 프로',
  '150만원 이하 가성비, 배터리 오래 가는 걸로',
];
const DEFAULT_FILTERS = { maxMan: 0, maxWeight: 0, minBattery: 0, upcoming: true, onlyConfirmed: false };
const NO_CREDITS = 'AI 사용 크레딧이 모두 소진돼서 지금은 새로 조사할 수 없어요. 사이트 주인이 OpenAI 크레딧을 충전하면 다시 쓸 수 있어요. 이미 조사된 폰은 그대로 볼 수 있어요.';
const ERR = {
  'already-running': '이미 조사 중인 요청이 있어요. 끝날 때까지 기다려주세요.',
  busy: '지금 조사 요청이 몰려 있어요. 잠시 후 다시 눌러주세요.',
  'daily-limit': '오늘 조사 가능 횟수를 다 썼어요. 이미 조사된 폰은 계속 볼 수 있어요.',
};

const read = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const encode = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
const LIKELY = { high: 0, medium: 1, low: 2 };

/** The search tool leaves "([site](url))" citation markup in its prose; keep the words, drop the markup. */
const tidy = (v) => (typeof v === 'string'
  ? v.replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '').replace(/\[([^\]]*)\]\(https?:[^)]*\)/g, '$1').replace(/\s{2,}/g, ' ').trim()
  : Array.isArray(v) ? v.map(tidy)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'url' || k === 'page' ? x : tidy(x)])) : v);

/** Brands worth searching for, from the duels: whoever isn't being beaten outright. */
function brandsFrom(duels) {
  const out = new Set();
  for (const d of duels) {
    if (d.a !== OTHERS && d.v <= 30) out.add(d.a);
    if (d.b !== OTHERS && d.v >= -30) out.add(d.b);
  }
  return [...out];
}

function payloadFrom(prefs, filters, models = [], reason = '') {
  const os = prefs.tr.os > 40 ? 'ios' : prefs.tr.os < -40 ? 'android' : 'any';
  const form = prefs.tr.form > 40 ? 'foldable' : prefs.tr.form < -40 ? 'bar' : 'any';
  return {
    brands: brandsFrom(prefs.duels.brand), models, os, form,
    budget_min_man: null, budget_max_man: filters.maxMan || null,
    chip_families: [], include_upcoming: filters.upcoming, reason,
  };
}

let duelSeq = 0;
const duelsFrom = (list, known) => (list ?? []).slice(0, 8).map((d) => {
  const canon = (x) => known.find((k) => k.toLowerCase() === String(x).toLowerCase()) ?? x;
  return { id: `p${Date.now().toString(36)}${duelSeq++}`, a: canon(d.a), b: canon(d.b), v: Math.max(-100, Math.min(100, d.score)) };
});

export default function Client() {
  const [library, setLibrary] = useState(undefined);
  const [active, setActive] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [prefs, setPrefs] = useState(EMPTY_PREFS);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [presets, setPresets] = useState([]);
  const [shared, setShared] = useState(false);
  const [picked, setPicked] = useState(null);
  const [tab, setTab] = useState('top');
  const [openId, setOpenId] = useState(null);
  const [watched, setWatched] = useState([]);
  const [history, setHistory] = useState({});
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);
  const [note, setNote] = useState('');
  const [panel, setPanel] = useState(false);
  const [moves, setMoves] = useState({});
  const [sync, setSync] = useState({ signedIn: null, status: '' });
  const hydrated = useRef(false);
  const alive = useRef(true);
  const prevOrder = useRef([]);
  const calibrated = useRef(false);

  const loadLibrary = () => fetch('/api/phones').then((r) => r.json())
    .then((j) => { const phones = fillFromPredecessor(tidy(j.phones ?? [])); setLibrary(phones); setActive(j.active ?? null); if (j.error) setError(j.error); return phones; })
    .catch((e) => { setLibrary((l) => l ?? []); setError(e.message); return []; });

  useEffect(() => {
    alive.current = true;
    setWatched(read('npp.watch', []));
    setPresets(read('npp.presets', []));
    const saved = read('npp.prefs3', null);
    if (saved) setPrefs(normalizePrefs(saved));
    const sf = read('npp.filters', null);
    if (sf) setFilters({ ...DEFAULT_FILTERS, ...sf });
    const st = read('npp.tab', null);
    if (st) setTab(st);
    // a settings link someone shared
    try {
      const m = /[#&]s=([^&]+)/.exec(window.location.hash);
      if (m) {
        const s = decode(m[1]);
        setPrefs(normalizePrefs(s.prefs)); setFilters({ ...DEFAULT_FILTERS, ...s.filters });
        window.history.replaceState(null, '', window.location.pathname);
        setNote('공유된 설정을 불러왔어요.');
      }
    } catch { /* a broken link just doesn't apply */ }
    // the signed-in reader's copy on the server wins if it was saved after this browser's
    fetch('/api/phones/prefs').then((r) => r.json()).then((j) => {
      if (!j.signedIn) { setSync({ signedIn: false, status: '' }); return; }
      const localAt = read('npp.savedAt', 0);
      if (j.data && j.savedAt > localAt && !/[#&]s=/.test(window.location.hash)) {
        if (j.data.prefs) setPrefs(normalizePrefs(j.data.prefs));
        if (j.data.filters) setFilters({ ...DEFAULT_FILTERS, ...j.data.filters });
        if (j.data.presets) { setPresets(j.data.presets); write('npp.presets', j.data.presets); }
        if (j.data.watch) { setWatched(j.data.watch); write('npp.watch', j.data.watch); }
        write('npp.savedAt', j.savedAt);
      } else if (localAt > (j.savedAt ?? 0)) {
        // this browser has the newer copy: send it up now rather than at the next change
        fetch('/api/phones/prefs', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefs: read('npp.prefs3', null), filters: read('npp.filters', null), presets: read('npp.presets', []), watch: read('npp.watch', []), savedAt: localAt }),
        }).catch(() => {});
      }
      setSync({ signedIn: true, status: 'saved' });
    }).catch(() => setSync({ signedIn: false, status: '' })).finally(() => { setTimeout(() => { hydrated.current = true; }, 0); });
    loadLibrary().then((phones) => { if (phones.length && !calibrated.current) { calibrated.current = true; calibrate(); } });
    return () => { alive.current = false; };
  }, []);
  useEffect(() => { write('npp.prefs3', prefs); }, [prefs]);
  useEffect(() => { write('npp.filters', filters); }, [filters]);
  useEffect(() => { write('npp.tab', tab); }, [tab]);

  // anything worth keeping changed: stamp it here, and (signed in) save it to the server a moment later
  useEffect(() => {
    if (!hydrated.current) return undefined;
    const at = Date.now();
    write('npp.savedAt', at);
    if (!sync.signedIn) return undefined;
    setSync((x) => ({ ...x, status: 'saving' }));
    const t = setTimeout(() => {
      fetch('/api/phones/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefs, filters, presets, watch: watched, savedAt: at }) })
        .then((r) => setSync((x) => ({ ...x, status: r.ok ? 'saved' : 'error' })))
        .catch(() => setSync((x) => ({ ...x, status: 'error' })));
    }, 1200);
    return () => clearTimeout(t);
  }, [prefs, filters, presets, watched, sync.signedIn]);

  // a search is running somewhere (this page, an earlier visit, the owner's refresh): look in until it lands
  useEffect(() => {
    if (!active || busy) return undefined;
    const t = setInterval(loadLibrary, 6000);
    return () => clearInterval(t);
  }, [active, busy]);

  const researched = useMemo(() => (library ?? []).filter((p) => !p.stub), [library]);
  const model = useMemo(() => buildModel(prefs, researched), [prefs, researched]);
  const stubs = useMemo(() => (library ?? []).filter((p) => p.stub).sort((a, b) => (LIKELY[a.release_likelihood] ?? 3) - (LIKELY[b.release_likelihood] ?? 3)), [library]);

  // every researched phone with its fit, and where it stands on each axis among all of them
  const scored = useMemo(() => researched.map((p) => ({ ...p, fit: fitOf(p, model) })), [researched, model]);
  const ranks = useMemo(() => axisRanks(researched, axesOf), [researched]);
  const ranked = useMemo(() => scored.filter((p) => passes(p, filters, model)).sort((a, b) => b.fit.match - a.fit.match), [scored, filters, model]);
  const top = ranked.slice(0, 5);
  const compareIds = picked ?? top.map((p) => p.id);
  const lastUpdated = researched.reduce((m, p) => Math.max(m, Date.parse(p.updated_at) || 0), 0);

  // snapshots for what's on screen, to say how scores moved since the last research
  const wantIds = [...new Set([...top.map((p) => p.id), ...watched, ...compareIds, openId].filter(Boolean))].slice(0, 20).join(',');
  useEffect(() => {
    if (!wantIds) return;
    fetch(`/api/phones/history?ids=${encodeURIComponent(wantIds)}`).then((r) => r.json())
      .then((j) => setHistory(j.history ?? {})).catch(() => {});
  }, [wantIds, library]);

  const withDelta = (p) => {
    const snaps = history[p.id] ?? [];
    return { ...p, delta: snaps.length >= 2 ? deltaOf(snaps[snaps.length - 2].data, snaps[snaps.length - 1].data, model) : null };
  };
  const topD = top.map(withDelta);
  const compareList = scored.filter((p) => compareIds.includes(p.id)).map(withDelta);
  const openP = openId ? scored.find((p) => p.id === openId) : null;

  // who moved up or down as the handles move
  const order = top.map((p) => p.id).join(',');
  useEffect(() => {
    const prev = prevOrder.current;
    const next = order ? order.split(',') : [];
    if (prev.length) {
      const m = {};
      next.forEach((id, i) => { const was = prev.indexOf(id); if (was !== -1 && was !== i) m[id] = was - i; });
      setMoves(m);
    }
    prevOrder.current = next;
    const t = setTimeout(() => setMoves({}), 2500);
    return () => clearTimeout(t);
  }, [order]);

  const brandOptions = useMemo(() => {
    const known = new Set(BRANDS.map(([b]) => b.toLowerCase()));
    const extra = [...new Set((library ?? []).map((p) => p.brand))].filter((b) => b && !known.has(b.toLowerCase()));
    return [...BRANDS, ...extra.map((b) => [b, b])];
  }, [library]);

  const toggle = (id) => {
    const cur = new Set(compareIds);
    if (cur.has(id)) cur.delete(id); else if (cur.size < 5) cur.add(id);
    setPicked([...cur]);
  };
  const toggleWatch = (id) => {
    const next = watched.includes(id) ? watched.filter((x) => x !== id) : [...watched, id].slice(-12);
    setWatched(next); write('npp.watch', next);
    if (next.includes(id)) fetch('/api/phones/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: next }) }).catch(() => {});
  };

  const savePreset = (name) => {
    const next = [{ name, prefs, filters }, ...presets.filter((p) => p.name !== name)].slice(0, 12);
    setPresets(next); write('npp.presets', next);
  };
  const loadPreset = (p) => { setPrefs(normalizePrefs(p.prefs)); setFilters({ ...DEFAULT_FILTERS, ...p.filters }); setPicked(null); };
  const deletePreset = (name) => { const next = presets.filter((p) => p.name !== name); setPresets(next); write('npp.presets', next); };
  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#s=${encode({ prefs, filters })}`;
    try { await navigator.clipboard.writeText(url); } catch { window.prompt('이 링크를 복사하세요', url); }
    setShared(true); setTimeout(() => setShared(false), 2500);
  };

  /** Looks in on a server job until it's done; returns the finished job. */
  async function follow(id) {
    const until = Date.now() + 6 * 60e3;
    while (alive.current && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 4000));
      const jr = await fetch(`/api/phones/search?id=${id}`).then((r) => r.json()).catch(() => null);
      if (!jr) continue;
      if (jr.progress) setProg(jr.progress);
      if (jr.status === 'done' || jr.status === 'error') return jr;
    }
    return null;
  }

  /** Has the judge weigh every phone against the others — only when something hasn't been weighed yet. */
  async function calibrate() {
    try {
      const r = await fetch('/api/phones/calibrate', { method: 'POST' });
      const j = await r.json();
      if (!r.ok || j.skipped || !j.id) return;
      setProg({ step: '폰들을 서로 비교해 점수를 맞추는 중', done: 0, total: 1 });
      await follow(j.id);
      await loadLibrary();
    } catch { /* the page works without it */ } finally { if (alive.current) setProg(null); }
  }

  /** Starts a search on the server and looks in on it until it's done. */
  async function runJob(payload, reason) {
    const sr = await fetch('/api/phones/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: payload }) });
    const sj = await sr.json();
    if (!sr.ok) { setNote(`${reason ? `${reason} ` : ''}${ERR[sj.error] ?? `(${sj.error})`}`.trim()); return; }
    const jr = await follow(sj.id);
    if (!jr) return;
    if (jr.status === 'error') { setNote(/no-credits/.test(jr.error ?? '') ? NO_CREDITS : `조사에 실패했어요 (${jr.error}).`); return; }
    await loadLibrary();
    const r = jr.result ?? {};
    const failed = r.failed?.length ? ` · 조사 못한 폰 ${r.failed.length}개 (${r.failed.map((f) => f.name).join(', ')})` : '';
    const cand = r.stubs ? ` · 후보군 ${r.stubs}개 추가` : '';
    setNote(`${reason ? `${reason} ` : ''}조사 완료: ${r.ids?.length ?? 0}개${cand}${failed}`);
    await calibrate();
  }

  async function find(e) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setNote(''); setProg({ step: '요청을 읽는 중', done: 0, total: 0 });
    try {
      let nextPrefs = prefs;
      let nextFilters = filters;
      let models = [];
      let reason = '';
      if (text.trim()) {
        const pr = await fetch('/api/phones/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        const plan = await pr.json();
        if (!pr.ok) throw new Error(plan.error || pr.status);
        const names = brandOptions.map(([b]) => b);
        nextPrefs = normalizePrefs({
          imp: plan.importance, tr: plan.traits, order: plan.priority,
          duels: { brand: duelsFrom(plan.brand_duels, names), chip: duelsFrom(plan.chip_duels, ['snapdragon', 'exynos', 'apple', 'tensor', 'dimensity', 'other']) },
        });
        nextFilters = {
          ...filters, maxMan: plan.budget_max_man ?? 0, maxWeight: plan.max_weight_g ?? 0, minBattery: plan.min_battery_mah ?? 0,
          onlyConfirmed: plan.only_confirmed, upcoming: plan.include_upcoming,
        };
        setPrefs(nextPrefs); setFilters(nextFilters); setPicked(null); setTab('top');
        models = plan.models; reason = plan.reason;
        setNote(reason);
      }
      await runJob(payloadFrom(nextPrefs, nextFilters, models, reason), reason);
    } catch (err) {
      setNote(/no-credits/.test(err.message) ? NO_CREDITS : `요청을 처리하지 못했어요 (${err.message}).`);
    } finally {
      setBusy(false); setProg(null);
    }
  }

  async function researchStub(p) {
    if (busy) return;
    setBusy(true); setNote(`${p.brand} ${p.name}를 자세히 조사하는 중…`); setProg({ step: '조사 시작', done: 0, total: 0 });
    try {
      await runJob({ brands: [], models: [`${p.brand} ${p.name}`], os: 'any', form: 'any', budget_min_man: null, budget_max_man: null, chip_families: [], include_upcoming: true, reason: '' }, '');
    } catch (err) {
      setNote(`요청을 처리하지 못했어요 (${err.message}).`);
    } finally {
      setBusy(false); setProg(null);
    }
  }

  const watchedPhones = scored.filter((p) => watched.includes(p.id));
  const series = watchedPhones.map((p, i) => {
    const snaps = history[p.id] ?? [];
    const pts = (snaps.length ? snaps : [{ at: p.updated_at, data: p }])
      .map((s) => ({ t: Date.parse(s.at), fit: fitOf(s.data, model).match, changes: s.data.changes ?? [] }));
    return { id: p.id, name: `${p.brand} ${p.name}`, color: CAT[i % CAT.length], points: pts };
  });
  const pct = prog?.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const hasData = researched.length > 0;

  const tabs = [
    ['top', '추천', top.length],
    ['compare', '비교', compareList.length],
    ['matrix', '전체 표', ranked.length],
    ['timeline', '출시 타임라인', researched.length + stubs.length],
    ['watch', '관심 폰', watched.length],
    ['cands', '후보군', stubs.length],
  ];

  return (
    <main className="np">
      <header className="np-topbar">
        <div className="np-bar-in">
          <div className="np-brandmark">
            <h1>newphoneprediction</h1>
            {!!lastUpdated && <span>조사 {when(lastUpdated)} · 폰 {researched.length}개{stubs.length ? ` · 후보 ${stubs.length}` : ''}</span>}
          </div>
          <form className="np-ask" onSubmit={find}>
            <input id="ask" value={text} maxLength={400} onChange={(e) => setText(e.target.value)}
              placeholder="원하는 폰을 편하게 말해보세요 — 이름을 쓰면 그 폰을 찾아와요" aria-label="무엇을 찾아볼까요?" />
            <button className="np-go" disabled={busy}>{busy ? '찾는 중…' : '찾아서 알려줘'}</button>
          </form>
        </div>
        <div className="np-ex">
          {EXAMPLES.map((x) => <button type="button" key={x} onClick={() => setText(x)}>{x}</button>)}
        </div>
        {prog && (
          <div className="np-prog" role="status">
            <div className="np-prog-bar"><i style={{ width: `${Math.max(6, pct)}%` }} /></div>
            <span>{prog.step}{prog.total && prog.total > 1 ? ` · 조사원 ${prog.done}/${prog.total}` : ''}{prog.pool ? ` · 후보 ${prog.pool}개` : ''} — AI 여러 마리가 동시에 분업 중이에요. 몇 분 걸리고 닫아도 계속돼요.</span>
          </div>
        )}
      </header>

      {note && <p className="np-note-bar">{note}</p>}
      {library === undefined && <p className="np-note">불러오는 중…</p>}
      {active && !busy && !prog && (
        <p className="np-banner">지금 AI 조사원들이 조사 중이에요{active.progress?.total ? ` (${active.progress.done}/${active.progress.total})` : ''}. 끝나면 이 화면에 자동으로 나타나요.</p>
      )}
      {library?.length === 0 && !active && <p className="np-note">아직 조사된 폰이 없어요{error ? ` (${error})` : ''}. 위에 원하는 걸 쓰고 "찾아서 알려줘"를 눌러보세요.</p>}

      <div className="np-main">
        <aside className={`np-aside${panel ? ' open' : ''}`}>
          <div className="np-sheet-head">
            <b>내 취향</b>
            <button type="button" onClick={() => setPanel(false)}>{top[0] ? `결과 보기 · 1위 ${top[0].name} ${top[0].fit.match}%` : '결과 보기'}</button>
          </div>
          <Controls prefs={prefs} setPrefs={setPrefs} filters={filters} setFilters={setFilters} brandOptions={brandOptions}
            presets={presets} onSave={savePreset} onLoad={loadPreset} onDelete={deletePreset} onShare={share} shared={shared} sync={sync} />
        </aside>

        <div className="np-content">
          <nav className="np-tabs" role="tablist" aria-label="보기">
            <button type="button" className="np-tab-pref" onClick={() => setPanel(true)}>취향 조정</button>
            {tabs.map(([k, label, n]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {label}{n ? <i>{n}</i> : null}
              </button>
            ))}
          </nav>

          {tab === 'top' && (hasData ? (
            <section>
              {(() => {
                const why = [
                  prefs.tr.timing <= -8 && "'지금 살 수 있는 확정 모델' 쪽으로 기울어 있어서",
                  (prefs.imp.certainty >= 10 || prefs.order.includes('certainty')) && "'확정 정보 선호'가 켜져 있어서",
                  filters.onlyConfirmed && "'확실한 정보만'이 체크돼 있어서",
                  !filters.upcoming && "'출시 예정·루머 포함'이 꺼져 있어서",
                ].filter(Boolean);
                if (!why.length) return null;
                return (
                  <p className="np-hold">
                    {why.join(', ')} 출시 전 폰(후속작)이 불리하거나 빠져 있어요.{' '}
                    <button type="button" onClick={() => {
                      setPrefs({ ...prefs, tr: { ...prefs.tr, timing: Math.max(0, prefs.tr.timing) }, imp: { ...prefs.imp, certainty: 0 }, order: prefs.order.filter((k) => k !== 'certainty') });
                      setFilters({ ...filters, onlyConfirmed: false, upcoming: true });
                    }}>균형으로 되돌리기</button>
                  </p>
                );
              })()}
              <div className="np-res-head"><h2>나에게 맞는 TOP 5</h2><span>{ranked.length}개 중 · 슬라이더를 움직이면 바로 바뀌어요</span></div>
              {!top.length && <p className="np-note">조건에 맞는 폰이 없어요. 한도나 제외한 항목을 풀어보세요.</p>}
              <ol className="np-tiles">
                {topD.map((p, i) => (
                  <Tile key={p.id} p={p} rank={i + 1} move={moves[p.id]} ranks={ranks[p.id]} chips={edgeChips(ranks[p.id])}
                    watched={watched.includes(p.id)} onWatch={() => toggleWatch(p.id)} picked={compareIds.includes(p.id)} onPick={() => toggle(p.id)}
                    onOpen={() => setOpenId(p.id)} order={prefs.order} />
                ))}
              </ol>
              {ranked.length > 5 && <p className="np-more"><button type="button" onClick={() => setTab('matrix')}>나머지 {ranked.length - 5}개는 전체 표에서 보기 →</button></p>}
            </section>
          ) : <p className="np-note">조사된 폰이 생기면 여기에 추천이 나와요.</p>)}

          {tab === 'compare' && (
            <CompareView phones={scored} all={ranked} ids={compareIds} setIds={(ids) => setPicked(ids.slice(0, 5))} onOpen={(p) => setOpenId(p.id)} order={prefs.order} model={model} />
          )}
          {tab === 'matrix' && <MatrixView rows={ranked} ranks={ranks} ids={compareIds} toggle={toggle} onOpen={(p) => setOpenId(p.id)} />}
          {tab === 'timeline' && <TimelineView phones={[...scored, ...stubs]} onOpen={(p) => setOpenId(p.id)} />}
          {tab === 'watch' && <WatchView phones={watchedPhones} series={series} onOpen={(p) => setOpenId(p.id)} />}
          {tab === 'cands' && <CandidatesView stubs={stubs} onResearch={researchStub} busy={busy} />}

          {hasData && (
            <p className="np-meta np-foot">GPT가 웹 검색으로 모은 정보를 정리한 것이라 틀릴 수 있어요. 점수는 모든 폰을 한꺼번에 놓고 서로 비교해서 매기고, 점선 밑줄과 "유력·추정" 표시는 확정이 아닌 예상치예요(정보가 불확실하다고 점수를 깎지는 않아요). 사진은 서버가 실제로 열리는 것만 보여주며, 출시 전 폰은 유출 렌더링이거나 전작 이미지일 수 있어요.</p>
          )}
        </div>
      </div>

      {openP && (
        <Drawer p={withDelta(openP)} ranks={ranks[openP.id]} history={history[openP.id]} model={model}
          watched={watched.includes(openP.id)} onWatch={() => toggleWatch(openP.id)} picked={compareIds.includes(openP.id)} onPick={() => toggle(openP.id)}
          onClose={() => setOpenId(null)} />
      )}

      {panel && !!top.length && (
        <div className="np-dock" role="status">
          <ol>{top.slice(0, 3).map((p, i) => <li key={p.id}><b>{i + 1}</b> {p.name} <em>{p.fit.match}%</em></li>)}</ol>
          <button type="button" onClick={() => setPanel(false)}>결과 보기</button>
        </div>
      )}
    </main>
  );
}
