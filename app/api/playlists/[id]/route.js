import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { rpcAll } from '@/lib/rpcPage';
import { spotifyFor } from '@/lib/spotifyUser';
import { pickImage } from '@/lib/spotify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NEEDS = ['playlist-read-private'];
const MAX_TRACKS = 1000;
const DAY = 864e5;

/** Every song in a playlist, in order. Spotify renamed tracks to items; both are read. */
async function songsOf(call, id) {
  const out = [];
  let path = `/playlists/${id}/items?limit=50`;
  let legacy = false;
  while (path && out.length < MAX_TRACKS) {
    let res = await call(path);
    if (!legacy && (res.status === 404 || res.status === 405) && out.length === 0) {
      legacy = true;
      path = `/playlists/${id}/tracks?limit=100`;
      res = await call(path);
    }
    if (!res.ok) return { status: res.status };
    const page = await res.json();
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
    path = page.next;
  }
  return { songs: out };
}

/**
 * One playlist read against the plays: how much each song is actually
 * played, who it's made of, what's rising or going quiet, what's never been
 * played, and what gets played a lot but isn't in it.
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
  const [{ data: counts, error }, recent] = await Promise.all([
    db.rpc('playlist_plays', {
      p_user: userId, p_items: songs.map((s) => ({ artist: s.artist, track: s.track })),
      p_source: src, p_estimate: estimate,
    }),
    rpcAll('top_items', {
      p_user: userId, p_from: new Date(now - 30 * DAY).toISOString(), p_to: new Date(now + 60e3).toISOString(),
      p_mode: 'tracks', p_tz: 'Asia/Seoul', p_limit: 60, p_source: src, p_estimate: estimate,
    }, 60),
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
      first_at: c.first_at ?? null,
      last_at: c.last_at ?? null,
    };
  });

  // where each song stands: rising, going quiet, asleep, never played, or just playing
  const ranked30 = [...tracks].map((t) => t.plays30).sort((a, b) => b - a);
  const core = Math.max(3, ranked30[Math.min(ranked30.length - 1, Math.floor(ranked30.length / 5))] ?? 0);
  for (const t of tracks) {
    const day30 = t.plays30 / 30;
    const day7 = t.plays7 / 7;
    t.status = t.plays === 0 ? 'never'
      : t.plays30 === 0 ? 'asleep'
        : t.plays7 >= 3 && day7 > day30 * 1.6 ? 'rising'
          : t.plays30 >= 4 && day7 < day30 * 0.4 ? 'fading'
            : t.plays30 >= core ? 'core'
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

  // played a lot this month, not in the playlist
  const inList = new Set(tracks.map((t) => `${t.artist_key}\u0000${t.track_key}`));
  const missing = (recent.data ?? [])
    .filter((r) => !inList.has(`${r.artist_key}\u0000${r.track_key}`))
    .slice(0, 10)
    .map((r) => ({ artist: r.artist, track: r.track, album: r.album, artist_key: r.artist_key, track_key: r.track_key, plays30: Number(r.plays) }));

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
    },
    tracks,
    artists: [...artists.values()].sort((a, b) => b.songs - a.songs || b.plays30 - a.plays30).slice(0, 12),
    missing,
  });
}
