import { namesMatch } from './match';

/**
 * Genre lookup, from MusicBrainz.
 *
 * Deezer files genre on the album as one of ~20 broad buckets, and most of
 * East Asia lands in the same one ("Asian Music") regardless of what it
 * actually sounds like — coarse enough to be nearly useless as a color key.
 * MusicBrainz's genres are community-tagged the way Spotify's used to be
 * ("k-pop", "city pop", "hyperpop", "art pop"), and the service needs no key
 * or registration, only a descriptive User-Agent — which is what its own
 * etiquette asks for instead of one.
 *
 * The trade is its rate limit: MusicBrainz asks for no more than one request
 * a second per IP and answers a 503 rather than a real error when that's
 * exceeded, so every call here goes through one shared, serialized queue
 * regardless of how many artists are being resolved at once.
 */

const MB = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'playcounters/1.0 ( https://github.com/wesslvc/playcounters )';

async function mbGet(path, params) {
  const url = new URL(MB + path);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  url.searchParams.set('fmt', 'json');

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, cache: 'no-store' });
  if (res.status === 503) {
    const err = new Error('musicbrainz rate limited');
    err.rateLimited = true;
    err.retryAfter = 2;
    throw err;
  }
  if (!res.ok) throw new Error(`musicbrainz ${path} failed: ` + res.status);
  return res.json();
}

/**
 * One request in flight at a time, each at least 1.1s after the last one
 * started — a plain "read the clock" check would let concurrent callers
 * race past each other before either one recorded the time, so this chains
 * every call onto the one before it instead.
 */
let queue = Promise.resolve();
let lastCall = 0;

function paced(fn) {
  const run = queue.then(async () => {
    const wait = Math.max(0, lastCall + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  // The chain must survive a rejection, or every call queued behind a failed
  // one starts racing again with no pacing at all.
  queue = run.catch(() => {});
  return run;
}

/**
 * The genre an artist is most associated with, by name.
 *
 * Search first to find the artist's MBID, verifying the name the same way
 * artwork and Deezer's genre lookup do — a loose query returns *something*
 * for any input. The search response itself carries no genres; those are on
 * the full artist record, so a genuine match costs a second request.
 *
 * @returns { genre, stage } — a null genre is a real answer and gets cached.
 */
export async function findGenreMB(artist) {
  const q = String(artist || '').trim();
  if (!q) return { genre: null, stage: 'unusable' };

  // Quotes break the query syntax; MusicBrainz's Lucene parser also chokes on
  // a bare colon.
  const clean = q.replace(/["“”:]/g, ' ').replace(/\s+/g, ' ').trim();

  const search = await paced(() => mbGet('/artist/', { query: `artist:"${clean}"`, limit: '5' }));
  const candidates = (search?.artists ?? []).filter((a) => namesMatch(artist, a?.name));
  if (!candidates.length) return { genre: null, stage: 'no-artist' };

  // MusicBrainz's own relevance score, among names that actually matched —
  // the right call for a small act sharing a name with a famous one.
  candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const mbid = candidates[0].id;
  if (!mbid) return { genre: null, stage: 'no-artist' };

  const full = await paced(() => mbGet(`/artist/${mbid}`, { inc: 'genres' }));
  const genres = [...(full?.genres ?? [])].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  if (!genres.length) return { genre: null, stage: 'no-genre' };
  return { genre: genres[0].name, stage: 'found' };
}
