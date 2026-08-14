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

export const coverKey = (artist, album = '') => `${artist}${SEP}${album}`;

export const rowKey = (row) => `${row.artist}${SEP}${row.track ?? ''}`;

/** Artist rows share one cover per artist; track rows key on the album. */
export const coverKeyFor = (mode, row) =>
  mode === 'artists' ? coverKey(row.artist, '') : coverKey(row.artist, row.album || '');
