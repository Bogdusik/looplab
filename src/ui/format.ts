export const fmt = {
  x: (v: number) => (v / 100).toFixed(2) + '×',
  int: (v: number) => String(Math.round(v)),
  hz: (v: number) => `${Math.round(v)} Hz`,
  ms: (v: number) => `${v.toFixed(v < 10 ? 2 : 1)} ms`,
  pct: (v: number) => `${Math.round(v * 100)} %`,
  f2: (v: number) => v.toFixed(2),
  f3: (v: number) => v.toFixed(3),
};
