import { describe, expect, it } from 'vitest';
import { DEFAULT_RATES, DEFAULT_RC, RATE_PRESETS } from '../presets.ts';
import { actualRate, stickForRate } from '../rates.ts';
import { ffSmoothingTau, quantiseStick, RcAxis, rcSmoothingCutoffHz } from '../rc.ts';

describe('ACTUAL rates (rc.c applyActualRates)', () => {
  it('Betaflight default 70 / 670 / 0: centre slope 70, full stick 670', () => {
    expect(actualRate(1, DEFAULT_RATES)).toBeCloseTo(670, 9);
    expect(actualRate(-1, DEFAULT_RATES)).toBeCloseTo(-670, 9);
    expect(actualRate(1e-4, DEFAULT_RATES) / 1e-4).toBeCloseTo(70, 0);
    expect(actualRate(0.5, DEFAULT_RATES)).toBeCloseTo(0.5 * 70 + 600 * 0.25, 9);
  });
  it('expo flattens the middle', () => {
    const mine = RATE_PRESETS.smoothFreestyle!.rates;
    expect(actualRate(1, mine)).toBeCloseTo(670, 9);
    expect(actualRate(0.5, mine)).toBeLessThan(actualRate(0.5, { ...mine, expo: 0 }));
  });
  it('linear tuning rates are a straight line', () => {
    const lin = RATE_PRESETS.linear!.rates;
    for (const x of [0.1, 0.5, 0.9]) expect(actualRate(x, lin)).toBeCloseTo(400 * x, 9);
  });
  it('stickForRate inverts actualRate', () => {
    for (const r of [-500, -30, 5, 200, 669])
      expect(actualRate(stickForRate(r, DEFAULT_RATES), DEFAULT_RATES)).toBeCloseTo(r, 6);
  });
});

describe('RC smoothing and feedforward (rc.c)', () => {
  it('auto cutoff = max(15, rate × 1.5 / (1 + factor/10))', () => {
    expect(rcSmoothingCutoffHz(250, 30)).toBeCloseTo(93.75, 9);
    expect(rcSmoothingCutoffHz(50, 30)).toBe(18.75);
    expect(rcSmoothingCutoffHz(50, 100)).toBe(15);
  });
  it('feedforward smoothing tau is normalised to a 250 Hz link', () => {
    expect(ffSmoothingTau(65)).toBeCloseTo((0.004 * 0.65) / 0.35, 12);
  });
  it('quantises sticks to 1 µs', () => {
    expect(quantiseStick(0.1234)).toBeCloseTo(0.124, 12);
    expect(quantiseStick(3)).toBe(1);
  });
  it('a stick ramp produces positive FF that decays to zero when the stick stops', () => {
    const rc = new RcAxis(DEFAULT_RATES, DEFAULT_RC, 1 / 8000);
    let maxFf = 0;
    for (let k = 0; k < 50; k++) {
      rc.onPacket(quantiseStick(k * 0.01));
      for (let i = 0; i < 32; i++) rc.tick();
      maxFf = Math.max(maxFf, rc.feedforward);
    }
    expect(maxFf).toBeGreaterThan(100);
    for (let k = 0; k < 100; k++) {
      rc.onPacket(quantiseStick(0.49));
      for (let i = 0; i < 32; i++) rc.tick();
    }
    expect(Math.abs(rc.feedforward)).toBeLessThan(1);
    expect(rc.setpoint).toBeCloseTo(actualRate(0.49, DEFAULT_RATES), 1);
  });
  it('without smoothing the setpoint is the raw packet setpoint', () => {
    const rc = new RcAxis(DEFAULT_RATES, { ...DEFAULT_RC, smoothing: false }, 1 / 8000);
    rc.onPacket(0.5);
    rc.tick();
    expect(rc.setpoint).toBe(actualRate(0.5, DEFAULT_RATES));
  });
});

describe('Drone presets', () => {
  it('are keyed by their id (the UI and share links select presets by id)', async () => {
    const { DRONE_PRESETS, defaultBfParams } = await import('../presets.ts');
    for (const [key, d] of Object.entries(DRONE_PRESETS)) {
      expect(d.id).toBe(key);
      expect(defaultBfParams(d.id).drone.id).toBe(d.id);
    }
  });
});
