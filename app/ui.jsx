'use client';

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
