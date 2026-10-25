'use client';

import { useEffect, useMemo, useState } from 'react';
import { yearsFromCalendar } from '@/lib/calendar';
import Picker from './Picker';
import Season from './Season';

/**
 * The championship tab: one year's season, or every Grand Prix ever run
 * added into a career total. Always ranked on plays — a championship needs
 * one fixed ruler to mean anything across months — whatever the chart tab
 * happens to be sorted by.
 */
export default function Championship({ source, mode, estimate, calendar, version, onSelect, year: asked, onYear }) {
  const [allTime, setAllTime] = useState(false);
  const years = useMemo(() => yearsFromCalendar(calendar ?? []), [calendar]);
  const [year, setYear] = useState(asked ?? null);

  // A year handed over from the chart wins once; otherwise the latest season
  // with anything in it, snapping back if a source switch made it vanish.
  useEffect(() => {
    if (asked != null) { setYear(asked); setAllTime(false); onYear?.(null); }
  }, [asked, onYear]);
  useEffect(() => {
    if (years.length && !years.some((y) => y.value === year)) setYear(years[0].value);
  }, [years, year]);

  return (
    <section className="view season-view">
      <div className="hero">
        <p className="hero-k">매달이 한 라운드 · TOP 10에 25–18–15–12–10–8–6–4–2–1 포인트</p>
        <h1 className="hero-t">{allTime ? '역대 통산' : year ? `${year} 시즌` : '시즌'}</h1>
        <div className="picks">
          <button className="chip" aria-pressed={allTime} onClick={() => setAllTime(true)}>역대 통산</button>
          <Picker
            value={allTime ? null : year} label={year ? `${year}년` : '연도'}
            options={years} onChange={(v) => { setYear(v); setAllTime(false); }}
            disabled={!years.length}
          />
        </div>
      </div>

      {allTime
        ? <Season mode={mode} source={source} estimate={estimate} allTime onSelect={onSelect} version={version} />
        : year != null
          ? <Season mode={mode} source={source} estimate={estimate} year={year} onSelect={onSelect} version={version} />
          : <div className="skeleton"><i /><i /><i /></div>}
    </section>
  );
}
