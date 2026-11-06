import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { rpcAll } from '@/lib/rpcPage';
import { deezerGet } from '@/lib/artwork';
import { ask } from '@/lib/openai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = () => process.env.OPENAI_MODEL || 'gpt-6.1-terra';
const DAY = 864e5;
const KST = 9 * 3600e3;
const TZ = 'Asia/Seoul';
const REFRESHES = 5; // asks for a fresh set a day
const KEEP = 12;

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'artist', 'reason', 'because'],
        properties: {
          title: { type: 'string' },
          artist: { type: 'string' },
          reason: { type: 'string' },
          because: { type: 'string' },
        },
      },
    },
  },
};

const RULES = '너는 이 사람의 실제 재생 기록을 읽고 아직 안 들어본 곡을 골라 주는 음악 큐레이터다. '
  + 'recent는 최근 60일 많이 들은 곡, artists는 통산 많이 들은 가수, avoid는 이미 추천했던 곡이다. '
  + '실제로 발매되어 스트리밍에서 찾을 수 있는 곡만, 30곡을 골라라. 확실하지 않은 곡은 넣지 마라. recent에 있는 곡과 avoid에 있는 곡은 빼라. '
  + '3분의 1은 이 사람이 자주 듣는 가수의 안 들어봤을 법한 곡, 나머지는 비슷한 결의 다른 가수 곡으로. '
  + '한 가수는 두 곡까지. 이 사람이 듣는 언어와 장르의 비율을 따르되, 뻔한 대표곡만 고르지 말고 결이 맞는 곡을 골라라. '
  + 'title과 artist는 Spotify에 표기된 그대로(한국 가수도 IU, AKMU, NewJeans처럼 영문 표기). because는 recent에 있는 곡 제목 하나를 그대로. '
  + 'reason은 because와 무엇이 닮았는지 한국어 한 문장(30자 안팎)으로: 소리·분위기·보컬·템포처럼 구체적으로, 칭찬이나 수식어는 빼고.';

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/\(.*?\)|\[.*?\]|feat\..*$|[^\p{L}\p{N}]+/gu, '');
const today = () => new Date(Date.now() + KST).toISOString().slice(0, 10);

/** Close enough to be the same name: one contains the other once both are stripped down. */
const same = (a, b) => {
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x));
};

/**
 * The song as it exists, found on Deezer (the same catalogue the app's
 * pictures come from) under that artist and title, or null. The link opens
 * it in Spotify's search, where it's listened to.
 */
async function find({ title, artist }) {
  for (const q of [`artist:"${artist}" track:"${title}"`, `${artist} ${title}`]) {
    const json = await deezerGet('/search/track', { q, limit: '10' }).catch(() => null);
    const t = (json?.data ?? []).find((x) => same(x.artist?.name, artist) && same(x.title_short ?? x.title, title));
    if (t) {
      return {
        id: `dz${t.id}`,
        title: t.title_short || t.title,
        artist: t.artist.name,
        artists: [t.artist.name],
        image: t.album?.cover_medium ?? t.album?.cover ?? null,
        url: `https://open.spotify.com/search/${encodeURIComponent(`${t.artist.name} ${t.title_short || t.title}`)}`,
      };
    }
  }
  return null;
}

/** Picks a fresh set: the model chooses, Spotify confirms, the plays rule out what's been heard. */
async function pickSongs(userId, avoid) {
  const now = Date.now();
  const [recent, artists] = await Promise.all([
    rpcAll('top_items', {
      p_user: userId, p_from: new Date(now - 60 * DAY).toISOString(), p_to: new Date(now + 60e3).toISOString(),
      p_mode: 'tracks', p_tz: TZ, p_limit: 40, p_source: 'all', p_estimate: false,
    }, 40),
    rpcAll('top_items', {
      p_user: userId, p_from: new Date(0).toISOString(), p_to: new Date(now + 60e3).toISOString(),
      p_mode: 'artists', p_tz: TZ, p_limit: 300, p_source: 'all', p_estimate: false,
    }, 300),
  ]);
  if (recent.error) throw new Error(recent.error.message);
  const songs = recent.data ?? [];
  if (songs.length < 5) return { error: '추천하려면 최근 기록이 조금 더 필요해요', status: 422 };

  const answer = await ask(MODEL(), RULES, {
    recent: songs.map((r) => ({ song: r.track, artist: r.artist, plays: Number(r.plays) })),
    artists: (artists.data ?? []).slice(0, 25).map((r) => ({ artist: r.artist, plays: Number(r.plays) })),
    avoid,
  }, SCHEMA, AbortSignal.timeout(40000), 'low');

  // only songs Spotify has under that artist, once each
  const seen = new Set();
  const found = (await Promise.all((answer.items ?? []).slice(0, 36).map(async (x) => {
    const hit = await find(x).catch(() => null);
    return hit && { ...hit, reason: String(x.reason ?? '').trim(), because: String(x.because ?? '').trim() };
  }))).filter((x) => x && !seen.has(x.id) && seen.add(x.id));

  // and none already played, by the same keys plays are stored under
  const { data: counts, error } = await db.rpc('playlist_plays_v2', {
    p_user: userId, p_items: found.map((x) => ({ artist: x.artist, track: x.title, added: '' })),
    p_source: 'all', p_estimate: false,
  });
  if (error) throw new Error(error.message);
  const heard = new Map((counts ?? []).map((c) => [c.i, Number(c.plays)]));
  const known = new Set((artists.data ?? []).map((r) => r.artist_key));
  const keyOf = new Map((counts ?? []).map((c) => [c.i, c.artist_key]));
  const fromRecent = new Set(songs.map((r) => r.track));
  const items = found
    .map((x, i) => ({ ...x, heard: heard.get(i) ?? 0, newArtist: !known.has(keyOf.get(i)) }))
    .filter((x) => x.heard === 0)
    .map(({ heard: _, ...x }) => ({ ...x, because: fromRecent.has(x.because) ? x.because : null }))
    .slice(0, KEEP);
  console.log(`recommend · ${answer.items?.length ?? 0} asked · ${found.length} found · ${items.length} unheard`);
  return { items };
}

/**
 * GET /api/recommend[?refresh=1]
 * Songs you haven't played, chosen from what you have. One set a day, kept
 * in radio_notes; ?refresh=1 picks again, a few times a day at most.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: '추천을 쓸 수 없어요' }, { status: 503 });

  const key = `rec|${userId}`;
  const { data: kept } = await db.from('radio_notes').select('body').eq('key', key).maybeSingle();
  const prev = kept?.body ?? {};
  const day = today();
  const used = prev.day === day ? prev.refreshes ?? 0 : 0;
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  const left = REFRESHES - used;
  if (prev.day === day && prev.items?.length && !(refresh && left > 0)) {
    return NextResponse.json({ items: prev.items, at: prev.at, left });
  }

  try {
    // what was suggested in the last few sets, so a new set is new
    const avoid = (prev.history ?? []).slice(-60);
    const out = await pickSongs(userId, avoid);
    if (out.error) return NextResponse.json(out, { status: out.status ?? 500 });
    // an empty set isn't kept: the next visit (or 다시 고르기) tries again, at no cost to the day's re-picks
    if (!out.items.length) {
      if (prev.items?.length) return NextResponse.json({ items: prev.items, at: prev.at, left, stale: true });
      return NextResponse.json({ error: '이번엔 추천곡을 찾지 못했어요. 다시 고르기를 눌러 주세요.', items: [], left }, { status: 200 });
    }
    const body = {
      day,
      at: new Date().toISOString(),
      items: out.items,
      refreshes: refresh && prev.day === day ? used + 1 : used,
      history: [...(prev.history ?? []), ...out.items.map((x) => `${x.artist} - ${x.title}`)].slice(-120),
    };
    await db.from('radio_notes').upsert({ key, body, created_at: body.at });
    return NextResponse.json({ items: body.items, at: body.at, left: REFRESHES - body.refreshes });
  } catch (e) {
    console.error('recommend failed', e.message);
    if (prev.items?.length) return NextResponse.json({ items: prev.items, at: prev.at, left, stale: true });
    return NextResponse.json({ error: '추천을 고르지 못했어요. 잠시 뒤 다시 시도해 주세요.' }, { status: 502 });
  }
}
