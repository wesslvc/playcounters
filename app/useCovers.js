'use client';

import { useEffect, useRef, useState } from 'react';
import { coverKeyFor } from '@/lib/keys';

/** Cover keys requested per round trip. */
const BATCH = 60;

/** Artwork by cover key, shared by every view for the whole visit. */
const known = {};

/**
 * Artwork for the rows on screen, fetched a batch at a time. Only what the
 * server actually answers is recorded: it caps how many misses it searches
 * per call and stops while rate limited, so an unanswered key stays unknown
 * and is asked for again shortly rather than buried behind a null.
 * Returns every cover known so far, by key — look rows up with coverOf.
 */
export function useCovers(mode, rows) {
  const [snapshot, setSnapshot] = useState(() => ({ ...known }));
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!rows?.length) return;
    if (rows.some((r) => coverKeyFor(mode, r) in known && !(coverKeyFor(mode, r) in snapshot))) {
      setSnapshot({ ...known });
    }
    if (inFlight.current) return;
    const missing = [];
    const seen = new Set();
    for (const r of rows) {
      const k = coverKeyFor(mode, r);
      if (k in known || seen.has(k)) continue;
      seen.add(k);
      missing.push({ artist: r.artist, album: r.album, track: r.track });
      if (missing.length >= BATCH) break;
    }
    if (!missing.length) return;

    let cancelled = false;
    let timer;
    inFlight.current = true;
    fetch('/api/covers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, items: missing }),
    })
      .then((r) => r.json())
      .then((json) => {
        const got = json?.covers ?? {};
        Object.assign(known, got);
        if (Object.keys(got).length) setSnapshot({ ...known });
        if (!cancelled && (json?.retryAfter || json?.pending)) {
          timer = setTimeout(() => setTick((t) => t + 1), json.retryAfter ? json.retryAfter * 1000 : 600);
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
  }, [mode, rows, tick, snapshot]);

  return snapshot;
}

/** The cover for one row from a useCovers snapshot, or undefined. */
export const coverOf = (covers, mode, row) => (row ? covers[coverKeyFor(mode, row)] : undefined);
