/**
 * Critical-gain search used by tests and docs: the smallest multiplier `k` of a gain for which a
 * small step no longer settles (sustained or growing oscillation). Relies on `isUnstable(k)` being
 * monotonic in k, which the bisection assumes.
 */
export function criticalGain(isUnstable: (k: number) => boolean, lo: number, hi: number, iters = 18): number {
  if (isUnstable(lo)) return lo;
  if (!isUnstable(hi)) return hi;
  for (let i = 0; i < iters; i++) {
    const mid = Math.sqrt(lo * hi);
    if (isUnstable(mid)) hi = mid;
    else lo = mid;
  }
  return Math.sqrt(lo * hi);
}

/** RMS of `x[from..]` relative to `scale`. */
export function tailRms(x: ArrayLike<number>, from: number, scale = 1): number {
  let s = 0;
  let n = 0;
  for (let i = from; i < x.length; i++) {
    s += x[i]! * x[i]!;
    n++;
  }
  return Math.sqrt(s / Math.max(1, n)) / scale;
}
