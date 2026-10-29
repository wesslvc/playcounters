import { deezerGet } from './artwork';
import { namesMatch } from './match';

/** Quotes and colons are query syntax; leaving them in breaks the search. */
const clean = (s) => String(s || '').replace(/["“”:]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Every credited artist on a track, found by name on Deezer — for plays that
 * didn't come with Spotify's own credits (imports, YouTube, and live plays
 * synced before credits were kept). Search only names the main artist, so
 * the matching hit's full record is fetched for its contributors.
 *
 * The hit has to match on both artist and title, same as artwork: a wrong
 * credit is worse than none. Returns null when nothing matches; the main
 * artist is always listed first.
 */
export async function findCredits(artist, track) {
  const a = clean(artist);
  const t = clean(track);
  if (!a || !t) return null;

  for (const q of [`artist:"${a}" track:"${t}"`, `${t} ${a}`]) {
    const json = await deezerGet('/search/track', { q, limit: '10' });
    const hit = (json?.data ?? []).find((d) =>
      namesMatch(artist, d.artist?.name) && namesMatch(track, d.title));
    if (!hit) continue;

    const full = await deezerGet(`/track/${hit.id}`);
    const names = [...new Set((full?.contributors ?? []).map((c) => c?.name).filter(Boolean))];
    if (!names.length) return [hit.artist.name];
    const main = names.findIndex((n) => namesMatch(artist, n));
    if (main > 0) names.unshift(...names.splice(main, 1));
    return names;
  }
  return null;
}
