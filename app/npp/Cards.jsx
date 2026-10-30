import { useState } from 'react';
import { est, won } from './score';
import Radar from './Radar';
import FitChart from './FitChart';

export const COLORS = ['#4F5BFF', '#F5A524', '#2DB67D', '#E5484D', '#A06AE8', '#14B8C6'];
const STATUS = { released: '출시', upcoming: '출시 예정', rumored: '루머' };
const FAMILY = { snapdragon: '스냅드래곤', exynos: '엑시노스', apple: 'Apple', tensor: '텐서', dimensity: '디멘시티', other: '기타 칩' };
const SENT = { 긍정: 'pos', 혼재: 'mix', 부정: 'neg', '정보 부족': 'none' };
const mah = (x) => `${Math.round(x).toLocaleString()}mAh`;

export const when = (t) => (t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** A figure that may not be confirmed: estimates get a dashed underline and a badge. */
export function V({ e, fmt, unit, stack }) {
  const r = est(e, fmt, unit);
  return (
    <>
      <span className={`np-v${r.sure ? '' : ' guess'}${r.text === '미정' ? ' none' : ''}`} title={r.note || undefined}>
        {r.text}{!r.sure && r.certainty && r.certainty !== '미정' ? <i>{r.certainty}</i> : null}
      </span>
      {r.range && <small className={`rng${stack ? ' stack' : ''}`}>{r.range}</small>}
    </>
  );
}

export function Pic({ p, small }) {
  const [bad, setBad] = useState(false);
  const img = p.image;
  return (
    <div className={`np-pic${small ? ' small' : ''}`}>
      {img && !bad ? (
        <>
          <img src={img.url} alt={`${p.brand} ${p.name}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />
          {img.ref && !small && <span className="np-ref">전작·시리즈 이미지</span>}
        </>
      ) : <span className="np-initial">{String(p.brand ?? '?')[0]}</span>}
    </div>
  );
}

function Ring({ value, size = 76 }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className="np-ring-fit" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`적합도 ${value}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="rf-bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="rf-fg" strokeDasharray={`${(c * value) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dy=".35em" textAnchor="middle" className="rf-t">{value}<tspan className="rf-u">%</tspan></text>
    </svg>
  );
}

function Move({ d }) {
  if (!d) return null;
  return <span className={`np-move ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? '▲' : '▼'}{Math.abs(d)}</span>;
}

export function TopCard({ p, rank, move, watched, onWatch, picked, onPick, open, onOpen }) {
  const f = p.fit;
  return (
    <li className="card np-top">
      <div className="top-rank"><b>{rank}</b><Move d={move} /></div>
      <Pic p={p} />
      <div className="top-main">
        <div className="top-title">
          <div>
            <span className="top-brand">{p.brand}</span>
            <h3>{p.name}</h3>
          </div>
          <div className="top-tags">
            <span className={`np-tag ${p.status}`}>{STATUS[p.status]}</span>
            {p.chipset?.family && <span className="np-tag">{FAMILY[p.chipset.family]}</span>}
          </div>
        </div>
        <p className="top-why">
          {f.why.length ? <><b>{f.why.join(' · ')}</b>이 강점이에요. </> : null}
          {f.pulls.length ? <span className="pull">{f.pulls.join(' · ')} 반영. </span> : null}
          {p.summary}
        </p>
        <dl className="specs">
          <div><dt>칩셋</dt><dd>{p.chipset?.name ?? '미정'}{p.chipset?.certainty && p.chipset.certainty !== '확정' ? <i className="np-i">{p.chipset.certainty}</i> : null}</dd></div>
          <div><dt>무게</dt><dd><V e={p.weight_g} unit="g" stack /></dd></div>
          <div><dt>배터리</dt><dd><V e={p.battery_mah} fmt={mah} stack />{p.charge_w?.value ? <small> · {p.charge_w.value}W</small> : null}</dd></div>
          <div><dt>가격</dt><dd><V e={p.price_krw} fmt={won} stack /></dd></div>
          <div><dt>화면</dt><dd><V e={p.screen_in} unit="인치" /></dd></div>
          <div><dt>출시</dt><dd>{p.release}</dd></div>
        </dl>
        {p.opinion && p.opinion.sentiment !== '정보 부족' && (
          <p className="top-op"><em className={SENT[p.opinion.sentiment]}>{p.opinion.sentiment} {p.opinion.score}</em>{p.opinion.summary}</p>
        )}
        <div className="top-actions">
          <label className="np-check"><input type="checkbox" checked={picked} onChange={onPick} /> 비교에 담기</label>
          <button type="button" className={`np-star${watched ? ' on' : ''}`} onClick={onWatch}>{watched ? '★ 관심 폰' : '☆ 관심 폰'}</button>
          <button type="button" className="np-link" onClick={onOpen}>{open ? '접기' : '유출·여론 자세히'}</button>
          <span className="np-meta">조사 {when(p.updated_at)}</span>
        </div>
        {open && <Detail p={p} />}
      </div>
      <div className="top-side">
        <Ring value={f.match} />
        <Radar mini size={104} series={[{ label: p.name, color: COLORS[0], values: f.axes }]} />
      </div>
    </li>
  );
}

export function RowItem({ p, picked, onPick, watched, onWatch }) {
  return (
    <li className="card np-row">
      <input type="checkbox" checked={picked} onChange={onPick} aria-label={`${p.name} 비교`} />
      <Pic p={p} small />
      <div className="row-main">
        <strong>{p.brand} {p.name}</strong> <span className={`np-tag ${p.status}`}>{STATUS[p.status]}</span>
        <p>{p.chipset?.name} · <V e={p.weight_g} unit="g" /> · <V e={p.price_krw} fmt={won} /></p>
      </div>
      <button type="button" className={`np-star${watched ? ' on' : ''}`} onClick={onWatch} aria-label="관심 폰">★</button>
      <div className="row-fit"><b>{p.fit.match}</b>%</div>
    </li>
  );
}

export function Detail({ p }) {
  const pros = p.opinion?.points?.filter((x) => x.stance === 'pro') ?? [];
  const cons = p.opinion?.points?.filter((x) => x.stance === 'con') ?? [];
  return (
    <div className="detail">
      {!!p.changes?.length && (
        <div><h4>최근 바뀐 정보</h4><ul className="d-new">{p.changes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
      )}
      <div className="d-two">
        <div><h4>장점</h4><ul className="d-pos">{[...p.highlights, ...pros.map((x) => `${x.text} (${x.source})`)].map((h, i) => <li key={i}>{h}</li>)}</ul></div>
        <div><h4>아쉬운 점</h4><ul className="d-neg">{[...p.cautions, ...cons.map((x) => `${x.text} (${x.source})`)].map((h, i) => <li key={i}>{h}</li>)}</ul></div>
      </div>
      <div>
        <h4>수치별 근거</h4>
        <ul className="d-basis">
          {[['칩셋', p.chipset?.note], ['무게', p.weight_g?.note], ['배터리', p.battery_mah?.note], ['충전', p.charge_w?.note], ['가격', p.price_krw?.note], ['업데이트', p.update_years?.note]]
            .filter(([, n]) => n).map(([k, n]) => <li key={k}><b>{k}</b> {n}</li>)}
        </ul>
      </div>
      {!!p.leaks?.length && (
        <div>
          <h4>유출·보도 {p.leaks.length}건</h4>
          <ul className="d-leaks">
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
          <ul className="d-src">{p.sources.map((s, i) => <li key={i}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.label}</a> : s.label}</li>)}</ul>
          {p.image?.page && <p className="np-meta">이미지: <a href={p.image.page} target="_blank" rel="noreferrer noopener">Wikipedia</a></p>}
        </div>
      )}
    </div>
  );
}

export function Compare({ compare }) {
  const best = (key) => { const m = Math.max(...compare.map((p) => p.fit.axes[key])); return (p) => compare.length > 1 && p.fit.axes[key] === m; };
  const row = (label, f, hl) => (
    <tr key={label}><th>{label}</th>{compare.map((p) => <td key={p.id} className={hl?.(p) ? 'best' : ''}>{f(p)}</td>)}</tr>
  );
  return (
    <section className="card cmp">
      <h2>비교 <small>{compare.length}/5</small></h2>
      <div className="cmp-top">
        <Radar size={280} series={compare.map((p, i) => ({ label: p.name, color: COLORS[i % COLORS.length], values: p.fit.axes }))} />
        <ul className="np-legend">
          {compare.map((p, i) => <li key={p.id} style={{ '--c': COLORS[i % COLORS.length] }}><b>{p.brand} {p.name}</b><span>{p.fit.match}%</span></li>)}
        </ul>
      </div>
      <div className="cmp-scroll">
        <table className="cmp-table">
          <thead><tr><th />{compare.map((p) => <th key={p.id}><Pic p={p} small />{p.name}<small>{p.brand}</small></th>)}</tr></thead>
          <tbody>
            {row('내 취향 일치', (p) => `${p.fit.match}%`, (p) => compare.length > 1 && p.fit.match === Math.max(...compare.map((x) => x.fit.match)))}
            {row('칩셋', (p) => <>{p.chipset?.name ?? '미정'}{p.chipset?.certainty && p.chipset.certainty !== '확정' ? <i className="np-i">{p.chipset.certainty}</i> : null}</>, best('performance'))}
            {row('무게', (p) => <V e={p.weight_g} unit="g" />, best('lightness'))}
            {row('두께', (p) => <V e={p.thickness_mm} unit="mm" />)}
            {row('화면', (p) => <>{p.display} <V e={p.screen_in} unit="인치" /></>, best('display'))}
            {row('배터리', (p) => <V e={p.battery_mah} fmt={mah} />, best('battery'))}
            {row('충전', (p) => <V e={p.charge_w} unit="W" />, best('charging'))}
            {row('카메라', (p) => p.camera, best('camera'))}
            {row('업데이트', (p) => <V e={p.update_years} unit="년" />, best('software'))}
            {row('가격', (p) => <V e={p.price_krw} fmt={won} />, best('value'))}
            {row('여론', (p) => <>{p.opinion?.sentiment} · {p.opinion?.score}점</>, best('opinion'))}
            {row('출시', (p) => `${STATUS[p.status]} · ${p.release}`)}
            {row('정보 확실성', (p) => ({ high: '높음', medium: '보통', low: '낮음' })[p.confidence])}
            {row('조사 시각', (p) => when(p.updated_at))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function WatchPanel({ phones, series }) {
  return (
    <section className="card watch">
      <h2>관심 폰 · 적합도 변화</h2>
      <p className="np-meta">새 유출이 나오면 매일 자동으로 다시 조사해 반영돼요. 큰 점은 정보가 바뀐 날이에요(올려보면 내용이 보여요).</p>
      <FitChart series={series} />
      <ul className="np-legend">
        {series.map((s, i) => {
          const p = phones[i];
          return (
            <li key={s.id} style={{ '--c': s.color }}>
              <b>{s.name}</b><span>{p.fit.match}%</span>
              <small>조사 {when(p.updated_at)}{p.changes?.length ? ` · ${p.changes[0]}` : ''}{s.points.length < 2 ? ' · 다음 갱신부터 변화가 그려져요' : ''}</small>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
