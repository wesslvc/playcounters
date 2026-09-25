import { namesMatch } from './match';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';

function basicAuth() {
  const pair = `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`;
  return 'Basic ' + Buffer.from(pair).toString('base64');
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
    cache: 'no-store',
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || 'token request failed');
  return json;
}

/** Trade the ?code from the callback for tokens. */
export function exchangeCode(code) {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
  });
}

/** Spotify sometimes rotates the refresh token — the caller must save a new one if present. */
export function refreshAccessToken(refreshToken) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

/* ---------------- artwork ----------------
   Cover lookups aren't tied to any listener, so they use a client-credentials
   token instead of someone's session. Cached in-process until just before it
   expires — a warm lambda then searches without a token round-trip. */

let appTokenCache = { value: null, expiresAt: 0 };

async function appToken() {
  if (appTokenCache.value && Date.now() < appTokenCache.expiresAt) {
    return appTokenCache.value;
  }
  const json = await tokenRequest({ grant_type: 'client_credentials' });
  appTokenCache = {
    value: json.access_token,
    expiresAt: Date.now() + Math.max(0, (json.expires_in ?? 3600) - 60) * 1000,
  };
  return appTokenCache.value;
}

/** Spotify returns images largest-first; a list thumbnail wants neither end. */
export function pickImage(images) {
  if (!images?.length) return null;
  const bySize = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const enough = bySize.find((i) => (i.width ?? 0) >= 150);
  return (enough ?? bySize[bySize.length - 1])?.url ?? null;
}

/* ---------------- genres ----------------
   Genres live on the artist, and artist search results already carry them, so
   one request per unknown artist answers it — no ID resolution step and no
   second /artists call. A 429 is reported as such so the caller can stop
   asking until the window passes: this runs on a development-mode app, whose
   search quota is what pushed artwork over to Deezer, and genre lookups have
   to survive the same ceiling. They are cached forever, so the cost is paid
   once per artist rather than once per view. */

async function appGet(path) {
  const token = await appToken();
  const res = await fetch('https://api.spotify.com/v1' + path, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 429) {
    const err = new Error('spotify rate limited');
    err.rateLimited = true;
    err.retryAfter = Number(res.headers.get('retry-after')) || 5;
    throw err;
  }
  if (!res.ok) throw new Error(`spotify ${path} failed: ${res.status}`);
  return res.json();
}

/**
 * The genres Spotify files an artist under, found by name.
 *
 * The name has to line up before the genres are believed — search will return
 * *something* for any input, and an unrelated artist's genres would paint the
 * row a confidently wrong color. Among genuine matches the most-followed one
 * wins, which is the right call for the common case of a small act sharing a
 * name with a famous one.
 *
 * @returns string[] — empty when nothing matched, which is a real answer and
 *          gets cached as one.
 */
export async function searchArtistGenres(name) {
  const json = await appGet(`/search?type=artist&limit=5&q=${encodeURIComponent(name)}`);
  const items = json?.artists?.items ?? [];
  const matches = items.filter((a) => namesMatch(name, a?.name));
  if (!matches.length) return [];
  matches.sort((a, b) => (b.followers?.total ?? 0) - (a.followers?.total ?? 0));
  return matches[0].genres ?? [];
}

export async function getProfile(accessToken) {
  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('profile fetch failed: ' + res.status);
  return res.json();
}

/**
 * Recently played tracks, newest first. Spotify caps this at 50 items and
 * roughly the last 50 plays — there is no way to page further back, which is
 * why /api/sync has to run often enough to keep up with the listener.
 *
 * @param afterMs unix ms cursor; only plays strictly after this are returned.
 */
export async function recentlyPlayed(accessToken, afterMs) {
  const url = new URL('https://api.spotify.com/v1/me/player/recently-played');
  url.searchParams.set('limit', '50');
  if (afterMs) url.searchParams.set('after', String(afterMs));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('recently-played failed: ' + res.status);
  const json = await res.json();

  return (json.items || []).map((it) => ({
    played_at: it.played_at,
    track: it.track?.name ?? '',
    artist: it.track?.artists?.[0]?.name ?? '',
    album: it.track?.album?.name ?? null,
    // The endpoint reports what was queued, not how long it ran. Track length
    // is the closest honest stand-in and keeps the >=30s filter meaningful.
    ms_played: it.track?.duration_ms ?? 0,
    source: 'live',
    // Not a plays column — the caller peels this off into the cover cache.
    // Live plays get their artwork here for free, no search required.
    image_url: pickImage(it.track?.album?.images),
  })).filter((p) => p.track && p.artist);
}
