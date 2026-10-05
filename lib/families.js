import { db } from './db';

/**
 * Cached genre records for these artist names, { name: { family, genre } },
 * sent along with a page's data so colors are right on the first paint
 * instead of being drawn once from the fallback and redrawn when the genre
 * lookups come back. Only what's already cached; lookups stay with
 * /api/genres. Chunked, since a long list of names would overflow one
 * request's URL.
 */
export async function genresFor(names) {
  const list = [...new Set(names.filter((n) => typeof n === 'string' && n))];
  const chunks = [];
  for (let i = 0; i < list.length; i += 100) chunks.push(list.slice(i, i + 100));
  const results = await Promise.all(chunks.map((c) =>
    db.from('artist_genres').select('artist, genre, family').in('artist', c)));
  const out = {};
  for (const { data } of results) {
    for (const r of data ?? []) out[r.artist] = { family: r.family, genre: r.genre };
  }
  return out;
}

/**
 * This listener's genre color slots — [{ artist, slot }] for the top
 * artists of each genre (artist_color_slots). Empty, rather than an error,
 * until that function is installed.
 */
export async function colorSlotsFor(userId) {
  const { data, error } = await db.rpc('artist_color_slots', { p_user: userId });
  return error ? [] : (data ?? []);
}
