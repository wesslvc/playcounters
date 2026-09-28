'use client';

import { useEffect, useMemo, useState } from 'react';
import { yearsFromCalendar } from '@/lib/calendar';
import Picker from './Picker';
import Season from './Season';

const MODES = [['tracks', '곡'], ['artists', '가수']];
const SOURCES = [['all', '전체'], ['spotify', 'Spotify'], ['youtube', 'YouTube']];

/**
 * A separate page rather than a panel bolted onto the dashboard: a
 * championship needs one fixed ruler (always play count, never whichever
 * sort the dashboard happens to be on) and its own year, and living apart
 * makes that plain instead of looking like just another view of the same
 * numbers.
 */
export default function Championship() {
  const [mode, setMode] = useState('tracks');
  const [src, setSrc] = useState('all');
  const [calendar, setCalendar] = useState([]);
  const [year, setYear] = useState(null);
  // Per-year season vs. every Grand Prix ever run, added into one career
  // total — a separate question, so it's a separate toggle rather than
  // folded into the year picker (there is no "연도: 전체" that would mean
  // this; "전체" already means all of history everywhere else in the app,
  // and here it would be ambiguous with a single very long season).
  const [allTime, setAllTime] = useState(false);
  const [theme, setTheme] = useState('light');

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

  // The calendar only depends on source (a play happens on some day whether
  // it's counted as a track or an artist), so it doesn't need to be refetched
  // when mode changes.
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/calendar?source=${src}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => setCalendar(j.calendar ?? []))
      .catch(() => {});
    return () => ctl.abort();
  }, [src]);

  const years = useMemo(() => yearsFromCalendar(calendar), [calendar]);

  // Defaults to the most recent season with anything in it, and snaps back
  // to one that exists if a source switch made the current year vanish.
  useEffect(() => {
    if (years.length && !years.some((y) => y.value === year)) setYear(years[0].value);
  }, [years, year]);

  return (
    <div className="wrap">
      <nav className="nav">
        <a className="pill" href="/">홈</a>
        <a className="pill" href="/import">가져오기</a>
        <a className="pill" href="/championship" aria-current="page">챔피언십</a>
        <button className="pill" onClick={toggleTheme} aria-label="화면 밝기 전환">
          {theme === 'dark' ? '라이트' : '다크'}
        </button>
      </nav>

      <header>
        <p className="eyebrow">Season</p>
        <h1>시즌 <em>챔피언십</em></h1>
        <p className="note" style={{ padding: '4px 2px 0' }}>
          매달을 그랑프리 한 번으로 쳐서, 그 달 재생 횟수 1~10위에 F1 포인트
          (25-18-15-12-10-8-6-4-2-1)를 줍니다. 연말 누적 포인트가 가장 많은
          쪽이 그 해의 챔피언입니다.
        </p>
      </header>

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
        <span className="lbl">출처</span>
        <div className="row">
          {SOURCES.map(([v, label]) => (
            <button key={v} className="pill" aria-pressed={src === v} onClick={() => setSrc(v)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grp" style={{ marginBottom: 18 }}>
        <span className="lbl">기간</span>
        <div className="row" style={{ overflow: 'visible' }}>
          <button className="pill" aria-pressed={allTime} onClick={() => setAllTime(true)}>
            역대 통산
          </button>
          <Picker
            value={year} label={year ? `${year}년` : '연도'}
            options={years} onChange={(v) => { setYear(v); setAllTime(false); }}
            disabled={!years.length}
          />
        </div>
      </div>

      {allTime
        ? <Season mode={mode} source={src} estimate allTime />
        : year != null
          ? <Season mode={mode} source={src} estimate year={year} />
          : <p className="note" style={{ padding: '20px 2px' }}>불러오는 중…</p>}

      <p className="foot">
        순위는 재생 횟수 기준으로 고정됩니다 — 대시보드의 정렬 기준과 무관합니다.
        유튜브 기록은 Recap 보정이 있으면 추정치로, 없으면 기록 그대로 집계됩니다.
      </p>
    </div>
  );
}
