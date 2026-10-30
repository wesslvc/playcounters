'use client';

import { useEffect, useMemo, useState } from 'react';

const AXES = [
  ['performance', '성능'], ['camera', '카메라'], ['battery', '배터리'], ['display', '디스플레이'],
  ['lightness', '가벼움'], ['software', '업데이트'], ['value', '가성비'], ['design', '디자인'],
];
const DEFAULTS = { performance: 3, camera: 3, battery: 3, display: 2, lightness: 2, software: 2, value: 2, design: 2 };
const clamp = (n) => Math.max(0, Math.min(100, n));

/** All eight axes on a 0–100 scale; the model's own scores plus ones computed from the numbers. */
function axes(p) {
  const s = p.scores;
  const avg = (s.performance + s.camera + s.battery + s.display) / 4;
  const priceScore = p.price_krw == null ? 50 : clamp(100 - ((p.price_krw - 600000) / 2000000) * 100);
  return {
    performance: s.performance, camera: s.camera, battery: s.battery, display: s.display, design: s.design,
    lightness: p.weight_g == null ? 50 : clamp(((260 - p.weight_g) / 100) * 100),
    software: p.update_years == null ? 50 : clamp((p.update_years / 7) * 100),
    value: Math.round(avg * 0.4 + priceScore * 0.6),
  };
}

const won = (n) => (n == null ? '—' : `${Math.round(n / 10000).toLocaleString()}만원`);
const STATUS = { released: '출시', upcoming: '출시 예정', rumored: '루머' };

export default function Client() {
  const [report, setReport] = useState(undefined);
  const [error, setError] = useState('');
  const [weights, setWeights] = useState(DEFAULTS);
  const [os, setOs] = useState('any');
  const [form, setForm] = useState('any');
  const [budget, setBudget] = useState(0);
  const [upcoming, setUpcoming] = useState(true);
  const [taste, setTaste] = useState('');
  const [tasteBusy, setTasteBusy] = useState(false);
  const [tasteNote, setTasteNote] = useState('');
  const [picked, setPicked] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    fetch('/api/phones').then((r) => r.json())
      .then((j) => { setReport(j.report ?? null); if (j.error) setError(j.error); })
      .catch((e) => { setReport(null); setError(e.message); });
  }, []);

  const ranked = useMemo(() => {
    if (!report) return [];
    const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
    return report.phones
      .filter((p) => (os === 'any' || p.os === os)
        && (form === 'any' || p.form === form)
        && (upcoming || p.status === 'released')
        && (!budget || p.price_krw == null || p.price_krw <= budget * 10000))
      .map((p) => {
        const a = axes(p);
        const parts = AXES.map(([k, label]) => ({ k, label, v: (a[k] * weights[k]) / total }));
        const match = Math.round(parts.reduce((x, y) => x + y.v, 0));
        const why = parts.filter((x) => weights[x.k] > 0).sort((x, y) => y.v - x.v).slice(0, 2).map((x) => x.label);
        return { ...p, a, match, why };
      })
      .sort((x, y) => y.match - x.match);
  }, [report, weights, os, form, budget, upcoming]);

  const top = ranked.slice(0, 5);
  const rest = ranked.slice(5);
  // until the reader chooses, the comparison follows the top five
  const compareIds = picked ?? top.map((p) => p.id);
  const compare = ranked.filter((p) => compareIds.includes(p.id));
  const toggle = (id) => {
    const cur = new Set(compareIds);
    if (cur.has(id)) cur.delete(id); else if (cur.size < 5) cur.add(id);
    setPicked([...cur]);
  };

  async function askTaste(e) {
    e.preventDefault();
    if (!taste.trim() || tasteBusy) return;
    setTasteBusy(true); setTasteNote('');
    try {
      const r = await fetch('/api/phones/taste', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: taste }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      setWeights(j.weights); setOs(j.os); setForm(j.form); setBudget(j.budget_man ?? 0); setPicked(null);
      setTasteNote(j.reason);
    } catch (err) {
      setTasteNote(`취향을 읽지 못했어요 (${err.message}). 아래 슬라이더로 직접 맞춰보세요.`);
    } finally { setTasteBusy(false); }
  }

  const row = (label, f, best) => (
    <tr key={label}>
      <th>{label}</th>
      {compare.map((p) => <td key={p.id} className={best && best(p) ? 'np-best' : ''}>{f(p)}</td>)}
    </tr>
  );
  const bestMax = (key) => { const m = Math.max(...compare.map((p) => p.a[key])); return (p) => p.a[key] === m && compare.length > 1; };
  const bestMin = (key) => { const v = compare.map((p) => p[key]).filter((x) => x != null); const m = Math.min(...v); return (p) => p[key] === m && compare.length > 1; };
  const bestMaxRaw = (key) => { const v = compare.map((p) => p[key]).filter((x) => x != null); const m = Math.max(...v); return (p) => p[key] === m && compare.length > 1; };

  return (
    <main className="np">
      <header className="np-head">
        <h1>newphoneprediction</h1>
        <p>Ice Universe · 알뷰 등의 유출 정보와 스펙을 모아, 내 취향에 맞는 폰 5개를 골라 비교합니다.</p>
      </header>

      {report === undefined && <p className="np-note">불러오는 중…</p>}
      {report === null && (
        <p className="np-note">
          아직 수집된 정보가 없습니다.{error ? ` (${error})` : ''} 서버에서 <code>/api/phones/refresh</code>를 한 번 실행하면 채워져요.
        </p>
      )}

      {report && (
        <>
          <section className="np-card">
            <p className="np-sum">{report.summary}</p>
            <p className="np-meta">
              수집 {new Date(report.generated_at).toLocaleString('ko-KR')} · 폰 {report.phones.length}개
              {report.failed ? ` · 수집 실패한 조사 ${report.failed}건` : ''}
            </p>
          </section>

          <section className="np-card">
            <h2>내 취향</h2>
            <form className="np-taste" onSubmit={askTaste}>
              <input value={taste} maxLength={200} onChange={(e) => setTaste(e.target.value)}
                placeholder="예: 게임 많이 하고 가벼운 폰, 150만원 이하" />
              <button disabled={tasteBusy}>{tasteBusy ? '분석 중…' : 'GPT로 맞추기'}</button>
            </form>
            {tasteNote && <p className="np-note">{tasteNote}</p>}
            <div className="np-sliders">
              {AXES.map(([k, label]) => (
                <label key={k}>
                  <span>{label} <b>{weights[k]}</b></span>
                  <input type="range" min="0" max="5" value={weights[k]}
                    onChange={(e) => setWeights({ ...weights, [k]: +e.target.value })} />
                </label>
              ))}
            </div>
            <div className="np-filters">
              <select value={os} onChange={(e) => setOs(e.target.value)}>
                <option value="any">OS 전체</option><option value="android">안드로이드</option><option value="ios">iOS</option>
              </select>
              <select value={form} onChange={(e) => setForm(e.target.value)}>
                <option value="any">형태 전체</option><option value="bar">바 타입</option>
                <option value="foldable">폴더블</option><option value="flip">플립</option>
              </select>
              <select value={budget} onChange={(e) => setBudget(+e.target.value)}>
                <option value={0}>예산 제한 없음</option>
                {[80, 120, 150, 200, 250].map((b) => <option key={b} value={b}>{b}만원 이하</option>)}
              </select>
              <label className="np-check">
                <input type="checkbox" checked={upcoming} onChange={(e) => setUpcoming(e.target.checked)} /> 출시 예정·루머 포함
              </label>
            </div>
          </section>

          <h2 className="np-h">나에게 맞는 TOP 5</h2>
          {!top.length && <p className="np-note">조건에 맞는 폰이 없어요. 필터를 풀어보세요.</p>}
          <ol className="np-top">
            {top.map((p, i) => (
              <li key={p.id} className="np-card">
                <div className="np-rank">{i + 1}</div>
                <div className="np-body">
                  <div className="np-title">
                    <strong>{p.brand} {p.name}</strong>
                    <span className={`np-tag ${p.status}`}>{STATUS[p.status]}</span>
                  </div>
                  <p className="np-why">{p.why.join('·')} 중심으로 잘 맞아요 · {p.summary}</p>
                  <p className="np-spec">
                    {p.chipset} · {p.weight_g ?? '—'}g · {p.battery_mah ?? '—'}mAh · {won(p.price_krw)} · {p.release}
                  </p>
                  <label className="np-check"><input type="checkbox" checked={compareIds.includes(p.id)} onChange={() => toggle(p.id)} /> 비교에 포함</label>
                  <button className="np-link" onClick={() => setOpen(open === p.id ? null : p.id)}>
                    {open === p.id ? '접기' : '유출·평가 자세히'}
                  </button>
                  {open === p.id && <Detail p={p} />}
                </div>
                <div className="np-match"><b>{p.match}</b><span>%</span></div>
              </li>
            ))}
          </ol>

          {!!compare.length && (
            <section className="np-card np-scroll">
              <h2>비교 ({compare.length}/5)</h2>
              <table className="np-table">
                <thead><tr><th />{compare.map((p) => <th key={p.id}>{p.name}<small>{p.brand}</small></th>)}</tr></thead>
                <tbody>
                  {row('내 취향 일치', (p) => `${p.match}%`, (p) => p.match === Math.max(...compare.map((x) => x.match)) && compare.length > 1)}
                  {row('칩셋', (p) => p.chipset, bestMax('performance'))}
                  {row('무게', (p) => (p.weight_g == null ? '—' : `${p.weight_g}g`), bestMin('weight_g'))}
                  {row('배터리', (p) => `${p.battery_mah ?? '—'}mAh${p.charge_w ? ` · ${p.charge_w}W` : ''}`, bestMaxRaw('battery_mah'))}
                  {row('디스플레이', (p) => p.display, bestMax('display'))}
                  {row('카메라', (p) => p.camera, bestMax('camera'))}
                  {row('업데이트', (p) => (p.update_years == null ? '—' : `${p.update_years}년`), bestMaxRaw('update_years'))}
                  {row('가격', (p) => won(p.price_krw), bestMin('price_krw'))}
                  {row('출시', (p) => `${STATUS[p.status]} · ${p.release}`)}
                  {row('정보 신뢰도', (p) => ({ high: '높음', medium: '보통', low: '낮음' })[p.confidence])}
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
                    <div>
                      <strong>{p.brand} {p.name}</strong> <span className={`np-tag ${p.status}`}>{STATUS[p.status]}</span>
                      <p className="np-spec">{p.chipset} · {p.weight_g ?? '—'}g · {won(p.price_krw)}</p>
                    </div>
                    <div className="np-match small"><b>{p.match}</b><span>%</span></div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!!top.length && picked && (
            <p className="np-note">비교 대상을 직접 골랐어요. <button className="np-link" onClick={() => setPicked(null)}>TOP 5로 되돌리기</button></p>
          )}

          {!!report.sources?.length && (
            <section className="np-card">
              <h2>출처</h2>
              <ul className="np-src">
                {report.sources.map((s, i) => (
                  <li key={i}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a> : s.label}</li>
                ))}
              </ul>
              <p className="np-meta">GPT가 웹 검색으로 모은 정보를 정리한 것이라 틀릴 수 있어요. 루머는 말 그대로 루머입니다.</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function Detail({ p }) {
  return (
    <div className="np-detail">
      {!!p.highlights.length && <ul className="np-pos">{p.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>}
      {!!p.cautions.length && <ul className="np-neg">{p.cautions.map((h, i) => <li key={i}>{h}</li>)}</ul>}
      {!!p.leaks.length && (
        <ul className="np-leaks">
          {p.leaks.map((l, i) => (
            <li key={i}><em className={`c${l.certainty}`}>{l.certainty}</em> {l.claim} <small>— {l.source}</small></li>
          ))}
        </ul>
      )}
    </div>
  );
}
