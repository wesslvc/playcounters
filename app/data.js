'use client';

import { seedGenres } from './useGenres';

/**
 * Loads that more than one view reads — the all-time championship and the
 * records — fetched once per visit (and per source) and shared, so opening
 * a detail sheet after the records page costs nothing.
 */
const cache = new Map();

function load(key, url) {
  if (!cache.has(key)) {
    const p = fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) throw new Error(j.error);
        seedGenres(j.genres);
        return j;
      });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key);
}

/** Every Grand Prix ever run, track mode — drivers are songs, constructors artists. */
export const loadCareer = (source, estimate) =>
  load(`career|${source}|${estimate}`,
    `/api/season?mode=tracks&all=1&source=${source}${estimate ? '&estimate=1' : ''}`);

export const loadRecords = (source) => load(`records|${source}`, `/api/records?source=${source}`);

/** Forget everything — after a sync brought in new plays. */
export function invalidate() { cache.clear(); }
