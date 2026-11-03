import { db } from '@/lib/db';
import { refreshAccessToken } from '@/lib/spotify';

const API = 'https://api.spotify.com/v1';

/**
 * A Spotify caller for the signed-in user, or why there isn't one. Logins
 * from before a permission was asked for don't carry it; those come back as
 * `reauth`, and the page offers to reconnect.
 */
export async function spotifyFor(userId, needs = []) {
  const { data: user, error } = await db.from('users')
    .select('id, spotify_id, refresh_token').eq('id', userId).single();
  if (error || !user) return { error: 'user not found', status: 404 };

  let token;
  try {
    token = await refreshAccessToken(user.refresh_token);
  } catch (e) {
    return { error: e.message, reauth: true, status: 403 };
  }
  // Spotify sometimes rotates the refresh token; keep the new one
  if (token.refresh_token && token.refresh_token !== user.refresh_token) {
    await db.from('users').update({ refresh_token: token.refresh_token }).eq('id', user.id);
  }
  const granted = String(token.scope ?? '').split(' ');
  if (token.scope && needs.some((s) => !granted.includes(s))) {
    return { error: 'missing scope', reauth: true, status: 403 };
  }

  const call = (path, init = {}) => fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', ...init.headers },
    cache: 'no-store',
  });
  return { call, user };
}
