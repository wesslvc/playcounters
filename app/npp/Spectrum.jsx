import { netLeans, OTHERS, duelWord } from './score';

/** The fill of a track, as the two percentages the CSS paints between. */
const span = (value) => {
  const half = value / 2;
  return { '--lo': `${50 + Math.min(0, half)}%`, '--hi': `${50 + Math.max(0, half)}%` };
};

/**
 * A −100…+100 line between two real opposites. The fill grows from the middle
 * toward the side being leaned on. Double-click (or the link) recentres.
 */
export function Spectrum({ pair, value, onChange, hint }) {
  const side = value < -4 ? 'l' : value > 4 ? 'r' : '';
  return (
    <div className="sp" data-side={side}>
      <div className="sp-poles">
        <span className={`sp-pole l${side === 'l' ? ' on' : ''}`}>{pair.l[0]}{pair.l[1] && <small>{pair.l[1]}</small>}</span>
        <span className={`sp-pole r${side === 'r' ? ' on' : ''}`}>{pair.r[0]}{pair.r[1] && <small>{pair.r[1]}</small>}</span>
      </div>
      <div className="sp-track" style={span(value)}>
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

/** How much one criterion matters, 0…100 — for things that don't oppose anything. */
export function Importance({ label, sub, value, word, onChange }) {
  return (
    <div className="im">
      <div className="im-top">
        <span className="im-name">{label}{sub && <small>{sub}</small>}</span>
        <span className={`im-word${value >= 65 ? ' hi' : value < 8 ? ' off' : ''}`}>{word}</span>
      </div>
      <div className="sp-track im-track" style={{ '--hi': `${value}%`, '--lo': '0%' }}>
        <input type="range" min="0" max="100" step="1" value={value} onChange={(e) => onChange(+e.target.value)} aria-label={label} />
      </div>
    </div>
  );
}

/**
 * Brands (or chip families) pitted against each other, as many duels as wanted.
 * A name can be in several duels; what each ends up with is summed and shown
 * underneath. "그 외 전부" stands for every name not otherwise mentioned.
 */
export function DuelEditor({ duels, onChange, options, title, empty }) {
  const label = (v) => (v === OTHERS ? '그 외 전부' : options.find(([k]) => k.toLowerCase() === String(v).toLowerCase())?.[1] ?? v);
  const set = (id, patch) => onChange(duels.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const add = () => {
    const used = new Set(duels.flatMap((d) => [d.a, d.b]));
    const free = options.map(([k]) => k).filter((k) => !used.has(k));
    onChange([...duels, { id: `d${Date.now().toString(36)}`, a: free[0] ?? options[0][0], b: free[1] ?? OTHERS, v: 0 }]);
  };
  const net = [...netLeans(duels)].filter(([, v]) => v !== 0).sort((x, y) => y[1] - x[1]);
  const choices = [...options, [OTHERS, '그 외 전부']];
  return (
    <div className="du">
      {!duels.length && <p className="ctl-sub">{empty}</p>}
      {duels.map((d) => {
        const side = d.v < -4 ? 'l' : d.v > 4 ? 'r' : '';
        return (
          <div className="du-row" key={d.id} data-side={side}>
            <div className="du-names">
              <select value={d.a} onChange={(e) => set(d.id, { a: e.target.value })} aria-label="왼쪽">
                {choices.filter(([k]) => k !== d.b || k === d.a).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
              <span className="du-vs">vs</span>
              <select value={d.b} onChange={(e) => set(d.id, { b: e.target.value })} aria-label="오른쪽">
                {choices.filter(([k]) => k !== d.a || k === d.b).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
            </div>
            <div className="sp-track" style={span(d.v)}>
              <i className="sp-mid" aria-hidden="true" />
              <input type="range" min="-100" max="100" step="1" value={d.v} onChange={(e) => set(d.id, { v: +e.target.value })}
                onDoubleClick={() => set(d.id, { v: 0 })} aria-label={`${label(d.a)} 대 ${label(d.b)}`} />
            </div>
            <div className="sp-foot">
              <span>{duelWord(d, label)}</span>
              <button type="button" className="np-link" onClick={() => onChange(duels.filter((x) => x.id !== d.id))}>삭제</button>
            </div>
          </div>
        );
      })}
      <button type="button" className="du-add" onClick={add}>+ {title} 대결 추가</button>
      {net.length > 0 && (
        <div className="du-net" aria-label="합산 결과">
          <h4>합산된 영향 <small>여러 대결이 겹치면 더해져요</small></h4>
          {net.map(([k, v]) => (
            <div className="du-bar" key={k}>
              <span>{label(k === OTHERS ? OTHERS : options.find(([o]) => o.toLowerCase() === k)?.[0] ?? k)}</span>
              <div><i className={v < 0 ? 'neg' : 'pos'} style={{ width: `${Math.abs(v) / 2}%`, [v < 0 ? 'right' : 'left']: '50%' }} /></div>
              <b className={v < 0 ? 'neg' : 'pos'}>{v > 0 ? '+' : ''}{Math.round(v)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
