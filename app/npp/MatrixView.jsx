import { useState } from 'react';
import { COMPARE_AXES } from './score';
import { FAMILY, STATUS } from './parts';

/** The blue ramp of the reference palette, light (low) to dark (high). */
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const cellStyle = (v) => {
  if (v == null) return undefined;
  const i = Math.max(0, Math.min(RAMP.length - 1, Math.round((v / 100) * (RAMP.length - 1))));
  return { background: RAMP[i], color: i >= 6 ? '#fff' : '#0b0b0b' };
};

/** Every researched phone against every axis, as a heatmap: click a heading to sort, a name to open. */
export default function MatrixView({ rows, ranks, ids, toggle, onOpen }) {
  const [key, setKey] = useState('match');
  const [dir, setDir] = useState(-1);
  const val = (p) => (key === 'match' ? p.fit.match : key === 'concerns' ? (p.concerns ?? []).length : p.fit.axes[key]);
  const sorted = [...rows].sort((a, b) => dir * ((val(a) ?? -1) - (val(b) ?? -1)));
  const head = (k, label) => (
    <th key={k} scope="col" aria-sort={key === k ? (dir < 0 ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => { if (key === k) setDir(-dir); else { setKey(k); setDir(-1); } }}>
        {label}{key === k ? <i aria-hidden="true">{dir < 0 ? '↓' : '↑'}</i> : null}
      </button>
    </th>
  );
  return (
    <section className="np-card">
      <h2>전체 비교표 <small>{rows.length}개 · 진할수록 높은 점수 · 머리글을 누르면 정렬</small></h2>
      <div className="np-scroll">
        <table className="np-matrix">
          <thead>
            <tr>
              <th className="chk" aria-label="비교" />
              <th className="name">폰</th>
              {head('match', '내 취향')}
              {COMPARE_AXES.map(([k, l]) => head(k, l))}
              {head('concerns', '우려')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id}>
                <td className="chk"><input type="checkbox" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} aria-label={`${p.name} 비교`} /></td>
                <th scope="row" className="name">
                  <button type="button" onClick={() => onOpen(p)}>
                    <b>{p.name}</b>
                    <small>{p.brand} · {STATUS[p.status]}{p.chipset?.family ? ` · ${FAMILY[p.chipset.family]}` : ''}</small>
                  </button>
                </th>
                <td className="cell strong" style={cellStyle(p.fit.match)}>{p.fit.match}</td>
                {COMPARE_AXES.map(([k, l]) => {
                  const v = p.fit.axes[k];
                  const r = ranks[p.id]?.[k];
                  return <td key={k} className={`cell${v == null ? ' none' : ''}`} style={cellStyle(v)} title={v == null ? `${l}: 정보 없음` : `${p.name} · ${l} ${v}점${r ? ` · ${r.of}개 중 ${r.rank}위` : ''}`}>{v ?? '—'}</td>;
                })}
                <td className="cell risk" title="우려 건수 (큰 우려는 ▲)">{(p.concerns ?? []).length || '—'}{(p.concerns ?? []).some((c) => c.severity === 'high') ? <i aria-hidden="true">▲</i> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="np-meta">'—'는 아직 정보를 찾지 못한 항목이에요. 점수 계산에서는 그 폰의 다른 항목 평균으로 두고, 깎지 않아요.</p>
    </section>
  );
}
