/**
 * Deciding whether a Spotify search result is actually the thing we asked for.
 *
 * Imported history has no Spotify IDs, so artwork is found by name. The
 * field-qualified query is reasonably safe, but the loose fallback that
 * rescues awkward titles will happily return *something* for any input — a
 * cover version, a remix, an unrelated single that shares a word. Accepting
 * whatever comes back is how a row ends up wearing another artist's sleeve.
 *
 * So a result has to earn it: the artist has to line up, and the title has to
 * overlap. Anything else is discarded and the row stays blank, which is the
 * honest outcome — a missing cover reads as missing, a wrong one reads as a
 * fact about the music.
 */

/**
 * Casefold for comparison: strip accents, punctuation, spacing and case, so
 * "Beyoncé" / "beyonce" and "Jay-Park" / "Jay Park" compare equal.
 */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * True when two names refer to the same thing closely enough.
 *
 * Containment counts, in either direction: Spotify lists an artist as
 * "Don Toliver" where the row says "Don Toliver, Doja Cat", and a title may
 * be "Lose My Mind" against "Lose My Mind (feat. Doja Cat)". Both are the
 * same record. A bare containment test on very short names would match far
 * too much, so those must be equal outright.
 */
export function namesMatch(a, b) {
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 5) return false;
  return x.includes(y) || y.includes(x);
}

/** Any credited artist matching is enough — features and collabs are listed. */
export function artistMatches(wanted, credited) {
  return (credited ?? []).some((c) => namesMatch(wanted, c?.name));
}

/**
 * Is this search hit really what was asked for?
 *
 * @param kind  'artist' | 'album' | 'track'
 * @param hit   the Spotify object
 * @param artist requested artist
 * @param name  requested album or track name ('' for an artist lookup)
 */
export function hitMatches(kind, hit, artist, name) {
  if (!hit) return false;
  if (kind === 'artist') return namesMatch(artist, hit.name);
  return artistMatches(artist, hit.artists) && namesMatch(name, hit.name);
}
