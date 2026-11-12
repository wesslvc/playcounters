import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/db';
import { spotifyFor } from '@/lib/spotifyUser';
import { itemsOf, MAX_SONGS } from '@/lib/playlistItems';
import { tagged, fitTarget, movesFor } from '@/lib/reorder';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NEEDS = ['playlist-read-private', 'playlist-modify-private', 'playlist-modify-public'];
const BUDGET = 40000;

/**
 * POST /api/playlists/:id/apply  { target: [uri, ...] }
 * Puts the playlist in the given order on Spotify by moving entries one at a
 * time, which keeps each one's "added" date. The playlist is read fresh on
 * every call and the moves worked out from where things stand, so a long
 * list is done over several calls (the page calls again while `left` is
 * above zero) and a change made meanwhile in Spotify is taken in stride.
 * Undo is the same call with the old order.
 */
export async function POST(req, { params }) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const target = (Array.isArray(body?.target) ? body.target : []).map(String).slice(0, MAX_SONGS + 100);
  if (!target.length) return NextResponse.json({ error: 'no order' }, { status: 400 });

  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return NextResponse.json({ error: sp.error, reauth: sp.reauth ?? false }, { status: sp.status });
  const id = encodeURIComponent(params.id);
  const got = await itemsOf(sp.call, id, MAX_SONGS + 100);
  if (got.status === 401 || got.status === 403) return NextResponse.json({ error: 'Spotify가 이 플레이리스트 읽기를 거부했습니다.', reauth: true }, { status: 403 });
  if (!got.items) return NextResponse.json({ error: `playlist failed: ${got.status}` }, { status: 502 });

  const current = tagged(got.items.map((x) => x.uri ?? `none:${x.pos}`));
  const want = fitTarget(current, tagged(target));
  const moves = movesFor(current, want);

  const until = Date.now() + BUDGET;
  let path = `/playlists/${id}/items`;
  let done = 0;
  for (const m of moves) {
    if (Date.now() > until) break;
    const payload = JSON.stringify({ range_start: m.from, insert_before: m.to, range_length: 1 });
    let res = await sp.call(path, { method: 'PUT', body: payload });
    if ((res.status === 404 || res.status === 405) && path.endsWith('/items')) {
      path = `/playlists/${id}/tracks`;
      res = await sp.call(path, { method: 'PUT', body: payload });
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 5;
      return NextResponse.json({ done, left: moves.length - done, wait });
    }
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: 'Spotify가 순서 변경을 거부했어요. 내가 만든 플레이리스트만 바꿀 수 있어요.', reauth: res.status === 401 }, { status: 403 });
    }
    if (!res.ok) return NextResponse.json({ error: `순서를 바꾸다 멈췄어요 (${res.status})`, done, left: moves.length - done }, { status: 502 });
    done += 1;
  }
  return NextResponse.json({ done, left: moves.length - done, total: moves.length });
}
