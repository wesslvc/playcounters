import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Who has gone far past the bar, all-time (elite_keys): artists past 2,000
 * plays and songs past 300. Every view frames these in slate blue.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';
  const { data, error } = await db.rpc('elite_keys', {
    p_user: userId, p_source: src, p_estimate: q.get('estimate') === '1',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    artists: (data ?? []).filter((r) => !r.track_key).map((r) => r.artist_key),
    tracks: (data ?? []).filter((r) => r.track_key).map((r) => `${r.artist_key}\u0000${r.track_key}`),
  });
}
