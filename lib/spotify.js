import { hitMatches } from './match';

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

/**
 * Find artwork by name. Imported history has no Spotify IDs, so searching by
 * name is the only route back to an image.
 *
 * Two passes. The field-qualified query is precise but brittle: a subtitle, a
 * different edition, or a stray bracket and it matches nothing. When it comes
 * back empty the same words go out as a plain query, which recovers most of
 * what the strict form drops — but will return *something* for any input, so
 * every candidate is checked against what was asked for before it is accepted.
 *
 * Several candidates are requested rather than one, because the right record
 * is often not the first: a search for a track frequently leads with a cover
 * or a sped-up edit by someone else.
 *
 * @param kind 'album' | 'artist' | 'track'
 * @returns image URL, or null when nothing convincing matches — a real answer
 *   worth caching, and better than showing another artist's sleeve.
 */
export async function searchCover(kind, artist, name) {
  const type = kind === 'artist' ? 'artist' : kind === 'track' ? 'track' : 'album';

  // Quotes and colons are query syntax; leaving them in breaks the search.
  const clean = (s) => String(s || '').replace(/["“”:]/g, ' ').replace(/\s+/g, ' ').trim();
  const a = clean(artist);
  const n = clean(name);
  if (!a || (kind !== 'artist' && !n)) return null;

  const strict = kind === 'artist' ? `artist:"${a}"` : `${type}:"${n}" artist:"${a}"`;
  const loose = kind === 'artist' ? a : `${n} ${a}`;

  const pick = (items) => {
    for (const hit of items) {
      if (!hitMatches(kind, hit, artist, name)) continue;
      // A track's artwork lives on its album.
      const url = pickImage(type === 'track' ? hit.album?.images : hit.images);
      if (url) return url;
    }
    return null;
  };

  const first = await searchOnce(strict, type);
  const found = pick(first);
  if (found) return found;

  // The loose pass only helps when the qualified query was over-constrained
  // and matched nothing at all. If it returned candidates that simply failed
  // verification, rephrasing finds the same wrong records — and every extra
  // request here is what walks into the rate limit.
  if (first.length) return null;
  return pick(await searchOnce(loose, type));
}

const CANDIDATES = 10;

async function searchOnce(q, type) {
  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', type);
  url.searchParams.set('limit', String(CANDIDATES));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await appToken()}` },
    cache: 'no-store',
  });
  if (res.status === 429) {
    const err = new Error('rate limited');
    err.rateLimited = true;
    err.retryAfter = Number(res.headers.get('retry-after')) || 30;
    throw err;
  }
  if (!res.ok) throw new Error('search failed: ' + res.status);

  const json = await res.json();
  return json[`${type}s`]?.items ?? [];
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
