/**
 * Seeded PRNG: mulberry32 (public domain, Tommy Ettinger) + Box–Muller Gaussian.
 * All engine randomness must come from here so that runs are bitwise reproducible.
 */
export class Prng {
  private s: number;
  private spare = 0;
  private hasSpare = false;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1;
  }

  /** Standard normal N(0, 1). */
  gauss(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    let u = 0;
    while (u <= 1e-300) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    const a = 2 * Math.PI * v;
    this.spare = r * Math.sin(a);
    this.hasSpare = true;
    return r * Math.cos(a);
  }

  /** Derive an independent child stream (stable across runs). */
  fork(salt: number): Prng {
    return new Prng((Math.imul(this.s ^ salt, 0x9e3779b1) + salt) | 0);
  }
}
