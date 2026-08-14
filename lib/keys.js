/**
 * Keys that identify a list row and its artwork.
 *
 * Server and client both build these and must agree exactly — they were once
 * duplicated on each side and silently drifted apart (one separator, one
 * space), so every cover lookup missed while the request itself looked fine.
 * They live here so there is only one definition to get right.
 */

// Written as an escape, not a literal control byte, so the source stays text.
// Nothing in an artist, album, or track name can collide with it.
const SEP = '\u0000';

export const rowKey = (row) => `${row.artist}${SEP}${row.track ?? ''}`;

/**
 * What to look artwork up by.
 *
 * Albums are preferred: many tracks share one, so the cache fills faster and
 * the same image serves the whole record. YouTube history carries no album,
 * though, and those rows used to fall through to an empty key that collided
 * with the artist lookup — so they resolve by track instead.
 *
 * The kind is part of the key. Without it a track with no album and an artist
 * of the same name produce the same string.
 */
export function coverTargetFor(mode, row) {
  if (mode === 'artists') return { kind: 'artist', artist: row.artist, name: '' };
  if (row.album) return { kind: 'album', artist: row.artist, name: row.album };
  return { kind: 'track', artist: row.artist, name: row.track || '' };
}

export const coverKey = ({ kind, artist, name }) =>
  `${kind}${SEP}${artist}${SEP}${name || ''}`;

export const coverKeyFor = (mode, row) => coverKey(coverTargetFor(mode, row));
