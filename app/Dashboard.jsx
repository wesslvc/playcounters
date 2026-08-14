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
const PERIODS = [
  ['today', '오늘'],
  ['yday', '어제'],
  ['week', '이번주'],
  ['lastweek', '지난주'],
  ['month', '이번달'],
  ['d30', '30일'],
  ['d90', '90일'],
  ['year', '올해'],
  ['all', '전체'],
];
const VIZ = [['count', '횟수'], ['span', '기간'], ['both', '둘 다']];
const SOURCES = [['all', '전체'], ['spotify', 'Spotify'], ['youtube', 'YouTube']];

/** Rows added per press of 더 보기 — keeps the DOM light on big libraries. */
const PAGE = 200;
/** How many ranked rows to pull; well past what most libraries reach. */
const FETCH_LIMIT = 2000;
/** Cover keys requested per round trip. */
const COVER_BATCH = 60;

const DAY = 864e5;
/* Ranking is reckoned in Korean time, so the windows have to be too — a
   UTC "today" would cut the day at 09:00 local. KST has no DST, so a fixed
   offset is exact. */
const KST = 9 * 3600e3;

const kstMidnight = (ts) => {
  const k = new Date(ts + KST);
  k.setUTCHours(0, 0, 0, 0);
  return k.getTime() - KST;
};
const kstWeekStart = (ts) => {           // weeks start Monday
  const m = kstMidnight(ts);
  const dow = new Date(m + KST).getUTCDay();   // 0 = Sunday
  return m - ((dow + 6) % 7) * DAY;
};
const kstMonthShift = (ts, months) => {
  const k = new Date(ts + KST);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + months, 1) - KST;
};
const kstYearShift = (ts, years) => {
  const k = new Date(ts + KST);
  return Date.UTC(k.getUTCFullYear() + years, 0, 1) - KST;
};

/** A specific calendar month, e.g. "2026-03", cut on Korean day boundaries. */
const MONTH_PREFIX = 'm:';
const monthLabel = (ym) => {
  const [y, m] = ym.split('-');
  return `${y}년 ${Number(m)}월`;
};


/**
 * Window for a period, plus the equivalent window right before it so the list
 * can show movement. "전체" has no before, so it gets none.
 */
function rangeFor(period) {
  const now = Date.now();
  const midnight = kstMidnight(now);
  const iso = (ms) => new Date(ms).toISOString();
  const win = (a, b, pa, pb) => ({
    from: iso(a), to: iso(b),
    prevFrom: pa == null ? null : iso(pa),
    prevTo: pb == null ? null : iso(pb),
  });

  // A month picked from the calendar, compared against the month before it.
  if (period.startsWith(MONTH_PREFIX)) {
    const [y, m] = period.slice(MONTH_PREFIX.length).split('-').map(Number);
    const start = Date.UTC(y, m - 1, 1) - KST;
    return win(start, Date.UTC(y, m, 1) - KST, Date.UTC(y, m - 2, 1) - KST, start);
  }

  switch (period) {
    case 'today':    return win(midnight, midnight + DAY, midnight - DAY, midnight);
    case 'yday':     return win(midnight - DAY, midnight, midnight - 2 * DAY, midnight - DAY);
    case 'week': {
      const s = kstWeekStart(now);
      return win(s, s + 7 * DAY, s - 7 * DAY, s);
    }
    case 'lastweek': {
      const s = kstWeekStart(now) - 7 * DAY;
      return win(s, s + 7 * DAY, s - 7 * DAY, s);
    }
    case 'month': {
      const s = kstMonthShift(now, 0);
      return win(s, kstMonthShift(now, 1), kstMonthShift(now, -1), s);
    }
    case 'd30': {
      const s = midnight - 29 * DAY;
      return win(s, midnight + DAY, s - 30 * DAY, s);
    }
    case 'd90': {
      const s = midnight - 89 * DAY;
      return win(s, midnight + DAY, s - 90 * DAY, s);
    }
    case 'year': {
      const s = kstYearShift(now, 0);
      return win(s, midnight + DAY, kstYearShift(now, -1), s);
    }
    default:         return win(0, midnight + DAY, null, null);
  }
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
 * How long an item stayed in rotation, drawn against the whole range. A short
 * dense bar is a binge; a long pale one never left. Colour is how many days
 * inside that window it actually played, so duration and density read apart.
 */
function Strip({ days, item }) {
  if (!days.length) return null;
  const first = new Date(item.first_at).getTime();
  const last = new Date(item.last_at).getTime();
  const spanDays = Math.max(1, Math.round((last - first) / DAY) + 1);
  const density = Number(item.days) / spanDays;
  const cls = density > 0.6 ? 'max' : density > 0.25 ? 'hi' : 'on';

  return (
    <div className="strip" aria-hidden="true">
      {days.map((d) => {
        const t = new Date(d.day).getTime();
        const inside = t >= first - DAY / 2 && t <= last + DAY / 2;
        return <i key={d.day} className={inside ? cls : undefined} />;
      })}
    </div>
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
  const [period, setPeriod] = useState('all');
  const [mode, setMode] = useState('tracks');
  const [sort, setSort] = useState('plays');
  const [viz, setViz] = useState('count');
  const [src, setSrc] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [visible, setVisible] = useState(PAGE);
  const [covers, setCovers] = useState({});
  const [months, setMonths] = useState([]);

  // The month list doesn't depend on the selected period, so hold onto it
  // instead of letting the picker blink empty on every reload. It does depend
  // on the source, so an empty list must still clear it — data is null while
  // loading, which is what keeps the blink away.
  useEffect(() => {
    if (data?.months) setMonths(data.months);
  }, [data]);

  // Any change to what's listed or how it's ordered starts the list over.
  useEffect(() => { setVisible(PAGE); }, [period, mode, sort, src]);

  const fetchStats = useCallback(async (signal) => {
    const { from, to, prevFrom, prevTo } = rangeFor(period);
    const qs = new URLSearchParams({ mode, from, to, limit: String(FETCH_LIMIT), source: src });
    if (prevFrom && prevTo) { qs.set('prevFrom', prevFrom); qs.set('prevTo', prevTo); }
    const res = await fetch(`/api/stats?${qs}`, { signal });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }, [period, mode, src]);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    fetchStats(ctl.signal)
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message || '통계를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
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
  // server-side, so this settles quickly and stays quiet on later visits.
  const shown = useMemo(() => rows.slice(0, visible), [rows, visible]);
  const inFlight = useRef(false);

  useEffect(() => { setCovers({}); }, [mode]);

  useEffect(() => {
    if (inFlight.current || !shown.length) return;
    const missing = [];
    const seen = new Set();
    for (const r of shown) {
      const k = coverKeyFor(mode, r);
      if (k in covers || seen.has(k)) continue;
      seen.add(k);
      missing.push({ artist: r.artist, album: r.album });
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
        if (cancelled || !json?.covers) return;
        // Record every key asked for, so an unresolved one isn't re-requested
        // in a loop; a later visit picks it up from the server cache.
        const merged = { ...json.covers };
        for (const m of missing) {
          const k = coverKeyFor(mode, m);
          if (!(k in merged)) merged[k] = null;
        }
        setCovers((c) => ({ ...c, ...merged }));
      })
      .catch(() => {})
      .finally(() => { inFlight.current = false; });
    return () => { cancelled = true; };
  }, [shown, covers, mode]);

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
        <a className="pill danger" href="/api/auth/logout">로그아웃</a>
      </nav>

      <header>
        <p className="eyebrow">{data?.user?.display_name ?? 'Spotify'}</p>
        <h1>내가 <em>진짜</em><br />들은 것</h1>

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
          <div className="row">
            {PERIODS.map(([v, label]) => (
              <button key={v} className="pill" aria-pressed={period === v} onClick={() => setPeriod(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grp">
          <span className="lbl">달</span>
          <div className="row">
            <select
              className="pill sel"
              value={period.startsWith(MONTH_PREFIX) ? period : ''}
              onChange={(e) => e.target.value && setPeriod(e.target.value)}
            >
              <option value="">월 선택…</option>
              {months.map(({ ym, plays }) => (
                <option key={ym} value={MONTH_PREFIX + ym}>
                  {monthLabel(ym)} ({Number(plays).toLocaleString()}회)
                </option>
              ))}
            </select>
            {period.startsWith(MONTH_PREFIX) && (
              <span className="picked">{monthLabel(period.slice(MONTH_PREFIX.length))} 통계</span>
            )}
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
        날짜는 한국 시간 기준입니다. 실시간으로 모은 재생은 Spotify가 재생
        길이를 알려주지 않아 곡 길이로 셉니다.
      </p>
    </div>
  );
}
