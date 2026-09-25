'use client';

import { useEffect, useMemo, useState } from 'react';
import { genreColor, familyLabel } from '@/lib/genre';

const W = 720;
const H = 200;
const PAD = { l: 4, r: 4, t: 10, b: 20 };

/** "25.04" for a month, "4.19" for a day — the range decides which. */
const bucketLabel = (b) => {
  const [y, mo, d] = b.split('-');
  return d ? `${Number(mo)}.${Number(d)}` : `${y.slice(2)}.${mo}`;
};

/**
 * Running play totals for the leaders, month by month across the whole
 * history — how each one accumulated, and where one overtook another.
 *
 * Cumulative rather than per-month: the question is how a song got to its
 * total, which a bar of monthly counts answers only indirectly. Flat
 * stretches read as time out of rotation.
 *
 * Drawn as inline SVG rather than pulled from a charting library — one chart
 * doesn't justify the bundle, and this way it inherits the theme tokens.
 */
export default function Trend({ mode, source, estimate, from, to, limit = 5, genres = {} }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const ctl = new AbortController();
    setData(null);
    setError(null);
    const qs = new URLSearchParams({ mode, source, limit: String(limit), from, to });
    if (estimate) qs.set('estimate', '1');
    fetch(`/api/trend?${qs}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); setData(j); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [mode, source, estimate, from, to, limit]);

  const chart = useMemo(() => {
    if (!data?.buckets?.length) return null;
    const buckets = data.buckets;
    const x = (i) => PAD.l + (i / Math.max(1, buckets.length - 1)) * (W - PAD.l - PAD.r);
    // Running totals only ever grow, so the tallest line is the biggest total.
    const peak = Math.max(1, ...data.series.map((s) => s.total));
    const y = (v) => PAD.t + (1 - v / peak) * (H - PAD.t - PAD.b);

    const lines = data.series.map((s) => {
      const byBucket = new Map(s.points.map((p) => [p.bucket, p.plays]));
      // Cumulative within the period: a bucket with no plays holds the line
      // flat rather than dropping it, because the total hasn't gone anywhere.
      // Flat stretches are the point — they show when something fell out of
      // rotation.
      let run = 0;
      const d = buckets
        .map((b, i) => {
          run += byBucket.get(b) ?? 0;
          return `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(run).toFixed(1)}`;
        })
        .join(' ');
      // Where the line finishes. Five tracks by the same kind of artist come
      // out five shades of one hue — which is the honest picture — so the
      // lines are told apart by where they cross the line, not by color.
      return { ...s, d, ex: x(buckets.length - 1), ey: y(run) };
    });
    return { buckets, lines, peak };
  }, [data]);

  if (error) return <p className="err" style={{ padding: '12px 2px' }}>{error}</p>;
  if (!chart) return <p className="note" style={{ padding: '12px 2px' }}>추이를 불러오는 중…</p>;

  const { buckets, lines, peak } = chart;
  const ticks = buckets.length <= 6
    ? buckets
    : [buckets[0], buckets[Math.floor(buckets.length / 2)], buckets[buckets.length - 1]];

  // Same key as the list: hue by genre family, shade by artist. A chart of five
  // K-pop tracks comes out five pinks, which is the honest picture of what the
  // period held.
  const colorOf = (s) => genreColor(genres[s.artist]?.family ?? 'other', s.artist);
  const genreOf = (s) => {
    const fam = genres[s.artist]?.family;
    return fam && fam !== 'other' ? familyLabel(fam) : null;
  };

  return (
    <div className="trend">
      <div className="legend">
        <span>상위 {lines.length}개 · 기간 내 누적 재생</span>
        <span>
          {bucketLabel(buckets[0])} ~ {bucketLabel(buckets[buckets.length - 1])}
          {' · '}최대 {peak.toLocaleString()}회
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="trend-svg" role="img"
           aria-label={`상위 ${lines.length}개 누적 재생 추이`}>
        {/* The finish line: every series ends here, at the current total. */}
        <line x1={W - PAD.r} y1={PAD.t} x2={W - PAD.r} y2={H - PAD.b}
              stroke="var(--line)" strokeWidth="1.5" strokeDasharray="2,3" className="trend-finish" />
        {lines.map((s, i) => (
          <path key={i} d={s.d} fill="none" stroke={colorOf(s)}
                strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
                vectorEffect="non-scaling-stroke" />
        ))}
        {/* The finishing order, marked where each line ends. The legend below
            is in the same order, which is what ties a line to a name. Drawn as
            a rounded rect rather than a circle: the viewBox is stretched to the
            container (preserveAspectRatio="none"), which would squash a circle
            into an ellipse at phone width. */}
        {lines.map((s, i) => (
          <rect key={`p${i}`} x={s.ex - 7} y={s.ey - 3.5} width="14" height="7" rx="3.5"
                fill={colorOf(s)} stroke="var(--paper)" strokeWidth="1.5"
                vectorEffect="non-scaling-stroke" />
        ))}
      </svg>

      <div className="trend-x">
        {ticks.map((b) => <span key={b}>{bucketLabel(b)}</span>)}
      </div>

      <ol className="trend-key">
        {lines.map((s, i) => (
          <li key={i}>
            <i style={{ background: colorOf(s) }} />
            <b>{s.track ?? s.artist}</b>
            <span>
              {s.track ? s.artist : ''}
              {genreOf(s) && <em className="rowgenre">{genreOf(s)}</em>}
            </span>
            <em>{estimate && s.yt ? '≈' : ''}{s.total.toLocaleString()}회</em>
          </li>
        ))}
      </ol>
    </div>
  );
}
