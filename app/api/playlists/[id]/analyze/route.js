import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/db';
import { spotifyFor } from '@/lib/spotifyUser';
import { itemsOf, MAX_SONGS } from '@/lib/playlistItems';
import { ensureFeatures } from '@/lib/features';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NEEDS = ['playlist-read-private'];


/**
 * POST /api/playlists/:id/analyze — gets every song's numbers (tempo, energy,
 * ...) ready for a reorder, as much as fits in one call. The page calls again
 * while `pending` is above zero, showing how far it's got.
 */
export async function POST(req, { params }) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return NextResponse.json({ error: sp.error, reauth: sp.reauth ?? false }, { status: sp.status });

  const got = await itemsOf(sp.call, encodeURIComponent(params.id), MAX_SONGS + 100);
  if (got.status === 401 || got.status === 403) return NextResponse.json({ error: 'Spotify가 이 플레이리스트 읽기를 거부했습니다.', reauth: true }, { status: 403 });
  if (!got.items) return NextResponse.json({ error: `playlist failed: ${got.status}` }, { status: 502 });
  const songs = got.items.filter((x) => x.song);
  if (got.total > MAX_SONGS + 100 || songs.length > MAX_SONGS) {
    return NextResponse.json({ error: `${MAX_SONGS}곡이 넘는 플레이리스트는 아직 순서를 바꿀 수 없어요.` }, { status: 400 });
  }
  if (songs.length < 3) return NextResponse.json({ error: '곡이 3개 이상이어야 순서를 바꿀 수 있어요.' }, { status: 400 });

  const { features, pending, total } = await ensureFeatures(songs, { budgetMs: 38000 });
  const placed = [...features.values()].filter((r) => r.via !== 'none').length;
  return NextResponse.json({ total, ready: total - pending, placed, pending });
}
