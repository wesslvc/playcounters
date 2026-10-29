import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { rpcAll } from '@/lib/rpcPage';
import { pointsForRank, splitPoints, F1_POINTS } from '@/lib/rank';
import { creditsFor, creditList } from '@/lib/storedCredits';
import { keyOf, nameOf, targetOf, ranked, rankingEvents, milestoneEvents, pick, pct } from '@/lib/radio';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TZ = 'Asia/Seoul';
const KST = 9 * 3600e3;
const DAY = 864e5;
/** How far back "then" is, for overtakes and gaps closing. */
const LOOKBACK = 3 * DAY;
const CACHE_MS = 20 * 60e3;

const cache = new Map();
const iso = (ms) => new Date(ms).toISOString();
const monthStart = (y, m) => Date.UTC(y, m - 1, 1) - KST;

/** One window's ranking, `limit` deep. */
async function standings(userId, from, to, mode, src, estimate, limit = 15) {
  if (to <= from) return [];
  const { data, error } = await rpcAll('top_items', {
    p_user: userId, p_from: iso(from), p_to: iso(to), p_mode: mode, p_tz: TZ,
    p_limit: limit, p_source: src, p_estimate: estimate,
  }, limit);
  if (error) throw new Error(error.message);
  return ranked(data ?? []);
}

/** Plays per day over the last `days` (or since `from`), by key. */
async function rate(userId, from, days, mode, src, estimate, limit) {
  const now = Date.now();
  const start = Math.max(from, now - days * DAY);
  const span = Math.max(0.5, (now - start) / DAY);
  const rows = await standings(userId, start, now + 60e3, mode, src, estimate, limit);
  return new Map(rows.map((r) => [keyOf(r), Number(r.plays) / span]));
}

/** The week's pace and the last three days', side by side. */
async function paceOf(userId, from, mode, src, estimate, limit) {
  const [p7, p3] = await Promise.all([
    rate(userId, from, 7, mode, src, estimate, limit),
    rate(userId, from, 3, mode, src, estimate, limit),
  ]);
  return { p7, p3 };
}

/** When each item was first ever played (ms), by key — the top few hundred. */
const debuts = new Map();
function firstPlays(userId, mode, src, estimate) {
  const k = `${userId}|${mode}|${src}|${estimate}`;
  const hit = debuts.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  const p = standings(userId, 0, Date.now() + 60e3, mode, src, estimate, 400)
    .then((rows) => new Map(rows.map((r) => [keyOf(r), Date.parse(r.first_at)])));
  p.catch(() => debuts.delete(k));
  debuts.set(k, { at: Date.now(), p });
  return p;
}

/** Items in this window's top ten that debuted inside it. */
function rookieEvents(rows, debut, from, to) {
  const out = [];
  rows.slice(0, 10).forEach((r, i) => {
    const first = debut.get(keyOf(r));
    if (first == null || first < from || first > to) return;
    const days = Math.max(1, Math.round((Math.min(to, Date.now()) - first) / DAY));
    out.push({
      kind: 'rookie', group: 'rookie', weight: 58 - i * 2, title: `루키 · P${i + 1}`,
      text: `${nameOf(r)}, 데뷔 ${days}일 만에 P${i + 1}`,
      detail: `${new Date(first + KST).getUTCMonth() + 1}월 ${new Date(first + KST).getUTCDate()}일 첫 재생 · ${Number(r.plays)}회`,
      stat: { value: `P${i + 1}`, unit: '루키' },
      targets: [targetOf(r)],
    });
  });
  return out.slice(0, 3);
}

/** A ranked window: the chart's, a Replay quarter, this month's Grand Prix. */
async function windowEvents(userId, { from, to, mode, src, estimate }) {
  const now = Date.now();
  const live = to > now;
  const end = Math.min(to, now + 60e3);
  const [cur, then, pace] = await Promise.all([
    standings(userId, from, end, mode, src, estimate),
    live && now - LOOKBACK > from ? standings(userId, from, now - LOOKBACK, mode, src, estimate) : null,
    live ? paceOf(userId, from, mode, src, estimate, 200) : null,
  ]);
  const events = rankingEvents(cur, then, pace, { live, endsAt: to });
  // debuts only mean something in a short window
  if (to - from <= 120 * DAY && from > 0) {
    events.push(...rookieEvents(cur, await firstPlays(userId, mode, src, estimate), from, to));
  }
  return events;
}

/**
 * Each contender's chance of the title. The rounds still to run are drawn
 * from the rounds already run — a whole month at a time, so only one car
 * can win each one — the recent months drawn more often, since form moves.
 */
function titleOdds(start, months, rounds, keys, runs = 4000) {
  const won = new Array(keys.length).fill(0);
  const weights = months.map((_, i) => i + 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const draw = () => {
    let x = Math.random() * sum;
    for (let i = 0; i < months.length; i++) if ((x -= weights[i]) < 0) return months[i];
    return months[months.length - 1];
  };
  for (let s = 0; s < runs; s++) {
    const tot = keys.map((k) => start.get(k) ?? 0);
    for (let r = 0; r < rounds; r++) {
      const m = draw();
      keys.forEach((k, i) => { tot[i] += m.get(k) ?? 0; });
    }
    const best = Math.max(...tot);
    const top = tot.flatMap((t, i) => (t === best ? [i] : []));
    for (const i of top) won[i] += 1 / top.length;
  }
  return won.map((w) => w / runs);
}

/**
 * The championship: this month's race; the champion, or the leader and
 * whether it's settled; places no remaining round can change; and what
 * the standings become if this month ended now.
 */
async function seasonEvents(userId, { year, mode, src, estimate }) {
  const kst = new Date(Date.now() + KST);
  const y = year ?? kst.getUTCFullYear();
  const isNow = y === kst.getUTCFullYear();
  const lastM = isNow ? kst.getUTCMonth() + 1 : 12;
  const events = [];

  if (isNow) {
    const m = lastM;
    const race = await windowEvents(userId, { from: monthStart(y, m), to: monthStart(y, m + 1), mode, src, estimate });
    for (const e of race) events.push({ ...e, title: `${m}월 GP · ${e.title}`, ...(e.kind === 'lead' ? { weight: e.weight + 4 } : {}) });
  }

  const { data, error } = await rpcAll('season_races', {
    p_user: userId, p_from: iso(monthStart(y, 1)), p_to: iso(monthStart(y, lastM + 1)),
    p_mode: mode, p_tz: TZ, p_source: src, p_estimate: estimate,
  }, 5000);
  if (error) throw new Error(error.message);

  const total = (rows) => {
    const by = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      const c = by.get(k) ?? { ...targetOf(r), pts: 0, wins: 0 };
      c.pts += pointsForRank(r.place);
      if (r.place === 1) c.wins += 1;
      by.set(k, c);
    }
    return [...by.values()].sort((a, b) => b.pts - a.pts || b.wins - a.wins);
  };
  const done = total((data ?? []).filter((r) => !(isNow && r.yr === y && r.mo === lastM)));
  const ifNow = total(data ?? []);
  const doneRank = new Map(done.map((c, i) => [keyOf(c), i + 1]));
  // points still to be won: this month's race and every month after it
  const roundsLeft = isNow ? 12 - lastM + 1 : 0;
  const maxLeft = F1_POINTS[0] * roundsLeft;
  const group = 'champ';

  // each finished round's points, by car, oldest first
  const byMonth = new Map();
  for (const r of data ?? []) {
    if (isNow && r.yr === y && r.mo === lastM) continue;
    const m = byMonth.get(r.mo) ?? new Map();
    m.set(keyOf(r), (m.get(keyOf(r)) ?? 0) + pointsForRank(r.place));
    byMonth.set(r.mo, m);
  }
  const months = [...byMonth.keys()].sort((a, b) => a - b).map((k) => byMonth.get(k));

  // the title odds: this month as it stands, the rest drawn from the season so far
  if (isNow && ifNow.length >= 2 && months.length >= 2) {
    const field = ifNow.slice(0, 10);
    const start = new Map(field.map((c) => [keyOf(c), c.pts]));
    const odds = titleOdds(start, months, 12 - lastM, field.map(keyOf))
      .map((p, i) => ({ c: field[i], p }))
      .sort((a, b) => b.p - a.p)
      .slice(0, 3);
    // still able to win it on paper, with this month ending as it stands
    const alive = ifNow.filter((c) => c.pts + F1_POINTS[0] * (12 - lastM) >= ifNow[0].pts).length;
    const [f] = odds;
    events.push({
      kind: 'odds', group, weight: 94, title: `${y} 챔피언 가능성`,
      text: f.p >= 0.995
        ? `${nameOf(f.c)}, 시뮬레이션상 챔피언 확실시`
        : `${nameOf(f.c)}, 챔피언 가능성 ${pct(f.p)}%${odds[1] ? ` · ${nameOf(odds[1].c)} ${pct(odds[1].p)}%` : ''}`,
      detail: `남은 ${12 - lastM}라운드를 지난 라운드들로 4,000번 돌려본 결과 · 이번 달이 이대로 끝나면 산술적 우승 가능 ${alive}명`,
      stat: { value: `${pct(f.p)}%`, unit: '챔피언' },
      odds: odds.map(({ c, p }) => ({ ...targetOf(c), pct: pct(p), pts: c.pts })),
      targets: odds.map(({ c }) => targetOf(c)),
    });
  }

  // who has won most, who stands on the podium most, who is in form
  const tally = new Map();
  for (const r of data ?? []) {
    if (isNow && r.yr === y && r.mo === lastM) continue;
    const t = tally.get(keyOf(r)) ?? { ...targetOf(r), wins: 0, podiums: 0, last3: 0 };
    if (r.place === 1) t.wins += 1;
    if (r.place <= 3) t.podiums += 1;
    tally.set(keyOf(r), t);
  }
  const recent = months.slice(-3);
  for (const [k, t] of tally) t.last3 = recent.reduce((a, m) => a + (m.get(k) ?? 0), 0);
  const all = [...tally.values()];
  const mostWins = [...all].sort((a, b) => b.wins - a.wins || b.podiums - a.podiums)[0];
  const mostPods = [...all].sort((a, b) => b.podiums - a.podiums || b.wins - a.wins)[0];
  const form = [...all].sort((a, b) => b.last3 - a.last3)[0];
  if (mostWins?.wins >= 2) {
    events.push({
      kind: 'wins', group, weight: 52, title: '최다 우승',
      text: `${nameOf(mostWins)}, 시즌 ${mostWins.wins}승으로 최다 우승`,
      detail: `포디움 ${mostWins.podiums}회`,
      stat: { value: String(mostWins.wins), unit: '승' }, targets: [targetOf(mostWins)],
    });
  }
  if (mostPods && mostPods !== mostWins && mostPods.podiums >= 3) {
    events.push({
      kind: 'podiums', group, weight: 44, title: '최다 포디움',
      text: `${nameOf(mostPods)}, 포디움 ${mostPods.podiums}회로 가장 꾸준함`,
      detail: `우승 ${mostPods.wins}회`,
      stat: { value: String(mostPods.podiums), unit: '포디움' }, targets: [targetOf(mostPods)],
    });
  }
  if (form && recent.length === 3 && form.last3 > 0) {
    events.push({
      kind: 'form', group, weight: 48, title: '최근 폼',
      text: `${nameOf(form)}, 최근 3라운드 ${form.last3}pt로 가장 뜨거움`,
      detail: `라운드 평균 ${Math.round(form.last3 / 3)}pt`,
      stat: { value: String(form.last3), unit: 'pt / 3R' }, targets: [targetOf(form)],
    });
  }

  // what this month does to the gap at the top
  if (isNow && done.length >= 2 && ifNow.length >= 2) {
    const before = done[0].pts - done[1].pts;
    const after = ifNow[0].pts - ifNow[1].pts;
    const sameLead = keyOf(done[0]) === keyOf(ifNow[0]);
    // would this month, ending as it stands, settle the title?
    const settles = after > F1_POINTS[0] * (12 - lastM);
    if (settles || !sameLead || Math.abs(after - before) >= 5) {
      events.push({
        kind: 'swing', group, weight: settles ? 85 : sameLead ? 58 : 80, title: `${lastM}월 GP 반영 시`,
        text: settles
          ? `${nameOf(ifNow[0])}, ${lastM}월이 이대로 끝나면 ${y} 챔피언 확정 · 격차 ${before}pt → ${after}pt`
          : sameLead
            ? `${nameOf(ifNow[0])} 선두 격차 ${before}pt → ${after}pt${after > before ? ' 확대' : ' 축소'}`
            : `${nameOf(ifNow[0])}, 이번 달 결과대로면 챔피언십 선두 탈환`,
        detail: `지금 순위로 ${lastM}월이 끝날 때`,
        stat: { value: `${after}`, unit: 'pt 차' },
        duel: { sides: [{ pos: 2, pts: ifNow[1].pts }, { pos: 1, pts: ifNow[0].pts }], gap: after, unit: 'pt', eta: null },
        targets: [targetOf(ifNow[1]), targetOf(ifNow[0])],
      });
    }
  }

  if (done.length >= 2) {
    const [a, b] = done;
    const lead = a.pts - b.pts;
    if (!isNow) {
      events.push({
        kind: 'champion', group, weight: 95, title: `${y} 챔피언`,
        text: `${nameOf(a)}, ${y} 시즌 챔피언`,
        detail: `${a.pts}pt · ${a.wins}승 · 2위 ${nameOf(b)}와(과) ${lead}pt 차`,
        stat: { value: String(a.pts), unit: 'pt' }, targets: [targetOf(a)],
      });
    } else if (lead > maxLeft) {
      events.push({
        kind: 'champion', group, weight: 96, title: `${y} 챔피언 조기 확정`,
        text: `${nameOf(a)}, 남은 ${roundsLeft}라운드와 상관없이 ${y} 챔피언 확정`,
        detail: `${lead}pt 차 · 남은 최대 ${maxLeft}pt`,
        stat: { value: String(a.pts), unit: 'pt' }, targets: [targetOf(a)],
      });
    } else {
      events.push({
        kind: 'champion', group, weight: 60, title: `${y} 챔피언십 선두`,
        text: `${nameOf(a)}, ${lead}pt 차 선두 · 확정까지 ${maxLeft - lead + 1}pt 더`,
        detail: `남은 ${roundsLeft}라운드 최대 ${maxLeft}pt · 2위 ${nameOf(b)}`,
        stat: { value: String(lead), unit: 'pt 차' }, targets: [targetOf(a)],
      });
    }

    // places no remaining round can change
    if (roundsLeft > 0) {
      const locked = [];
      for (let i = 0; i < Math.min(10, done.length); i++) {
        const up = i === 0 || done[i - 1].pts - done[i].pts > maxLeft;
        const down = i === done.length - 1 || done[i].pts - done[i + 1].pts > maxLeft;
        if (up && down) locked.push(i);
      }
      if (locked.length > (lead > maxLeft ? 1 : 0)) {
        events.push({
          kind: 'locked', group, weight: 75, title: '확정된 순위',
          text: locked.map((i) => `P${i + 1} ${nameOf(done[i])}`).join(' · '),
          detail: `남은 최대 ${maxLeft}pt로 바뀔 수 없는 순위`,
          stat: { value: String(locked.length), unit: '자리' }, targets: locked.slice(0, 2).map((i) => targetOf(done[i])),
        });
      }
    }
  }

  const isLive = (r) => isNow && r.yr === y && r.mo === lastM;
  const doneRows = (data ?? []).filter((r) => !isLive(r));
  const liveRows = (data ?? []).filter(isLive).sort((a, b) => a.place - b.place);
  const doneMos = [...new Set(doneRows.map((r) => r.mo))].sort((a, b) => a - b);
  const lastMo = doneMos[doneMos.length - 1];

  // ---- streaks, first wins, last round's winner ----
  const places = new Map(); // key -> Map(month -> place)
  for (const r of doneRows) {
    const m = places.get(keyOf(r)) ?? new Map();
    m.set(r.mo, r.place);
    places.set(keyOf(r), m);
  }
  const winRun = (k, upTo) => { // wins in a row, ending at month upTo
    let n = 0;
    for (let i = doneMos.indexOf(upTo); i >= 0 && places.get(k)?.get(doneMos[i]) === 1; i--) n++;
    return n;
  };
  let bestRun = null;
  for (const r of doneRows.filter((x) => x.place === 1)) {
    const n = winRun(keyOf(r), r.mo);
    if (n >= 2 && (!bestRun || n > bestRun.n)) bestRun = { r, n };
  }
  if (bestRun) {
    events.push({
      kind: 'win-streak', group, weight: 46 + bestRun.n, title: '최다 연승',
      text: `${nameOf(bestRun.r)}, 시즌 최다 ${bestRun.n}연승`,
      detail: `${doneMos[doneMos.indexOf(bestRun.r.mo) - bestRun.n + 1]}~${bestRun.r.mo}월 GP`,
      stat: { value: String(bestRun.n), unit: '연승' }, targets: [targetOf(bestRun.r)],
    });
  }
  // the longest run of scoring rounds still going
  let scoring = null;
  for (const [k, m] of places) {
    let n = 0;
    for (let i = doneMos.length - 1; i >= 0 && m.has(doneMos[i]); i--) n++;
    if (n >= 4 && (!scoring || n > scoring.n)) scoring = { k, n };
  }
  if (scoring) {
    const r = doneRows.find((x) => keyOf(x) === scoring.k);
    events.push({
      kind: 'points-streak', group, weight: 42 + scoring.n / 2, title: '연속 포인트',
      text: `${nameOf(r)}, ${scoring.n}라운드 연속 포인트 피니시`,
      detail: '매달 TOP 10 안에 든 연속 기록',
      stat: { value: String(scoring.n), unit: '라운드' }, targets: [targetOf(r)],
    });
  }
  if (liveRows.length && lastMo) {
    const p1 = liveRows[0];
    const run = winRun(keyOf(p1), lastMo);
    const wins = [...(places.get(keyOf(p1))?.values() ?? [])].filter((x) => x === 1).length;
    if (run >= 1) {
      events.push({
        kind: 'streak-on', group, weight: 64 + run, title: `${lastM}월 GP · ${run + 1}연승 도전`,
        text: `${nameOf(p1)}, 이대로면 ${run + 1}연승`,
        detail: `${lastMo}월 GP 우승에 이어 ${lastM}월도 선두`,
        stat: { value: String(run + 1), unit: '연승' }, targets: [targetOf(p1)],
      });
    } else if (wins === 0) {
      events.push({
        kind: 'first-win', group, weight: 66, title: `${lastM}월 GP · 첫 우승 도전`,
        text: `${nameOf(p1)}, ${y} 시즌 첫 GP 우승 눈앞`,
        detail: `${lastM}월 GP 현재 선두`,
        stat: { value: 'P1' }, targets: [targetOf(p1)],
      });
    }
    // last round's winner, and how this month is going for them
    const champ = doneRows.find((x) => x.mo === lastMo && x.place === 1);
    if (champ && keyOf(champ) !== keyOf(p1)) {
      const now = liveRows.find((x) => keyOf(x) === keyOf(champ));
      events.push({
        kind: 'defending', group, weight: now && now.place <= 3 ? 40 : 54, title: '지난 라운드 우승',
        text: now
          ? `${lastMo}월 우승 ${nameOf(champ)}, ${lastM}월은 P${now.place}`
          : `${lastMo}월 우승 ${nameOf(champ)}, ${lastM}월은 포인트권 밖`,
        detail: now ? `${pointsForRank(now.place)}pt 페이스` : '이대로면 0pt',
        stat: { value: now ? `P${now.place}` : '–' }, targets: [targetOf(champ)],
      });
    }
  }

  // ---- constructors: every track's points onto the artists credited on it ----
  if (mode === 'tracks') {
    const credits = await creditsFor(data ?? []);
    const teams = (rows) => {
      const by = new Map();
      for (const r of rows) {
        const list = creditList(r, credits);
        const shares = splitPoints(pointsForRank(r.place), list.length);
        list.forEach(({ name, key }, i) => {
          const c = by.get(key) ?? { artist: name, track: null, artist_key: key, track_key: null, pts: 0, wins: 0, podiums: 0, cars: 0 };
          if (key === r.artist_key) c.artist = r.artist;
          c.pts += shares[i];
          c.cars += 1;
          if (r.place === 1) c.wins += 1;
          if (r.place <= 3) c.podiums += 1;
          by.set(key, c);
        });
      }
      return [...by.values()].sort((a, b) => b.pts - a.pts || b.wins - a.wins);
    };
    const cx = 'cx';
    const cDone = teams(doneRows);
    const cNow = teams(data ?? []);
    const cMaxLeft = F1_POINTS.reduce((a, b) => a + b, 0) * roundsLeft;
    if (cDone.length >= 2) {
      const [a, b] = cDone;
      const lead = a.pts - b.pts;
      events.push({
        kind: 'cx-lead', group: cx, weight: !isNow ? 90 : lead > cMaxLeft ? 88 : 62,
        title: !isNow ? `${y} 컨스트럭터 챔피언` : lead > cMaxLeft ? '컨스트럭터 조기 확정' : '컨스트럭터 선두',
        text: !isNow
          ? `${a.artist}, ${y} 컨스트럭터 챔피언 · ${lead}pt 차`
          : lead > cMaxLeft
            ? `${a.artist}, 남은 라운드와 상관없이 컨스트럭터 타이틀 확정`
            : `${a.artist}, 컨스트럭터 ${lead}pt 차 선두 · ${a.wins}승 ${a.podiums}포디움`,
        detail: `2위 ${b.artist} · 팀 득점 ${a.cars}회`,
        stat: { value: String(lead), unit: 'pt 차' },
        duel: { sides: [{ pos: 1, pts: a.pts }, { pos: 2, pts: b.pts }], gap: lead, unit: 'pt', eta: null, lead: true },
        targets: [targetOf(a), targetOf(b)],
      });
    }
    if (isNow && cNow.length >= 2 && months.length >= 2) {
      const field = cNow.slice(0, 8);
      const cMonths = doneMos.map((mo) => new Map(teams(doneRows.filter((r) => r.mo === mo)).map((c) => [c.artist_key, c.pts])));
      const odds = titleOdds(new Map(field.map((c) => [c.artist_key, c.pts])), cMonths, 12 - lastM, field.map((c) => c.artist_key))
        .map((p, i) => ({ c: field[i], p })).sort((a, b) => b.p - a.p).slice(0, 3);
      events.push({
        kind: 'cx-odds', group: cx, weight: 84, title: `${y} 컨스트럭터 타이틀 가능성`,
        text: `${odds[0].c.artist}, 타이틀 가능성 ${pct(odds[0].p)}%${odds[1] ? ` · ${odds[1].c.artist} ${pct(odds[1].p)}%` : ''}`,
        detail: `남은 ${12 - lastM}라운드 시뮬레이션 4,000회 · 이번 달은 현재 순위 기준`,
        stat: { value: `${pct(odds[0].p)}%`, unit: '타이틀' },
        odds: odds.map(({ c, p }) => ({ ...targetOf(c), pct: pct(p), pts: c.pts })),
        targets: odds.map(({ c }) => targetOf(c)),
      });
    }
    // swap at the top if this month ended now
    if (isNow && cDone[0] && cNow[0] && cDone[0].artist_key !== cNow[0].artist_key) {
      events.push({
        kind: 'cx-swing', group: cx, weight: 82, title: `${lastM}월 GP 반영 시`,
        text: `${cNow[0].artist}, 이번 달 결과대로면 컨스트럭터 선두 탈환`,
        detail: `${cDone[0].artist} ${cDone[0].pts}pt → ${cNow.find((c) => c.artist_key === cDone[0].artist_key)?.pts ?? cDone[0].pts}pt`,
        stat: { value: String(cNow[0].pts), unit: 'pt' }, targets: [targetOf(cNow[0])],
      });
    }
    cNow.slice(1, 6).forEach((c, i) => {
      const ahead = cNow[i];
      const gap = ahead.pts - c.pts;
      if (gap <= 15) {
        events.push({
          kind: 'cx-battle', group: cx, weight: 50 - i, title: `컨스트럭터 P${i + 1} 경쟁`,
          text: `${ahead.artist} vs ${c.artist}, ${gap === 0 ? '동점' : `${gap}pt 차`}`,
          detail: isNow ? '이번 달 결과 포함 시' : null,
          stat: gap === 0 ? { value: '동점' } : { value: String(gap), unit: 'pt 차' },
          duel: { sides: [{ pos: i + 2, pts: c.pts }, { pos: i + 1, pts: ahead.pts }], gap, unit: 'pt', eta: null },
          targets: [targetOf(c), targetOf(ahead)],
        });
      }
    });
    // this month: one team filling the top of the order
    if (liveRows.length >= 2) {
      const [t] = teams(liveRows);
      const top10 = liveRows.filter((r) => r.artist_key === t.artist_key).length;
      const oneTwo = liveRows[0].artist_key === liveRows[1].artist_key;
      let lockout = 0;
      while (lockout < liveRows.length && liveRows[lockout].artist_key === liveRows[0].artist_key) lockout++;
      if (oneTwo || top10 >= 3) {
        events.push({
          kind: 'cx-month', group: cx, weight: lockout >= 3 ? 78 : 68, title: `${lastM}월 GP · ${t.artist}`,
          text: lockout >= 3
            ? `${t.artist}, ${lastM}월 GP P1~P${lockout} 독식 중 · TOP 10에 ${top10}곡`
            : oneTwo
              ? `${t.artist}, ${lastM}월 GP 원투 피니시 페이스 · TOP 10에 ${top10}곡`
              : `${t.artist}, ${lastM}월 GP TOP 10에 ${top10}곡`,
          detail: `이대로면 팀 포인트 +${t.pts}pt`,
          stat: { value: `+${t.pts}`, unit: 'pt' },
          targets: [targetOf(t)],
        });
      }
    }
    // the season's one-two finishes
    const oneTwos = new Map();
    for (const mo of doneMos) {
      const [p1, p2] = doneRows.filter((r) => r.mo === mo).sort((a, b) => a.place - b.place);
      if (p1 && p2 && p1.artist_key === p2.artist_key) {
        const o = oneTwos.get(p1.artist_key) ?? { r: p1, n: 0, mos: [] };
        o.n += 1;
        o.mos.push(mo);
        oneTwos.set(p1.artist_key, o);
      }
    }
    const most12 = [...oneTwos.values()].sort((a, b) => b.n - a.n)[0];
    if (most12) {
      events.push({
        kind: 'cx-1-2', group: cx, weight: 45 + most12.n, title: '원투 피니시',
        text: `${most12.r.artist}, 시즌 원투 피니시 ${most12.n}회`,
        detail: `${most12.mos.join(', ')}월 GP`,
        stat: { value: String(most12.n), unit: '회' },
        targets: [{ artist: most12.r.artist, track: null, artist_key: most12.r.artist_key, track_key: null }],
      });
    }
  }

  // ---- rookies: first ever played this season ----
  const debut = await firstPlays(userId, mode, src, estimate);
  const yStart = monthStart(y, 1);
  const rookies = ifNow
    .map((c, i) => ({ c, pos: i + 1, first: debut.get(keyOf(c)) }))
    .filter((x) => x.first != null && x.first >= yStart);
  if (rookies.length) {
    const [r1, r2] = rookies;
    const wins1 = r1.c.wins;
    events.push({
      kind: 'rookie', group: 'rookie', weight: 63, title: r2 ? '올해의 루키 경쟁' : '올해의 루키',
      text: `${nameOf(r1.c)}, 데뷔 시즌 챔피언십 P${r1.pos}${wins1 ? ` · ${wins1}승` : ''}${r2 ? ` · 루키 2위 ${nameOf(r2.c)}에 ${r1.c.pts - r2.c.pts}pt 앞섬` : ''}`,
      detail: `${new Date(r1.first + KST).getUTCMonth() + 1}월 첫 재생`,
      stat: { value: `P${r1.pos}`, unit: '루키 1위' },
      ...(r2 ? { duel: { sides: [{ pos: r2.pos, pts: r2.c.pts }, { pos: r1.pos, pts: r1.c.pts }], gap: r1.c.pts - r2.c.pts, unit: 'pt', eta: null } } : {}),
      targets: r2 ? [targetOf(r2.c), targetOf(r1.c)] : [targetOf(r1.c)],
    });
    events.push({
      kind: 'rookie-class', group: 'rookie', weight: 41, title: `${y} 루키 클래스`,
      text: `올해 데뷔한 ${rookies.length}곡이 포인트 획득 · 최고 P${r1.pos}`,
      detail: rookies.slice(0, 3).map((x) => nameOf(x.c)).join(', '),
      stat: { value: String(rookies.length), unit: '곡' },
      targets: rookies.slice(0, 2).map((x) => targetOf(x.c)),
    });
  }

  ifNow.slice(0, 8).forEach((c, i) => {
    const pos = i + 1;
    const was = doneRank.get(keyOf(c));
    if (isNow && was && was !== pos) {
      events.push({
        kind: 'projected', group, weight: was > pos ? 70 - pos : 50 - pos,
        title: `챔피언십 P${was} → P${pos} 예상`,
        text: `이번 달이 지금 순위로 끝나면 ${nameOf(c)} P${was}에서 P${pos}로`,
        detail: `${c.pts}pt`,
        stat: { value: `P${pos}` }, targets: [targetOf(c)],
      });
    }
    if (i > 0) {
      const ahead = ifNow[i - 1];
      const gap = ahead.pts - c.pts;
      if (gap <= 10) {
        events.push({
          kind: 'battle', group, weight: 60 - pos,
          title: `챔피언십 P${pos - 1} 경쟁`,
          text: `${nameOf(ahead)} vs ${nameOf(c)}, ${gap === 0 ? '동점' : `${gap}pt 차`}`,
          detail: isNow ? '이번 달 결과 포함 시' : null,
          stat: gap === 0 ? { value: '동점' } : { value: String(gap), unit: 'pt 차' },
          duel: { sides: [{ pos, pts: c.pts }, { pos: pos - 1, pts: ahead.pts }], gap, unit: 'pt', eta: null },
          targets: [targetOf(c), targetOf(ahead)],
        });
      }
    }
  });
  return events;
}

/**
 * A finished Grand Prix, told after the flag: how it was won, who led when,
 * who came through the field in the second half, the finishes decided by a
 * play, debut-month runs, and what the race did to both championships.
 */
async function gpEvents(userId, { year, month, mode, src, estimate }) {
  const from = monthStart(year, month);
  const to = monthStart(year, month + 1);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const args = { p_user: userId, p_from: iso(from), p_to: iso(to), p_mode: mode, p_tz: TZ, p_source: src, p_estimate: estimate };
  const [fin, half, lead, season, debut] = await Promise.all([
    standings(userId, from, to, mode, src, estimate, 30),
    standings(userId, from, from + 15 * DAY, mode, src, estimate, 40),
    db.rpc('month_leaders', args),
    rpcAll('season_races', { ...args, p_from: iso(monthStart(year, 1)) }, 5000),
    firstPlays(userId, mode, src, estimate),
  ]);
  if (season.error) throw new Error(season.error.message);
  const events = [];
  const [w, p2] = fin;
  if (!w) return events;
  const plays = (r) => Number(r.plays);
  const finPos = new Map(fin.map((r, i) => [keyOf(r), i + 1]));
  const halfPos = new Map(half.map((r, i) => [keyOf(r), i + 1]));
  const gp = `${month}월 GP`;

  // the win
  if (p2) {
    const gap = plays(w) - plays(p2);
    const top10 = fin.slice(0, 10).reduce((a, r) => a + plays(r), 0);
    const close = gap <= Math.max(2, plays(w) * 0.02);
    const romp = gap >= plays(p2) * 0.3;
    events.push({
      kind: 'gp-win', group: 'lead', weight: 99,
      title: `${gp} · ${romp ? '압도적 우승' : close ? '접전 끝 우승' : '우승'}`,
      text: gap === 0
        ? `${nameOf(w)} vs ${nameOf(p2)}, 둘 다 ${plays(w)}회 · 마지막 재생 순서로 ${nameOf(w)} 우승`
        : `${nameOf(w)}, ${gp} 우승 · 2위 ${nameOf(p2)}에 ${gap}회 차`,
      detail: `TOP 10 재생의 ${Math.round((plays(w) / top10) * 100)}% · ${plays(w)}회`,
      stat: gap === 0 ? { value: '동률' } : { value: String(gap), unit: '회 차' },
      duel: { sides: [{ pos: 1, plays: plays(w) }, { pos: 2, plays: plays(p2) }], gap, eta: null, lead: true, label: '우승 격차' },
      targets: [targetOf(w), targetOf(p2)],
    });
  }

  // who led when, from the day-by-day leaders
  const stints = [];
  for (const d of lead.error ? [] : lead.data ?? []) {
    const k = `${d.artist_key}\u0000${d.track_key ?? ''}`;
    const day = Number(String(d.day).slice(8, 10));
    const prev = stints[stints.length - 1];
    if (prev && prev.k === k) { prev.to = day; continue; }
    stints.push({ k, from: day, to: day, row: fin.find((r) => keyOf(r) === k) ?? { artist: d.artist_key, track: d.track_key, artist_key: d.artist_key, track_key: d.track_key } });
  }
  if (stints.length) stints[stints.length - 1].to = lastDay;
  if (stints.length === 1) {
    events.push({
      kind: 'gp-wire', group: 'lead', weight: 86, title: `${gp} · 폴 투 윈`,
      text: `${nameOf(w)}, 첫날부터 ${lastDay}일까지 단 한 번도 선두를 내주지 않음`,
      detail: '처음부터 끝까지 선두',
      stat: { value: `${lastDay}일`, unit: '선두' }, targets: [targetOf(w)],
    });
  } else if (stints.length > 1) {
    const days = new Map();
    for (const st of stints) days.set(st.k, (days.get(st.k) ?? 0) + st.to - st.from + 1);
    const [lk, ln] = [...days].sort((a, b) => b[1] - a[1])[0];
    const longest = stints.find((st) => st.k === lk).row;
    events.push({
      kind: 'gp-changes', group: 'lead', weight: 70 + Math.min(10, stints.length),
      title: `${gp} · 선두 교체 ${stints.length - 1}회`,
      text: `${gp} 선두 교체 ${stints.length - 1}회 · 최장 선두 ${nameOf(longest)} ${ln}일`,
      detail: stints.slice(-4).map((st) => `${st.from}일 ${nameOf(st.row)}`).join(' → '),
      stat: { value: String(stints.length - 1), unit: '회 교체' }, targets: [targetOf(longest)],
    });
    const last = stints[stints.length - 1];
    if (last.from >= lastDay - 6) {
      events.push({
        kind: 'gp-late', group: 'move', weight: 90, title: `${gp} · 막판 역전`,
        text: `${nameOf(w)}, ${last.from}일에 선두를 빼앗아 역전 우승`,
        detail: `직전 선두 ${nameOf(stints[stints.length - 2].row)}`,
        stat: { value: `${last.from}일`, unit: '역전' }, targets: [targetOf(w)],
      });
    }
    const pole = stints[0];
    if (pole.k !== keyOf(w)) {
      const p = finPos.get(pole.k);
      events.push({
        kind: 'gp-pole', group: 'move', weight: 52, title: `${gp} · 폴 포지션`,
        text: `첫날 선두 ${nameOf(pole.row)}, 최종 ${p ? `P${p}` : '포인트권 밖'}`,
        detail: pole.from === pole.to ? `${pole.from}일 선두` : `${pole.from}~${pole.to}일 선두`,
        stat: { value: p ? `P${p}` : '–' }, targets: [targetOf(pole.row)],
      });
    }
  }

  // the second half: who came through, who faded
  const moves = fin.slice(0, 10).map((r, i) => ({ r, pos: i + 1, was: halfPos.get(keyOf(r)) ?? 41 }));
  const up = [...moves].sort((a, b) => (b.was - b.pos) - (a.was - a.pos))[0];
  if (up && up.was - up.pos >= 3) {
    events.push({
      kind: 'gp-charge', group: 'move', weight: 74, title: `${gp} · 후반 질주`,
      text: `${nameOf(up.r)}, 15일 기준 ${up.was > 40 ? '40위 밖' : `P${up.was}`}에서 최종 P${up.pos}`,
      detail: `${up.was > 40 ? '40위 밖' : `P${up.was}`} → P${up.pos} · ${plays(up.r)}회`,
      stat: up.was > 40 ? { value: `P${up.pos}`, unit: '40위 밖에서' } : { value: `+${up.was - up.pos}`, unit: '계단' }, targets: [targetOf(up.r)],
    });
  }
  const down = half.slice(0, 5)
    .map((r, i) => ({ r, was: i + 1, pos: finPos.get(keyOf(r)) ?? 31 }))
    .sort((a, b) => (b.pos - b.was) - (a.pos - a.was))[0];
  if (down && down.pos - down.was >= 3) {
    events.push({
      kind: 'gp-fade', group: 'forecast', weight: 60, title: `${gp} · 후반 페이스 하락`,
      text: `${nameOf(down.r)}, 15일 기준 P${down.was}에서 최종 ${down.pos > 30 ? '30위 밖' : `P${down.pos}`}`,
      detail: '후반 보름 동안 밀려남',
      stat: { value: down.pos > 30 ? '–' : `P${down.pos}` }, targets: [targetOf(down.r)],
    });
  }

  // places decided by a play or two
  fin.slice(2, 10).forEach((r, j) => {
    const i = j + 1; // P1's margin is the win card's
    const ahead = fin[i];
    const gap = plays(ahead) - plays(r);
    if (gap <= 1) {
      events.push({
        kind: 'gp-photo', group: 'battle', weight: 66 - i, title: `${gp} · P${i + 1} 사진 판정`,
        text: `${nameOf(ahead)} vs ${nameOf(r)}, ${gap === 0 ? '동률, 마지막 재생 순서로' : '1회 차로'} P${i + 1} 결정`,
        detail: `${plays(ahead)}회 vs ${plays(r)}회`,
        stat: gap === 0 ? { value: '동률' } : { value: '1', unit: '회 차' },
        duel: { sides: [{ pos: i + 1, plays: plays(ahead) }, { pos: i + 2, plays: plays(r) }], gap, eta: null },
        targets: [targetOf(ahead), targetOf(r)],
      });
    }
  });

  // debut-month runs
  fin.slice(0, 10).forEach((r, i) => {
    const first = debut.get(keyOf(r));
    if (first == null || first < from || first >= to) return;
    events.push({
      kind: 'gp-rookie', group: 'rookie', weight: i === 0 ? 92 : 64 - i,
      title: i === 0 ? `${gp} · 데뷔전 우승` : `${gp} · 루키 P${i + 1}`,
      text: i === 0
        ? `${nameOf(r)}, 처음 들은 지 ${Math.max(1, Math.round((to - first) / DAY))}일 만에 우승`
        : `${nameOf(r)}, 데뷔 ${Math.max(1, Math.round((to - first) / DAY))}일 만에 P${i + 1}`,
      detail: `${new Date(first + KST).getUTCDate()}일 첫 재생 · ${plays(r)}회`,
      stat: { value: `P${i + 1}`, unit: '데뷔전' }, targets: [targetOf(r)],
    });
  });

  // the championship, before and after this round
  const rows = (season.data ?? []).filter((r) => r.yr === year);
  const tot = (upTo) => {
    const by = new Map();
    for (const r of rows.filter((x) => x.mo <= upTo)) {
      const c = by.get(keyOf(r)) ?? { ...targetOf(r), pts: 0, wins: 0 };
      c.pts += pointsForRank(r.place);
      if (r.place === 1) c.wins += 1;
      by.set(keyOf(r), c);
    }
    return [...by.values()].sort((a, b) => b.pts - a.pts || b.wins - a.wins);
  };
  const before = tot(month - 1);
  const after = tot(month);
  const me = after.find((c) => keyOf(c) === keyOf(w));
  if (me) {
    let run = 0;
    for (let mo = month; mo >= 1 && rows.some((r) => r.mo === mo && r.place === 1 && keyOf(r) === keyOf(w)); mo--) run++;
    events.push({
      kind: 'gp-tally', group: 'champ', weight: run >= 2 ? 84 : me.wins === 1 ? 72 : 58,
      title: run >= 2 ? `${gp} · ${run}연승` : me.wins === 1 ? `${gp} · 시즌 첫 우승` : `${gp} · 시즌 ${me.wins}승째`,
      text: run >= 2
        ? `${nameOf(w)}, ${month - run + 1}월부터 ${run}연승`
        : me.wins === 1 ? `${nameOf(w)}, ${year} 시즌 첫 GP 우승` : `${nameOf(w)}, ${year} 시즌 ${me.wins}승째`,
      detail: `챔피언십 ${me.pts}pt · P${after.indexOf(me) + 1}`,
      stat: { value: String(run >= 2 ? run : me.wins), unit: run >= 2 ? '연승' : '승' }, targets: [targetOf(w)],
    });
  }
  if (after.length >= 2) {
    const [a, b] = after;
    const changed = before[0] && keyOf(before[0]) !== keyOf(a);
    events.push({
      kind: 'gp-standings', group: 'champ', weight: month === 12 ? 97 : changed ? 88 : 56,
      title: month === 12 ? `${year} 최종전` : changed ? `${gp} 후 챔피언십 선두 교체` : `${gp} 후 챔피언십`,
      text: month === 12
        ? `${nameOf(a)}, 최종전까지 마치고 ${year} 챔피언 · ${a.pts - b.pts}pt 차`
        : changed
          ? `${nameOf(a)}, 이 GP로 챔피언십 선두 탈환 · ${nameOf(before[0])} 2위 이하로`
          : `${nameOf(a)} 챔피언십 선두 유지 · 격차 ${before[0] && before[1] ? `${before[0].pts - before[1].pts}pt → ` : ''}${a.pts - b.pts}pt`,
      detail: `${gp}까지 ${month}라운드`,
      stat: { value: String(a.pts - b.pts), unit: 'pt 차' },
      duel: { sides: [{ pos: 1, pts: a.pts }, { pos: 2, pts: b.pts }], gap: a.pts - b.pts, unit: 'pt', eta: null, lead: true },
      targets: [targetOf(a), targetOf(b)],
    });
  }

  // the constructors: who took the most out of this one race
  if (mode === 'tracks') {
    const top = fin.slice(0, 10);
    const credits = await creditsFor(top);
    const team = new Map();
    top.forEach((r, i) => {
      const list = creditList(r, credits);
      const shares = splitPoints(pointsForRank(i + 1), list.length);
      list.forEach(({ name, key }, j) => {
        const t = team.get(key) ?? { artist: name, track: null, artist_key: key, track_key: null, pts: 0, cars: 0 };
        if (key === r.artist_key) t.artist = r.artist;
        t.pts += shares[j];
        t.cars += 1;
        team.set(key, t);
      });
    });
    const [t] = [...team.values()].sort((a, b) => b.pts - a.pts);
    let lockout = 0;
    while (lockout < top.length && top[lockout].artist_key === top[0].artist_key) lockout++;
    if (t && (t.cars >= 2 || lockout >= 2)) {
      events.push({
        kind: 'gp-team', group: 'cx', weight: lockout >= 3 ? 90 : lockout === 2 ? 78 : 54,
        title: lockout >= 3 ? `${gp} · 포디움 독식` : lockout === 2 ? `${gp} · 원투 피니시` : `${gp} · 팀 최다 득점`,
        text: lockout >= 3
          ? `${top[0].artist}, P1~P${lockout} 독식`
          : lockout === 2 ? `${top[0].artist}, P1·P2 원투 피니시` : `${t.artist}, TOP 10에 ${t.cars}곡 · 팀 최다 ${t.pts}pt`,
        detail: `${t.artist} 팀 포인트 ${t.pts}pt · ${t.cars}곡`,
        stat: { value: String(t.pts), unit: 'pt' }, targets: [targetOf(t)],
      });
    }
  }
  return events;
}

/** Awards: the clubs' marks in reach, or just passed. */
async function milestoneContext(userId, { src, estimate }) {
  const now = Date.now();
  const [tracks, tracksThen, tPace, artists, artistsThen, aPace] = await Promise.all([
    standings(userId, 0, now + 60e3, 'tracks', src, estimate, 300),
    standings(userId, 0, now - LOOKBACK, 'tracks', src, estimate, 300),
    paceOf(userId, 0, 'tracks', src, estimate, 300),
    standings(userId, 0, now + 60e3, 'artists', src, estimate, 80),
    standings(userId, 0, now - LOOKBACK, 'artists', src, estimate, 80),
    paceOf(userId, 0, 'artists', src, estimate, 80),
  ]);
  return [
    ...milestoneEvents(tracks, tracksThen, tPace, [100, 300, 500, 1000], { label: (m) => `${m}회` }),
    ...milestoneEvents(artists, artistsThen, aPace, [1000, 1500, 2000, 3000], { label: (m) => (m === 1000 ? '1000 Club' : `${m}회`) }),
  ];
}

/**
 * Rewords each message's line as race radio. Facts stay as given; any
 * failure leaves the plain lines in place.
 */
async function polish(events, context) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !events.length) return events;
  const model = process.env.OPENAI_MODEL || 'gpt-6.1-terra';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        instructions:
          '너는 음악 재생 순위를 F1 중계처럼 전하는 캐스터다. 각 항목의 text를 한국어 한 문장(40자 안팎)으로 다시 써라. '
          + 'detail과 title을 참고하되 숫자·순위·이름은 그대로 두고 새로운 사실을 지어내지 마라. '
          + '과장된 감탄사나 이모지 없이 담백하고 긴장감 있게. '
          + 'context에 다시보기라고 되어 있으면 이미 끝난 레이스의 하이라이트를 돌아보듯 과거형으로.',
        input: JSON.stringify({ context, items: events.map((e, i) => ({ id: i, title: e.title, text: e.text, detail: e.detail })) }),
        text: {
          format: {
            type: 'json_schema', name: 'radio', strict: true,
            schema: {
              type: 'object', additionalProperties: false, required: ['items'],
              properties: {
                items: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false, required: ['id', 'text'],
                    properties: { id: { type: 'integer' }, text: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}`);
    const json = await res.json();
    const raw = json.output_text
      ?? (json.output ?? []).flatMap((o) => o.content ?? []).find((c) => c.type === 'output_text')?.text;
    const items = JSON.parse(raw).items ?? [];
    console.log(`radio polish ok · ${model} · ${items.length}/${events.length}`);
    return events.map((e, i) => {
      const t = items.find((x) => x.id === i)?.text?.trim();
      return t ? { ...e, text: t, ai: true } : e;
    });
  } catch (e) {
    console.error('radio polish failed', e.message);
    return events;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/radio?view=chart|season|replay|records&...
 *   chart/replay: from, to (ISO), mode
 *   season: year, mode
 * Always: source, estimate.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const view = q.get('view') || 'chart';
  const mode = q.get('mode') === 'artists' ? 'artists' : 'tracks';
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';
  const estimate = q.get('estimate') === '1';
  const label = q.get('label') || '';

  const ck = `${userId}|${q.toString()}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

  try {
    let events;
    if (view === 'gp') {
      events = await gpEvents(userId, { year: Number(q.get('year')), month: Number(q.get('month')), mode, src, estimate });
    } else if (view === 'season') {
      const year = Number(q.get('year')) || null;
      events = await seasonEvents(userId, { year, mode, src, estimate });
    } else if (view === 'records') {
      events = await milestoneContext(userId, { src, estimate });
    } else {
      const from = Date.parse(q.get('from') || '1970-01-01T00:00:00Z');
      const to = Date.parse(q.get('to') || iso(Date.now() + DAY));
      events = await windowEvents(userId, { from, to, mode, src, estimate });
    }
    const top = await polish(pick(events, view === 'season' ? 30 : view === 'gp' ? 16 : 12), `${label} · ${mode === 'artists' ? '가수' : '곡'} 순위`);
    const body = {
      items: top.map(({ weight, ...e }) => e),
      model: top.some((e) => e.ai) ? process.env.OPENAI_MODEL || 'gpt-6.1-terra' : null,
      at: new Date().toISOString(),
    };
    cache.set(ck, { at: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
