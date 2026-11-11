import { Prng } from './prng.ts';
import type { NoiseParams } from './types.ts';

const TWO_PI = 2 * Math.PI;
const HARMONICS = 3;

/**
 * Gyro noise model (deg/s), sampled at the gyro rate:
 *  (a) per-motor sinusoids at the rotation frequency and its 2nd/3rd harmonics, amplitude ∝ (Ω/Ω_hover)²
 *      × balance, with a slow random-walk frequency jitter;
 *  (b) broadband white noise ("electrical");
 *  (c) an optional frame resonance: a lightly damped 2nd-order resonator driven by white noise.
 *      It sits at a fixed frequency, so the RPM filter cannot follow it.
 */
export class GyroNoise {
  private readonly p: NoiseParams;
  private readonly h: number;
  private readonly omegaHover: number;
  private readonly rng: Prng;
  private readonly phase = new Float64Array(4 * HARMONICS);
  private readonly sign = new Float64Array(4 * HARMONICS);
  private readonly jit = new Float64Array(4);
  private readonly jitAlpha: number;
  private readonly jitSigma: number;
  // frame resonator state
  private rx = 0;
  private rv = 0;
  private readonly rScale: number;

  constructor(p: NoiseParams, h: number, omegaHover: number, seed: number) {
    this.p = p;
    this.h = h;
    this.omegaHover = omegaHover;
    this.rng = new Prng(seed);
    for (let i = 0; i < this.phase.length; i++) {
      this.phase[i] = this.rng.next() * TWO_PI;
      this.sign[i] = this.rng.next() < 0.5 ? -1 : 1;
    }
    // Ornstein–Uhlenbeck jitter with ~0.2 s correlation time; stationary std = p.jitter
    const tau = 0.2;
    this.jitAlpha = h / tau;
    this.jitSigma = p.jitter * Math.sqrt(2 * this.jitAlpha);
    this.rScale = p.frameDps > 0 ? p.frameDps / GyroNoise.resonatorRms(p, h, seed ^ 0x5eed) : 0;
  }

  /** RMS of the unit-driven resonator, measured once with an independent stream (deterministic). */
  private static resonatorRms(p: NoiseParams, h: number, seed: number): number {
    const rng = new Prng(seed);
    const w = TWO_PI * p.frameHz;
    let x = 0;
    let v = 0;
    let acc = 0;
    const n = Math.round(4 / h);
    for (let i = 0; i < n; i++) {
      v += (-(w / p.frameQ) * v - w * w * x + w * w * rng.gauss()) * h;
      x += v * h;
      if (i > n / 4) acc += x * x;
    }
    return Math.sqrt(acc / (n - n / 4)) || 1;
  }

  /** One gyro sample of noise given current motor speeds (rad/s). */
  sample(omega: ArrayLike<number>): number {
    const p = this.p;
    let n = 0;
    for (let m = 0; m < 4; m++) {
      this.jit[m] = this.jit[m]! * (1 - this.jitAlpha) + this.jitSigma * this.rng.gauss();
      const wm = omega[m]!;
      const rel = wm / this.omegaHover;
      const ampScale = p.balance * rel * rel;
      const dphi = wm * (1 + this.jit[m]!) * this.h;
      for (let k = 0; k < HARMONICS; k++) {
        const idx = m * HARMONICS + k;
        let ph = this.phase[idx]! + dphi * (k + 1);
        if (ph > TWO_PI) ph -= TWO_PI * Math.floor(ph / TWO_PI);
        this.phase[idx] = ph;
        n += this.sign[idx]! * p.harmonicDps[k]! * ampScale * Math.sin(ph);
      }
    }
    if (p.electricalDps > 0) n += p.electricalDps * this.rng.gauss();
    if (this.rScale > 0) {
      const w = TWO_PI * p.frameHz;
      this.rv += (-(w / p.frameQ) * this.rv - w * w * this.rx + w * w * this.rng.gauss()) * this.h;
      this.rx += this.rv * this.h;
      n += this.rScale * this.rx;
    }
    return n;
  }
}
