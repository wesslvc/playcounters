'use client';

import { useEffect, useRef, useState } from 'react';
import { rememberFamily } from '@/lib/genre';

const BATCH = 24;

/** Genre records by artist name, shared by every view for the whole visit. */
const known = {};

/**
 * Record genres that arrived with a page's own data, before it renders —
 * artistColor then draws the right color on the first paint, and these
 * names are never asked for again.
 */
export function seedGenres(map) {
  for (const [artist, g] of Object.entries(map ?? {})) {
    known[artist] = g;
    rememberFamily(artist, g?.family);
  }
}

/**
 * Look up genres for the artist names on screen, a batch at a time, the way
 * artwork and credits are fetched: only what the server answers is recorded,
 * and whatever is pending is asked for again shortly. Each answer also
 * teaches artistColor the artist's family, so colors move into their genre's
 * band as genres arrive. Returns every record known so far, by name.
 */
export function useGenres(names) {
  const [snapshot, setSnapshot] = useState(() => ({ ...known }));
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!names?.length) return;
    // Seeded since this view last looked: show them.
    if (names.some((n) => n in known && !(n in snapshot))) setSnapshot({ ...known });
    if (inFlight.current) return;
    const missing = [];
    for (const n of names) {
      if (!n || n in known || missing.includes(n)) continue;
      missing.push(n);
      if (missing.length >= BATCH) break;
    }
    if (!missing.length) return;

    let cancelled = false;
    let timer;
    inFlight.current = true;
    fetch('/api/genres', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artists: missing }),
    })
      .then((r) => r.json())
      .then((json) => {
        const got = json?.genres ?? {};
        for (const [artist, g] of Object.entries(got)) {
          known[artist] = g;
          rememberFamily(artist, g?.family);
        }
        if (Object.keys(got).length) setSnapshot({ ...known });
        if (!cancelled && (json?.retryAfter || json?.pending)) {
          timer = setTimeout(() => setTick((t) => t + 1), json.retryAfter ? json.retryAfter * 1000 : 800);
        }
      })
      .catch(() => {
        if (!cancelled) timer = setTimeout(() => setTick((t) => t + 1), 3000);
      })
      .finally(() => {
        inFlight.current = false;
        if (cancelled) setTick((t) => t + 1);
      });

    return () => { cancelled = true; clearTimeout(timer); };
  }, [names, tick, snapshot]);

  return snapshot;
}
