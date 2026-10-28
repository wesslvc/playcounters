'use client';

import { useEffect, useMemo, useState } from 'react';
import { AWARD_GROUPS, gpRecords, formatValue } from '@/lib/awards';
import { artistLine, useCredits } from './useCredits';
import { useCovers, coverOf } from './useCovers';
import { useElite } from './useElite';
import { loadCareer, loadRecords } from './data';
import { Cover, Stat, dayLabel } from './ui';

const ym = (d) => {
  const [y, m] = String(d).split('-');
  return `${y}년 ${Number(m)}월`;
};

/** When a record was set: a day, a span of days, or a span of months. */
function when(def, h) {
  if (!h.from || h.to === null) return null;
  if (def.month) {
    const a = ym(h.from);
    const b = h.to ? ym(h.to) : a;
    return a === b ? a : `${a} – ${b}`;
  }
  if (!h.to || h.from === h.to) return dayLabel(h.from);
  return `${dayLabel(h.from)} – ${dayLabel(h.to)}`;
}

/** "2026.1.3 20:21" — the same, short enough for a list row. */
const reachedShort = (at) => {
  if (!at) return null;
  const [y, m, d] = String(at).slice(0, 10).split('-');
  return `${y}.${Number(m)}.${Number(d)} ${String(at).slice(11, 16)}`;
};

const target = (h) => ({ artist: h.artist, track: h.track ?? null, artist_key: h.artist_key, track_key: h.track_key ?? null });

const SHARE_SHOWN = 8;

/**
 * What an artist's plays were, song by song: one bar split by
 * the biggest songs, then each song with its share. Fetched when opened.
 */
function SongShare({ artistKey, source, estimate }) {
  const [songs, setSongs] = useState(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    const qs = new URLSearchParams({ artist_key: artistKey, source });
    if (estimate) qs.set('estimate', '1');
    fetch(`/api/club/songs?${qs}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); setSongs(j.songs); })
      .catch((e) => { if (e.name !== 'AbortError') setSongs({ error: e.message }); });
    return () => ctl.abort();
  }, [artistKey, source, estimate]);

  if (!songs) return <div className="share"><div className="skeleton"><i /></div></div>;
  if (songs.error) return <p className="err">{songs.error}</p>;
  const top = songs.slice(0, 5);
  const restPct = Math.max(0, 100 - top.reduce((s, x) => s + x.pct, 0));
  const max = songs[0]?.pct || 1;
  const shown = all ? songs : songs.slice(0, SHARE_SHOWN);
  return (
    <div className="share">
      <div className="share-bar" aria-hidden="true">
        {top.map((s, i) => <i key={i} style={{ width: `${s.pct}%` }} data-i={i} />)}
        {restPct > 0 && <i style={{ width: `${restPct}%` }} data-i="rest" />}
      </div>
      <ol className="share-list">
        {shown.map((s, i) => (
          <li key={i}>
            <span className="share-dot" data-i={i < 5 ? i : 'rest'} />
            <span className="share-nm">{s.track}</span>
            <span className="share-meter"><i style={{ width: `${(s.pct / max) * 100}%` }} /></span>
            <b>{s.pct}%</b>
            <small>{s.plays.toLocaleString()}회</small>
          </li>
        ))}
      </ol>
      {songs.length > shown.length && (
        <button className="linkish share-more" onClick={() => setAll(true)}>나머지 {songs.length - shown.length}곡</button>
      )}
    </div>
  );
}

/**
 * One category: the holder up front, the next two under it. A 1000 Club card
 * lists everyone who got there, each with their picture and the minute they
 * entered.
 */
function Award({ def, list, covers, onSelect, club, source, estimate, elite }) {
  const [first, ...rest] = list ?? [];
  const mode = (h) => (h.track ? 'tracks' : 'artists');
  // A split record's figure opens the holder's breakdown instead of the sheet.
  const [open, setOpen] = useState(null);
  // a long list (a club's every member) shows five until asked for the rest
  const [all, setAll] = useState(false);
  const FIRST = 4;
  const shownRest = all ? rest : rest.slice(0, FIRST);
  const toggle = (h) => setOpen((k) => (k === h.artist_key ? null : h.artist_key));
  const splitV = (h, className) => {
    const v = formatValue(def, h.value);
    return (
      <button className={`${className} split-v`} aria-expanded={open === h.artist_key} onClick={() => toggle(h)}>
        {v.v}<small>{v.unit}</small><span className="split-caret" aria-hidden="true" />
      </button>
    );
  };
  const share = (h) => open === h.artist_key
    && <SongShare artistKey={h.artist_key} source={source} estimate={estimate} />;
  return (
    <article className={`award${club ? ' club' : ''}`} data-key={def.key}>
      <header>
        <h3 title={def.note}>{def.title}{def.tag && <span className="award-tag">{def.tag}</span>}</h3>
      </header>
      {first ? (
        <>
          <div className={def.split ? 'award-split' : undefined}>
            <button className={`award-holder${elite(first) ? ` ring ${elite(first)}` : ''}`} onClick={() => onSelect(target(first))}>
              <Cover src={coverOf(covers[mode(first)], mode(first), first)} size={60} round={!first.track} />
              <span className="award-nm">
                <b>{first.track ?? first.artist}</b>
                {first.track && <span>{artistLine(first)}</span>}
              </span>
              {!def.split && (
                <span className="award-v">
                  {formatValue(def, first.value).v}<small>{formatValue(def, first.value).unit}</small>
                </span>
              )}
            </button>
            {def.split && splitV(first, 'award-v')}
          </div>
          {share(first)}
          {!club && <p className="award-when">{when(def, first)}</p>}
          {rest.length > 0 && (
            <ol className="award-rest">
              {shownRest.map((h, i) => (
                <li key={i} className={def.split ? 'rest-split' : undefined}>
                  <button className={elite(h) ? `ring ${elite(h)}` : undefined} onClick={() => onSelect(target(h))}>
                    <span className="award-place">{i + 2}</span>
                    {club && <Cover src={coverOf(covers.artists, 'artists', h)} size={34} round />}
                    <span className="award-rest-nm">
                      {h.track ?? h.artist}{h.track && <em> · {artistLine(h)}</em>}
                    </span>
                    {!def.split && (
                      <span className="award-rest-v">{formatValue(def, h.value).v}{formatValue(def, h.value).unit}</span>
                    )}
                  </button>
                  {def.split && splitV(h, 'award-rest-v')}
                  {share(h)}
                </li>
              ))}
            </ol>
          )}
          {rest.length > shownRest.length && (
            <button className="linkish award-more" onClick={() => setAll(true)}>
              나머지 {rest.length - shownRest.length}{first.track ? '곡' : '팀'} 펼치기
            </button>
          )}
        </>
      ) : (
        <p className="award-none">아직 해당하는 기록이 없습니다.</p>
      )}
    </article>
  );
}

/**
 * A club in the app's own plain vocabulary: its newest member in the card a
 * Replay quarter uses for its song, then every member in the order they got
 * in, as rows of the ranking list. `ring` marks the members who've gone far
 * past the bar by framing their row in slate blue, and nothing else.
 */
function Club({ mode, members, covers, onSelect, kicker, when, sub, short, lead, ring, fresh }) {
  const latest = members[members.length - 1];
  const name = (h) => (mode === 'tracks' ? h.track : h.artist);
  const pic = (h) => coverOf(covers[mode], mode, h);
  const round = mode === 'artists';
  return (
    <div className="club">
      <button className={`replay-no1 club-lead${ring(latest) ? ` ring ${ring(latest)}` : ''}`} onClick={() => onSelect(target(latest))}>
        <Cover src={pic(latest)} size={168} round={round} />
        <span>
          <em>{kicker}</em>
          <b>{name(latest)}</b>
          {mode === 'tracks' && <span>{artistLine(latest)}</span>}
          <span className="club-when">{when(latest)}</span>
          <i>{members.length}번째 · {lead(latest)}</i>
        </span>
      </button>
      <ol className="ranks club-ranks">
        {members.map((h, i) => (
          <li key={`${h.artist_key}\u0000${h.track_key ?? ''}`}>
            <button className={`row${ring(h) ? ` ring ${ring(h)}` : ''}`} onClick={() => onSelect(target(h))}>
              <span className="rk">{i + 1}</span>
              <Cover src={pic(h)} size={44} round={round} />
              <span className="nm">
                <b>{name(h)}</b>
                <span>{sub(h)}</span>
              </span>
              <span className="val">
                {short(h)}
                {fresh?.(h) && <span className="delta new">NEW</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

const shortDay = (d) => {
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${y}.${Number(m)}.${Number(dd)}`;
};

/** The 1000 Club: every artist past a thousand plays, by when they got there. */
function ClubBanner({ def, list, covers, onSelect, elite }) {
  if (!list?.length) return null;
  const members = [...list].sort((a, b) => String(a.reached_at).localeCompare(String(b.reached_at)));
  const took = (h) => { const v = formatValue(def, h.value); return `${v.v}${v.unit} 만에`; };
  return (
    <Club mode="artists" members={members} covers={covers} onSelect={onSelect}
          kicker="최근 1000회 달성"
          when={(h) => `${dayLabel(h.reached_at)} ${String(h.reached_at).slice(11, 16)}`}
          lead={(h) => `${took(h)}${h.plays != null ? ` · 총 ${Number(h.plays).toLocaleString()}회` : ''}`}
          sub={took}
          short={(h) => reachedShort(h.reached_at)}
          ring={elite} />
  );
}

/** The 100 Club: every song past a hundred plays, by the day it got there. */
function ClubRoster({ def, list, covers, onSelect, elite }) {
  if (!list?.length) return <p className="award-none">아직 100회를 넘긴 곡이 없습니다.</p>;
  // the same day goes by who got there faster
  const members = [...list].sort((a, b) => String(a.to).localeCompare(String(b.to)) || a.value - b.value);
  const took = (h) => { const v = formatValue(def, h.value); return `${v.v}${v.unit} 만에`; };
  return (
    <Club mode="tracks" members={members} covers={covers} onSelect={onSelect}
          kicker="최근 100회 달성"
          when={(h) => dayLabel(h.to)}
          lead={took}
          sub={(h) => `${artistLine(h)} · ${took(h)}`}
          short={(h) => shortDay(h.to)}
          ring={elite}
          fresh={(h) => Date.now() - new Date(String(h.to).slice(0, 10)).getTime() < 30 * 864e5} />
  );
}

/**
 * The record book: every category's holder and the two behind them —
 * dominance (who owned the days, weeks and months), velocity (how fast a
 * song got to fifty or a hundred), endurance, the Grand Prix, and artists.
 * The listening records come from one query over all of history; the Grand
 * Prix ones from the all-time championship.
 */
export default function Records({ source, estimate, version, onSelect }) {
  // one group at a time, the 1000 Club first, rather than one long scroll
  const [group, setGroup] = useState(AWARD_GROUPS[0].key);
  const elite = useElite(source, estimate);
  const [plays, setPlays] = useState(null);
  const [career, setCareer] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setPlays(null);
    setError(null);
    loadRecords(source, estimate).then((j) => live && setPlays(j.records)).catch((e) => live && setError(e.message));
    loadCareer(source, estimate).then((j) => live && setCareer(j)).catch(() => live && setCareer({}));
    return () => { live = false; };
  }, [source, estimate, version]);

  const records = useMemo(() => (plays ? { ...plays, ...gpRecords(career) } : null), [plays, career]);
  const holders = useMemo(() => (records
    ? Object.entries(records).filter(([k]) => k !== 'me').flatMap(([, l]) => (Array.isArray(l) ? l : []))
    : null), [records]);
  const songs = useMemo(() => holders?.filter((h) => h.track) ?? null, [holders]);
  const singers = useMemo(() => holders?.filter((h) => !h.track) ?? null, [holders]);
  const covers = { tracks: useCovers('tracks', songs), artists: useCovers('artists', singers) };
  useCredits(holders);

  if (error) return <p className="err">{error}</p>;
  if (!records) return <div className="skeleton tall"><i /><i /><i /><i /></div>;
  const me = records.me ?? {};

  return (
    <section className="view records">
      <div className="hero">
        <p className="hero-k">{me.first_day ? `${dayLabel(me.first_day)}부터` : ''}</p>
        <h1 className="hero-t">Awards</h1>
        <div className="stats">
          <Stat value={Number(me.plays ?? 0).toLocaleString()} label="재생" />
          <Stat value={Number(me.tracks ?? 0).toLocaleString()} label="곡" />
          <Stat value={me.listening_streak ? `${me.listening_streak.value}일` : '—'} label="최장 연속 청취"
                sub={me.listening_streak ? `${dayLabel(me.listening_streak.to)}까지` : null} />
          <Stat value={me.busiest_day ? `${me.busiest_day.value}회` : '—'} label="하루 최다"
                sub={me.busiest_day ? dayLabel(me.busiest_day.from) : null} />
        </div>
      </div>

      <nav className="jump" aria-label="부문">
        {AWARD_GROUPS.map((g) => (
          <button key={g.key} className="chip" aria-pressed={group === g.key} onClick={() => setGroup(g.key)}>
            {g.title}
          </button>
        ))}
      </nav>

      {AWARD_GROUPS.filter((g) => g.key === group).map((g) => (
        <div key={g.key} className="award-group">
          {g.items.filter((def) => def.banner).map((def) => (
            <ClubBanner key={def.key} def={def} list={records[def.key]} covers={covers} onSelect={onSelect} elite={elite} />
          ))}
          {g.items.filter((def) => def.roster).map((def) => (
            <ClubRoster key={def.key} def={def} list={records[def.key]} covers={covers} onSelect={onSelect} elite={elite} />
          ))}
          <div className="awards">
            {g.items.filter((def) => !def.banner && !def.roster).map((def) => (
              <Award key={def.key} def={def} list={records[def.key]} covers={covers} onSelect={onSelect}
                     club={g.key === 'club'} source={source} estimate={estimate} elite={elite} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
