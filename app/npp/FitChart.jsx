/**
 * Fit over time for the followed phones. `series`: [{ id, name, color, points: [{ t, fit, changes }] }].
 * Each point is one research run, scored with the reader's current weights.
 */
export default function FitChart({ series }) {
  const W = 640; const H = 230; const L = 36; const Rr = 12; const T = 12; const B = 28;
  const all = series.flatMap((s) => s.points);
  if (!all.length) return null;
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(Math.max(...all.map((p) => p.t)), t0 + 86400e3);
  const lo = Math.max(0, Math.floor((Math.min(...all.map((p) => p.fit)) - 8) / 10) * 10);
  const hi = Math.min(100, Math.ceil((Math.max(...all.map((p) => p.fit)) + 8) / 10) * 10);
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - Rr);
  const y = (v) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const date = (t) => new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
  return (
    <svg className="np-fit" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="적합도 변화 그래프">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - Rr} y1={y(v)} y2={y(v)} className="np-grid" />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" className="np-rlabel">{v}%</text>
        </g>
      ))}
      <text x={L} y={H - 8} className="np-rlabel">{date(t0)}</text>
      <text x={W - Rr} y={H - 8} textAnchor="end" className="np-rlabel">{date(t1)}</text>
      {series.map((s) => (
        <g key={s.id} style={{ '--c': s.color }}>
          {s.points.length > 1 && <polyline className="np-line" points={s.points.map((p) => `${x(p.t)},${y(p.fit)}`).join(' ')} />}
          {s.points.map((p, i) => (
            <circle key={i} cx={x(p.t)} cy={y(p.fit)} r={p.changes?.length ? 5 : 3.5} className={`np-dot${p.changes?.length ? ' changed' : ''}`}>
              <title>{`${s.name} · ${date(p.t)} · ${p.fit}%${p.changes?.length ? `\n${p.changes.join('\n')}` : ''}`}</title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
  );
}
