import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/db';
import { spotifyFor, busyMessage } from '@/lib/spotifyUser';
import { pickImage } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

const NEEDS = ['playlist-read-private'];

/** The signed-in user's Spotify playlists — theirs and the ones they follow. */
export async function GET() {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return NextResponse.json({ error: sp.error, reauth: sp.reauth ?? false }, { status: sp.status });

  const lists = [];
  for (let next = '/me/playlists?limit=50'; next && lists.length < 200;) {
    const res = await sp.call(next);
    if (res.status === 429) return NextResponse.json({ error: busyMessage(sp.waitLeft()), wait: sp.waitLeft() }, { status: 429 });
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: 'Spotify가 플레이리스트 읽기를 거부했습니다.', reauth: true }, { status: 403 });
    }
    if (!res.ok) return NextResponse.json({ error: `playlists failed: ${res.status}` }, { status: 502 });
    const page = await res.json();
    for (const p of page.items ?? []) {
      if (!p?.id) continue;
      lists.push({
        id: p.id,
        name: p.name,
        image: pickImage(p.images),
        count: p.items?.total ?? p.tracks?.total ?? null,
        mine: p.owner?.id === sp.user.spotify_id,
        owner: p.owner?.display_name ?? null,
      });
    }
    next = page.next;
  }
  return NextResponse.json({ playlists: lists });
}
