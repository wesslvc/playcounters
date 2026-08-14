'use client';

import { useEffect, useMemo, useState } from 'react';

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

/**
 * The window between an item's first and last play, drawn against the whole
 * range. A short bright bar is a binge; a long pale one never left the
 * rotation. Colour encodes how many days inside that window it was actually
 * played on, so density and duration read separately.
 */
function Strip({ days, item }) {
  if (!days.length) return null;
  const first = new Date(item.first_at).getTime();
  const last = new Date(item.last_at).getTime();
  const spanDays = Math.max(1, Math.round((last - first) / 864e5) + 1);
  const density = Number(item.days) / spanDays;

  return (
    <div className="strip" aria-hidden="true">
      {days.map((d) => {
        const t = new Date(d.day).getTime();
        const inside = t >= first - 432e5 && t <= last + 432e5;
        if (!inside) return <i key={d.day} />;
        const cls = density > 0.6 ? 'max' : density > 0.25 ? 'hi' : 'on';
        return <i key={d.day} className={cls} style={{ height: '100%' }} />;
      })}
    </div>
  );
}

export default function Dashboard() {
  const [period, setPeriod] = useState('all');
  const [mode, setMode] = useState('tracks');
  const [sort, setSort] = useState('plays');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const { from, to } = rangeFor(period);
    fetch(`/api/stats?mode=${mode}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) setError(json.error);
        else setData(json);
      })
      .catch(() => !cancelled && setError('통계를 불러오지 못했습니다.'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [period, mode]);

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.items].sort((a, b) => Number(b[sort]) - Number(a[sort]) || Number(b.plays) - Number(a.plays));
  }, [data, sort]);

  const unit = SORTS.find((s) => s[0] === sort)[2];
  const s = data?.summary;

  return (
    <div className="wrap">
      <header>
        <p className="eyebrow">
          {data?.user?.display_name ?? 'Spotify'}
          {data?.user?.last_synced_at &&
            ` · ${new Date(data.user.last_synced_at).toLocaleString('ko-KR')} 갱신`}
        </p>
        <h1>내가 <em>진짜</em><br />들은 것</h1>
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
        <div className="row">
          {PERIODS.map(([v, label]) => (
            <button key={v} className="pill" aria-pressed={period === v} onClick={() => setPeriod(v)}>
              {label}
            </button>
          ))}
        </div>
        <div className="row">
          {MODES.map(([v, label]) => (
            <button key={v} className="pill" aria-pressed={mode === v} onClick={() => setMode(v)}>
              {label}
            </button>
          ))}
          <a className="pill" href="/import">가져오기</a>
          <a className="pill" href="/api/auth/logout">로그아웃</a>
        </div>
        <div className="row sorts">
          {SORTS.map(([v, label]) => (
            <button key={v} className="pill" aria-pressed={sort === v} onClick={() => setSort(v)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="err" style={{ padding: '20px 2px' }}>{error}</p>}

      {!error && loading && <p className="note" style={{ padding: '20px 2px' }}>불러오는 중…</p>}

      {!error && !loading && rows.length === 0 && (
        <div className="panel">
          <h2>아직 기록이 없습니다</h2>
          <p>
            음악을 들으면 30분 안에 여기 쌓입니다. 예전 기록을 먼저 채우려면
            가져오기에서 Spotify JSON 파일을 올리세요.
          </p>
          <a className="btn" href="/import">가져오기 열기</a>
        </div>
      )}

      {!error && !loading && rows.length > 0 && (
        <>
          <div className="legend">
            <span>{mode === 'tracks' ? '곡' : '가수'} · {SORTS.find((x) => x[0] === sort)[1]} 순</span>
            <span>막대 = 처음~마지막 재생 구간</span>
          </div>
          <ol>
            {rows.map((r, i) => (
              <li className="item" key={`${r.artist}-${r.track ?? ''}`}>
                <div className="rk">{i + 1}</div>
                <div className="nm">
                  <b>{r.track ?? r.artist}</b>
                  <span>{r.track ? r.artist : `${Number(r.plays).toLocaleString()}회 · ${r.days}일`}</span>
                </div>
                <div className="val">{fmt(r[sort], sort)}<i>{unit}</i></div>
                <Strip days={data.daily} item={r} />
              </li>
            ))}
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
