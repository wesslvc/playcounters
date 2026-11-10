'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { artistColor, familyLabel } from '@/lib/genre';
import { smoothPath, sampleIdx } from '@/lib/curve';
import { Seg, Delta, useFlip } from './ui';

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
  // 누적: running totals; 순위: where each stood among these on each day
  const [view, setView] = useState('cum');
  const keyList = useRef(null);

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

    // each line's real place on each day, among everything played, from the
    // server; without it, the order among just these lines
    const ranks = lines.map((l) => (l.ranks && l.ranks.length === buckets.length ? l.ranks : null));
    if (ranks.some((r) => !r)) {
      lines.forEach((_, k) => { ranks[k] = new Array(buckets.length).fill(null); });
      for (let b = 0; b < buckets.length; b++) {
        lines.map((l, k) => [k, l.cum[b]]).filter(([, v]) => v > 0)
          .sort((p, q) => q[1] - p[1] || p[0] - q[0])
          .forEach(([k], r) => { ranks[k][b] = r + 1; });
      }
    }
    // the worst place drawn sets the scale; on a log axis, so 3rd and 300th both read
    const worst = Math.max(2, ...ranks.flat().filter((r) => r != null));
    const ry = (r) => PAD.t + (Math.log(r) / Math.log(worst)) * (H - PAD.t - PAD.b);
    const rankTicks = [1, 3, 10, 30, 100, 300, 1000, 3000].filter((t) => t < worst);
    rankTicks.push(worst);
    // read off about sixty times across the window (and on the last day),
    // joined straight, so a week of swapping places doesn't turn into a wall
    const every = Math.max(1, Math.round(buckets.length / 60));
    const at = buckets.map((_, b) => b).filter((b) => b % every === 0 || b === buckets.length - 1);
    const rankLines = lines.map((l, k) => {
      const rk = ranks[k];
      const pts = at.filter((b) => rk[b] != null).map((b) => `${x(b).toFixed(1)},${ry(rk[b]).toFixed(1)}`);
      const last = rk[buckets.length - 1];
      return { d: pts.length ? `M${pts.join(' L')}` : '', ey: last != null ? ry(last) : null };
    });
    return { buckets, lines, peak, x, y, ry, ranks, rankLines, rankTicks };
  }, [data]);

  // the list's songs slide to their places as the picked day moves
  useFlip(keyList, `${hover}|${view}`);
  if (error) return <p className="err" style={{ padding: '12px 2px' }}>{error}</p>;
  if (!chart) return <p className="note" style={{ padding: '12px 2px' }}>추이를 불러오는 중…</p>;

  const { buckets, lines, peak, x, y, ry, ranks, rankLines, rankTicks } = chart;
  const ranked = view === 'rank';
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
  const lead = lines[0];
  const genreOf = (s) => {
    const fam = genres[s.artist]?.family;
    return fam && fam !== 'other' ? familyLabel(fam) : null;
  };

  return (
    <div className="trend">
      <div className="trend-head">
        <Seg size="sm" label="그래프" options={[['cum', '누적'], ['rank', '순위']]} value={view} onChange={setView} />
      </div>
      <div className="legend">
        <span>{ranked ? '전체 곡 중 순위' : '누적 재생'}</span>
        <span>{buckets[0].replaceAll('-', '.')} – {buckets[buckets.length - 1].replaceAll('-', '.')}</span>
      </div>

      <div className="trend-plot">
        {ranked && (
          <div className="trend-yaxis" aria-hidden="true">
            {rankTicks.map((t) => <span key={t} style={{ top: `${(ry(t) / H) * 100}%` }}>{t.toLocaleString()}위</span>)}
          </div>
        )}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="trend-svg" role="img"
           aria-label={`상위 ${lines.length}개 누적 재생 추이`}
           onMouseMove={pickDay} onMouseLeave={() => setHover(null)}
           onTouchStart={(e) => pickDay(e.touches[0] ? { currentTarget: e.currentTarget, clientX: e.touches[0].clientX } : e)}
           onTouchMove={(e) => pickDay({ currentTarget: e.currentTarget, clientX: e.touches[0].clientX })}>
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b}
                stroke="var(--line)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        )}
        {/* The finish line: every series ends here, at the current total. */}
        <line x1={W - PAD.r} y1={PAD.t} x2={W - PAD.r} y2={H - PAD.b}
              stroke="var(--line)" strokeWidth="1.5" strokeDasharray="2,3" className="trend-finish" />
        {lead && !ranked && (
          <>
            <defs>
              <linearGradient id="trend-lead" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={colorOf(lead)} stopOpacity=".28" />
                <stop offset="1" stopColor={colorOf(lead)} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${lead.d} L ${W - PAD.r} ${H - PAD.b} L ${PAD.l} ${H - PAD.b} Z`} fill="url(#trend-lead)" />
          </>
        )}
        {[...lines].reverse().map((s, i) => (
          <path key={i} d={ranked ? rankLines[lines.indexOf(s)].d : s.d} fill="none" stroke={colorOf(s)}
                strokeWidth={s === lead ? 3.5 : 2.5} strokeLinejoin="round" strokeLinecap="round"
                vectorEffect="non-scaling-stroke" />
        ))}
        {hover != null && lines.map((s, i) => (
          (ranked ? chart.ranks[i][hover] == null : false) ? null : <rect key={`h${i}`} x={x(hover) - 4} y={(ranked ? ry(chart.ranks[i][hover]) : y(s.cum[hover])) - 4} width="8" height="8" rx="4"
                fill={colorOf(s)} stroke="var(--paper)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        ))}
        {/* The finishing order, marked where each line ends. The legend below
            is in the same order, which is what ties a line to a name. Drawn as
            a rounded rect rather than a circle: the viewBox is stretched to the
            container (preserveAspectRatio="none"), which would squash a circle
            into an ellipse at phone width. */}
        {lines.map((s, i) => ((ranked ? rankLines[i].ey : s.ey) == null ? null : (
          <rect key={`p${i}`} x={s.ex - 7} y={(ranked ? rankLines[i].ey : s.ey) - 3.5} width="14" height="7" rx="3.5"
                fill={colorOf(s)} stroke="var(--paper)" strokeWidth="1.5"
                vectorEffect="non-scaling-stroke" />
        )))}
      </svg>
      </div>

      <div className="trend-x">
        {ticks.map(([i, label]) => (
          <span key={i} style={{ left: `${(x(i) / W) * 100}%` }}>{label}</span>
        ))}
      </div>

      {/* the day under the finger (or the last day), read out in the list below
          rather than over the lines: each one's place among these and how it
          moved over the week before */}
      <p className="trend-day" aria-live="polite">
        {hover != null ? <><b>{buckets[hover].replaceAll('-', '.')}</b> 기준 누적 · 전체 곡 중 순위 · 7일 전 대비</> : <>지금 전체 순위 · 7일 전 대비 · 그래프를 누르면 그날 기준으로 바뀌어요</>}
      </p>
      <ol className="trend-key" ref={keyList}>
        {(() => {
          // the songs themselves move: listed in the order they stood that day
          const day = hover ?? buckets.length - 1;
          return lines.map((s, i) => i)
            .sort((p, q) => (ranks[p][day] ?? 99) - (ranks[q][day] ?? 99) || p - q)
            .map((i) => [lines[i], i, day]);
        })().map(([s, i, day]) => {
          const then = Math.max(0, day - 7);
          const now = ranks[i][day];
          const before = ranks[i][then];
          // ▲ climbed, ▼ fell, NEW when it hadn't been played a week before
          const move = now == null ? null : before == null ? (day > 0 ? undefined : null) : before - now;
          return (
          <li key={i} data-k={i} data-zero={(hover != null && !s.cum[hover]) || undefined}>
            <u>{now ?? '–'}</u>
            <span className="trend-move"><Delta value={move} /></span>
            <i style={{ background: colorOf(s) }} />
            <span className="trend-nm">
              <b>{s.track ?? s.artist}</b>
              <small>{[s.track ? s.artist : null, genreOf(s)].filter(Boolean).join(' · ')}</small>
            </span>
            <em>{estimate && s.yt ? '≈' : ''}{(hover != null ? Math.round(s.cum[hover]) : s.total).toLocaleString()}<small>회</small></em>
          </li>
          );
        })}
      </ol>
    </div>
  );
}
