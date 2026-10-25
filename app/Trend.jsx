'use client';

import { useEffect, useMemo, useState } from 'react';
import { artistColor, familyLabel } from '@/lib/genre';
import { smoothPath, sampleIdx } from '@/lib/curve';

const W = 720;
const H = 200;
const PAD = { l: 4, r: 4, t: 10, b: 20 };

/** "4.19" — one day. */
const bucketLabel = (b) => {
  const [, mo, d] = b.split('-');
  return `${Number(mo)}.${Number(d)}`;
};

/**
 * Where to mark the x axis: the first of each month on a long range (thinned
 * to about six), every few days on a short one. Placed at the day itself,
 * so a label sits exactly over the part of the line it names.
 */
function axisTicks(buckets) {
  const n = buckets.length;
  if (n <= 62) {
    const step = Math.max(1, Math.ceil(n / 6));
    return buckets.map((b, i) => [i, bucketLabel(b)]).filter(([i]) => i % step === 0);
  }
  const firsts = buckets.map((b, i) => [i, b]).filter(([, b]) => b.endsWith('-01'));
  const step = Math.max(1, Math.ceil(firsts.length / 6));
  const multiYear = buckets[0].slice(0, 4) !== buckets[n - 1].slice(0, 4);
  return firsts.filter((_, k) => k % step === 0).map(([i, b]) => {
    const [y, mo] = b.split('-');
    return [i, multiYear ? `${y.slice(2)}.${mo}` : `${Number(mo)}월`];
  });
}

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
  const [hover, setHover] = useState(null);

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
      const cum = buckets.map((b) => (run += byBucket.get(b) ?? 0));
      const d = smoothPath(sampleIdx(cum.length).map((i) => [x(i), y(cum[i])]));
      // Where the line finishes — marked separately below, since color alone
      // (now per artist) is already enough to tell most lines apart, but a
      // close finish is still easier to read off a marker than a hue.
      return { ...s, d, cum, ex: x(buckets.length - 1), ey: y(run) };
    });
    return { buckets, lines, peak, x, y };
  }, [data]);

  if (error) return <p className="err" style={{ padding: '12px 2px' }}>{error}</p>;
  if (!chart) return <p className="note" style={{ padding: '12px 2px' }}>추이를 불러오는 중…</p>;

  const { buckets, lines, peak, x, y } = chart;
  const ticks = axisTicks(buckets);
  const pickDay = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    const i = Math.round(((f * W - PAD.l) / (W - PAD.l - PAD.r)) * (buckets.length - 1));
    setHover(Math.max(0, Math.min(buckets.length - 1, i)));
  };

  // Same key as the list: color by artist, not genre — every artist gets a
  // stable shade of their own, rather than sharing one neighbourhood of hue
  // with everyone else in their genre. Genre still names itself in the
  // legend below, just no longer decides the color.
  const colorOf = (s) => artistColor(s.artist);
  const genreOf = (s) => {
    const fam = genres[s.artist]?.family;
    return fam && fam !== 'other' ? familyLabel(fam) : null;
  };

  return (
    <div className="trend">
      <div className="legend">
        <span>누적 재생</span>
        <span>{buckets[0].replaceAll('-', '.')} – {buckets[buckets.length - 1].replaceAll('-', '.')}</span>
      </div>

      <div className="trend-plot">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="trend-svg" role="img"
           aria-label={`상위 ${lines.length}개 누적 재생 추이`}
           onMouseMove={pickDay} onMouseLeave={() => setHover(null)}
           onTouchStart={(e) => pickDay(e.touches[0] ? { currentTarget: e.currentTarget, clientX: e.touches[0].clientX } : e)}
           onTouchMove={(e) => pickDay({ currentTarget: e.currentTarget, clientX: e.touches[0].clientX })}
           onTouchEnd={() => setHover(null)}>
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b}
                stroke="var(--line)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        )}
        {/* The finish line: every series ends here, at the current total. */}
        <line x1={W - PAD.r} y1={PAD.t} x2={W - PAD.r} y2={H - PAD.b}
              stroke="var(--line)" strokeWidth="1.5" strokeDasharray="2,3" className="trend-finish" />
        {lines.map((s, i) => (
          <path key={i} d={s.d} fill="none" stroke={colorOf(s)}
                strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round"
                vectorEffect="non-scaling-stroke" />
        ))}
        {hover != null && lines.map((s, i) => (
          <rect key={`h${i}`} x={x(hover) - 4} y={y(s.cum[hover]) - 4} width="8" height="8" rx="4"
                fill={colorOf(s)} stroke="var(--paper)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
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
      {hover != null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover / buckets.length < 0.25 ? '0' : hover / buckets.length > 0.75 ? '-100%' : '-50%'})` }}>
          <b>{buckets[hover].replaceAll('-', '.')}</b>
          <ul>
            {lines.map((s, i) => (
              <li key={i}>
                <i style={{ background: colorOf(s) }} />
                <span>{s.track ?? s.artist}</span>
                <em>{Math.round(s.cum[hover]).toLocaleString()}회</em>
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>

      <div className="trend-x">
        {ticks.map(([i, label]) => (
          <span key={i} style={{ left: `${(x(i) / W) * 100}%` }}>{label}</span>
        ))}
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
