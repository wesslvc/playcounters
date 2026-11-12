import { db } from '@/lib/db';
import { refreshAccessToken } from '@/lib/spotify';

const API = 'https://api.spotify.com/v1';

// Spotify's limits are per app. Once it answers 429 the app keeps away from
// it until the Retry-After it gave has passed — every call made in the
// meantime only keeps the block going — so the time is written down where
// every request (and the sync) sees it.
const WAIT_KEY = 'spotify-wait';

async function waitUntil() {
  const { data } = await db.from('radio_notes').select('body').eq('key', WAIT_KEY).maybeSingle();
  const t = Date.parse(data?.body?.until ?? '');
  return Number.isFinite(t) ? t : 0;
}

/** "Spotify is holding us off", in words, with how long is left. */
export function busyMessage(seconds) {
  const s = Math.max(1, Math.ceil(seconds || 60));
  const when = s < 90 ? `${s}초` : s < 5400 ? `${Math.ceil(s / 60)}분` : `${Math.round(s / 3600)}시간`;
  return `Spotify가 요청이 많다며 잠시 막았어요. 약 ${when} 뒤에 다시 해 주세요.`;
}

/**
 * A Spotify caller for the signed-in user, or why there isn't one. Logins
 * from before a permission was asked for don't carry it; those come back as
 * `reauth`, and the page offers to reconnect. While Spotify has asked the
 * app to wait, calls don't go out at all: they come back as a 429 at once,
 * and `waitLeft()` says how many seconds remain.
 */
export async function spotifyFor(userId, needs = []) {
  let until = await waitUntil();
  const waitLeft = () => Math.max(0, Math.ceil((until - Date.now()) / 1000));
  if (waitLeft() > 0) {
    // no token refresh either: nothing goes to Spotify until the wait is over
    return { error: busyMessage(waitLeft()), status: 429, wait: waitLeft(), waitLeft };
  }

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

  const call = async (path, init = {}) => {
    if (waitLeft() > 0) return new Response('', { status: 429, headers: { 'retry-after': String(waitLeft()) } });
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', ...init.headers },
      cache: 'no-store',
    });
    if (res.status === 429) {
      const s = Number(res.headers.get('retry-after')) || 30;
      // a few seconds is ordinary pacing, handled by whoever called; longer is a block to sit out
      if (s > 10) {
        until = Date.now() + s * 1000;
        console.warn(`spotify 429 · ${String(path).split('?')[0]} · retry-after ${s}s`);
        await db.from('radio_notes').upsert({
          key: WAIT_KEY, body: { until: new Date(until).toISOString(), seconds: s, path: String(path).split('?')[0] }, created_at: new Date().toISOString(),
        });
      }
    }
    return res;
  };
  return { call, user, waitLeft };
}
