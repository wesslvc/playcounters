'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadElite } from './data';

/**
 * Whether a row has gone far past the bar — an artist past 2,000 plays all
 * time, a song past 300 — so any view can frame it the same way. Returns a
 * test for a row (artist rows have no track_key); false until loaded.
 */
export function useElite(source, estimate) {
  const [sets, setSets] = useState(null);
  useEffect(() => {
    let live = true;
    loadElite(source, estimate)
      .then((j) => live && setSets({ artists: new Set(j.artists), tracks: new Set(j.tracks) }))
      .catch(() => {});
    return () => { live = false; };
  }, [source, estimate]);
  return useCallback((row) => {
    if (!sets || !row?.artist_key) return false;
    return row.track_key
      ? sets.tracks.has(`${row.artist_key}\u0000${row.track_key}`)
      : sets.artists.has(row.artist_key);
  }, [sets]);
}
