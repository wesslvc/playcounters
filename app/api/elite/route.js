import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Who has gone far past the bar, all-time (elite_tiers), and how far: ruby
 * for artists past 2,000 plays and songs past 500, sky for artists past
 * 1,500 and songs past 300. Every view gives their pictures a matching foil.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const src = ['spotify', 'youtube'].includes(q.get('source')) ? q.get('source') : 'all';
  const { data, error } = await db.rpc('elite_tiers', {
    p_user: userId, p_source: src, p_estimate: q.get('estimate') === '1',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const artists = {}, tracks = {};
  for (const r of data ?? []) {
    if (r.track_key) tracks[`${r.artist_key}\u0000${r.track_key}`] = r.tier;
    else artists[r.artist_key] = r.tier;
  }
  return NextResponse.json({ artists, tracks });
}
