'use client';

import { Fragment, useMemo, useState, useEffect, useRef } from 'react';
import { rowKey, normRowKey } from '@/lib/keys';
import { artistColor } from '@/lib/genre';
import { computeRanks } from '@/lib/rank';
import { useCredits, artistLine, artistNames, edgeStyle, fillStyle } from './useCredits';

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
    <li className="season-cols" aria-hidden="true">
      <span />
      <span>{label}</span>
      <span>포인트</span>
      <span>우승</span>
      <span>포디움</span>
      <span>포인트<br />피니시</span>
      <span>완주</span>
      <span />
    </li>
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
function StandingsRow({ rank, name, sub, points, wins, podiums, pointsFinishes, finishes, edge, log, allTime, open, onToggle, kind }) {
  return (
    <>
      <li
        className="season-row" data-leader={rank === 1 || undefined}
        role="button" tabIndex={0} aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      >
        <div className="pos">{rank}</div>
        <div className="nm3" style={edge}>
          <b>{name}</b>
          {sub && <span>{sub}</span>}
        </div>
        <div className="cell-pt">{points.toLocaleString()}</div>
        <div className="cell-w">{wins}</div>
        <div className="cell-p">{podiums}</div>
        <div className="cell-p">{pointsFinishes ?? '–'}</div>
        <div className="cell-p">{finishes ?? '–'}</div>
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
 * One Grand Prix's full field, revealed on demand — the calendar itself only
 * names the winner, and "who won" is a different, smaller question than
 * "how did everyone actually place." The season fetch only carries the
 * point-scoring top ten, so this fetches the rest when opened rather than
 * bloating every load with a detail almost nobody opens.
 *
 * `live` is the month still under way: the order is real but provisional,
 * so it reads as a running order with no points attached yet.
 */
function GrandPrixResult({ year, month, mode, source, estimate, live }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const ctl = new AbortController();
    const qs = new URLSearchParams({ mode, source, year: String(year), month: String(month) });
    if (estimate) qs.set('estimate', '1');
    fetch(`/api/season/month?${qs}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); setDetail(j); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [year, month, mode, source, estimate]);

  useCredits(detail?.items);
  if (error) return <p className="err" style={{ padding: '6px 8px' }}>{error}</p>;
  if (!detail) return <p className="note" style={{ padding: '6px 8px' }}>불러오는 중…</p>;
  const { items, leaders, days } = detail;
  return (
    <>
    {leaders?.length > 0 && <RaceLeaders stints={leaders} days={days} live={live} />}
    <p className="gp-sub">{live ? '현재 순위' : '최종 순위'}</p>
    <ol className="gp-history result">
      {items.map((t) => (
        <li className="gph-row" key={rowKey(t)}>
          <span className="gph-rk" data-tier={t.rank <= 3 ? t.rank : undefined}>
            {t.rank <= 10 ? `P${t.rank}` : t.rank}
          </span>
          <span className="gph-nm">
            <b>{t.track ?? t.artist}</b>
            {t.track && <span> · {artistLine(t)}</span>}
          </span>
          <span className="gph-pt">
            {!live && t.points > 0 ? `${t.points}pt · ` : ''}{t.plays.toLocaleString()}회
          </span>
        </li>
      ))}
    </ol>
    </>
  );
}

/**
 * Who led the month's running total, day by day — a Grand Prix's lap-leader
 * chart. The strip shows every spell at the front across the month in the
 * leader's color; the list under it reads the same thing as text, with the
 * margin each leader held at the end of their spell.
 */
function RaceLeaders({ stints, days, live }) {
  useCredits(stints);
  const changes = stints.length - 1;
  const span = stints[stints.length - 1].to - stints[0].from + 1;
  const most = new Map();
  for (const st of stints) most.set(st.key, (most.get(st.key) ?? 0) + (st.to - st.from + 1));
  return (
    <div className="leaders-box">
      <div className="leaders-top">
        <b>레이스 리더</b>
        <span>{changes ? `선두 교체 ${changes}회` : '처음부터 끝까지 선두'}</span>
      </div>
      <div className="lead-strip" role="img" aria-label="날짜별 선두">
        {stints.map((st) => (
          <i
            key={`${st.key}-${st.from}`}
            title={`${st.from}일–${st.to}일 · ${st.track ?? st.artist}`}
            style={{ flexGrow: st.to - st.from + 1, ...fillStyle(st, 'to bottom') }}
          />
        ))}
        {live && stints[stints.length - 1].to < days && (
          <i className="lead-rest" style={{ flexGrow: days - stints[stints.length - 1].to }} />
        )}
      </div>
      <div className="lead-axis">
        <span>{stints[0].from}일</span>
        <span>{live ? '오늘' : `${days}일`}</span>
      </div>
      <ol className="lead-list">
        {stints.map((st) => {
          const n = st.to - st.from + 1;
          return (
            <li key={`${st.key}-${st.from}`}>
              <span className="lead-days">
                {st.from === st.to ? `${st.from}일` : `${st.from}–${st.to}일`}
              </span>
              <span className="lead-nm" style={edgeStyle(st)}>
                <b>{st.track ?? st.artist}</b>
                {st.track && <span>{artistLine(st)}</span>}
              </span>
              <span className="lead-n">
                {n}일{st.gap != null && st.gap > 0 ? ` · +${Math.round(st.gap)}회` : ''}
              </span>
            </li>
          );
        })}
      </ol>
      {span > 0 && most.size > 1 && (
        <p className="lead-note">
          {(() => {
            const [k, n] = [...most].sort((a, b) => b[1] - a[1])[0];
            const st = stints.find((x) => x.key === k);
            return `최장 선두 · ${st.track ?? st.artist} ${n}일`;
          })()}
        </p>
      )}
    </div>
  );
}

/** A section title in the F1 site's own manner: a heavy heading set inside
    a thin rule that runs along the top and turns down the right side. */
function SectionHead({ title, sub, children }) {
  return (
    <div className="f1-head">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

/** The chequered flag a finished round is marked with. */
function Chequered() {
  return (
    <svg className="chq" viewBox="0 0 12 12" aria-hidden="true">
      <rect width="12" height="12" rx="1.5" fill="var(--card)" stroke="var(--ink)" strokeWidth="1" />
      {[0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => ((r + c) % 2 === 0 ? (
        <rect key={`${r}${c}`} x={c * 3} y={r * 3} width="3" height="3" fill="var(--ink)" />
      ) : null)))}
    </svg>
  );
}

/** The championship leader (or champion), as a card in that artist's color. */
function LeaderCard({ tag, name, sub, points, wins, podiums, color }) {
  return (
    <div className="leader" style={{ '--team': color }}>
      <span className="leader-tag">{tag}</span>
      <span className="leader-wins" aria-label={`${wins}승`}>
        <b>{wins}</b>
        <small>{wins === 1 ? 'WIN' : 'WINS'}</small>
      </span>
      <b className="leader-name">{name}</b>
      <span className="leader-sub">{sub || '\u00a0'}</span>
      <span className="leader-pts">
        {points.toLocaleString()}<small>PTS</small>
        <em>{podiums} {podiums === 1 ? 'podium' : 'podiums'}</em>
      </span>
    </div>
  );
}

/**
 * The race under way this month. Shown live — the running order is real —
 * but it scores nothing until the month is over, the same way a Grand Prix
 * pays out at the chequered flag and not from the middle of the race.
 */
function LiveRace({ m, round, allTime, mode, source, estimate, drivers, constructors }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('drivers');
  const top = m.top.slice(0, 3);
  const projected = useMemo(
    () => ({
      drivers: projectStandings(drivers, m.top, normRowKey, (t) => [{
        key: normRowKey(t),
        fields: { artist: t.artist, track: t.track ?? null, artist_key: t.artist_key, track_key: t.track_key ?? null, credits: t.credits ?? null },
      }]),
      // Every credited artist scores, the same as the real standings.
      constructors: constructors && projectStandings(constructors, m.top, (c) => c.artist_key, (t) =>
        (t.credits ?? [{ name: t.artist, key: t.artist_key }])
          .map((c) => ({ key: c.key, fields: { artist: c.name, artist_key: c.key } }))),
    }),
    [m, drivers, constructors],
  );
  const activeKind = kind === 'constructors' && projected.constructors ? 'constructors' : 'drivers';
  const rows = projected[activeKind];

  return (
    <div className="live-card">
      <div className="live-head">
        <span className="live-badge"><i />LIVE</span>
        <span className="live-round">ROUND {round}</span>
        <b>{moLabel(m, allTime)} 그랑프리</b>
      </div>
      <ol className="live-top">
        {top.map((t) => (
          <li key={normRowKey(t)}>
            <span className="live-pos">{t.rank}</span>
            <span className="live-nm" style={edgeStyle(t)}>
              <b>{t.track ?? t.artist}</b>
              {t.track && <span>{artistLine(t)}</span>}
            </span>
            <span className="live-plays">{Number(t.plays).toLocaleString()}회</span>
          </li>
        ))}
      </ol>
      <div className="live-foot">
        <span>잠정 순위 · 포인트는 이달이 끝나면 확정됩니다</span>
        <button className="linkish" onClick={() => setOpen((v) => !v)}>
          {open ? '접기' : '전체 순위'}
        </button>
      </div>
      {open && (
        <GrandPrixResult year={m.year} month={m.month} mode={mode} source={source} estimate={estimate} live />
      )}

      <div className="proj">
        <div className="proj-top">
          <b>이대로 끝나면</b>
          <span>챔피언십 TOP 10 · 지금 순위 대비</span>
        </div>
        {projected.constructors && (
          <div className="f1-tabs" role="tablist">
            <button role="tab" aria-selected={activeKind === 'drivers'} onClick={() => setKind('drivers')}>드라이버</button>
            <button role="tab" aria-selected={activeKind === 'constructors'} onClick={() => setKind('constructors')}>컨스트럭터</button>
          </div>
        )}
        <ol className="proj-list">
          {rows.slice(0, 10).map((r) => (
            <li key={r.key}>
              <span className="proj-pos">{r.pos}</span>
              <Move from={r.prevPos} to={r.pos} />
              <span className="proj-nm" style={r.track ? edgeStyle(r) : { borderLeftColor: artistColor(r.artist) }}>
                <b>{r.track ?? r.artist}</b>
                {r.track && <span>{artistLine(r)}</span>}
              </span>
              <span className="proj-pts">
                {r.points.toLocaleString()}
                {r.gained > 0 && <em>+{r.gained}</em>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** The ▲/▼ beside a projected position — or NEW for someone not yet in the standings at all. */
function Move({ from, to }) {
  if (from == null) return <span className="mv new">NEW</span>;
  const d = from - to;
  if (!d) return <span className="mv same">–</span>;
  return <span className={`mv ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? '▲' : '▼'}{Math.abs(d)}</span>;
}

/**
 * The championship as it would stand if the month still under way finished
 * exactly as it is now: today's standings plus this month's provisional
 * points, wins, podiums and finish, re-sorted with the same tie rule the
 * real standings use (points, wins, podiums, then finishes). Each row
 * carries where it sits today, so the move can be shown.
 */
function projectStandings(current, liveTop, keyOf, entriesOf) {
  const rows = new Map(current.map((c, i) => [keyOf(c), {
    ...c, key: keyOf(c), prevPos: i + 1, gained: 0,
  }]));
  for (const t of liveTop) for (const { key: k, fields } of entriesOf(t)) {
    const r = rows.get(k) ?? {
      ...fields, key: k, prevPos: null, gained: 0, points: 0, wins: 0, podiums: 0, finishes: 0,
    };
    r.points += t.points;
    r.gained += t.points;
    if (t.rank === 1) r.wins += 1;
    if (t.rank <= 3) r.podiums += 1;
    // One finish per track in this month's running order — for a
    // constructor, each of its tracks adds its own.
    r.finishes = (r.finishes ?? 0) + 1;
    rows.set(k, r);
  }
  const sorted = [...rows.values()].sort((a, b) =>
    b.points - a.points || b.wins - a.wins || b.podiums - a.podiums
    || (b.finishes ?? 0) - (a.finishes ?? 0)
    || a.artist.localeCompare(b.artist));
  return sorted.map((r, i) => ({ ...r, pos: i + 1 }));
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

  // The query string of the season on screen, for the quiet reload below.
  const query = useRef('');
  const reloads = useRef(0);

  useEffect(() => {
    if (!allTime && year == null) return;
    const ctl = new AbortController();
    reloads.current = 0;
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
    query.current = qs.toString();
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
      if (m.live) continue;
      const hit = m.top.find((t) => normRowKey(t) === openDriver);
      if (hit) log.push({ year: m.year, month: m.month, rank: hit.rank, points: hit.points });
    }
    return log;
  }, [data, openDriver]);

  const constructorLog = useMemo(() => {
    if (!data || openConstructor == null) return [];
    const log = [];
    for (const m of data.months) {
      if (m.live) continue;
      const hits = m.top.filter((t) =>
        (t.credits ?? [{ key: t.artist_key }]).some((c) => c.key === openConstructor));
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
    // Only finished rounds: a race still under way hasn't scored anything.
    const months = data.months.filter((m) => !m.live);
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
        for (const t of m.top) {
          for (const c of t.credits ?? [{ key: t.artist_key }]) sums.set(c.key, (sums.get(c.key) ?? 0) + t.points);
        }
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

  // Rows whose artist line is on screen: the standings, plus every month's
  // top ten (leader card, live race, race calendar).
  const creditRows = useMemo(
    () => (data ? [...data.drivers, ...data.months.flatMap((m) => m.top)] : null),
    [data],
  );
  const creditVersion = useCredits(creditRows);

  // Credits for tracks nobody had opened before arrive a moment after the
  // standings, and are stored as they arrive. When they name more artists
  // than the standings were computed with, reload once, quietly, so every
  // credited artist's points are in — at most twice per season shown.
  useEffect(() => {
    if (!data || !creditRows || reloads.current >= 2) return;
    const richer = creditRows.some((r) => r.track && artistNames(r).length > (r.credits?.length ?? 1));
    if (!richer) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      reloads.current += 1;
      fetch(`/api/season?${query.current}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((j) => { if (!j.error) setData(j); })
        .catch(() => {});
    }, 1500);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [creditVersion, data, creditRows]);

  if (error) return <p className="err" style={{ padding: '12px 2px' }}>{error}</p>;
  if (!data) return <p className="note" style={{ padding: '12px 2px' }}>시즌을 불러오는 중…</p>;

  const { drivers, constructors, complete, racesRun } = data;
  const driverChamp = drivers[0];
  const constructorChamp = constructors?.[0];
  const label = mode === 'tracks' ? '곡' : '가수';
  const driverTag = allTime ? '통산 1위' : (complete ? '드라이버 챔피언' : '드라이버 선두');
  const constructorTag = allTime ? '통산 1위' : (complete ? '컨스트럭터 챔피언' : '컨스트럭터 선두');

  // Rounds are numbered by races actually held, the way a calendar counts
  // Grands Prix — a month with no plays at all simply wasn't a round.
  const held = data.months.filter((m) => m.top.length);
  const rounds = held.map((m, i) => ({ ...m, round: i + 1 }));
  const liveRace = rounds.find((m) => m.live);
  const results = rounds.filter((m) => !m.live).reverse();

  if (!racesRun && !liveRace) {
    return (
      <p className="note" style={{ padding: '12px 2px' }}>
        {allTime ? '아직 기록이 없습니다.' : '이 해에는 기록이 없습니다.'}
      </p>
    );
  }

  const activeKind = chartKind === 'constructors' && chartData.constructorSeries ? 'constructors' : 'drivers';
  const activeSeries = activeKind === 'constructors' ? chartData.constructorSeries : chartData.driverSeries;

  return (
    <div className="season">
      <p className="season-status">
        <span>{allTime ? '역대 통산' : `${year} 시즌`}</span>
        <span>{racesRun}라운드 완료</span>
        {complete && <span className="done">시즌 종료</span>}
        {liveRace && <span className="on">ROUND {liveRace.round} 진행 중</span>}
      </p>

      {racesRun > 0 && (
        <div className="leaders">
          {driverChamp && (
            <LeaderCard
              tag={driverTag} name={driverChamp.track ?? driverChamp.artist}
              sub={driverChamp.track ? artistLine(driverChamp) : null}
              points={driverChamp.points} wins={driverChamp.wins} podiums={driverChamp.podiums}
              color={artistColor(driverChamp.artist)}
            />
          )}
          {constructorChamp && (
            <LeaderCard
              tag={constructorTag} name={constructorChamp.artist} sub={null}
              points={constructorChamp.points} wins={constructorChamp.wins} podiums={constructorChamp.podiums}
              color={artistColor(constructorChamp.artist)}
            />
          )}
        </div>
      )}

      {liveRace && (
        <LiveRace
          m={liveRace} round={liveRace.round} allTime={allTime}
          mode={mode} source={source} estimate={estimate}
          drivers={drivers} constructors={constructors}
        />
      )}

      {racesRun > 0 && (
        <>
          <SectionHead title="시즌 차트" sub={chartView === 'points' ? '누적 포인트' : '레이스별 순위 · P1이 맨 위'}>
            <div className="chart-controls">
              <div className="seg">
                <button className="pill" aria-pressed={chartView === 'points'} onClick={() => setChartView('points')}>포인트</button>
                <button className="pill" aria-pressed={chartView === 'position'} onClick={() => setChartView('position')}>순위</button>
              </div>
              <div className="seg">
                {[5, 10].map((n) => (
                  <button key={n} className="pill" aria-pressed={chartN === n} onClick={() => setChartN(n)}>TOP {n}</button>
                ))}
              </div>
            </div>
          </SectionHead>
          {chartData.constructorSeries && (
            <div className="f1-tabs" role="tablist">
              <button role="tab" aria-selected={activeKind === 'drivers'} onClick={() => setChartKind('drivers')}>드라이버</button>
              <button role="tab" aria-selected={activeKind === 'constructors'} onClick={() => setChartKind('constructors')}>컨스트럭터</button>
            </div>
          )}
          <SeasonChart labels={chartData.labels} series={activeSeries} view={chartView} />
          <ol className="chart-key">
            {activeSeries.map((s) => (
              <li key={s.key}><i style={{ background: s.color }} />{s.label}</li>
            ))}
          </ol>

          <SectionHead title="드라이버 스탠딩" sub={`${label} 기준`} />
          <ol className="season-list">
            <StandingsHead label={label} />
            {drivers.slice(0, driverShown).map((d, i) => {
              const key = normRowKey(d);
              return (
                <StandingsRow
                  key={key} rank={i + 1}
                  name={d.track ?? d.artist} sub={d.track ? artistLine(d) : null}
                  points={d.points} wins={d.wins} podiums={d.podiums}
                  pointsFinishes={d.pointsFinishes} finishes={d.finishes}
                  edge={edgeStyle(d)} kind="driver"
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
              <SectionHead title="컨스트럭터 스탠딩" sub="가수별 · 곡들이 딴 포인트 합산" />
              <ol className="season-list">
                <StandingsHead label="가수" />
                {constructors.slice(0, constructorShown).map((c, i) => (
                  <StandingsRow
                    key={c.artist_key} rank={i + 1}
                    name={c.artist} sub={null}
                    points={c.points} wins={c.wins} podiums={c.podiums}
                    pointsFinishes={c.pointsFinishes} finishes={c.finishes}
                    edge={{ borderLeftColor: artistColor(c.artist) }} kind="constructor"
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

          <SectionHead title="레이스 결과" sub="최근 라운드부터 · 눌러서 전체 순위" />
          <ol className="gp-cal">
            <li className="gp-cols" aria-hidden="true">
              <span>라운드</span><span>그랑프리</span><span>우승</span><span>재생</span><span />
            </li>
            {results.map((m) => {
              const winner = m.top.find((t) => t.rank === 1) ?? m.top[0];
              const key = `${m.year}-${m.month}`;
              const open = openGP === key;
              const toggle = () => setOpenGP((k) => (k === key ? null : key));
              return (
                <Fragment key={key}>
                  <li
                    className="gp-cal-row" role="button" tabIndex={0} aria-expanded={open}
                    onClick={toggle}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                  >
                    <span className="gp-rd"><Chequered />R{m.round}</span>
                    <span className="gp-mo">{moLabel(m, allTime)}</span>
                    <span className="gp-nm" style={edgeStyle(winner)}>
                      <b>{winner.track ?? winner.artist}</b>
                      {winner.track && <span>{artistLine(winner)}</span>}
                    </span>
                    <span className="gp-pt">{Number(winner.plays).toLocaleString()}회</span>
                    <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
                  </li>
                  {open && (
                    <li className="gp-history-wrap">
                      <GrandPrixResult
                        year={m.year} month={m.month} mode={mode} source={source} estimate={estimate}
                      />
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
