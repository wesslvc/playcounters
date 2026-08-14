import { db } from './db';
import { refreshAccessToken, recentlyPlayed } from './spotify';

/** Everything syncUser needs off the users row. */
export const USER_COLUMNS = 'id, spotify_id, refresh_token, last_played_at, last_synced_at';

/**
 * Pull one user's new plays from Spotify and store them.
 *
 * Shared by the cron route (/api/sync, every user, bearer CRON_SECRET) and
 * the dashboard's refresh button (/api/sync/me, just the signed-in user).
 */
export async function syncUser(user) {
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
    const { error } = await db
      .from('plays')
      .upsert(rows, { onConflict: 'user_id,played_at', ignoreDuplicates: true });
    if (error) throw error;
  }

  const newest = plays.reduce(
    (max, p) => (p.played_at > max ? p.played_at : max),
    user.last_played_at || '1970-01-01T00:00:00Z'
  );
  const syncedAt = new Date().toISOString();

  await db.from('users')
    .update({ last_synced_at: syncedAt, last_played_at: newest })
    .eq('id', user.id);

  return { added: plays.length, syncedAt };
}
