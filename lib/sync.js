import { db } from './db';
import { refreshAccessToken, recentlyPlayed } from './spotify';
import { coverKey } from './keys';

/** Everything syncUser needs off the users row. */
export const USER_COLUMNS = 'id, spotify_id, refresh_token, last_played_at, last_synced_at';

/**
 * Store artwork that recently-played already handed us, so these albums never
 * need a search later. Best-effort: artwork is decoration, and losing it must
 * not fail a sync that already stored the plays.
 */
async function cacheCovers(plays) {
  const now = new Date().toISOString();
  const rows = [...new Map(
    plays
      .filter((p) => p.image_url && p.album)
      .map((p) => {
        const target = { kind: 'album', artist: p.artist, name: p.album };
        return [coverKey(target), { ...target, image_url: p.image_url, fetched_at: now }];
      })
  ).values()];
  if (!rows.length) return;

  const { error } = await db
    .from('covers')
    .upsert(rows, { onConflict: 'kind,artist,name' });
  if (error) console.error('cover cache failed', error.message);
}

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
    // image_url rides along on the API response but isn't a plays column.
    const rows = plays.map(({ image_url, ...p }) => ({ ...p, user_id: user.id }));
    // Primary key (user_id, played_at) makes re-running this harmless.
    let { error } = await db
      .from('plays')
      .upsert(rows, { onConflict: 'user_id,played_at', ignoreDuplicates: true });
    // Until the track_ms column exists, store plays without it rather than
    // fail: a stalled sync loses anything past Spotify's last 50 plays.
    let measured = true;
    if (error?.code === 'PGRST204') {
      measured = false;
      ({ error } = await db
        .from('plays')
        .upsert(rows.map(({ track_ms, ...r }) => r),
          { onConflict: 'user_id,played_at', ignoreDuplicates: true }));
    }
    if (error) throw error;

    if (measured) {
      const since = plays.reduce((min, p) => (p.played_at < min ? p.played_at : min), plays[0].played_at);
      const { error: msErr } = await db.rpc('recompute_live_ms', { p_user: user.id, p_since: since });
      if (msErr) console.error('recompute_live_ms failed for', user.spotify_id, msErr.message);
    }

    await cacheCovers(plays);
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
