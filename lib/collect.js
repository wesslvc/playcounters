import { db } from '@/lib/db';
import { spotifyFor } from '@/lib/spotifyUser';
import { itemsOf } from '@/lib/playlistItems';

/**
 * One playlist that gathers everything: whatever song goes into any of your
 * own playlists also goes into the one you pick (a "tier 3" that holds every
 * song). Nothing is ever taken out, a song already there isn't added twice
 * (by Spotify id or by artist and title), and local files and episodes are
 * left alone, since Spotify won't add those from outside.
 *
 * Turning it on can first add what the other playlists already hold. After
 * that only songs put into a playlist since the last look are brought over,
 * so a song taken out of the gathering playlist by hand stays out. The look
 * happens with every sync (every 20 minutes); a playlist whose snapshot hasn't
 * changed isn't read again, and the gathering playlist's contents are kept
 * between looks.
 */

export const NEEDS = ['playlist-read-private', 'playlist-modify-private', 'playlist-modify-public'];
const MARGIN = 10 * 60e3; // a look overlaps the last by this much; the duplicate check makes it harmless
const MAX_TARGET = 10000;

const settingsKey = (userId) => `collect|${userId}`;
const haveKey = (userId) => `collect-have|${userId}`;

// brackets and "feat." first, then everything that isn't a letter or digit
// (in one pass the space before a bracket was eaten first and the bracket stayed)
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKC')
  .replace(/\(.*?\)|\[.*?\]|feat\..*$/gu, '')
  .replace(/[^\p{L}\p{N}]+/gu, '');
const songKey = (x) => `${norm(x.artist)}|${norm(x.track)}`;
const sig = (l) => `${l.snapshot ?? ''}|${l.count ?? ''}`;
const addable = (x) => x.song && !x.local && String(x.uri ?? '').startsWith('spotify:track:');

async function readNote(key) {
  const { data } = await db.from('radio_notes').select('body').eq('key', key).maybeSingle();
  return data?.body ?? null;
}
async function writeNote(key, body) {
  const { error } = await db.from('radio_notes').upsert({ key, body, created_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export const settingsOf = (userId) => readNote(settingsKey(userId));
export const saveSettings = (userId, body) => writeNote(settingsKey(userId), body);

/** Your own playlists, with what tells a changed one from an unchanged one. */
export async function ownedPlaylists(sp) {
  const out = [];
  for (let next = '/me/playlists?limit=50'; next && out.length < 400;) {
    const res = await sp.call(next);
    if (!res.ok) throw Object.assign(new Error(`playlists failed: ${res.status}`), { status: res.status });
    const page = await res.json();
    for (const p of page.items ?? []) {
      if (!p?.id || p.owner?.id !== sp.user.spotify_id) continue;
      out.push({ id: p.id, name: p.name, count: p.items?.total ?? p.tracks?.total ?? null, snapshot: p.snapshot_id ?? null });
    }
    next = page.next;
  }
  return out;
}

/** What the gathering playlist holds, from the copy kept since the last look unless it changed since. */
async function targetHave(sp, userId, target) {
  const kept = await readNote(haveKey(userId));
  if (kept && kept.id === target.id && kept.sig === sig(target)) {
    return { ids: new Set(kept.ids), keys: new Set(kept.keys) };
  }
  const got = await itemsOf(sp.call, encodeURIComponent(target.id), MAX_TARGET);
  if (!got.items) throw Object.assign(new Error(`reading the gathering playlist failed: ${got.status}`), { status: got.status });
  const songs = got.items.filter((x) => x.song);
  return { ids: new Set(songs.map((x) => x.id).filter(Boolean)), keys: new Set(songs.map(songKey)) };
}

async function keepHave(userId, target, have, snapshot, count) {
  await writeNote(haveKey(userId), {
    id: target.id, sig: `${snapshot ?? target.snapshot ?? ''}|${count}`,
    ids: [...have.ids], keys: [...have.keys],
  });
}

/**
 * Songs in `sources` that the gathering playlist lacks, oldest addition
 * first, each once. With `sinceMs`, only those put in after it.
 */
async function missing(sp, sources, have, sinceMs) {
  const found = new Map();
  for (const l of sources) {
    const got = await itemsOf(sp.call, encodeURIComponent(l.id), 2000);
    if (!got.items) continue;
    for (const x of got.items) {
      if (!addable(x)) continue;
      const at = Date.parse(x.added_at);
      if (sinceMs != null && !(at > sinceMs)) continue;
      const k = songKey(x);
      if (have.ids.has(x.id) || have.keys.has(k) || found.has(k)) continue;
      found.set(k, { uri: x.uri, id: x.id, track: x.track, artist: x.artist, at: Number.isFinite(at) ? at : 0, from: l.name });
    }
  }
  return [...found.values()].sort((a, b) => a.at - b.at);
}

/** Appends songs to the playlist, a hundred a call; the snapshot after the last call. */
async function append(sp, id, uris) {
  let snapshot = null;
  let path = `/playlists/${encodeURIComponent(id)}/items`;
  for (let i = 0; i < uris.length; i += 100) {
    const body = JSON.stringify({ uris: uris.slice(i, i + 100) });
    let res = await sp.call(path, { method: 'POST', body });
    if ((res.status === 404 || res.status === 405) && path.endsWith('/items')) {
      path = `/playlists/${encodeURIComponent(id)}/tracks`;
      res = await sp.call(path, { method: 'POST', body });
    }
    if (!res.ok) throw Object.assign(new Error(`adding songs failed: ${res.status}`), { status: res.status, added: i });
    snapshot = (await res.json().catch(() => ({}))).snapshot_id ?? snapshot;
  }
  return snapshot;
}

/** For the settings screen: what turning it on would bring over now. */
export async function preview(userId, targetId) {
  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return { error: sp.error, reauth: sp.reauth, status: sp.status };
  const lists = await ownedPlaylists(sp);
  const target = lists.find((l) => l.id === targetId);
  if (!target) return { error: '내 플레이리스트만 고를 수 있어요.', status: 400 };
  const have = await targetHave(sp, userId, target);
  const songs = await missing(sp, lists.filter((l) => l.id !== target.id), have, null);
  return { count: songs.length, sample: songs.slice(-5).reverse().map((s) => ({ track: s.track, artist: s.artist, from: s.from })), sources: lists.length - 1 };
}

/**
 * Turns it on for `targetId`. With `backfill`, what the other playlists hold
 * now is added first; either way only later additions are gathered after this.
 */
export async function enable(userId, targetId, backfill) {
  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return { error: sp.error, reauth: sp.reauth, status: sp.status };
  const lists = await ownedPlaylists(sp);
  const target = lists.find((l) => l.id === targetId);
  if (!target) return { error: '내 플레이리스트만 고를 수 있어요.', status: 400 };
  const startedAt = Date.now();
  const have = await targetHave(sp, userId, target);
  let added = [];
  let snapshot = null;
  if (backfill) {
    added = await missing(sp, lists.filter((l) => l.id !== target.id), have, null);
    if (added.length) snapshot = await append(sp, target.id, added.map((s) => s.uri));
    for (const s of added) { have.ids.add(s.id); have.keys.add(songKey(s)); }
  }
  await keepHave(userId, target, have, snapshot, (target.count ?? 0) + added.length);
  const sigs = Object.fromEntries(lists.filter((l) => l.id !== target.id).map((l) => [l.id, sig(l)]));
  await saveSettings(userId, {
    enabled: true, target: target.id, targetName: target.name, since: startedAt, sigs,
    checkedAt: new Date().toISOString(), total: added.length,
    recent: added.slice(-12).reverse().map((s) => ({ track: s.track, artist: s.artist, from: s.from, at: new Date().toISOString() })),
  });
  return { added: added.length };
}

export async function disable(userId) {
  const st = (await settingsOf(userId)) ?? {};
  await saveSettings(userId, { ...st, enabled: false });
}

/**
 * One look: songs put into any of your playlists since the last look go into
 * the gathering playlist. Unchanged playlists aren't read. Called from every
 * sync and from the "지금 확인" button.
 */
export async function collectNew(userId) {
  const st = await settingsOf(userId);
  if (!st?.enabled || !st.target) return null;
  const sp = await spotifyFor(userId, NEEDS);
  if (!sp.call) return { error: sp.error };
  const lookedAt = Date.now();
  const lists = await ownedPlaylists(sp);
  const target = lists.find((l) => l.id === st.target);
  if (!target) {
    await saveSettings(userId, { ...st, enabled: false, problem: '모으던 플레이리스트를 찾지 못해 자동 모으기를 껐어요.' });
    return { error: 'target gone' };
  }
  const sources = lists.filter((l) => l.id !== target.id);
  const changed = sources.filter((l) => st.sigs?.[l.id] !== sig(l));
  let added = [];
  if (changed.length) {
    const have = await targetHave(sp, userId, target);
    added = await missing(sp, changed, have, (st.since ?? lookedAt) - MARGIN);
    let snapshot = null;
    if (added.length) snapshot = await append(sp, target.id, added.map((s) => s.uri));
    for (const s of added) { have.ids.add(s.id); have.keys.add(songKey(s)); }
    await keepHave(userId, target, have, snapshot, (target.count ?? 0) + added.length);
  }
  const now = new Date().toISOString();
  await saveSettings(userId, {
    ...st,
    targetName: target.name,
    since: lookedAt,
    sigs: Object.fromEntries(sources.map((l) => [l.id, sig(l)])),
    checkedAt: now,
    total: (st.total ?? 0) + added.length,
    recent: [...added.reverse().map((s) => ({ track: s.track, artist: s.artist, from: s.from, at: now })), ...(st.recent ?? [])].slice(0, 12),
    problem: null,
  });
  return { added: added.length, looked: changed.length };
}
