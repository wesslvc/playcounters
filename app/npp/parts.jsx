import { useState } from 'react';
import { est } from './score';

export const STATUS = { released: '출시', upcoming: '출시 예정', rumored: '루머' };
export const FAMILY = { snapdragon: '스냅드래곤', exynos: '엑시노스', apple: 'Apple', tensor: '텐서', dimensity: '디멘시티', other: '기타 칩' };
export const KIND = { official: '공식 이미지', photo: '실물 사진', render: '렌더링', leak: '유출 이미지', predecessor: '전작·시리즈 이미지' };
export const LIKELY = { high: '출시 가능성 높음', medium: '출시 가능성 보통', low: '소문 단계' };
export const MOOD_CLASS = { 긍정: 'pos', 혼재: 'mix', 부정: 'neg', '정보 부족': 'none' };
export const mah = (x) => `${Math.round(x).toLocaleString()}mAh`;
export const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

/** One slot of the categorical palette per phone in a comparison; the colour follows the phone. */
export const CAT = [1, 2, 3, 4, 5].map((i) => `var(--c${i})`);

export const when = (t) => (t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const day = (t) => { const d = new Date(t); return Number.isNaN(+d) ? String(t) : d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }); };
export const imgSrc = (p, i) => `/api/phones/img?id=${encodeURIComponent(p.id)}&i=${i}`;

/** A figure that may not be confirmed: estimates get a dashed underline, a badge and their range. */
export function V({ e, fmt, unit, stack }) {
  const r = est(e, fmt, unit);
  return (
    <>
      <span className={`np-v${r.sure ? '' : ' guess'}${r.text === '미정' ? ' none' : ''}`} title={r.note || undefined}>
        {r.text}{!r.sure && r.certainty && r.certainty !== '미정' ? <i>{r.certainty}</i> : null}
      </span>
      {r.range && <small className={`np-rng${stack ? ' stack' : ''}`}>{r.range}</small>}
    </>
  );
}

/** The phone's first picture, labelled for what it is. */
export function Pic({ p, size = 'md' }) {
  const [bad, setBad] = useState({});
  const im = (p.images ?? []).map((x, i) => ({ ...x, i })).find((x) => !bad[x.i]);
  return (
    <div className={`np-pic ${size}`}>
      {im ? (
        <>
          <img src={imgSrc(p, im.i)} alt={`${p.brand} ${p.name}`} loading="lazy" onError={() => setBad((b) => ({ ...b, [im.i]: true }))} />
          {size !== 'sm' && <span className={`np-kind k-${im.kind}`}>{KIND[im.kind] ?? '이미지'}</span>}
        </>
      ) : <span className="np-initial">{String(p.brand ?? '?')[0]}</span>}
    </div>
  );
}

export function Ring({ value, size = 84 }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className="np-fitring" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`내 취향 적합도 ${value}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="rf-bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="rf-fg" strokeDasharray={`${(c * value) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dy=".35em" textAnchor="middle" className="rf-t">{value}<tspan className="rf-u">%</tspan></text>
    </svg>
  );
}

export function Move({ d }) {
  if (!d) return null;
  return <span className={`np-move ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? '▲' : '▼'}{Math.abs(d)}</span>;
}

/** Concern severity: status colour with a shape and a word, never colour alone. */
const SEV = {
  high: { label: '큰 우려', icon: '▲' },
  medium: { label: '주의', icon: '◆' },
  low: { label: '사소', icon: '●' },
};
export function Sev({ level }) {
  const s = SEV[level] ?? SEV.low;
  return <span className={`np-sev ${level}`}><i aria-hidden="true">{s.icon}</i>{s.label}</span>;
}

/** A bar on a 0–100 track: the leader in the accent, the rest in grey. */
export function Bar({ value, lead, label }) {
  return (
    <span className="np-bar" role="img" aria-label={label}>
      <i className={lead ? 'lead' : ''} style={{ width: `${Math.max(2, Math.min(100, value ?? 0))}%` }} />
    </span>
  );
}

/** One community's mood: a gauge, a line on what they say, and what they argue about. */
function Mood({ title, m }) {
  if (!m) return null;
  const none = m.sentiment === '정보 부족';
  return (
    <div className={`np-mood ${MOOD_CLASS[m.sentiment]}`}>
      <div className="np-mood-top"><b>{title}</b><em>{m.sentiment}{none ? '' : ` · ${m.score}`}</em></div>
      {!none && <div className="np-meter" role="img" aria-label={`${title} 여론 ${m.score}점`}><i style={{ width: `${Math.max(3, m.score)}%` }} /></div>}
      <p>{m.summary}</p>
      {!!m.topics?.length && <ul className="np-topics">{m.topics.map((t, i) => <li key={i}>{t}</li>)}</ul>}
    </div>
  );
}

const REGION = { kr: '한국', global: '해외' };

/** Community opinion, in full view — unreleased phones included (the reaction to their leaks). */
export function OpinionPanel({ p, all }) {
  const o = p.opinion;
  if (!o) return null;
  const list = o.points ?? [];
  const pros = all ? list.filter((x) => x.stance === 'pro') : list.filter((x) => x.stance === 'pro').slice(0, 4);
  const cons = all ? list.filter((x) => x.stance === 'con') : list.filter((x) => x.stance === 'con').slice(0, 4);
  return (
    <div className="np-op">
      <div className="np-op-head">
        <h4>커뮤니티 여론</h4>
        {o.basis && <span className="np-op-basis">{o.basis}</span>}
        <span className={`np-op-all ${MOOD_CLASS[o.sentiment]}`}>{o.sentiment}{o.sentiment === '정보 부족' ? '' : ` · ${o.score}점`}</span>
      </div>
      {o.kr || o.global ? (
        <div className="np-moods"><Mood title="한국 커뮤니티" m={o.kr} /><Mood title="해외 커뮤니티" m={o.global} /></div>
      ) : <p className="np-op-sum">{o.summary}</p>}
      {(pros.length > 0 || cons.length > 0) && (
        <div className="np-op-points">
          <ul className="pro">{pros.map((x, i) => <li key={i}>{x.text}<small>{x.region ? ` · ${REGION[x.region]}` : ''} · {x.source}</small></li>)}</ul>
          <ul className="con">{cons.map((x, i) => <li key={i}>{x.text}<small>{x.region ? ` · ${REGION[x.region]}` : ''} · {x.source}</small></li>)}</ul>
        </div>
      )}
    </div>
  );
}
