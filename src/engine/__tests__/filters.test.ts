import { describe, expect, it } from 'vitest';
import {
  chainResponse,
  dynLpfCutoffFreq,
  groupDelay,
  Lowpass,
  magnitude,
  pt1FilterGain,
  SvfNotch,
  type FilterSpec,
  type LpfType,
} from '../filters.ts';
import { bisect, measureFilter } from './helpers.ts';

const FS = 8000;

describe('filters', () => {
  const cases: [LpfType, number, number][] = [
    ['PT1', 100, 8000],
    ['PT1', 250, 8000],
    ['PT1', 75, 4000],
    ['PT2', 150, 8000],
    ['PT3', 150, 8000],
    ['SVF', 250, 8000],
    ['SVF', 100, 4000],
  ];

  const f3Analytic = (type: LpfType, fc: number, fs: number) => {
    const spec: FilterSpec = { kind: 'lpf', type, fc, fs };
    return bisect((f) => magnitude(chainResponse([spec], f)) - Math.SQRT1_2, 1, fs * 0.45);
  };
  const f3Simulated = (type: LpfType, fc: number, fs: number) =>
    bisect(
      (f) => measureFilter(new Lowpass(type, fc, 1 / fs), f, fs, 0.5).amp - Math.SQRT1_2,
      fc * 0.5,
      fc * 1.5,
      24,
    );

  it.each(cases)(
    '%s @ %d Hz (fs %d): simulated −3 dB point within ±2 %% of the analytic one',
    (type, fc, fs) => {
      expect(Math.abs(f3Simulated(type, fc, fs) / f3Analytic(type, fc, fs) - 1)).toBeLessThan(0.02);
    },
  );

  it('SVF (bilinear, prewarped) has its −3 dB point exactly at the configured cutoff (±2 %)', () => {
    for (const [fc, fs] of [
      [100, 8000],
      [250, 8000],
      [500, 4000],
    ] as const) {
      expect(Math.abs(f3Simulated('SVF', fc, fs) / fc - 1)).toBeLessThan(0.02);
    }
  });

  it('Betaflight PTn gain (ω/(ω+1)) puts the real −3 dB point 2–12 % below nominal — documented, not a bug', () => {
    for (const [type, fc] of [
      ['PT1', 100],
      ['PT1', 250],
      ['PT2', 150],
      ['PT3', 150],
    ] as const) {
      const ratio = f3Analytic(type, fc, 8000) / fc;
      expect(ratio).toBeGreaterThan(0.88);
      expect(ratio).toBeLessThan(0.98);
    }
  });

  it.each(cases)('%s @ %d Hz (fs %d): simulated gain/phase match the analytic response', (type, fc, fs) => {
    for (const hz of [fc * 0.5, fc, fc * 2]) {
      const sim = measureFilter(new Lowpass(type, fc, 1 / fs), hz, fs);
      const h = chainResponse([{ kind: 'lpf', type, fc, fs }], hz);
      expect(sim.amp).toBeCloseTo(magnitude(h), 3);
      expect(Math.cos(sim.phase - Math.atan2(h.im, h.re))).toBeGreaterThan(0.99999);
    }
  });

  it('PT1 simulated gain at cutoff is −3 dB ± 2 %', () => {
    const fc = 100;
    const m = measureFilter(new Lowpass('PT1', fc, 1 / FS), fc, FS);
    expect(Math.abs(m.amp / Math.SQRT1_2 - 1)).toBeLessThan(0.02);
  });

  it('RPM/SVF notch with Betaflight default Q (5.00) attenuates ≥ 20 dB at centre', () => {
    for (const fc of [100, 180, 400, 900]) {
      const m = measureFilter(new SvfNotch(fc, 1 / FS, 5), fc, FS, 2);
      expect(20 * Math.log10(m.amp)).toBeLessThan(-20);
    }
  });

  it('notch weight fades attenuation (rpm_filter.c fade range)', () => {
    const full = measureFilter(new SvfNotch(200, 1 / FS, 5, 1), 200, FS).amp;
    const half = measureFilter(new SvfNotch(200, 1 / FS, 5, 0.5), 200, FS).amp;
    const off = measureFilter(new SvfNotch(200, 1 / FS, 5, 0), 200, FS).amp;
    expect(full).toBeLessThan(0.01);
    expect(half).toBeCloseTo(0.5, 2);
    expect(off).toBeCloseTo(1, 3);
  });

  it('PT1 group delay matches the closed-form discrete value ± 5 %', () => {
    for (const fc of [75, 150, 300, 500]) {
      const k = pt1FilterGain(fc, 1 / FS);
      const a = 1 - k;
      for (const hz of [20, 100, 200]) {
        const w = (2 * Math.PI * hz) / FS;
        // group delay of 1/(1 − a z⁻¹) in samples: (a cos ω − a²)/(1 − 2a cos ω + a²)
        const samples = (a * Math.cos(w) - a * a) / (1 - 2 * a * Math.cos(w) + a * a);
        const expected = samples / FS;
        const got = groupDelay([{ kind: 'lpf', type: 'PT1', fc, fs: FS }], hz);
        expect(Math.abs(got / expected - 1)).toBeLessThan(0.05);
      }
    }
  });

  it('group delay of a cascade is the sum of the parts; low-freq PT1 ≈ 1/(2π fc)', () => {
    const a: FilterSpec = { kind: 'lpf', type: 'PT1', fc: 250, fs: FS };
    const b: FilterSpec = { kind: 'lpf', type: 'PT2', fc: 150, fs: FS };
    const sum = groupDelay([a], 100) + groupDelay([b], 100);
    expect(groupDelay([a, b], 100)).toBeCloseTo(sum, 9);
    expect(Math.abs(groupDelay([a], 1) * 2 * Math.PI * 250 - 1)).toBeLessThan(0.05);
  });

  it('dynamic LPF cutoff curve (pid.c dynLpfCutoffFreq)', () => {
    expect(dynLpfCutoffFreq(0, 250, 500, 5)).toBe(250);
    expect(dynLpfCutoffFreq(1, 250, 500, 5)).toBe(500);
    expect(dynLpfCutoffFreq(0.3, 250, 500, 5)).toBeCloseTo(250 + 250 * (0.3 * 0.7 * 0.5 + 0.3), 10);
  });

  it('setCutoff keeps state continuous', () => {
    const f = new Lowpass('PT2', 100, 1 / FS);
    for (let i = 0; i < 400; i++) f.apply(1);
    const before = f.apply(1);
    f.setCutoff(300);
    const after = f.apply(1);
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after - before).toBeLessThan(0.1);
  });
});
