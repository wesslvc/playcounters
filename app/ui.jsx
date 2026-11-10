'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Small pieces every view is built from, so the four tabs share one
 * vocabulary: a segmented control, a section heading, a cover tile, a
 * figure with its label.
 */

/** Two to four mutually exclusive choices, iOS-style. */
export function Seg({ options, value, onChange, size, label }) {
  return (
    <div className={`seg${size === 'sm' ? ' sm' : ''}`} role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button
          key={String(v)} role="radio" aria-checked={value === v}
          onClick={() => onChange(v)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** A section's heading: the title, an optional line under it, and controls on the right. */
export function Section({ title, sub, children, id }) {
  return (
    <div className="sec" id={id}>
      <div className="sec-text">
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="sec-side">{children}</div>}
    </div>
  );
}

/** Artwork, or a quiet placeholder of the same size while it loads. */
export function Cover({ src, size = 44, round, className = '' }) {
  return (
    <span
      className={`cover${round ? ' round' : ''} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {src && <img src={src} alt="" loading="lazy" decoding="async" />}
    </span>
  );
}

/** A headline figure: the number large, what it counts under it. */
export function Stat({ value, label, sub }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
      {sub && <em>{sub}</em>}
    </div>
  );
}

/** Places gained since the previous window: ▲3, ▼1, –, or NEW. */
export function Delta({ value }) {
  if (value === undefined) return <span className="delta new">NEW</span>;
  if (value === null) return null;
  if (value === 0) return <span className="delta same">–</span>;
  const up = value > 0;
  return <span className={`delta ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'}{Math.abs(value)}</span>;
}

/** "2026년 3월 4일" from YYYY-MM-DD. */
export const dayLabel = (d) => {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${y}년 ${Number(m)}월 ${Number(day)}일`;
};

/** "3월 4일" — the year left off when it's obvious from context. */
export const shortDay = (d) => {
  if (!d) return '—';
  const [, m, day] = String(d).slice(0, 10).split('-');
  return `${Number(m)}.${Number(day)}`;
};

/**
 * A number that counts up to its value the first time it's shown (and from
 * the old value when it changes), quickly, easing out. Plain text for
 * anyone who prefers less motion.
 */
export function Count({ value, prefix = '', duration = 700 }) {
  const target = Math.round(Number(value) || 0);
  const [shown, setShown] = useState(target);
  const from = useRef(0);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(target); return undefined; }
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - (1 - t) ** 3;
      setShown(Math.round(a + (target - a) * e));
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return <>{prefix}{shown.toLocaleString()}</>;
}

/**
 * Rows that slide to their new places when a list reorders, instead of
 * jumping: each child carries data-k; after a change, any that moved is
 * played back from where it was.
 */
export function useFlip(ref, dep) {
  const prev = useRef(new Map());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const now = new Map();
    for (const c of el.children) now.set(c.dataset.k, c.getBoundingClientRect().top);
    const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!still) {
      for (const c of el.children) {
        const was = prev.current.get(c.dataset.k);
        const is = now.get(c.dataset.k);
        if (was != null && Math.abs(was - is) > 1) {
          c.animate([{ transform: `translateY(${was - is}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.7,.2,1)' });
        }
      }
    }
    prev.current = now;
  }, [dep]); // eslint-disable-line react-hooks/exhaustive-deps
}
