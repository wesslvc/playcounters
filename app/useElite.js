'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadElite } from './data';

/**
 * How far past the bar a row has gone, all-time: 'ruby' for an artist past
 * 2,000 plays or a song past 500, 'sky' for 1,500 or 300, otherwise null —
 * so every view gives its picture the same foil. Null until loaded.
 */
export function useElite(source, estimate) {
  const [tiers, setTiers] = useState(null);
  useEffect(() => {
    let live = true;
    loadElite(source, estimate).then((j) => live && setTiers(j)).catch(() => {});
    return () => { live = false; };
  }, [source, estimate]);
  return useCallback((row) => {
    if (!tiers || !row?.artist_key) return null;
    return (row.track_key
      ? tiers.tracks?.[`${row.artist_key}\u0000${row.track_key}`]
      : tiers.artists?.[row.artist_key]) ?? null;
  }, [tiers]);
}
