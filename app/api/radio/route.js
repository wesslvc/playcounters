import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { rpcAll } from '@/lib/rpcPage';
import { pointsForRank } from '@/lib/rank';
import { keyOf, ranked, rankingEvents, milestoneEvents, pick } from '@/lib/radio';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TZ = 'Asia/Seoul';
const KST = 9 * 3600e3;
const DAY = 864e5;
/** How far back "then" is, for overtakes and gaps closing. */
const LOOKBACK = 3 * DAY;
/** The window pace is measured over. */
const PACE = 7 * DAY;
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

/** Plays per day over the last week (or since `from`), by key. */
async function paceOf(userId, from, mode, src, estimate, limit) {
  const now = Date.now();
  const start = Math.max(from, now - PACE);
  const days = Math.max(1, (now - start) / DAY);
  const rows = await standings(userId, start, now + 60e3, mode, src, estimate, limit);
  return new Map(rows.map((r) => [keyOf(r), Number(r.plays) / days]));
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

/** The championship: this month's race, and what it does to the standings. */
async function seasonEvents(userId, { year, mode, src, estimate }) {
  const kst = new Date(Date.now() + KST);
  const y = year ?? kst.getUTCFullYear();
  const isNow = y === kst.getUTCFullYear();
  const lastM = isNow ? kst.getUTCMonth() + 1 : 12;
  const events = [];

  if (isNow) {
    const m = kst.getUTCMonth() + 1;
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
      const c = by.get(k) ?? { artist: r.artist, track: r.track ?? null, artist_key: r.artist_key, track_key: r.track_key ?? null, pts: 0 };
      c.pts += pointsForRank(r.place);
      by.set(k, c);
    }
    return [...by.values()].sort((a, b) => b.pts - a.pts);
  };
  const done = total((data ?? []).filter((r) => !(isNow && r.yr === y && r.mo === lastM)));
  const ifNow = total(data ?? []);
  const doneRank = new Map(done.map((c, i) => [keyOf(c), i + 1]));
  const name = (c) => (c.track ? c.track.replace(/\s*[([（［].*$/, '').trim() || c.track : c.artist);
  const tgt = (c) => ({ artist: c.artist, track: c.track, artist_key: c.artist_key, track_key: c.track_key });

  ifNow.slice(0, 8).forEach((c, i) => {
    const pos = i + 1;
    const was = doneRank.get(keyOf(c));
    if (isNow && was && was !== pos) {
      events.push({
        kind: 'projected', weight: was > pos ? 70 - pos : 50 - pos,
        title: `챔피언십 P${was} → P${pos}`,
        text: `이번 달이 지금 순위로 끝나면 ${name(c)} 챔피언십 P${was}에서 P${pos}로`,
        target: tgt(c),
      });
    }
    if (i > 0) {
      const gap = ifNow[i - 1].pts - c.pts;
      if (gap <= 10) {
        events.push({
          kind: 'battle', weight: 60 - pos,
          title: `챔피언십 P${pos - 1} 경쟁`,
          text: `${name(ifNow[i - 1])} vs ${name(c)}, ${gap === 0 ? '동점' : `${gap}pt 차`}`,
          target: tgt(c),
        });
      }
    }
  });
  if (ifNow.length >= 2) {
    events.push({
      kind: 'lead', weight: 12, title: `${y} 챔피언십 선두`,
      text: `${name(ifNow[0])}, ${ifNow[0].pts - ifNow[1].pts}pt 차 선두`,
      target: tgt(ifNow[0]),
    });
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
 * Rewords the events as race-radio lines. Facts stay as given; any failure
 * leaves the plain lines in place.
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
          '너는 음악 재생 순위를 F1 중계처럼 전하는 캐스터다. 각 항목의 text를 한국어 한 문장(45자 안팎)으로 다시 써라. '
          + '숫자·순위·이름은 그대로 두고 새로운 사실을 지어내지 마라. 과장된 감탄사나 이모지는 쓰지 말고 담백하고 긴장감 있게. '
          + 'title은 바꾸지 마라.',
        input: JSON.stringify({ context, items: events.map((e, i) => ({ id: i, title: e.title, text: e.text })) }),
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
