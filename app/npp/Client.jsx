'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_PREFS, buildModel, fitOf, passes } from './score';
import Controls from './Controls';
import { COLORS, Compare, RowItem, TopCard, WatchPanel, when } from './Cards';

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
const ERR = {
  'already-running': '이미 조사 중인 요청이 있어요. 끝날 때까지 기다려주세요.',
  busy: '지금 조사 요청이 몰려 있어요. 잠시 후 다시 눌러주세요.',
  'daily-limit': '오늘 조사 가능 횟수를 다 썼어요. 이미 조사된 폰은 계속 볼 수 있어요.',
};

const read = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

/** What to search for, from the taste as it stands. */
function payloadFrom(prefs, filters, models = [], reason = '') {
  const lean = (o, min) => Object.entries(o).filter(([, v]) => v >= min).map(([k]) => k);
  const os = prefs.sp.os > 40 ? 'ios' : prefs.sp.os < -40 ? 'android' : 'any';
  const form = prefs.sp.form > 40 ? 'foldable' : prefs.sp.form < -40 ? 'bar' : 'any';
  return {
    brands: lean(prefs.brands, 25), models, os, form,
    budget_min_man: null, budget_max_man: filters.maxMan || null,
    chip_families: lean(prefs.chips, 25), include_upcoming: filters.upcoming, reason,
  };
}

export default function Client() {
  const [library, setLibrary] = useState(undefined);
  const [active, setActive] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [prefs, setPrefs] = useState(EMPTY_PREFS);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [picked, setPicked] = useState(null);
  const [open, setOpen] = useState(null);
  const [watched, setWatched] = useState([]);
  const [history, setHistory] = useState({});
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);
  const [note, setNote] = useState('');
  const [panel, setPanel] = useState(false);
  const [moves, setMoves] = useState({});
  const alive = useRef(true);
  const prevOrder = useRef([]);
  const resultsRef = useRef(null);

  const loadLibrary = () => fetch('/api/phones').then((r) => r.json())
    .then((j) => { setLibrary(j.phones ?? []); setActive(j.active ?? null); if (j.error) setError(j.error); return j.phones ?? []; })
    .catch((e) => { setLibrary((l) => l ?? []); setError(e.message); return []; });

  useEffect(() => {
    alive.current = true;
    setWatched(read('npp.watch', []));
    const saved = read('npp.prefs', null);
    if (saved) setPrefs({ sp: { ...EMPTY_PREFS.sp, ...saved.sp }, brands: saved.brands ?? {}, chips: saved.chips ?? {} });
    const sf = read('npp.filters', null);
    if (sf) setFilters({ ...DEFAULT_FILTERS, ...sf });
    loadLibrary();
    return () => { alive.current = false; };
  }, []);
  useEffect(() => { write('npp.prefs', prefs); }, [prefs]);
  useEffect(() => { write('npp.filters', filters); }, [filters]);

  // a search is running somewhere (this page, an earlier visit, the owner's refresh): look in until it lands
  useEffect(() => {
    if (!active || busy) return undefined;
    const t = setInterval(loadLibrary, 6000);
    return () => clearInterval(t);
  }, [active, busy]);

  useEffect(() => {
    if (!watched.length) return;
    fetch(`/api/phones/history?ids=${encodeURIComponent(watched.join(','))}`).then((r) => r.json())
      .then((j) => setHistory(j.history ?? {})).catch(() => {});
  }, [watched, library]);

  const model = useMemo(() => buildModel(prefs), [prefs]);
  const ranked = useMemo(() => (library ?? [])
    .filter((p) => passes(p, filters, model))
    .map((p) => ({ ...p, fit: fitOf(p, model) }))
    .sort((a, b) => b.fit.match - a.fit.match), [library, filters, model]);
  const top = ranked.slice(0, 5);
  const rest = ranked.slice(5);
  const compareIds = picked ?? top.map((p) => p.id);
  const compare = ranked.filter((p) => compareIds.includes(p.id));
  const lastUpdated = (library ?? []).reduce((m, p) => Math.max(m, Date.parse(p.updated_at) || 0), 0);

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
  const brandCount = (b) => (library ?? []).filter((p) => String(p.brand).toLowerCase() === b.toLowerCase()).length || null;

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
  const reset = () => { setPrefs(EMPTY_PREFS); setFilters(DEFAULT_FILTERS); setPicked(null); };

  async function find(e) {
    e?.preventDefault();
    const leaning = Object.values(prefs.brands).some((v) => v >= 25);
    if (busy || (!text.trim() && !leaning)) { if (!busy && !text.trim()) setNote('원하는 걸 글로 쓰거나, 브랜드 취향을 "선호" 쪽으로 밀어주세요.'); return; }
    setBusy(true); setNote(''); setProg({ step: '요청을 읽는 중', done: 0, total: 0 });
    try {
      let nextPrefs = prefs;
      let nextFilters = filters;
      let models = [];
      let reason = '';
      if (text.trim()) {
        const pr = await fetch('/api/phones/plan', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, brands: Object.entries(prefs.brands).filter(([, v]) => v >= 25).map(([k]) => k) }),
        });
        const plan = await pr.json();
        if (!pr.ok) throw new Error(plan.error || pr.status);
        nextPrefs = {
          sp: { ...EMPTY_PREFS.sp, ...plan.spectra },
          brands: Object.fromEntries(plan.brand_affinity.map((b) => [b.brand, b.score])),
          chips: Object.fromEntries(plan.chip_affinity.map((c) => [c.family, c.score])),
        };
        nextFilters = {
          ...filters, maxMan: plan.budget_max_man ?? 0, maxWeight: plan.max_weight_g ?? 0, minBattery: plan.min_battery_mah ?? 0,
          onlyConfirmed: plan.only_confirmed, upcoming: plan.include_upcoming,
        };
        setPrefs(nextPrefs); setFilters(nextFilters); setPicked(null);
        models = plan.models; reason = plan.reason;
        setNote(reason);
      }
      const sr = await fetch('/api/phones/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: payloadFrom(nextPrefs, nextFilters, models, reason) }),
      });
      const sj = await sr.json();
      if (!sr.ok) { setNote(`${reason} ${ERR[sj.error] ?? `(${sj.error})`}`.trim()); setBusy(false); setProg(null); return; }
      // the search runs for a few minutes on the server; look in on it
      const until = Date.now() + 6 * 60e3;
      while (alive.current && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 4000));
        const jr = await fetch(`/api/phones/search?id=${sj.id}`).then((r) => r.json()).catch(() => null);
        if (!jr) continue;
        if (jr.progress) setProg(jr.progress);
        if (jr.status === 'done') {
          await loadLibrary();
          const failed = jr.result?.failed?.length ? ` · 조사 못한 폰 ${jr.result.failed.length}개 (${jr.result.failed.map((f) => f.name).join(', ')})` : '';
          setNote(`${reason ? `${reason} ` : ''}조사 완료: ${jr.result?.ids?.length ?? 0}개${failed}`);
          break;
        }
        if (jr.status === 'error') { setNote(`조사에 실패했어요 (${jr.error}).`); break; }
      }
    } catch (err) {
      setNote(`요청을 처리하지 못했어요 (${err.message}).`);
    } finally {
      setBusy(false); setProg(null);
    }
  }

  const watchedPhones = ranked.length || library?.length
    ? (library ?? []).filter((p) => watched.includes(p.id)).map((p) => ({ ...p, fit: fitOf(p, model) }))
    : [];
  const series = watchedPhones.map((p, i) => {
    const snaps = history[p.id] ?? [];
    const pts = (snaps.length ? snaps : [{ at: p.updated_at, data: p }])
      .map((s) => ({ t: Date.parse(s.at), fit: fitOf(s.data, model).match, changes: s.data.changes ?? [] }));
    return { id: p.id, name: `${p.brand} ${p.name}`, color: COLORS[i % COLORS.length], points: pts };
  });
  const pct = prog?.total ? Math.round((prog.done / prog.total) * 100) : 0;

  return (
    <main className="np">
      <header className="hd">
        <div>
          <h1>newphoneprediction</h1>
          <p>유출 정보·스펙·여론을 AI가 찾아오고, 내 취향이 어느 쪽으로 치우쳤는지에 맞춰 순위를 매겨요.</p>
        </div>
        {!!lastUpdated && <div className="hd-meta"><span>마지막 조사</span><b>{when(lastUpdated)}</b><span>조사된 폰 {library.length}개</span></div>}
      </header>

      <form className="card ask" onSubmit={find}>
        <label htmlFor="ask" className="ask-label">무엇을 찾아볼까요?</label>
        <textarea id="ask" value={text} maxLength={400} rows={2} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) find(e); }}
          placeholder="원하는 폰을 편하게 말해보세요. 이름을 쓰면 그 폰을 찾아와요." />
        <div className="ask-row">
          <div className="ex">
            {EXAMPLES.map((x) => <button type="button" key={x} className="ex-chip" onClick={() => setText(x)}>{x}</button>)}
          </div>
          <button className="go" disabled={busy}>{busy ? '찾는 중…' : '찾아서 알려줘'}</button>
        </div>
        {busy && prog && (
          <div className="prog" role="status">
            <div className="prog-bar"><i style={{ width: `${Math.max(6, pct)}%` }} /></div>
            <span>{prog.step}{prog.total ? ` · 조사원 ${prog.done}/${prog.total}` : ''} — AI 여러 마리가 동시에 분업 중이에요. 몇 분 걸리고 닫아도 계속돼요.</span>
          </div>
        )}
        {note && <p className="ask-note">{note}</p>}
      </form>

      {library === undefined && <p className="np-note">불러오는 중…</p>}
      {active && !busy && (
        <p className="banner">지금 AI 조사원들이 조사 중이에요{active.progress?.total ? ` (${active.progress.done}/${active.progress.total})` : ''}. 끝나면 이 화면에 자동으로 나타나요.</p>
      )}
      {library?.length === 0 && !active && <p className="np-note">아직 조사된 폰이 없어요{error ? ` (${error})` : ''}. 위에 원하는 걸 쓰거나 브랜드 취향을 "선호"로 밀고 "찾아서 알려줘"를 눌러보세요.</p>}

      <button type="button" className="panel-toggle" onClick={() => setPanel(!panel)} aria-expanded={panel}>
        {panel ? '취향 조정 닫기' : '내 취향 조정하기'}
      </button>

      <div className="grid">
        <aside className={`aside${panel ? ' open' : ''}`}>
          <Controls prefs={prefs} setPrefs={setPrefs} filters={filters} setFilters={setFilters}
            brandOptions={brandOptions} brandCount={brandCount} onReset={reset} />
        </aside>

        <div className="np-results" ref={resultsRef}>
          {!!library?.length && (
            <>
              <div className="res-head">
                <h2>나에게 맞는 TOP 5</h2>
                <span>{ranked.length}개 중 · 슬라이더를 움직이면 바로 바뀌어요</span>
              </div>
              {!top.length && <p className="np-note">조건에 맞는 폰이 없어요. 한도나 제외한 항목을 풀어보세요.</p>}
              <ol className="tops">
                {top.map((p, i) => (
                  <TopCard key={p.id} p={p} rank={i + 1} move={moves[p.id]} watched={watched.includes(p.id)} onWatch={() => toggleWatch(p.id)}
                    picked={compareIds.includes(p.id)} onPick={() => toggle(p.id)} open={open === p.id} onOpen={() => setOpen(open === p.id ? null : p.id)} />
                ))}
              </ol>

              {!!watchedPhones.length && <WatchPanel phones={watchedPhones} series={series} />}
              {!!compare.length && <Compare compare={compare} />}
              {picked && <p className="np-note">비교 대상을 직접 골랐어요. <button className="np-link" onClick={() => setPicked(null)}>TOP 5로 되돌리기</button></p>}

              {!!rest.length && (
                <section>
                  <div className="res-head"><h2>나머지 {rest.length}개</h2><span>체크하면 비교에 추가 (최대 5개)</span></div>
                  <ul className="rows">
                    {rest.map((p) => (
                      <RowItem key={p.id} p={p} picked={compareIds.includes(p.id)} onPick={() => toggle(p.id)}
                        watched={watched.includes(p.id)} onWatch={() => toggleWatch(p.id)} />
                    ))}
                  </ul>
                </section>
              )}
              <p className="np-meta np-foot">GPT가 웹 검색으로 모은 정보를 정리한 것이라 틀릴 수 있어요. 점선 밑줄과 "유력·추정" 표시는 확정이 아닌 예상치이고, 루머는 말 그대로 루머입니다. 이미지는 위키백과에서 가져오며 출시 전 폰은 전작·시리즈 이미지로 대신해요.</p>
            </>
          )}
        </div>
      </div>

      {panel && !!top.length && (
        <div className="dock" role="status">
          <ol>{top.slice(0, 3).map((p, i) => <li key={p.id}><b>{i + 1}</b> {p.name} <em>{p.fit.match}%</em></li>)}</ol>
          <button type="button" onClick={() => { setPanel(false); resultsRef.current?.scrollIntoView({ behavior: 'smooth' }); }}>결과 보기</button>
        </div>
      )}
    </main>
  );
}
