'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AXES, DEFAULT_WEIGHTS, fitOf, passes, est, won } from './score';
import Radar from './Radar';
import FitChart from './FitChart';

const BRANDS = [
  ['Samsung', '삼성'], ['Apple', '애플'], ['Google', '구글'], ['Xiaomi', '샤오미'], ['OnePlus', '원플러스'],
  ['OPPO', '오포'], ['vivo', '비보'], ['Honor', '아너'], ['Nothing', '나싱'], ['Motorola', '모토로라'], ['Sony', '소니'],
];
const CHIPS = [
  ['snapdragon', '스냅드래곤'], ['exynos', '엑시노스'], ['apple', 'Apple A/M'], ['tensor', '텐서'], ['dimensity', '디멘시티'], ['other', '기타'],
];
const COLORS = ['#4C8DFF', '#F5A524', '#2DB67D', '#E5484D', '#A06AE8', '#14B8C6'];
const STATUS = { released: '출시', upcoming: '출시 예정', rumored: '루머' };
const SENT = { 긍정: 'pos', 혼재: 'mix', 부정: 'neg', '정보 부족': 'none' };
const ERR = {
  'already-running': '이미 조사 중인 요청이 있어요. 끝날 때까지 기다려주세요.',
  busy: '지금 조사 요청이 몰려 있어요. 잠시 후 다시 눌러주세요.',
  'daily-limit': '오늘 조사 가능 횟수를 다 썼어요. 이미 조사된 폰은 계속 볼 수 있어요.',
};

const read = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const when = (t) => (t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

function V({ e, fmt, unit }) {
  const r = est(e, fmt, unit);
  return (
    <span className={`np-v${r.sure ? '' : ' guess'}`} title={r.note || undefined}>
      {r.text}{!r.sure && r.certainty && r.certainty !== '미정' ? <i>{r.certainty}</i> : null}
    </span>
  );
}

function Pic({ p, small }) {
  const [bad, setBad] = useState(false);
  const img = p.image;
  return (
    <div className={`np-pic${small ? ' small' : ''}`}>
      {img && !bad ? (
        <>
          <img src={img.url} alt={`${p.brand} ${p.name}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />
          {img.ref && <span className="np-ref">전작·시리즈 이미지</span>}
        </>
      ) : <span className="np-initial">{String(p.brand ?? '?')[0]}</span>}
    </div>
  );
}

export default function Client() {
  const [library, setLibrary] = useState(undefined);
  const [active, setActive] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [brandSel, setBrandSel] = useState([]);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [os, setOs] = useState('any');
  const [form, setForm] = useState('any');
  const [chipSel, setChipSel] = useState([]);
  const [minMan, setMinMan] = useState(0);
  const [maxMan, setMaxMan] = useState(0);
  const [maxWeight, setMaxWeight] = useState(0);
  const [minBattery, setMinBattery] = useState(0);
  const [onlyConfirmed, setOnlyConfirmed] = useState(false);
  const [upcoming, setUpcoming] = useState(true);
  const [fine, setFine] = useState(false);
  const [picked, setPicked] = useState(null);
  const [open, setOpen] = useState(null);
  const [watched, setWatched] = useState([]);
  const [history, setHistory] = useState({});
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);
  const [note, setNote] = useState('');
  const alive = useRef(true);

  const loadLibrary = () => fetch('/api/phones').then((r) => r.json())
    .then((j) => { setLibrary(j.phones ?? []); setActive(j.active ?? null); if (j.error) setError(j.error); return j.phones ?? []; })
    .catch((e) => { setLibrary((l) => l ?? []); setError(e.message); return []; });

  useEffect(() => {
    alive.current = true;
    setWatched(read('npp.watch', []));
    const w = read('npp.weights', null);
    if (w) setWeights({ ...DEFAULT_WEIGHTS, ...w });
    loadLibrary();
    return () => { alive.current = false; };
  }, []);
  useEffect(() => { write('npp.weights', weights); }, [weights]);

  // a search is running somewhere (this page, an earlier visit, the owner's refresh): keep looking in until it lands
  useEffect(() => {
    if (!active || busy) return undefined;
    const t = setInterval(loadLibrary, 6000);
    return () => clearInterval(t);
  }, [active, busy]);

  // the graph's history, for whatever is followed
  useEffect(() => {
    if (!watched.length) return;
    fetch(`/api/phones/history?ids=${encodeURIComponent(watched.join(','))}`).then((r) => r.json())
      .then((j) => setHistory(j.history ?? {})).catch(() => {});
  }, [watched, library]);

  const filters = useMemo(() => ({
    brands: new Set(brandSel.map((b) => b.toLowerCase())), os, form, chips: new Set(chipSel),
    upcoming, onlyConfirmed, maxMan, minMan, maxWeight, minBattery,
  }), [brandSel, os, form, chipSel, upcoming, onlyConfirmed, maxMan, minMan, maxWeight, minBattery]);

  const ranked = useMemo(() => (library ?? [])
    .filter((p) => passes(p, filters))
    .map((p) => ({ ...p, fit: fitOf(p, weights) }))
    .sort((a, b) => b.fit.match - a.fit.match), [library, filters, weights]);
  const top = ranked.slice(0, 5);
  const rest = ranked.slice(5);
  const compareIds = picked ?? top.map((p) => p.id);
  const compare = ranked.filter((p) => compareIds.includes(p.id));
  const lastUpdated = (library ?? []).reduce((m, p) => Math.max(m, Date.parse(p.updated_at) || 0), 0);

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

  function applyPlan(plan) {
    setWeights({ ...DEFAULT_WEIGHTS, ...plan.weights });
    setOs(plan.os); setForm(plan.form);
    setBrandSel(plan.brands ?? []);
    setChipSel(plan.chip_families ?? []);
    setMinMan(plan.budget_min_man ?? 0); setMaxMan(plan.budget_max_man ?? 0);
    setMaxWeight(plan.max_weight_g ?? 0); setMinBattery(plan.min_battery_mah ?? 0);
    setOnlyConfirmed(Boolean(plan.only_confirmed)); setUpcoming(plan.include_upcoming !== false);
    setPicked(null);
  }

  async function find(e) {
    e?.preventDefault();
    if (busy || (!text.trim() && !brandSel.length)) return;
    setBusy(true); setNote(''); setProg({ step: '요청을 읽는 중', done: 0, total: 0 });
    try {
      const pr = await fetch('/api/phones/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, brands: brandSel }) });
      const plan = await pr.json();
      if (!pr.ok) throw new Error(plan.error || pr.status);
      applyPlan(plan);
      setNote(plan.reason);
      const sr = await fetch('/api/phones/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) });
      const sj = await sr.json();
      if (!sr.ok) { setNote(`${plan.reason} ${ERR[sj.error] ?? `(${sj.error})`}`); setBusy(false); setProg(null); return; }
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
          setNote(`${plan.reason} 조사 완료: ${jr.result?.ids?.length ?? 0}개${failed}`);
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

  const watchedPhones = (library ?? []).filter((p) => watched.includes(p.id));
  const series = watchedPhones.map((p, i) => {
    const snaps = history[p.id] ?? [];
    const pts = (snaps.length ? snaps : [{ at: p.updated_at, data: p }])
      .map((s) => ({ t: Date.parse(s.at), fit: fitOf(s.data, weights).match, changes: s.data.changes ?? [] }));
    return { id: p.id, name: `${p.brand} ${p.name}`, color: COLORS[i % COLORS.length], points: pts };
  });

  const best = (key) => { const m = Math.max(...compare.map((p) => p.fit.axes[key])); return (p) => compare.length > 1 && p.fit.axes[key] === m; };
  const row = (label, f, hl) => (
    <tr key={label}><th>{label}</th>{compare.map((p) => <td key={p.id} className={hl?.(p) ? 'np-best' : ''}>{f(p)}</td>)}</tr>
  );

  return (
    <main className="np">
      <header className="np-head">
        <h1>newphoneprediction</h1>
        <p>원하는 폰을 말하거나 브랜드를 고르면, 유출 정보·스펙·여론을 찾아와서 내 취향에 맞는 순서로 보여줍니다.</p>
        {!!lastUpdated && <p className="np-meta">마지막 조사 {when(lastUpdated)} · 조사된 폰 {library.length}개</p>}
      </header>

      <form className="np-card np-ask" onSubmit={find}>
        <h2>무엇을 찾아볼까요?</h2>
        <textarea value={text} maxLength={400} rows={2} onChange={(e) => setText(e.target.value)}
          placeholder="예: 게임 많이 하고 가벼운 삼성폰, 150만원 이하 / 갤럭시 S27 울트라가 아이폰 18 프로보다 나을까?" />
        <div className="np-brands">
          {brandOptions.map(([b, ko]) => (
            <button type="button" key={b} className={`np-chip${brandSel.includes(b) ? ' on' : ''}`}
              onClick={() => setBrandSel(brandSel.includes(b) ? brandSel.filter((x) => x !== b) : [...brandSel, b])}>{ko}</button>
          ))}
        </div>
        <div className="np-collect">
          <button className="np-go" disabled={busy || (!text.trim() && !brandSel.length)}>{busy ? '찾는 중…' : '찾아서 알려줘'}</button>
          {busy && prog && (
            <span className="np-note">{prog.step}{prog.total ? ` ${prog.done}/${prog.total}` : ''} · AI 여러 마리가 동시에 분업 중 · 몇 분 걸려요, 닫아도 계속돼요</span>
          )}
        </div>
        {note && <p className="np-note">{note}</p>}
        {!busy && <p className="np-meta">이미 조사한 지 12시간이 안 된 폰은 다시 찾지 않고 저장된 정보를 보여줘요. 브랜드만 골라서 눌러도 돼요.</p>}
      </form>

      {library === undefined && <p className="np-note">불러오는 중…</p>}
      {active && !busy && (
        <p className="np-note">지금 AI 조사원들이 조사 중이에요{active.progress?.total ? ` (${active.progress.done}/${active.progress.total})` : ''}. 끝나면 이 화면에 자동으로 나타나요.</p>
      )}
      {library?.length === 0 && !active && <p className="np-note">아직 조사된 폰이 없어요{error ? ` (${error})` : ''}. 위에서 브랜드를 고르고 "찾아서 알려줘"를 눌러보세요.</p>}

      {!!library?.length && (
        <>
          <section className="np-card">
            <div className="np-rowh">
              <h2>내 취향 조정</h2>
              <button className="np-link" onClick={() => setFine(!fine)}>{fine ? '간단히' : '더 자세히'}</button>
            </div>
            <div className="np-sliders">
              {AXES.filter(([k]) => fine || ['performance', 'camera', 'battery', 'lightness', 'value', 'opinion'].includes(k)).map(([k, label]) => (
                <label key={k}>
                  <span>{label} <b>{weights[k]}</b></span>
                  <input type="range" min="0" max="5" value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: +e.target.value })} />
                </label>
              ))}
            </div>
            <div className="np-filters">
              <select value={os} onChange={(e) => setOs(e.target.value)}>
                <option value="any">OS 전체</option><option value="android">안드로이드</option><option value="ios">iOS</option>
              </select>
              <select value={form} onChange={(e) => setForm(e.target.value)}>
                <option value="any">형태 전체</option><option value="bar">바 타입</option><option value="foldable">폴더블</option><option value="flip">플립</option>
              </select>
              <select value={maxMan} onChange={(e) => setMaxMan(+e.target.value)}>
                <option value={0}>예산 제한 없음</option>
                {[80, 120, 150, 200, 250, 300].map((b) => <option key={b} value={b}>{b}만원 이하</option>)}
              </select>
              <label className="np-check"><input type="checkbox" checked={upcoming} onChange={(e) => setUpcoming(e.target.checked)} /> 출시 예정·루머 포함</label>
              <label className="np-check"><input type="checkbox" checked={onlyConfirmed} onChange={(e) => setOnlyConfirmed(e.target.checked)} /> 확실한 정보만</label>
            </div>
            {fine && (
              <div className="np-filters np-fine">
                <div className="np-brands">
                  {CHIPS.map(([c, ko]) => (
                    <button type="button" key={c} className={`np-chip${chipSel.includes(c) ? ' on' : ''}`}
                      onClick={() => setChipSel(chipSel.includes(c) ? chipSel.filter((x) => x !== c) : [...chipSel, c])}>{ko}</button>
                  ))}
                </div>
                <label className="np-num">최소 가격(만원) <input type="number" min="0" value={minMan || ''} onChange={(e) => setMinMan(+e.target.value || 0)} /></label>
                <label className="np-num">최대 무게(g) <input type="number" min="0" value={maxWeight || ''} onChange={(e) => setMaxWeight(+e.target.value || 0)} /></label>
                <label className="np-num">최소 배터리(mAh) <input type="number" min="0" value={minBattery || ''} onChange={(e) => setMinBattery(+e.target.value || 0)} /></label>
                <button className="np-link" onClick={() => { setWeights(DEFAULT_WEIGHTS); setOs('any'); setForm('any'); setChipSel([]); setMinMan(0); setMaxMan(0); setMaxWeight(0); setMinBattery(0); setOnlyConfirmed(false); setUpcoming(true); setBrandSel([]); }}>전부 초기화</button>
              </div>
            )}
          </section>

          <h2 className="np-h">나에게 맞는 TOP 5</h2>
          {!top.length && <p className="np-note">조건에 맞는 폰이 없어요. 필터를 풀거나 위에서 새로 찾아보세요.</p>}
          <ol className="np-top">
            {top.map((p, i) => (
              <Card key={p.id} p={p} rank={i + 1} watched={watched.includes(p.id)} onWatch={() => toggleWatch(p.id)}
                picked={compareIds.includes(p.id)} onPick={() => toggle(p.id)} open={open === p.id} onOpen={() => setOpen(open === p.id ? null : p.id)} />
            ))}
          </ol>

          {!!watchedPhones.length && (
            <section className="np-card">
              <h2>관심 폰 · 적합도 변화</h2>
              <p className="np-meta">새 유출이 나오면 매일 자동으로 다시 조사해 반영돼요. 큰 점은 정보가 바뀐 날(올려보면 내용이 보여요).</p>
              <FitChart series={series} />
              <ul className="np-legend">
                {series.map((s, i) => {
                  const p = watchedPhones[i];
                  return (
                    <li key={s.id} style={{ '--c': s.color }}>
                      <b>{s.name}</b> {fitOf(p, weights).match}% · 업데이트 {when(p.updated_at)}
                      {!!p.changes?.length && <small> — {p.changes[0]}</small>}
                      {s.points.length < 2 && <small> — 다음 갱신부터 변화가 그려져요</small>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {!!compare.length && (
            <section className="np-card np-scroll">
              <h2>비교 ({compare.length}/5)</h2>
              <div className="np-cmp-top">
                <Radar size={260} series={compare.map((p, i) => ({ label: p.name, color: COLORS[i % COLORS.length], values: p.fit.axes }))} />
                <ul className="np-legend">
                  {compare.map((p, i) => <li key={p.id} style={{ '--c': COLORS[i % COLORS.length] }}><b>{p.brand} {p.name}</b></li>)}
                </ul>
              </div>
              <table className="np-table">
                <thead><tr><th />{compare.map((p) => <th key={p.id}><Pic p={p} small />{p.name}<small>{p.brand}</small></th>)}</tr></thead>
                <tbody>
                  {row('내 취향 일치', (p) => `${p.fit.match}%`, (p) => compare.length > 1 && p.fit.match === Math.max(...compare.map((x) => x.fit.match)))}
                  {row('칩셋', (p) => <>{p.chipset?.name ?? '미정'}{p.chipset?.certainty && p.chipset.certainty !== '확정' ? <i className="np-i">{p.chipset.certainty}</i> : null}</>, best('performance'))}
                  {row('무게', (p) => <V e={p.weight_g} unit="g" />, best('lightness'))}
                  {row('두께', (p) => <V e={p.thickness_mm} unit="mm" />)}
                  {row('화면', (p) => <>{p.display} <V e={p.screen_in} unit="인치" /></>, best('display'))}
                  {row('배터리', (p) => <V e={p.battery_mah} fmt={(x) => `${Math.round(x).toLocaleString()}mAh`} />, best('battery'))}
                  {row('충전', (p) => <V e={p.charge_w} unit="W" />, best('charging'))}
                  {row('카메라', (p) => p.camera, best('camera'))}
                  {row('업데이트', (p) => <V e={p.update_years} unit="년" />, best('software'))}
                  {row('가격', (p) => <V e={p.price_krw} fmt={won} />, best('value'))}
                  {row('여론', (p) => <>{p.opinion?.sentiment} · {p.opinion?.score}점</>, best('opinion'))}
                  {row('출시', (p) => `${STATUS[p.status]} · ${p.release}`)}
                  {row('정보 확실성', (p) => ({ high: '높음', medium: '보통', low: '낮음' })[p.confidence])}
                  {row('업데이트', (p) => when(p.updated_at))}
                </tbody>
              </table>
            </section>
          )}

          {!!rest.length && (
            <section>
              <h2 className="np-h">나머지 {rest.length}개 <small>(체크하면 비교에 추가, 최대 5개)</small></h2>
              <ul className="np-rest">
                {rest.map((p) => (
                  <li key={p.id} className="np-card">
                    <input type="checkbox" checked={compareIds.includes(p.id)} onChange={() => toggle(p.id)} aria-label={`${p.name} 비교`} />
                    <Pic p={p} small />
                    <div>
                      <strong>{p.brand} {p.name}</strong> <span className={`np-tag ${p.status}`}>{STATUS[p.status]}</span>
                      <p className="np-spec">{p.chipset?.name} · <V e={p.weight_g} unit="g" /> · <V e={p.price_krw} fmt={won} /> · 업데이트 {when(p.updated_at)}</p>
                    </div>
                    <button className={`np-star${watched.includes(p.id) ? ' on' : ''}`} onClick={() => toggleWatch(p.id)} aria-label="관심 폰">★</button>
                    <div className="np-match small"><b>{p.fit.match}</b><span>%</span></div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {picked && <p className="np-note">비교 대상을 직접 골랐어요. <button className="np-link" onClick={() => setPicked(null)}>TOP 5로 되돌리기</button></p>}
          <p className="np-meta">GPT가 웹 검색으로 모은 정보를 정리한 것이라 틀릴 수 있어요. 점선 밑줄과 "유력·추정" 표시는 확정이 아닌 예상치이고, 루머는 말 그대로 루머입니다. 이미지는 위키백과에서 가져오며 출시 전 폰은 전작·시리즈 이미지로 대신해요.</p>
        </>
      )}
    </main>
  );
}

function Card({ p, rank, watched, onWatch, picked, onPick, open, onOpen }) {
  const f = p.fit;
  return (
    <li className="np-card np-phone">
      <div className="np-rank">{rank}</div>
      <Pic p={p} />
      <div className="np-body">
        <div className="np-title">
          <strong>{p.brand} {p.name}</strong>
          <span className={`np-tag ${p.status}`}>{STATUS[p.status]}</span>
          {p.chipset?.family && <span className="np-tag">{p.chipset.family}</span>}
        </div>
        <p className="np-why">{f.why.join('·')} 중심으로 잘 맞아요 · {p.summary}</p>
        <p className="np-spec">
          칩셋 <b>{p.chipset?.name ?? '미정'}</b>{p.chipset?.certainty && p.chipset.certainty !== '확정' ? <i className="np-i">{p.chipset.certainty}</i> : null}
          {' · '}<V e={p.weight_g} unit="g" />
          {' · '}<V e={p.battery_mah} fmt={(x) => `${Math.round(x).toLocaleString()}mAh`} />
          {' · '}<V e={p.price_krw} fmt={won} />
          {' · '}{p.release}
        </p>
        {p.opinion && (
          <p className="np-op"><em className={SENT[p.opinion.sentiment]}>{p.opinion.sentiment}</em> {p.opinion.summary}</p>
        )}
        <div className="np-actions">
          <label className="np-check"><input type="checkbox" checked={picked} onChange={onPick} /> 비교</label>
          <button className={`np-star${watched ? ' on' : ''}`} onClick={onWatch}>{watched ? '★ 관심 폰' : '☆ 관심 폰 추가'}</button>
          <button className="np-link" onClick={onOpen}>{open ? '접기' : '유출·여론 자세히'}</button>
          <span className="np-meta">업데이트 {when(p.updated_at)}</span>
        </div>
        {open && <Detail p={p} />}
      </div>
      <div className="np-side">
        <div className="np-match"><b>{f.match}</b><span>%</span></div>
        <Radar mini size={96} series={[{ label: p.name, color: '#4C8DFF', values: f.axes }]} />
      </div>
    </li>
  );
}

function Detail({ p }) {
  const pros = p.opinion?.points?.filter((x) => x.stance === 'pro') ?? [];
  const cons = p.opinion?.points?.filter((x) => x.stance === 'con') ?? [];
  return (
    <div className="np-detail">
      {!!p.changes?.length && (
        <div><h4>최근 바뀐 정보</h4><ul className="np-new">{p.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
      )}
      <div className="np-two">
        <div><h4>장점</h4><ul className="np-pos">{[...p.highlights, ...pros.map((x) => `${x.text} (${x.source})`)].map((h, i) => <li key={i}>{h}</li>)}</ul></div>
        <div><h4>아쉬운 점</h4><ul className="np-neg">{[...p.cautions, ...cons.map((x) => `${x.text} (${x.source})`)].map((h, i) => <li key={i}>{h}</li>)}</ul></div>
      </div>
      <div>
        <h4>수치별 근거</h4>
        <ul className="np-basis">
          {[['칩셋', p.chipset?.note], ['무게', p.weight_g?.note], ['배터리', p.battery_mah?.note], ['충전', p.charge_w?.note], ['가격', p.price_krw?.note], ['업데이트', p.update_years?.note]]
            .filter(([, n]) => n).map(([k, n]) => <li key={k}><b>{k}</b> {n}</li>)}
        </ul>
      </div>
      {!!p.leaks?.length && (
        <div>
          <h4>유출·보도 ({p.leaks.length})</h4>
          <ul className="np-leaks">
            {p.leaks.map((l, i) => (
              <li key={i}><em className={`c${l.certainty}`}>{l.certainty}</em> {l.claim}{' '}
                <small>— {l.who}{l.date ? ` · ${l.date}` : ''}{/^https?:/.test(l.source) ? <> · <a href={l.source} target="_blank" rel="noreferrer noopener">원문</a></> : ` · ${l.source}`}</small></li>
            ))}
          </ul>
        </div>
      )}
      {!!p.sources?.length && (
        <div>
          <h4>출처</h4>
          <ul className="np-src">{p.sources.map((s, i) => <li key={i}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a> : s.label}</li>)}</ul>
          {p.image?.page && <p className="np-meta">이미지: <a href={p.image.page} target="_blank" rel="noreferrer noopener">Wikipedia</a></p>}
        </div>
      )}
    </div>
  );
}
