import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** An artist's plays, song by song (club_songs). */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const artistKey = q.get('artist_key');
  if (!artistKey) return NextResponse.json({ error: 'artist_key required' }, { status: 400 });
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';

  const { data, error } = await db.rpc('club_songs', {
    p_user: userId, p_artist_key: artistKey, p_source: src, p_estimate: q.get('estimate') === '1',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    songs: (data ?? []).map((s) => ({ track: s.track, plays: Number(s.plays), pct: Number(s.pct) })),
  });
}
