'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Chart from './Chart';
import Championship from './Championship';
import Replay from './Replay';
import Records from './Records';
import Detail from './Detail';
import Picker from './Picker';
import { Seg } from './ui';
import { invalidate } from './data';

const TABS = [
  ['chart', '차트', '/'],
  ['season', '챔피언십', '/championship'],
  ['replay', '리플레이', '/replay'],
  ['records', '기록', '/records'],
];
const SOURCES = [
  { value: 'all', label: '전체 출처' },
  { value: 'spotify', label: 'Spotify' },
  { value: 'youtube', label: 'YouTube' },
];
const MODES = [['tracks', '곡'], ['artists', '가수']];

/** How stale the last sync can be before opening the app triggers one. */
const AUTO_SYNC_AFTER_MS = 2 * 60 * 1000;

const tabForPath = (path) => (TABS.find((t) => t[2] === path) ?? TABS[0])[0];

/** "방금" / "3분 전" / "2시간 전", falling back to a date after a week. */
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

/** Wordmark: four bars and the name, in ink. */
function Logo() {
  const bars = [[0, 9, 0.35], [5, 14, 0.6], [10, 18, 1], [15, 6, 0.35]];
  return (
    <span className="logo" aria-label="playcounters">
      <svg viewBox="0 0 19 18" aria-hidden="true">
        {bars.map(([x, h, o]) => (
          <rect key={x} x={x} y={18 - h} width="3.2" height={h} rx="1.6" fill="currentColor" opacity={o} />
        ))}
      </svg>
      playcounters
    </span>
  );
}

/**
 * The one app: chart, championship, replay and records are four readings of
 * the same plays, so they share one header, one source and kind, one sync,
 * and one detail sheet — a song opened from any of them shows its counts,
 * its championship career and its records together.
 */
export default function App({ initialTab = 'chart' }) {
  const [tab, setTab] = useState(initialTab);
  const [src, setSrc] = useState('all');
  const [mode, setMode] = useState('tracks');
  // YouTube's export logs one entry per session however many times a track
  // ran, so the calibrated figure is the closer one. The server answers with
  // recorded numbers anyway when there is nothing calibrated to apply.
  const [estimate, setEstimate] = useState(true);
  const [theme, setTheme] = useState('light');
  const [me, setMe] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [version, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [menu, setMenu] = useState(false);
  const [detail, setDetail] = useState(null);
  // A year handed over from the chart ("스탠딩 보기"), read once by the championship.
  const [seasonYear, setSeasonYear] = useState(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    const pop = () => setTab(tabForPath(location.pathname));
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);

  function go(next, extra) {
    setTab(next);
    const path = TABS.find((t) => t[0] === next)[2];
    if (location.pathname !== path) history.pushState(null, '', path);
    if (extra?.year != null) setSeasonYear(extra.year);
    scrollTo({ top: 0 });
  }

  const closeDetail = useCallback(() => setDetail(null), []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
  }

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((j) => { if (!j.error) setMe(j); }).catch(() => {});
  }, [version]);

  // Every day that holds plays, for the pickers in every tab.
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/calendar?source=${src}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => setCalendar(j.calendar ?? []))
      .catch(() => {});
    return () => ctl.abort();
  }, [src, version]);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    setSyncing(true);
    if (!quiet) setSyncMsg(null);
    try {
      const res = await fetch('/api/sync/me', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (json.last_synced_at) {
        setMe((m) => m && ({ ...m, user: { ...m.user, last_synced_at: json.last_synced_at } }));
      }
      if (quiet && !json.added) return;
      setSyncMsg(json.cooled ? '방금 갱신했습니다'
        : json.added ? `${json.added}곡 새로 들어옴` : '새 기록 없음');
      if (json.added) { invalidate(); setVersion((v) => v + 1); }
    } catch (e) {
      if (!quiet) setSyncMsg(`갱신 실패 · ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }, []);

  // Opening the app catches up on its own when the last sync is more than a
  // couple of minutes old, so what's on screen is current.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (autoSynced.current || !me) return;
    autoSynced.current = true;
    const at = me.user?.last_synced_at;
    if (!at || Date.now() - new Date(at).getTime() > AUTO_SYNC_AFTER_MS) refresh({ quiet: true });
  }, [me, refresh]);

  useEffect(() => {
    if (!syncMsg) return;
    const t = setTimeout(() => setSyncMsg(null), 4000);
    return () => clearTimeout(t);
  }, [syncMsg]);

  const syncedAt = me?.user?.last_synced_at;
  const calibrated = Boolean(me?.calibrated);
  const shared = { source: src, mode, estimate: estimate && calibrated, calendar, version, onSelect: setDetail, go };

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <Logo />
          <div className="top-side">
            <button
              className="sync" onClick={() => refresh()} disabled={syncing}
              title={syncedAt ? new Date(syncedAt).toLocaleString('ko-KR') : undefined}
            >
              <i data-on={syncing || undefined} aria-hidden="true" />
              {syncing ? '갱신 중' : syncMsg ?? (syncedAt ? ago(syncedAt) : '갱신')}
            </button>
            <div className="menu-wrap">
              {menu && <button className="scrim" aria-hidden="true" tabIndex={-1} onClick={() => setMenu(false)} />}
              <button className="icon-btn" aria-label="메뉴" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.6" /><circle cx="10" cy="10" r="1.6" /><circle cx="16" cy="10" r="1.6" /></svg>
              </button>
              {menu && (
                <div className="menu right" role="menu">
                  {me?.user?.display_name && <p className="menu-who">{me.user.display_name}</p>}
                  <button role="menuitem" onClick={() => { toggleTheme(); setMenu(false); }}>
                    {theme === 'dark' ? '라이트 모드' : '다크 모드'}
                  </button>
                  <a role="menuitem" href="/import">기록 가져오기</a>
                  <a role="menuitem" href="/api/auth/logout" className="danger">로그아웃</a>
                </div>
              )}
            </div>
          </div>
        </div>
        <nav className="tabs" aria-label="보기">
          {TABS.map(([k, label, path]) => (
            <a
              key={k} href={path} aria-current={tab === k ? 'page' : undefined}
              onClick={(e) => { e.preventDefault(); go(k); }}
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      <div className="filters">
        {(tab === 'chart' || tab === 'season') && (
          <Seg options={MODES} value={mode} onChange={setMode} label="종류" />
        )}
        <Picker
          value={src} label={SOURCES.find((s) => s.value === src).label}
          options={SOURCES} onChange={setSrc}
        />
        {calibrated && src !== 'spotify' && (
          <button className="toggle" aria-pressed={estimate} onClick={() => setEstimate((v) => !v)}
                  title="유튜브 기록을 Recap 청취 시간에 맞춰 보정한 추정치">
            유튜브 보정
          </button>
        )}
      </div>

      <main>
        {tab === 'chart' && <Chart {...shared} />}
        {tab === 'season' && <Championship {...shared} year={seasonYear} onYear={setSeasonYear} />}
        {tab === 'replay' && <Replay {...shared} />}
        {tab === 'records' && <Records {...shared} />}
      </main>

      <Detail target={detail} source={src} estimate={estimate && calibrated} onClose={closeDetail} />

      <footer className="foot" />
    </div>
  );
}
