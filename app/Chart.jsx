'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { rowKey } from '@/lib/keys';
import { artistColor, familyLabel } from '@/lib/genre';
import { computeRanks, computeRanksBy } from '@/lib/rank';
import { yearsFromCalendar } from '@/lib/calendar';
import { useCredits, artistLine, artistNames, fillStyle } from './useCredits';
import { useGenres, seedGenres } from './useGenres';
import { useCovers, coverOf } from './useCovers';
import Trend from './Trend';
import Picker from './Picker';
import { Seg, Cover, Stat, Delta, dayLabel } from './ui';

const SORTS = [
  ['plays', '재생 횟수', '회'],
  ['days', '들은 날', '일'],
  ['weeks', '들은 주', '주'],
  ['minutes', '들은 시간', '분'],
];
const VIZ = [['count', '횟수'], ['span', '기간'], ['both', '둘 다']];

/** Rows fetched at a time; 더 보기 asks for the next slice. */
const PAGE = 50;
const MAX_ROWS = 50000;
/** Cells in the span strip. Fixed, so the drawing survives a long range. */
const STRIP_CELLS = 90;

const DAY = 864e5;
/* Ranking is reckoned in Korean time, so the windows have to be too. KST has
   no DST, which is what makes a fixed offset exact. */
const KST = 9 * 3600e3;

const kstMidnight = (ts) => {
  const k = new Date(ts + KST);
  k.setUTCHours(0, 0, 0, 0);
  return k.getTime() - KST;
};
const monthDays = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Weeks are counted within the month: 1st–7th, 8th–14th, and so on. */
const weekSpan = (y, m, w) => [(w - 1) * 7 + 1, Math.min(w * 7, monthDays(y, m))];
const weekCount = (y, m) => Math.ceil(monthDays(y, m) / 7);
const WEEK_LABELS = ['첫째 주', '둘째 주', '셋째 주', '넷째 주', '다섯째 주'];
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * The selected window, plus the one right before it for movement. `sel` is
 * {y, m, w, d}, narrower fields optional; null means all of history.
 */
function rangeFor(sel) {
  const iso = (ms) => new Date(ms).toISOString();
  const win = (a, b, pa, pb) => ({
    from: iso(a), to: iso(b),
    prevFrom: pa == null ? null : iso(pa),
    prevTo: pb == null ? null : iso(pb),
  });
  const at = (y, m, d) => Date.UTC(y, m, d) - KST;

  if (!sel?.y) return win(0, kstMidnight(Date.now()) + DAY, null, null);
  const { y, m, w, d } = sel;
  if (m == null) return win(at(y, 0, 1), at(y + 1, 0, 1), at(y - 1, 0, 1), at(y, 0, 1));
  if (d != null) {
    const a = at(y, m - 1, d);
    return win(a, a + DAY, a - DAY, a);
  }
  const [s0, s1] = w == null ? [] : weekSpan(y, m, w);
  if (w != null && s0 <= s1) {
    const a = at(y, m - 1, s0);
    return win(a, at(y, m - 1, s1 + 1), a - 7 * DAY, a);
  }
  return win(at(y, m - 1, 1), at(y, m, 1), at(y, m - 2, 1), at(y, m - 1, 1));
}

/** "2024년 12월 1일 – 12월 7일" — states exactly what is being counted. */
function rangeLabel(sel, calendar) {
  if (!sel?.y) {
    if (!calendar?.length) return '전체 기간';
    const days = calendar.map((c) => c.day).sort();
    return `${dayLabel(days[0])} – ${dayLabel(days[days.length - 1])}`;
  }
  const { from, to } = rangeFor(sel);
  const a = new Date(new Date(from).getTime() + KST);
  const b = new Date(new Date(to).getTime() + KST - DAY);
  const head = `${a.getUTCFullYear()}년 ${a.getUTCMonth() + 1}월 ${a.getUTCDate()}일`;
  if (a.getTime() === b.getTime()) return `${head} ${WEEKDAYS[a.getUTCDay()]}요일`;
  const tail = a.getUTCFullYear() === b.getUTCFullYear()
    ? `${b.getUTCMonth() + 1}월 ${b.getUTCDate()}일`
    : `${b.getUTCFullYear()}년 ${b.getUTCMonth() + 1}월 ${b.getUTCDate()}일`;
  return `${head} – ${tail}`;
}

/** A short title for the window: "전체", "2026", "2026년 3월", "3월 둘째 주". */
function rangeTitle(sel) {
  if (!sel?.y) return '전체 기간';
  if (sel.m == null) return `${sel.y}년`;
  if (sel.d != null) return `${sel.m}월 ${sel.d}일`;
  if (sel.w != null) return `${sel.m}월 ${WEEK_LABELS[sel.w - 1]}`;
  return `${sel.y}년 ${sel.m}월`;
}

function fmt(value, key) {
  const n = Number(value);
  if (key === 'minutes') return n >= 60 ? (n / 60).toFixed(1) + '시간' : n + '분';
  return n.toLocaleString();
}

/**
 * How long an item stayed in rotation, drawn against the whole range: one
 * cell per slice of the range, filled on the days it actually played, in
 * the artist's color, stronger the denser its days are.
 */
function Strip({ days, item, color }) {
  if (!days.length) return null;
  const spanDays = Math.max(1,
    Math.round((new Date(item.last_at) - new Date(item.first_at)) / DAY) + 1);
  const density = Number(item.days) / spanDays;
  const opacity = density > 0.6 ? 1 : density > 0.25 ? 0.68 : 0.4;
  const t0 = new Date(days[0].day).getTime();
  const t1 = new Date(days[days.length - 1].day).getTime();
  const span = Math.max(1, t1 - t0);
  const cells = Math.min(STRIP_CELLS, days.length);
  const slot = (t) => Math.max(0, Math.min(cells - 1, Math.round(((t - t0) / span) * (cells - 1))));
  const on = new Set();
  if (item.day_nums?.length) {
    for (const n of item.day_nums) on.add(slot(n * DAY));
  } else {
    const a = slot(new Date(item.first_at).getTime());
    const b = slot(new Date(item.last_at).getTime());
    for (let i = a; i <= b; i++) on.add(i);
  }
  return (
    <div className="strip" aria-hidden="true">
      {Array.from({ length: cells }, (_, i) => (
        <i key={i} style={on.has(i) ? { background: color, opacity } : undefined} />
      ))}
    </div>
  );
}

/**
 * The window's top three. The leader gets the room — artwork large, title
 * set big — and second and third sit under it, the way a chart's number one
 * is announced rather than listed.
 */
function TopThree({ rows, ranks, mode, covers, sort, unit, onSelect, isEst }) {
  if (rows.length < 3) return null;
  const [first, ...rest] = rows.slice(0, 3);
  const target = (r) => ({ artist: r.artist, track: r.track ?? null, artist_key: r.artist_key, track_key: r.track_key ?? null });
  const img = coverOf(covers, mode, first);
  return (
    <div className="top3">
      <button className="no1" onClick={() => onSelect(target(first))}>
        <span className="no1-bg" style={img ? { backgroundImage: `url(${img})` } : undefined} aria-hidden="true" />
        <Cover src={img} size={132} round={mode === 'artists'} />
        <span className="no1-text">
          <span className="no1-k">
            {ranks[0] === 1 ? '1위' : `${ranks[0]}위`}
          </span>
          <b>{first.track ?? first.artist}</b>
          {first.track && <span className="no1-a">{artistLine(first)}</span>}
          <span className="no1-v">{isEst(first) ? '≈' : ''}{fmt(first[sort], sort)}<small>{sort === 'minutes' ? '' : unit}</small></span>
        </span>
      </button>
      <div className="runners">
        {rest.map((r, i) => (
          <button key={rowKey(r)} className="runner" onClick={() => onSelect(target(r))}>
            <span className="runner-rk">{ranks[i + 1]}</span>
            <Cover src={coverOf(covers, mode, r)} size={52} round={mode === 'artists'} />
            <span className="runner-text">
              <b>{r.track ?? r.artist}</b>
              <span>{r.track ? artistLine(r) : `${Number(r.days)}일`}</span>
            </span>
            <span className="runner-v">{isEst(r) ? '≈' : ''}{fmt(r[sort], sort)}<small>{sort === 'minutes' ? '' : unit}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The window in a few lines: the longest unbroken run of listening days,
 * the busiest single day, the genre that took the most of it and — with a
 * previous window to compare against — who climbed the most.
 */
function Highlights({ rows, ranks, daily, prevRank, prevComplete, familyOf }) {
  const streak = useMemo(() => {
    if (!daily?.length) return null;
    const days = [...new Set(daily.map((d) => d.day))].sort();
    let best = 1, cur = 1, bestEnd = days[0];
    for (let i = 1; i < days.length; i++) {
      const gap = Math.round((new Date(days[i]) - new Date(days[i - 1])) / DAY);
      cur = gap === 1 ? cur + 1 : 1;
      if (cur > best) { best = cur; bestEnd = days[i]; }
    }
    return { len: best, end: bestEnd };
  }, [daily]);

  const busiest = useMemo(() => (daily?.length
    ? daily.reduce((a, b) => (Number(b.plays) > Number(a.plays) ? b : a)) : null), [daily]);

  const riser = useMemo(() => {
    if (!prevRank || !prevComplete) return null;
    let best = null;
    rows.forEach((r, i) => {
      const before = prevRank.get(rowKey(r));
      if (before === undefined) return;
      const gain = before - ranks[i];
      if (gain > 0 && (!best || gain > best.gain)) best = { r, gain };
    });
    return best;
  }, [rows, ranks, prevRank, prevComplete]);

  const topGenre = useMemo(() => {
    const byFamily = new Map();
    for (const r of rows) {
      const fam = familyOf(r);
      if (!fam || fam === 'other') continue;
      byFamily.set(fam, (byFamily.get(fam) ?? 0) + Number(r.plays));
    }
    if (!byFamily.size) return null;
    const [family, plays] = [...byFamily].sort((a, b) => b[1] - a[1])[0];
    const total = [...byFamily.values()].reduce((a, b) => a + b, 0);
    return { family, share: Math.round((plays / total) * 100) };
  }, [rows, familyOf]);

  const items = [
    topGenre && ['주력 장르', familyLabel(topGenre.family), `장르가 확인된 재생의 ${topGenre.share}%`],
    streak && streak.len > 1 && ['연속 청취', `${streak.len}일`, `${dayLabel(streak.end)}까지`],
    busiest && ['가장 많이 들은 날', `${Math.round(Number(busiest.plays)).toLocaleString()}회`, dayLabel(busiest.day)],
    riser && ['최고 상승', riser.r.track ?? riser.r.artist, `▲${riser.gain}`],
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <dl className="highlights">
      {items.map(([k, v, sub]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd><b>{v}</b><span>{sub}</span></dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The ranked list for any window — all of history down to a single day —
 * sorted by plays, days, weeks or minutes. By plays it ranks the way a Grand
 * Prix finishes, and every row shows how it moved against the window before
 * (or that it is new); the championship, with its points, is one tap away.
 */
export default function Chart({ source: src, mode, estimate, calendar, version, onSelect, go }) {
  const [sel, setSel] = useState(null);
  const [sort, setSort] = useState('plays');
  const [viz, setViz] = useState('count');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [expanding, setExpanding] = useState(false);
  const [showTrend, setShowTrend] = useState(false);
  const [trendN, setTrendN] = useState(5);

  useEffect(() => { setLimit(PAGE); }, [sel, mode, src]);

  const cal = calendar ?? [];
  const years = useMemo(() => yearsFromCalendar(cal), [cal]);
  const months = useMemo(() => {
    if (!sel?.y) return [];
    const m = new Map();
    for (const c of cal) {
      if (Number(c.day.slice(0, 4)) !== sel.y) continue;
      const mo = Number(c.day.slice(5, 7));
      m.set(mo, (m.get(mo) || 0) + Number(c.plays));
    }
    return [{ value: null, label: '연 전체' },
      ...[...m].sort((a, b) => b[0] - a[0]).map(([mo, n]) => ({ value: mo, label: `${mo}월`, count: n }))];
  }, [cal, sel?.y]);
  const monthDaysWithPlays = useMemo(() => {
    if (!sel?.y || sel.m == null) return [];
    const out = [];
    for (const c of cal) {
      if (Number(c.day.slice(0, 4)) !== sel.y || Number(c.day.slice(5, 7)) !== sel.m) continue;
      const d = Number(c.day.slice(8, 10));
      const dow = new Date(Date.UTC(sel.y, sel.m - 1, d)).getUTCDay();
      out.push({ value: d, label: `${d}일 ${WEEKDAYS[dow]}`, count: Number(c.plays) });
    }
    return out.sort((a, b) => a.value - b.value);
  }, [cal, sel?.y, sel?.m]);
  const weeks = useMemo(() => {
    if (!sel?.y || sel.m == null) return [];
    const totals = new Map();
    for (const d of monthDaysWithPlays) {
      const w = Math.min(Math.ceil(d.value / 7), WEEK_LABELS.length);
      totals.set(w, (totals.get(w) || 0) + d.count);
    }
    const out = [{ value: null, label: '월 전체' }];
    for (let w = 1; w <= weekCount(sel.y, sel.m); w++) {
      if (!totals.has(w)) continue;
      const [a, b] = weekSpan(sel.y, sel.m, w);
      out.push({ value: w, label: `${WEEK_LABELS[w - 1]} · ${a}–${b}일`, count: totals.get(w) });
    }
    return out;
  }, [monthDaysWithPlays, sel?.y, sel?.m]);
  const days = useMemo(() => {
    if (!sel?.y || sel.m == null) return [];
    const inWeek = sel.w == null ? monthDaysWithPlays : monthDaysWithPlays.filter((d) => {
      const [a, b] = weekSpan(sel.y, sel.m, sel.w);
      return d.value >= a && d.value <= b;
    });
    return [{ value: null, label: sel.w == null ? '월 전체' : '주 전체' }, ...inWeek];
  }, [monthDaysWithPlays, sel?.y, sel?.m, sel?.w]);

  const range = useMemo(() => rangeFor(sel), [sel]);

  const fetchStats = useCallback(async (signal) => {
    const { from, to, prevFrom, prevTo } = range;
    const qs = new URLSearchParams({ mode, from, to, limit: String(limit), source: src });
    if (viz !== 'count') qs.set('days', '1');
    if (estimate) qs.set('estimate', '1');
    if (prevFrom && prevTo) { qs.set('prevFrom', prevFrom); qs.set('prevTo', prevTo); }
    const res = await fetch(`/api/stats?${qs}`, { signal });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    seedGenres(json.genres);
    return json;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, mode, src, viz, limit, estimate, version]);

  useEffect(() => {
    const ctl = new AbortController();
    if (limit === PAGE) setLoading(true);
    setError(null);
    fetchStats(ctl.signal)
      .then(setData)
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message || '불러오지 못했습니다.'); })
      .finally(() => {
        if (ctl.signal.aborted) return;
        setLoading(false);
        setExpanding(false);
      });
    return () => ctl.abort();
  }, [fetchStats, limit]);

  // By plays the list finishes the way a Grand Prix does: the same total
  // reached later places ahead, so only an identical last play shares a rank.
  const cmp = useCallback(
    (a, b) => Number(b[sort]) - Number(a[sort]) || Number(b.plays) - Number(a.plays)
      || (sort === 'plays' ? new Date(b.last_at) - new Date(a.last_at) : 0), [sort]);
  const rankOf = useCallback(
    (list) => (sort === 'plays' ? computeRanksBy(list, ['plays', 'last_at']) : computeRanks(list, sort)), [sort]);
  const rows = useMemo(() => (data ? [...data.items].sort(cmp) : []), [data, cmp]);
  const ranks = useMemo(() => rankOf(rows), [rows, rankOf]);
  // Last window's rank on the metric being sorted by, worked out server-side
  // over that whole window, so it is there however far down it was.
  const prevRank = useMemo(() => {
    if (!data?.prevReady) return null;
    const m = new Map();
    for (const r of data.items) if (r.prev?.[sort] != null) m.set(rowKey(r), r.prev[sort]);
    return m;
  }, [data, sort]);
  const prevComplete = Boolean(data?.prevReady);
  const priorSet = useMemo(() => new Set((data?.prior ?? []).map(rowKey)), [data]);

  const covers = useCovers(mode, rows);
  const creditVersion = useCredits(rows);
  const genreNames = useMemo(
    () => [...new Set(rows.flatMap((r) => artistNames(r)))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, creditVersion]);
  const genres = useGenres(genreNames);
  const familyOf = useCallback((row) => genres[row.artist]?.family ?? null, [genres]);
  const genreOf = (row) => {
    const fam = familyOf(row);
    return fam && fam !== 'other' ? familyLabel(fam) : null;
  };

  const max = rows.length ? Number(rows[0][sort]) : 0;
  const unit = SORTS.find((s) => s[0] === sort)[2];
  const s = data?.summary;
  const showCount = viz === 'count' || viz === 'both';
  const showSpan = viz === 'span' || viz === 'both';
  const estimating = Boolean(data?.estimate);
  const isEst = (row) => estimating && Boolean(row?.yt);
  const estIsh = sort === 'plays' || sort === 'minutes';

  // A whole month on plays is that month's Grand Prix; a whole year, a season.
  const isMonth = sel?.y && sel.m != null && sel.w == null && sel.d == null;
  const now = new Date(Date.now() + KST);
  const liveMonth = isMonth && sel.y === now.getUTCFullYear() && sel.m === now.getUTCMonth() + 1;
  const target = (r) => ({ artist: r.artist, track: r.track ?? null, artist_key: r.artist_key, track_key: r.track_key ?? null });

  return (
    <section className="view chart">
      <div className="toolbar">
        <div className="picks">
          <button className="chip" aria-pressed={!sel} onClick={() => setSel(null)}>전체</button>
          <Picker value={sel?.y ?? null} label={sel?.y ? `${sel.y}년` : '연도'} options={years}
                  onChange={(y) => setSel({ y, m: null, w: null, d: null })} />
          <Picker value={sel?.m ?? null} label={sel?.m ? `${sel.m}월` : '월'} options={months}
                  disabled={!sel?.y} onChange={(m) => setSel((p) => ({ ...p, m, w: null, d: null }))} />
          <Picker value={sel?.w ?? null} label={sel?.w ? WEEK_LABELS[sel.w - 1] : '주'} options={weeks}
                  disabled={!sel?.y || sel.m == null} onChange={(w) => setSel((p) => ({ ...p, w, d: null }))} />
          <Picker value={sel?.d ?? null} label={sel?.d ? `${sel.d}일` : '일'} options={days}
                  disabled={!sel?.y || sel.m == null} onChange={(d) => setSel((p) => ({ ...p, d }))} />
        </div>
      </div>

      <div className="hero">
        <p className="hero-k">{rangeLabel(sel, cal)}</p>
        <h1 className="hero-t">{rangeTitle(sel)}</h1>
        <div className="stats">
          <Stat value={s ? `${isEst(s) ? '≈' : ''}${s.plays.toLocaleString()}` : '—'} label="재생" />
          <Stat value={s ? Math.round(s.minutes / 60).toLocaleString() : '—'} label="시간" />
          <Stat value={s ? s.items.toLocaleString() : '—'} label={mode === 'tracks' ? '곡' : '가수'} />
          <Stat value={s ? s.days.toLocaleString() : '—'} label="들은 날" />
        </div>
        {(isMonth || (sel?.y && sel.m == null)) && (
          <button className="gp-link" onClick={() => go('season', { year: sel.y })}>
            <span>{isMonth
              ? `${sel.m}월 그랑프리${liveMonth ? ' · 진행 중' : ''}`
              : `${sel.y} 시즌`}</span>
            <b>스탠딩</b>
          </button>
        )}
      </div>

      <div className="listbar">
        <Seg options={SORTS.map(([v, l]) => [v, l])} value={sort} onChange={setSort} size="sm" label="정렬" />
        <div className="listbar-side">
          <Picker value={viz} label={VIZ.find((v) => v[0] === viz)[1]}
                  options={VIZ.map(([value, label]) => ({ value, label }))} onChange={setViz} />
          <button className="chip" aria-pressed={showTrend} onClick={() => setShowTrend((v) => !v)}>추이</button>
        </div>
      </div>

      {showTrend && (
        <div className="trend-box">
          <Seg options={[[5, 'TOP 5'], [10, 'TOP 10']]} value={trendN} onChange={setTrendN} size="sm" />
          <Trend mode={mode} source={src} estimate={estimating} limit={trendN}
                 from={range.from} to={range.to} genres={genres} />
        </div>
      )}

      {error && <p className="err">{error}</p>}
      {!error && loading && <div className="skeleton" aria-label="불러오는 중"><i /><i /><i /><i /></div>}

      {!error && !loading && rows.length === 0 && (
        <div className="empty">
          <h2>이 기간에는 기록이 없습니다</h2>
          <p>다른 기간을 고르거나, 음악을 들은 뒤 위의 갱신을 누르면 바로 반영됩니다.</p>
          <a className="btn" href="/import">예전 기록 가져오기</a>
        </div>
      )}

      {!error && !loading && rows.length > 0 && (
        <>
          {src !== 'spotify' && sort === 'plays' && !estimating && (
            <p className="caveat">
              유튜브 재생 횟수는 적게 잡혀요 ·{' '}
              <button className="linkish" onClick={() => setSort('days')}>들은 날로 보기</button>
            </p>
          )}
          {showCount && (
            <TopThree rows={rows} ranks={ranks} mode={mode} covers={covers} sort={sort} unit={unit}
                      onSelect={onSelect} isEst={isEst} />
          )}
          <Highlights rows={rows} ranks={ranks} daily={data.daily} prevRank={prevRank}
                      prevComplete={prevComplete} familyOf={familyOf} />

          <div className="legend">
            <span>{prevRank ? '직전 기간 대비' : ''}</span>
            <span>{s ? `${rows.length.toLocaleString()} / ${s.items.toLocaleString()}` : ''}</span>
          </div>
          <ol className={`ranks${showSpan && showCount ? ' dual' : ''}`}>
            {rows.map((r, i) => {
              const pct = max > 0 ? Math.max((Number(r[sort]) / max) * 100, 1.5) : 0;
              const key = rowKey(r);
              const rank = ranks[i];
              const tied = (i > 0 && ranks[i - 1] === rank) || (i < ranks.length - 1 && ranks[i + 1] === rank);
              const before = prevRank?.get(key);
              const delta = !prevRank ? null
                : before !== undefined ? before - rank
                  : prevComplete ? (priorSet.has(key) ? null : undefined) : null;
              return (
                <li key={key}>
                  <button className="row" onClick={() => onSelect(target(r))}>
                    <span className="rk" data-top={rank <= 3 || undefined}>
                      {rank}
                      {tied && <em>공동</em>}
                    </span>
                    <Cover src={coverOf(covers, mode, r)} size={44} round={mode === 'artists'} />
                    <span className="nm">
                      <b>{r.track ?? r.artist}</b>
                      <span>
                        {r.track ? artistLine(r)
                          : `${isEst(r) ? '≈' : ''}${Number(r.plays).toLocaleString()}회 · ${r.days}일`}
                        {genreOf(r) && <em> · {genreOf(r)}</em>}
                      </span>
                    </span>
                    <span className="val">
                      {estIsh && isEst(r) && <em>≈</em>}
                      {fmt(r[sort], sort)}
                      <small>{sort === 'minutes' ? '' : unit}</small>
                      <Delta value={delta} />
                    </span>
                    {showCount && (
                      <span className="meter" aria-hidden="true">
                        <i style={{ width: pct + '%', ...(r.track ? fillStyle(r) : { background: artistColor(r.artist) }) }} />
                      </span>
                    )}
                    {showSpan && <Strip days={data.daily} item={r} color={artistColor(r.artist)} />}
                  </button>
                </li>
              );
            })}
          </ol>

          {rows.length >= limit && limit < MAX_ROWS && (
            <div className="more">
              <button className="btn ghost" disabled={expanding}
                      onClick={() => { setExpanding(true); setLimit((l) => Math.min(l * 2, MAX_ROWS)); }}>
                {expanding ? '불러오는 중…' : '더 보기'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
