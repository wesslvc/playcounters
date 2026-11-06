'use client';

import { useEffect, useMemo, useState } from 'react';
import { useGenres } from './useGenres';
import { familyLabel, artistColor } from '@/lib/genre';
import { Seg, Section, Cover, Stat } from './ui';

const DAY = 864e5;
const target = (r) => ({ artist: r.artist, track: r.track ?? null, artist_key: r.artist_key, track_key: r.track_key ?? null });

/** Where a song stands in the playlist, in the order they're shown. */
const STATUS = [
  ['core', '단골', '최근 30일 동안 일주일에 두 번 넘게 들은 곡'],
  ['rising', '뜨는 중', '최근 7일이 그 전 3주보다 두 배 넘게 잦아진 곡'],
  ['steady', '가끔', '최근 30일 동안 가끔 들은 곡'],
  ['fading', '식는 중', '그 전 3주엔 자주 들었는데 최근 7일은 3분의 1 아래로 뜸해진 곡'],
  ['asleep', '잠든 곡', '예전엔 들었지만 30일 넘게 안 들은 곡'],
  ['never', '안 들은 곡', '기록상 한 번도 안 들은 곡'],
]

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

/**
 * A donut: one whole split into a few parts, the total in the middle. Hovering
 * a slice (or its legend row) names it in the middle; the rest dim.
 */
function Donut({ parts, unit, label, focus, onFocus, onPick }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = 52;
  const C = 2 * Math.PI * r;
  const gap = parts.length > 1 ? 2.5 : 0;
  const on = parts.find((p) => p.key === focus);
  let at = 0;
  return (
    <svg className="donut" viewBox="0 0 140 140" role="img"
         aria-label={parts.map((p) => `${p.label} ${p.value}${unit}`).join(', ')}>
      <g transform="rotate(-90 70 70)">
        {parts.map((p) => {
          const len = (p.value / Math.max(1, total)) * C;
          const el = (
            <circle
              key={p.key} cx="70" cy="70" r={r} fill="none" stroke={p.color} strokeWidth="20"
              strokeDasharray={`${Math.max(0.5, len - gap)} ${C}`} strokeDashoffset={-at}
              opacity={focus && focus !== p.key ? 0.3 : 1}
              onMouseEnter={() => onFocus(p.key)} onMouseLeave={() => onFocus(null)}
              onClick={() => onPick?.(p.key)}
            >
              <title>{`${p.label} ${p.value}${unit} (${Math.round((p.value / Math.max(1, total)) * 100)}%)`}</title>
            </circle>
          );
          at += len;
          return el;
        })}
      </g>
      <text x="70" y="68" textAnchor="middle" className="donut-v">{on ? on.value : total}</text>
      <text x="70" y="86" textAnchor="middle" className="donut-l">{on ? on.label : label}</text>
    </svg>
  );
}

/** The donut's legend: swatch, name, count and share, and a button when the part has a list. */
function Legend({ parts, unit, focus, onFocus, picked, onPick }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <ul className="legend">
      {parts.map((p) => (
        <li key={p.key}>
          <button
            aria-pressed={picked === p.key || undefined} disabled={!onPick}
            onMouseEnter={() => onFocus(p.key)} onMouseLeave={() => onFocus(null)}
            onClick={() => onPick?.(p.key)} data-dim={(focus && focus !== p.key) || undefined}
          >
            <i style={{ background: p.color }} />
            <span>{p.label}</span>
            <b>{p.value}{unit}</b>
            <em>{Math.round((p.value / Math.max(1, total)) * 100)}%</em>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A month-by-month column of how many songs went in. */
function Months({ months }) {
  const last = months.slice(-18);
  const max = Math.max(1, ...last.map((m) => m.n));
  return (
    <div className="pl-months" role="img" aria-label={last.map((m) => `${m.month} ${m.n}곡`).join(', ')}>
      {last.map((m) => (
        <div key={m.month} className="pl-mo" title={`${Number(m.month.slice(0, 4))}년 ${Number(m.month.slice(5))}월 · ${m.n}곡`}>
          <span className="pl-mo-n">{m.n === max ? m.n : ''}</span>
          <i data-max={m.n === max || undefined} style={{ height: m.n ? `${Math.max(4, (m.n / max) * 100)}%` : 0 }} />
          <span className="pl-mo-x">{m.month.endsWith('-01') ? `${m.month.slice(2, 4)}.1` : Number(m.month.slice(5))}</span>
        </div>
      ))}
    </div>
  );
}

/** A small card for one standout song. */
function Pick({ label, t, value, onSelect }) {
  if (!t) return null;
  return (
    <button className="pl-pick" onClick={() => t.plays > 0 && onSelect(target(t))}>
      <Cover src={t.image} size={52} />
      <span className="pl-pick-k">{label}</span>
      <b>{t.track}</b>
      <span>{t.artist}</span>
      <em>{value}</em>
    </button>
  );
}

/** The analysis of one playlist. */
function Analysis({ id, source, estimate, onSelect, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState(null);
  const [focus, setFocus] = useState(null);
  const [gFocus, setGFocus] = useState(null);

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

  if (error) return error.reauth ? <Reconnect /> : <p className="err">{error.error}</p>;
  if (!data) return <p className="note" style={{ padding: '18px 0' }}>플레이리스트를 불러와 재생 기록과 맞춰 보는 중…</p>;

  const { playlist: pl, summary: s, tracks, artists, mvp, added, races, months } = data;
  const by = (st) => tracks.filter((t) => t.status === st);
  const lists = {
    core: [...by('core')].sort((a, b) => b.plays30 - a.plays30),
    rising: [...by('rising')].sort((a, b) => b.plays7 - a.plays7),
    steady: [...by('steady')].sort((a, b) => b.plays30 - a.plays30),
    fading: [...by('fading')].sort((a, b) => (b.plays30 - b.plays7) - (a.plays30 - a.plays7)),
    asleep: [...by('asleep')].sort((a, b) => Date.parse(a.last_at) - Date.parse(b.last_at)),
    never: [...by('never')],
  };
  const parts = STATUS.filter(([k]) => lists[k].length)
    .map(([k, label]) => ({ key: k, label, value: lists[k].length, color: `var(--st-${k})` }));
  const current = lists[view]?.length ? view : parts[0]?.key;

  // who it's made of: the biggest five artists in their own colours, the rest together
  const songsIn = artists.reduce((x, a) => x + a.songs, 0);
  const restSongs = s.songs - artists.slice(0, 5).reduce((x, a) => x + a.songs, 0);
  const gParts = [
    ...artists.slice(0, 5).map((a) => ({ key: a.artist, label: a.artist, value: a.songs, color: artistColor(a.artist) })),
    ...(restSongs > 0 ? [{ key: 'rest', label: '그 밖의 가수', value: restSongs, color: 'var(--ink-3)' }] : []),
  ];
  // and what they play: each artist's genre family, by songs
  const fam = new Map();
  for (const a of artists) {
    const f = genres[a.artist]?.family;
    if (f) fam.set(f, (fam.get(f) ?? 0) + a.songs);
  }
  const famLine = [...fam].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, n]) => `${familyLabel(f)} ${n}곡`).join(' · ');
  const maxSongs = Math.max(1, ...artists.map((a) => a.songs));
  const firstMet = added.met + added.known ? Math.round((added.met / (added.met + added.known)) * 100) : null;

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
        <Stat value={`${s.over300}곡`} label="300회 넘게 들은 곡" sub={s.over500 ? `500회 이상 ${s.over500}곡` : `통산 ${s.plays.toLocaleString()}회`} />
      </div>

      <Section title="곡 상태" sub="최근 30일·7일 재생으로 나눴어요" />
      <div className="pl-split">
        <Donut parts={parts} unit="곡" label="곡" focus={focus} onFocus={setFocus} onPick={setView} />
        <Legend parts={parts} unit="곡" focus={focus} onFocus={setFocus} picked={current} onPick={setView} />
      </div>
      <p className="pl-sub">{STATUS.find(([k]) => k === current)?.[2]}</p>
      <ol className="ranks">
        {(lists[current] ?? []).slice(0, 30).map((t, i) => (
          current === 'asleep'
            ? <SongRow key={t.track + t.artist} n={i + 1} t={t} value={daysAgo(t.last_at)} unit="일째" note={`통산 ${t.plays}회`} onSelect={onSelect} />
            : current === 'never'
              ? <SongRow key={t.track + t.artist} n={i + 1} t={t} value="–" unit="" note={t.added_at ? `${ymd(t.added_at)} 추가` : null} onSelect={onSelect} />
              : current === 'rising' || current === 'fading'
                ? <SongRow key={t.track + t.artist} n={i + 1} t={t} value={t.plays7} unit="회/7일" note={`그 전 3주 ${t.plays30 - t.plays7}회`} onSelect={onSelect} />
                : <SongRow key={t.track + t.artist} n={i + 1} t={t} value={t.plays30} unit="회/30일" note={`통산 ${t.plays}회`} onSelect={onSelect} />
        ))}
      </ol>

      <Section title="이 플리의 MVP" />
      <div className="pl-picks">
        <Pick label="통산 최다" t={mvp.allTime} value={`${mvp.allTime?.plays.toLocaleString()}회`} onSelect={onSelect} />
        <Pick label="이번 달 최다" t={mvp.month?.plays30 ? mvp.month : null} value={`30일 ${mvp.month?.plays30}회`} onSelect={onSelect} />
        <Pick label="넣은 뒤 최다" t={mvp.sinceAdded} value={`넣고 나서 ${mvp.sinceAdded?.sinceAdded}회`} onSelect={onSelect} />
      </div>

      <Section
        title="넣은 뒤"
        sub={firstMet != null ? `${firstMet}%는 이 플리에 넣으면서 처음 들은 곡 · 나머지는 원래 알던 곡` : '플리에 넣은 뒤의 재생'}
      />
      {added.settled > 0 && (
        <p className="pl-line">
          넣은 지 2주 넘은 {added.settled}곡 중 <b>{added.untouchedCount}곡</b>은 넣고 나서 한 번도 안 들었어요
        </p>
      )}
      {added.untouched.length > 0 && (
        <ol className="ranks">
          {added.untouched.map((t, i) => (
            <SongRow key={t.track + t.artist} n={i + 1} t={t} value={daysAgo(t.added_at)} unit="일 전 추가" note={t.plays ? `그 전에 ${t.plays}회` : '들은 적 없음'} onSelect={onSelect} />
          ))}
        </ol>
      )}

      {races.songs.length > 0 && (
        <>
          <Section title="그랑프리 기록" sub={`월간 그랑프리 우승곡 ${races.winners}곡 · 포디움에 오른 곡 ${races.podiumSongs}곡`} />
          <ol className="ranks">
            {races.songs.map((c, i) => (
              <li key={`${c.artist_key}-${c.track_key}`}>
                <button className="row" onClick={() => onSelect(target(c))}>
                  <span className="rk">{i + 1}</span>
                  <Cover src={c.image} size={44} />
                  <span className="nm"><b>{c.track}</b><span>{c.artist} · 포디움 {c.podiums}회 · {c.points}pt</span></span>
                  <span className="val">{c.wins}<small>승</small></span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}

      <Section title="구성" sub={famLine ? `${famLine} (상위 가수 ${songsIn}곡 기준)` : '가수별 곡 수 · 장르를 불러오는 중이에요'} />
      {gParts.length > 0 && (
        <div className="pl-split">
          <Donut parts={gParts} unit="곡" label="곡" focus={gFocus} onFocus={setGFocus} />
          <Legend parts={gParts} unit="곡" focus={gFocus} onFocus={setGFocus} />
        </div>
      )}
      <ol className="pl-artists">
        {artists.map((a) => (
          <li key={a.artist}>
            <span className="pl-an">{a.artist}</span>
            <span className="pl-ab"><i style={{ width: `${(a.songs / maxSongs) * 100}%`, background: artistColor(a.artist) }} /></span>
            <span className="pl-av">{a.songs}곡<small>{a.plays30 ? ` · 30일 ${a.plays30}회` : ''}</small></span>
          </li>
        ))}
      </ol>

      {months.length > 1 && (
        <>
          <Section title="추가 시기" sub="달마다 넣은 곡 수" />
          <Months months={months} />
        </>
      )}
    </>
  );
}


/**
 * Your Spotify playlists, each read against what you actually play: which
 * songs carry it, which are rising or going quiet, which you never play, how
 * songs fared after going in, its Grand Prix record, who it's made of, and
 * when it grew.
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
