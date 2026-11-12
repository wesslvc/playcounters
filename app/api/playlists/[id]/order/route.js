import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { spotifyFor } from '@/lib/spotifyUser';
import { itemsOf, MAX_SONGS, MAX_ONE_CALL } from '@/lib/playlistItems';
import { groupSongs } from '@/lib/grouping';
import { featureKey, storedFeatures, camelot, keyName } from '@/lib/features';
import { smoothness, wholeOrder } from '@/lib/reorder';
import { ask } from '@/lib/openai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NEEDS = ['playlist-read-private'];
const MODEL = () => process.env.OPENAI_MODEL || 'gpt-6.1-terra';
const KST = 9 * 3600e3;
const PER_DAY = 20;
const today = () => new Date(Date.now() + KST).toISOString().slice(0, 10);

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['order', 'note'],
  properties: {
    order: { type: 'array', items: { type: 'integer' } },
    note: { type: 'string' },
  },
};

/** What each way of ordering asks for. */
const GOALS = {
  flow: '앞뒤 곡이 자연스럽게 이어지게 짠다. 이웃한 곡끼리 템포 차이(반·두 배 템포는 같은 박으로 본다)와 에너지 차이를 작게, 조성은 Camelot 휠에서 같거나 이웃한 키로. '
    + '첫 곡은 귀를 끄는 곡, 가운데쯤 에너지가 가장 높고, 끝은 여운이 남게.',
  rise: '처음엔 에너지와 템포가 낮은 곡으로 시작해 끝으로 갈수록 점점 신나게 올라가게 짠다. 오르는 중에도 앞뒤 곡의 템포가 크게 튀지 않게.',
  calm: '처음엔 에너지가 높은 곡으로 시작해 끝으로 갈수록 점점 차분해지게 짠다. 내려가는 중에도 앞뒤 곡의 템포가 크게 튀지 않게.',
  group: '분위기·장르·소리가 비슷한 곡끼리 덩어리로 묶는다. 덩어리 안에서는 매끄럽게, 덩어리 사이 넘어갈 때도 갑자기 튀지 않게.',
};

const RULES = '너는 플레이리스트 순서를 짜는 DJ다. songs의 각 곡: i는 번호, t 제목, a 가수, bpm 템포, e 에너지(0-100), v 밝은 느낌(0-100), '
  + 'd 춤추기 좋은 정도(0-100), ac 어쿠스틱 정도(0-100), k 조성(Camelot), n 이 사람이 들은 횟수. 숫자가 없는 곡은 제목과 가수로 아는 만큼 판단한다. '
  + '같은 가수 곡이 세 곡 넘게 연달아 붙지 않게 한다. 모든 곡을 빠짐없이 한 번씩 담은 i의 순서를 order로 낸다. '
  + 'note는 어떻게 짰는지 한국어 한 문장(40자 안팎), 수식어 없이 구체적으로.';

const pct = (v) => (v == null ? null : Math.round(Number(v) * 100));

/**
 * POST /api/playlists/:id/order  { mode, prompt?, estimate? }
 * A new order for the playlist, not yet applied: by plays straight from the
 * counts, by the model from each song's numbers, or as it stands ('current')
 * for editing by hand. Comes back as indices
 * into the playlist's entries, with how smoothly the old and new orders run.
 */
export async function POST(req, { params }) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const mode = ['flow', 'rise', 'calm', 'group', 'plays', 'custom', 'current'].includes(body?.mode) ? body.mode : 'flow';
  const prompt = String(body?.prompt ?? '').trim().slice(0, 200);
  if (mode === 'custom' && !prompt) return NextResponse.json({ error: '어떻게 짤지 적어 주세요.' }, { status: 400 });

  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return NextResponse.json({ error: sp.error, reauth: sp.reauth ?? false }, { status: sp.status });
  const got = await itemsOf(sp.call, encodeURIComponent(params.id), MAX_SONGS + 100);
  if (got.status === 401 || got.status === 403) return NextResponse.json({ error: 'Spotify가 이 플레이리스트 읽기를 거부했습니다.', reauth: true }, { status: 403 });
  if (!got.items) return NextResponse.json({ error: `playlist failed: ${got.status}` }, { status: 502 });
  const items = got.items;
  const songIdx = items.map((x, i) => (x.song ? i : -1)).filter((i) => i >= 0);
  if (songIdx.length > MAX_SONGS) return NextResponse.json({ error: `${MAX_SONGS.toLocaleString()}곡이 넘는 플레이리스트는 아직 순서를 바꿀 수 없어요.` }, { status: 400 });
  if (['flow', 'rise', 'calm', 'custom'].includes(mode) && songIdx.length > MAX_ONE_CALL) {
    return NextResponse.json({ error: `곡이 ${songIdx.length.toLocaleString()}곡이라 이 방식은 쓸 수 없어요 (${MAX_ONE_CALL}곡까지). '비슷한 곡끼리'나 '많이 들은 순'은 곡 수와 상관없이 돼요.` }, { status: 400 });
  }

  const feats = await storedFeatures(songIdx.map((i) => featureKey(items[i])));
  const { data: counts } = await db.rpc('playlist_plays_v2', {
    p_user: userId, p_items: songIdx.map((i) => ({ artist: items[i].artist, track: items[i].track, added: '' })),
    p_source: 'all', p_estimate: Boolean(body?.estimate),
  });
  const plays = new Map((counts ?? []).map((c) => [c.i, Math.round(Number(c.plays ?? 0))]));

  // the songs as the page and the model see them
  const songs = songIdx.map((i, j) => {
    const f = feats.get(featureKey(items[i]));
    const has = f && f.via !== 'none';
    return {
      i,
      track: items[i].track,
      artist: items[i].artist,
      image: items[i].image,
      plays: plays.get(j) ?? 0,
      tempo: has && f.tempo != null ? Math.round(Number(f.tempo)) : null,
      energy: has && f.energy != null ? Number(f.energy) : null,
      valence: has && f.valence != null ? Number(f.valence) : null,
      acoustic: has && f.acousticness != null ? Number(f.acousticness) : null,
      key: has ? camelot(f) : null,
      keyName: has ? keyName(f) : null,
      f: has ? f : null,
    };
  });

  let songOrder;
  let note;
  let grouped = null;
  if (mode === 'current') {
    // the playlist as it stands, to edit by hand
    songOrder = songs.map((s) => s.i);
    note = '';
  } else if (mode === 'plays') {
    songOrder = [...songs].sort((a, b) => b.plays - a.plays).map((s) => s.i);
    note = '많이 들은 곡부터 차례로 놓았어요.';
  } else {
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'AI 정렬을 쓸 수 없어요' }, { status: 503 });
    const key = `order|${userId}`;
    const { data: kept } = await db.from('radio_notes').select('body').eq('key', key).maybeSingle();
    const day = today();
    const used = kept?.body?.day === day ? kept.body.used ?? 0 : 0;
    if (used >= PER_DAY) return NextResponse.json({ error: '오늘은 순서를 충분히 짰어요. 내일 다시 해 주세요.' }, { status: 429 });

    try {
      if (mode === 'group') {
        // any size: groups named over the whole list, songs sorted into them a couple of hundred at a time
        const t0 = Date.now();
        grouped = await groupSongs(songs, { model: MODEL() });
        songOrder = grouped.order;
        note = `${grouped.groups.length}개 묶음으로 나눴어요: ${grouped.groups.map((g) => g.name).join(' · ')}`;
        console.log(`playlist order · group · ${songs.length} songs · ${grouped.groups.length} groups · ${grouped.missed} placed by artist · ${Date.now() - t0}ms`);
      } else {
        // one call over the whole list (up to MAX_ONE_CALL songs)
        const input = {
          songs: songs.map((s, j) => ({
            i: j, t: s.track, a: s.artist,
            ...(s.tempo != null ? { bpm: s.tempo } : {}),
            ...(s.f ? { e: pct(s.f.energy), v: pct(s.f.valence), d: pct(s.f.danceability), ac: pct(s.f.acousticness) } : {}),
            ...(s.key ? { k: s.key } : {}),
            n: s.plays,
          })),
        };
        const goal = mode === 'custom' ? `이 사람의 요청: "${prompt}". 요청이 먼저고, 그 안에서 앞뒤 곡이 자연스럽게 이어지게 짠다.` : GOALS[mode];
        const answer = await ask(MODEL(), `${RULES} ${goal}`, input, SCHEMA, AbortSignal.timeout(50000), songs.length > 80 ? 'low' : 'medium');
        songOrder = wholeOrder(answer.order, songs.length).map((j) => songs[j].i);
        note = String(answer.note ?? '').trim();
        console.log(`playlist order · ${mode} · ${songs.length} songs · ${answer.order?.length ?? 0} placed`);
      }
    } catch (e) {
      console.error('playlist order failed', mode, e.message);
      return NextResponse.json({ error: mode === 'group' ? '묶음을 나누지 못했어요. 잠시 뒤 다시 시도해 주세요.' : '순서를 짜지 못했어요. 잠시 뒤 다시 시도해 주세요.' }, { status: 502 });
    }
    await db.from('radio_notes').upsert({ key, body: { day, used: used + 1 }, created_at: new Date().toISOString() });
  }

  // entries that aren't songs (episodes, broken ones) keep their order, after the songs
  const rest = items.map((_, i) => i).filter((i) => !items[i].song);
  const order = [...songOrder, ...rest];
  const bySong = new Map(songs.map((s) => [s.i, s]));
  const seq = (o) => o.map((i) => bySong.get(i)).filter(Boolean);

  return NextResponse.json({
    mode,
    note,
    order,
    entries: items.map((x) => ({ uri: x.uri ?? `none:${x.pos}`, track: x.track, artist: x.artist, image: x.image, song: x.song })),
    songs: songs.map(({ f, ...s }) => (grouped ? { ...s, g: grouped.of.get(s.i) } : s)),
    groups: grouped ? grouped.groups.map((g, k) => ({ ...g, count: songs.filter((s) => grouped.of.get(s.i) === k).length })) : null,
    before: smoothness(seq(items.map((_, i) => i))),
    after: smoothness(seq(order)),
    numbers: songs.filter((s) => s.tempo != null || s.energy != null).length,
  });
}
