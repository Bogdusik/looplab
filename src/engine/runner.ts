import { FixedStepClock } from './clock.ts';

export interface Steppable {
  readonly h: number;
  step(): void;
}

/**
 * Drives a fixed-step simulation from variable-length render frames.
 * `beforeStep(i)` lets callers inject inputs as a function of the step index (sim time),
 * which is what makes output independent of the render rate.
 */
export class Runner<S extends Steppable> {
  readonly sim: S;
  readonly clock: FixedStepClock;
  steps = 0;
  speed = 1;
  paused = false;

  constructor(sim: S) {
    this.sim = sim;
    this.clock = new FixedStepClock(sim.h);
  }

  get simTime(): number {
    return this.steps * this.sim.h;
  }

  /** Advance by one render frame; returns the number of physics steps taken. */
  frame(realDt: number, beforeStep?: (stepIndex: number) => void, afterStep?: (sim: S) => void): number {
    if (this.paused) {
      this.clock.reset();
      return 0;
    }
    const n = this.clock.advance(realDt, this.speed);
    for (let i = 0; i < n; i++) {
      beforeStep?.(this.steps);
      this.sim.step();
      this.steps++;
      afterStep?.(this.sim);
    }
    return n;
  }
}
