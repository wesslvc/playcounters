'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const MODES = [['tracks', '곡'], ['artists', '가수']];
const SORTS = [
  ['plays', '재생 횟수', '회'],
  ['days', '들은 날', '일'],
  ['weeks', '들은 주', '주'],
  ['minutes', '들은 시간', '분'],
];
const PERIODS = [
  ['all', '전체'],
  ['30', '최근 30일'],
  ['90', '최근 90일'],
  ['365', '올해'],
];

function rangeFor(period) {
  const to = new Date(Date.now() + 864e5).toISOString();
  if (period === 'all') return { from: '1970-01-01T00:00:00Z', to };
  const days = Number(period);
  return { from: new Date(Date.now() - days * 864e5).toISOString(), to };
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

export default function Dashboard() {
  const [period, setPeriod] = useState('all');
  const [mode, setMode] = useState('tracks');
  const [sort, setSort] = useState('plays');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  const fetchStats = useCallback(async (signal) => {
    const { from, to } = rangeFor(period);
    const res = await fetch(`/api/stats?mode=${mode}&from=${from}&to=${to}`, { signal });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }, [period, mode]);

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

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.items].sort(
      (a, b) => Number(b[sort]) - Number(a[sort]) || Number(b.plays) - Number(a.plays)
    );
  }, [data, sort]);

  // Rows are sorted by the active metric, so the leader sets the bar scale.
  const max = rows.length ? Number(rows[0][sort]) : 0;
  const unit = SORTS.find((s) => s[0] === sort)[2];
  const s = data?.summary;
  const syncedAt = data?.user?.last_synced_at;

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
      </div>

      {error && <p className="err" style={{ padding: '20px 2px' }}>{error}</p>}

      {!error && loading && <p className="note" style={{ padding: '20px 2px' }}>불러오는 중…</p>}

      {!error && !loading && rows.length === 0 && (
        <div className="panel">
          <h2>아직 기록이 없습니다</h2>
          <p>
            음악을 들은 뒤 <b>지금 갱신</b>을 누르면 바로 반영됩니다. 예전 기록을
            먼저 채우려면 가져오기에서 Spotify JSON 파일을 올리세요.
          </p>
          <a className="btn" href="/import">가져오기 열기</a>
        </div>
      )}

      {!error && !loading && rows.length > 0 && (
        <>
          <div className="legend">
            <span>{mode === 'tracks' ? '곡' : '가수'} · {SORTS.find((x) => x[0] === sort)[1]} 순</span>
            <span>막대 = 1위 대비</span>
          </div>
          <ol>
            {rows.map((r, i) => {
              // Keep a sliver visible so the long tail doesn't read as zero.
              const pct = max > 0 ? Math.max((Number(r[sort]) / max) * 100, 1.5) : 0;
              return (
                <li className="item" key={`${r.artist}-${r.track ?? ''}`}>
                  <div className="rk">{i + 1}</div>
                  <div className="nm">
                    <b>{r.track ?? r.artist}</b>
                    <span>
                      {r.track ? r.artist : `${Number(r.plays).toLocaleString()}회 · ${r.days}일`}
                    </span>
                  </div>
                  <div className="val">{fmt(r[sort], sort)}<i>{unit}</i></div>
                  <div className="meter" aria-hidden="true"><i style={{ width: pct + '%' }} /></div>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <p className="foot">
        30초 이상 재생된 것만 셉니다. 팟캐스트와 오디오북은 빠집니다.<br />
        날짜는 한국 시간 기준입니다.
      </p>
    </div>
  );
}
