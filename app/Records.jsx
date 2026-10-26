'use client';

import { useEffect, useMemo, useState } from 'react';
import { AWARD_GROUPS, gpRecords, formatValue } from '@/lib/awards';
import { artistLine, useCredits } from './useCredits';
import { useCovers, coverOf } from './useCovers';
import { loadCareer, loadRecords } from './data';
import { Section, Cover, Stat, dayLabel } from './ui';

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

/** "2026년 8월 25일 21:34" — when an artist entered the 1000 Club. */
const reachedLabel = (at) => (at ? `${dayLabel(at)} ${String(at).slice(11, 16)}` : null);
/** "2026.1.3 20:21" — the same, short enough for a list row. */
const reachedShort = (at) => {
  if (!at) return null;
  const [y, m, d] = String(at).slice(0, 10).split('-');
  return `${y}.${Number(m)}.${Number(d)} ${String(at).slice(11, 16)}`;
};

const target = (h) => ({ artist: h.artist, track: h.track ?? null, artist_key: h.artist_key, track_key: h.track_key ?? null });

/**
 * One category: the holder up front, the next two under it. A 1000 Club card
 * lists everyone who got there, each with their picture and the minute they
 * entered.
 */
function Award({ def, list, covers, onSelect, club }) {
  const [first, ...rest] = list ?? [];
  const mode = (h) => (h.track ? 'tracks' : 'artists');
  return (
    <article className={`award${club ? ' club' : ''}`} data-key={def.key}>
      <header>
        <h3 title={def.note}>{def.title}{def.tag && <span className="award-tag">{def.tag}</span>}</h3>
        {club && <span className="club-mark">1000 CLUB</span>}
      </header>
      {first ? (
        <>
          <button className="award-holder" onClick={() => onSelect(target(first))}>
            <Cover src={coverOf(covers[mode(first)], mode(first), first)} size={60} round={!first.track} />
            <span className="award-nm">
              <b>{first.track ?? first.artist}</b>
              {first.track && <span>{artistLine(first)}</span>}
            </span>
            <span className="award-v">
              {formatValue(def, first.value).v}<small>{formatValue(def, first.value).unit}</small>
            </span>
          </button>
          <p className="award-when">{when(def, first)}</p>
          {club && first.reached_at && <p className="club-in">1000 Club 입성 · {reachedLabel(first.reached_at)}</p>}
          {rest.length > 0 && (
            <ol className="award-rest">
              {rest.map((h, i) => (
                <li key={i}>
                  <button onClick={() => onSelect(target(h))}>
                    <span className="award-place">{i + 2}</span>
                    {club && <Cover src={coverOf(covers.artists, 'artists', h)} size={34} round />}
                    <span className="award-rest-nm">
                      {h.track ?? h.artist}{h.track && <em> · {artistLine(h)}</em>}
                      {club && h.reached_at && <small>입성 {reachedShort(h.reached_at)}</small>}
                    </span>
                    <span className="award-rest-v">{formatValue(def, h.value).v}{formatValue(def, h.value).unit}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <p className="award-none">아직 해당하는 기록이 없습니다.</p>
      )}
    </article>
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
        {AWARD_GROUPS.map((g) => <a key={g.key} href={`#rec-${g.key}`}>{g.title}</a>)}
      </nav>

      {AWARD_GROUPS.map((g) => (
        <div key={g.key} className="award-group">
          <Section id={`rec-${g.key}`} title={g.title} />
          <div className="awards">
            {g.items.map((def) => (
              <Award key={def.key} def={def} list={records[def.key]} covers={covers} onSelect={onSelect}
                     club={g.key === 'club'} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
