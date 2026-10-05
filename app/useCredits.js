'use client';

import { useEffect, useRef, useState } from 'react';
import { artistColor } from '@/lib/genre';

const BATCH = 60;

/** Credited artists by row key, shared by every view for the whole visit. */
const known = new Map();

const creditKey = (r) => `${r.artist_key}\u0000${r.track_key ?? ''}`;

/**
 * Every credited artist on a row, main artist first: the server's own list
 * when it sent one (the championship does), else whatever has been looked
 * up, else just the row's artist.
 */
export function artistNames(row) {
  if (!row) return [];
  if (row.credits?.length > 1) return row.credits.map((c) => c.name);
  if (row.track && row.artist_key) {
    const a = known.get(creditKey(row));
    if (a && a.length > 1) return a;
  }
  return [row.artist];
}

/** The artist line to show under a track: "Don Toliver, Doja Cat". */
export function artistLine(row) {
  return artistNames(row).join(', ');
}

/** One color per credited artist, each artist's own. */
export function artistColors(row) {
  return artistNames(row).map((n) => artistColor(n));
}

/**
 * A hard-edged gradient giving each color an equal share, with a 2px clear
 * gap between them — two artists' colors can land close together, and the
 * gap keeps a split reading as a split.
 */
function stripes(colors, dir) {
  const step = 100 / colors.length;
  const parts = [];
  colors.forEach((c, i) => {
    const a = (i * step).toFixed(2);
    const b = ((i + 1) * step).toFixed(2);
    const start = i ? `calc(${a}% + 1px)` : '0%';
    const end = i < colors.length - 1 ? `calc(${b}% - 1px)` : '100%';
    parts.push(`${c} ${start} ${end}`);
    if (i < colors.length - 1) parts.push(`transparent ${end} calc(${b}% + 1px)`);
  });
  return `linear-gradient(${dir}, ${parts.join(', ')})`;
}

/**
 * Style for a colored edge (a border on one side), split between every
 * credited artist's color when there's more than one.
 */
export function edgeStyle(row, side = 'left') {
  const colors = artistColors(row);
  const prop = `border${side[0].toUpperCase()}${side.slice(1)}Color`;
  if (colors.length < 2) return { [prop]: colors[0] };
  const dir = side === 'left' || side === 'right' ? 'to bottom' : 'to right';
  return { borderImage: `${stripes(colors, dir)} 1` };
}

/** Background for a colored fill (a bar or a strip segment), split the same way. */
export function fillStyle(row, dir = 'to right') {
  const colors = artistColors(row);
  return colors.length < 2 ? { background: colors[0] } : { background: stripes(colors, dir) };
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
