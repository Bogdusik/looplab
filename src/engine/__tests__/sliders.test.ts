import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from '../presets.ts';
import { SIMPLIFIED_DEFAULTS, simplifiedFilters, simplifiedPids, type SimplifiedTuning } from '../sliders.ts';

/**
 * Slider positions → gains.
 * Source: src/main/config/simplified_tuning.c calculateNewPidValues() / calculateNew*FilterValues()
 * with defaults from flight/pid.h (PID_ROLL_DEFAULT {45,80,30,F120}, PID_PITCH_DEFAULT {47,84,34,F125},
 * D_MAX_DEFAULT {40,46}) and sensors/gyro.h / flight/pid.h filter defaults, betaflight@f97bdbc.
 * Expected numbers are worked by hand: product in float32, then truncation by the integer constrain().
 */
const s = (patch: Partial<SimplifiedTuning>): SimplifiedTuning => ({ ...SIMPLIFIED_DEFAULTS, ...patch });

describe('simplified tuning sliders', () => {
  const cases: [
    string,
    Partial<SimplifiedTuning>,
    [number, number, number, number, number],
    [number, number, number, number, number],
  ][] = [
    ['all sliders 1.00 → Betaflight defaults', {}, [45, 80, 30, 120, 40], [47, 84, 34, 125, 46]],
    ['master 1.20', { master: 120 }, [54, 96, 36, 144, 48], [56, 100, 40, 150, 55]],
    ['damping 0.60', { dGain: 60 }, [45, 80, 18, 120, 24], [47, 84, 20, 125, 27]],
    ['dynamic damping 0 → D-max = D', { dMaxGain: 0 }, [45, 80, 30, 120, 30], [47, 84, 34, 125, 34]],
    ['stick response 0 → FF off', { ffGain: 0 }, [45, 80, 30, 0, 40], [47, 84, 34, 0, 46]],
    ['stick response 1.50', { ffGain: 150 }, [45, 80, 30, 180, 40], [47, 84, 34, 187, 46]],
    ['tracking 1.40', { piGain: 140 }, [63, 112, 30, 120, 40], [65, 117, 34, 125, 46]],
    ['drift-wobble 0.50', { iGain: 50 }, [45, 40, 30, 120, 40], [47, 42, 34, 125, 46]],
    ['pitch damping 1.20 (pitch only)', { pitchDGain: 120 }, [45, 80, 30, 120, 40], [47, 84, 40, 125, 55]],
    [
      'master 0.90 + pitch tracking 1.10',
      { master: 90, pitchPiGain: 110 },
      [40, 72, 27, 108, 36],
      [46, 83, 30, 123, 41],
    ],
  ];

  it.each(cases)('%s', (_name, patch, roll, pitch) => {
    const r = simplifiedPids(s(patch), 'roll');
    const p = simplifiedPids(s(patch), 'pitch');
    expect([r.p, r.i, r.d, r.f, r.dMax]).toEqual(roll);
    expect([p.p, p.i, p.d, p.f, p.dMax]).toEqual(pitch);
  });

  it('gains clamp at PID_GAIN_MAX (250)', () => {
    const r = simplifiedPids(s({ master: 200, piGain: 200, iGain: 200 }), 'roll');
    expect(r.p).toBe(180);
    expect(r.i).toBe(250);
  });

  it('filter multipliers use integer arithmetic (DEFAULT × mult / 100)', () => {
    const f = simplifiedFilters(s({ gyroFilter: 150, dtermFilter: 80 }), DEFAULT_FILTERS);
    expect([f.gyroLpf1.minHz, f.gyroLpf1.maxHz, f.gyroLpf2.staticHz]).toEqual([375, 750, 750]);
    expect([f.dtermLpf1.minHz, f.dtermLpf1.maxHz, f.dtermLpf2.staticHz]).toEqual([60, 120, 120]);
    const g = simplifiedFilters(s({ gyroFilter: 33 }), DEFAULT_FILTERS);
    expect([g.gyroLpf1.minHz, g.gyroLpf1.maxHz, g.gyroLpf2.staticHz]).toEqual([82, 165, 165]);
  });

  it('disabled filters are left alone', () => {
    const base = structuredClone(DEFAULT_FILTERS);
    base.gyroLpf2.enabled = false;
    base.gyroLpf2.staticHz = 0;
    expect(simplifiedFilters(s({ gyroFilter: 150 }), base).gyroLpf2.staticHz).toBe(0);
  });
});
