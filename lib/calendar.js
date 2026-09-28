/** The picker options derived from days that actually hold plays, shared by
    the main dashboard's year picker and the championship page's — both need
    exactly this, and it used to only exist inside Dashboard.jsx. */
export function yearsFromCalendar(calendar) {
  const m = new Map();
  for (const c of calendar ?? []) {
    const y = Number(c.day.slice(0, 4));
    m.set(y, (m.get(y) || 0) + Number(c.plays));
  }
  return [...m].sort((a, b) => b[0] - a[0])
    .map(([y, n]) => ({ value: y, label: `${y}년`, count: n }));
}
