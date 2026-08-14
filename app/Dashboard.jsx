'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { coverKeyFor, rowKey } from '@/lib/keys';

const MODES = [['tracks', '곡'], ['artists', '가수']];
const SORTS = [
  ['plays', '재생 횟수', '회'],
  ['days', '들은 날', '일'],
  ['weeks', '들은 주', '주'],
  ['minutes', '들은 시간', '분'],
];
const VIZ = [['count', '횟수'], ['span', '기간'], ['both', '둘 다']];
const SOURCES = [['all', '전체'], ['spotify', 'Spotify'], ['youtube', 'YouTube']];

/** Rows added per press of 더 보기 — keeps the DOM light on big libraries. */
const PAGE = 200;
/** How many ranked rows to pull; well past what most libraries reach. */
const FETCH_LIMIT = 1500;
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

/** "2024년 12월 1일 ~ 12월 7일" — states exactly what is being counted. */
function rangeLabel(sel) {
  if (!sel?.y) return '전체 기간';
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
  const [visible, setVisible] = useState(PAGE);
  const [covers, setCovers] = useState({});
  const [calendar, setCalendar] = useState([]);

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
  useEffect(() => { setVisible(PAGE); }, [sel, mode, sort, src]);

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
    const qs = new URLSearchParams({ mode, from, to, limit: String(FETCH_LIMIT), source: src });
    if (viz !== 'count') qs.set('days', '1');
    if (prevFrom && prevTo) { qs.set('prevFrom', prevFrom); qs.set('prevTo', prevTo); }
    const res = await fetch(`/api/stats?${qs}`, { signal });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }, [sel, mode, src, viz]);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    fetchStats(ctl.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message || '통계를 불러오지 못했습니다.');
      })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
  }, [fetchStats]);

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

  // Fetch artwork for rows on screen, a batch at a time. Covers are cached
  // server-side and keys carry their kind, so this settles quickly and nothing
  // has to be discarded when the mode changes.
  const shown = useMemo(() => rows.slice(0, visible), [rows, visible]);
  const inFlight = useRef(false);
  const [coverTick, setCoverTick] = useState(0);
  const pausedUntil = useRef(0);

  useEffect(() => {
    if (inFlight.current || !shown.length) return;

    // Spotify rate-limits artwork search, and nearly every YouTube row needs
    // its own lookup. When the server reports a pause, wait it out and try
    // again rather than firing another burst on the next scroll.
    const wait = pausedUntil.current - Date.now();
    if (wait > 0) {
      const t = setTimeout(() => setCoverTick((n) => n + 1), wait + 250);
      return () => clearTimeout(t);
    }

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
    inFlight.current = true;
    fetch('/api/covers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, items: missing }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json) return;
        if (json.retryAfter) {
          pausedUntil.current = Date.now() + json.retryAfter * 1000;
          // Keep whatever did resolve, but leave the rest unknown so they are
          // asked for again — marking them missing here would blank those rows
          // for the whole session over a temporary limit.
          if (json.covers) setCovers((c) => ({ ...c, ...json.covers }));
          setCoverTick((n) => n + 1);
          return;
        }
        const merged = { ...(json.covers || {}) };
        // Record every key asked for, so an unresolved one isn't requested in
        // a loop; a later visit picks it up from the server cache.
        for (const m of missing) {
          const k = coverKeyFor(mode, m);
          if (!(k in merged)) merged[k] = null;
        }
        setCovers((c) => ({ ...c, ...merged }));
      })
      .catch(() => {})
      .finally(() => { inFlight.current = false; });
    return () => { cancelled = true; };
  }, [shown, covers, mode, coverTick]);

  const max = rows.length ? Number(rows[0][sort]) : 0;
  const unit = SORTS.find((s) => s[0] === sort)[2];
  const s = data?.summary;
  const syncedAt = data?.user?.last_synced_at;
  const showCount = viz === 'count' || viz === 'both';
  const showSpan = viz === 'span' || viz === 'both';

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
        <p className="range">{rangeLabel(sel)}</p>

        <p className="synced">
          마지막 갱신{' '}
          {syncedAt
            ? <><b>{ago(syncedAt)}</b><span>{new Date(syncedAt).toLocaleString('ko-KR')}</span></>
            : <b>아직 없음</b>}
        </p>
        {syncMsg && <p className="syncmsg">{syncMsg}</p>}

        <div className="totals">
          {[
            [s ? s.plays.toLocaleString() : '—', '재생'],
            [s ? Math.round(s.minutes / 60).toLocaleString() : '—', '시간'],
            [s ? s.items.toLocaleString() : '—', mode === 'tracks' ? '곡' : '가수'],
            [s ? s.days.toLocaleString() : '—', '들은 날'],
          ].map(([v, l]) => (
            <div className="tot" key={l}><b>{v}</b><span>{l}</span></div>
          ))}
        </div>
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
          <div className="legend">
            <span>
              {mode === 'tracks' ? '곡' : '가수'} · {SORTS.find((x) => x[0] === sort)[1]} 순
              {prevRank && ' · 변동은 직전 기간 대비'}
            </span>
            <span>
              {rows.length.toLocaleString()}개 중 {Math.min(visible, rows.length).toLocaleString()}
            </span>
          </div>
          <ol className={showSpan && showCount ? 'dual' : undefined}>
            {shown.map((r, i) => {
              // Keep a sliver visible so the long tail doesn't read as zero.
              const pct = max > 0 ? Math.max((Number(r[sort]) / max) * 100, 1.5) : 0;
              const key = rowKey(r);
              const img = covers[coverKeyFor(mode, r)];
              const before = prevRank?.get(key);
              const delta = prevRank ? (before === undefined ? undefined : before - (i + 1)) : null;

              return (
                <li className="item" key={key}>
                  <div className="rk">{i + 1}<Delta value={delta} /></div>
                  <div className="art">
                    {img
                      ? <img src={img} alt="" loading="lazy" decoding="async" width="38" height="38" />
                      : <span className="art-none" aria-hidden="true" />}
                  </div>
                  <div className="nm">
                    <b>{r.track ?? r.artist}</b>
                    <span>
                      {r.track ? r.artist : `${Number(r.plays).toLocaleString()}회 · ${r.days}일`}
                    </span>
                  </div>
                  <div className="val">{fmt(r[sort], sort)}<i>{unit}</i></div>
                  {showCount && (
                    <div className="meter" aria-hidden="true"><i style={{ width: pct + '%' }} /></div>
                  )}
                  {showSpan && <Strip days={data.daily} item={r} />}
                </li>
              );
            })}
          </ol>

          {visible < rows.length && (
            <div className="more">
              <button className="btn ghost" onClick={() => setVisible((v) => v + PAGE)}>
                더 보기 ({(rows.length - visible).toLocaleString()}개 남음)
              </button>
            </div>
          )}

          {rows.length >= FETCH_LIMIT && (
            <p className="note" style={{ padding: '10px 2px' }}>
              목록은 {FETCH_LIMIT.toLocaleString()}개까지만 표시합니다.
              위의 합계는 전체 기준입니다.
            </p>
          )}
        </>
      )}

      <p className="foot">
        30초 이상 재생된 것만 셉니다. 팟캐스트와 오디오북은 빠집니다.<br />
        날짜는 한국 시간 기준입니다. 실시간으로 모은 재생은 곡 길이로,
        유튜브 기록은 재생 길이가 없어 1회당 2.5분으로 셉니다.
      </p>
    </div>
  );
}
