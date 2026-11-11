import { describe, expect, it } from 'vitest';
import { BfSim } from '../bfsim.ts';
import { defaultBfParams } from '../presets.ts';
import { Prng } from '../prng.ts';
import { heatLevel } from '../thermal.ts';
import type { BfParams } from '../types.ts';

function fly(params: BfParams, seconds: number, jerky: boolean) {
  const sim = new BfSim(params);
  const rng = new Prng(9);
  let stick = 0;
  const n = Math.round(seconds / sim.h);
  for (let i = 0; i < n; i++) {
    if (jerky && i % 1600 === 0) stick = rng.signed() * 0.6;
    sim.setStick(stick);
    sim.step();
  }
  return Math.max(sim.out.tempL, sim.out.tempR);
}

describe('Motor temperature (qualitative calibration, spec §5.8)', () => {
  it('default 5" in a hover stays cool', () => {
    expect(heatLevel(fly(defaultBfParams('freestyle5'), 60, false))).toBe('cool');
  });

  it('RPM filter off → motor noise reaches the loop → hot within 40 s', () => {
    const p = defaultBfParams('freestyle5');
    p.filters.rpm.enabled = false;
    expect(heatLevel(fly(p, 40, false))).toBe('hot');
  });

  it('7" with FF 1.0 and snappy inputs gets hot within 40 s; more FF = more heat', () => {
    const t = (ffMul: number) => {
      const p = defaultBfParams('longRange7');
      p.pid.gains.f = Math.round(p.pid.gains.f * ffMul);
      return fly(p, 40, true);
    };
    const t0 = t(0);
    const t1 = t(1);
    expect(heatLevel(t1)).toBe('hot');
    expect(t1).toBeGreaterThan(t0 + 5);
  });
});
