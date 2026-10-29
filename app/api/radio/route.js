import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { rpcAll } from '@/lib/rpcPage';
import { pointsForRank, splitPoints, F1_POINTS } from '@/lib/rank';
import { creditsFor, creditList } from '@/lib/storedCredits';
import {
  keyOf, nameOf, targetOf, ranked, rankingEvents, milestoneEvents, pick, pct, span,
  paceModel, expectIn, poisson, gauss,
} from '@/lib/radio';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  const [p7, p3, p30] = await Promise.all([
    rate(userId, from, 7, mode, src, estimate, limit),
    rate(userId, from, 3, mode, src, estimate, limit),
    rate(userId, from, 30, mode, src, estimate, limit),
  ]);
  return { p7, p3, p30 };
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

/**
 * An all-time ranking's own stories: milestones in reach, the longest-serving
 * and the newest of the top ten, the hottest of the last month, and who has
 * climbed most in it.
 */
function careerEvents(cur, then, pace, mode) {
  const out = [];
  const marks = mode === 'artists' ? [500, 1000, 1500, 2000, 3000, 5000] : [100, 200, 300, 500, 1000];
  // the month's marks passed, the biggest first, and those in reach — a few, not a list
  const ms = milestoneEvents(cur.slice(0, 40), then, pace, marks, { label: (m) => `통산 ${m}회` })
    .map((e) => (e.kind === 'hit' ? { ...e, detail: `${e.detail} · 최근 30일 사이` } : e))
    .sort((a, b) => b.weight - a.weight);
  out.push(...ms.filter((e) => e.kind === 'hit').slice(0, 2), ...ms.filter((e) => e.kind === 'near').slice(0, 2));
  const top = cur.slice(0, 10).map((r, i) => ({ r, pos: i + 1, first: Date.parse(r.first_at) })).filter((x) => x.first);
  const years = (ms) => (Date.now() - ms) / (365 * DAY);
  const oldest = [...top].sort((a, b) => a.first - b.first)[0];
  if (oldest && years(oldest.first) >= 1) {
    out.push({
      kind: 'veteran', group: 'move', weight: 48, title: '최장수 TOP 10',
      text: `${nameOf(oldest.r)}, 첫 재생 ${Math.floor(years(oldest.first))}년이 지나도 통산 P${oldest.pos}`,
      detail: `${new Date(oldest.first + KST).getUTCFullYear()}년 ${new Date(oldest.first + KST).getUTCMonth() + 1}월 첫 재생 · ${Number(oldest.r.plays).toLocaleString('ko-KR')}회`,
      stat: { value: `${Math.floor(years(oldest.first))}년`, unit: '롱런' }, targets: [targetOf(oldest.r)],
    });
  }
  const newest = [...top].sort((a, b) => b.first - a.first)[0];
  if (newest && newest !== oldest && years(newest.first) < 1) {
    const days = Math.round((Date.now() - newest.first) / DAY);
    out.push({
      kind: 'fast-riser', group: 'rookie', weight: 62, title: '가장 빠른 통산 TOP 10',
      text: `${nameOf(newest.r)}, 처음 들은 지 ${span(days)} 만에 통산 P${newest.pos}`,
      detail: `${Number(newest.r.plays).toLocaleString('ko-KR')}회 · 하루 평균 ${(Number(newest.r.plays) / Math.max(1, days)).toFixed(1)}회`,
      stat: { value: `P${newest.pos}`, unit: span(days) }, targets: [targetOf(newest.r)],
    });
  }
  if (pace?.p30) {
    const hot = cur.slice(0, 40).map((r, i) => ({ r, pos: i + 1, p: pace.p30.get(keyOf(r)) ?? 0 })).sort((a, b) => b.p - a.p)[0];
    if (hot && hot.p >= 1) {
      out.push({
        kind: 'hot', group: 'forecast', weight: 56, title: '최근 30일 최고 페이스',
        text: `${nameOf(hot.r)}, 최근 30일 하루 ${hot.p.toFixed(1)}회로 통산 상위권에서 가장 뜨거움`,
        detail: `통산 P${hot.pos} · ${Number(hot.r.plays).toLocaleString('ko-KR')}회`,
        stat: { value: hot.p.toFixed(1), unit: '회/일' }, targets: [targetOf(hot.r)],
      });
    }
  }
  return out;
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
  // all-time (or anything longer than a year): never settled, looked back on by the month
  const open = from <= 0 || to - from > 400 * DAY;
  const back = open ? 30 * DAY : LOOKBACK;
  const [cur, then, pace] = await Promise.all([
    standings(userId, from, end, mode, src, estimate, open ? 60 : 15),
    live && now - back > from ? standings(userId, from, now - back, mode, src, estimate, open ? 60 : 15) : null,
    live ? paceOf(userId, from, mode, src, estimate, 200) : null,
  ]);
  const events = rankingEvents(cur, then, pace, { live, endsAt: to, open, from });
  if (open) events.push(...careerEvents(cur, then, pace, mode));
  // debuts only mean something in a short window
  if (to - from <= 120 * DAY && from > 0) {
    events.push(...rookieEvents(cur, await firstPlays(userId, mode, src, estimate), from, to));
  }
  return events;
}

/**
 * Each contender's chance of the title, over the rounds still to run.
 *
 * Each round runs on form: what each car is doing now — this month as it
 * stands, last month, and its season average, the month counting for more
 * the further it has got — easing back toward the season average the
 * further out the round is, with a wobble each time. One round in four is
 * shaken up as well: half of it plays out like one of the season's past
 * rounds (the recent ones somewhat more often), which is what happens when
 * someone comes from nowhere and takes a share of the points.
 *
 * @param start   points with this month counted as it stands
 * @param months  finished rounds, oldest first, each key -> points
 * @param live    this month's points so far, key -> points
 * @param elapsed how far through this month we are, 0..1
 */
function titleOdds(start, months, live, rounds, keys, elapsed, runs = 4000) {
  const won = new Array(keys.length).fill(0);
  const weights = months.map((_, i) => 1 + i / Math.max(1, months.length - 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const draw = () => {
    let x = Math.random() * sum;
    for (let i = 0; i < months.length; i++) if ((x -= weights[i]) < 0) return months[i];
    return months[months.length - 1];
  };
  const prev = months[months.length - 1] ?? new Map();
  const avg = keys.map((k) => months.reduce((a, m) => a + (m.get(k) ?? 0), 0) / Math.max(1, months.length));
  const wl = 0.55 * elapsed;
  const wp = 0.25 + 0.55 * (1 - elapsed);
  const form = keys.map((k, i) => wl * (live.get(k) ?? 0) + wp * (prev.get(k) ?? 0) + 0.2 * avg[i]);
  for (let s = 0; s < runs; s++) {
    const tot = keys.map((k) => start.get(k) ?? 0);
    for (let r = 0; r < rounds; r++) {
      const d = 0.7 ** r;
      // now and then the round goes some other way: half of it plays out like a past round
      const shake = Math.random() < 0.25 ? draw() : null;
      keys.forEach((k, i) => {
        const g = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
        const onForm = (d * form[i] + (1 - d) * avg[i]) * Math.exp(0.45 * g - 0.1);
        tot[i] += shake ? 0.5 * onForm + 0.5 * (shake.get(k) ?? 0) : onForm;
      });
    }
    const best = Math.max(...tot);
    const top = tot.flatMap((t, i) => (t === best ? [i] : []));
    for (const i of top) won[i] += 1 / top.length;
  }
  return { odds: won.map((w) => w / runs), form };
}

/**
 * The rest of the season played out song by song, on play counts rather
 * than points. Every song with recent plays gets its expected plays for each
 * remaining month — the pace model, easing from now toward its long pace,
 * interest fading a little each month — with chance on top, shared by an
 * artist's songs, since going off an artist takes all of them down at once.
 * Each month also brings newcomers the way this season's months actually
 * did: one past month's brand-new entries replayed as a batch, album drops
 * and all (`drops`; a guess at P1-level counts only when there's too little
 * history). Each month is then ranked and paid out like a real round, so a team with many
 * songs doing well collects across the order, and a single runaway song
 * pushes everyone else down a place. Returns each driver's and team's chance
 * of the title and their average points a round.
 *
 * @param recent  songs played in the last two months (ranked rows)
 * @param pace    { p3, p7, p30 } for them
 * @param base    plays that have taken P1 in recent months
 * @param credits stored credits (tracks mode), or null
 */
function songSim({ recent, pace, from, base, drops, credits, rounds, drivers, teams, runs = 2000 }) {
  const model = paceModel(pace, { from });
  const kst = new Date(Date.now() + KST);
  const monthEnd = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + 1, 1) - KST;
  const t0 = Math.max(0, (monthEnd - Date.now()) / DAY);
  const songs = recent.map((r) => {
    const m = model(r);
    const team = credits ? creditList(r, credits).map((c) => c.key) : null;
    // expected plays in each remaining month, interest fading 10% a month
    const exp = Array.from({ length: rounds }, (_, k) => (expectIn(m, t0 + 30 * (k + 1)) - expectIn(m, t0 + 30 * k)) * 0.9 ** (k + 1));
    return { key: keyOf(r), artist: r.artist_key, team, exp };
  });
  const teamWeight = new Map();
  for (const s of songs) if (s.team) teamWeight.set(s.team[0], (teamWeight.get(s.team[0]) ?? 0) + s.exp[0]);
  const teamPool = [...teamWeight];
  const teamTotal = teamPool.reduce((a, [, w]) => a + w, 0);
  const anyTeam = () => {
    let x = Math.random() * teamTotal;
    for (const [k, w] of teamPool) if ((x -= w) < 0) return k;
    return teamPool[0]?.[0];
  };

  const dKeys = [...drivers.keys()];
  const tKeys = [...(teams?.keys() ?? [])];
  const dWon = new Map(dKeys.map((k) => [k, 0]));
  const tWon = new Map(tKeys.map((k) => [k, 0]));
  const dGot = new Map(dKeys.map((k) => [k, 0]));
  const tGot = new Map(tKeys.map((k) => [k, 0]));
  for (let run = 0; run < runs; run++) {
    const d = new Map(drivers);
    const t = new Map(teams ?? []);
    // an artist's songs rise and fall together: one swing per artist for the
    // run, and a smaller one on top each month
    const mood = new Map();
    const swing = (artist) => mood.get(artist) ?? mood.set(artist, Math.exp(0.4 * gauss() - 0.08)).get(artist);
    for (let k = 0; k < rounds; k++) {
      const month = new Map();
      const now = (artist) => month.get(artist) ?? month.set(artist, swing(artist) * Math.exp(0.25 * gauss() - 0.03)).get(artist);
      const field = songs.map((s) => ({ key: s.key, team: s.team, plays: poisson(s.exp[k] * now(s.artist) * Math.exp(0.3 * gauss() - 0.045)) }));
      // newcomers, the way they have actually arrived this season: one past
      // month's new entries replayed as they came, album drops and all — each
      // artist's batch as a new team, or a returning one when that's who it was
      if (drops?.length) {
        const month = drops[Math.floor(Math.random() * drops.length)];
        month.forEach((batch, b) => {
          const team = batch.returning && credits ? anyTeam() : `new-${k}-${b}`;
          const lift = Math.exp(0.3 * gauss() - 0.045);
          batch.plays.forEach((pl, j) => {
            field.push({ key: `new-${k}-${b}-${j}`, team: credits ? [team] : null, plays: Math.round(pl * lift * Math.exp(0.15 * gauss())) });
          });
        });
      } else {
        for (let n = poisson(0.7); n > 0; n--) {
          field.push({ key: `new-${k}-${n}`, team: null, plays: Math.round(base * Math.exp(0.45 * gauss() - 0.2)) });
        }
      }
      field.sort((a, b) => b.plays - a.plays || Math.random() - 0.5);
      field.slice(0, 10).forEach((e, i) => {
        const pts = F1_POINTS[i];
        d.set(e.key, (d.get(e.key) ?? 0) + pts);
        if (dGot.has(e.key)) dGot.set(e.key, dGot.get(e.key) + pts / rounds / runs);
        if (e.team) {
          splitPoints(pts, e.team.length).forEach((share, j) => {
            t.set(e.team[j], (t.get(e.team[j]) ?? 0) + share);
            if (tGot.has(e.team[j])) tGot.set(e.team[j], tGot.get(e.team[j]) + share / rounds / runs);
          });
        }
      });
    }
    const crown = (m, won) => {
      let best = -1;
      let who = [];
      for (const [k, v] of m) {
        if (v > best) { best = v; who = [k]; } else if (v === best) who.push(k);
      }
      for (const k of who) if (won.has(k)) won.set(k, won.get(k) + 1 / who.length / runs);
    };
    crown(d, dWon);
    if (teams) crown(t, tWon);
  }
  return { drivers: dWon, teams: tWon, driverPace: dGot, teamPace: tGot };
}

const ASTRA = () => process.env.OPENAI_MODEL_ASTRA || 'gpt-6-astra';
const TITLE_RULES = '너는 음악 감상 기록으로 치르는 F1식 시즌의 분석가다. 아래는 이 사람의 올해 기록 전부다. '
  + '매달 재생 횟수로 순위를 매기고 1~10위에 25-18-15-12-10-8-6-4-2-1점을 준다. '
  + '컨스트럭터는 곡에 크레딧된 아티스트들이 그 곡의 점수를 나눠 갖는다. '
  + '남은 라운드 동안의 흐름을 스스로 판단해서 컨스트럭터 타이틀을 누가 가져갈지 확률로 답하라. '
  + '기존 강세의 지속, 하락 조짐, 신곡·앨범의 등장 가능성 등 무엇을 어떻게 볼지는 네가 정한다. '
  + 'reasoning은 한국어 두 문장 이내, 핵심 근거만.';
const titleSchema = (teams, extra = {}) => ({
  type: 'object', additionalProperties: false, required: ['odds', 'reasoning', ...Object.keys(extra)],
  properties: {
    odds: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['team', 'pct'],
        properties: { team: { type: 'string', enum: teams }, pct: { type: 'number' } },
      },
    },
    reasoning: { type: 'string' },
    ...extra,
  },
});
// list price per million tokens, in and out
const PRICE = { astra: [10, 50], terra: [2.5, 10] };
const costOf = (u, [pin, pout]) => ({
  input: u?.input_tokens ?? null,
  output: u?.output_tokens ?? null,
  reasoning: u?.output_tokens_details?.reasoning_tokens ?? null,
  usd: Math.round((((u?.input_tokens ?? 0) * pin + (u?.output_tokens ?? 0) * pout) / 1e6) * 1000) / 1000,
});
const cleanOdds = (odds, teams) => (odds ?? []).filter((o) => teams.includes(o.team)).sort((a, b) => b.pct - a.pct);

/**
 * The constructors' title, judged from the season's raw records alone —
 * every month's top ten with counts and credited artists, this month so far,
 * the standings, each song's recent counts and first play, and the rules.
 * None of this radio's own modelling goes with it.
 *
 * Astra's verdict is the one shown. Terra looks each day, handed that
 * verdict, and says whether things have really moved; its own odds are shown
 * only when they have and Astra can't be asked again this month. Astra is asked when there's no
 * verdict of its own yet, when Terra says the picture has shifted, or when
 * Terra can't call a close race and Astra's word
 * is more than a week old — and never more than four times a month. The
 * day's call is kept in radio_notes; null when there's no key or no answer.
 */
const judging = new Map();
function judgeTitle(key, input) {
  // one judgement at a time, however many views ask at once
  if (!judging.has(key)) judging.set(key, judge(key, input).finally(() => judging.delete(key)));
  return judging.get(key);
}

async function judge(key, input) {
  if (!process.env.OPENAI_API_KEY) return null;
  const today = new Date(Date.now() + KST).toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const { data: kept } = await db.from('radio_notes').select('body, created_at').eq('key', key).maybeSingle();
  const prev = kept?.body ?? {};
  if (prev.date === today && prev.current) return prev.current;
  if (prev.pending && Date.now() - Date.parse(kept.created_at) < 90e3) return prev.current ?? null;
  await db.from('radio_notes').upsert({ key, body: { ...prev, pending: true }, created_at: new Date().toISOString() });

  const teams = input.standings.map((t) => t.team);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 50000);
  const save = (body) => db.from('radio_notes').upsert({ key, body: { ...body, pending: false }, created_at: new Date().toISOString() });
  try {
    const astraPrev = prev.astra ?? null;
    let terra = null;
    try {
      const t = await ask(
        TERRA(),
        `${TITLE_RULES} 직전에 더 신중한 분석가(Astra)가 내린 판단이 있으면 그것을 기본으로 따르되, `
          + '그 뒤로 판세를 바꿀 만한 변화가 있었으면 shifted를 true로, 접전이거나 판단이 서지 않으면 confident를 false로 하라.',
        { ...input, astraVerdict: astraPrev ? { date: astraPrev.date, odds: astraPrev.odds, reasoning: astraPrev.reasoning } : null },
        titleSchema(teams, { confident: { type: 'boolean' }, shifted: { type: 'boolean' } }),
        ctl.signal,
        'medium',
      );
      terra = { odds: cleanOdds(t.odds, teams), reasoning: String(t.reasoning ?? '').trim(), confident: t.confident, shifted: t.shifted, date: today, model: TERRA(), usage: costOf(t.usage, PRICE.terra) };
      if (!terra.odds.length) terra = null;
    } catch (e) {
      console.error('radio title terra failed', e.message);
    }

    // when to go up to Astra
    const calls = (prev.astraCalls ?? []).filter((d) => d.startsWith(month));
    const stale = !astraPrev || (Date.now() - Date.parse(astraPrev.date)) / DAY > 7;
    const close = terra && terra.odds.length > 1 && terra.odds[0].pct - terra.odds[1].pct < 10;
    const why = !astraPrev ? 'Astra 판단 없음'
      : !terra ? (stale ? 'Terra 응답 없음' : null)
        : terra.shifted ? 'Terra가 판세 변화 감지'
          : (!terra.confident || close) && stale ? '접전이라 Terra 판단 보류'
            : null;
    let astra = astraPrev;
    if (why && calls.length < 4) {
      try {
        const a = await ask(ASTRA(), TITLE_RULES, input, titleSchema(teams), ctl.signal, 'medium');
        const odds = cleanOdds(a.odds, teams);
        if (odds.length) {
          astra = { odds, reasoning: String(a.reasoning ?? '').trim(), date: today, model: ASTRA(), why, usage: costOf(a.usage, PRICE.astra) };
          calls.push(today);
          console.log(`radio title astra · ${why} · in ${astra.usage.input} / out ${astra.usage.output} tokens · ≈$${astra.usage.usd} · ${calls.length}/4 this month`);
        }
      } catch (e) {
        console.error('radio title astra failed', e.message);
      }
    }
    const fresh = astra && astra.date === today;
    // Astra's word stands until Terra sees the picture move and Astra can't be asked again
    const current = astra && (fresh || !terra?.shifted) ? { ...astra, by: 'astra', checked: terra ? today : null }
      : terra ? { ...terra, by: 'terra' }
        : null;
    if (terra) console.log(`radio title terra · confident ${terra.confident} · shifted ${terra.shifted} · ≈$${terra.usage.usd}${fresh ? ' · escalated' : ''}`);
    await save({ date: today, current, terra, astra, astraCalls: [...(prev.astraCalls ?? []).filter((d) => !d.startsWith(month)), ...calls] });
    return current;
  } catch (e) {
    console.error('radio title failed', e.message);
    await save({ ...prev, date: null });
    return prev.current ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How each one's chance has moved since an earlier day: a day's odds are
 * kept (the last of the day wins), and today's are compared with the latest
 * day before it. Moves under two points are a simulation's wobble, not news.
 */
async function oddsMoves(key, odds) {
  const today = new Date(Date.now() + KST).toISOString().slice(0, 10);
  const { data: kept } = await db.from('radio_notes').select('body').eq('key', key).maybeSingle();
  const days = (kept?.body?.days ?? []).filter((d) => d.date !== today);
  const before = days[days.length - 1]?.odds ?? null;
  const now = Object.fromEntries(odds.map((o) => [o.key, o.pct]));
  await db.from('radio_notes').upsert({ key, body: { days: [...days, { date: today, odds: now }].slice(-14) }, created_at: new Date().toISOString() });
  if (!before) return { moves: new Map(), since: null };
  const moves = new Map();
  for (const o of odds) {
    const d = o.pct - (before[o.key] ?? 0);
    if (Math.abs(d) >= 2) moves.set(o.key, Math.round(d));
  }
  return { moves, since: days[days.length - 1].date };
}

/** How far through the current month we are, in Seoul. */
function monthElapsed() {
  const kst = new Date(Date.now() + KST);
  const days = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + 1, 0)).getUTCDate();
  return Math.min(1, (kst.getUTCDate() - 1 + kst.getUTCHours() / 24) / days);
}

/**
 * The cars behind the title favourite that can still take it: what they'd
 * need a round, against what they're scoring now.
 */
function chaseCards(field, form, rounds, name, group, label) {
  const out = [];
  const [lead] = field;
  field.slice(1, 4).forEach((c, i) => {
    const need = Math.ceil((lead.pts - c.pts + 1) / rounds);
    const now = Math.round(form[i + 1]);
    if (rounds < 1 || need <= 0 || now < need * 0.8) return;
    out.push({
      kind: 'chase', group, weight: now >= need ? 78 - i : 60 - i, title: `${label} 역전 시나리오`,
      text: `${name(c)} → ${name(lead)} 역전 조건, 남은 ${rounds}라운드 라운드당 ${need}pt · 예상 득점 라운드당 ${now}pt`,
      detail: `지금 ${lead.pts - c.pts}pt 차 (${c.pts}pt vs ${lead.pts}pt) · 예상 득점은 곡별 재생 수 시뮬레이션 기준`,
      stat: { value: String(need), unit: 'pt/라운드 필요' },
      // sides in the same order as targets: the chaser, then the leader
      duel: { sides: [{ pos: i + 2, pts: c.pts }, { pos: 1, pts: lead.pts }], gap: lead.pts - c.pts, unit: 'pt', eta: null, need, expect: now },
      targets: [targetOf(c), targetOf(lead)],
    });
  });
  return out;
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

  // the rest of the season played out song by song, once for both championships
  let sim = null;
  let raw = null; // the same records, kept for the one question put to Astra
  if (isNow && ifNow.length >= 2 && 12 - lastM > 0) {
    const now = Date.now();
    const since = now - 60 * DAY;
    const [recent, pace] = await Promise.all([
      standings(userId, since, now + 60e3, mode, src, estimate, 120),
      paceOf(userId, since, mode, src, estimate, 200),
    ]);
    const credits = mode === 'tracks' ? await creditsFor([...recent, ...(data ?? [])]) : null;
    let teamStart = null;
    if (credits) {
      teamStart = new Map();
      for (const r of data ?? []) {
        const list = creditList(r, credits);
        splitPoints(pointsForRank(r.place), list.length).forEach((share, j) => {
          teamStart.set(list[j].key, (teamStart.get(list[j].key) ?? 0) + share);
        });
      }
    }
    // what it has taken to top a month lately: the middle of the last six winners, so one runaway month doesn't set the bar
    const tops = (data ?? []).filter((r) => r.place === 1 && !(r.yr === y && r.mo === lastM))
      .sort((a, b) => b.yr - a.yr || b.mo - a.mo).slice(0, 6).map((r) => Number(r.plays)).filter(Boolean)
      .sort((a, b) => a - b);
    const base = tops.length ? tops[Math.floor(tops.length / 2)] : Number(recent[0]?.plays ?? 0) / 2;
    // each finished month's brand-new arrivals in the top ten (first played
    // within six weeks of it), grouped by artist, with their counts
    const debut = await firstPlays(userId, mode, src, estimate);
    raw = { recent, pace, debut, credits };
    const doneRowsAll = (data ?? []).filter((r) => !(r.yr === y && r.mo === lastM));
    const drops = [];
    const seen = new Set();
    let freshWins = 0;
    for (const mo of [...new Set(doneRowsAll.map((r) => r.mo))].sort((a, b) => a - b)) {
      const rows = doneRowsAll.filter((r) => r.mo === mo);
      const fresh = rows.filter((r) => (debut.get(keyOf(r)) ?? 0) >= monthStart(y, mo) - 45 * DAY);
      const byArtist = new Map();
      for (const r of fresh) byArtist.set(r.artist_key, [...(byArtist.get(r.artist_key) ?? []), Number(r.plays)]);
      if (mo > 1) drops.push([...byArtist].map(([artist, plays]) => ({ plays, returning: seen.has(artist) })));
      if (fresh.some((r) => r.place === 1)) freshWins += 1;
      for (const r of rows) seen.add(r.artist_key);
    }
    if (recent.length) {
      sim = songSim({
        recent, pace, from: since, base, drops: drops.length >= 3 ? drops : null, credits, rounds: 12 - lastM,
        drivers: new Map(ifNow.map((c) => [keyOf(c), c.pts])), teams: teamStart,
      });
      sim.base = base;
      sim.history = `올해 ${drops.length + 1}달 중 ${freshWins}달은 신곡이 1위`;
    }
  }

  // the title odds: this month as it stands, the rest played out
  if (isNow && ifNow.length >= 2 && (sim || months.length >= 2)) {
    const field = ifNow.slice(0, 10);
    const start = new Map(field.map((c) => [keyOf(c), c.pts]));
    let chances;
    let form;
    if (sim) {
      chances = field.map((c) => sim.drivers.get(keyOf(c)) ?? 0);
      form = field.map((c) => sim.driverPace.get(keyOf(c)) ?? 0);
    } else {
      const live = new Map();
      for (const r of data ?? []) if (r.yr === y && r.mo === lastM) live.set(keyOf(r), pointsForRank(r.place));
      ({ odds: chances, form } = titleOdds(start, months, live, 12 - lastM, field.map(keyOf), monthElapsed()));
    }
    const odds = chances
      .map((p, i) => ({ c: field[i], p }))
      .sort((a, b) => b.p - a.p)
      .slice(0, 3);
    if (chances[0] < 0.97) events.push(...chaseCards(field, form, 12 - lastM, nameOf, group, '챔피언십'));
    // still able to win it on paper, with this month ending as it stands
    const alive = ifNow.filter((c) => c.pts + F1_POINTS[0] * (12 - lastM) >= ifNow[0].pts).length;
    const [f] = odds;
    events.push({
      kind: 'odds', group, weight: 94, title: `${y} 챔피언 가능성`,
      text: f.p >= 0.995
        ? `${nameOf(f.c)}, 시뮬레이션상 챔피언 확실시`
        : `${nameOf(f.c)}, 챔피언 가능성 ${pct(f.p)}%${odds[1] ? ` · ${nameOf(odds[1].c)} ${pct(odds[1].p)}%` : ''}`,
      detail: `남은 ${12 - lastM}라운드를 곡별 예상 재생 수로 돌린 결과 (신곡 등장은 올해 실제 기록대로) · 이번 달이 이대로 끝나면 산술적 우승 가능 ${alive}명`,
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
      let chances;
      let form;
      if (sim) {
        chances = field.map((c) => sim.teams.get(c.artist_key) ?? 0);
        form = field.map((c) => sim.teamPace.get(c.artist_key) ?? 0);
      } else {
        const cLive = new Map(teams(liveRows).map((c) => [c.artist_key, c.pts]));
        ({ odds: chances, form } = titleOdds(new Map(field.map((c) => [c.artist_key, c.pts])), cMonths, cLive, 12 - lastM, field.map((c) => c.artist_key), monthElapsed()));
      }
      let odds = chances.map((p, i) => ({ c: field[i], p })).sort((a, b) => b.p - a.p).slice(0, 3);
      // this one question goes to Astra, with the records and nothing of ours
      let astra = null;
      if (raw) {
        const day = (ms) => new Date(ms + KST).toISOString().slice(0, 10);
        const names = (r) => creditList(r, raw.credits).map((c) => c.name);
        const kst = new Date(Date.now() + KST);
        const before = new Map(cDone.map((c) => [c.artist_key, c.pts]));
        const input = {
          season: y,
          today: day(Date.now()),
          roundsLeft: 12 - lastM,
          currentMonth: { month: lastM, day: kst.getUTCDate(), daysInMonth: new Date(Date.UTC(y, lastM, 0)).getUTCDate(), provisional: true },
          months: [...new Set((data ?? []).map((r) => r.mo))].sort((a, b) => a - b).map((mo) => ({
            month: mo,
            provisional: mo === lastM,
            top10: (data ?? []).filter((r) => r.mo === mo).sort((a, b) => a.place - b.place)
              .map((r) => ({ place: r.place, song: r.track ?? r.artist, artists: names(r), plays: Number(r.plays) })),
          })),
          standings: field.map((c) => ({ team: c.artist, points: c.pts, beforeThisMonth: before.get(c.artist_key) ?? 0 })),
          recentSongs: raw.recent.slice(0, 40).map((r) => ({
            song: r.track ?? r.artist,
            artists: names(r),
            last3d: Math.round((raw.pace.p3.get(keyOf(r)) ?? 0) * 3),
            last7d: Math.round((raw.pace.p7.get(keyOf(r)) ?? 0) * 7),
            last30d: Math.round((raw.pace.p30.get(keyOf(r)) ?? 0) * 30),
            firstPlayed: raw.debut.get(keyOf(r)) ? day(raw.debut.get(keyOf(r))) : null,
          })),
        };
        astra = await judgeTitle(`cx-title|${userId}|${y}|${src}|${estimate}`, input);
        if (astra) {
          const byName = new Map(field.map((c) => [c.artist, c]));
          odds = astra.odds.slice(0, 3).map((o) => ({ c: byName.get(o.team), p: o.pct / 100 })).filter((o) => o.c);
        }
      }
      // who could still catch the leader, and what it would take
      events.push(...chaseCards(field, form, 12 - lastM, (c) => c.artist, cx, '컨스트럭터'));
      // since an earlier day: who has gained, who has lost
      const shown = odds.map(({ c, p }) => ({ key: c.artist_key, pct: pct(p) }));
      const { moves, since } = await oddsMoves(`odds|cx|${userId}|${y}|${src}|${estimate}`, shown)
        .catch(() => ({ moves: new Map(), since: null }));
      const biggest = [...moves].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
      events.push({
        kind: 'cx-odds', group: cx, weight: 84, title: `${y} 컨스트럭터 타이틀 가능성${astra ? ` · ${astra.by === 'astra' ? 'Astra' : 'Terra'} 판단` : ''}`,
        text: `${odds[0].c.artist}, 타이틀 가능성 ${pct(odds[0].p)}%${odds[1] ? ` · ${odds[1].c.artist} ${pct(odds[1].p)}%` : ''}${biggest ? ` · ${field.find((c) => c.artist_key === biggest[0])?.artist} ${biggest[1] > 0 ? '+' : ''}${biggest[1]}%p` : ''}`,
        detail: (astra
          ? `${astra.reasoning} — ${astra.by === 'astra'
            ? `${astra.model} 판단 (${Number(astra.date.slice(5, 7))}월 ${Number(astra.date.slice(8))}일)${astra.checked && astra.checked !== astra.date ? ' · 이후 큰 변화 없음' : ''}`
            : `${astra.model} 판단 · Astra 이후 판세 변화 감지`}`
          : `소속 곡 예상 재생 수로 남은 ${12 - lastM}라운드를 매달 순위 매겨 돌린 결과 · 신곡·앨범 등장은 올해 실제 기록대로${sim?.history ? ` (${sim.history})` : ''}`)
          + (since ? ` · 화살표는 ${Number(since.slice(5, 7))}월 ${Number(since.slice(8))}일 대비` : ''),
        stat: { value: `${pct(odds[0].p)}%`, unit: '타이틀' },
        odds: odds.map(({ c, p }) => ({ ...targetOf(c), pct: pct(p), pts: c.pts, move: moves.get(c.artist_key) ?? null })),
        ...(since ? { since } : {}),
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
          // points like these come from many songs doing well and nobody running away with it
          detail: `이대로면 팀 포인트 +${t.pts}pt${sim?.base && Number(liveRows[0].plays)
            ? ` · 이번 달 1위 곡 ${Number(liveRows[0].plays)}회 (최근 1위 보통 ${Math.round(sim.base)}회)${Number(liveRows[0].plays) < sim.base * 0.75 ? ' · 압도적인 곡 없이 고른 강세' : ''}`
            : ''}`,
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
 * The all-time championship: careers rather than a season. Nothing is ever
 * settled, so the leader's card says how long the lead should last — each
 * chaser's points per round over its last six rounds against the leader's.
 */
async function careerSeasonEvents(userId, { mode, src, estimate }) {
  const kst = new Date(Date.now() + KST);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1;
  const events = [];
  const race = await windowEvents(userId, { from: monthStart(y, m), to: monthStart(y, m + 1), mode, src, estimate });
  for (const e of race) events.push({ ...e, title: `${m}월 GP · ${e.title}` });

  const { data, error } = await rpcAll('season_races', {
    p_user: userId, p_from: iso(0), p_to: iso(monthStart(y, m)),
    p_mode: mode, p_tz: TZ, p_source: src, p_estimate: estimate,
  }, 20000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (!rows.length) return events;
  const round = (r) => r.yr * 12 + r.mo;
  const rounds = [...new Set(rows.map(round))].sort((a, b) => a - b);
  const recent = new Set(rounds.slice(-6));

  const career = new Map();
  for (const r of rows) {
    const c = career.get(keyOf(r)) ?? { ...targetOf(r), pts: 0, wins: 0, podiums: 0, starts: 0, recent: 0, first: round(r), places: new Map() };
    const p = pointsForRank(r.place);
    c.pts += p;
    c.starts += 1;
    if (r.place === 1) c.wins += 1;
    if (r.place <= 3) c.podiums += 1;
    if (recent.has(round(r))) c.recent += p;
    c.first = Math.min(c.first, round(r));
    c.places.set(round(r), r.place);
    career.set(keyOf(r), c);
  }
  const all = [...career.values()].sort((a, b) => b.pts - a.pts || b.wins - a.wins);
  // form and career together: the last six rounds and the average since its first
  const per = (c) => 0.5 * (c.recent / Math.min(6, rounds.length))
    // a short career is averaged over six rounds at least, so a hot debut isn't taken as a habit
    + 0.5 * (c.pts / Math.max(6, rounds.filter((rd) => rd >= c.first).length));
  const months = (n) => (n >= 24 ? `${Math.round(n / 12)}년` : `${Math.round(n)}개월`);

  // how long the career lead lasts, on the last six rounds' form
  const holdCard = (list, name, group, title) => {
    const [a, b] = list;
    if (!a || !b) return;
    const threats = list.slice(1, 8).map((c, i) => {
      const d = per(c) - per(a);
      return { c, pos: i + 2, n: d > 0.1 ? (a.pts - c.pts + 1) / d : null };
    }).filter((x) => x.n != null).sort((x, z) => x.n - z.n);
    const t = threats[0];
    const other = t?.c ?? b;
    events.push({
      kind: 'career-hold', group, weight: t && t.n <= 6 ? 80 : 66, title,
      text: t
        ? `${name(a)}, 최근 폼과 통산 평균을 함께 보면 통산 1위 약 ${months(t.n)} 더 유지 · 위협은 P${t.pos} ${name(t.c)}`
        : `${name(a)}, 통산 ${a.pts}pt로 1위 · 지금 흐름으로는 따라올 상대가 없음`,
      detail: `라운드당 예상 ${per(a).toFixed(1)}pt vs ${name(other)} ${per(other).toFixed(1)}pt (최근 6라운드·통산 평균 종합) · ${a.pts - other.pts}pt 차`,
      stat: t ? { value: months(t.n), unit: '유지 예상' } : { value: String(a.pts - b.pts), unit: 'pt 차' },
      duel: { sides: [{ pos: 1, pts: a.pts }, { pos: t?.pos ?? 2, pts: other.pts }], gap: a.pts - other.pts, unit: 'pt', eta: null, lead: true, holdFor: t ? months(t.n) : '안정' },
      targets: [targetOf(a), targetOf(other)],
    });
  };
  holdCard(all, nameOf, 'lead', '통산 포인트 1위 수성');

  const best = (key, min) => {
    const [c] = [...all].sort((a, b) => b[key] - a[key] || b.pts - a.pts);
    return c && c[key] >= min ? c : null;
  };
  const w = best('wins', 2);
  if (w) {
    events.push({
      kind: 'career-wins', group: 'champ', weight: 60, title: '통산 최다 우승',
      text: `${nameOf(w)}, 통산 GP ${w.wins}승 · 출전 ${w.starts}라운드`,
      detail: `승률 ${Math.round((w.wins / w.starts) * 100)}% · 포디움 ${w.podiums}회`,
      stat: { value: String(w.wins), unit: '승' }, targets: [targetOf(w)],
    });
  }
  const pd = best('podiums', 3);
  if (pd && pd !== w) {
    events.push({
      kind: 'career-podiums', group: 'champ', weight: 50, title: '통산 최다 포디움',
      text: `${nameOf(pd)}, 통산 포디움 ${pd.podiums}회`,
      detail: `우승 ${pd.wins}회 · 출전 ${pd.starts}라운드`,
      stat: { value: String(pd.podiums), unit: '포디움' }, targets: [targetOf(pd)],
    });
  }
  const st = best('starts', 6);
  if (st) {
    events.push({
      kind: 'career-starts', group: 'champ', weight: 46, title: '최다 출전',
      text: `${nameOf(st)}, ${st.starts}라운드 포인트권 · 가장 오래 달린 차`,
      detail: `통산 ${st.pts}pt · ${st.wins}승`,
      stat: { value: String(st.starts), unit: '라운드' }, targets: [targetOf(st)],
    });
  }

  // season titles: each finished year's points leader
  const titles = new Map();
  for (const yr of [...new Set(rows.map((r) => r.yr))].filter((x) => x < y)) {
    const by = new Map();
    for (const r of rows.filter((x) => x.yr === yr)) by.set(keyOf(r), (by.get(keyOf(r)) ?? 0) + pointsForRank(r.place));
    const [k] = [...by].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (k) titles.set(k, [...(titles.get(k) ?? []), yr]);
  }
  if (titles.size) {
    const list = [...titles].flatMap(([k, ys]) => ys.map((yr) => ({ yr, c: career.get(k) }))).sort((a, b) => a.yr - b.yr);
    const [mk, mys] = [...titles].sort((a, b) => b[1].length - a[1].length)[0];
    const latest = list[list.length - 1];
    events.push({
      kind: 'career-titles', group: 'champ', weight: mys.length >= 2 ? 72 : 56, title: '역대 시즌 챔피언',
      text: mys.length >= 2
        ? `${nameOf(career.get(mk))}, 시즌 챔피언 ${mys.length}회로 최다`
        : `역대 챔피언 ${list.map((x) => `${x.yr} ${nameOf(x.c)}`).join(' · ')}`,
      detail: list.map((x) => `${x.yr} ${nameOf(x.c)}`).join(' · '),
      stat: { value: String(list.length), unit: '시즌' }, targets: [targetOf(latest.c)],
    });
  }

  // the longest run of wins, ever
  let streak = null;
  for (const c of all.slice(0, 60)) {
    let run = 0;
    for (const rd of rounds) {
      run = c.places.get(rd) === 1 ? run + 1 : 0;
      if (run >= 2 && (!streak || run > streak.n)) streak = { c, n: run, end: rd };
    }
  }
  if (streak) {
    const s0 = streak.end - streak.n + 1;
    const fmt = (rd) => `${Math.floor((rd - 1) / 12)}년 ${((rd - 1) % 12) + 1}월`;
    events.push({
      kind: 'career-streak', group: 'champ', weight: 58 + streak.n, title: '역대 최다 연승',
      text: `${nameOf(streak.c)}, ${streak.n}연승 · 역대 최장`,
      detail: `${fmt(s0)} ~ ${fmt(streak.end)}`,
      stat: { value: String(streak.n), unit: '연승' }, targets: [targetOf(streak.c)],
    });
  }

  // the best newcomer of the last year
  const lastYear = rounds[rounds.length - 1] - 11;
  const fresh = all.map((c, i) => ({ c, pos: i + 1 })).find((x) => x.c.first >= lastYear);
  if (fresh) {
    events.push({
      kind: 'career-rookie', group: 'rookie', weight: 60, title: '최근 1년 데뷔 최고 순위',
      text: `${nameOf(fresh.c)}, 데뷔 1년 안에 통산 포인트 P${fresh.pos}`,
      detail: `${fresh.c.pts}pt · ${fresh.c.wins}승 · ${fresh.c.starts}라운드`,
      stat: { value: `P${fresh.pos}`, unit: '루키' }, targets: [targetOf(fresh.c)],
    });
  }

  // constructors, all time
  if (mode === 'tracks') {
    const credits = await creditsFor(rows);
    const team = new Map();
    for (const r of rows) {
      const list = creditList(r, credits);
      const shares = splitPoints(pointsForRank(r.place), list.length);
      list.forEach(({ name, key }, i) => {
        const t = team.get(key) ?? { artist: name, track: null, artist_key: key, track_key: null, pts: 0, wins: 0, recent: 0, first: round(r) };
        if (key === r.artist_key) t.artist = r.artist;
        t.first = Math.min(t.first, round(r));
        t.pts += shares[i];
        if (r.place === 1) t.wins += 1;
        if (recent.has(round(r))) t.recent += shares[i];
        team.set(key, t);
      });
    }
    const teams = [...team.values()].sort((a, b) => b.pts - a.pts);
    holdCard(teams, (c) => c.artist, 'cx', '통산 컨스트럭터 1위 수성');
    const tw = [...teams].sort((a, b) => b.wins - a.wins)[0];
    if (tw?.wins >= 2) {
      events.push({
        kind: 'career-cx-wins', group: 'cx', weight: 54, title: '통산 최다 우승 팀',
        text: `${tw.artist}, 소속 곡들로 통산 ${tw.wins}승`,
        detail: `팀 통산 ${tw.pts}pt`,
        stat: { value: String(tw.wins), unit: '승' }, targets: [targetOf(tw)],
      });
    }
  }
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

// Terra has the better voice and the better head: it takes the lines that have
// to weigh several things at once — odds, projections, how long a lead lasts, a
// race's whole story — and the opening line. Luna, quicker and cheaper, takes
// the plain facts: a climb, a milestone, a record.
const TERRA = () => process.env.OPENAI_MODEL || 'gpt-6.1-terra';
const LUNA = () => process.env.OPENAI_MODEL_FAST || 'gpt-6-luna';
const CASTER = '너는 음악 재생 순위를 F1 중계처럼 전하는 베테랑 캐스터다. '
  + '숫자·순위·이름은 주어진 그대로 쓰고 새로운 사실을 지어내지 마라. '
  + '생생하고 맛깔나게: 추격, 방어, 언더컷, 슬립스트림, 체커기, 피트월 같은 레이싱 표현을 상황에 맞게 섞고, '
  + '문장마다 시작과 리듬을 바꿔 같은 패턴을 반복하지 마라. 이모지와 느낌표 남발은 금지. '
  + 'context에 다시보기라고 되어 있으면 이미 끝난 레이스의 하이라이트를 돌아보듯 과거형으로.';

/** One structured call to the Responses API. */
async function ask(model, instructions, input, schema, signal, effort = 'low') {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      reasoning: { effort },
      instructions,
      input: JSON.stringify(input),
      text: { format: { type: 'json_schema', name: 'radio', strict: true, schema } },
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const json = await res.json();
  const raw = json.output_text
    ?? (json.output ?? []).flatMap((o) => o.content ?? []).find((c) => c.type === 'output_text')?.text;
  const out = JSON.parse(raw);
  // what the call cost, in tokens — kept off the answer itself
  Object.defineProperty(out, 'usage', { value: json.usage ?? null });
  return out;
}

/** Every figure in a line, so a rewrite that drops or invents one can be refused. */
const figures = (t) => (String(t).match(/\d+(?:[.,]\d+)*/g) ?? []).map((x) => x.replace(/,/g, '')).sort().join('|');

const LINES = {
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
};
const OPENER = {
  type: 'object', additionalProperties: false, required: ['headline'],
  properties: { headline: { type: 'string' } },
};

/** Lines that weigh several things at once — odds, projections, a lead's lifetime, a race's story. */
const COMPLEX = new Set([
  'odds', 'win-odds', 'cx-odds', 'hold', 'career-hold', 'lead', 'eta', 'champion', 'locked', 'swing', 'cx-swing',
  'cx-lead', 'streak-on', 'first-win', 'chase', 'gp-win', 'gp-changes', 'gp-late', 'gp-standings', 'gp-tally',
]);
const complex = (e) => COMPLEX.has(e.kind) || Boolean(e.odds || e.duel?.eta != null || e.duel?.after != null);
const split = (list, n) => {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

/**
 * Rewords the lines as race radio — several casters at once, a few lines
 * each, so a long feed comes back as fast as a short one — while another
 * writes the opening line for the whole picture. A rewrite whose figures
 * don't match the original's is thrown away; any failure leaves the plain
 * lines in place.
 */
async function polish(events, context) {
  if (!process.env.OPENAI_API_KEY || !events.length) return { items: events, headline: null };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  const tagged = events.map((e, id) => ({ id, e }));
  const heavy = tagged.filter(({ e }) => complex(e));
  const light = tagged.filter(({ e }) => !complex(e));
  const chunks = [
    ...split(heavy, 3).map((items) => ({ model: TERRA(), items })),
    ...split(light, 5).map((items) => ({ model: LUNA(), items })),
  ];
  try {
    const [parts, opener] = await Promise.all([
      Promise.all(chunks.map((chunk) => ask(
        chunk.model,
        `${CASTER} 각 항목의 text를 한국어 한 문장(40자 안팎)으로 다시 써라. detail과 title은 참고만 해라.`,
        { context, items: chunk.items.map(({ id, e }) => ({ id, title: e.title, text: e.text, detail: e.detail })) },
        LINES, ctl.signal,
      ).catch(() => ({ items: [] })))),
      ask(
        TERRA(),
        `${CASTER} 아래 항목들 중 가장 중요한 것 두세 개를 엮어 중계 오프닝 멘트를 한국어 한두 문장(70자 이내)으로 써라. 숫자는 항목에 있는 것만.`,
        { context, items: events.slice(0, 8).map((e) => ({ title: e.title, text: e.text })) },
        OPENER, ctl.signal,
      ).catch(() => null),
    ]);
    const lines = new Map(parts.flatMap((p) => p.items ?? []).map((x) => [x.id, x.text?.trim()]));
    let kept = 0;
    const items = events.map((e, i) => {
      const t = lines.get(i);
      if (!t || figures(t) !== figures(e.text)) return e;
      kept += 1;
      return { ...e, text: t, ai: true };
    });
    console.log(`radio polish ok · ${kept}/${events.length} · terra ${heavy.length} / luna ${light.length} lines · ${chunks.length} casters`);
    return { items, headline: opener?.headline?.trim() || null, models: [...new Set([TERRA(), ...(light.length ? [LUNA()] : [])])] };
  } catch (e) {
    console.error('radio polish failed', e.message);
    return { items: events, headline: null };
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
    } else if (view === 'season' && q.get('all') === '1') {
      events = await careerSeasonEvents(userId, { mode, src, estimate });
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
    const { items: top, headline, models = [] } = await polish(
      pick(events, view === 'season' ? 30 : view === 'gp' ? 16 : 12),
      `${label} · ${mode === 'artists' ? '가수' : '곡'} 순위`,
    );
    const body = {
      items: top.map(({ weight, ...e }) => e),
      headline,
      model: top.some((e) => e.ai) || headline ? models.join(' · ') : null,
      at: new Date().toISOString(),
    };
    cache.set(ck, { at: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
