'use client';

import { useEffect, useState } from 'react';
import { rowKey } from '@/lib/keys';

/**
 * One row of a championship — driver (track or artist) or constructor
 * (artist, in track mode). The same shape either way: a name, an optional
 * team line, and the season's tally.
 */
function StandingsRow({ rank, name, sub, points, wins, podiums }) {
  return (
    <li className="season-row">
      <div className="rk" data-tier={rank <= 3 ? rank : undefined}>{rank}</div>
      <div className="nm3">
        <b>{name}</b>
        {sub && <span>{sub}</span>}
      </div>
      <div className="pts">
        {points.toLocaleString()}<i>PT</i>
        {(wins > 0 || podiums > 0) && (
          <em className="gpstat">
            {wins > 0 && `🏆${wins}`}{podiums > 0 && ` 🏁${podiums}`}
          </em>
        )}
      </div>
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

  useEffect(() => {
    if (!allTime && year == null) return;
    const ctl = new AbortController();
    setData(null);
    setError(null);
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

  return (
    <div className="season">
      <div className="recap">
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
        {drivers.slice(0, 20).map((d, i) => (
          <StandingsRow
            key={rowKey(d)} rank={i + 1}
            name={d.track ?? d.artist} sub={d.track ? d.artist : null}
            points={d.points} wins={d.wins} podiums={d.podiums}
          />
        ))}
      </ol>

      {constructors && (
        <>
          <p className="legend"><span>컨스트럭터 챔피언십 · 가수 기준</span></p>
          <ol className="season-list">
            {constructors.slice(0, 20).map((c, i) => (
              <StandingsRow
                key={c.artist} rank={i + 1}
                name={c.artist} sub={null}
                points={c.points} wins={c.wins} podiums={c.podiums}
              />
            ))}
          </ol>
        </>
      )}

      <p className="legend"><span>그랑프리 결과 · 월별 1위</span></p>
      <ol className="gp-cal">
        {data.months.filter((m) => m.top.length).map((m) => {
          const winner = m.top.find((t) => t.rank === 1);
          return (
            <li key={`${m.year}-${m.month}`}>
              <span className="gp-mo">{allTime ? `${m.year}.${String(m.month).padStart(2, '0')}` : `${m.month}월`}</span>
              <span className="gp-nm">{winner.track ?? winner.artist}</span>
              <span className="gp-pt">{winner.points}pt · {Number(winner.plays).toLocaleString()}회</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
