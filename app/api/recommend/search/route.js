import { NextResponse } from 'next/server';
import { db, currentUserId } from '@/lib/db';

export const dynamic = 'force-dynamic';

const DAY = 864e5;

/**
 * GET /api/recommend/search?q=
 * Songs you've played whose title or artist contains q, most played first
 * (titles that start with it ahead). With no q, what you've played most in
 * the last month — something to pick from before typing.
 */
export async function GET(req) {
  const userId = currentUserId();
  if (!userId) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 60);

  if (!q) {
    const now = Date.now();
    const { data, error } = await db.rpc('top_items', {
      p_user: userId, p_from: new Date(now - 30 * DAY).toISOString(), p_to: new Date(now + 60e3).toISOString(),
      p_mode: 'tracks', p_tz: 'Asia/Seoul', p_limit: 8, p_source: 'all', p_estimate: false,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ items: (data ?? []).map(({ artist, track, artist_key, track_key, plays }) => ({ artist, track, artist_key, track_key, plays: Number(plays) })) });
  }

  // a % or _ typed is a character, not a wildcard
  const { data, error } = await db.rpc('search_played', { p_user: userId, p_q: q.replace(/[\\%_]/g, (c) => `\\${c}`), p_limit: 8 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: (data ?? []).map((r) => ({ ...r, plays: Number(r.plays) })) });
}
