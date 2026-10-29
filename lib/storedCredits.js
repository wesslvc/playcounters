import { db } from '@/lib/db';

/* Credits already stored for each track — shared by the season standings and the race radio. */

/** Stored credits for these rows' tracks, keyed artist_key + track_key. */
export async function creditsFor(rows) {
  const trackKeys = [...new Set(rows.map((r) => r.track_key).filter(Boolean))];
  const out = new Map();
  // Chunked: a long all-time list of keys would overflow one request's URL.
  for (let i = 0; i < trackKeys.length; i += 100) {
    const { data, error } = await db
      .from('track_credits')
      .select('artist_key, track_key, artists, artist_keys')
      .in('track_key', trackKeys.slice(i, i + 100));
    if (error) return out; // credits are a bonus; standings still stand without them
    for (const c of data ?? []) out.set(`${c.artist_key}\u0000${c.track_key}`, c);
  }
  return out;
}

/** [{ name, key }] for a row, main artist first; just the main artist when nothing richer is stored. */
export function creditList(r, credits) {
  const main = { name: r.artist, key: r.artist_key };
  const c = credits.get(`${r.artist_key}\u0000${r.track_key}`);
  if (!c?.artists?.length || !c.artist_keys?.length) return [main];
  const list = [main];
  c.artists.forEach((name, i) => {
    const key = c.artist_keys[i];
    if (key && !list.some((x) => x.key === key)) list.push({ name, key });
  });
  return list;
}
