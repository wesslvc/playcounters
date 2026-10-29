import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/db';
import { rpcAll } from '@/lib/rpcPage';
import { pointsForRank, F1_POINTS } from '@/lib/rank';
import { keyOf, nameOf, targetOf, ranked, rankingEvents, milestoneEvents, pick } from '@/lib/radio';

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
  return rankingEvents(cur, then, pace, { live, endsAt: to });
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
    for (const e of race) events.push({ ...e, title: `${m}월 GP · ${e.title}` });
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
          targets: [targetOf(c), targetOf(ahead)],
        });
      }
    }
  });
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
          + '과장된 감탄사나 이모지 없이 담백하고 긴장감 있게.',
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
    if (view === 'season') {
      const year = Number(q.get('year')) || null;
      events = await seasonEvents(userId, { year, mode, src, estimate });
    } else if (view === 'records') {
      events = await milestoneContext(userId, { src, estimate });
    } else {
      const from = Date.parse(q.get('from') || '1970-01-01T00:00:00Z');
      const to = Date.parse(q.get('to') || iso(Date.now() + DAY));
      events = await windowEvents(userId, { from, to, mode, src, estimate });
    }
    const top = await polish(pick(events), `${label} · ${mode === 'artists' ? '가수' : '곡'} 순위`);
    const body = { items: top.map(({ weight, ...e }) => e), at: new Date().toISOString() };
    cache.set(ck, { at: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
