import { hitMatches, namesMatch } from './match';

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

/** One place the Deezer call is made, so quota handling is written once.
    Quota trouble is reported in the body rather than the status line. */
async function deezerGet(path, params) {
  const url = new URL(DEEZER + path);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`deezer ${path} failed: ` + res.status);
  const json = await res.json();
  if (json?.error) {
    const err = new Error(json.error.message || 'deezer error');
    err.rateLimited = /quota|limit/i.test(json.error.type || json.error.message || '');
    err.retryAfter = 5;
    throw err;
  }
  return json;
}

async function deezerSearch(kind, q) {
  const json = await deezerGet(`/search/${kind}`, { q, limit: '10' });
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

/* ---------------- genre ----------------
   Spotify used to file a genre on the artist and stopped: since early 2026 the
   field is absent from search results and null from the artist endpoint, and
   the batch endpoint is gone altogether. Every lookup came back empty, which
   is what left the whole list one shade of grey.

   Deezer files genre on the *album* instead, as a small fixed vocabulary
   ("Rap/Hip Hop", "Asian Music", "Soul & Funk"). That is coarser than Spotify
   was, but coarse is what a color key wants, and it is the source already
   fetching artwork here — no key, no quota ceiling worth fearing.

   So an artist's genre is the one most of their albums are filed under. */

/** id → name, from Deezer's own list rather than a table transcribed by hand.
    Fetched once per instance; the list is small and effectively static. */
let genreNames = null;

async function genreName(id) {
  if (!genreNames) {
    const json = await deezerGet('/genre');
    genreNames = new Map((json?.data ?? []).map((g) => [Number(g.id), g.name]));
  }
  return genreNames.get(Number(id)) ?? null;
}

/**
 * The genre an artist is mostly filed under, by name.
 *
 * Albums are counted rather than trusting the first hit: a single compilation
 * appearance shouldn't decide what an artist is. The artist is verified on
 * every candidate for the same reason artwork is — a loose query returns
 * something for any input, and an unrelated act's genre would paint the row a
 * confidently wrong color.
 *
 * Two ways in, because the search rows and the album record don't always carry
 * the genre the same way: the id on the search row when it's there, the album
 * record itself when it isn't. The stage says which answered, so a run that
 * finds nothing can be told apart from one that never had anything to read.
 *
 * @returns { genre, stage } — a null genre is a real answer and gets cached.
 */
export async function findGenre(artist) {
  const clean = (s) => String(s || '').replace(/["“”:]/g, ' ').replace(/\s+/g, ' ').trim();
  const a = clean(artist);
  if (!a) return { genre: null, stage: 'unusable' };

  let sawAlbums = false;

  // Field-qualified first, then loose — the same two passes artwork uses, and
  // for the same reason: the qualified query is precise but brittle.
  for (const q of [`artist:"${a}"`, a]) {
    const json = await deezerGet('/search/album', { q, limit: '15' });
    const mine = (json?.data ?? []).filter((al) => namesMatch(artist, al?.artist?.name));
    if (!mine.length) continue;
    sawAlbums = true;

    const counts = new Map();
    for (const al of mine) {
      const id = Number(al.genre_id);
      // Deezer marks "no genre on file" as -1.
      if (!Number.isFinite(id) || id <= 0) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (counts.size) {
      const [topId] = [...counts].sort((x, y) => y[1] - x[1])[0];
      const name = await genreName(topId);
      if (name) return { genre: name, stage: 'search' };
    }

    // No usable id on the rows — read it off the album records instead. Two at
    // most: this is the slow path and one answer is all it needs.
    for (const al of mine.slice(0, 2)) {
      if (!al?.id) continue;
      const album = await deezerGet(`/album/${al.id}`);
      const name = album?.genres?.data?.[0]?.name;
      if (name) return { genre: name, stage: 'album' };
    }
  }
  return { genre: null, stage: sawAlbums ? 'no-genre' : 'no-albums' };
}
