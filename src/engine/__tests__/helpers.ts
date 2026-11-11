import type { Filter } from '../filters.ts';

/** Least-squares fit of y ≈ a·sin(ωt) + b·cos(ωt); returns amplitude and phase (rad). */
export function fitSine(y: ArrayLike<number>, hz: number, fs: number, from = 0) {
  let ss = 0;
  let cc = 0;
  let sc = 0;
  let ys = 0;
  let yc = 0;
  for (let i = from; i < y.length; i++) {
    const w = (2 * Math.PI * hz * i) / fs;
    const s = Math.sin(w);
    const c = Math.cos(w);
    ss += s * s;
    cc += c * c;
    sc += s * c;
    ys += y[i]! * s;
    yc += y[i]! * c;
  }
  const det = ss * cc - sc * sc;
  const a = (ys * cc - yc * sc) / det;
  const b = (yc * ss - ys * sc) / det;
  return { amp: Math.hypot(a, b), phase: Math.atan2(b, a) };
}

/** Steady-state gain and phase of a filter at `hz`, measured by simulation. */
export function measureFilter(filter: Filter, hz: number, fs: number, seconds = 1) {
  const n = Math.round(seconds * fs);
  const out = new Float64Array(n);
  filter.reset();
  for (let i = 0; i < n; i++) out[i] = filter.apply(Math.sin((2 * Math.PI * hz * i) / fs));
  return fitSine(out, hz, fs, Math.floor(n / 2));
}

/** Bisection for x in [lo, hi] where f(x) changes sign (f(lo) and f(hi) must differ in sign). */
export function bisect(f: (x: number) => number, lo: number, hi: number, iters = 60): number {
  let flo = f(lo);
  for (let i = 0; i < iters; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = f(mid);
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return 0.5 * (lo + hi);
}
