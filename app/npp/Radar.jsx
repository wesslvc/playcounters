import { RADAR } from './score';

/**
 * Six-axis radar. `series` is a list of { label, color, values: {axisKey: 0–100} }.
 * With `mini` it's just the shape, no labels — for cards.
 */
export default function Radar({ series, size = 220, mini = false }) {
  const n = RADAR.length;
  const c = size / 2;
  const R = mini ? c - 6 : c - 34;
  const pt = (i, v) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (R * Math.max(0, Math.min(100, v))) / 100;
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  };
  const ring = (f) => RADAR.map((_, i) => pt(i, 100 * f).join(',')).join(' ');
  return (
    <svg className="np-radar" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img"
      aria-label={series.map((s) => s.label).join(', ') + ' 레이더 차트'}>
      {[0.33, 0.66, 1].map((f) => <polygon key={f} points={ring(f)} className="np-ring" />)}
      {RADAR.map((_, i) => { const [x, y] = pt(i, 100); return <line key={i} x1={c} y1={c} x2={x} y2={y} className="np-ring" />; })}
      {series.map((s) => (
        <polygon key={s.label} className="np-shape" style={{ '--c': s.color }}
          points={RADAR.map(([k], i) => pt(i, s.values[k] ?? 0).join(',')).join(' ')} />
      ))}
      {!mini && RADAR.map(([, label], i) => {
        const [x, y] = pt(i, 100);
        const a = (Math.PI * 2 * i) / n - Math.PI / 2;
        const lx = x + Math.cos(a) * 16;
        const ly = y + Math.sin(a) * 14 + 4;
        return <text key={label} x={lx} y={ly} textAnchor={Math.abs(Math.cos(a)) < 0.2 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end'} className="np-rlabel">{label}</text>;
      })}
    </svg>
  );
}
