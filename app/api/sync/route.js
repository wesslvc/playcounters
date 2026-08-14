import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { syncUser, USER_COLUMNS } from '@/lib/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Called every 30 minutes by GitHub Actions with:
 *   Authorization: Bearer $CRON_SECRET
 *
 * Spotify only remembers a listener's last 50 plays, so the polling interval
 * is what decides whether anything is lost. 30 minutes covers roughly 100
 * tracks/hour of listening — heavier than anyone actually listens.
 */
export async function GET(req) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: users, error } = await db.from('users').select(USER_COLUMNS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const report = [];

  for (const user of users) {
    try {
      const { added } = await syncUser(user);
      report.push({ user: user.spotify_id, added });
    } catch (e) {
      console.error('sync failed for', user.spotify_id, e);
      report.push({ user: user.spotify_id, error: String(e.message || e) });
    }
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), report });
}
