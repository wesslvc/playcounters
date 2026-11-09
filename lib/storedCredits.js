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

const squash = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Who a title says is only featured: the names after "feat." / "ft." /
 * "featuring" / "with" in it ("Hello (feat. pH-1)", "54321 (Feat. HAEWON of
 * NMIXX)", "종이비행기(HELLO)(FEAT.PH-1)"), squashed for comparison.
 */
function featuredIn(title) {
  const out = [];
  for (const m of String(title ?? '').matchAll(/(?:\bfeat\.?|\bft\.|\bfeaturing\b|\bwith\b)\s*([^()\[\]]+)/gi)) {
    for (const name of m[1].split(/,|&|\band\b|\bx\b|\bof\b.*$/i)) {
      const k = squash(name);
      if (k) out.push(k);
    }
  }
  return out;
}

/**
 * [{ name, key }] who score a row's constructor points, main artist first:
 * the main artist and anyone credited alongside as a lead, but not someone
 * the title names as only featured — a feature is a guest on someone else's
 * song, not a share of it. Just the main artist when nothing richer is stored.
 */
export function creditList(r, credits) {
  const main = { name: r.artist, key: r.artist_key };
  const c = credits.get(`${r.artist_key}\u0000${r.track_key}`);
  if (!c?.artists?.length || !c.artist_keys?.length) return [main];
  const guests = featuredIn(r.track);
  const isGuest = (name) => {
    const k = squash(name);
    return Boolean(k) && guests.some((g) => g === k || g.startsWith(k) || k.startsWith(g));
  };
  const list = [main];
  c.artists.forEach((name, i) => {
    const key = c.artist_keys[i];
    if (key && !list.some((x) => x.key === key) && !isGuest(name)) list.push({ name, key });
  });
  return list;
}
