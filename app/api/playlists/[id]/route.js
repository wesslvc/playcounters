import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { rpcAll } from '@/lib/rpcPage';
import { spotifyFor } from '@/lib/spotifyUser';
import { pickImage } from '@/lib/spotify';
import { pointsForRank } from '@/lib/rank';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NEEDS = ['playlist-read-private'];
const MAX_TRACKS = 1000;
const DAY = 864e5;

/** One page of a playlist as songs. */
function songsFrom(page) {
  const out = [];
  for (const it of page.items ?? []) {
    const t = it.item ?? it.track;
    if (!t?.name || t.type === 'episode') continue;
    const artists = (t.artists ?? []).map((a) => a.name).filter(Boolean);
    if (!artists.length) continue;
    out.push({
      track: t.name,
      artist: artists[0],
      artists,
      album: t.album?.name ?? null,
      image: pickImage(t.album?.images),
      added_at: it.added_at ?? null,
      local: Boolean(it.is_local),
    });
  }
  return out;
}

/**
 * Every song in a playlist, in order. The first page says how many there
 * are; the rest are fetched a few at a time in parallel rather than one after
 * another. Spotify renamed tracks to items; the old path is the fallback.
 */
async function songsOf(call, id) {
  let base = `/playlists/${id}/items`;
  let size = 50;
  let res = await call(`${base}?limit=${size}&offset=0`);
  if (res.status === 404 || res.status === 405) {
    base = `/playlists/${id}/tracks`;
    size = 100;
    res = await call(`${base}?limit=${size}&offset=0`);
  }
  if (!res.ok) return { status: res.status };
  const first = await res.json();
  const total = Math.min(first.total ?? 0, MAX_TRACKS);
  const offsets = [];
  for (let o = size; o < total; o += size) offsets.push(o);
  const pages = [];
  for (let i = 0; i < offsets.length; i += 6) {
    const got = await Promise.all(offsets.slice(i, i + 6).map(async (o) => {
      const r = await call(`${base}?limit=${size}&offset=${o}`);
      return r.ok ? r.json() : { status: r.status };
    }));
    const bad = got.find((g) => g.status);
    if (bad) return { status: bad.status };
    pages.push(...got);
  }
  return { songs: [first, ...pages].flatMap(songsFrom).slice(0, MAX_TRACKS) };
}

/**
 * One playlist read against the plays: how much each song is actually
 * played, who it's made of, what's rising or going quiet, what's never been
 * played, how songs fared after going in, its Grand Prix record, and when
 * it grew.
 */
export async function GET(req, { params }) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';
  const estimate = q.get('estimate') === '1';

  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return NextResponse.json({ error: sp.error, reauth: sp.reauth ?? false }, { status: sp.status });

  const [metaRes, list] = await Promise.all([
    sp.call(`/playlists/${encodeURIComponent(params.id)}?fields=id,name,images,owner(display_name),external_urls`),
    songsOf(sp.call, encodeURIComponent(params.id)),
  ]);
  if (list.status === 401 || list.status === 403) {
    return NextResponse.json({ error: 'Spotify가 이 플레이리스트 읽기를 거부했습니다.', reauth: true }, { status: 403 });
  }
  if (list.status === 404) {
    return NextResponse.json({ error: 'Spotify가 이 플레이리스트를 열어주지 않아요. Spotify가 만든 추천 플리는 외부 앱에서 읽을 수 없어요.' }, { status: 404 });
  }
  if (!list.songs) return NextResponse.json({ error: `playlist failed: ${list.status}` }, { status: 502 });
  const meta = metaRes.ok ? await metaRes.json() : {};
  const songs = list.songs;

  const now = Date.now();
  const kst = new Date(now + 9 * 3600e3);
  const thisMonth = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - 9 * 3600e3).toISOString();
  const [{ data: counts, error }, races] = await Promise.all([
    db.rpc('playlist_plays_v2', {
      p_user: userId, p_items: songs.map((s) => ({ artist: s.artist, track: s.track, added: s.added_at ?? '' })),
      p_source: src, p_estimate: estimate,
    }),
    // every finished Grand Prix, for the playlist's race record
    rpcAll('season_races', {
      p_user: userId, p_from: new Date(0).toISOString(), p_to: thisMonth,
      p_mode: 'tracks', p_tz: 'Asia/Seoul', p_source: src, p_estimate: estimate,
    }, 20000).catch(() => ({ data: [] })),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byIndex = new Map((counts ?? []).map((c) => [c.i, c]));
  const tracks = songs.map((s, i) => {
    const c = byIndex.get(i) ?? {};
    return {
      ...s,
      artist_key: c.artist_key ?? null,
      track_key: c.track_key ?? null,
      plays: Math.round(Number(c.plays ?? 0)),
      plays30: Math.round(Number(c.plays30 ?? 0)),
      plays7: Math.round(Number(c.plays7 ?? 0)),
      plays3: Math.round(Number(c.plays3 ?? 0)),
      sinceAdded: Math.round(Number(c.since_added ?? 0)),
      first_at: c.first_at ?? null,
      last_at: c.last_at ?? null,
    };
  });

  // where each song stands. The last 7 days are set against the 23 before
  // them (not against a month that already contains them): a regular is played
  // twice a week or more; rising has the week at twice the earlier pace or
  // better; fading had a real earlier pace and the week fell to a third of it.
  for (const t of tracks) {
    const week = t.plays7 / 7;
    const before = (t.plays30 - t.plays7) / 23;
    t.status = t.plays === 0 ? 'never'
      : t.plays30 === 0 ? 'asleep'
        : t.plays30 - t.plays7 >= 4 && week <= before / 3 ? 'fading'
          : t.plays30 >= 8 ? 'core'
            : t.plays7 >= 3 && week >= before * 2 ? 'rising'
              : 'steady';
  }

  // who it's made of: songs per artist, and how much of the month's plays they take
  const artists = new Map();
  for (const t of tracks) {
    const a = artists.get(t.artist_key ?? t.artist) ?? { artist: t.artist, songs: 0, plays30: 0, plays: 0 };
    a.songs += 1;
    a.plays30 += t.plays30;
    a.plays += t.plays;
    artists.set(t.artist_key ?? t.artist, a);
  }

  // since it went in: never touched after being added (two weeks on), and
  // songs first heard through this playlist against ones already known
  const addedAt = (t) => Date.parse(t.added_at);
  const settled = tracks.filter((t) => Number.isFinite(addedAt(t)) && now - addedAt(t) > 14 * DAY);
  const untouched = settled.filter((t) => t.sinceAdded === 0)
    .sort((a, b) => addedAt(a) - addedAt(b));
  const met = tracks.filter((t) => t.first_at && Number.isFinite(addedAt(t)) && Date.parse(t.first_at) >= addedAt(t) - DAY).length;
  const known = tracks.filter((t) => t.first_at && Number.isFinite(addedAt(t)) && Date.parse(t.first_at) < addedAt(t) - DAY).length;
  const bestSince = [...tracks].sort((a, b) => b.sinceAdded - a.sinceAdded)[0];

  // the playlist's race record: Grand Prix wins and podiums of its songs
  const key = (r) => `${r.artist_key}\u0000${r.track_key}`;
  const inList = new Map(tracks.map((t) => [key(t), t]));
  const record = new Map();
  for (const r of races.data ?? []) {
    const t = inList.get(key(r));
    if (!t) continue;
    const c = record.get(key(r)) ?? { track: t.track, artist: t.artist, image: t.image, artist_key: t.artist_key, track_key: t.track_key, wins: 0, podiums: 0, points: 0, starts: 0 };
    c.starts += 1;
    c.points += pointsForRank(r.place);
    if (r.place === 1) c.wins += 1;
    if (r.place <= 3) c.podiums += 1;
    record.set(key(r), c);
  }
  const racers = [...record.values()].sort((a, b) => b.wins - a.wins || b.podiums - a.podiums || b.points - a.points);

  // when songs went in, month by month
  const byMonth = new Map();
  for (const t of tracks) {
    if (!Number.isFinite(addedAt(t))) continue;
    const m = new Date(addedAt(t) + 9 * 3600e3).toISOString().slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
  }
  const months = [...byMonth].sort((a, b) => a[0].localeCompare(b[0])).map(([month, n]) => ({ month, n }));

  const plays30 = tracks.reduce((a, t) => a + t.plays30, 0);
  const top5 = [...tracks].sort((a, b) => b.plays30 - a.plays30).slice(0, 5).reduce((a, t) => a + t.plays30, 0);
  const added = tracks.map((t) => Date.parse(t.added_at)).filter(Number.isFinite).sort((a, b) => a - b);
  const statusCount = tracks.reduce((m, t) => ({ ...m, [t.status]: (m[t.status] ?? 0) + 1 }), {});

  return NextResponse.json({
    playlist: {
      id: params.id,
      name: meta.name ?? null,
      image: pickImage(meta.images),
      owner: meta.owner?.display_name ?? null,
      url: meta.external_urls?.spotify ?? `https://open.spotify.com/playlist/${params.id}`,
    },
    summary: {
      songs: tracks.length,
      played: tracks.filter((t) => t.plays > 0).length,
      active: tracks.filter((t) => t.plays30 > 0).length,
      plays: tracks.reduce((a, t) => a + t.plays, 0),
      plays30,
      top5Share: plays30 ? Math.round((top5 / plays30) * 100) : 0,
      firstAdded: added[0] ? new Date(added[0]).toISOString() : null,
      lastAdded: added.length ? new Date(added[added.length - 1]).toISOString() : null,
      status: statusCount,
      over300: tracks.filter((t) => t.plays >= 300).length,
      over500: tracks.filter((t) => t.plays >= 500).length,
    },
    mvp: {
      allTime: [...tracks].sort((a, b) => b.plays - a.plays)[0] ?? null,
      month: [...tracks].sort((a, b) => b.plays30 - a.plays30)[0] ?? null,
      sinceAdded: bestSince?.sinceAdded ? bestSince : null,
    },
    added: { untouched: untouched.slice(0, 20), untouchedCount: untouched.length, settled: settled.length, met, known },
    races: { songs: racers.slice(0, 10), wins: racers.reduce((a, c) => a + c.wins, 0), winners: racers.filter((c) => c.wins).length, podiumSongs: racers.filter((c) => c.podiums).length },
    months,
    tracks,
    artists: [...artists.values()].sort((a, b) => b.songs - a.songs || b.plays30 - a.plays30).slice(0, 12),
  });
}
