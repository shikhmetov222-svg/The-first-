/** Маленький график-линия с лёгкой заливкой. Точки: [секунды unix, значение]. */
export function MiniChart({ points, height = 28, color = '#D4A73A' }: { points: [number, number][]; height?: number; color?: string }) {
  if (points.length < 2) return <div className="mini-chart-empty" style={{ height }} />;
  const W = 100;
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const vals = points.map((p) => p[1]);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => height - 2 - ((v - lo) / (hi - lo)) * (height - 4);
  const line = points.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const id = `mc-${color.replace('#', '')}`;
  return (
    <svg className="mini-chart" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
