'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { awardsFor, gpRecords, formatValue } from '@/lib/awards';
import { smoothPath } from '@/lib/curve';
import { artistColor } from '@/lib/genre';
import { artistLine } from './useCredits';
import { useCovers, coverOf } from './useCovers';
import { loadCareer, loadRecords } from './data';
import { Cover, Count, Delta, Seg, Stat, dayLabel } from './ui';

const DAY = 864e5;

/**
 * Daily plays as a column chart. Every day between first and last gets a
 * slot so the gaps show; a long history shares columns, each taking its
 * busiest day so the tallest bar agrees with the caption.
 */
function DailyChart({ daily }) {
  if (!daily.length) return null;
  const t0 = new Date(daily[0].day + 'T00:00:00Z').getTime();
  const t1 = new Date(daily[daily.length - 1].day + 'T00:00:00Z').getTime();
  const span = Math.max(1, Math.round((t1 - t0) / DAY));
  const cells = Math.min(120, span + 1);
  const buckets = new Array(cells).fill(0);
  for (const d of daily) {
    const t = new Date(d.day + 'T00:00:00Z').getTime();
    const i = span === 0 ? 0 : Math.round(((t - t0) / (span * DAY)) * (cells - 1));
    buckets[i] = Math.max(buckets[i], Number(d.plays));
  }
  const peak = Math.max(...buckets, 1);
  return (
    <div className="daychart" role="img" aria-label="하루 재생 횟수">
      {buckets.map((v, i) => (
        <i key={i} style={{ height: v ? `${Math.max(6, (v / peak) * 100)}%` : '1px' }} data-on={v > 0} />
      ))}
    </div>
  );
}

const SCOPES = [['year', '연'], ['month', '월'], ['all', '통산']];

/** The sheet's sections, one at a time rather than one long scroll. */
const TABS = [['overview', '개요'], ['ranks', '순위'], ['awards', '기록'], ['career', '챔피언십'], ['versus', '맞대결']];

const periodLabel = (scope, d) => {
  const [y, m] = String(d).split('-');
  if (scope === 'year') return `${y}년`;
  return `${y}.${m}${scope === 'all' ? ' 말' : ''}`;
};

/**
 * Rank over time, best at the top, drawn quietly: a smooth line with a soft
 * fill beneath it, the axis on a log scale so 3,000th and 3rd share one chart
 * (ticks at 1, 10, 100… name it), periods placed by date. Stretches with no
 * listening stay joined but go dashed. The best period is the one gold dot;
 * hover or tap a period for its figures. The heading above already names the
 * best rank, so nothing on the plot repeats it.
 */
function RankChart({ list, scope }) {
  const [hover, setHover] = useState(null);
  const gid = useId();
  // Drawn at the width it's shown at, so the axis text stays its real size
  // rather than scaling up with a wide sheet.
  const box = useRef(null);
  const [W, setW] = useState(340);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (list.length < 2) return null;
  // tall in proportion to its width; only the text keeps a fixed size
  const H = Math.round(Math.min(320, Math.max(190, W * 0.5))), L = 30, R = 8, T = 10, B = 20;
  const base = H - B;
  const worst = Math.max(...list.map((r) => r.rank));
  const top = 10 ** Math.max(1, Math.ceil(Math.log10(worst + 1)));
  const y = (rank) => T + (Math.log(rank) / Math.log(top)) * (base - T);
  // placed by date, so a gap of months reads as a gap
  const mon = (d) => { const [yy, mm] = String(d).split('-'); return Number(yy) * 12 + Number(mm) - 1; };
  const m0 = mon(list[0].period);
  const span = Math.max(1, mon(list[list.length - 1].period) - m0);
  const xm = (m) => L + ((m - m0) / span) * (W - L - R);
  const x = (i) => xm(mon(list[i].period));
  const ticks = [1, 10, 100, 1000, 10000].filter((t) => t <= top);
  const gapOf = (i) => mon(list[i].period) - mon(list[i - 1].period) > (scope === 'year' ? 12 : 1);
  const runs = [];
  list.forEach((r, i) => {
    const pt = [x(i), y(r.rank)];
    if (i === 0 || gapOf(i)) runs.push([pt]);
    else runs[runs.length - 1].push(pt);
  });
  const gaps = list.map((_, i) => i).filter((i) => i > 0 && gapOf(i));
  const bi = list.reduce((m, r, i) => (r.rank < list[m].rank ? i : m), 0);
  const li = list.length - 1;
  const iso = (m) => `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}-01`;
  const labels = scope === 'year'
    ? list.map((r) => mon(r.period))
    : [m0, m0 + Math.round(span / 2), m0 + span];
  // each period's hover target reaches halfway to its neighbours
  const edge = (i) => (i <= 0 ? L - 6 : i > li ? W - R + 6 : (x(i - 1) + x(i)) / 2);
  const h = hover != null ? list[hover] : null;
  const f = (v) => v.toFixed(1);

  return (
    <div className="rankchart" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="순위 추이" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="rc-fill-a" />
            <stop offset="1" className="rc-fill-b" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className="rc-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text className="rc-tick" x={L - 8} y={y(t) + 3.5} textAnchor="end">{t.toLocaleString()}</text>
          </g>
        ))}
        {labels.map((m, k) => (
          <text key={m} className="rc-tick" x={xm(m)} y={H - 5}
                textAnchor={k === 0 ? 'start' : k === labels.length - 1 ? 'end' : 'middle'}>
            {periodLabel(scope, iso(m)).replace(' 말', '')}
          </text>
        ))}
        {runs.map((r, k) => (r.length > 1 ? (
          <path key={`a${k}`} fill={`url(#${gid})`}
                d={`${smoothPath(r)} L${f(r[r.length - 1][0])},${base} L${f(r[0][0])},${base} Z`} />
        ) : null))}
        {gaps.map((i) => (
          <line key={`g${i}`} className="rc-line gap" x1={x(i - 1)} y1={y(list[i - 1].rank)} x2={x(i)} y2={y(list[i].rank)} />
        ))}
        {runs.map((r, k) => (r.length > 1 ? <path key={k} className="rc-line" d={smoothPath(r)} /> : null))}
        {h && <line className="rc-cross" x1={x(hover)} x2={x(hover)} y1={T} y2={base} />}
        {list.map((r, i) => ((i === bi || i === li || i === hover || runs.some((run) => run.length === 1 && run[0][0] === x(i))) && (
          <circle key={i} className={i === bi ? 'rc-dot best' : 'rc-dot'} cx={x(i)} cy={y(r.rank)} r={i === hover ? 4.5 : 3.5} />
        )))}
        {list.map((_, i) => (
          <rect key={i} className="rc-hit" x={edge(i)} y={0} width={edge(i + 1) - edge(i)} height={H}
                onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
      </svg>
      {gaps.length > 0 && <p className="rc-note"><i aria-hidden="true" />안 들은 기간</p>}
      {h && (
        <div className="rc-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{periodLabel(scope, h.period)}</b>
          <span>{h.rank.toLocaleString()}위 · {h.plays.toLocaleString()}회</span>
        </div>
      )}
    </div>
  );
}

/**
 * Where what's open stood, period by period — by year, by month, or all-time
 * at each month's end — ranked the way the list ranks by plays, with the
 * move from the period before.
 */
function RankHistory({ target, source, estimate }) {
  const [scope, setScope] = useState('year');
  const [data, setData] = useState(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (!target?.artist_key) return;
    const ctl = new AbortController();
    setData(null);
    const qs = new URLSearchParams({ artist_key: target.artist_key, source });
    if (target.track_key) qs.set('track_key', target.track_key);
    if (estimate) qs.set('estimate', '1');
    fetch(`/api/item/ranks?${qs}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); setData(j); })
      .catch((e) => { if (e.name !== 'AbortError') setData({ error: e.message }); });
    return () => ctl.abort();
  }, [target, source, estimate]);

  useEffect(() => { setAll(false); }, [scope, target]);

  if (!target?.artist_key) return null;
  const list = data?.[scope] ?? [];
  const best = list.length ? list.reduce((a, b) => (b.rank < a.rank ? b : a)) : null;
  const rows = list.map((r, i) => ({ ...r, delta: i ? list[i - 1].rank - r.rank : undefined })).reverse();
  const shown = all ? rows : rows.slice(0, 12);

  return (
    <div className="sheet-sec">
      <h3>순위 변화{best && <span>최고 {best.rank.toLocaleString()}위 · {periodLabel(scope, best.period)}</span>}</h3>
      <Seg options={SCOPES} value={scope} onChange={setScope} size="sm" label="기간" />
      {!data && <div className="skeleton"><i /></div>}
      {data?.error && <p className="err">{data.error}</p>}
      {data && !data.error && (
        <>
          <RankChart list={list} scope={scope} />
          <ol className="results rankhist">
            {shown.map((r) => (
              <li key={r.period}>
                <span className="res-mo">{periodLabel(scope, r.period)}</span>
                <span className="res-rk" data-tier={r.rank <= 3 ? r.rank : undefined}>{r.rank.toLocaleString()}위</span>
                <span className="res-of">/ {r.items.toLocaleString()}</span>
                <span className="res-pt">{r.plays.toLocaleString()}회</span>
                <Delta value={r.delta} />
              </li>
            ))}
          </ol>
          {rows.length > shown.length && (
            <button className="linkish" onClick={() => setAll(true)}>{rows.length - shown.length}개 더 보기</button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The championship career of what's open: a song's results as a driver, an
 * artist's as a constructor (their songs' points, shared between everyone
 * credited). Read from the all-time championship, shared with the records.
 */
function Career({ target, career }) {
  const rec = useMemo(() => {
    if (!career?.months) return null;
    const isTrack = Boolean(target.track);
    const list = isTrack ? career.drivers : career.constructors;
    const idx = (list ?? []).findIndex((r) => (isTrack
      ? r.artist_key === target.artist_key && r.track_key === target.track_key
      : r.artist_key === target.artist_key));
    const results = [];
    for (const m of career.months) {
      if (m.live) continue;
      for (const t of m.top) {
        const hit = isTrack
          ? t.artist_key === target.artist_key && t.track_key === target.track_key
          : (t.credits ?? [{ key: t.artist_key }]).some((c) => c.key === target.artist_key);
        if (hit) results.push({ year: m.year, month: m.month, rank: t.rank, points: t.points, track: t.track });
      }
    }
    return { row: idx >= 0 ? list[idx] : null, pos: idx + 1, results: results.reverse() };
  }, [career, target]);

  if (!career) return <p className="note">불러오는 중…</p>;
  if (!rec?.row) return <p className="note">그랑프리 TOP 10 기록 없음</p>;
  const { row, pos, results } = rec;
  const best = Math.min(...results.map((r) => r.rank));
  return (
    <>
      <div className="stats compact">
        <Stat value={`${pos}위`} label={target.track ? '통산 드라이버' : '통산 컨스트럭터'} />
        <Stat value={row.points.toLocaleString()} label="포인트" />
        <Stat value={row.wins} label="우승" />
        <Stat value={row.podiums} label="포디움" />
        <Stat value={`P${best}`} label="최고 성적" />
      </div>
      <ol className="results">
        {results.slice(0, 24).map((r, i) => (
          <li key={i}>
            <span className="res-mo">{r.year}.{String(r.month).padStart(2, '0')}</span>
            <span className="res-rk" data-tier={r.rank <= 3 ? r.rank : undefined}>P{r.rank}</span>
            {!target.track && <span className="res-nm">{r.track}</span>}
            <span className="res-pt">{r.points}pt</span>
          </li>
        ))}
      </ol>
    </>
  );
}

/** One side's championship record: wins, podiums, points, best finish, and its place each month. */
function gpOf(career, t) {
  const out = { wins: 0, podiums: 0, points: 0, best: null, at: new Map() };
  for (const m of career?.months ?? []) {
    if (m.live) continue;
    for (const r of m.top) {
      const hit = t.track
        ? r.artist_key === t.artist_key && r.track_key === t.track_key
        : (r.credits ?? [{ key: r.artist_key }]).some((c) => c.key === t.artist_key);
      if (!hit) continue;
      const k = `${m.year}-${m.month}`;
      if (out.at.has(k) && out.at.get(k) <= r.rank) continue;
      out.at.set(k, r.rank);
      if (r.rank === 1) out.wins += 1;
      if (r.rank <= 3) out.podiums += 1;
      out.points += r.points;
      out.best = out.best == null ? r.rank : Math.min(out.best, r.rank);
    }
  }
  return out;
}

/**
 * Two songs (or two artists) side by side: pick the other one from your own
 * plays, then read the totals, the championship records, the months they met
 * in the top ten and who finished ahead, and their running totals as two lines.
 */
/**
 * A song's bare title: what's left once the brackets, the " - " or " | "
 * tails and the 8D / sped-up / remix tags are cut, so its re-uploads and
 * edits land on one name.
 */
export function baseTitle(track) {
  return String(track ?? '').toLowerCase()
    .split(/\s[-|–]\s|\s?[([（【|]/)[0]
    .replace(/\b(in\s)?8d(\saudio)?\b|\b(sped up|slowed|remix|ver\.?|version|edit|live|audio)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

/** Same-titled rows as one, under the most played of them. */
function foldTitles(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.track ? `t|${baseTitle(r.track) || r.track_key}` : `a|${r.artist_key}`;
    const g = by.get(k);
    // first place in the list stays (the search's own order); the most played version stands in it
    if (!g) by.set(k, { ...r, fold: k, versions: 1 });
    else if ((r.plays ?? 0) > (g.plays ?? 0)) Object.assign(g, r, { versions: g.versions + 1 });
    else g.versions += 1;
  }
  return [...by.values()];
}

function Versus({ target, source, estimate, career, mine }) {
  const isTrack = Boolean(target.track);
  const mode = isTrack ? 'tracks' : 'artists';
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [other, setOther] = useState(null);
  const [theirs, setTheirs] = useState(null);
  const cache = useRef(new Map());
  useEffect(() => { setOther(null); setTheirs(null); setQ(''); }, [target]);
  // as you type, from your own plays; before typing, what you play most
  useEffect(() => {
    const term = q.trim();
    const key = `${mode}|${term}`;
    const keep = (rows) => {
      const mineK = isTrack ? `t|${baseTitle(target.track) || target.track_key}` : `a|${target.artist_key}`;
      const out = foldTitles(rows).filter((r) => r.fold !== mineK && r.track_key !== target.track_key);
      setHits(out);
    };
    if (cache.current.has(key)) { keep(cache.current.get(key)); return undefined; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ q: term, limit: '20' });
      if (!isTrack) qs.set('mode', 'artists');
      fetch(`/api/recommend/search?${qs}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((j) => { const rows = j.items ?? []; cache.current.set(key, rows); keep(rows); })
        .catch(() => {});
    }, term ? 90 : 0);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, isTrack, mode, target]);
  useEffect(() => {
    if (!other) return undefined;
    const ctl = new AbortController();
    setTheirs(null);
    const qs = new URLSearchParams({ artist: other.artist, source });
    if (other.track) qs.set('track', other.track);
    if (other.artist_key) qs.set('artist_key', other.artist_key);
    if (other.track_key) qs.set('track_key', other.track_key);
    if (estimate) qs.set('estimate', '1');
    fetch(`/api/item?${qs}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => { if (!j.error) setTheirs(j); }).catch(() => {});
    return () => ctl.abort();
  }, [other, source, estimate]);
  const shown = (hits ?? []).slice(0, 10);
  const covers = useCovers(mode, useMemo(() => [target, ...(other ? [other] : []), ...(hits ?? []).slice(0, 10)], [target, other, hits]));

  const name = (t) => t.track ?? t.artist;
  if (!other) {
    return (
      <div className="vs-pick">
        <div className="vs-pick-me">
          <Cover src={coverOf(covers, mode, target)} size={44} round={!isTrack} />
          <span><small>도전자를 고르세요</small><b>{name(target)}</b></span>
          <i>VS</i>
        </div>
        <input className="vs-input" value={q} autoFocus enterKeyHint="go"
               onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) setOther(shown[0]); }}
               placeholder={isTrack ? '곡이나 가수 이름 일부' : '가수 이름 일부'} aria-label="상대 찾기" />
        <p className="vs-pick-k">{q.trim() ? '들었던 것 중에서' : isTrack ? '많이 들은 곡' : '많이 들은 가수'}</p>
        {hits && !shown.length ? <p className="note">맞는 {isTrack ? '곡' : '가수'}이 없어요</p> : (
          <ul className="vs-hits">
            {shown.map((h) => (
              <li key={`${h.artist_key}|${h.track_key}`}>
                <button onClick={() => setOther(h)}>
                  <Cover src={coverOf(covers, mode, h)} size={40} round={!isTrack} />
                  <span className="nm"><b>{name(h)}</b>{h.track && <span>{h.artist}{h.versions > 1 ? ` · 같은 제목 ${h.versions - 1}개 묶음` : ''}</span>}</span>
                  {h.plays != null && <em>{h.plays.toLocaleString()}회</em>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const a = mine?.summary;
  const b = theirs?.summary;
  const ga = gpOf(career, target);
  const gb = gpOf(career, other);
  // the months both made the top ten, and who finished ahead
  const met = [...ga.at].filter(([k]) => gb.at.has(k)).map(([k, ra]) => ({ k, ra, rb: gb.at.get(k) }));
  const aheadA = met.filter((x) => x.ra < x.rb).length;
  const aheadB = met.filter((x) => x.rb < x.ra).length;
  const ca = artistColor(target.artist);
  let cb = artistColor(other.artist);
  if (cb === ca) cb = 'var(--ink-2)';
  const rows = [
    ['재생', a?.plays, b?.plays],
    ['들은 날', a?.days, b?.days],
    ['GP 우승', ga.wins, gb.wins],
    ['포디움', ga.podiums, gb.podiums],
    ['GP 포인트', ga.points, gb.points],
    ['최고 순위', ga.best ? -ga.best : null, gb.best ? -gb.best : null, (v) => (v == null ? '–' : `P${-v}`)],
    ['맞붙은 달 앞선 횟수', aheadA, aheadB],
  ];

  // running totals, day by day, over the span both cover
  const cum = (daily) => {
    let run = 0;
    return (daily ?? []).map((d) => [Date.parse(d.day), (run += Number(d.plays))]);
  };
  const la = cum(mine?.daily);
  const lb = cum(theirs?.daily);
  const t0 = Math.min(la[0]?.[0] ?? Infinity, lb[0]?.[0] ?? Infinity);
  const t1 = Math.max(la.at(-1)?.[0] ?? 0, lb.at(-1)?.[0] ?? 0, Date.now());
  const top = Math.max(1, la.at(-1)?.[1] ?? 0, lb.at(-1)?.[1] ?? 0);
  const W = 600, H = 180;
  const path = (pts) => (pts.length ? `M0,${H} ` + pts.map(([t, v]) => `L${(((t - t0) / Math.max(1, t1 - t0)) * W).toFixed(1)},${(H - (v / top) * (H - 8)).toFixed(1)}`).join(' ') + ` L${W},${(H - ((pts.at(-1)[1]) / top) * (H - 8)).toFixed(1)}` : '');

  // a round to whoever leads each line, ties to no one
  const fmt = (v) => (v == null ? '–' : Number(v).toLocaleString());
  const judged = rows.map(([label, va, vb, f = fmt]) => ({
    label, va, vb, f, win: va != null && vb != null && va !== vb ? (va > vb ? 'a' : 'b') : null,
  }));
  const sa = judged.filter((r) => r.win === 'a').length;
  const sb = judged.filter((r) => r.win === 'b').length;
  const lead = !theirs ? null : sa > sb ? 'a' : sb > sa ? 'b' : null;
  const picA = coverOf(covers, mode, target);
  const picB = coverOf(covers, mode, other);
  const side = (t, pic, score, me) => (
    <div className="vs-side" data-lead={lead === me || undefined}>
      <Cover src={pic} size={76} round={!isTrack} />
      <b>{name(t)}</b>
      {t.track && <small>{artistLine(t)}</small>}
      <strong>{theirs ? score : '–'}</strong>
    </div>
  );

  return (
    <div className="vs">
      <div className="vs-card">
        {picA && <span className="vs-bg a" aria-hidden="true" style={{ backgroundImage: `url(${picA})` }} />}
        {picB && <span className="vs-bg b" aria-hidden="true" style={{ backgroundImage: `url(${picB})` }} />}
        {side(target, picA, sa, 'a')}
        <div className="vs-mid"><i>VS</i></div>
        {side(other, picB, sb, 'b')}
      </div>
      <div className="vs-verdict">
        <span>{!theirs ? '불러오는 중…' : lead ? <><b>{name(lead === 'a' ? target : other)}</b><em>{`우세 ${Math.max(sa, sb)}:${Math.min(sa, sb)}`}</em></> : <em>{`${sa}:${sb} 팽팽해요`}</em>}</span>
        <button className="linkish" onClick={() => setOther(null)}>상대 바꾸기</button>
      </div>
      <ul className="vs-rows">
        {judged.map(({ label, va, vb, f, win }) => {
          const total = Math.abs(va ?? 0) + Math.abs(vb ?? 0);
          const share = label === '최고 순위' || !total ? 50 : (Math.abs(va ?? 0) / total) * 100;
          return (
            <li key={label}>
              <b data-win={win === 'a' || undefined} style={{ '--c': ca }}>{f(va)}</b>
              <span>
                <small>{label}</small>
                <i className="vs-bar"><i style={{ width: `${share}%`, background: ca }} /><i style={{ width: `${100 - share}%`, background: cb }} /></i>
              </span>
              <b data-win={win === 'b' || undefined} style={{ '--c': cb }}>{f(vb)}</b>
            </li>
          );
        })}
      </ul>
      {met.length > 0 && <p className="note">TOP 10에서 {met.length}번 만나 {aheadA}번 앞서고 {aheadB}번 뒤졌어요</p>}
      {theirs ? (
        <svg className="vs-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="누적 재생 비교">
          <path d={path(lb)} fill="none" stroke={cb} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          <path d={path(la)} fill="none" stroke={ca} strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : <div className="skeleton"><i /></div>}
    </div>
  );
}

/**
 * Everything about one song or artist, from any tab: its counts across all
 * of history, its listening by day, its championship career, and every
 * record it holds or is chasing.
 */
export default function Detail({ target, source, estimate, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [career, setCareer] = useState(null);
  const [records, setRecords] = useState(null);
  const [tab, setTab] = useState('overview');

  useEffect(() => { setTab('overview'); }, [target]);

  useEffect(() => {
    if (!target) return;
    const ctl = new AbortController();
    setData(null);
    setError(null);
    const qs = new URLSearchParams({ artist: target.artist, source });
    if (target.track) qs.set('track', target.track);
    if (target.artist_key) qs.set('artist_key', target.artist_key);
    if (target.track_key) qs.set('track_key', target.track_key);
    if (estimate) qs.set('estimate', '1');
    fetch(`/api/item?${qs}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); setData(j); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [target, source, estimate]);

  // Fetched once per visit and shared with the records tab.
  useEffect(() => {
    if (!target) return;
    let live = true;
    loadCareer(source, estimate).then((j) => live && setCareer(j)).catch(() => live && setCareer({}));
    loadRecords(source, estimate).then((j) => live && setRecords(j.records)).catch(() => {});
    return () => { live = false; };
  }, [target, source, estimate]);

  useEffect(() => {
    if (!target) return;
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [target, onClose]);

  const mode = target?.track ? 'tracks' : 'artists';
  const coverRows = useMemo(() => (target ? [target] : null), [target]);
  const covers = useCovers(mode, coverRows);
  const awards = useMemo(() => (target && records
    ? awardsFor(target, { ...records, ...gpRecords(career) }) : []), [target, records, career]);

  if (!target) return null;
  const s = data?.summary;
  const best = data?.daily?.length
    ? data.daily.reduce((a, b) => (Number(b.plays) > Number(a.plays) ? b : a)) : null;
  const hours = s ? s.minutes / 60 : 0;
  const est = Boolean(data?.estimate && s?.yt) ? '≈' : '';
  // its championship line for the hero: wins and points across every Grand Prix
  const champ = (() => {
    const list = target.track ? career?.drivers : career?.constructors;
    const i = (list ?? []).findIndex((r) => (target.track
      ? r.artist_key === target.artist_key && r.track_key === target.track_key
      : r.artist_key === target.artist_key));
    return i >= 0 ? { pos: i + 1, ...list[i] } : null;
  })();
  const pic = coverOf(covers, mode, target);

  return (
    <>
      <button className="sheet-scrim" aria-label="닫기" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={target.track ?? target.artist}
           style={{ '--acc': artistColor(target.artist) }}>
        <div className="sheet-hero">
        {pic && <span className="sheet-hero-bg" aria-hidden="true" style={{ backgroundImage: `url(${pic})` }} />}
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <Cover src={pic} size={96} round={!target.track} />
          <div className="sheet-title">
            <b>{target.track ?? target.artist}</b>
            {target.track && <span>{artistLine(target)}</span>}
            {s && <em>{dayLabel(s.first)} 처음 · {dayLabel(s.last)} 마지막</em>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
        {s && (
          <div className="sheet-big">
            <span><b><Count value={s.plays} prefix={est} /></b><small>재생</small></span>
            <span><b><Count value={s.days} /></b><small>들은 날</small></span>
            <span><b>{champ ? <Count value={champ.wins} /> : '–'}</b><small>GP 우승</small></span>
            <span><b>{champ ? `${champ.pos}위` : '–'}</b><small>통산 {target.track ? '드라이버' : '컨스트럭터'}</small></span>
          </div>
        )}
        </div>

        {error && <p className="err">{error}</p>}
        {!error && !data && <div className="skeleton"><i /><i /></div>}

        <div className="sheet-tabs">
          <Seg options={TABS} value={tab} onChange={setTab} label="상세 항목" />
        </div>

        <div className="sheet-panel" hidden={tab !== 'overview'}>
        {s && (
          <>
            <div className="stats compact">
              <Stat value={est + s.plays.toLocaleString()} label="재생" />
              <Stat value={est + (hours >= 1 ? `${hours.toFixed(1)}h` : `${s.minutes}분`)} label="시간" />
              <Stat value={s.days.toLocaleString()} label="들은 날" />
              <Stat value={s.weeks.toLocaleString()} label="들은 주" />
            </div>
            <DailyChart daily={data.daily} />
            <p className="note">최다 {dayLabel(best?.day)} · {est}{Math.round(Number(best?.plays ?? 0)).toLocaleString()}회</p>
          </>
        )}
        </div>

        <div className="sheet-panel" hidden={tab !== 'awards'}>
        {awards.length === 0 && <p className="note">{records ? '보유하거나 뒤쫓는 기록이 없어요' : '불러오는 중…'}</p>}
        {awards.length > 0 && (() => {
          const held = awards.filter((x) => x.place === 1);
          const near = awards.filter((x) => x.place > 1 && x.place <= 3);
          const row = ({ def, place, holder }) => {
            const v = formatValue(def, holder.value);
            return (
              <li key={def.key}>
                {place > 1 && <i>{place}</i>}
                <span>{def.full ?? def.title}{def.tag && <em> {def.tag}</em>}</span>
                <b>{v.v}<small>{v.unit}</small></b>
              </li>
            );
          };
          return (
            <div className="sheet-sec">
              <h3>Awards{held.length > 0 && <span>{held.length}개 보유</span>}</h3>
              {held.length > 0 && <ul className="held">{held.map(row)}</ul>}
              {near.length > 0 && (
                <>
                  <p className="held-k">2·3위</p>
                  <ul className="held near">{near.map(row)}</ul>
                </>
              )}
            </div>
          );
        })()}
        </div>

        {/* mounted from the start so the ranking is ready by the time it's asked for */}
        <div className="sheet-panel" hidden={tab !== 'ranks'}>
          <RankHistory target={target} source={source} estimate={estimate} />
        </div>

        <div className="sheet-panel" hidden={tab !== 'career'}>
          <Career target={target} career={career} />
        </div>

        <div className="sheet-panel" hidden={tab !== 'versus'}>
          {tab === 'versus' && <Versus target={target} source={source} estimate={estimate} career={career} mine={data} />}
        </div>
      </div>
    </>
  );
}
