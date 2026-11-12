import { db } from '@/lib/db';
import { pickImage } from '@/lib/spotify';

/**
 * Every entry of a Spotify playlist, in its real order, songs or not: the
 * position each one holds is what a reorder has to work with, so nothing is
 * skipped here (an episode or a broken entry still takes a place). `song`
 * marks the ones that are music with a name and an artist.
 *
 * The first page says how many there are; the rest are fetched a few at a
 * time in parallel. Spotify renamed tracks to items; the old path is the
 * fallback.
 */
export async function itemsOf(call, id, max = 1000) {
  let base = `/playlists/${id}/items`;
  let size = 50;
  let res = await call(`${base}?limit=${size}&offset=0`);
  if (res.status === 404 || res.status === 405) {
    base = `/playlists/${id}/tracks`;
    size = 100;
    res = await call(`${base}?limit=${size}&offset=0`);
  }
  if (!res.ok) return { status: res.status };
  const first = await res.json();
  const total = Math.min(first.total ?? 0, max);
  const offsets = [];
  for (let o = size; o < total; o += size) offsets.push(o);
  const pages = [];
  for (let i = 0; i < offsets.length; i += 6) {
    const got = await Promise.all(offsets.slice(i, i + 6).map(async (o) => {
      const r = await call(`${base}?limit=${size}&offset=${o}`);
      return r.ok ? r.json() : { status: r.status };
    }));
    const bad = got.find((g) => g.status);
    if (bad) return { status: bad.status };
    pages.push(...got);
  }
  const items = [first, ...pages].flatMap((p) => p.items ?? []).slice(0, max).map((it, pos) => {
    const t = it?.item ?? it?.track ?? null;
    const artists = (t?.artists ?? []).map((a) => a.name).filter(Boolean);
    return {
      pos,
      uri: t?.uri ?? null,
      id: t?.id ?? null,
      isrc: t?.external_ids?.isrc ?? null,
      track: t?.name ?? null,
      artist: artists[0] ?? null,
      artists,
      album: t?.album?.name ?? null,
      image: pickImage(t?.album?.images),
      added_at: it?.added_at ?? null,
      local: Boolean(it?.is_local),
      song: Boolean(t?.name && artists.length && t.type !== 'episode'),
    };
  });
  return { items, total: first.total ?? items.length };
}

/** The most songs a playlist can have for a reorder. */
export const MAX_SONGS = 2000;

/** The most songs one model call can put in order; past this only grouping (many calls) and by-plays work. */
export const MAX_ONE_CALL = 400;

/**
 * itemsOf, but read again only when the playlist changed: Spotify gives every
 * version of a playlist a snapshot id, and the entries read for one are kept
 * under it. The snapshot comes from the caller when it has it (the playlist
 * listing carries one for each), otherwise from a one-field call — one call
 * in place of a page per fifty songs.
 */
export async function itemsCached(call, id, { snapshot = null, max = 1000 } = {}) {
  const raw = decodeURIComponent(id);
  let snap = snapshot;
  if (!snap) {
    const r = await call(`/playlists/${encodeURIComponent(raw)}?fields=snapshot_id`);
    if (!r.ok) return { status: r.status };
    snap = (await r.json().catch(() => ({}))).snapshot_id ?? null;
  }
  const key = `pl-items|${raw}`;
  if (snap) {
    const { data } = await db.from('radio_notes').select('body').eq('key', key).maybeSingle();
    const kept = data?.body;
    if (kept?.snapshot === snap && kept.max >= max && Array.isArray(kept.items)) {
      return { items: kept.items.slice(0, max), total: kept.total, snapshot: snap };
    }
  }
  const got = await itemsOf(call, encodeURIComponent(raw), max);
  if (got.items && snap) {
    await db.from('radio_notes').upsert({ key, body: { snapshot: snap, max, total: got.total, items: got.items }, created_at: new Date().toISOString() });
  }
  return { ...got, snapshot: snap };
}
