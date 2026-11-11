import { describe, expect, it } from 'vitest';
import { BfSim } from '../bfsim.ts';
import { defaultBfParams } from '../presets.ts';
import { criticalGain, tailRms } from '../stability.ts';
import type { BfParams } from '../types.ts';

/** Smallest P multiplier (I, D, F fixed) for which a small step no longer settles. */
function bfCriticalP(mutate: (p: BfParams) => void): number {
  return criticalGain(
    (k) => {
      const p = defaultBfParams();
      p.noiseEnabled = false;
      p.rc.smoothing = false;
      p.pid.gains.f = 0;
      mutate(p);
      p.pid.gains.p *= k;
      const sim = new BfSim(p);
      sim.run(400);
      sim.alignPacket();
      sim.setStick(0.05);
      const err: number[] = [];
      sim.run(Math.round(0.6 / sim.h), (o) => err.push(o.setpoint - o.gyroTrue));
      const amp = Math.abs(sim.out.setpoint) || 1;
      return tailRms(err, Math.round(0.45 / sim.h), amp) > 0.05;
    },
    0.5,
    40,
    14,
  );
}

describe('Spec test 5 (Betaflight mode) — stability trend', () => {
  it('critical P decreases monotonically as transport delay increases', () => {
    const crit = [0.25, 1, 2, 4].map((ms) => bfCriticalP((p) => (p.drone.transportDelayS = ms / 1000)));
    for (let i = 1; i < crit.length; i++) expect(crit[i]).toBeLessThan(crit[i - 1]!);
  });

  it('critical P decreases monotonically as gyro + D-term filtering gets stronger', () => {
    const crit = [1.5, 1, 0.6, 0.35].map((m) =>
      bfCriticalP((p) => {
        const f = p.filters;
        for (const l of [f.gyroLpf1, f.gyroLpf2, f.dtermLpf1, f.dtermLpf2]) {
          l.staticHz *= m;
          l.minHz *= m;
          l.maxHz *= m;
        }
      }),
    );
    for (let i = 1; i < crit.length; i++) expect(crit[i]).toBeLessThan(crit[i - 1]!);
  });
});
