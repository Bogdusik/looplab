/**
 * Fixed-step accumulator. Render frames of any length are converted into an integer number of
 * physics steps, so engine output depends only on step index, never on display refresh rate.
 */
export class FixedStepClock {
  readonly h: number;
  private acc = 0;

  constructor(stepSeconds: number) {
    this.h = stepSeconds;
  }

  /**
   * Feed real elapsed time; returns how many fixed steps to run now.
   * `maxSeconds` caps catch-up after tab switches (excess time is dropped, not queued).
   */
  advance(realDt: number, speed = 1, maxSeconds = 0.1): number {
    this.acc += Math.min(Math.max(realDt, 0), maxSeconds) * speed;
    const n = Math.floor(this.acc / this.h + 1e-9);
    this.acc -= n * this.h;
    if (this.acc < 0) this.acc = 0;
    return n;
  }

  reset(): void {
    this.acc = 0;
  }
}

/** EMA coefficient for a time constant, independent of step size: α = 1 − exp(−h/τ). */
export function emaAlpha(h: number, tau: number): number {
  return tau <= 0 ? 1 : 1 - Math.exp(-h / tau);
}
