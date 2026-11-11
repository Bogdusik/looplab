import type { RatesConfig } from './types.ts';

/** controlrate_profile.c default rate_limit (deg/s). */
export const RATE_LIMIT = 1998;

const power5 = (x: number) => x * x * x * x * x;

/**
 * Betaflight ACTUAL rates — port of `src/main/fc/rc.c` applyActualRates().
 * Betaflight stores rcRates/rates in tens of deg/s (7 / 67) and expo in % (0..100);
 * here they are in display units (70 / 670 / 0.00).
 */
export function actualRate(rcCommand: number, cfg: RatesConfig): number {
  const abs = Math.abs(rcCommand);
  const expof = abs * (power5(rcCommand) * cfg.expo + rcCommand * (1 - cfg.expo));
  const centerSensitivity = cfg.centerRate;
  const stickMovement = Math.max(0, cfg.maxRate - centerSensitivity);
  const angleRate = rcCommand * centerSensitivity + stickMovement * expof;
  return Math.max(-RATE_LIMIT, Math.min(RATE_LIMIT, angleRate));
}

/** Inverse of actualRate for a target rate (bisection; rates are monotonic in stick). */
export function stickForRate(rate: number, cfg: RatesConfig): number {
  const sign = Math.sign(rate) || 1;
  const target = Math.abs(rate);
  if (target >= actualRate(1, cfg)) return sign;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (actualRate(mid, cfg) < target) lo = mid;
    else hi = mid;
  }
  return sign * 0.5 * (lo + hi);
}
