import { hitMatches } from './match';

/**
 * Where cover art comes from.
 *
 * Spotify was the obvious source and turned out to be the wrong one: this app
 * runs on a development-mode Spotify app, whose search quota is small enough
 * that essentially every lookup came back 429. The instrumented run was stark
 * — 24 searched, 24 rate limited, nothing matched or rejected. No amount of
 * query tuning fixes a closed door.
 *
 * Deezer's search needs no key, no token and no registration, and carries both
 * album covers and artist pictures, so it does the searching now. Spotify is
 * not kept as a fallback: at this quota it answers 429 to essentially
 * everything, and a request that is going to be refused only adds latency.
 * Images that arrive with a live sync are still Spotify's own — exact, free,
 * and never routed through a search at all.
 */

const DEEZER = 'https://api.deezer.com';

/** Largest-first isn't guaranteed here, so sort and take a list-sized one. */
export function pickImage(images) {
  if (!images?.length) return null;
  const bySize = [...images].filter((i) => i?.url).sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  if (!bySize.length) return null;
  const enough = bySize.find((i) => (i.width ?? 0) >= 150);
  return (enough ?? bySize[bySize.length - 1]).url;
}

const sized = (...pairs) => pairs.filter(([url]) => url).map(([url, width]) => ({ url, width }));

/** Reshape Deezer's records into the shape the matcher already understands. */
function adapt(kind, d) {
  if (kind === 'artist') {
    return { name: d.name, images: sized([d.picture_big, 500], [d.picture_medium, 250]) };
  }
  if (kind === 'track') {
    return {
      name: d.title,
      artists: [{ name: d.artist?.name }],
      album: { images: sized([d.album?.cover_big, 500], [d.album?.cover_medium, 250]) },
    };
  }
  return {
    name: d.title,
    artists: [{ name: d.artist?.name }],
    images: sized([d.cover_big, 500], [d.cover_medium, 250]),
  };
}

async function deezerSearch(kind, q) {
  const url = new URL(`${DEEZER}/search/${kind}`, DEEZER);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '10');

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('deezer search failed: ' + res.status);
  const json = await res.json();
  // Deezer reports quota trouble in the body rather than the status line.
  if (json?.error) {
    const err = new Error(json.error.message || 'deezer error');
    err.rateLimited = /quota|limit/i.test(json.error.type || json.error.message || '');
    err.retryAfter = 5;
    throw err;
  }
  return (json?.data ?? []).map((d) => adapt(kind, d));
}

/**
 * Find artwork by name.
 *
 * Two passes per source. The field-qualified query is precise but brittle — a
 * subtitle or a stray bracket and it matches nothing — so a plain query
 * follows. The loose one will return *something* for any input, so its
 * candidates are checked against the artist and the title alike, on both
 * passes — a field-qualified query narrows the search but does not promise the
 * record it returns is actually by the artist asked for.
 *
 * @returns { url, stage } — stage names where it ended, for the call log.
 */
export async function findArtwork(kind, artist, name) {
  // Quotes and colons are query syntax; leaving them in breaks the search.
  const clean = (s) => String(s || '').replace(/["“”:]/g, ' ').replace(/\s+/g, ' ').trim();
  const a = clean(artist);
  const n = clean(name);
  if (!a || (kind !== 'artist' && !n)) return { url: null, stage: 'unusable' };

  const strict = kind === 'artist' ? `artist:"${a}"` : `artist:"${a}" ${kind}:"${n}"`;
  const loose = kind === 'artist' ? a : `${n} ${a}`;

  // Both passes verify the artist. Skipping it on the qualified query was a
  // guess made while every request was being refused anyway, and it let a
  // same-titled release by a different artist through — Deezer's artist:
  // filter narrows the search but does not guarantee the hit belongs to them.
  const pick = (items) => {
    for (const hit of items) {
      if (!hitMatches(kind, hit, artist, name)) continue;
      const url = pickImage(kind === 'track' ? hit.album?.images : hit.images);
      if (url) return url;
    }
    return null;
  };

  const first = await deezerSearch(kind, strict);
  const strictHit = pick(first);
  if (strictHit) return { url: strictHit, stage: 'strict' };

  const second = await deezerSearch(kind, loose);
  const looseHit = pick(second);
  if (looseHit) return { url: looseHit, stage: 'loose' };

  return { url: null, stage: first.length || second.length ? 'rejected' : 'no-candidates' };
}
