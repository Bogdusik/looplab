import { describe, expect, it } from 'vitest';
import { BfSim } from '../bfsim.ts';
import { defaultBfParams } from '../presets.ts';
import { findPeaks, welch } from '../spectrum.ts';
import type { BfParams } from '../types.ts';

function hoverSpectrum(mutate: (p: BfParams) => void, seconds = 6) {
  const p = defaultBfParams();
  p.drone.noise.electricalDps = 0;
  p.drone.noise.jitter = 0;
  mutate(p);
  const sim = new BfSim(p);
  sim.run(4000);
  const n = Math.round(seconds / sim.h);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    sim.step();
    x[i] = sim.out.gyroRaw;
  }
  return { spec: welch(x, p.loop.gyroHz, 8192), hzL: sim.out.hzL, hzR: sim.out.hzR };
}

const near = (peaks: { f: number }[], f: number, tol: number) =>
  peaks.some((pk) => Math.abs(pk.f / f - 1) < tol);

describe('Spec test 8 — noise model', () => {
  it('spectral peaks sit at motor RPM/60 × harmonic (±2 %)', () => {
    const { spec, hzL, hzR } = hoverSpectrum((p) => {
      p.drone.noise.motorSpread = 0;
      p.drone.cgOffsetM = 0;
    });
    expect(hzL).toBeCloseTo(hzR, 6);
    const peaks = findPeaks(spec, 50, 2000, 20);
    for (const h of [1, 2, 3]) expect(near(peaks, hzL * h, 0.02)).toBe(true);
  });

  it('a CG offset splits left/right motor RPM into two peak clusters', () => {
    const { spec, hzL, hzR } = hoverSpectrum((p) => {
      p.drone.noise.motorSpread = 0;
      p.drone.cgOffsetM = 0.012;
    });
    expect(Math.abs(hzR / hzL - 1)).toBeGreaterThan(0.04);
    const peaks = findPeaks(spec, 50, 2000, 20);
    for (const h of [1, 2]) {
      expect(near(peaks, hzL * h, 0.01)).toBe(true);
      expect(near(peaks, hzR * h, 0.01)).toBe(true);
    }
  });

  it('peak level scales with the prop/motor balance knob (×2 amplitude ≈ +6 dB)', () => {
    const level = (balance: number) => {
      const { spec, hzL } = hoverSpectrum((p) => {
        p.drone.noise.balance = balance;
        p.drone.noise.motorSpread = 0;
        p.drone.cgOffsetM = 0;
      });
      return findPeaks(spec, hzL * 0.9, hzL * 1.1, 0)[0]!.db;
    };
    expect(level(2) - level(1)).toBeCloseTo(6.02, 0);
  });

  it('the RPM filter removes the motor peaks from the filtered gyro', () => {
    const p = defaultBfParams();
    p.drone.noise.electricalDps = 0;
    const run = (rpm: boolean) => {
      const q = structuredClone(p);
      q.filters.rpm.enabled = rpm;
      q.filters.gyroLpf1.enabled = false;
      q.filters.gyroLpf2.enabled = false;
      const sim = new BfSim(q);
      sim.run(4000);
      const x = new Float64Array(32000);
      for (let i = 0; i < x.length; i++) {
        sim.step();
        x[i] = sim.out.gyroFilt;
      }
      const s = welch(x, 8000, 4096);
      return findPeaks(s, sim.out.hzL * 0.9, sim.out.hzR * 1.1, 0)[0]?.db ?? -200;
    };
    expect(run(false) - run(true)).toBeGreaterThan(20);
  });
});
