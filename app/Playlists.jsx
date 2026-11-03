'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCovers, coverOf } from './useCovers';
import { useGenres } from './useGenres';
import { familyLabel } from '@/lib/genre';
import { Seg, Section, Cover, Stat } from './ui';

const DAY = 864e5;
const target = (r) => ({ artist: r.artist, track: r.track ?? null, artist_key: r.artist_key, track_key: r.track_key ?? null });

/** Where a song stands in the playlist, in the order they're shown. */
const STATUS = [
  ['core', '단골', '이번 달 가장 많이 듣는 곡'],
  ['rising', '뜨는 중', '최근 일주일에 부쩍 많이 들음'],
  ['steady', '꾸준', '가끔씩 계속 들음'],
  ['fading', '식는 중', '이번 달엔 들었지만 최근 일주일은 뜸함'],
  ['asleep', '잠든 곡', '예전엔 들었지만 30일 넘게 안 들음'],
  ['never', '안 들은 곡', '기록상 한 번도 안 들음'],
];

const daysAgo = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY)) : null);
const ymd = (iso) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '');

/** Asks to reconnect Spotify when the login predates playlist reading. */
function Reconnect() {
  return (
    <div className="pl-note">
      <b>Spotify를 다시 연결해 주세요</b>
      <p>플레이리스트를 읽으려면 권한이 하나 더 필요해요. 한 번만 다시 연결하면 돼요.</p>
      <a className="btn" href="/api/auth/login">Spotify 다시 연결</a>
    </div>
  );
}

/** One song row: cover, title, and the figure that matters for its section. */
function SongRow({ n, t, value, unit, note, onSelect }) {
  return (
    <li>
      <button className="row" onClick={() => t.plays > 0 && onSelect(target(t))} disabled={!(t.plays > 0)}>
        <span className="rk">{n}</span>
        <Cover src={t.image} size={44} />
        <span className="nm"><b>{t.track}</b><span>{t.artists?.join(', ') ?? t.artist}{note ? ` · ${note}` : ''}</span></span>
        <span className="val">{value}<small>{unit}</small></span>
      </button>
    </li>
  );
}

/** The analysis of one playlist. */
function Analysis({ id, source, estimate, onSelect, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState('core');

  useEffect(() => {
    const ctl = new AbortController();
    setData(null);
    setError(null);
    const qs = new URLSearchParams({ source });
    if (estimate) qs.set('estimate', '1');
    fetch(`/api/playlists/${encodeURIComponent(id)}?${qs}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => (j.error ? setError(j) : setData(j)))
      .catch((e) => { if (e.name !== 'AbortError') setError({ error: e.message }); });
    return () => ctl.abort();
  }, [id, source, estimate]);

  const names = useMemo(() => (data?.artists ?? []).map((a) => a.artist), [data]);
  const genres = useGenres(names);
  const missingCovers = useCovers('tracks', data?.missing?.length ? data.missing : null);

  if (error) return error.reauth ? <Reconnect /> : <p className="err">{error.error}</p>;
  if (!data) return <p className="note" style={{ padding: '18px 0' }}>플레이리스트를 불러와 재생 기록과 맞춰 보는 중…</p>;

  const { playlist: pl, summary: s, tracks, artists, missing } = data;
  const by = (st) => tracks.filter((t) => t.status === st);
  const lists = {
    core: [...by('core')].sort((a, b) => b.plays30 - a.plays30),
    rising: [...by('rising')].sort((a, b) => b.plays7 - a.plays7),
    steady: [...by('steady')].sort((a, b) => b.plays30 - a.plays30),
    fading: [...by('fading')].sort((a, b) => b.plays30 - a.plays30),
    asleep: [...by('asleep')].sort((a, b) => Date.parse(a.last_at) - Date.parse(b.last_at)),
    never: [...by('never')],
  };
  const shown = STATUS.filter(([k]) => lists[k].length);
  const current = lists[view]?.length ? view : shown[0]?.[0];
  const familyCount = new Map();
  for (const a of artists) {
    const f = genres[a.artist]?.family;
    if (f) familyCount.set(f, (familyCount.get(f) ?? 0) + a.songs);
  }
  const families = [...familyCount].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const maxSongs = Math.max(1, ...artists.map((a) => a.songs));

  return (
    <>
      <button className="pl-back" onClick={onBack}>‹ 플레이리스트</button>
      <div className="pl-head">
        <Cover src={pl.image} size={96} />
        <div>
          <h1>{pl.name}</h1>
          <p>{[pl.owner, `${s.songs}곡`, s.firstAdded && `${ymd(s.firstAdded)} ~ ${ymd(s.lastAdded)} 추가`].filter(Boolean).join(' · ')}</p>
          <a href={pl.url} target="_blank" rel="noreferrer">Spotify에서 열기 ↗</a>
        </div>
      </div>

      <div className="stats compact">
        <Stat value={`${s.played}/${s.songs}`} label="들어본 곡" sub={`${Math.round((s.played / Math.max(1, s.songs)) * 100)}%`} />
        <Stat value={`${s.active}곡`} label="이번 달 들은 곡" sub={`최근 30일 ${s.plays30.toLocaleString()}회`} />
        <Stat value={`${s.top5Share}%`} label="TOP 5 집중도" sub="이번 달 재생 중 상위 5곡 비중" />
        <Stat value={s.plays.toLocaleString()} label="통산 재생" />
      </div>

      <Section title="곡 상태" sub="최근 30일·7일 재생으로 나눴어요" />
      <div className="pl-bar" role="img" aria-label="곡 상태 비율">
        {shown.map(([k]) => <i key={k} data-st={k} style={{ flexGrow: lists[k].length }} />)}
      </div>
      <div className="pl-legend">
        {shown.map(([k, label]) => (
          <button key={k} className="chip" aria-pressed={current === k} onClick={() => setView(k)}>
            <i data-st={k} />{label} {lists[k].length}
          </button>
        ))}
      </div>
      <p className="pl-sub">{STATUS.find(([k]) => k === current)?.[2]}</p>
      <ol className="ranks">
        {(lists[current] ?? []).slice(0, 30).map((t, i) => (
          current === 'asleep'
            ? <SongRow key={t.track + t.artist} n={i + 1} t={t} value={daysAgo(t.last_at)} unit="일째" note={`통산 ${t.plays}회`} onSelect={onSelect} />
            : current === 'never'
              ? <SongRow key={t.track + t.artist} n={i + 1} t={t} value="–" unit="" note={t.added_at ? `${ymd(t.added_at)} 추가` : null} onSelect={onSelect} />
              : current === 'rising'
                ? <SongRow key={t.track + t.artist} n={i + 1} t={t} value={t.plays7} unit="회/7일" note={`30일 ${t.plays30}회`} onSelect={onSelect} />
                : <SongRow key={t.track + t.artist} n={i + 1} t={t} value={t.plays30} unit="회/30일" note={`통산 ${t.plays}회`} onSelect={onSelect} />
        ))}
      </ol>

      <Section title="구성" sub={families.length ? families.map(([f, n]) => `${familyLabel(f)} ${n}곡`).join(' · ') : '가수별 곡 수'} />
      <ol className="pl-artists">
        {artists.map((a) => (
          <li key={a.artist}>
            <span className="pl-an">{a.artist}</span>
            <span className="pl-ab"><i style={{ width: `${(a.songs / maxSongs) * 100}%` }} /></span>
            <span className="pl-av">{a.songs}곡<small>{a.plays30 ? ` · 30일 ${a.plays30}회` : ''}</small></span>
          </li>
        ))}
      </ol>

      {missing.length > 0 && (
        <>
          <Section title="자주 듣는데 없는 곡" sub="최근 30일 많이 들었지만 이 플리엔 없어요" />
          <ol className="ranks">
            {missing.map((m, i) => (
              <li key={`${m.artist_key}-${m.track_key}`}>
                <button className="row" onClick={() => onSelect(target(m))}>
                  <span className="rk">{i + 1}</span>
                  <Cover src={coverOf(missingCovers, 'tracks', m)} size={44} />
                  <span className="nm"><b>{m.track}</b><span>{m.artist}</span></span>
                  <span className="val">{m.plays30}<small>회/30일</small></span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

/**
 * Your Spotify playlists, each read against what you actually play: which
 * songs carry it, which are rising or going quiet, which you never play, who
 * it's made of, and what you play a lot that isn't in it.
 */
export default function Playlists({ source, estimate, onSelect, onContext }) {
  const [lists, setLists] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [whose, setWhose] = useState('mine');

  useEffect(() => { onContext?.(null); }, [onContext]);
  useEffect(() => {
    const ctl = new AbortController();
    fetch('/api/playlists', { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => (j.error ? setError(j) : setLists(j.playlists)))
      .catch((e) => { if (e.name !== 'AbortError') setError({ error: e.message }); });
    return () => ctl.abort();
  }, []);

  if (open) return <Analysis id={open} source={source} estimate={estimate} onSelect={onSelect} onBack={() => setOpen(null)} />;
  if (error) return error.reauth ? <Reconnect /> : <p className="err">{error.error}</p>;
  if (!lists) return <p className="note" style={{ padding: '18px 0' }}>Spotify 플레이리스트 불러오는 중…</p>;

  const shown = lists.filter((p) => (whose === 'mine' ? p.mine : !p.mine));
  return (
    <>
      <Section title="플레이리스트" sub="골라서 실제 재생 기록과 맞춰 보세요">
        <Seg size="sm" label="플리 종류" options={[['mine', '내 플리'], ['others', '팔로우']]} value={whose} onChange={setWhose} />
      </Section>
      {shown.length ? (
        <div className="pl-grid">
          {shown.map((p) => (
            <button key={p.id} className="pl-card" onClick={() => setOpen(p.id)}>
              <Cover src={p.image} size={140} />
              <b>{p.name}</b>
              <span>{[p.count != null && `${p.count}곡`, !p.mine && p.owner].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      ) : <p className="note">{whose === 'mine' ? '만든 플레이리스트가 없어요.' : '팔로우한 플레이리스트가 없어요.'}</p>}
    </>
  );
}
