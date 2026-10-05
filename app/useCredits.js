'use client';

import { useEffect, useRef, useState } from 'react';

const BATCH = 60;

/** Credited artists by row key, shared by every view for the whole visit. */
const known = new Map();

const creditKey = (r) => `${r.artist_key}\u0000${r.track_key ?? ''}`;

/**
 * The artist line to show under a track: every credited artist when more
 * than one is known ("Don Toliver, Doja Cat"), otherwise the row's own
 * artist. Grouping and color stay on the main artist; this is display only.
 */
export function artistLine(row) {
  if (!row?.track || !row.artist_key) return row?.artist;
  const a = known.get(creditKey(row));
  return a && a.length > 1 ? a.join(', ') : row.artist;
}

/**
 * Fetch credits for the track rows on screen, a batch at a time, the same
 * way artwork is fetched: only what the server answers is recorded, and
 * whatever is still pending is asked for again shortly. The calling
 * component re-renders as credits arrive.
 */
export function useCredits(rows) {
  const [, setVersion] = useState(0);
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (inFlight.current || !rows?.length) return;
    const missing = [];
    const seen = new Set();
    for (const r of rows) {
      if (!r?.track || !r.artist_key || !r.track_key) continue;
      const k = creditKey(r);
      if (known.has(k) || seen.has(k)) continue;
      seen.add(k);
      missing.push({ artist: r.artist, track: r.track, artist_key: r.artist_key, track_key: r.track_key });
      if (missing.length >= BATCH) break;
    }
    if (!missing.length) return;

    let cancelled = false;
    let timer;
    inFlight.current = true;
    fetch('/api/credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: missing }),
    })
      .then((r) => r.json())
      .then((json) => {
        const got = json?.credits ?? {};
        for (const [k, v] of Object.entries(got)) known.set(k, v);
        if (Object.keys(got).length) setVersion((v) => v + 1);
        if (!cancelled && (json?.retryAfter || json?.pending)) {
          timer = setTimeout(() => setTick((t) => t + 1), json.retryAfter ? json.retryAfter * 1000 : 600);
        }
      })
      .catch(() => {
        if (!cancelled) timer = setTimeout(() => setTick((t) => t + 1), 3000);
      })
      .finally(() => {
        inFlight.current = false;
        // Rows changed mid-request: look again at whatever is on screen now.
        if (cancelled) setTick((t) => t + 1);
      });

    return () => { cancelled = true; clearTimeout(timer); };
  }, [rows, tick]);
}
