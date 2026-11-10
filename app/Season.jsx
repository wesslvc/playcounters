'use client';

import { Fragment, useMemo, useState, useEffect, useRef } from 'react';
import { rowKey, normRowKey } from '@/lib/keys';
import { artistColor } from '@/lib/genre';
import { computeRanks, splitPoints } from '@/lib/rank';
import { smoothPath } from '@/lib/curve';
import { useCredits, artistLine, artistNames, fillStyle, washStyle } from './useCredits';
import { useGenres, seedGenres } from './useGenres';
import { useCovers, coverOf } from './useCovers';
import { Section, Cover, Seg, Count } from './ui';
import { shareCard } from './share';

/** Standings shown before 펼치기 reveals the rest — enough to read as a real
    grid without the page opening on a scroll of forty names. */
const STANDINGS_PAGE = 10;

/** The position chart shows at least P1–P10, further down when a line goes there. */
const MAX_POS = 10;

const moLabel = (m, allTime) =>
  allTime ? `${m.year}.${String(m.month).padStart(2, '0')}` : `${m.month}월`;

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
 * (artist, in track mode): position, artwork, the name with its artist's
 * color bar, and the season's tally in plain numeric columns. Opening it
 * shows the full sheet — counts, race-by-race record and records — the same
 * one the chart opens.
 */
function StandingsRow({ rank, name, sub, points, wins, podiums, pointsFinishes, finishes, fill, wash, share, cover, round, onOpen }) {
  return (
    <li
      className="season-row wash" data-leader={rank === 1 || undefined} style={wash}
      role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <div className="pos">{rank}</div>
      <div className="nm3">
        <Cover src={cover} size={36} round={round} />
        <span>
          <b>{name}</b>
          {sub && <span>{sub}</span>}
          {share != null && <i className="pts-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, share * 100)}%`, ...fill }} /></i>}
        </span>
      </div>
      <div className="cell-pt">{points.toLocaleString()}</div>
      <div className="cell-w">{wins}</div>
      <div className="cell-p">{podiums}</div>
      <div className="cell-p">{pointsFinishes ?? '–'}</div>
      <div className="cell-p">{finishes ?? '–'}</div>
      <span className="chev" aria-hidden="true">›</span>
    </li>
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
function GrandPrixResult({ year, month, mode, source, estimate, live, onRadio }) {
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
  // a finished race opens on its podium, big
  const podium = !live && detail ? detail.items.filter((t) => t.rank <= 3).slice(0, 3) : [];
  const [all, setAll] = useState(false);
  const covers = useCovers(mode, detail ? detail.items.slice(0, 30) : null);
  if (error) return <p className="err" style={{ padding: '6px 8px' }}>{error}</p>;
  if (!detail) return <p className="note" style={{ padding: '6px 8px' }}>불러오는 중…</p>;
  const { items, leaders, days } = detail;
  return (
    <>
    {!live && (
      <button
        className="gp-radio"
        onClick={() => onRadio?.({ year, month })}
      >
        <i aria-hidden="true" />레이스 라디오로 다시보기<span aria-hidden="true">›</span>
      </button>
    )}
    {leaders?.length > 0 && <RaceLeaders stints={leaders} days={days} live={live} />}
    {podium.length === 3 && (
      <div className="podium">
        {[podium[1], podium[0], podium[2]].map((t) => {
          const pic = coverOf(covers, mode, t);
          return (
            <div key={rowKey(t)} className={`pod p${t.rank}`}>
              <div className="pod-card">
                {pic && <span className="pod-bg" aria-hidden="true" style={{ backgroundImage: `url(${pic})` }} />}
                <Cover src={pic} size={t.rank === 1 ? 112 : 80} round={mode === 'artists'} />
                <b>{t.track ?? t.artist}</b>
                {t.track && <span>{artistLine(t)}</span>}
                <em>{t.plays.toLocaleString()}회</em>
              </div>
              {/* the step it stands on: P1 highest, with the points it took */}
              <div className="pod-step" data-tier={t.rank}>
                <span className="pod-n">{t.rank}</span>
                <small>{t.points} PTS</small>
              </div>
            </div>
          );
        })}
      </div>
    )}
    {podium.length === 3 && (
      <button className="share-btn quiet" onClick={() => shareCard({
        kicker: `${year} ${month}월 그랑프리 · 우승`,
        title: podium[0].track ?? podium[0].artist,
        sub: podium[0].track ? artistLine(podium[0]) : null,
        image: coverOf(covers, mode, podium[0]),
        round: mode === 'artists',
        stats: [[`${podium[0].plays.toLocaleString()}`, '재생'], ['25', 'PTS'], [`+${(podium[0].plays - podium[1].plays).toLocaleString()}`, '2위와 차이']],
        list: items.slice(0, 5).map((t) => ({ rank: `P${t.rank}`, title: t.track ?? t.artist, sub: t.track ? t.artist : '', value: `${t.points}pt`, image: coverOf(covers, mode, t) })),
        foot: `playcounters 그랑프리 · ${year}년 ${month}월 최종 순위`,
      }, `gp-${year}-${month}`)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10M6 7l4-4 4 4M4 12v4h12v-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        결과 이미지로 공유
      </button>
    )}
    <p className="gp-sub">{live ? '현재 순위' : '최종 순위'}<span>{live ? '잠정' : `${items.length}곡 완주`}</span></p>
    <ol className="classif">
      {items.filter((t) => (podium.length !== 3 || t.rank > 3) && (all || t.rank <= 20)).map((t) => {
        const gap = items[0] ? Number(items[0].plays) - Number(t.plays) : 0;
        return (
          <li key={rowKey(t)} data-out={t.rank > 10 || undefined}>
            <span className="cl-rk" data-tier={t.rank <= 3 ? t.rank : undefined}>{t.rank <= 10 ? `P${t.rank}` : t.rank}</span>
            <Cover src={coverOf(covers, mode, t)} size={32} round={mode === 'artists'} />
            <span className="cl-nm">
              <b>{t.track ?? t.artist}</b>
              {t.track && <small>{artistLine(t)}</small>}
            </span>
            <span className="cl-gap">{t.rank === 1 ? `${t.plays.toLocaleString()}회` : `+${gap.toLocaleString()}회`}</span>
            <span className="cl-pt">{!live && t.points > 0 ? `${t.points}` : ''}</span>
          </li>
        );
      })}
      {items.length > 20 && (
        <li className="classif-tail"><button className="classif-more" onClick={() => setAll((v) => !v)}>{all ? '접기' : `전체 보기 · ${items.length}곡`}</button></li>
      )}
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
            style={{ flexGrow: st.to - st.from + 1, ...fillStyle(st, 'to right') }}
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
            <li key={`${st.key}-${st.from}`} className="wash" style={washStyle(st)}>
              <span className="lead-days">
                {st.from === st.to ? `${st.from}일` : `${st.from}–${st.to}일`}
              </span>
              <span className="lead-nm">
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

/** A section heading, the same one every tab uses. */
function SectionHead({ title, sub, children }) {
  return <Section title={title} sub={sub}>{children}</Section>;
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
function LeaderCard({ tag, name, sub, points, wins, podiums, color, cover, round, onOpen }) {
  return (
    <button className="leader" style={{ '--team': color }} onClick={onOpen}>
      {cover && <span className="leader-bg" aria-hidden="true" style={{ backgroundImage: `url(${cover})` }} />}
      <span className="leader-id">
        <Cover src={cover} size={84} round={round} className="leader-cover" />
        <span className="leader-text">
          <span className="leader-tag">{tag}</span>
          <b className="leader-name">{name}</b>
          {sub && <span className="leader-sub">{sub}</span>}
        </span>
      </span>
      <span className="leader-stats">
        <span><b><Count value={points} /></b><small>PTS</small></span>
        <span><b><Count value={wins} /></b><small>{wins === 1 ? 'WIN' : 'WINS'}</small></span>
        <span><b><Count value={podiums} /></b><small>PODIUMS</small></span>
      </span>
    </button>
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
      constructors: constructors && projectStandings(constructors, m.top, (c) => c.artist_key, (t) => {
        const credits = t.credits ?? [{ name: t.artist, key: t.artist_key }];
        const shares = splitPoints(t.points, credits.length);
        return credits.map((c, idx) => ({ key: c.key, points: shares[idx], fields: { artist: c.name, artist_key: c.key } }));
      }),
    }),
    [m, drivers, constructors],
  );
  const activeKind = kind === 'constructors' && projected.constructors ? 'constructors' : 'drivers';
  const rows = projected[activeKind];
  // would this month, ending as it stands, settle the title? Nobody can take
  // more than a whole top ten a round (101pt) for a team, or a win (25pt) for a car
  const after = allTime ? null : 12 - m.month;
  const perRound = activeKind === 'constructors' ? 101 : 25;
  const gap = rows.length >= 2 ? rows[0].points - rows[1].points : 0;
  const settles = after != null && rows.length >= 2 && gap > perRound * after;

  return (
    <div className="live-card">
      <div className="live-head">
        <span className="live-badge"><i />LIVE</span>
        <span className="live-round">ROUND {round}</span>
        <b>{moLabel(m, allTime)} 그랑프리</b>
      </div>
      <ol className="live-top">
        {top.map((t) => (
          <li key={normRowKey(t)} className="wash" style={washStyle(t)}>
            <span className="live-pos">{t.rank}</span>
            <span className="live-nm">
              <b>{t.track ?? t.artist}</b>
              {t.track && <span>{artistLine(t)}</span>}
            </span>
            <span className="live-plays">{Number(t.plays).toLocaleString()}회</span>
          </li>
        ))}
      </ol>
      <div className="live-foot">
        <span>잠정</span>
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
        </div>
        {projected.constructors && (
          <div className="f1-tabs" role="tablist">
            <button role="tab" aria-selected={activeKind === 'drivers'} onClick={() => setKind('drivers')}>드라이버</button>
            <button role="tab" aria-selected={activeKind === 'constructors'} onClick={() => setKind('constructors')}>컨스트럭터</button>
          </div>
        )}
        <ol className="proj-list">
          {rows.slice(0, 10).map((r) => (
            <li key={r.key} className="wash" style={washStyle(r)}>
              <span className="proj-pos">{r.pos}</span>
              <Move from={r.prevPos} to={r.pos} />
              <span className="proj-nm">
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
        {settles && (
          <p className="proj-settle">
            <b>{rows[0].track ?? rows[0].artist}</b>, 이대로 끝나면 {activeKind === 'constructors' ? '컨스트럭터' : '드라이버'} 챔피언 확정
            <span>{after ? `남은 ${after}라운드 최대 ${perRound * after}pt < ${gap}pt 차` : '마지막 라운드'}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A finished season in one place: the records it set — most wins, the
 * longest run of wins, most podiums, the widest winning margin, the biggest
 * month — and every round's winner along a timeline.
 */
function SeasonReview({ year, rounds, drivers, mode, covers, onOpen }) {
  const winners = rounds.map((m) => ({ m, w: m.top.find((t) => t.rank === 1) ?? m.top[0], r2: m.top.find((t) => t.rank === 2) }));
  const name = (t) => t.track ?? t.artist;
  const mostWins = [...drivers].sort((a, b) => b.wins - a.wins || b.points - a.points)[0];
  const mostPods = [...drivers].sort((a, b) => b.podiums - a.podiums || b.points - a.points)[0];
  // the longest run of consecutive round wins
  let streak = { n: 0 };
  let run = { key: null, n: 0, from: null };
  for (const { m, w } of winners) {
    const k = normRowKey(w);
    run = run.key === k ? { ...run, n: run.n + 1, to: m } : { key: k, n: 1, from: m, to: m, t: w };
    if (run.n > streak.n) streak = { ...run };
  }
  const margin = winners.filter((x) => x.r2).map((x) => ({ ...x, gap: Number(x.w.plays) - Number(x.r2.plays) })).sort((a, b) => b.gap - a.gap)[0];
  const biggest = [...winners].sort((a, b) => Number(b.w.plays) - Number(a.w.plays))[0];
  const tiles = [
    mostWins && { k: '최다 우승', v: `${mostWins.wins}승`, t: mostWins },
    streak.n >= 2 && { k: '최장 연승', v: `${streak.n}연승`, t: streak.t, d: `${streak.from.month}–${streak.to.month}월` },
    mostPods && { k: '최다 포디움', v: `${mostPods.podiums}회`, t: mostPods },
    margin && { k: '최대 격차 우승', v: `+${margin.gap.toLocaleString()}회`, t: margin.w, d: `${margin.m.month}월` },
    biggest && { k: '한 달 최다 재생 우승', v: `${Number(biggest.w.plays).toLocaleString()}회`, t: biggest.w, d: `${biggest.m.month}월` },
  ].filter(Boolean);
  return (
    <section className="review">
      <div className="review-head">
        <span>Season Review</span>
        <b>{year} 시즌 결산</b>
      </div>
      <div className="review-tiles">
        {tiles.map((x) => (
          <button key={x.k} className="review-tile" onClick={() => onOpen(x.t)}>
            <small>{x.k}</small>
            <b>{x.v}</b>
            <span>{name(x.t)}{x.d ? ` · ${x.d}` : ''}</span>
          </button>
        ))}
      </div>
      <p className="review-k">라운드별 우승</p>
      <ol className="review-line">
        {winners.map(({ m, w }) => (
          <li key={`${m.year}-${m.month}`}>
            <button onClick={() => onOpen(w)}>
              <span className="review-mo">R{m.round} · {m.month}월</span>
              <Cover src={coverOf(covers, mode, w)} size={72} round={mode === 'artists'} />
              <b>{name(w)}</b>
              <small>{Number(w.plays).toLocaleString()}회</small>
            </button>
          </li>
        ))}
      </ol>
    </section>
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
  for (const t of liveTop) for (const { key: k, fields, points: share } of entriesOf(t)) {
    const r = rows.get(k) ?? {
      ...fields, key: k, prevPos: null, gained: 0, points: 0, wins: 0, podiums: 0, finishes: 0,
    };
    r.points += share ?? t.points;
    r.gained += share ?? t.points;
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
 * The season as F1 graphics draw it: one line per car, a dot for every
 * round. 포인트 plots the running total; 순위 plots where each stood in the
 * championship after that round, P1 at the top. Tap or hover a dot for that
 * round: the standing, the total, and how the race itself went. Drawn at the
 * width it's shown at, so the dots stay round.
 */
function SeasonChart({ labels, series, view }) {
  const [pick, setPick] = useState(null); // { key, i }
  const box = useRef(null);
  const [W, setW] = useState(680);
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ident = `${view}|${series.map((sr) => sr.key).join(',')}`;
  useEffect(() => { setPick(null); }, [ident]);

  const n = labels.length;
  const H = Math.round(Math.min(300, Math.max(220, W * 0.5)));
  const P = { l: 34, r: 14, t: 16, b: 28 };
  const x = (i) => P.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - P.l - P.r));
  const points = view === 'points';
  const val = (p) => (points ? p.cum : p.pos);
  const peak = points
    ? Math.max(1, ...series.map((s) => s.pts[n - 1]?.cum ?? 0))
    : Math.max(MAX_POS, ...series.flatMap((s) => s.pts.map((p) => p.pos ?? 0)));
  const y = points
    ? (v) => P.t + (1 - v / peak) * (H - P.t - P.b)
    : (v) => P.t + ((v - 1) / (peak - 1)) * (H - P.t - P.b);
  // every place has its line, F1-graphic style; a long field marks every fifth
  const ticks = points ? [0, Math.round(peak / 2), peak]
    : Array.from({ length: peak }, (_, k) => k + 1).filter((t) => peak <= 12 || t === 1 || t % 5 === 0);
  const xTicks = n <= 7 ? labels.map((_, i) => i) : [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1];

  // straight segments between rounds, the way a standings graphic joins them;
  // the round under way joins the last finished one with a dashed line
  const liveAt = series[0]?.pts.at(-1)?.live ? n - 1 : -1;
  const lines = series.map((s) => {
    const segs = [];
    let cur = [];
    s.pts.forEach((p, i) => {
      if (i === liveAt) return;
      if (val(p) == null) { if (cur.length) segs.push(cur); cur = []; return; }
      cur.push([x(i), y(val(p))]);
    });
    if (cur.length) segs.push(cur);
    const a = liveAt > 0 ? s.pts[liveAt - 1] : null;
    const b = liveAt > 0 ? s.pts[liveAt] : null;
    const liveSeg = a && b && val(a) != null && val(b) != null ? [[x(liveAt - 1), y(val(a))], [x(liveAt), y(val(b))]] : null;
    return { ...s, segs, liveSeg };
  });
  const lead = points ? lines[0] : null;
  const leadPath = lead?.segs[0]?.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');

  // no need to hit a dot: wherever the chart is touched, the nearest round, and
  // on it the line nearest the finger
  const pickAt = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * H;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - P.l) / Math.max(1, W - P.l - P.r)) * (n - 1))));
    let best = null;
    for (const sr of lines) {
      const v = val(sr.pts[i]);
      if (v == null) continue;
      const d = Math.abs(y(v) - py);
      if (!best || d < best.d) best = { key: sr.key, d };
    }
    if (best && (pick?.key !== best.key || pick?.i !== i)) setPick({ key: best.key, i });
  };
  const picked = pick && lines.find((s) => s.key === pick.key);
  const pp = picked?.pts[pick.i];

  return (
    <div className="chart-wrap" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img"
           aria-label={points ? '누적 포인트 추이' : '챔피언십 순위 추이'}
           onPointerDown={pickAt} onPointerMove={(e) => { if (e.pointerType === 'mouse' || e.buttons) pickAt(e); }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={P.l - 8} y={y(t)} className="chart-ytext" textAnchor="end" dominantBaseline="middle">
              {points ? t.toLocaleString() : `P${t}`}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 8} className="chart-ytext" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{labels[i]}</text>
        ))}
        {pick && <line x1={x(pick.i)} x2={x(pick.i)} y1={P.t} y2={H - P.b} className="chart-hover-line" />}
        {leadPath && (
          <>
            <defs>
              <linearGradient id="sc-lead" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={lead.color} stopOpacity=".26" />
                <stop offset="1" stopColor={lead.color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${leadPath} L${lead.segs[0].at(-1)[0]},${H - P.b} L${lead.segs[0][0][0]},${H - P.b} Z`} fill="url(#sc-lead)" />
          </>
        )}
        {[...lines].reverse().map((s) => s.segs.map((seg, k) => (
          <polyline key={`${s.key}-${k}`} points={seg.map(([px, py]) => `${px},${py}`).join(' ')} fill="none" stroke={s.color}
                    strokeWidth={s === lines[0] ? 3 : 2.25} strokeLinejoin="round" strokeLinecap="round"
                    opacity={pick && pick.key !== s.key ? 0.25 : 1} />
        )))}
        {[...lines].reverse().map((s) => s.liveSeg && (
          <polyline key={`${s.key}-live`} points={s.liveSeg.map(([px, py]) => `${px},${py}`).join(' ')} fill="none" stroke={s.color}
                    strokeWidth={s === lines[0] ? 3 : 2.25} strokeDasharray="5 5" strokeLinecap="round"
                    opacity={pick && pick.key !== s.key ? 0.2 : 0.85} />
        ))}
        {[...lines].reverse().map((s) => s.pts.map((p, i) => (val(p) == null ? null : (
          <circle key={`${s.key}-d${i}`} cx={x(i)} cy={y(val(p))} r={pick?.key === s.key && pick.i === i ? 6 : n > 14 ? 2.75 : 3.75}
                  fill={pick?.key === s.key && pick.i === i ? s.color : 'var(--surface)'} stroke={s.color} strokeWidth="2" strokeDasharray={i === liveAt ? '2.5 2' : undefined}
                  opacity={pick && pick.key !== s.key ? 0.25 : 1} className="chart-dot"
                  pointerEvents="none" />
        ))))}
      </svg>

      {/* the picked round, read out under the plot rather than over it, so no line is hidden */}
      <div className="sc-info" aria-live="polite">
        {pp ? (
          <>
            <i style={{ background: picked.color }} />
            <span className="sc-info-who">
              <b>{picked.label}</b>
              <small>{labels[pick.i]} GP{pp.live ? ' · 진행 중' : ''}</small>
            </span>
            <span className="sc-info-fig">
              <small>{pp.live ? '이대로 끝나면' : '챔피언십'}</small>
              <b>{pp.pos ? `P${pp.pos} · ${pp.cum.toLocaleString()}pt` : '아직 포인트 없음'}</b>
            </span>
            <span className="sc-info-fig">
              <small>{pp.live ? '지금 순위' : '이 라운드'}</small>
              <b>{pp.rank ? `P${pp.rank} · +${pp.gained}pt` : '포인트권 밖'}</b>
            </span>
          </>
        ) : <span className="sc-info-hint">그래프를 누르거나 밀면 가장 가까운 선의 그 라운드 기록이 나와요</span>}
      </div>
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
export default function Season({ mode, source, estimate, year, allTime, onSelect, onRadio, version }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
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
      .then((j) => { if (j.error) throw new Error(j.error); seedGenres(j.genres); setData(j); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [mode, source, estimate, year, allTime, version]);

  // The chart's own series: each shown driver's race-by-race record, plus —
  // in track mode — the same thing regrouped onto constructors. A
  // constructor has no monthly rank of its own coming out of the API (only
  // the cumulative championship does), so it's rebuilt here: sum that
  // month's charting tracks onto their artist, then rank the constructors
  // that actually scored against each other, month by month.
  const chartData = useMemo(() => {
    if (!data) return null;
    // Every finished round, and the one under way as a provisional last point
    // (drawn dashed): it hasn't scored anything yet, but it shows where things are heading.
    const months = data.months.filter((m) => !m.live || m.top.length);
    const labels = months.map((m) => moLabel(m, allTime));

    // where everyone stood in the championship after each round: every car that
    // ever scored, by running total, ties sharing a place
    const standingAfter = (perRound) => {
      const run = new Map();
      return perRound.map((round) => {
        for (const [k, p] of round) run.set(k, (run.get(k) ?? 0) + p);
        const rows = [...run.entries()].map(([k, points]) => ({ k, points })).sort((a, b) => b.points - a.points);
        const ranks = computeRanks(rows, 'points');
        return new Map(rows.map((r, i) => [r.k, ranks[i]]));
      });
    };
    const driverPos = standingAfter(months.map((m) => new Map(m.top.map((t) => [normRowKey(t), t.points]))));

    const driverSeries = data.drivers.slice(0, chartN).map((d) => {
      const key = normRowKey(d);
      let cum = 0;
      const pts = months.map((m, i) => {
        const hit = m.top.find((t) => normRowKey(t) === key);
        cum += hit ? hit.points : 0;
        return { rank: hit ? hit.rank : null, gained: hit ? hit.points : 0, cum, pos: driverPos[i].get(key) ?? null, live: Boolean(m.live) };
      });
      return { key, label: d.track ?? d.artist, artist: d.artist, pts };
    });

    let constructorSeries = null;
    if (data.constructors) {
      const monthly = months.map((m) => {
        const sums = new Map();
        for (const t of m.top) {
          const credits = t.credits ?? [{ key: t.artist_key }];
          const shares = splitPoints(t.points, credits.length);
          credits.forEach((c, idx) => sums.set(c.key, (sums.get(c.key) ?? 0) + shares[idx]));
        }
        const rows = [...sums.entries()].map(([artist_key, points]) => ({ artist_key, points }));
        rows.sort((a, b) => b.points - a.points);
        const ranks = computeRanks(rows, 'points');
        return new Map(rows.map((r, i) => [r.artist_key, { points: r.points, rank: ranks[i] }]));
      });
      const teamPos = standingAfter(monthly.map((byKey) => new Map([...byKey].map(([k, v]) => [k, v.points]))));
      constructorSeries = data.constructors.slice(0, chartN).map((c) => {
        let cum = 0;
        const pts = monthly.map((byKey, i) => {
          const hit = byKey.get(c.artist_key);
          cum += hit ? hit.points : 0;
          return { rank: hit ? hit.rank : null, gained: hit ? hit.points : 0, cum, pos: teamPos[i].get(c.artist_key) ?? null, live: Boolean(months[i].live) };
        });
        return { key: c.artist_key, label: c.artist, artist: c.artist, pts };
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

  // Genres for every artist whose color is on screen — drivers, constructors
  // and everyone credited — so colors sit in their genre's band here too.
  const genreNames = useMemo(() => {
    if (!data) return null;
    const names = new Set((data.constructors ?? []).map((c) => c.artist));
    for (const r of creditRows) for (const n of artistNames(r)) names.add(n);
    return [...names];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, creditRows, creditVersion]);
  useGenres(genreNames);

  const driverCovers = useCovers(mode, data ? data.drivers.slice(0, driverShown) : null);
  const teamCovers = useCovers('artists', data?.constructors ? data.constructors.slice(0, constructorShown) : null);
  // each finished round's winner, for the results list's pictures
  const winners = useMemo(() => (data ? data.months.filter((m) => m.top.length && !m.live)
    .map((m) => m.top.find((t) => t.rank === 1) ?? m.top[0]) : null), [data]);
  const winnerCovers = useCovers(mode, winners);
  const open = (r) => onSelect?.({ artist: r.artist, track: r.track ?? null, artist_key: r.artist_key, track_key: r.track_key ?? null });

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
        .then((j) => { if (!j.error) { seedGenres(j.genres); setData(j); } })
        .catch(() => {});
    }, 1500);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [creditVersion, data, creditRows]);

  if (error) return <p className="err">{error}</p>;
  if (!data) return <div className="skeleton" aria-label="불러오는 중"><i /><i /><i /><i /></div>;

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
  // Colored here rather than when the series were built, so a line moves
  // into its genre's band as soon as the genre arrives.
  // each line in its artist's own colour
  const activeSeries = (activeKind === 'constructors' ? chartData.constructorSeries : chartData.driverSeries)
    .map((sr) => ({ ...sr, color: artistColor(sr.artist) }));

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
              cover={coverOf(driverCovers, mode, driverChamp)} round={mode === 'artists'}
              onOpen={() => open(driverChamp)}
            />
          )}
          {constructorChamp && (
            <LeaderCard
              tag={constructorTag} name={constructorChamp.artist} sub={null}
              points={constructorChamp.points} wins={constructorChamp.wins} podiums={constructorChamp.podiums}
              color={artistColor(constructorChamp.artist)}
              cover={coverOf(teamCovers, 'artists', constructorChamp)} round
              onOpen={() => open(constructorChamp)}
            />
          )}
        </div>
      )}

      {complete && !allTime && results.length >= 3 && (
        <SeasonReview year={year} rounds={[...results].reverse()} drivers={drivers} mode={mode}
                      covers={winnerCovers} onOpen={open} />
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
          <SectionHead title="시즌 차트" >
            <div className="chart-controls">
              <Seg size="sm" options={[['points', '포인트'], ['position', '순위']]} value={chartView} onChange={setChartView} />
              <Seg size="sm" options={[[5, 'TOP 5'], [10, 'TOP 10']]} value={chartN} onChange={setChartN} />
            </div>
          </SectionHead>
          {chartData.constructorSeries && (
            <div className="f1-tabs" role="tablist">
              <button role="tab" aria-selected={activeKind === 'drivers'} onClick={() => setChartKind('drivers')}>드라이버</button>
              <button role="tab" aria-selected={activeKind === 'constructors'} onClick={() => setChartKind('constructors')}>컨스트럭터</button>
            </div>
          )}
          <div className="chart-card">
            <SeasonChart labels={chartData.labels} series={activeSeries} view={chartView} />
            <ol className="chart-key">
              {activeSeries.map((s, i) => (
                <li key={s.key} data-lead={i === 0 || undefined}><i style={{ background: s.color }} />{s.label}</li>
              ))}
            </ol>
          </div>

          <SectionHead title="드라이버 스탠딩" />
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
                  fill={fillStyle(d)} wash={washStyle(d)} share={d.points / (drivers[0].points || 1)}
                  cover={coverOf(driverCovers, mode, d)} round={mode === 'artists'}
                  onOpen={() => open(d)}
                />
              );
            })}
          </ol>
          {drivers.length > driverShown && (
            <div className="more">
              <button className="btn ghost" onClick={() => setDriverShown((n) => n + STANDINGS_PAGE * 2)}>
                더 보기 · {drivers.length - driverShown}
              </button>
            </div>
          )}

          {constructors && (
            <>
              <SectionHead title="컨스트럭터 스탠딩" />
              <ol className="season-list">
                <StandingsHead label="가수" />
                {constructors.slice(0, constructorShown).map((c, i) => (
                  <StandingsRow
                    key={c.artist_key} rank={i + 1}
                    name={c.artist} sub={null}
                    points={c.points} wins={c.wins} podiums={c.podiums}
                    pointsFinishes={c.pointsFinishes} finishes={c.finishes}
                    fill={{ background: artistColor(c.artist) }} wash={{ '--wash': artistColor(c.artist) }}
                    share={c.points / (constructors[0].points || 1)}
                    cover={coverOf(teamCovers, 'artists', c)} round
                    onOpen={() => open(c)}
                  />
                ))}
              </ol>
              {constructors.length > constructorShown && (
                <div className="more">
                  <button className="btn ghost" onClick={() => setConstructorShown((n) => n + STANDINGS_PAGE * 2)}>
                    더 보기 · {constructors.length - constructorShown}
                  </button>
                </div>
              )}
            </>
          )}

          <SectionHead title="레이스 결과" />
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
                    className="gp-cal-row wash" style={washStyle(winner)} role="button" tabIndex={0} aria-expanded={open}
                    onClick={toggle}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                  >
                    <span className="gp-rd"><Chequered />R{m.round}</span>
                    <span className="gp-mo">{moLabel(m, allTime)}</span>
                    <span className="gp-nm">
                      <Cover src={coverOf(winnerCovers, mode, winner)} size={36} round={mode === 'artists'} />
                      <span>
                        <b>{winner.track ?? winner.artist}</b>
                        {winner.track && <span>{artistLine(winner)}</span>}
                      </span>
                    </span>
                    <span className="gp-pt">{Number(winner.plays).toLocaleString()}회</span>
                    <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
                  </li>
                  {open && (
                    <li className="gp-history-wrap">
                      <GrandPrixResult
                        year={m.year} month={m.month} mode={mode} source={source} estimate={estimate} onRadio={onRadio}
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
