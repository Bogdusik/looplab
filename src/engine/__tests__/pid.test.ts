import { describe, expect, it } from 'vitest';
import { BfSim } from '../bfsim.ts';
import { BfPid, DTERM_SCALE, FEEDFORWARD_SCALE, ITERM_SCALE, PTERM_SCALE } from '../pid.ts';
import { DEFAULT_FILTERS, DEFAULT_PID, defaultBfParams } from '../presets.ts';
import { DEFAULT_STEP_OPTIONS, idealStepResponse } from '../stepResponse.ts';

const DT = 1 / 8000;

describe('Spec test 4 — PID', () => {
  it('uses the Betaflight pid.h scale factors', () => {
    const pid = new BfPid(DEFAULT_PID, DEFAULT_FILTERS.dtermLpf1, DEFAULT_FILTERS.dtermLpf2, 0.3, DT);
    expect(pid.kp).toBeCloseTo(PTERM_SCALE * 45, 12);
    expect(pid.ki).toBeCloseTo(ITERM_SCALE * 80, 12);
    expect(pid.kd).toBeCloseTo(DTERM_SCALE * 30, 12);
    expect(pid.kf).toBeCloseTo(FEEDFORWARD_SCALE * 1.2, 12);
    expect(pid.itermLimit).toBe(400);
  });

  it('D is on measurement: a setpoint step with constant gyro gives zero D', () => {
    const pid = new BfPid(DEFAULT_PID, DEFAULT_FILTERS.dtermLpf1, DEFAULT_FILTERS.dtermLpf2, 0.3, DT);
    pid.prime(0);
    for (let i = 0; i < 100; i++) pid.update(0, 0, 0);
    const t = pid.update(500, 0, 0);
    expect(Math.abs(t.d)).toBe(0);
    expect(t.p).toBeGreaterThan(0);
  });

  it('D kick is absent in the closed loop too: at the step instant D is ~0, P jumps', () => {
    const p = defaultBfParams();
    p.noiseEnabled = false;
    p.rc.smoothing = false;
    p.pid.gains.f = 0;
    const sim = new BfSim(p);
    sim.run(800);
    const dBefore = Math.abs(sim.out.d);
    sim.alignPacket();
    sim.setStick(0.5);
    sim.step();
    expect(Math.abs(sim.out.p)).toBeGreaterThan(50);
    expect(Math.abs(sim.out.d)).toBeLessThan(dBefore + 1e-6);
  });

  it('I windup is bounded by iterm_windup × pidsum_limit', () => {
    const pid = new BfPid(DEFAULT_PID, DEFAULT_FILTERS.dtermLpf1, DEFAULT_FILTERS.dtermLpf2, 0.3, DT);
    pid.prime(0);
    for (let i = 0; i < 80_000; i++) pid.update(800, 0, 0);
    expect(pid.iterm).toBeCloseTo(400, 9);
    for (let i = 0; i < 160_000; i++) pid.update(-800, 0, 0);
    expect(pid.iterm).toBeCloseTo(-400, 9);
  });

  it('iterm_relax freezes I accumulation during a fast setpoint change', () => {
    const run = (relax: boolean) => {
      const pid = new BfPid(
        { ...DEFAULT_PID, itermRelax: relax },
        DEFAULT_FILTERS.dtermLpf1,
        DEFAULT_FILTERS.dtermLpf2,
        0.3,
        DT,
      );
      pid.prime(0);
      for (let i = 0; i < 80; i++) pid.update(400, 0, 0); // 10 ms right after a 400 deg/s step
      return pid.iterm;
    };
    expect(Math.abs(run(true))).toBeLessThan(0.05 * Math.abs(run(false)));
  });

  it('iterm_relax reduces overshoot after a fast stick move (vs off)', () => {
    const base = defaultBfParams();
    const opts = { ...DEFAULT_STEP_OPTIONS, amplitude: 600, durationS: 0.4 };
    const on = idealStepResponse(base, opts).metrics.overshootPct;
    const off = idealStepResponse({ ...base, pid: { ...base.pid, itermRelax: false } }, opts).metrics
      .overshootPct;
    expect(on).toBeLessThan(off);
  });
});
