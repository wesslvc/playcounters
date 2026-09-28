'use client';

import { Fragment, useMemo, useState, useEffect } from 'react';
import { rowKey } from '@/lib/keys';
import { artistColor } from '@/lib/genre';

/** Standings shown before 펼치기 reveals the rest — enough to read as a real
    grid without the page opening on a scroll of forty names. */
const STANDINGS_PAGE = 10;

const moLabel = (m, allTime) =>
  allTime ? `${m.year}.${String(m.month).padStart(2, '0')}` : `${m.month}월`;

/**
 * One driver or constructor's own race-by-race record, revealed by clicking
 * their row — every Grand Prix they scored in, in order, with the rank and
 * points that race actually paid. Without this a season total is just a
 * sum with nothing to check it against.
 */
function RaceLog({ log, allTime }) {
  if (!log.length) return <p className="note" style={{ padding: '6px 8px' }}>득점 기록이 없습니다.</p>;
  return (
    <ol className="gp-history log">
      {log.map((r) => (
        <li className="gph-row" key={`${r.year}-${r.month}`}>
          <span className="gph-mo">{moLabel(r, allTime)}</span>
          <span className="gph-rk" data-tier={r.rank <= 3 ? r.rank : undefined}>P{r.rank}</span>
          <span className="gph-pt">{r.points}pt</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * One row of a championship — driver (track or artist) or constructor
 * (artist, in track mode). The same shape either way: a name, an optional
 * team line, and the season's tally. The left edge carries the artist's own
 * color, the same one the main dashboard uses — a driver and their team are
 * still, visually, that one artist.
 */
function StandingsRow({ rank, name, sub, points, wins, podiums, color, log, allTime, open, onToggle }) {
  return (
    <>
      <li
        className="season-row" data-tier={rank <= 3 ? rank : undefined}
        role="button" tabIndex={0} aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      >
        <div className="rk" data-tier={rank <= 3 ? rank : undefined}>{rank}</div>
        <div className="nm3" style={{ borderLeftColor: color }}>
          <b>{name}</b>
          {sub && <span>{sub}</span>}
        </div>
        <div className="pts">
          {points.toLocaleString()}<i>PT</i>
          {(wins > 0 || podiums > 0) && (
            <div className="gpstat">
              {wins > 0 && <span className="badge win">🏆{wins}</span>}
              {podiums > 0 && <span className="badge podium">🏁{podiums}</span>}
            </div>
          )}
        </div>
        <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </li>
      {open && (
        <li className="gp-history-wrap">
          <RaceLog log={log} allTime={allTime} />
        </li>
      )}
    </>
  );
}

/**
 * One Grand Prix's full classification, revealed by clicking its line in the
 * race calendar — the calendar itself only ever names the winner, and "who
 * won" is a different, smaller question than "how did it actually go."
 */
function GrandPrixResult({ m, allTime, mode }) {
  const label = mode === 'tracks' ? '곡' : '가수';
  return (
    <li className="gp-history-wrap">
      <ol className="gp-history result">
        {m.top.map((t) => (
          <li className="gph-row" key={rowKey(t)}>
            <span className="gph-rk" data-tier={t.rank <= 3 ? t.rank : undefined}>P{t.rank}</span>
            <span className="gph-nm">
              <b>{t.track ?? t.artist}</b>
              {t.track && <span> · {t.artist}</span>}
            </span>
            <span className="gph-pt">{t.points}pt · {Number(t.plays).toLocaleString()}회</span>
          </li>
        ))}
      </ol>
      <p className="note" style={{ padding: '4px 8px 0' }}>{label} 기준 상위 {m.top.length}개</p>
    </li>
  );
}

/**
 * A season, treated the way F1 treats one: every month is a Grand Prix, its
 * top ten by play count pay championship points, and the standings are the
 * running total. This is deliberately the one ranking in the app that isn't
 * re-sortable — a championship needs one fixed metric to mean anything
 * across months and years, the way a race is always timed in seconds.
 *
 * Drivers are whatever this page is ranking (tracks or artists); constructors
 * — track mode only — regroup those same points onto the artist behind each
 * track, a genuinely different question from switching to artist mode, which
 * would rank by an artist's own play count instead of by how their tracks
 * actually finished.
 *
 * `year` selects one calendar year's championship; passing `allTime` instead
 * runs every Grand Prix in the whole history and adds them into one career
 * total — a different question from any single year's, the way a driver's
 * career points and one season's are both real numbers but never confused
 * for each other.
 */
export default function Season({ mode, source, estimate, year, allTime }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openDriver, setOpenDriver] = useState(null);
  const [openConstructor, setOpenConstructor] = useState(null);
  const [openGP, setOpenGP] = useState(null);
  const [driverShown, setDriverShown] = useState(STANDINGS_PAGE);
  const [constructorShown, setConstructorShown] = useState(STANDINGS_PAGE);

  useEffect(() => {
    if (!allTime && year == null) return;
    const ctl = new AbortController();
    setData(null);
    setError(null);
    setOpenDriver(null);
    setOpenConstructor(null);
    setOpenGP(null);
    setDriverShown(STANDINGS_PAGE);
    setConstructorShown(STANDINGS_PAGE);
    const qs = new URLSearchParams({ mode, source });
    if (allTime) qs.set('all', '1');
    else qs.set('year', String(year));
    if (estimate) qs.set('estimate', '1');
    fetch(`/api/season?${qs}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); setData(j); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [mode, source, estimate, year, allTime]);

  // Every race a given driver or constructor actually scored in, in order —
  // built from the months already in hand rather than a second round trip.
  const driverLog = useMemo(() => {
    if (!data || openDriver == null) return [];
    const log = [];
    for (const m of data.months) {
      const hit = m.top.find((t) => rowKey(t) === openDriver);
      if (hit) log.push({ year: m.year, month: m.month, rank: hit.rank, points: hit.points });
    }
    return log;
  }, [data, openDriver]);

  const constructorLog = useMemo(() => {
    if (!data || openConstructor == null) return [];
    const log = [];
    for (const m of data.months) {
      const hits = m.top.filter((t) => t.artist === openConstructor);
      if (hits.length) {
        // A constructor's month can be more than one charting track; the rank
        // shown is its best, since there's no single "constructor rank" a
        // race itself hands out.
        const best = hits.reduce((a, b) => (b.rank < a.rank ? b : a));
        log.push({ year: m.year, month: m.month, rank: best.rank, points: hits.reduce((s, h) => s + h.points, 0) });
      }
    }
    return log;
  }, [data, openConstructor]);

  if (error) return <p className="err" style={{ padding: '12px 2px' }}>{error}</p>;
  if (!data) return <p className="note" style={{ padding: '12px 2px' }}>시즌을 불러오는 중…</p>;

  const { drivers, constructors, complete, racesRun } = data;
  const driverChamp = drivers[0];
  const constructorChamp = constructors?.[0];
  const label = mode === 'tracks' ? '곡' : '가수';
  const title = allTime ? '역대 통산' : `${year}년 시즌`;
  const driverTag = allTime ? '통산 1위' : (complete ? '드라이버 챔피언' : '드라이버 선두');
  const constructorTag = allTime ? '통산 1위' : (complete ? '컨스트럭터 챔피언' : '컨스트럭터 선두');

  if (!racesRun) {
    return (
      <p className="note" style={{ padding: '12px 2px' }}>
        {allTime ? '아직 기록이 없습니다.' : '이 해에는 기록이 없습니다.'}
      </p>
    );
  }

  const gpList = data.months.filter((m) => m.top.length);

  return (
    <div className="season">
      <div className="season-hero">
        <p className="recap-title">
          {title}{!allTime && !complete ? ' · 진행 중' : ''} · GP {racesRun}회
        </p>
        <div className="recap-grid">
          {driverChamp && (
            <div className="recap-tile">
              <span>{driverTag}</span>
              <b>{driverChamp.track ?? driverChamp.artist}</b>
              <em>{driverChamp.points.toLocaleString()}pt · {driverChamp.wins}승</em>
            </div>
          )}
          {constructorChamp && (
            <div className="recap-tile">
              <span>{constructorTag}</span>
              <b>{constructorChamp.artist}</b>
              <em>{constructorChamp.points.toLocaleString()}pt · {constructorChamp.wins}승</em>
            </div>
          )}
        </div>
      </div>

      <p className="legend"><span>드라이버 챔피언십 · {label} 기준</span></p>
      <ol className="season-list">
        {drivers.slice(0, driverShown).map((d, i) => {
          const key = rowKey(d);
          return (
            <StandingsRow
              key={key} rank={i + 1}
              name={d.track ?? d.artist} sub={d.track ? d.artist : null}
              points={d.points} wins={d.wins} podiums={d.podiums}
              color={artistColor(d.artist)}
              open={openDriver === key} log={driverLog} allTime={allTime}
              onToggle={() => setOpenDriver((k) => (k === key ? null : key))}
            />
          );
        })}
      </ol>
      {drivers.length > driverShown && (
        <div className="more">
          <button className="btn ghost" onClick={() => setDriverShown((n) => n + STANDINGS_PAGE * 2)}>
            펼치기 · {drivers.length - driverShown}명 더
          </button>
        </div>
      )}

      {constructors && (
        <>
          <p className="legend"><span>컨스트럭터 챔피언십 · 가수 기준</span></p>
          <ol className="season-list">
            {constructors.slice(0, constructorShown).map((c, i) => (
              <StandingsRow
                key={c.artist} rank={i + 1}
                name={c.artist} sub={null}
                points={c.points} wins={c.wins} podiums={c.podiums}
                color={artistColor(c.artist)}
                open={openConstructor === c.artist} log={constructorLog} allTime={allTime}
                onToggle={() => setOpenConstructor((a) => (a === c.artist ? null : c.artist))}
              />
            ))}
          </ol>
          {constructors.length > constructorShown && (
            <div className="more">
              <button className="btn ghost" onClick={() => setConstructorShown((n) => n + STANDINGS_PAGE * 2)}>
                펼치기 · {constructors.length - constructorShown}팀 더
              </button>
            </div>
          )}
        </>
      )}

      <p className="legend"><span>그랑프리 결과 · 눌러서 전체 순위 보기</span></p>
      <ol className="gp-cal">
        {gpList.map((m) => {
          const winner = m.top.find((t) => t.rank === 1);
          const key = `${m.year}-${m.month}`;
          const open = openGP === key;
          return (
            <Fragment key={key}>
              <li
                className="gp-cal-row" role="button" tabIndex={0} aria-expanded={open}
                onClick={() => setOpenGP((k) => (k === key ? null : key))}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenGP((k) => (k === key ? null : key)); } }}
              >
                <span className="gp-mo">{moLabel(m, allTime)}</span>
                <span className="gp-nm">{winner.track ?? winner.artist}</span>
                <span className="gp-pt">{winner.points}pt · {Number(winner.plays).toLocaleString()}회</span>
                <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
              </li>
              {open && <GrandPrixResult m={m} allTime={allTime} mode={mode} />}
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
