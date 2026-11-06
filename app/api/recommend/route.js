import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { deezerGet } from '@/lib/artwork';
import { ask } from '@/lib/openai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = () => process.env.OPENAI_MODEL || 'gpt-6.1-terra';
const KST = 9 * 3600e3;
const PER_DAY = 30; // asks a day
const COUNTS = [5, 10, 20];
const MAX_SEEDS = 10;

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

const rules = (n) => '너는 음악 큐레이터다. 아래 조건이 있으면 seeds의 결보다 조건이 먼저다. seeds는 이 사람이 직접 고른, 들어 본 곡들이다. '
  + 'seeds에 공통으로 흐르는 결(소리, 분위기, 보컬, 장르, 템포, 시대)을 읽고 그 결을 따라 이 사람에게 들려줄 곡을 고른다. '
  + `실제로 발매되어 스트리밍에서 찾을 수 있는 곡만 ${n}곡 골라라. 확실하지 않은 곡은 넣지 마라. seeds에 있는 곡과 avoid에 있는 곡은 빼라. `
  + 'seeds 가수의 다른 곡은 전체의 3분의 1 이하, 나머지는 결이 비슷한 다른 가수. 한 가수는 두 곡까지. 뻔한 대표곡만 고르지 마라. '
  + 'title과 artist는 Spotify에 표기된 그대로(한국 가수도 IU, AKMU, NewJeans처럼 영문 표기). because는 seeds 중 가장 닮은 곡의 title을 그대로. '
  + 'reason은 because와 무엇이 닮았는지 한국어 한 문장(30자 안팎)으로: 소리·분위기·보컬·템포처럼 구체적으로, 칭찬이나 수식어는 빼고.';

/** The settings the tab can send, and how each is put to the model. */
const GENRES = ['K-POP', '팝', '힙합 · 랩', 'R&B · 소울', '발라드', '록', '인디', '일렉트로닉', 'J-POP', 'OST · 클래식', '재즈'];
const LANG = { ko: '노래 언어는 한국어인 곡만.', en: '노래 언어는 영어인 곡만.', ja: '노래 언어는 일본어인 곡만.' };
const ERA = { new: '최근 2년 안에 나온 곡만.', '2010s': '2010년부터 2019년 사이에 나온 곡만.', old: '2009년 이전에 나온 곡만.' };
const FAME = { hidden: '대표곡이나 차트 히트곡은 피하고, 덜 알려진 수록곡·B사이드·작은 가수의 곡 위주로.', popular: '널리 알려진 히트곡 위주로.' };

function prefLines(p) {
  const out = [];
  const genres = (Array.isArray(p?.genres) ? p.genres : []).filter((g) => GENRES.includes(g)).slice(0, 3);
  if (genres.length) out.push(`장르는 ${genres.join(', ')} 안에서만 골라라. seeds의 결은 그 장르 안에서 따라라.`);
  if (LANG[p?.lang]) out.push(LANG[p.lang]);
  if (ERA[p?.era]) out.push(ERA[p.era]);
  if (p?.artists === 'new') out.push('seeds 가수와 knownArtists에 있는 가수의 곡은 빼고, 이 사람이 처음 들을 가수로만.');
  else if (p?.artists === 'same') out.push('seeds 가수의 다른 곡을 절반 넘게, 나머지는 아주 가까운 결의 가수로.');
  if (FAME[p?.fame]) out.push(FAME[p.fame]);
  const mood = String(p?.mood ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (mood) out.push(`이 사람이 원하는 느낌: "${mood}". 이 느낌을 가장 먼저 맞춰라.`);
  return { lines: out, wantsKnown: p?.artists === 'new' };
}

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
      const name = t.title_short || t.title;
      return {
        id: `dz${t.id}`,
        title: name,
        artist: t.artist.name,
        image: t.album?.cover_medium ?? t.album?.cover ?? null,
        url: `https://open.spotify.com/search/${encodeURIComponent(`${t.artist.name} ${name}`)}`,
      };
    }
  }
  return null;
}

/**
 * POST /api/recommend  { seeds: [{ artist, track }], count: 5 | 10 | 20 }
 * Songs like the ones in the box, that you haven't played: the model picks
 * from the seeds alone, each pick must exist on Deezer under that artist and
 * title, and anything with plays of its own is dropped. A few dozen asks a
 * day; what was suggested lately is kept so a new ask brings new songs.
 */
export async function POST(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: '추천을 쓸 수 없어요' }, { status: 503 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const seeds = (Array.isArray(body?.seeds) ? body.seeds : [])
    .filter((s) => s?.artist && s?.track)
    .slice(0, MAX_SEEDS)
    .map((s) => ({ title: String(s.track).slice(0, 200), artist: String(s.artist).slice(0, 200) }));
  if (!seeds.length) return NextResponse.json({ error: '상자에 곡을 하나 이상 담아 주세요' }, { status: 400 });
  const count = COUNTS.includes(Number(body?.count)) ? Number(body.count) : 10;
  const { lines: extra, wantsKnown } = prefLines(body?.prefs);

  const key = `rec|${userId}`;
  const { data: kept } = await db.from('radio_notes').select('body').eq('key', key).maybeSingle();
  const prev = kept?.body ?? {};
  const day = today();
  const used = prev.day === day ? prev.used ?? 0 : 0;
  if (used >= PER_DAY) return NextResponse.json({ error: '오늘은 추천을 충분히 받았어요. 내일 다시 해 주세요.' }, { status: 429 });

  try {
    // asked for more than wanted: some won't be found, some will turn out heard
    const want = Math.min(40, Math.ceil(count * 1.6) + 4);
    const avoid = (prev.history ?? []).slice(-80);
    // for '처음 듣는 가수만': who this listener already plays, to leave out
    let knownArtists;
    if (wantsKnown) {
      const { data: top } = await db.rpc('top_items', {
        p_user: userId, p_from: new Date(0).toISOString(), p_to: new Date(Date.now() + 60e3).toISOString(),
        p_mode: 'artists', p_tz: 'Asia/Seoul', p_limit: 60, p_source: 'all', p_estimate: false,
      });
      knownArtists = (top ?? []).map((r) => r.artist);
    }
    const instructions = [rules(want), ...extra].join(' ');
    const answer = await ask(MODEL(), instructions, { seeds, avoid, ...(knownArtists ? { knownArtists } : {}) }, SCHEMA, AbortSignal.timeout(45000), 'low');

    const seen = new Set();
    const found = (await Promise.all((answer.items ?? []).slice(0, want).map(async (x) => {
      const hit = await find(x).catch(() => null);
      return hit && { ...hit, reason: String(x.reason ?? '').trim(), because: String(x.because ?? '').trim() };
    }))).filter((x) => x && !seen.has(x.id) && seen.add(x.id));

    // none already played, by the same keys plays are stored under
    const { data: counts, error } = await db.rpc('playlist_plays_v2', {
      p_user: userId, p_items: found.map((x) => ({ artist: x.artist, track: x.title, added: '' })),
      p_source: 'all', p_estimate: false,
    });
    if (error) throw new Error(error.message);
    const heard = new Map((counts ?? []).map((c) => [c.i, Number(c.plays)]));
    const seedTitles = new Set(seeds.map((s) => s.title));
    // '처음 듣는 가수만' means it: anyone in the box or among the most played is left out
    const familiar = new Set(wantsKnown ? [...seeds.map((x) => x.artist), ...(knownArtists ?? [])].map(norm) : []);
    const items = found
      .filter((x, i) => !(heard.get(i) > 0) && !familiar.has(norm(x.artist)))
      .map((x) => ({ ...x, because: seedTitles.has(x.because) ? x.because : null }))
      .slice(0, count);
    console.log(`recommend · ${seeds.length} seeds · ${answer.items?.length ?? 0} asked · ${found.length} found · ${items.length} kept of ${count}`);

    const at = new Date().toISOString();
    await db.from('radio_notes').upsert({
      key,
      body: { day, used: used + 1, history: [...(prev.history ?? []), ...items.map((x) => `${x.artist} - ${x.title}`)].slice(-160) },
      created_at: at,
    });
    if (!items.length) return NextResponse.json({ error: '이번엔 추천곡을 찾지 못했어요. 상자를 바꾸거나 다시 눌러 주세요.', items: [] });
    return NextResponse.json({ items, at, left: PER_DAY - used - 1 });
  } catch (e) {
    console.error('recommend failed', e.message);
    return NextResponse.json({ error: '추천을 고르지 못했어요. 잠시 뒤 다시 시도해 주세요.' }, { status: 502 });
  }
}
