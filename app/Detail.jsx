'use client';

import { useEffect, useState } from 'react';

const DAY = 864e5;

const fmtDate = (d) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${y}년 ${Number(m)}월 ${Number(day)}일`;
};

/**
 * Daily plays as a column chart. Every day between first and last gets a slot
 * so the gaps are visible — a run of silence is part of the shape, and a chart
 * that only plots the days something played would hide it.
 *
 * A long history needs more days than there are pixels, so several days share
 * a column. That column takes the busiest day in its span rather than their
 * sum: the caption underneath names a single day's record, and summing made
 * the tallest bar disagree with it — a quiet stretch of many days could out-
 * rank the actual peak.
 */
function DailyChart({ daily }) {
  if (!daily.length) return null;
  const t0 = new Date(daily[0].day + 'T00:00:00Z').getTime();
  const t1 = new Date(daily[daily.length - 1].day + 'T00:00:00Z').getTime();
  const span = Math.max(1, Math.round((t1 - t0) / DAY));
  const cells = Math.min(120, span + 1);
  const max = Math.max(...daily.map((d) => Number(d.plays)));

  const buckets = new Array(cells).fill(0);
  for (const d of daily) {
    const t = new Date(d.day + 'T00:00:00Z').getTime();
    const i = span === 0 ? 0 : Math.round(((t - t0) / (span * DAY)) * (cells - 1));
    buckets[i] = Math.max(buckets[i], Number(d.plays));
  }
  const peak = Math.max(...buckets, 1);

  return (
    <div className="chart" role="img" aria-label={`하루 최대 ${max}회`}>
      {buckets.map((v, i) => (
        <i key={i} style={{ height: v ? `${Math.max(6, (v / peak) * 100)}%` : '1px' }}
           data-on={v > 0} />
      ))}
    </div>
  );
}

/**
 * Everything known about one row, fetched on demand. Opens over the list
 * rather than navigating, so the ranking stays where it was.
 */
export default function Detail({ target, source, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!target) return;
    const ctl = new AbortController();
    setData(null);
    setError(null);
    const qs = new URLSearchParams({ artist: target.artist, source });
    if (target.track) qs.set('track', target.track);
    fetch(`/api/item?${qs}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); setData(j); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => ctl.abort();
  }, [target, source]);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onClose]);

  if (!target) return null;
  const s = data?.summary;
  const best = data?.daily?.length
    ? data.daily.reduce((a, b) => (Number(b.plays) > Number(a.plays) ? b : a))
    : null;
  const hours = s ? s.minutes / 60 : 0;

  return (
    <>
      <button className="sheet-scrim" aria-label="닫기" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-head">
          <div className="nm">
            <b>{target.track ?? target.artist}</b>
            {target.track && <span>{target.artist}</span>}
          </div>
          <button className="pill" onClick={onClose}>닫기</button>
        </div>

        {error && <p className="err">{error}</p>}
        {!error && !data && <p className="note">불러오는 중…</p>}

        {s && (
          <>
            <div className="totals">
              {[
                [s.plays.toLocaleString(), '재생'],
                [hours >= 1 ? `${hours.toFixed(1)}h` : `${s.minutes}분`, '시간'],
                [s.days.toLocaleString(), '들은 날'],
                [s.weeks.toLocaleString(), '들은 주'],
              ].map(([v, l]) => (
                <div className="tot" key={l}><b>{v}</b><span>{l}</span></div>
              ))}
            </div>

            <p className="synced" style={{ marginTop: 14 }}>
              <b>{fmtDate(s.first)}</b> 처음 · <b>{fmtDate(s.last)}</b> 마지막
            </p>

            <DailyChart daily={data.daily} />
            <p className="note">
              막대는 하루 재생 횟수입니다. 가장 많이 들은 날{' '}
              <b>{fmtDate(best?.day)}</b> — {Number(best?.plays ?? 0).toLocaleString()}회
            </p>
          </>
        )}
      </div>
    </>
  );
}
