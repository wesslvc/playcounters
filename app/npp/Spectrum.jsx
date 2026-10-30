/**
 * A continuous −100…+100 spectrum. The fill grows from the middle toward the
 * side being leaned on, so how far the handle sits from the centre reads as
 * how much weight goes that way. Double-click (or the reset dot) recentres.
 */
export function Spectrum({ pair, value, onChange, hint }) {
  const half = value / 2;
  const a = 50 + Math.min(0, half);
  const b = 50 + Math.max(0, half);
  const side = value < -4 ? 'l' : value > 4 ? 'r' : '';
  return (
    <div className="sp" data-side={side}>
      <div className="sp-poles">
        <span className={`sp-pole l${side === 'l' ? ' on' : ''}`}>{pair.l[0]}<small>{pair.l[1]}</small></span>
        <span className={`sp-pole r${side === 'r' ? ' on' : ''}`}>{pair.r[0]}<small>{pair.r[1]}</small></span>
      </div>
      <div className="sp-track" style={{ '--lo': `${a}%`, '--hi': `${b}%` }}>
        <i className="sp-mid" aria-hidden="true" />
        <input type="range" min="-100" max="100" step="1" value={value} onChange={(e) => onChange(+e.target.value)}
          onDoubleClick={() => onChange(0)} aria-label={`${pair.l[0]} ↔ ${pair.r[0]}`} />
      </div>
      <div className="sp-foot">
        <span>{hint}</span>
        {value !== 0 && <button type="button" className="np-link" onClick={() => onChange(0)}>균형으로</button>}
      </div>
    </div>
  );
}

/** One brand or chip family: from 제외 through 보통 to 최우선. */
export function Affinity({ label, count, value, onChange, word }) {
  const half = value / 2;
  const a = 50 + Math.min(0, half);
  const b = 50 + Math.max(0, half);
  return (
    <div className={`af${value <= -95 ? ' off' : ''}`}>
      <div className="af-name">{label}{count != null && <small>{count}</small>}</div>
      <div className="sp-track af-track" style={{ '--lo': `${a}%`, '--hi': `${b}%` }}>
        <i className="sp-mid" aria-hidden="true" />
        <input type="range" min="-100" max="100" step="1" value={value} onChange={(e) => onChange(+e.target.value)}
          onDoubleClick={() => onChange(0)} aria-label={`${label} 선호도`} />
      </div>
      <div className={`af-word${value >= 30 ? ' pos' : value <= -30 ? ' neg' : ''}`}>{word}</div>
    </div>
  );
}
