import { describe, expect, it } from 'vitest';
import {
  CLASSIC_DEFAULTS,
  classicStepResponse,
  ClassicSim,
  LegacyClassicSim,
  type ClassicParams,
} from '../classic.ts';
import { criticalGain, tailRms } from '../stability.ts';

const quiet: ClassicParams = { ...CLASSIC_DEFAULTS, noise: 0 };

describe('Spec test 2 — delay correctness (bug #1 regression)', () => {
  it.each([5, 15, 30])(
    'applied force is exactly the force from %d ms earlier, even while the handle moves',
    (ms) => {
      const sim = new ClassicSim({ ...CLASSIC_DEFAULTS, delayMs: ms });
      const d = Math.round(ms / 1000 / sim.h);
      const force: number[] = [];
      const applied: number[] = [];
      for (let i = 0; i < 4000; i++) {
        sim.setHandle(80 * Math.sin(i * 0.004) * (i > 500 ? 1 : 0)); // continuous dragging
        sim.step();
        force.push(sim.out.force);
        applied.push(sim.out.applied);
      }
      for (let k = d; k < force.length; k++) expect(applied[k]).toBe(force[k - d]);
      expect(sim.appliedDelayS).toBeCloseTo(ms / 1000, 9);
    },
  );

  it('legacy emulation applies far less than the configured delay while the target moves', () => {
    const sim = new LegacyClassicSim({ ...CLASSIC_DEFAULTS, delayMs: 15 });
    for (let i = 0; i < 60; i++) sim.frame(1 / 60);
    sim.setHandle(50);
    let maxDuringMove = 0;
    for (let i = 0; i < 30; i++) {
      sim.frame(1 / 60);
      maxDuringMove = Math.max(maxDuringMove, sim.lastAppliedDelay);
    }
    expect(maxDuringMove).toBeLessThan(0.015 / 2);
    expect(sim.recreations).toBeGreaterThan(25);
  });
});

describe('Spec test 9 — Classic mode reproduces the qualitative lessons', () => {
  it('more P → faster and more overshoot', () => {
    const lo = classicStepResponse({ ...quiet, kp: 4 }).metrics;
    const hi = classicStepResponse({ ...quiet, kp: 14 }).metrics;
    expect(hi.latency50).toBeLessThan(lo.latency50);
    expect(hi.overshootPct).toBeGreaterThan(lo.overshootPct);
  });

  it('more D → more damping but more noise heat', () => {
    const lowD = { ...CLASSIC_DEFAULTS, kp: 12, kd: 1.5 };
    const highD = { ...CLASSIC_DEFAULTS, kp: 12, kd: 6 };
    expect(classicStepResponse(highD).metrics.overshootPct).toBeLessThan(
      classicStepResponse(lowD).metrics.overshootPct,
    );
    const heat = (p: ClassicParams) => {
      const s = new ClassicSim(p);
      s.run(5000);
      return s.out.heat;
    };
    expect(heat(highD)).toBeGreaterThan(2 * heat(lowD));
  });

  it('delay → instability: with P = 20, D = 0 the oscillation grows with delay (runaway at 30 ms)', () => {
    const growth = (delayMs: number) => {
      const s = new ClassicSim({ ...quiet, kp: 20, kd: 0, ki: 0, kff: 0, delayMs });
      s.setHandle(10);
      const err: number[] = [];
      s.run(10_000, (o) => err.push(o.target - o.pos));
      return tailRms(err.slice(8000), 0) / tailRms(err.slice(2000, 4000), 0);
    };
    const g = [5, 15, 30].map(growth);
    expect(g[0]).toBeLessThan(1);
    expect(g[1]).toBeGreaterThan(g[0]!);
    expect(g[2]).toBeGreaterThan(2);
  });

  it('legacy flag reproduces the frame-rate dependence of "motor heat" (60 < 144 < 240 Hz)', () => {
    const heat = (fps: number) => {
      const s = new LegacyClassicSim(CLASSIC_DEFAULTS);
      for (let i = 0; i < fps * 5; i++) s.frame(1 / fps);
      return s.heat;
    };
    const [a, b, c] = [heat(60), heat(144), heat(240)];
    expect(b).toBeGreaterThan(a * 1.8);
    expect(c).toBeGreaterThan(b * 1.4);
  });
});

/** Smallest Kp (D fixed) at which a small step no longer settles. */
export function classicCriticalP(delayMs: number, kd = 2): number {
  return criticalGain(
    (kp) => {
      const s = new ClassicSim({ ...quiet, kp, kd, ki: 0, kff: 0, delayMs });
      s.setHandle(10);
      const err: number[] = [];
      s.run(10_000, (o) => err.push(o.target - o.pos));
      const early = tailRms(err.slice(2000, 4000), 0);
      const late = tailRms(err.slice(8000), 0);
      return late >= early && late > 0.01;
    },
    1,
    5000,
  );
}

describe('Spec test 5 (Classic) — critical P decreases monotonically with delay', () => {
  it('delay 5 → 15 → 30 → 60 ms', () => {
    const crit = [5, 15, 30, 60].map((d) => classicCriticalP(d));
    for (let i = 1; i < crit.length; i++) expect(crit[i]).toBeLessThan(crit[i - 1]!);
  });
});
