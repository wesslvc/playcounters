import { db } from '@/lib/db';
import { deezerGet } from '@/lib/artwork';

/**
 * How a song sounds, in numbers: tempo, energy, brightness (valence),
 * danceability, how acoustic, its key. Spotify stopped handing these out, so
 * they come from ReccoBeats — first by Spotify id from its catalogue, and for
 * songs it doesn't carry, by having it analyse the song's 30-second Deezer
 * preview. Shared across users and stored once per song in track_features;
 * a song neither route could place is stored too (via 'none') so it isn't
 * tried again on every visit, and tried afresh after a fortnight.
 */

const RB = 'https://api.reccobeats.com/v1';
const PER_CALL = 40; // ReccoBeats refuses more ids than this in one call
const RETRY_NONE = 14 * 864e5;
const ANALYSE_AT_ONCE = 4;

// brackets and "feat." first, then everything that isn't a letter or digit
// (in one pass the space before a bracket was eaten first and the bracket stayed)
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKC')
  .replace(/\(.*?\)|\[.*?\]|feat\..*$/gu, '')
  .replace(/[^\p{L}\p{N}]+/gu, '');
const same = (a, b) => {
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x));
};

/** The row a song's numbers are stored under: its Spotify id, or its names for a local file. */
export const featureKey = (s) => (s.id ? `sp:${s.id}` : `nm:${norm(s.artist)}|${norm(s.track)}`);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rowOf = (key, x, via) => ({
  key,
  tempo: num(x?.tempo),
  energy: num(x?.energy),
  danceability: num(x?.danceability),
  valence: num(x?.valence),
  acousticness: num(x?.acousticness),
  instrumentalness: num(x?.instrumentalness),
  loudness: num(x?.loudness),
  musical_key: Number.isInteger(x?.key) && x.key >= 0 ? x.key : null,
  mode: Number.isInteger(x?.mode) ? x.mode : null,
  via,
  fetched_at: new Date().toISOString(),
});

class Slow extends Error {}

/** What's already stored for these keys. */
export async function storedFeatures(keys) {
  const out = new Map();
  const list = [...new Set(keys)];
  for (let i = 0; i < list.length; i += 150) {
    const { data, error } = await db.from('track_features').select('*').in('key', list.slice(i, i + 150));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) out.set(r.key, r);
  }
  return out;
}

/** ReccoBeats' own numbers for up to 40 Spotify ids. */
async function byIds(ids, signal) {
  const res = await fetch(`${RB}/audio-features?ids=${ids.join(',')}`, { signal, cache: 'no-store' });
  if (res.status === 429) throw new Slow('reccobeats busy');
  if (!res.ok) throw new Error(`reccobeats ${res.status}`);
  const json = await res.json();
  const got = new Map();
  for (const x of json.content ?? []) {
    const id = String(x.href ?? '').split('/track/')[1]?.split('?')[0];
    if (id) got.set(id, x);
  }
  return got;
}

// Deezer over its quota is "come back later", not "this song has no preview"
const busy = (e) => { if (e?.rateLimited) throw new Slow('deezer busy'); return null; };

/** The song's 30-second preview on Deezer: by ISRC when Spotify gave one, else by name. */
async function previewOf(s) {
  if (s.isrc) {
    const t = await deezerGet(`/track/isrc:${encodeURIComponent(s.isrc)}`).catch(busy);
    if (t?.preview) return t.preview;
  }
  for (const q of [`artist:"${s.artist}" track:"${s.track}"`, `${s.artist} ${s.track}`]) {
    const json = await deezerGet('/search/track', { q, limit: '10' }).catch(busy);
    const t = (json?.data ?? []).find((x) => x.preview && same(x.artist?.name, s.artist) && same(x.title_short ?? x.title, s.track));
    if (t) return t.preview;
  }
  return null;
}

/** ReccoBeats' analysis of a preview clip. */
async function analyse(url, signal) {
  const clip = await fetch(url, { signal, cache: 'no-store' });
  if (!clip.ok) return null;
  const buf = await clip.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > 3e6) return null;
  const form = new FormData();
  form.append('audioFile', new Blob([buf], { type: 'audio/mpeg' }), 'preview.mp3');
  const res = await fetch(`${RB}/analysis/audio-features`, { method: 'POST', body: form, signal, cache: 'no-store' });
  if (res.status === 429) throw new Slow('reccobeats busy');
  if (!res.ok) return null;
  const x = await res.json();
  return num(x?.tempo) != null ? x : null;
}

async function keep(rows) {
  if (!rows.length) return;
  const { error } = await db.from('track_features').upsert(rows);
  if (error) console.error('track_features upsert failed', error.message);
}

/**
 * Numbers for every song given, as far as `budgetMs` allows: stored ones as
 * they are, missing ones by id in batches of 40, then the rest by preview a
 * few at a time. What the budget ran out on is counted in `pending`, so the
 * caller can come back for it.
 */
export async function ensureFeatures(songs, { budgetMs = 35000 } = {}) {
  const until = Date.now() + budgetMs;
  const signal = AbortSignal.timeout(budgetMs + 15000);
  const byKey = new Map();
  for (const s of songs) if (!byKey.has(featureKey(s))) byKey.set(featureKey(s), s);
  const have = await storedFeatures([...byKey.keys()]);
  const stale = (r) => r.via === 'none' && Date.now() - Date.parse(r.fetched_at) > RETRY_NONE;
  let todo = [...byKey].filter(([k]) => !have.has(k) || stale(have.get(k)));

  try {
    // 1. ReccoBeats' catalogue, by Spotify id
    const withId = todo.filter(([, s]) => s.id);
    for (let i = 0; i < withId.length && Date.now() < until; i += PER_CALL) {
      const chunk = withId.slice(i, i + PER_CALL);
      const got = await byIds(chunk.map(([, s]) => s.id), signal);
      const rows = chunk.filter(([, s]) => got.has(s.id)).map(([k, s]) => rowOf(k, got.get(s.id), 'id'));
      await keep(rows);
      for (const r of rows) have.set(r.key, r);
    }
    todo = todo.filter(([k]) => !have.has(k) || stale(have.get(k)));

    // 2. the rest from their previews, a few at a time
    for (let i = 0; i < todo.length && Date.now() < until; i += ANALYSE_AT_ONCE) {
      const rows = await Promise.all(todo.slice(i, i + ANALYSE_AT_ONCE).map(async ([k, s]) => {
        const url = await previewOf(s);
        const x = url ? await analyse(url, signal).catch((e) => { if (e instanceof Slow) throw e; return null; }) : null;
        return rowOf(k, x, x ? 'preview' : 'none');
      }));
      await keep(rows);
      for (const r of rows) have.set(r.key, r);
    }
  } catch (e) {
    // busy or slow: what's done is kept, the rest is pending for the next call
    if (!(e instanceof Slow) && e.name !== 'TimeoutError' && e.name !== 'AbortError') console.error('features failed', e.message);
  }

  const pending = [...byKey.keys()].filter((k) => !have.has(k) || stale(have.get(k))).length;
  return { features: have, pending, total: byKey.size };
}

/** Key and mode as the Camelot wheel names them (8B is C major), the way DJs match keys. */
export function camelot(r) {
  if (r?.musical_key == null || r?.mode == null) return null;
  const major = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
  const minor = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
  return r.mode === 1 ? `${major[r.musical_key]}B` : `${minor[r.musical_key]}A`;
}

/** Key and mode by name, the way most people read them: C, F#m, B♭. */
export function keyName(r) {
  if (r?.musical_key == null || r?.mode == null) return null;
  const names = ['C', 'C#', 'D', 'E♭', 'E', 'F', 'F#', 'G', 'A♭', 'A', 'B♭', 'B'];
  return `${names[r.musical_key]}${r.mode === 1 ? '' : 'm'}`;
}
