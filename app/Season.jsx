'use client';

import { Fragment, useMemo, useState, useEffect } from 'react';
import { rowKey, normRowKey } from '@/lib/keys';
import { artistColor } from '@/lib/genre';
import { computeRanks } from '@/lib/rank';

/** Standings shown before 펼치기 reveals the rest — enough to read as a real
    grid without the page opening on a scroll of forty names. */
const STANDINGS_PAGE = 10;

const CHART_W = 720;
const CHART_H = 220;
const CHART_PAD = { l: 28, r: 10, t: 14, b: 22 };
/** The position chart's scale never needs to go past P10 — only the ten
    point-scoring finishes are tracked at all, so there is no lower rank to
    plot even if the field itself is bigger. */
const MAX_POS = 10;

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
 * A constructor's own record is one level deeper than a driver's: a month
 * can hold more than one of its tracks charting at once, and collapsing
 * that to a single "best rank" line hid which songs actually did the work.
 * Every contributing track gets its own line, grouped under the month it
 * scored in.
 */
function ConstructorLog({ log, allTime }) {
  if (!log.length) return <p className="note" style={{ padding: '6px 8px' }}>득점 기록이 없습니다.</p>;
  return (
    <div className="cxlog">
      {log.map((m) => (
        <div className="cxlog-month" key={`${m.year}-${m.month}`}>
          <p className="cxlog-mo">{moLabel(m, allTime)}</p>
          <ol className="gp-history result">
            {m.tracks.map((t, i) => (
              <li className="gph-row" key={i}>
                <span className="gph-rk" data-tier={t.rank <= 3 ? t.rank : undefined}>P{t.rank}</span>
                <span className="gph-nm"><b>{t.track}</b></span>
                <span className="gph-pt">{t.points}pt</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

/**
 * The column headers for a standings table — printed once, so every row
 * below can be bare numbers instead of an icon it hopes reads at the same
 * size as its neighbour. (A 🏆 and a 🏁 are not drawn at the same size by
 * most emoji sets, whatever font-size asks for — a real table column
 * doesn't have that problem.)
 */
function StandingsHead({ label }) {
  return (
    <div className="season-cols" aria-hidden="true">
      <span />
      <span>{label}</span>
      <span>포인트</span>
      <span>우승</span>
      <span>포디움</span>
      <span />
    </div>
  );
}

/**
 * One row of a championship — driver (track or artist) or constructor
 * (artist, in track mode). The same shape either way: a name, an optional
 * team line, and the season's tally in three plain numeric columns (points,
 * wins, podiums) rather than icon badges. The left edge carries the
 * artist's own color, the same one the main dashboard uses — a driver and
 * their team are still, visually, that one artist.
 */
function StandingsRow({ rank, name, sub, points, wins, podiums, color, log, allTime, open, onToggle, kind }) {
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
        <div className="cell-pt">{points.toLocaleString()}</div>
        <div className="cell-w">{wins}</div>
        <div className="cell-p">{podiums}</div>
        <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </li>
      {open && (
        <li className="gp-history-wrap">
          {kind === 'constructor'
            ? <ConstructorLog log={log} allTime={allTime} />
            : <RaceLog log={log} allTime={allTime} />}
        </li>
      )}
    </>
  );
}

/**
 * One Grand Prix's full field, revealed by clicking its line in the race
 * calendar — the calendar itself only ever names the winner, and "who won"
 * is a different, smaller question than "how did everyone actually place."
 * The season fetch only ever carries the point-scoring top ten, so this
 * fetches the rest on demand rather than bloating every load with a detail
 * almost nobody opens.
 */
function GrandPrixResult({ year, month, mode, source, estimate }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const ctl = new AbortController();
    const qs = new URLSearchParams({ mode, source, year: String(year), month: String(month) });
    if (estimate) qs.set('estimate', '1');
    fetch(`/api/season/month?${qs}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); setItems(j.items); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [year, month, mode, source, estimate]);

  return (
    <li className="gp-history-wrap">
      {error && <p className="err" style={{ padding: '6px 8px' }}>{error}</p>}
      {!error && !items && <p className="note" style={{ padding: '6px 8px' }}>불러오는 중…</p>}
      {items && (
        <ol className="gp-history result">
          {items.map((t) => (
            <li className="gph-row" key={rowKey(t)}>
              <span className="gph-rk" data-tier={t.rank <= 3 ? t.rank : undefined}>
                {t.points > 0 ? `P${t.rank}` : t.rank}
              </span>
              <span className="gph-nm">
                <b>{t.track ?? t.artist}</b>
                {t.track && <span> · {t.artist}</span>}
              </span>
              <span className="gph-pt">
                {t.points > 0 ? `${t.points}pt · ` : ''}{t.plays.toLocaleString()}회
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/**
 * The season's own trend chart — how the leaders actually got to their
 * totals, race by race, in one of two readings:
 *
 * "points" is the running total, same idea as the dashboard's own play-count
 * trend — a flat stretch is a month a driver didn't score in, not a month
 * with no data.
 *
 * "position" is the F1 broadcast's own chart: each driver's actual finishing
 * position, race by race, plotted on an inverted scale so P1 sits at the
 * top. A driver who didn't finish in the points that month has no position
 * to plot — the line breaks there rather than interpolating a rank that was
 * never earned, the same way a real standings tracker leaves a gap for a
 * round a driver sat out.
 */
function SeasonChart({ labels, series, view }) {
  const [hover, setHover] = useState(null);
  const n = labels.length;

  const innerW = CHART_W - CHART_PAD.l - CHART_PAD.r;
  const innerH = CHART_H - CHART_PAD.t - CHART_PAD.b;
  const x = (i) => CHART_PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * innerW);

  const peak = view === 'points'
    ? Math.max(1, ...series.map((s) => s.pts[s.pts.length - 1].cum))
    : MAX_POS;
  const y = view === 'points'
    ? (v) => CHART_PAD.t + (1 - v / peak) * innerH
    : (rank) => CHART_PAD.t + ((rank - 1) / (MAX_POS - 1)) * innerH;

  const lines = series.map((s) => {
    if (view === 'points') {
      const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.cum).toFixed(1)}`).join(' ');
      return { ...s, segs: [d], ex: x(n - 1), ey: y(s.pts[n - 1].cum) };
    }
    const segs = [];
    let cur = [];
    let lastIdx = -1, lastRank = null;
    s.pts.forEach((p, i) => {
      if (p.rank == null) {
        if (cur.length) { segs.push(cur.join(' ')); cur = []; }
        return;
      }
      cur.push(`${cur.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`);
      lastIdx = i; lastRank = p.rank;
    });
    if (cur.length) segs.push(cur.join(' '));
    return { ...s, segs, ex: lastIdx >= 0 ? x(lastIdx) : null, ey: lastRank != null ? y(lastRank) : null };
  });

  const yTicks = view === 'points'
    ? [0, Math.round(peak / 2), peak]
    : [1, 5, 10];
  const xTicks = n <= 6 ? labels.map((l, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const binW = innerW / n;

  const tipSide = hover == null ? 'mid' : hover / (n - 1 || 1) < 0.25 ? 'start' : hover / (n - 1 || 1) > 0.75 ? 'end' : 'mid';

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" className="chart-svg" role="img"
           aria-label={view === 'points' ? '누적 포인트 추이' : '레이스별 순위 추이'}
           onMouseLeave={() => setHover(null)}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={CHART_PAD.l} x2={CHART_W - CHART_PAD.r} y1={y(t)} y2={y(t)}
                  className="chart-grid" vectorEffect="non-scaling-stroke" />
            <text x={CHART_PAD.l - 6} y={y(t)} className="chart-ytext" textAnchor="end" dominantBaseline="middle">
              {view === 'points' ? t.toLocaleString() : `P${t}`}
            </text>
          </g>
        ))}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={CHART_PAD.t} y2={CHART_H - CHART_PAD.b}
                className="chart-hover-line" vectorEffect="non-scaling-stroke" />
        )}
        {lines.map((s) => s.segs.map((d, si) => (
          <path key={`${s.key}-${si}`} d={d} fill="none" stroke={s.color}
                strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
                vectorEffect="non-scaling-stroke" opacity={hover == null || s.pts[hover]?.[view === 'points' ? 'cum' : 'rank'] != null ? 1 : .35} />
        )))}
        {lines.map((s) => s.ex != null && (
          <rect key={`p-${s.key}`} x={s.ex - 7} y={s.ey - 3.5} width="14" height="7" rx="3.5"
                fill={s.color} stroke="var(--paper)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        ))}
        {hover != null && lines.map((s) => {
          const p = s.pts[hover];
          const v = view === 'points' ? p.cum : p.rank;
          if (v == null) return null;
          return (
            <circle key={`h-${s.key}`} cx={x(hover)} cy={y(v)} r="3.5"
                    fill={s.color} stroke="var(--paper)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          );
        })}
        {labels.map((_, i) => (
          <rect key={`hit-${i}`} x={CHART_PAD.l + i * binW} y="0" width={binW} height={CHART_H}
                fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>

      <div className="chart-x">
        {xTicks.map((i) => <span key={i}>{labels[i]}</span>)}
      </div>

      {hover != null && (
        <div className={`chart-tip tip-${tipSide}`} style={{ left: `${(x(hover) / CHART_W) * 100}%` }}>
          <b>{labels[hover]}</b>
          <ul>
            {series.map((s) => {
              const p = s.pts[hover];
              const v = view === 'points' ? p.cum : p.rank;
              return (
                <li key={s.key}>
                  <i style={{ background: s.color }} />
                  <span>{s.label}</span>
                  <em>{v == null ? '—' : view === 'points' ? `${v.toLocaleString()}pt` : `P${v}`}</em>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
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
  const [chartKind, setChartKind] = useState('drivers');
  const [chartView, setChartView] = useState('points');
  const [chartN, setChartN] = useState(5);

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
  // Matched on the normalised key, not the display label: two months can
  // legitimately show slightly different wording for the same recording,
  // and matching on the label would silently drop those months from the log.
  const driverLog = useMemo(() => {
    if (!data || openDriver == null) return [];
    const log = [];
    for (const m of data.months) {
      const hit = m.top.find((t) => normRowKey(t) === openDriver);
      if (hit) log.push({ year: m.year, month: m.month, rank: hit.rank, points: hit.points });
    }
    return log;
  }, [data, openDriver]);

  const constructorLog = useMemo(() => {
    if (!data || openConstructor == null) return [];
    const log = [];
    for (const m of data.months) {
      const hits = m.top.filter((t) => t.artist_key === openConstructor);
      if (hits.length) {
        log.push({
          year: m.year, month: m.month,
          tracks: [...hits].sort((a, b) => a.rank - b.rank)
            .map((h) => ({ track: h.track ?? h.artist, rank: h.rank, points: h.points })),
        });
      }
    }
    return log;
  }, [data, openConstructor]);

  // The chart's own series: each shown driver's race-by-race record, plus —
  // in track mode — the same thing regrouped onto constructors. A
  // constructor has no monthly rank of its own coming out of the API (only
  // the cumulative championship does), so it's rebuilt here: sum that
  // month's charting tracks onto their artist, then rank the constructors
  // that actually scored against each other, month by month.
  const chartData = useMemo(() => {
    if (!data) return null;
    const months = data.months;
    const labels = months.map((m) => moLabel(m, allTime));

    const driverSeries = data.drivers.slice(0, chartN).map((d) => {
      const key = normRowKey(d);
      let cum = 0;
      const pts = months.map((m) => {
        const hit = m.top.find((t) => normRowKey(t) === key);
        cum += hit ? hit.points : 0;
        return { rank: hit ? hit.rank : null, cum };
      });
      return { key, label: d.track ?? d.artist, color: artistColor(d.artist), pts };
    });

    let constructorSeries = null;
    if (data.constructors) {
      const monthly = months.map((m) => {
        const sums = new Map();
        for (const t of m.top) sums.set(t.artist_key, (sums.get(t.artist_key) ?? 0) + t.points);
        const rows = [...sums.entries()].map(([artist_key, points]) => ({ artist_key, points }));
        rows.sort((a, b) => b.points - a.points);
        const ranks = computeRanks(rows, 'points');
        return new Map(rows.map((r, i) => [r.artist_key, { points: r.points, rank: ranks[i] }]));
      });
      constructorSeries = data.constructors.slice(0, chartN).map((c) => {
        let cum = 0;
        const pts = monthly.map((byKey) => {
          const hit = byKey.get(c.artist_key);
          cum += hit ? hit.points : 0;
          return { rank: hit ? hit.rank : null, cum };
        });
        return { key: c.artist_key, label: c.artist, color: artistColor(c.artist), pts };
      });
    }

    return { labels, driverSeries, constructorSeries };
  }, [data, chartN]);

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

      {(() => {
        const activeKind = chartKind === 'constructors' && chartData.constructorSeries ? 'constructors' : 'drivers';
        const activeSeries = activeKind === 'constructors' ? chartData.constructorSeries : chartData.driverSeries;
        return (
          <div className="season-chart">
            <div className="chart-head">
              <p className="legend"><span>시즌 차트 · {chartView === 'points' ? '누적 포인트' : '레이스별 순위'}</span></p>
              <div className="chart-controls">
                {chartData.constructorSeries && (
                  <div className="seg">
                    <button className="pill" aria-pressed={activeKind === 'drivers'} onClick={() => setChartKind('drivers')}>드라이버</button>
                    <button className="pill" aria-pressed={activeKind === 'constructors'} onClick={() => setChartKind('constructors')}>컨스트럭터</button>
                  </div>
                )}
                <div className="seg">
                  <button className="pill" aria-pressed={chartView === 'points'} onClick={() => setChartView('points')}>포인트</button>
                  <button className="pill" aria-pressed={chartView === 'position'} onClick={() => setChartView('position')}>순위</button>
                </div>
                <div className="seg">
                  {[5, 10].map((n) => (
                    <button key={n} className="pill" aria-pressed={chartN === n} onClick={() => setChartN(n)}>상위 {n}</button>
                  ))}
                </div>
              </div>
            </div>
            <SeasonChart labels={chartData.labels} series={activeSeries} view={chartView} />
            <ol className="chart-key">
              {activeSeries.map((s) => (
                <li key={s.key}><i style={{ background: s.color }} />{s.label}</li>
              ))}
            </ol>
          </div>
        );
      })()}

      <p className="legend"><span>드라이버 챔피언십 · {label} 기준</span></p>
      <StandingsHead label={label} />
      <ol className="season-list">
        {drivers.slice(0, driverShown).map((d, i) => {
          const key = normRowKey(d);
          return (
            <StandingsRow
              key={key} rank={i + 1}
              name={d.track ?? d.artist} sub={d.track ? d.artist : null}
              points={d.points} wins={d.wins} podiums={d.podiums}
              color={artistColor(d.artist)} kind="driver"
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
          <StandingsHead label="가수" />
          <ol className="season-list">
            {constructors.slice(0, constructorShown).map((c, i) => (
              <StandingsRow
                key={c.artist_key} rank={i + 1}
                name={c.artist} sub={null}
                points={c.points} wins={c.wins} podiums={c.podiums}
                color={artistColor(c.artist)} kind="constructor"
                open={openConstructor === c.artist_key} log={constructorLog} allTime={allTime}
                onToggle={() => setOpenConstructor((a) => (a === c.artist_key ? null : c.artist_key))}
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
              {open && (
                <GrandPrixResult
                  year={m.year} month={m.month} mode={mode} source={source} estimate={estimate}
                />
              )}
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
