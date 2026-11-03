import { useState } from 'react';
import { ELEMENTS, rankMult } from './score';

/**
 * Ranking what matters, by tapping: the first tap is the top priority, the next
 * is second, and so on. A ranked pill can be dragged to a new place, or tapped
 * to get ◀ ▶ ✕ (move earlier, later, take out) — which works on a phone too.
 * Anything not tapped is simply "not a priority" and counts for less.
 */
export default function Priority({ prefs, setPrefs }) {
  const [sel, setSel] = useState(null);
  const [drag, setDrag] = useState(null);
  const order = prefs.order;
  const rest = ELEMENTS.filter((e) => !order.includes(e.key));
  const label = Object.fromEntries(ELEMENTS.map((e) => [e.key, e.label]));
  const set = (next) => setPrefs({ ...prefs, order: next });

  const move = (k, d) => {
    const i = order.indexOf(k);
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  const dropOn = (k) => {
    if (!drag || drag === k) return;
    const next = order.filter((x) => x !== drag);
    next.splice(next.indexOf(k), 0, drag);
    set(next);
    setDrag(null);
  };

  return (
    <div className="pr2">
      <p className="ctl-sub">중요한 것부터 차례로 눌러보세요. 누른 순서가 곧 우선순위예요.</p>

      <div className="pr2-zone">
        <h5>내 우선순위 <small>{order.length ? '끌어서 옮기거나, 눌러서 ◀ ▶ ✕' : ''}</small></h5>
        {order.length ? (
          <ol className="pr2-ranked">
            {order.map((k, i) => (
              <li key={k} draggable className={`${sel === k ? 'on' : ''}${drag === k ? ' drag' : ''}`}
                onDragStart={(e) => { setDrag(k); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', k); } catch { /* old browsers */ } }}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); dropOn(k); }} onDragEnd={() => setDrag(null)}>
                <button type="button" className="pill" onClick={() => setSel(sel === k ? null : k)} aria-pressed={sel === k} title={`가중 ×${rankMult(prefs, k).toFixed(2)}`}>
                  <b>{i + 1}</b>{label[k]}
                </button>
                {sel === k && (
                  <span className="act">
                    <button type="button" onClick={() => move(k, -1)} disabled={i === 0} aria-label="앞으로">◀</button>
                    <button type="button" onClick={() => move(k, 1)} disabled={i === order.length - 1} aria-label="뒤로">▶</button>
                    <button type="button" onClick={() => { set(order.filter((x) => x !== k)); setSel(null); }} aria-label="빼기">✕</button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        ) : <p className="pr2-empty">아직 정하지 않았어요. 모든 항목을 같은 비중으로 봐요.</p>}
      </div>

      {rest.length > 0 && (
        <div className="pr2-zone">
          <h5>눌러서 추가</h5>
          <div className="pr2-chips">
            {rest.map((e) => <button type="button" key={e.key} onClick={() => set([...order, e.key])}><i aria-hidden="true">＋</i>{e.label}</button>)}
          </div>
        </div>
      )}
      {order.length > 0 && <button type="button" className="np-link" onClick={() => { set([]); setSel(null); }}>순서 지우기</button>}
    </div>
  );
}
