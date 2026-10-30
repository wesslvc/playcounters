import { LIKELY, STATUS } from './parts';

/** Phones with any chance of coming out that haven't been looked into yet. */
export default function CandidatesView({ stubs, onResearch, busy }) {
  if (!stubs.length) {
    return <section className="np-card np-empty"><h2>후보군</h2><p>아직 조사하지 않은 후보가 없어요. 위 검색창에서 브랜드를 말하면 출시 가능성이 조금이라도 있는 폰이 여기에 모여요.</p></section>;
  }
  const bands = [['high', '출시 가능성 높음'], ['medium', '출시 가능성 보통'], ['low', '소문 단계']];
  return (
    <div className="np-cands">
      {bands.map(([k, label]) => {
        const list = stubs.filter((p) => (p.release_likelihood ?? 'low') === k);
        if (!list.length) return null;
        return (
          <section className="np-card" key={k}>
            <h2>{label} <small>{list.length}개</small></h2>
            <ul className="np-cand-grid">
              {list.map((p) => (
                <li key={p.id}>
                  <div>
                    <span className="np-brand">{p.brand}</span>
                    <b>{p.name}</b>
                    <div className="np-tags"><span className={`np-tag ${p.status}`}>{STATUS[p.status] ?? '후보'}</span><span className="np-tag">{p.release}</span></div>
                    <p>{p.summary}</p>
                  </div>
                  <button type="button" className="np-go sm" disabled={busy} onClick={() => onResearch(p)}>자세히 조사</button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
