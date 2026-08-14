'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { coverKeyFor, rowKey } from '@/lib/keys';
import Detail from './Detail';
import Trend from './Trend';

const MODES = [['tracks', '곡'], ['artists', '가수']];
const SORTS = [
  ['plays', '재생 횟수', '회'],
  ['days', '들은 날', '일'],
  ['weeks', '들은 주', '주'],
  ['minutes', '들은 시간', '분'],
];
const VIZ = [['count', '횟수'], ['span', '기간'], ['both', '둘 다']];
const SOURCES = [['all', '전체'], ['spotify', 'Spotify'], ['youtube', 'YouTube']];

/** Rows fetched at a time. Small on purpose: the first paint is what people
    wait on, and almost nobody reads past the first screen. 펼치기 asks the
    server for the next slice rather than shipping thousands up front. */
const PAGE = 50;
/** Ceiling on how deep 펼치기 will go. */
const MAX_ROWS = 3000;
/** Cover keys requested per round trip. */
const COVER_BATCH = 60;
/** Cells in the span strip. Fixed, so the drawing survives a long range. */
const STRIP_CELLS = 90;

const DAY = 864e5;
/* Ranking is reckoned in Korean time, so the windows have to be too. KST has
   no DST, which is what makes a fixed offset exact rather than approximate. */
const KST = 9 * 3600e3;

const kstMidnight = (ts) => {
  const k = new Date(ts + KST);
  k.setUTCHours(0, 0, 0, 0);
  return k.getTime() - KST;
};

/** Days in a Gregorian month. */
const monthDays = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Weeks are counted within the month: 1st-7th, 8th-14th, and so on. */
const weekSpan = (y, m, w) => {
  const start = (w - 1) * 7 + 1;
  return [start, Math.min(w * 7, monthDays(y, m))];
};
const weekCount = (y, m) => Math.ceil(monthDays(y, m) / 7);
const WEEK_LABELS = ['첫째주', '둘째주', '셋째주', '넷째주', '다섯째주'];
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * The selected window, plus the equivalent one right before it so the list can
 * show movement. `sel` is {y, m, w, d} with the narrower fields optional: a
 * year alone means the whole year, a year and month the whole month, a week
 * means that block of seven days, and null means all of history.
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
  // A short month has fewer weeks than a long one, so a week carried over from
  // the previous month can land past its end. Fall back to the whole month
  // rather than producing a range that runs backwards.
  if (w != null && s0 <= s1) {
    const a = at(y, m - 1, s0);
    // Compared against the seven days immediately before, which may cross into
    // the previous month — that is the honest neighbouring window.
    return win(a, at(y, m - 1, s1 + 1), a - 7 * DAY, a);
  }
  return win(at(y, m - 1, 1), at(y, m, 1), at(y, m - 2, 1), at(y, m - 1, 1));
}

const dayLabel = (d) => {
  const [y, m, day] = d.split('-');
  return `${y}년 ${Number(m)}월 ${Number(day)}일`;
};

/** "2024년 12월 1일 ~ 12월 7일" — states exactly what is being counted. */
function rangeLabel(sel, calendar) {
  // "전체" still has real edges; naming them beats an unbounded word.
  if (!sel?.y) {
    if (!calendar?.length) return '전체 기간';
    const days = calendar.map((c) => c.day).sort();
    return `전체 · ${dayLabel(days[0])} ~ ${dayLabel(days[days.length - 1])}`;
  }
  const { from, to } = rangeFor(sel);
  const a = new Date(new Date(from).getTime() + KST);
  // `to` is exclusive; step back a day to name the last day actually included.
  const b = new Date(new Date(to).getTime() + KST - DAY);
  const head = `${a.getUTCFullYear()}년 ${a.getUTCMonth() + 1}월 ${a.getUTCDate()}일`;
  const sameDay = a.getTime() === b.getTime();
  if (sameDay) return `${head} (${WEEKDAYS[a.getUTCDay()]})`;
  const tail = a.getUTCFullYear() === b.getUTCFullYear()
    ? `${b.getUTCMonth() + 1}월 ${b.getUTCDate()}일`
    : `${b.getUTCFullYear()}년 ${b.getUTCMonth() + 1}월 ${b.getUTCDate()}일`;
  return `${head} ~ ${tail}`;
}

function fmt(value, key) {
  const n = Number(value);
  if (key === 'minutes') return n >= 60 ? (n / 60).toFixed(1) + 'h' : n + '분';
  return n.toLocaleString();
}

/** "방금" / "3분 전" / "2시간 전", falling back to a plain date after a week. */
function ago(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60e3) return '방금';
  const m = Math.floor(diff / 60e3);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

/**
 * A dropdown built from the same pill vocabulary as the rest of the controls.
 * A native <select> can't be styled to match across platforms, and this list
 * also has to carry a play count beside each option.
 */
function Picker({ value, label, options, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  return (
    <>
      {open && (
        <button className="scrim" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
      )}
      <div className="pick" data-open={open}>
        <button
          className="pill"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {label}
        </button>
        {open && (
          <div className="menu" role="listbox">
            {options.map((o) => (
              <button
                key={String(o.value)}
                role="option"
                aria-selected={o.value === value}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                <span>{o.label}</span>
                {o.count != null && <em>{Number(o.count).toLocaleString()}</em>}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * How long an item stayed in rotation, drawn against the whole range. A short
 * dense bar is a binge; a long pale one never left. Colour is how many days
 * inside that window it actually played, so duration and density read apart.
 */
function Strip({ days, item }) {
  if (!days.length) return null;
  const spanDays = Math.max(1,
    Math.round((new Date(item.last_at) - new Date(item.first_at)) / DAY) + 1);
  const density = Number(item.days) / spanDays;
  const cls = density > 0.6 ? 'max' : density > 0.25 ? 'hi' : 'on';

  // A fixed number of cells rather than one per day: at 626 days a 1px gap
  // spends every pixel of a phone-width row, leaving the bars sub-pixel.
  const t0 = new Date(days[0].day).getTime();
  const t1 = new Date(days[days.length - 1].day).getTime();
  const span = Math.max(1, t1 - t0);
  const cells = Math.min(STRIP_CELLS, days.length);
  const slot = (t) => Math.max(0, Math.min(cells - 1,
    Math.round(((t - t0) / span) * (cells - 1))));

  // Painted from the days it actually played. Filling first-to-last solid
  // was wrong: a track heard in March and again in August looked like it
  // never left rotation, when the truth is two marks and a long gap.
  const on = new Set();
  if (item.day_nums?.length) {
    for (const n of item.day_nums) on.add(slot(n * DAY));
  } else {
    // No day list (the graph was switched on after loading) — fall back to
    // the endpoints so the row still shows its span.
    const a = slot(new Date(item.first_at).getTime());
    const b = slot(new Date(item.last_at).getTime());
    for (let i = a; i <= b; i++) on.add(i);
  }

  return (
    <div className="strip" aria-hidden="true">
      {Array.from({ length: cells }, (_, i) => (
        <i key={i} className={on.has(i) ? cls : undefined} />
      ))}
    </div>
  );
}

/** Wordmark. Bars first, which is what the app actually measures. */
function Logo() {
  const bars = [
    [0, 13, 'var(--teal)'], [5.5, 9, 'var(--indigo)'],
    [11, 17, 'var(--pink)'], [16.5, 5, 'var(--indigo)'],
  ];
  return (
    <svg className="logo" viewBox="0 0 168 22" role="img" aria-label="playcounters">
      {bars.map(([x, h, fill]) => (
        <rect key={x} x={x} y={19 - h} width="3.6" height={h} rx="1.4" fill={fill} />
      ))}
      <text
        x="27" y="18"
        fontFamily="Bricolage Grotesque, sans-serif"
        fontSize="20" fontWeight="800" letterSpacing="-0.6"
        fill="currentColor"
      >
        playcounters
      </text>
    </svg>
  );
}

/** Places gained since the previous window. */
function Delta({ value }) {
  if (value === undefined) return <span className="delta new">NEW</span>;
  if (value === null) return null;
  if (value === 0) return <span className="delta same">–</span>;
  const up = value > 0;
  return (
    <span className={`delta ${up ? 'up' : 'down'}`}>
      {up ? '▲' : '▼'}{Math.abs(value)}
    </span>
  );
}

export default function Dashboard() {
  const [sel, setSel] = useState(null);          // null = all time
  const [mode, setMode] = useState('tracks');
  const [sort, setSort] = useState('plays');
  const [viz, setViz] = useState('count');
  const [src, setSrc] = useState('all');
  const [theme, setTheme] = useState('light');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [limit, setLimit] = useState(PAGE);
  const [expanding, setExpanding] = useState(false);
  const [covers, setCovers] = useState({});
  const [calendar, setCalendar] = useState([]);
  const [detail, setDetail] = useState(null);
  const [showTrend, setShowTrend] = useState(false);
  // YouTube's export logs one entry per session however many times a track
  // actually ran, so its raw counts are far below the truth. On by default:
  // the calibrated figure is the closer one, and the server answers with the
  // recorded numbers anyway when there is nothing calibrated to apply.
  const [estimate, setEstimate] = useState(true);

  // The theme is applied before paint by a script in the layout; this only
  // reads back what it decided, so the toggle starts on the right label.
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
  }

  // The calendar doesn't depend on the selected window, so hold onto it rather
  // than letting the pickers blink empty on every reload. It does depend on the
  // source, so an empty list must still clear it — data is null while loading,
  // which is what keeps the blink away.
  useEffect(() => { if (data?.calendar) setCalendar(data.calendar); }, [data]);

  // Any change to what's listed or how it's ordered starts the list over.
  useEffect(() => { setLimit(PAGE); }, [sel, mode, src]);

  /* ---- picker options, derived from days that actually hold plays ---- */
  const years = useMemo(() => {
    const m = new Map();
    for (const c of calendar) {
      const y = Number(c.day.slice(0, 4));
      m.set(y, (m.get(y) || 0) + Number(c.plays));
    }
    return [...m].sort((a, b) => b[0] - a[0])
      .map(([y, n]) => ({ value: y, label: `${y}년`, count: n }));
  }, [calendar]);

  const months = useMemo(() => {
    if (!sel?.y) return [];
    const m = new Map();
    for (const c of calendar) {
      if (Number(c.day.slice(0, 4)) !== sel.y) continue;
      const mo = Number(c.day.slice(5, 7));
      m.set(mo, (m.get(mo) || 0) + Number(c.plays));
    }
    return [
      { value: null, label: '연 전체' },
      ...[...m].sort((a, b) => b[0] - a[0])
        .map(([mo, n]) => ({ value: mo, label: `${mo}월`, count: n })),
    ];
  }, [calendar, sel?.y]);

  /** Days in the selected month that hold plays, with their weekday. */
  const monthDaysWithPlays = useMemo(() => {
    if (!sel?.y || sel.m == null) return [];
    const out = [];
    for (const c of calendar) {
      if (Number(c.day.slice(0, 4)) !== sel.y || Number(c.day.slice(5, 7)) !== sel.m) continue;
      const d = Number(c.day.slice(8, 10));
      const dow = new Date(Date.UTC(sel.y, sel.m - 1, d)).getUTCDay();
      out.push({ value: d, label: `${d}일 (${WEEKDAYS[dow]})`, count: Number(c.plays), dow });
    }
    return out.sort((a, b) => a.value - b.value);
  }, [calendar, sel?.y, sel?.m]);

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
      out.push({ value: w, label: `${WEEK_LABELS[w - 1]} (${a}~${b}일)`, count: totals.get(w) });
    }
    return out;
  }, [monthDaysWithPlays, sel?.y, sel?.m]);

  const days = useMemo(() => {
    if (!sel?.y || sel.m == null) return [];
    const inWeek = sel.w == null
      ? monthDaysWithPlays
      : monthDaysWithPlays.filter((d) => {
          const [a, b] = weekSpan(sel.y, sel.m, sel.w);
          return d.value >= a && d.value <= b;
        });
    return [{ value: null, label: sel.w == null ? '월 전체' : '주 전체' },
      ...inWeek.map(({ value, label, count }) => ({ value, label, count }))];
  }, [monthDaysWithPlays, sel?.y, sel?.m, sel?.w]);

  const fetchStats = useCallback(async (signal) => {
    const { from, to, prevFrom, prevTo } = rangeFor(sel);
    const qs = new URLSearchParams({ mode, from, to, limit: String(limit), source: src });
    if (viz !== 'count') qs.set('days', '1');
    if (estimate) qs.set('estimate', '1');
    if (prevFrom && prevTo) { qs.set('prevFrom', prevFrom); qs.set('prevTo', prevTo); }
    const res = await fetch(`/api/stats?${qs}`, { signal });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }, [sel, mode, src, viz, limit, estimate]);

  useEffect(() => {
    const ctl = new AbortController();
    // Only the first slice shows a loading state; 펼치기 keeps what's on
    // screen and appends, so the page doesn't jump back to "불러오는 중".
    if (limit === PAGE) setLoading(true);
    setError(null);
    fetchStats(ctl.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message || '통계를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (ctl.signal.aborted) return;
        setLoading(false);
        setExpanding(false);
      });
    return () => ctl.abort();
  }, [fetchStats, limit]);

  /** Pull straight from Spotify, then redraw — doesn't wait for the 30-minute cron. */
  async function refresh() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/sync/me', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSyncMsg(
        json.cooled ? '방금 갱신했습니다. 잠시 후 다시 눌러 주세요.'
          : json.added ? `${json.added}곡 새로 가져왔습니다.`
            : '새로 들어온 기록이 없습니다.'
      );
      setData(await fetchStats());
    } catch (e) {
      setSyncMsg(`갱신 실패: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }

  const cmp = useCallback(
    (a, b) => Number(b[sort]) - Number(a[sort]) || Number(b.plays) - Number(a.plays),
    [sort]
  );

  const rows = useMemo(() => (data ? [...data.items].sort(cmp) : []), [data, cmp]);

  /** Rank in the previous window, ordered by the same metric. */
  const prevRank = useMemo(() => {
    if (!data?.prev?.length) return null;
    const m = new Map();
    [...data.prev].sort(cmp).forEach((r, i) => m.set(rowKey(r), i + 1));
    return m;
  }, [data, cmp]);

  // The previous window is fetched under the same limit, so an item missing
  // from it may simply have ranked below the cutoff. Only call something NEW
  // when the previous list was short enough to be complete.
  const prevComplete = (data?.prev?.length ?? 0) < limit;

  // Fetch artwork for rows on screen, a batch at a time.
  //
  // Only what the server actually answers is recorded. It caps how many misses
  // it will search per call and stops entirely while rate limited, so treating
  // every requested key as resolved — which is what used to happen — buried
  // those rows permanently behind a null they would never retry. Unanswered
  // keys are simply left unknown and asked for again on the next tick.
  const shown = rows;
  const inFlight = useRef(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (inFlight.current || !shown.length) return;

    const missing = [];
    const seen = new Set();
    for (const r of shown) {
      const k = coverKeyFor(mode, r);
      if (k in covers || seen.has(k)) continue;
      seen.add(k);
      missing.push({ artist: r.artist, album: r.album, track: r.track });
      if (missing.length >= COVER_BATCH) break;
    }
    if (!missing.length) return;

    let cancelled = false;
    let timer;
    inFlight.current = true;
    fetch('/api/covers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, items: missing }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const got = json?.covers ?? {};
        if (Object.keys(got).length) setCovers((c) => ({ ...c, ...got }));
        // Nothing new landed but work remains: come back rather than spin.
        // A rate limit says exactly how long to wait; otherwise pace it.
        if (json?.retryAfter || json?.pending) {
          const wait = json.retryAfter ? json.retryAfter * 1000 : 600;
          timer = setTimeout(() => setTick((t) => t + 1), wait);
        }
      })
      .catch(() => {
        if (!cancelled) timer = setTimeout(() => setTick((t) => t + 1), 3000);
      })
      .finally(() => { inFlight.current = false; });

    return () => { cancelled = true; clearTimeout(timer); };
  }, [shown, covers, mode, tick]);

  const max = rows.length ? Number(rows[0][sort]) : 0;
  const unit = SORTS.find((s) => s[0] === sort)[2];
  const s = data?.summary;
  const syncedAt = data?.user?.last_synced_at;
  const showCount = viz === 'count' || viz === 'both';
  const showSpan = viz === 'span' || viz === 'both';
  // Whether a calibration exists at all, and whether the numbers on screen are
  // actually carrying it. The server decides the second one — asking for the
  // estimate without a calibration behind it just returns the recorded figures.
  const calibrated = Boolean(data?.calibrated);
  const estimating = Boolean(data?.estimate);
  /** A figure is an estimate only if YouTube plays went into it. */
  const isEst = (row) => estimating && Boolean(row?.yt);
  /** Only these two move with the estimate — days and weeks are counted off the
      timestamps whichever way the toggle is set. */
  const estIsh = sort === 'plays' || sort === 'minutes';

  return (
    <div className="wrap">
      <nav className="nav">
        <a className="pill" href="/" aria-current="page">홈</a>
        <a className="pill" href="/import">가져오기</a>
        <button className="pill act" onClick={refresh} disabled={syncing}>
          {syncing ? '갱신 중…' : '지금 갱신'}
        </button>
        <button className="pill" onClick={toggleTheme} aria-label="화면 밝기 전환">
          {theme === 'dark' ? '라이트' : '다크'}
        </button>
        <a className="pill danger" href="/api/auth/logout">로그아웃</a>
      </nav>

      <header>
        <h1><Logo /></h1>
        <p className="eyebrow">{data?.user?.display_name ?? 'Spotify'}</p>
        <p className="range">{rangeLabel(sel, calendar)}</p>

        <p className="synced">
          마지막 갱신{' '}
          {syncedAt
            ? <><b>{ago(syncedAt)}</b><span>{new Date(syncedAt).toLocaleString('ko-KR')}</span></>
            : <b>아직 없음</b>}
        </p>
        {syncMsg && <p className="syncmsg">{syncMsg}</p>}

        <div className="totals">
          {[
            [s ? s.plays.toLocaleString() : '—', '재생', true],
            [s ? Math.round(s.minutes / 60).toLocaleString() : '—', '시간', true],
            [s ? s.items.toLocaleString() : '—', mode === 'tracks' ? '곡' : '가수', false],
            [s ? s.days.toLocaleString() : '—', '들은 날', false],
          ].map(([v, l, est]) => (
            <div className="tot" key={l}>
              <b>{est && isEst(s) ? `≈${v}` : v}</b><span>{l}</span>
            </div>
          ))}
        </div>
        {isEst(s) && (
          <p className="estnote">
            <b>≈</b> 표시는 추정치입니다. 유튜브 기록에는 반복 재생이 남지 않아,
            YouTube Music Recap이 알려 준 청취 시간에 맞춰 다시 계산했습니다.
            총량이 Recap 값에 고정되므로 <b>반복해서 듣던 곡은 올라가고 나머지는
            내려갑니다.</b> Recap이 다루지 않는 기간은 같은 비율을 이월했을
            뿐이라 더 거친 추정입니다. 기록 그대로 보려면 아래에서 바꿀 수 있습니다.
          </p>
        )}
      </header>

      <div className="controls">
        <div className="grp">
          <span className="lbl">기간</span>
          <div className="row picks">
            <button className="pill" aria-pressed={!sel} onClick={() => setSel(null)}>전체</button>
            <Picker
              value={sel?.y ?? null}
              label={sel?.y ? `${sel.y}년` : '연도'}
              options={years}
              onChange={(y) => setSel({ y, m: null, w: null, d: null })}
            />
            <Picker
              value={sel?.m ?? null}
              label={sel?.m ? `${sel.m}월` : '월'}
              options={months}
              disabled={!sel?.y}
              onChange={(m) => setSel((p) => ({ ...p, m, w: null, d: null }))}
            />
            <Picker
              value={sel?.w ?? null}
              label={sel?.w ? WEEK_LABELS[sel.w - 1] : '주'}
              options={weeks}
              disabled={!sel?.y || sel.m == null}
              onChange={(w) => setSel((p) => ({ ...p, w, d: null }))}
            />
            <Picker
              value={sel?.d ?? null}
              label={sel?.d ? `${sel.d}일` : '일'}
              options={days}
              disabled={!sel?.y || sel.m == null}
              onChange={(d) => setSel((p) => ({ ...p, d }))}
            />
          </div>
        </div>
        <div className="grp">
          <span className="lbl">출처</span>
          <div className="row">
            {SOURCES.map(([v, label]) => (
              <button key={v} className="pill" aria-pressed={src === v} onClick={() => setSrc(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {calibrated && (
          <div className="grp">
            <span className="lbl">유튜브 횟수</span>
            <div className="row">
              <button className="pill" aria-pressed={estimate} onClick={() => setEstimate(true)}>
                추정치
              </button>
              <button className="pill" aria-pressed={!estimate} onClick={() => setEstimate(false)}>
                기록 그대로
              </button>
            </div>
          </div>
        )}
        <div className="grp">
          <span className="lbl">종류</span>
          <div className="row">
            {MODES.map(([v, label]) => (
              <button key={v} className="pill" aria-pressed={mode === v} onClick={() => setMode(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grp">
          <span className="lbl">정렬</span>
          <div className="row sorts">
            {SORTS.map(([v, label]) => (
              <button key={v} className="pill" aria-pressed={sort === v} onClick={() => setSort(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grp">
          <span className="lbl">그래프</span>
          <div className="row">
            {VIZ.map(([v, label]) => (
              <button key={v} className="pill" aria-pressed={viz === v} onClick={() => setViz(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="trendbar">
        <button className="pill" aria-pressed={showTrend} onClick={() => setShowTrend((v) => !v)}>
          {showTrend ? '추이 숨기기' : '상위 5개 추이 보기'}
        </button>
      </div>
      {showTrend && <Trend mode={mode} source={src} estimate={estimating} />}

      {error && <p className="err" style={{ padding: '20px 2px' }}>{error}</p>}

      {!error && loading && <p className="note" style={{ padding: '20px 2px' }}>불러오는 중…</p>}

      {!error && !loading && rows.length === 0 && (
        <div className="panel">
          <h2>이 기간에는 기록이 없습니다</h2>
          <p>
            다른 기간을 골라 보시거나, 음악을 들은 뒤 <b>지금 갱신</b>을 누르면
            바로 반영됩니다. 예전 기록은 가져오기에서 채울 수 있습니다.
          </p>
          <a className="btn" href="/import">가져오기 열기</a>
        </div>
      )}

      {!error && !loading && rows.length > 0 && (
        <>
          {/* Takeout logs about one entry per track per day however many times
              it actually ran, so play counts are not comparable across
              sources. Days listened is, and the app can already sort by it —
              saying so beats letting the ranking quietly mislead. */}
          {src !== 'spotify' && sort === 'plays' && !estimating && (
            <p className="caveat">
              유튜브 기록은 하루에 한 번만 남아서 <b>재생 횟수가 실제보다 적습니다.</b>
              {' '}
              {calibrated
                ? <>위의 <b>추정치</b>를 켜면 보정된 횟수를 볼 수 있습니다.</>
                : <>출처를 섞어 볼 때는{' '}
                    <button className="linkish" onClick={() => setSort('days')}>들은 날</button>
                    {' '}기준이 더 정확합니다.</>}
            </p>
          )}
          <div className="legend">
            <span>
              {mode === 'tracks' ? '곡' : '가수'} · {SORTS.find((x) => x[0] === sort)[1]} 순
              {prevRank && ' · 변동은 직전 기간 대비'}
              {estimating && ' · ≈는 유튜브 추정치'}
            </span>
            <span>
              {s ? `${s.items.toLocaleString()}개 중 ` : ''}{rows.length.toLocaleString()} 표시
            </span>
          </div>
          <ol className={showSpan && showCount ? 'dual' : undefined}>
            {shown.map((r, i) => {
              // Keep a sliver visible so the long tail doesn't read as zero.
              const pct = max > 0 ? Math.max((Number(r[sort]) / max) * 100, 1.5) : 0;
              const key = rowKey(r);
              const img = covers[coverKeyFor(mode, r)];
              const before = prevRank?.get(key);
              const delta = !prevRank ? null
                : before !== undefined ? before - (i + 1)
                  : prevComplete ? undefined : null;

              return (
                <li className="item" key={key}>
                  <div className="rk">{i + 1}<Delta value={delta} /></div>
                  <div className="art">
                    {img
                      ? <img src={img} alt="" loading="lazy" decoding="async" width="38" height="38" />
                      : <span className="art-none" aria-hidden="true" />}
                  </div>
                  <button
                    className="nm as-link"
                    onClick={() => setDetail({ artist: r.artist, track: r.track ?? null })}
                    aria-label={`${r.track ?? r.artist} 통계 보기`}
                  >
                    <b>{r.track ?? r.artist}</b>
                    <span>
                      {r.track ? r.artist
                        : `${isEst(r) ? '≈' : ''}${Number(r.plays).toLocaleString()}회 · ${r.days}일`}
                    </span>
                  </button>
                  <div className="val" title={isEst(r) ? '유튜브 추정치가 포함된 값입니다' : undefined}>
                    {/* Only 재생 횟수 and 들은 시간 are estimated; the day and week
                        counts come straight from the timestamps either way. */}
                    {estIsh && isEst(r) && <em className="est">≈</em>}
                    {fmt(r[sort], sort)}<i>{unit}</i>
                  </div>
                  {showCount && (
                    <div className="meter" aria-hidden="true"><i style={{ width: pct + '%' }} /></div>
                  )}
                  {showSpan && <Strip days={data.daily} item={r} />}
                </li>
              );
            })}
          </ol>

          {rows.length >= limit && limit < MAX_ROWS && (
            <div className="more">
              <button
                className="btn ghost"
                disabled={expanding}
                onClick={() => { setExpanding(true); setLimit((l) => Math.min(l * 2, MAX_ROWS)); }}
              >
                {expanding ? '불러오는 중…' : '펼치기'}
              </button>
            </div>
          )}

          {limit >= MAX_ROWS && rows.length >= MAX_ROWS && (
            <p className="note" style={{ padding: '10px 2px' }}>
              목록은 {MAX_ROWS.toLocaleString()}개까지만 표시합니다.
              위의 합계는 전체 기준입니다.
            </p>
          )}
        </>
      )}

      <Detail target={detail} source={src} estimate={estimate} onClose={() => setDetail(null)} />

      <p className="foot">
        30초 이상 재생된 것만 셉니다. 팟캐스트와 오디오북은 빠집니다.<br />
        날짜는 한국 시간 기준입니다. 유튜브 기록에는 재생 길이가 없어,
        {estimating
          ? ' Recap 청취 시간에 맞춰 곡마다 되살린 값을 씁니다.'
          : ' 기록 사이의 간격으로 길이를 추정합니다.'}
      </p>
    </div>
  );
}
