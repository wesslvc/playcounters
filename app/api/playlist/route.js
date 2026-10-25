import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';
import { refreshAccessToken } from '@/lib/spotify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const API = 'https://api.spotify.com/v1';
const NEEDED = 'playlist-modify-private';
const MAX_TRACKS = 100;

/**
 * Save a ranked list as a private Spotify playlist, in rank order.
 *
 * Plays are stored by name, not Spotify id, so each song is found again by
 * search. Logins from before export existed lack the playlist scope; those
 * get `reauth` back and the page offers to reconnect.
 */
export async function POST(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const items = (body?.items ?? []).filter((i) => i?.track && i?.artist).slice(0, MAX_TRACKS);
  const name = String(body?.name ?? '').slice(0, 100) || 'playcounters';
  const description = String(body?.description ?? '').slice(0, 300);
  if (!items.length) return NextResponse.json({ error: 'no tracks' }, { status: 400 });

  const { data: user, error } = await db.from('users')
    .select('id, spotify_id, refresh_token').eq('id', userId).single();
  if (error || !user) return NextResponse.json({ error: 'user not found' }, { status: 404 });

  let token;
  try {
    token = await refreshAccessToken(user.refresh_token);
  } catch (e) {
    return NextResponse.json({ error: e.message, reauth: true }, { status: 403 });
  }
  if (token.refresh_token && token.refresh_token !== user.refresh_token) {
    await db.from('users').update({ refresh_token: token.refresh_token }).eq('id', user.id);
  }
  if (token.scope && !token.scope.split(' ').includes(NEEDED)) {
    return NextResponse.json({ error: 'missing scope', reauth: true }, { status: 403 });
  }

  const call = (path, init = {}) => fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', ...init.headers },
    cache: 'no-store',
  });

  // Found a few at a time: search is the rate-limited part.
  const uris = new Array(items.length).fill(null);
  for (let i = 0; i < items.length; i += 5) {
    await Promise.all(items.slice(i, i + 5).map(async (it, j) => {
      uris[i + j] = await findTrack(call, it);
    }));
  }
  const found = uris.filter(Boolean);
  const missing = items.filter((_, i) => !uris[i]).map((i) => `${i.track} — ${i.artist}`);
  if (!found.length) return NextResponse.json({ error: '곡을 하나도 찾지 못했습니다.', missing }, { status: 404 });

  const payload = JSON.stringify({ name, description, public: false });
  let res = await call('/me/playlists', { method: 'POST', body: payload });
  if (res.status === 404 || res.status === 405) {
    res = await call(`/users/${encodeURIComponent(user.spotify_id)}/playlists`, { method: 'POST', body: payload });
  }
  if (res.status === 401 || res.status === 403) {
    return NextResponse.json({ error: 'Spotify가 플레이리스트 생성을 거부했습니다.', reauth: true }, { status: 403 });
  }
  if (!res.ok) return NextResponse.json({ error: `playlist create failed: ${res.status}` }, { status: 502 });
  const playlist = await res.json();

  for (let i = 0; i < found.length; i += 100) {
    const chunk = JSON.stringify({ uris: found.slice(i, i + 100) });
    let add = await call(`/playlists/${playlist.id}/items`, { method: 'POST', body: chunk });
    if (add.status === 404 || add.status === 405) {
      add = await call(`/playlists/${playlist.id}/tracks`, { method: 'POST', body: chunk });
    }
    if (!add.ok) return NextResponse.json({ error: `adding tracks failed: ${add.status}` }, { status: 502 });
  }

  return NextResponse.json({
    url: playlist.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlist.id}`,
    added: found.length,
    missing,
  });
}

const clean = (s) => s.replace(/["']/g, ' ').replace(/\s*[([].*?(feat|with|prod)[^)\]]*[)\]]/gi, '').trim();

/** The Spotify URI that best matches a stored artist and title, or null. */
async function findTrack(call, { artist, track }) {
  const tries = [`track:"${clean(track)}" artist:"${clean(artist)}"`, `${clean(track)} ${clean(artist)}`];
  for (const q of tries) {
    const res = await call(`/search?type=track&limit=5&q=${encodeURIComponent(q)}`);
    if (!res.ok) continue;
    const hits = (await res.json())?.tracks?.items ?? [];
    const a = artist.toLowerCase();
    const best = hits.find((h) => h.artists?.some((x) => x.name?.toLowerCase() === a)) ?? hits[0];
    if (best?.uri) return best.uri;
  }
  return null;
}
