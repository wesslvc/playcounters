'use client';

import { useEffect, useMemo, useState } from 'react';
import { awardsFor, gpRecords, formatValue } from '@/lib/awards';
import { artistLine } from './useCredits';
import { useCovers, coverOf } from './useCovers';
import { loadCareer, loadRecords } from './data';
import { Cover, Delta, Seg, Stat, dayLabel } from './ui';

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
const TABS = [['overview', '개요'], ['ranks', '순위'], ['awards', '기록'], ['career', '챔피언십']];

const periodLabel = (scope, d) => {
  const [y, m] = String(d).split('-');
  if (scope === 'year') return `${y}년`;
  return `${y}.${m}${scope === 'all' ? ' 말' : ''}`;
};

/**
 * Rank over time, best at the top. Log scale, so 3,000th and 3rd read on one
 * chart without the climb flattening into the floor; ticks at 1, 10, 100…
 * name the scale, a band marks the top ten, periods sit where they fall in
 * time, and the best and latest points carry their rank. Hover (or tap) a period for its figures.
 */
function RankChart({ list, scope }) {
  const [hover, setHover] = useState(null);
  if (list.length < 2) return null;
  const W = 340, H = 170, L = 34, R = 30, T = 14, B = 24;
  const worst = Math.max(...list.map((r) => r.rank));
  const top = 10 ** Math.max(1, Math.ceil(Math.log10(worst + 1)));
  const y = (rank) => T + (Math.log(rank) / Math.log(top)) * (H - T - B);
  // placed by date, so a gap of months reads as a gap
  const mon = (d) => { const [yy, mm] = String(d).split('-'); return Number(yy) * 12 + Number(mm) - 1; };
  const m0 = mon(list[0].period);
  const span = Math.max(1, mon(list[list.length - 1].period) - m0);
  const xm = (m) => L + ((m - m0) / span) * (W - L - R);
  const x = (i) => xm(mon(list[i].period));
  const ticks = [1, 10, 100, 1000, 10000].filter((t) => t <= top);
  // A stretch with no listening stays joined but reads as one: the line goes
  // dashed across it over a faint band, rather than gliding through.
  const gapOf = (i) => mon(list[i].period) - mon(list[i - 1].period) > (scope === 'year' ? 12 : 1);
  const runs = [];
  list.forEach((r, i) => {
    const pt = `${x(i).toFixed(1)},${y(r.rank).toFixed(1)}`;
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

  return (
    <div className="rankchart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="순위 추이" onMouseLeave={() => setHover(null)}>
        <rect className="rc-band" x={L} y={y(1) - 4} width={W - L - R} height={y(10) - y(1) + 4} rx="4" />
        {ticks.map((t) => (
          <g key={t}>
            <line className="rc-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text className="rc-tick" x={L - 8} y={y(t) + 3.5} textAnchor="end">{t.toLocaleString()}</text>
          </g>
        ))}
        {labels.map((m, k) => (
          <text key={m} className="rc-tick" x={xm(m)} y={H - 6}
                textAnchor={k === 0 ? 'start' : k === labels.length - 1 ? 'end' : 'middle'}>
            {periodLabel(scope, iso(m)).replace(' 말', '')}
          </text>
        ))}
        {h && <line className="rc-cross" x1={x(hover)} x2={x(hover)} y1={T - 6} y2={H - B} />}
        {gaps.map((i) => (
          <g key={`g${i}`}>
            <rect className="rc-gap" x={x(i - 1)} y={T - 6} width={x(i) - x(i - 1)} height={H - B - T + 6} />
            <line className="rc-line gap" x1={x(i - 1)} y1={y(list[i - 1].rank)} x2={x(i)} y2={y(list[i].rank)} />
          </g>
        ))}
        {runs.map((r, k) => (r.length > 1 ? <polyline key={k} className="rc-line" points={r.join(' ')} /> : null))}
        {list.map((r, i) => (
          <circle key={i} className={i === bi ? 'rc-dot best' : 'rc-dot'} cx={x(i)} cy={y(r.rank)}
                  r={i === bi || i === hover ? 4.5 : list.length > 24 ? 0 : 2.5} />
        ))}
        <text className="rc-lbl best" x={x(bi)} y={y(list[bi].rank) - 9}
              textAnchor={bi === 0 ? 'start' : bi === li ? 'end' : 'middle'}>
          최고 {list[bi].rank.toLocaleString()}위
        </text>
        {li !== bi && (
          <text className="rc-lbl" x={x(li) + 7} y={y(list[li].rank) + 3.5}>{list[li].rank.toLocaleString()}</text>
        )}
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

  return (
    <>
      <button className="sheet-scrim" aria-label="닫기" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={target.track ?? target.artist}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <Cover src={coverOf(covers, mode, target)} size={84} round={!target.track} />
          <div className="sheet-title">
            <b>{target.track ?? target.artist}</b>
            {target.track && <span>{artistLine(target)}</span>}
            {s && <em>{dayLabel(s.first)} 처음 · {dayLabel(s.last)} 마지막</em>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
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
          const near = awards.filter((x) => x.place > 1);
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
      </div>
    </>
  );
}
