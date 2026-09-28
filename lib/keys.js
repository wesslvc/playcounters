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
 * The same identity as rowKey, but built from the normalised artist_key/
 * track_key rather than the display artist/track — for the one place that
 * needs it to survive being grouped by more than one query.
 *
 * top_items picks its display label with mode() within group, so two
 * separate calls over different windows can legitimately choose different
 * surface wording for the exact same recording (a movie-soundtrack tag
 * present in one month's plays and not another's, say). rowKey is fine
 * everywhere that identity is read from a single query's own result set —
 * the label it picked is internally consistent there. The season standings
 * are the exception: they run one query per month and then merge the
 * results, and keying that merge on the label let two months' wording
 * disagree and split one recording into two rows. Grouping on the
 * normalised key instead is what a stored generated column is for.
 */
export const normRowKey = (row) => `${row.artist_key}${SEP}${row.track_key ?? ''}`;

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
