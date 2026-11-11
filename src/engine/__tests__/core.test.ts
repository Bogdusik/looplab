import { describe, expect, it } from 'vitest';
import { emaAlpha, FixedStepClock } from '../clock.ts';
import { stepMetrics } from '../metrics.ts';
import { Prng } from '../prng.ts';
import { Ring } from '../ring.ts';
import { BlackboxDecimator } from '../blackbox.ts';
import { fft, findPeaks, singleFftPsd, toDb, welch, whiteNoiseLevel } from '../spectrum.ts';
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

  const bandMeanDb = (p: { f: Float64Array; psd: Float64Array }, a: number, b: number) => {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < p.f.length; k++)
      if (p.f[k]! >= a && p.f[k]! <= b) {
        sum += p.psd[k]!;
        n++;
      }
    return toDb(sum / n);
  };

  it('PIDtoolbox (PSSpec2d) scaling: white-noise floor = 10·log10(2·σ²·3/8 / fs), Welch and single FFT agree', () => {
    for (const fs of [1600, 2000, 4000]) {
      const sigma = 1.7;
      const g = new Prng(fs);
      const x = new Float64Array(fs * 40);
      for (let i = 0; i < x.length; i++) x[i] = sigma * g.gauss();
      const expected = toDb(whiteNoiseLevel(sigma * sigma, fs));
      const w = welch(x, fs, 1024);
      const one = singleFftPsd(x, fs);
      expect(Math.abs(bandMeanDb(w, 20, fs * 0.45) - expected)).toBeLessThan(0.2);
      expect(Math.abs(bandMeanDb(one, 20, fs * 0.45) - expected)).toBeLessThan(0.2);
    }
  });

  it('pwelch-style density reads 10·log10(8/3) ≈ 4.26 dB higher than the PIDtoolbox convention', () => {
    const g = new Prng(3);
    const x = new Float64Array(16384);
    for (let i = 0; i < x.length; i++) x[i] = g.gauss();
    const a = welch(x, 2000, 1024, 'pidtoolbox');
    const b = welch(x, 2000, 1024, 'density');
    for (const k of [10, 100, 300]) expect(toDb(b.psd[k]!) - toDb(a.psd[k]!)).toBeCloseTo(4.2597, 3);
  });

  it('finds a tone frequency', () => {
    const fs = 8000;
    const g = new Prng(1);
    const x = new Float64Array(fs * 8);
    for (let i = 0; i < x.length; i++) x[i] = g.gauss() + 3 * Math.sin((2 * Math.PI * 187.3 * i) / fs);
    const pk = findPeaks(welch(x, fs, 2048), 50, 1000)[0]!;
    expect(Math.abs(pk.f - 187.3)).toBeLessThan(1.5);
  });
});

describe('Blackbox decimation', () => {
  it('2 kHz from 8 kHz logs exactly every 4th sample; 3.2 kHz averages the right rate', () => {
    const d = new BlackboxDecimator(8000, 2000);
    const picked: number[] = [];
    for (let i = 0; i < 40; i++) if (d.tick()) picked.push(i);
    expect(picked).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36]);
    expect(d.exact).toBe(true);
    const e = new BlackboxDecimator(8000, 3200);
    let n = 0;
    for (let i = 0; i < 80_000; i++) if (e.tick()) n++;
    expect(n).toBe(32_000);
    expect(e.exact).toBe(false);
  });
});

describe('metrics on an analytic 2nd-order system', () => {
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
