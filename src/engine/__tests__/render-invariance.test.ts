import { describe, expect, it } from 'vitest';
import { BfSim } from '../bfsim.ts';
import { CLASSIC_DEFAULTS, ClassicSim, LegacyClassicSim } from '../classic.ts';
import { defaultBfParams } from '../presets.ts';
import { Runner } from '../runner.ts';

/** Scripted stick as a function of sim time: rest, flick, hold, sine sweep. */
const script = (t: number) =>
  t < 0.1 ? 0 : t < 0.3 ? 0.6 : t < 0.5 ? -0.2 : 0.4 * Math.sin(2 * Math.PI * 3 * t);

function runBf(fps: number, seconds: number) {
  const sim = new BfSim(defaultBfParams());
  const runner = new Runner(sim);
  const rows: number[] = [];
  while (runner.simTime < seconds) {
    runner.frame(
      1 / fps,
      (i) => sim.setStick(script(i * sim.h)),
      (s) => rows.push(s.out.gyroRaw, s.out.gyroFilt, s.out.sum, s.out.motorL, s.out.tempR),
    );
  }
  return rows;
}

function runClassic(fps: number, seconds: number) {
  const sim = new ClassicSim(CLASSIC_DEFAULTS);
  const runner = new Runner(sim);
  const rows: number[] = [];
  while (runner.simTime < seconds) {
    runner.frame(
      1 / fps,
      (i) => sim.setHandle(60 * script(i * sim.h)),
      (s) => rows.push(s.out.pos, s.out.force, s.out.heat),
    );
  }
  return rows;
}

function expectIdenticalPrefix(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  expect(n).toBeGreaterThan(1000);
  let maxDiff = 0;
  for (let i = 0; i < n; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i]! - b[i]!));
  expect(maxDiff).toBe(0);
}

describe('render-rate invariance', () => {
  it('Betaflight mode: 60 / 144 / 240 Hz frames give bitwise-identical outputs', () => {
    const a = runBf(60, 1);
    const b = runBf(144, 1);
    const c = runBf(240, 1);
    expectIdenticalPrefix(a, b);
    expectIdenticalPrefix(a, c);
  });

  it('Classic mode: 60 / 144 / 240 Hz frames give bitwise-identical outputs', () => {
    const a = runClassic(60, 3);
    expectIdenticalPrefix(a, runClassic(144, 3));
    expectIdenticalPrefix(a, runClassic(240, 3));
  });

  it('the legacy frame-stepped model is NOT invariant (reproduces the original issue)', () => {
    const heat = (fps: number) => {
      const s = new LegacyClassicSim(CLASSIC_DEFAULTS);
      for (let i = 0; i < fps * 5; i++) s.frame(1 / fps);
      return s.heat;
    };
    const h60 = heat(60);
    const h240 = heat(240);
    expect(h240 / h60).toBeGreaterThan(3);
  });
});
