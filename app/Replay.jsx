'use client';

import { useEffect, useMemo, useState } from 'react';
import { artistLine, useCredits } from './useCredits';
import { useGenres, seedGenres } from './useGenres';
import { useCovers, coverOf } from './useCovers';
import { familyLabel } from '@/lib/genre';
import { Seg, Section, Cover, Stat, Delta, dayLabel } from './ui';

const KST = 9 * 3600e3;
const Q_MONTHS = { 1: '1–3월', 2: '4–6월', 3: '7–9월', 4: '10–12월' };

/** Every quarter that holds plays, newest first, from the calendar. */
function quartersOf(calendar) {
  const m = new Map();
  for (const c of calendar ?? []) {
    const y = Number(c.day.slice(0, 4));
    const q = Math.ceil(Number(c.day.slice(5, 7)) / 3);
    const k = `${y}-${q}`;
    m.set(k, { y, q, plays: (m.get(k)?.plays ?? 0) + Number(c.plays) });
  }
  return [...m.values()].sort((a, b) => b.y - a.y || b.q - a.q);
}

const target = (r) => ({ artist: r.artist, track: r.track ?? null, artist_key: r.artist_key, track_key: r.track_key ?? null });

/**
 * Save the top songs as a Spotify playlist, or copy them as text for any
 * other service. The playlist needs a permission older logins don't have;
 * the server says so and the button turns into a reconnect.
 */
function Export({ tracks, year, q }) {
  const [n, setN] = useState(25);
  const [state, setState] = useState(null);
  const pick = tracks.slice(0, n);

  async function save() {
    setState({ busy: true });
    try {
      const res = await fetch('/api/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Replay ${year} Q${q}`,
          description: `${year}년 ${q}분기 가장 많이 들은 ${pick.length}곡 · playcounters`,
          items: pick.map((t) => ({ artist: t.artist, track: t.track })),
        }),
      });
      const j = await res.json();
      if (j.reauth) return setState({ reauth: true });
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setState({ done: j });
    } catch (e) {
      setState({ error: e.message });
    }
  }

  async function copy() {
    const text = pick.map((t, i) => `${i + 1}. ${t.track} — ${artistLine(t)}`).join('\n');
    try {
      await navigator.clipboard.writeText(`Replay ${year} Q${q}\n\n${text}`);
      setState({ copied: true });
    } catch {
      setState({ error: '복사하지 못했습니다.' });
    }
  }

  return (
    <div className="export">
      <div className="export-row">
        <Seg size="sm" label="곡 수" options={[[25, '25곡'], [50, '50곡'], [100, '100곡']]} value={n}
             onChange={(v) => { setN(v); setState(null); }} />
        <div className="export-btns">
          <button className="btn" onClick={save} disabled={state?.busy || !pick.length}>
            {state?.busy ? '만드는 중…' : 'Spotify에 저장'}
          </button>
          <button className="btn ghost" onClick={copy} disabled={!pick.length}>목록 복사</button>
        </div>
      </div>
      {state?.done && (
        <p className="export-msg">
          {state.done.added}곡 저장됨 ·{' '}
          <a href={state.done.url} target="_blank" rel="noreferrer">Spotify에서 열기</a>
          {state.done.missing?.length > 0 && <span> · {state.done.missing.length}곡 못 찾음</span>}
        </p>
      )}
      {state?.reauth && (
        <p className="export-msg">
          권한이 필요해요 · <a href="/api/auth/login">Spotify 다시 연결</a>
        </p>
      )}
      {state?.copied && <p className="export-msg">{pick.length}곡 복사됨</p>}
      {state?.error && <p className="export-msg err">{state.error}</p>}
    </div>
  );
}

/**
 * Replay, three months at a time: the quarter's top songs, artists and
 * albums, what was new in it, each month's number one — and the songs
 * ready to take away as a playlist.
 */
export default function Replay({ source, estimate, calendar, version, onSelect }) {
  const quarters = useMemo(() => quartersOf(calendar), [calendar]);
  const [pick, setPick] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [shown, setShown] = useState(10);

  useEffect(() => {
    if (quarters.length && !quarters.some((x) => pick && x.y === pick.y && x.q === pick.q)) setPick(quarters[0]);
  }, [quarters, pick]);

  useEffect(() => {
    if (!pick) return;
    const ctl = new AbortController();
    setData(null);
    setError(null);
    setShown(10);
    const qs = new URLSearchParams({ year: String(pick.y), q: String(pick.q), source });
    if (estimate) qs.set('estimate', '1');
    fetch(`/api/replay?${qs}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); seedGenres(j.genres); setData(j); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [pick, source, estimate, version]);

  const tracks = useMemo(() => data?.tracks ?? [], [data]);
  const artists = useMemo(() => data?.artists ?? [], [data]);
  const coverRows = useMemo(() => (data
    ? [...tracks.slice(0, shown), ...data.albums, ...data.months.map((m) => m.top).filter(Boolean), ...data.debuts.top]
    : null), [data, tracks, shown]);
  const topArtists = useMemo(() => (data ? artists.slice(0, 10) : null), [data, artists]);
  const creditRows = useMemo(() => (data ? tracks.slice(0, 100) : null), [data, tracks]);
  const artistNames = useMemo(() => topArtists?.map((a) => a.artist) ?? null, [topArtists]);
  const songCovers = useCovers('tracks', coverRows);
  const artistCovers = useCovers('artists', topArtists);
  useCredits(creditRows);
  const genres = useGenres(artistNames);

  const topGenre = useMemo(() => {
    const by = new Map();
    for (const a of artists) {
      const f = genres[a.artist]?.family;
      if (!f || f === 'other') continue;
      by.set(f, (by.get(f) ?? 0) + Number(a.plays));
    }
    const best = [...by].sort((a, b) => b[1] - a[1])[0];
    return best ? familyLabel(best[0]) : null;
  }, [artists, genres]);

  if (!quarters.length) return <div className="skeleton"><i /><i /><i /></div>;

  const now = new Date(Date.now() + KST);
  const isLive = (x) => x.y === now.getUTCFullYear() && x.q === Math.ceil((now.getUTCMonth() + 1) / 3);
  const s = data?.summary;
  const no1 = tracks[0];
  const heroImg = coverOf(songCovers, 'tracks', no1);
  const prevComplete = data && Object.keys(data.prevRank).length < 200;

  return (
    <section className="view replay">
      <div className="quarters" role="tablist" aria-label="분기">
        {quarters.map((x) => (
          <button key={`${x.y}-${x.q}`} role="tab" aria-selected={pick?.y === x.y && pick?.q === x.q}
                  onClick={() => setPick(x)}>
            <b>{x.y} Q{x.q}</b>
            <span>{isLive(x) ? '진행 중' : Q_MONTHS[x.q]}</span>
          </button>
        ))}
      </div>

      {error && <p className="err">{error}</p>}
      {!error && !data && <div className="skeleton tall"><i /><i /><i /></div>}

      {data && (
        <>
          <div className="replay-hero">
            <span className="replay-bg" style={heroImg ? { backgroundImage: `url(${heroImg})` } : undefined} aria-hidden="true" />
            <div className="replay-in">
              <p className="replay-k">Replay · {data.year}년 {Q_MONTHS[data.q]}{data.live ? ' · 진행 중' : ''}</p>
              <h1>{data.year}<span> Q{data.q}</span></h1>
              <p className="replay-big">
                <b>{Math.round(s.minutes / 60).toLocaleString()}</b>시간
              </p>
              <div className="stats on-dark">
                <Stat value={`${estimate ? '≈' : ''}${s.plays.toLocaleString()}`} label="재생" />
                <Stat value={s.tracks.toLocaleString()} label="곡" />
                <Stat value={s.artists?.toLocaleString() ?? '—'} label="가수" />
                <Stat value={`${s.days}`} label={`들은 날 / ${s.span}일`} />
              </div>
            </div>
          </div>

          {no1 && (
            <button className="replay-no1" onClick={() => onSelect(target(no1))}>
              <Cover src={heroImg} size={168} />
              <span>
                <em>이번 분기의 노래</em>
                <b>{no1.track}</b>
                <span>{artistLine(no1)}</span>
                <i>{Number(no1.plays).toLocaleString()}회 · {no1.days}일</i>
              </span>
            </button>
          )}

          <Section title="Top Songs" />
          <Export tracks={tracks} year={data.year} q={data.q} />
          <ol className="ranks">
            {tracks.slice(0, shown).map((t, i) => {
              const before = data.prevRank[`${t.artist_key}\u0000${t.track_key}`];
              const delta = before != null ? before - (i + 1) : prevComplete ? undefined : null;
              return (
                <li key={`${t.artist_key}-${t.track_key}`}>
                  <button className="row" onClick={() => onSelect(target(t))}>
                    <span className="rk" data-top={i < 3 || undefined}>{i + 1}</span>
                    <Cover src={coverOf(songCovers, 'tracks', t)} size={44} />
                    <span className="nm"><b>{t.track}</b><span>{artistLine(t)}</span></span>
                    <span className="val">{Number(t.plays).toLocaleString()}<small>회</small><Delta value={delta} /></span>
                  </button>
                </li>
              );
            })}
          </ol>
          {tracks.length > shown && (
            <div className="more">
              <button className="btn ghost" onClick={() => setShown((n) => Math.min(n + 15, 100))}>더 보기</button>
            </div>
          )}

          {artists.length > 0 && (
            <>
              <Section title="Top Artists" sub={topGenre} />
              <div className="artist-grid">
                {artists.slice(0, 10).map((a, i) => (
                  <button key={a.artist_key} className={i === 0 ? 'artist-tile first' : 'artist-tile'}
                          onClick={() => onSelect(target(a))}>
                    <Cover src={coverOf(artistCovers, 'artists', a)} size={i === 0 ? 132 : 76} round />
                    <span className="artist-rk">{i + 1}</span>
                    <b>{a.artist}</b>
                    <span>{Number(a.plays).toLocaleString()}회</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {data.albums.length > 0 && (
            <>
              <Section title="Top Albums" />
              <div className="album-row">
                {data.albums.map((a, i) => (
                  <div key={`${a.artist_key}-${a.album}`} className="album">
                    <Cover src={coverOf(songCovers, 'tracks', a)} size={132} />
                    <span className="album-rk">{i + 1}</span>
                    <b>{a.album}</b>
                    <span>{a.artist} · {a.plays.toLocaleString()}회</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <Section title="Month by Month" />
          <div className="months3">
            {data.months.map((m) => (
              <button key={m.month} className="month-card" disabled={!m.top} onClick={() => m.top && onSelect(target(m.top))}>
                <span className="month-k">{m.month}월</span>
                <Cover src={m.top ? coverOf(songCovers, 'tracks', m.top) : null} size={64} />
                <b>{m.top?.track ?? '—'}</b>
                <span>{m.top ? `${m.top.artist} · ${Number(m.top.plays).toLocaleString()}회` : '아직 기록 없음'}</span>
              </button>
            ))}
          </div>

          <Section title="Discoveries" />
          <div className="discover">
            <div className="discover-big">
              <Stat value={data.debuts.total.toLocaleString()} label="새로 들은 곡" />
              <Stat value={data.debuts.artists.toLocaleString()} label="새로 만난 가수" />
              {s.busiest && <Stat value={`${s.busiest.plays}회`} label="가장 많이 들은 날" sub={dayLabel(s.busiest.day)} />}
            </div>
            {data.debuts.top.length > 0 && (
              <ol className="ranks compact">
                {data.debuts.top.map((t, i) => (
                  <li key={`${t.artist_key}-${t.track_key}`}>
                    <button className="row" onClick={() => onSelect(target(t))}>
                      <span className="rk">{i + 1}</span>
                      <Cover src={coverOf(songCovers, 'tracks', t)} size={40} />
                      <span className="nm"><b>{t.track}</b><span>{t.artist} · {dayLabel(new Date(new Date(t.first_at).getTime() + KST).toISOString())} 처음</span></span>
                      <span className="val">{Number(t.plays).toLocaleString()}<small>회</small></span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </section>
  );
}
