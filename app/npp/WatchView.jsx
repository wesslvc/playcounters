import { useState } from 'react';
import { Bar, Pic, Ring, when, day } from './parts';

/**
 * Fit over time for the followed phones: 2px lines, 4px markers ringed in the
 * surface colour, a bigger marker where information changed, hover for the values.
 */
function FitChart({ series }) {
  const [tip, setTip] = useState(null);
  const W = 720; const H = series.every((s) => s.points.length < 2) ? 170 : 260; const L = 40; const R = 16; const T = 14; const B = 30;
  const all = series.flatMap((s) => s.points);
  if (!all.length) return null;
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(Math.max(...all.map((p) => p.t)), t0 + 86400e3);
  const lo = Math.max(0, Math.floor((Math.min(...all.map((p) => p.fit)) - 8) / 10) * 10);
  const hi = Math.min(100, Math.ceil((Math.max(...all.map((p) => p.fit)) + 8) / 10) * 10);
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  return (
    <div className="np-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="내 취향 적합도의 변화" onMouseLeave={() => setTip(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="gl" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="tx">{v}%</text>
          </g>
        ))}
        <text x={L} y={H - 8} className="tx">{day(t0)}</text>
        <text x={W - R} y={H - 8} textAnchor="end" className="tx">{day(t1)}</text>
        {series.map((s) => (
          <g key={s.id} style={{ '--c': s.color }}>
            {s.points.length > 1 && <polyline className="ln" points={s.points.map((p) => `${x(p.t)},${y(p.fit)}`).join(' ')} />}
            {s.points.map((p, i) => (
              <g key={i}>
                <circle cx={x(p.t)} cy={y(p.fit)} r={p.changes?.length ? 6 : 4} className="pt" />
                <circle cx={x(p.t)} cy={y(p.fit)} r="12" className="hit" tabIndex={0}
                  onMouseEnter={() => setTip({ x: x(p.t) / W, y: y(p.fit) / H, name: s.name, p })} onFocus={() => setTip({ x: x(p.t) / W, y: y(p.fit) / H, name: s.name, p })} onBlur={() => setTip(null)} />
              </g>
            ))}
          </g>
        ))}
      </svg>
      {tip && (
        <div className="np-tip" style={{ left: `${tip.x * 100}%`, top: `${tip.y * 100}%` }} role="status">
          <b>{tip.name}</b>
          <span>{day(tip.p.t)} · {tip.p.fit}%</span>
          {tip.p.changes?.slice(0, 2).map((c, i) => <small key={i}>{c}</small>)}
        </div>
      )}
      {series.length > 1 && (
        <ul className="np-legend">{series.map((s) => <li key={s.id} style={{ '--c': s.color }}><b>{s.name}</b></li>)}</ul>
      )}
    </div>
  );
}

export default function WatchView({ phones, series, onOpen }) {
  if (!phones.length) {
    return (
      <section className="np-card np-empty">
        <h2>관심 폰</h2>
        <p>추천 탭의 카드에서 "☆ 관심"을 누르면 여기에 모여요. 관심 폰은 새 유출이 나올 때마다 매일 자동으로 다시 조사되고, 내 취향에 대한 점수가 어떻게 바뀌는지 그래프로 보여줘요.</p>
      </section>
    );
  }
  return (
    <div className="np-watch">
      <section className="np-card">
        <h2>적합도 변화 <small>정보가 바뀐 날은 큰 점이에요 · 점에 올려보면 내용이 보여요</small></h2>
        <FitChart series={series} />
        {series.every((s) => s.points.length < 2) && <p className="np-meta">조사가 두 번 이상 쌓이면 선이 그려져요. 다음 자동 조사부터 변화가 보여요.</p>}
      </section>
      <section className="np-card">
        <h2>새 소식</h2>
        <ul className="np-feed">
          {phones.map((p, i) => (
            <li key={p.id} style={{ '--c': series[i]?.color }}>
              <button type="button" onClick={() => onOpen(p)}><Pic p={p} size="sm" /></button>
              <div>
                <b>{p.brand} {p.name}</b>
                <small>조사 {when(p.updated_at)} · 적합도 {p.fit.match}%</small>
                {p.changes?.length ? <ul>{p.changes.slice(0, 3).map((c, k) => <li key={k}>{c}</li>)}</ul> : <p className="np-meta">아직 새로 바뀐 정보가 없어요.</p>}
                {p.leak_digest?.[0] && <p className="np-feed-leak"><time>{p.leak_digest[0].date ? day(p.leak_digest[0].date) : ''}</time>{p.leak_digest[0].text}</p>}
              </div>
              <Ring value={p.fit.match} size={56} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
