import { describe, expect, it } from 'vitest';
import { emaAlpha, FixedStepClock } from '../clock.ts';
import { stepMetrics } from '../metrics.ts';
import { Prng } from '../prng.ts';
import { Ring } from '../ring.ts';
import { fft, findPeaks, toDb, welch } from '../spectrum.ts';
import { bisect } from './helpers.ts';

describe('PRNG', () => {
  it('is deterministic per seed and roughly uniform / normal', () => {
    const a = new Prng(42);
    const b = new Prng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
    const g = new Prng(7);
    let m = 0;
    let v = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) {
      const x = g.gauss();
      m += x;
      v += x * x;
    }
    expect(Math.abs(m / n)).toBeLessThan(0.02);
    expect(Math.abs(v / n - 1)).toBeLessThan(0.03);
  });
});

describe('FixedStepClock', () => {
  it('converts any frame partition into the same total step count', () => {
    const h = 1 / 8000;
    for (const fps of [60, 144, 240]) {
      const c = new FixedStepClock(h);
      let steps = 0;
      for (let i = 0; i < fps * 2; i++) steps += c.advance(1 / fps);
      expect(Math.abs(steps - 16000)).toBeLessThanOrEqual(1);
    }
  });
  it('emaAlpha is time-constant based', () => {
    expect(emaAlpha(0.001, 0.1)).toBeCloseTo(1 - Math.exp(-0.01), 12);
  });
});

describe('Ring', () => {
  it('keeps the newest values in order', () => {
    const r = new Ring(4);
    for (let i = 1; i <= 6; i++) r.push(i);
    expect(Array.from(r.toArray())).toEqual([3, 4, 5, 6]);
    expect(r.latest()).toBe(6);
  });
});

describe('FFT / Welch', () => {
  it('FFT of a pure tone lands in the right bin', () => {
    const n = 256;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 10 * i) / n);
    fft(re, im);
    expect(re[10]).toBeCloseTo(n / 2, 6);
    expect(Math.abs(re[11]!)).toBeLessThan(1e-9);
  });

  it('Welch white-noise level equals 2σ²/fs and finds tone frequency', () => {
    const fs = 8000;
    const g = new Prng(1);
    const x = new Float64Array(fs * 8);
    for (let i = 0; i < x.length; i++) x[i] = g.gauss() + 3 * Math.sin((2 * Math.PI * 187.3 * i) / fs);
    const p = welch(x, fs, 2048);
    const mid = Array.from(p.psd.slice(400, 800));
    const avg = mid.reduce((a, b) => a + b, 0) / mid.length;
    expect(Math.abs(toDb(avg) - toDb(2 / fs))).toBeLessThan(0.5);
    const pk = findPeaks(p, 50, 1000)[0]!;
    expect(Math.abs(pk.f - 187.3)).toBeLessThan(1.5);
  });
});

describe('Spec test 7 — metrics on an analytic 2nd-order system', () => {
  it.each([0.3, 0.5, 0.7, 0.9])('ζ = %s', (zeta) => {
    const wn = 2 * Math.PI * 20;
    const wd = wn * Math.sqrt(1 - zeta * zeta);
    const y = (t: number) =>
      t < 0
        ? 0
        : 1 -
          Math.exp(-zeta * wn * t) *
            (Math.cos(wd * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t));
    const fs = 8000;
    const t0 = 0.05;
    const n = Math.round(0.6 * fs);
    const ts = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      ts[i] = i / fs;
      ys[i] = 200 * y(ts[i]! - t0);
    }
    const m = stepMetrics(ts, ys, t0, 200);
    const exactLatency = bisect((t) => y(t) - 0.5, 0, Math.PI / wd);
    const exactOvershoot = 100 * Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
    expect(Math.abs(m.latency50 - exactLatency)).toBeLessThan(1e-5);
    expect(Math.abs(m.overshootPct - exactOvershoot)).toBeLessThan(0.05);
    expect(Math.abs(m.steadyStateError)).toBeLessThan(0.5);
  });
});
