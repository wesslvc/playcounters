import { periodOf } from './score';
import { LIKELY, STATUS } from './parts';

/** Everything with a chance of coming out, laid along the calendar: what's already out, and what is expected when. */
export default function TimelineView({ phones, onOpen }) {
  const now = new Date();
  const groups = new Map();
  for (const p of phones) {
    const g = periodOf(p, now);
    if (!groups.has(g.key)) groups.set(g.key, { ...g, items: [] });
    groups.get(g.key).items.push(p);
  }
  const cols = [...groups.values()].sort((a, b) => a.order - b.order);
  return (
    <section className="np-card">
      <h2>출시 타임라인 <small>실선은 조사한 폰, 점선은 아직 조사 전인 후보</small></h2>
      <div className="np-tl">
        {cols.map((c) => (
          <div className="np-tl-col" key={c.key}>
            <h3>{c.label}<small>{c.items.length}</small></h3>
            <ul>
              {c.items.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.release_likelihood] ?? 0) - ({ high: 0, medium: 1, low: 2 }[b.release_likelihood] ?? 0)).map((p) => (
                <li key={p.id}>
                  <button type="button" className={`np-tl-chip${p.stub ? ' stub' : ''} ${p.status}`} onClick={() => (p.stub ? null : onOpen(p))} disabled={p.stub} title={p.summary}>
                    <b>{p.name}</b>
                    <small>{p.brand} · {STATUS[p.status] ?? '후보'}{p.stub && p.release_likelihood ? ` · ${LIKELY[p.release_likelihood]}` : ''}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
