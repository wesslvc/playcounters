'use client';

import { useEffect, useMemo, useState } from 'react';

const COLORS = ['var(--indigo)', 'var(--pink)', 'var(--teal)', '#F0A202', '#8B5CF6'];
const W = 720;
const H = 200;
const PAD = { l: 4, r: 4, t: 10, b: 20 };

const monthLabel = (m) => {
  const [y, mo] = m.split('-');
  return `${y.slice(2)}.${mo}`;
};

/**
 * How the leaders rose and fell against each other, by month, across the whole
 * history. Drawn as inline SVG rather than pulled from a charting library —
 * one chart doesn't justify the bundle, and this way it inherits the theme
 * tokens directly.
 */
export default function Trend({ mode, source }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const ctl = new AbortController();
    setData(null);
    setError(null);
    fetch(`/api/trend?mode=${mode}&source=${source}&limit=5`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); setData(j); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [mode, source]);

  const chart = useMemo(() => {
    if (!data?.months?.length) return null;
    const months = data.months;
    const x = (i) => PAD.l + (i / Math.max(1, months.length - 1)) * (W - PAD.l - PAD.r);
    const peak = Math.max(
      1,
      ...data.series.flatMap((s) => s.points.map((p) => p.plays))
    );
    const y = (v) => PAD.t + (1 - v / peak) * (H - PAD.t - PAD.b);

    const lines = data.series.map((s) => {
      const byMonth = new Map(s.points.map((p) => [p.month, p.plays]));
      // Months with no plays are real zeros, not gaps to interpolate over.
      const d = months
        .map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(byMonth.get(m) ?? 0).toFixed(1)}`)
        .join(' ');
      return { ...s, d };
    });
    return { months, lines, peak, x, y };
  }, [data]);

  if (error) return <p className="err" style={{ padding: '12px 2px' }}>{error}</p>;
  if (!chart) return <p className="note" style={{ padding: '12px 2px' }}>추이를 불러오는 중…</p>;

  const { months, lines, peak } = chart;
  const ticks = months.length <= 6
    ? months
    : [months[0], months[Math.floor(months.length / 2)], months[months.length - 1]];

  return (
    <div className="trend">
      <div className="legend">
        <span>상위 5개 · 월별 재생</span>
        <span>{monthLabel(months[0])} ~ {monthLabel(months[months.length - 1])} · 최고 {peak}회</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="trend-svg" role="img"
           aria-label={`상위 ${lines.length}개 월별 재생 추이`}>
        {lines.map((s, i) => (
          <path key={i} d={s.d} fill="none" stroke={COLORS[i % COLORS.length]}
                strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
                vectorEffect="non-scaling-stroke" />
        ))}
      </svg>

      <div className="trend-x">
        {ticks.map((m) => <span key={m}>{monthLabel(m)}</span>)}
      </div>

      <ol className="trend-key">
        {lines.map((s, i) => (
          <li key={i}>
            <i style={{ background: COLORS[i % COLORS.length] }} />
            <b>{s.track ?? s.artist}</b>
            {s.track && <span>{s.artist}</span>}
            <em>{s.total.toLocaleString()}회</em>
          </li>
        ))}
      </ol>
    </div>
  );
}
