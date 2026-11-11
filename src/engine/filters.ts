/**
 * Filter library ported from Betaflight `src/main/common/filter.c` (betaflight@f97bdbc).
 *
 * Betaflight master no longer has a biquad: 2nd-order lowpass and notch filters are
 * TPT ("topology-preserving transform") state-variable filters (SVF). A TPT SVF is exactly the
 * bilinear transform with frequency prewarping, which is what the analytic responses below use.
 *
 * JS runs in float64; Betaflight runs in float32 and uses `sincosf_approx`. Differences are far
 * below anything visible in this simulator.
 */

/** PTn cutoff correction = 1 / sqrt(2^(1/n) − 1). filter.c: CUTOFF_CORRECTION_PT2/PT3. */
export const CUTOFF_CORRECTION_PT2 = 1.553773974;
export const CUTOFF_CORRECTION_PT3 = 1.961459177;

/** filter.c pt1FilterGain(). */
export function pt1FilterGain(fCut: number, dT: number): number {
  const omega = 2 * Math.PI * fCut * dT;
  return omega / (omega + 1);
}

/** filter.c pt1FilterGainFromDelay(). */
export function pt1FilterGainFromDelay(delay: number, dT: number): number {
  return delay <= 0 ? 1 : dT / (dT + delay);
}

export const pt2FilterGain = (fCut: number, dT: number) => pt1FilterGain(fCut * CUTOFF_CORRECTION_PT2, dT);
export const pt3FilterGain = (fCut: number, dT: number) => pt1FilterGain(fCut * CUTOFF_CORRECTION_PT3, dT);

export interface Filter {
  apply(x: number): number;
  reset(): void;
}

/** filter.c pt1FilterApply(). */
export class Pt1 implements Filter {
  k: number;
  state = 0;
  constructor(k: number) {
    this.k = k;
  }
  apply(x: number): number {
    this.state += this.k * (x - this.state);
    return this.state;
  }
  reset(v = 0): void {
    this.state = v;
  }
}

/** filter.c pt2FilterApply(). */
export class Pt2 implements Filter {
  k: number;
  s1 = 0;
  state = 0;
  constructor(k: number) {
    this.k = k;
  }
  apply(x: number): number {
    this.s1 += this.k * (x - this.s1);
    this.state += this.k * (this.s1 - this.state);
    return this.state;
  }
  reset(v = 0): void {
    this.s1 = this.state = v;
  }
}

/** filter.c pt3FilterApply(). */
export class Pt3 implements Filter {
  k: number;
  s1 = 0;
  s2 = 0;
  state = 0;
  constructor(k: number) {
    this.k = k;
  }
  apply(x: number): number {
    this.s1 += this.k * (x - this.s1);
    this.s2 += this.k * (this.s1 - this.s2);
    this.state += this.k * (this.s2 - this.state);
    return this.state;
  }
  reset(v = 0): void {
    this.s1 = this.s2 = this.state = v;
  }
}

/** filter.c svfLowpassFilterUpdate()/svfLowpassFilterApply(): Butterworth (Q = 1/√2) TPT SVF. */
export class SvfLowpass implements Filter {
  private a1 = 0;
  private a2 = 0;
  private f = 0;
  private ic1 = 0;
  private ic2 = 0;
  constructor(fc: number, dt: number) {
    this.update(fc, dt);
  }
  update(fc: number, dt: number): void {
    const invButterworthQ = Math.SQRT2;
    const f = Math.tan(Math.PI * fc * dt);
    const invDenom = 1 / (1 + f * (f + invButterworthQ));
    this.a1 = invDenom;
    this.a2 = f * invDenom;
    this.f = f;
  }
  apply(x: number): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.f * v1;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return v2;
  }
  reset(v = 0): void {
    this.ic1 = 0;
    this.ic2 = v;
  }
}

/**
 * Weighted SVF notch: filter.c rpmNotchUpdate()/rpmNotchApply() (weight = 1 gives svfNotchApply()).
 * H(S) = (S² + (1−w)S/Q + 1) / (S² + S/Q + 1).
 */
export class SvfNotch implements Filter {
  private a1 = 0;
  private a2 = 0;
  private f = 0;
  private wq = 0;
  private ic1 = 0;
  private ic2 = 0;
  constructor(fc: number, dt: number, q: number, weight = 1) {
    this.update(fc, dt, q, weight);
  }
  update(fc: number, dt: number, q: number, weight = 1): void {
    const f = Math.tan(Math.PI * fc * dt);
    const qi = 1 / q;
    const a1 = 1 / (1 + f * (f + qi));
    this.f = f;
    this.a1 = a1;
    this.a2 = f * a1;
    this.wq = qi * weight;
  }
  apply(x: number): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.f * v1;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return x - this.wq * v1;
  }
  reset(): void {
    this.ic1 = this.ic2 = 0;
  }
}

/** Betaflight lowpass types (filter.h lowpassFilterType_e, minus the removed biquad). */
export type LpfType = 'PT1' | 'PT2' | 'PT3' | 'SVF';

export class Lowpass implements Filter {
  readonly type: LpfType;
  private impl: Pt1 | Pt2 | Pt3 | SvfLowpass;
  private dt: number;
  fc: number;
  constructor(type: LpfType, fc: number, dt: number) {
    this.type = type;
    this.dt = dt;
    this.fc = fc;
    this.impl = Lowpass.make(type, fc, dt);
  }
  private static make(type: LpfType, fc: number, dt: number) {
    switch (type) {
      case 'PT1':
        return new Pt1(pt1FilterGain(fc, dt));
      case 'PT2':
        return new Pt2(pt2FilterGain(fc, dt));
      case 'PT3':
        return new Pt3(pt3FilterGain(fc, dt));
      case 'SVF':
        // gyro.c dynLpfGyroUpdate(): constrain SVF cutoff below Nyquist
        return new SvfLowpass(Math.min(fc, 0.475 / dt), dt);
    }
  }
  /** Same as Betaflight *UpdateCutoff: keeps state, changes coefficients. */
  setCutoff(fc: number): void {
    this.fc = fc;
    const i = this.impl;
    if (i instanceof Pt1) i.k = pt1FilterGain(fc, this.dt);
    else if (i instanceof Pt2) i.k = pt2FilterGain(fc, this.dt);
    else if (i instanceof Pt3) i.k = pt3FilterGain(fc, this.dt);
    else i.update(Math.min(fc, 0.475 / this.dt), this.dt);
  }
  apply(x: number): number {
    return this.impl.apply(x);
  }
  reset(v = 0): void {
    this.impl.reset(v);
  }
}

/** pid.c dynLpfCutoffFreq(): throttle-dependent cutoff with expo curve (expo in 0..10). */
export function dynLpfCutoffFreq(throttle: number, minHz: number, maxHz: number, expo: number): number {
  const expof = expo / 10;
  const curve = throttle * (1 - throttle) * expof + throttle;
  return (maxHz - minHz) * curve + minHz;
}

// ---------------------------------------------------------------------------------------------
// Analytic frequency response (for Bode / group delay readouts and tests)
// ---------------------------------------------------------------------------------------------

export type FilterSpec =
  | { kind: 'lpf'; type: LpfType; fc: number; fs: number }
  | { kind: 'notch'; fc: number; q: number; weight: number; fs: number }
  | { kind: 'delay'; seconds: number };

export interface Complex {
  re: number;
  im: number;
}

const cmul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
const cdiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};

/** H(e^{jωT}) of one-pole y += k(x − y): k / (1 − (1−k) z⁻¹). */
function pt1Response(k: number, w: number): Complex {
  return cdiv({ re: k, im: 0 }, { re: 1 - (1 - k) * Math.cos(w), im: (1 - k) * Math.sin(w) });
}

/** Bilinear-transform S for prewarped cutoff: S = (1/f)·(1 − z⁻¹)/(1 + z⁻¹). */
function bilinearS(fc: number, fs: number, w: number): Complex {
  const f = Math.tan((Math.PI * fc) / fs);
  const zinv: Complex = { re: Math.cos(w), im: -Math.sin(w) };
  const num: Complex = { re: 1 - zinv.re, im: -zinv.im };
  const den: Complex = { re: 1 + zinv.re, im: zinv.im };
  const s = cdiv(num, den);
  return { re: s.re / f, im: s.im / f };
}

/** Complex frequency response of one filter at frequency `hz`. */
export function filterResponse(spec: FilterSpec, hz: number): Complex {
  if (spec.kind === 'delay') {
    const ph = -2 * Math.PI * hz * spec.seconds;
    return { re: Math.cos(ph), im: Math.sin(ph) };
  }
  const w = (2 * Math.PI * hz) / spec.fs;
  if (spec.kind === 'lpf') {
    const dT = 1 / spec.fs;
    switch (spec.type) {
      case 'PT1':
        return pt1Response(pt1FilterGain(spec.fc, dT), w);
      case 'PT2': {
        const h = pt1Response(pt2FilterGain(spec.fc, dT), w);
        return cmul(h, h);
      }
      case 'PT3': {
        const h = pt1Response(pt3FilterGain(spec.fc, dT), w);
        return cmul(cmul(h, h), h);
      }
      case 'SVF': {
        const fc = Math.min(spec.fc, 0.475 * spec.fs);
        const s = bilinearS(fc, spec.fs, w);
        const s2 = cmul(s, s);
        return cdiv({ re: 1, im: 0 }, { re: s2.re + Math.SQRT2 * s.re + 1, im: s2.im + Math.SQRT2 * s.im });
      }
    }
  }
  const s = bilinearS(spec.fc, spec.fs, w);
  const s2 = cmul(s, s);
  const qi = 1 / spec.q;
  const num = { re: s2.re + (1 - spec.weight) * qi * s.re + 1, im: s2.im + (1 - spec.weight) * qi * s.im };
  const den = { re: s2.re + qi * s.re + 1, im: s2.im + qi * s.im };
  return cdiv(num, den);
}

/** Response of a cascade. */
export function chainResponse(chain: readonly FilterSpec[], hz: number): Complex {
  let h: Complex = { re: 1, im: 0 };
  for (const s of chain) h = cmul(h, filterResponse(s, hz));
  return h;
}

export const magnitude = (h: Complex) => Math.hypot(h.re, h.im);
export const magnitudeDb = (h: Complex) => 20 * Math.log10(Math.max(magnitude(h), 1e-12));

/**
 * Group delay τ_g = −dφ/dω (seconds) of a cascade at `hz`, by central difference of the
 * analytic phase. Uses the ratio H(f+δ)/H(f−δ) so no phase unwrapping is needed.
 */
export function groupDelay(chain: readonly FilterSpec[], hz: number): number {
  const d = Math.max(hz * 1e-4, 1e-3);
  const a = chainResponse(chain, hz + d);
  const b = chainResponse(chain, Math.max(hz - d, 0));
  const r = cdiv(a, b);
  const dphi = Math.atan2(r.im, r.re);
  const dw = 2 * Math.PI * (hz + d - Math.max(hz - d, 0));
  return -dphi / dw;
}

/** Phase delay −φ/ω (seconds): what a sinusoid at `hz` is actually shifted by. */
export function phaseDelay(chain: readonly FilterSpec[], hz: number): number {
  let phi = 0;
  for (const s of chain) {
    const h = filterResponse(s, hz);
    phi += Math.atan2(h.im, h.re);
  }
  return -phi / (2 * Math.PI * hz);
}
