import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { refreshAccessToken, recentlyPlayed } from '@/lib/spotify';

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

  const { data: users, error } = await db
    .from('users')
    .select('id, spotify_id, refresh_token, last_played_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const report = [];

  for (const user of users) {
    try {
      const token = await refreshAccessToken(user.refresh_token);

      // Spotify rotates refresh tokens occasionally. Missing this silently
      // breaks sync for that user a few weeks later.
      if (token.refresh_token && token.refresh_token !== user.refresh_token) {
        await db.from('users')
          .update({ refresh_token: token.refresh_token })
          .eq('id', user.id);
      }

      const afterMs = user.last_played_at
        ? new Date(user.last_played_at).getTime()
        : undefined;

      const plays = await recentlyPlayed(token.access_token, afterMs);

      if (plays.length) {
        const rows = plays.map((p) => ({ ...p, user_id: user.id }));
        // Primary key (user_id, played_at) makes re-running this harmless.
        const { error: insErr } = await db
          .from('plays')
          .upsert(rows, { onConflict: 'user_id,played_at', ignoreDuplicates: true });
        if (insErr) throw insErr;
      }

      const newest = plays.reduce(
        (max, p) => (p.played_at > max ? p.played_at : max),
        user.last_played_at || '1970-01-01T00:00:00Z'
      );

      await db.from('users').update({
        last_synced_at: new Date().toISOString(),
        last_played_at: newest,
      }).eq('id', user.id);

      report.push({ user: user.spotify_id, added: plays.length });
    } catch (e) {
      console.error('sync failed for', user.spotify_id, e);
      report.push({ user: user.spotify_id, error: String(e.message || e) });
    }
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), report });
}
