import { useState } from 'react';
import { ELEMENTS, importanceWord, rankMult } from './score';
import { Importance } from './Spectrum';

/**
 * The elements in the reader's order of priority. Drag a row (or use ▲▼) to
 * rank it; the higher it sits the more it counts. Until something is moved
 * there is no ranking and every element counts by its slider alone.
 */
export default function PriorityList({ prefs, setPrefs }) {
  const [drag, setDrag] = useState(null);
  const ranked = prefs.order.length > 0;
  const keys = ranked ? prefs.order : ELEMENTS.map((e) => e.key);
  const by = Object.fromEntries(ELEMENTS.map((e) => [e.key, e]));

  const move = (from, to) => {
    if (from === to || to < 0 || to >= keys.length) return;
    const next = [...keys];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setPrefs({ ...prefs, order: next });
  };

  return (
    <div className="pr">
      <p className="ctl-sub">
        끌어서(또는 ▲▼로) 순서를 정하면 위에 있을수록 점수에 더 크게 반영돼요{ranked ? ' — 1순위 ×1.5부터 꼴찌 ×0.6까지' : ''}. 슬라이더는 그 항목을 얼마나 중요하게 보는지예요.
      </p>
      <ol className="pr-list">
        {keys.map((k, i) => {
          const el = by[k];
          return (
            <li key={k} className={`pr-item${drag === k ? ' dragging' : ''}${ranked ? ' ranked' : ''}`} draggable
              onDragStart={(e) => { setDrag(k); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', k); } catch { /* old browsers */ } }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (drag) move(keys.indexOf(drag), i); setDrag(null); }}
              onDragEnd={() => setDrag(null)}>
              <span className="pr-rank" title={ranked ? `가중 ×${rankMult(prefs, k).toFixed(2)}` : '순서를 정하면 번호가 매겨져요'}>{ranked ? i + 1 : '·'}</span>
              <span className="pr-grip" aria-hidden="true">⋮⋮</span>
              <div className="pr-body">
                {el.noSlider ? (
                  <div className="im">
                    <div className="im-top"><span className="im-name">{el.label}<small>{el.sub}</small></span><span className="im-word">순서로만 반영</span></div>
                  </div>
                ) : (
                  <Importance label={el.label} sub={el.sub} value={prefs.imp[k]} word={importanceWord(prefs.imp[k])}
                    onChange={(v) => setPrefs({ ...prefs, imp: { ...prefs.imp, [k]: v } })} />
                )}
              </div>
              <span className="pr-btns">
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`${el.label} 위로`}>▲</button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === keys.length - 1} aria-label={`${el.label} 아래로`}>▼</button>
              </span>
            </li>
          );
        })}
      </ol>
      {ranked && <button type="button" className="np-link" onClick={() => setPrefs({ ...prefs, order: [] })}>순서 풀기 (슬라이더만 사용)</button>}
    </div>
  );
}
