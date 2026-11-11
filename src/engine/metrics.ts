export interface StepMetrics {
  /** Time to reach 50 % of the step (PIDtoolbox / Brian White "latency"), s. */
  latency50: number;
  /** 10 % → 90 % rise time, s. */
  rise1090: number;
  /** Peak overshoot, % of step (0 if none). */
  overshootPct: number;
  /** Time after which |y − target| stays within ±5 % of the step, s (NaN if never). */
  settling5: number;
  /** Mean of the last 10 % of the window minus target, in output units. */
  steadyStateError: number;
}

/** First time `y` crosses `level` going up, linearly interpolated. NaN if never. */
export function crossingTime(t: ArrayLike<number>, y: ArrayLike<number>, level: number, from = 0): number {
  for (let i = Math.max(from, 1); i < y.length; i++) {
    const a = y[i - 1]!;
    const b = y[i]!;
    if (a < level && b >= level) {
      const frac = (level - a) / (b - a);
      return t[i - 1]! + frac * (t[i]! - t[i - 1]!);
    }
  }
  return Number.NaN;
}

/**
 * Metrics of a step response. `t0` is the step instant, `target` the final setpoint
 * (step from `base` to `target`). Works for positive and negative steps.
 */
export function stepMetrics(
  t: ArrayLike<number>,
  y: ArrayLike<number>,
  t0: number,
  target: number,
  base = 0,
): StepMetrics {
  const amp = target - base;
  const n = y.length;
  const norm = new Float64Array(n);
  let start = 0;
  for (let i = 0; i < n; i++) {
    norm[i] = (y[i]! - base) / amp;
    if (t[i]! < t0) start = i + 1;
  }
  const at = (lvl: number) => crossingTime(t, norm, lvl, start) - t0;
  const t10 = at(0.1);
  const t50 = at(0.5);
  const t90 = at(0.9);
  let peak = -Infinity;
  for (let i = start; i < n; i++) peak = Math.max(peak, norm[i]!);
  let lastOut = -1;
  for (let i = start; i < n; i++) if (Math.abs(norm[i]! - 1) > 0.05) lastOut = i;
  const settling5 = lastOut < 0 ? 0 : lastOut >= n - 1 ? Number.NaN : t[lastOut + 1]! - t0;
  const tailFrom = Math.max(start, Math.floor(n * 0.9));
  let tail = 0;
  for (let i = tailFrom; i < n; i++) tail += y[i]!;
  tail /= Math.max(1, n - tailFrom);
  return {
    latency50: t50,
    rise1090: t90 - t10,
    overshootPct: Math.max(0, (peak - 1) * 100),
    settling5,
    steadyStateError: tail - target,
  };
}
