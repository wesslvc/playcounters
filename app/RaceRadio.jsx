'use client';

import { useEffect, useRef, useState } from 'react';
import { artistColor } from '@/lib/genre';

/** What each kind of message is about, as a coloured dot beside its tag. */
const TONE = {
  battle: 'var(--live)', overtake: 'var(--pos)', eta: '#A855F7', closing: 'var(--gold)',
  projected: 'var(--ink)', lead: 'var(--ink-3)', hit: 'var(--gold)', near: 'var(--gold)',
};
const seenKey = (k) => `radio-seen|${k}`;

/** The overtake-difficulty bar: ten cells, green to red, lit up to `v`. */
function Meter({ v }) {
  const lit = Math.round(Math.min(1, Math.max(0, v)) * 10);
  return (
    <span className="ins-meter" aria-label={`추월 난이도 ${Math.round(v * 100)}%`}>
      <span className="ins-cells">
        {Array.from({ length: 10 }, (_, i) => <i key={i} data-on={i < lit || undefined} style={{ '--i': i }} />)}
      </span>
      <small>OVERTAKE DIFFICULTY</small>
    </span>
  );
}

/**
 * One message laid out like F1 TV's Insights panels, in the app's own
 * style: a head, the chaser on the left and the car ahead on the right in
 * their team colours, the forecast boxed in the middle, and a strip of
 * detail along the foot.
 */
function Broadcast({ card }) {
  const s = (x, right) => x && (
    <span className={`ins-side${right ? ' r' : ''}`} style={{ '--team': artistColor(x.artist) }}>
      <b>{x.name}</b>
      {x.sub && <small>{x.sub}</small>}
    </span>
  );
  return (
    <span className={`ins${card.right ? '' : ' solo'}`}>
      <span className="ins-head">
        <b>{card.head}</b>
        <em>{card.tag ? `${card.tag} · ` : ''}<i>Insights</i></em>
      </span>
      <span className="ins-body">
        {s(card.left)}
        <span className="ins-mid">
          <small>{card.mid.top}</small>
          <b>{card.mid.pre && <i>{card.mid.pre} </i>}{card.mid.big}{card.mid.unit && <i> {card.mid.unit}</i>}</b>
        </span>
        {s(card.right, true)}
      </span>
      <span className="ins-foot">
        <span>▸ {card.foot?.l}</span>
        {card.meter != null ? <Meter v={card.meter} /> : <span />}
        <span className="r">{card.foot?.r}</span>
      </span>
    </span>
  );
}

/**
 * Race radio: the fights, overtakes, projected passes and milestones in
 * whatever ranking is on screen, as a quiet LIVE button that opens a short
 * feed — and, the first time a view has news in a visit, its top line
 * slides up once on its own. The numbers come from the server; the wording
 * may be the AI's.
 */
export default function RaceRadio({ ctx, source, estimate, onSelect }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const ctxKey = ctx ? JSON.stringify({ ...ctx, source, estimate }) : null;
  const timer = useRef(null);

  useEffect(() => {
    if (!ctx) return undefined;
    const ctl = new AbortController();
    // wait for the view to settle before asking
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ view: ctx.view, source, label: ctx.label ?? '' });
      if (estimate) qs.set('estimate', '1');
      for (const k of ['from', 'to', 'mode', 'year']) if (ctx[k] != null) qs.set(k, String(ctx[k]));
      fetch(`/api/radio?${qs}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((j) => {
          if (j.error) throw new Error(j.error);
          setData({ ...j, key: ctxKey, label: ctx.label });
          let seen = false;
          try { seen = sessionStorage.getItem(seenKey(ctxKey)) === '1'; sessionStorage.setItem(seenKey(ctxKey), '1'); } catch { /* private mode */ }
          const lead = j.items?.find((x) => x.kind !== 'lead');
          if (!seen && lead) {
            setToast(lead);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setToast(null), 6000);
          }
        })
        .catch((e) => { if (e.name !== 'AbortError') setData({ items: [], key: ctxKey, label: ctx.label }); });
    }, 700);
    return () => { clearTimeout(t); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey]);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { setOpen(false); setToast(null); }, [ctxKey]);

  const items = data?.key === ctxKey ? data.items ?? [] : [];
  const news = items.filter((x) => x.kind !== 'lead').length;
  const go = (it) => { if (it.target) onSelect(it.target); setOpen(false); setToast(null); };

  return (
    <>
      {toast && !open && (
        <button className="rr-toast" onClick={() => { setToast(null); setOpen(true); }}>
          {toast.card ? <Broadcast card={toast.card} /> : (
            <>
              <span className="rr-tag"><i style={{ background: TONE[toast.kind] }} />{toast.title}</span>
              <span className="rr-text">{toast.text}</span>
            </>
          )}
        </button>
      )}

      {open && (
        <>
          <button className="scrim" aria-label="닫기" onClick={() => setOpen(false)} />
          <div className="rr-pop" role="dialog" aria-label="레이스 라디오">
            <header>
              <b>Race Radio</b>
              <span>{data?.label}</span>
            </header>
            {items.length ? (
              <ol>
                {items.map((it, i) => (
                  <li key={i}>
                    <button onClick={() => go(it)} disabled={!it.target}>
                      {it.card ? <Broadcast card={it.card} /> : (
                        <span className="rr-tag"><i style={{ background: TONE[it.kind] }} />{it.title}</span>
                      )}
                      <span className="rr-text">{it.text}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rr-none">{data ? '지금은 조용해요. 눈에 띄는 경쟁이나 변동이 없어요.' : '무선 연결 중…'}</p>
            )}
            {items.some((x) => x.ai) && <p className="rr-foot">AI 해설 · 수치는 실제 기록 기준</p>}
          </div>
        </>
      )}

      <button className="rr-fab" aria-expanded={open} onClick={() => { setOpen((v) => !v); setToast(null); }}>
        <i aria-hidden="true" data-on={news > 0 || undefined} />
        LIVE
        {news > 0 && <b>{news}</b>}
      </button>
    </>
  );
}
