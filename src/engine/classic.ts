import { emaAlpha } from './clock.ts';
import { Pt1, pt1FilterGain } from './filters.ts';
import { stepMetrics, type StepMetrics } from './metrics.ts';
import { Prng } from './prng.ts';

/**
 * Classic mode: the "drag a handle, watch a follower" toy model popularised by Joshua Bardwell's
 * PID Controller Simulator — reimplemented from its *idea* (no code reused), with three fixes:
 *  1. fixed physics step (frame-rate independent),
 *  2. a delay line that always applies exactly the configured delay,
 *  3. sensor noise on the measurement used by every term (P, I and D), not only D.
 * Units are arbitrary "track units" (handle range ±100).
 */
export interface ClassicParams {
  kp: number;
  ki: number;
  kd: number;
  kff: number;
  mass: number;
  drag: number;
  delayMs: number;
  /** Measurement noise, track units RMS. */
  noise: number;
  /** Constant offset force/mass ("CG offset"), units/s². */
  cg: number;
  seed: number;
}

export const CLASSIC_DEFAULTS: ClassicParams = {
  kp: 7.9,
  ki: 1.75,
  kd: 3.8,
  kff: 1.0,
  mass: 1,
  drag: 0.1,
  delayMs: 15,
  noise: 0.05,
  cg: 0,
  seed: 1,
};

/** Fixed physics step for Classic mode. */
export const CLASSIC_H = 0.001;
/** The original smooths the handle with α = 0.15 per frame at 60 fps → τ = −(1/60)/ln(0.85). */
export const CLASSIC_TARGET_TAU = -(1 / 60) / Math.log(0.85);
/** D-term lowpass so derivative-of-noise stays bounded at the fixed step. */
export const CLASSIC_D_LPF_HZ = 30;
export const INTEGRAL_LIMIT = 200;
/** Heat display thresholds (fixed-step model). */
export const CLASSIC_HEAT_WARM = 40;
export const CLASSIC_HEAT_HOT = 70;

export interface ClassicOut {
  t: number;
  handle: number;
  target: number;
  pos: number;
  vel: number;
  meas: number;
  p: number;
  i: number;
  d: number;
  ff: number;
  force: number;
  applied: number;
  heat: number;
}

export class ClassicSim {
  readonly p: ClassicParams;
  readonly h = CLASSIC_H;
  readonly out: ClassicOut;
  private handle = 0;
  private target = 0;
  private prevTarget = 0;
  private ffState = 0;
  private integral = 0;
  private pos = 0;
  private vel = 0;
  private prevMeas = 0;
  private prevNoise = 0;
  private readonly dLpf: Pt1;
  private readonly dNoiseLpf: Pt1;
  private heat = 0;
  private readonly delay: Float64Array;
  private delayIdx = 0;
  private readonly rng: Prng;
  private readonly aTarget: number;
  private readonly aHeat: number;
  private stepIndex = 0;

  constructor(p: ClassicParams, init = 0) {
    this.p = p;
    this.rng = new Prng(p.seed);
    this.aTarget = emaAlpha(this.h, CLASSIC_TARGET_TAU);
    this.aHeat = emaAlpha(this.h, 0.5);
    this.dLpf = new Pt1(pt1FilterGain(CLASSIC_D_LPF_HZ, this.h));
    this.dNoiseLpf = new Pt1(pt1FilterGain(CLASSIC_D_LPF_HZ, this.h));
    this.delay = new Float64Array(Math.max(1, Math.round(p.delayMs / 1000 / this.h)));
    this.handle = this.target = this.prevTarget = this.pos = this.prevMeas = init;
    this.out = {
      t: 0,
      handle: init,
      target: init,
      pos: init,
      vel: 0,
      meas: init,
      p: 0,
      i: 0,
      d: 0,
      ff: 0,
      force: 0,
      applied: 0,
      heat: 0,
    };
  }

  setHandle(x: number): void {
    this.handle = x;
  }

  /** Delay actually applied right now, s (always the configured delay — bug #1 fixed). */
  get appliedDelayS(): number {
    return this.delay.length * this.h;
  }

  step(): void {
    const { p, h } = this;
    this.target += this.aTarget * (this.handle - this.target);
    const noise = p.noise > 0 ? p.noise * this.rng.gauss() : 0;
    const meas = this.pos + noise;
    const error = this.target - meas;
    this.integral = Math.max(-INTEGRAL_LIMIT, Math.min(INTEGRAL_LIMIT, this.integral + error * h));
    const dRaw = (meas - this.prevMeas) / h;
    this.prevMeas = meas;
    const dMeas = this.dLpf.apply(dRaw);
    const dNoise = this.dNoiseLpf.apply((noise - this.prevNoise) / h);
    this.prevNoise = noise;
    const dTarget = (this.target - this.prevTarget) / h;
    this.prevTarget = this.target;
    this.ffState += this.aTarget * (dTarget - this.ffState);

    const P = p.kp * error;
    const I = p.ki * this.integral;
    const D = -p.kd * dMeas;
    const FF = p.kff * this.ffState;
    const force = P + I + D + FF;

    const di = this.delayIdx;
    const applied = this.delay[di]!;
    this.delay[di] = force;
    this.delayIdx = (di + 1) % this.delay.length;

    const a = applied / p.mass - (p.drag * this.vel) / p.mass + p.cg;
    this.vel += a * h;
    this.pos += this.vel * h;
    this.heat += this.aHeat * (Math.abs(p.kd * dNoise) - this.heat);
    this.stepIndex++;

    const o = this.out;
    o.t = this.stepIndex * h;
    o.handle = this.handle;
    o.target = this.target;
    o.pos = this.pos;
    o.vel = this.vel;
    o.meas = meas;
    o.p = P;
    o.i = I;
    o.d = D;
    o.ff = FF;
    o.force = force;
    o.applied = applied;
    o.heat = this.heat;
  }

  run(n: number, each?: (o: ClassicOut) => void): void {
    for (let i = 0; i < n; i++) {
      this.step();
      each?.(this.out);
    }
  }
}

/**
 * Dev-only emulation of the ORIGINAL frame-stepped behaviour, for docs/FINDINGS.md plots.
 * Not exposed in the normal UI. Reproduces the mechanisms, not the exact code:
 *  - one integration step per display frame (dt = frame time, clamped to 50 ms);
 *  - per-frame EMAs (α = 0.15) for target and feed-forward;
 *  - noise (uniform, running-mean removed) only in the D term, derivative divided by frame dt;
 *  - bug #1: the delay buffer is cleared on every frame in which the smoothed target changed
 *    (the original's effect re-creation), so right after a stick move almost no delay is applied.
 */
export class LegacyClassicSim {
  readonly p: ClassicParams;
  private handle = 0;
  private target = 0;
  private prevTarget = 0;
  private integral = 0;
  private pos = 0;
  private vel = 0;
  private prevNoisyPos = 0;
  private prevNoise = 0;
  private noiseMean = 0;
  private ff = 0;
  private time = 0;
  private buffer: { t: number; f: number }[] = [];
  private readonly rng: Prng;
  heat = 0;
  /** Delay actually applied on the last frame, s. */
  lastAppliedDelay = 0;
  recreations = 0;

  constructor(p: ClassicParams, init = 0) {
    this.p = p;
    this.rng = new Prng(p.seed);
    this.handle = this.target = this.prevTarget = this.pos = this.prevNoisyPos = init;
  }

  setHandle(x: number): void {
    this.handle = x;
  }

  get position(): number {
    return this.pos;
  }

  get smoothedTarget(): number {
    return this.target;
  }

  /** One display frame of length `frameDt` seconds. */
  frame(frameDt: number): void {
    const p = this.p;
    const dt = Math.min(frameDt, 0.05);
    this.time += dt;
    const newTarget = this.target + 0.15 * (this.handle - this.target);
    if (newTarget !== this.target) {
      // React effect depending on targetPos is torn down and re-created → buffer wiped
      this.buffer = [];
      this.recreations++;
    }
    this.target = newTarget;
    // uniform noise in the same RMS units as the fixed model, running-mean removed
    const raw = p.noise * Math.sqrt(3) * this.rng.signed();
    this.noiseMean += 0.05 * (raw - this.noiseMean);
    const noise = raw - this.noiseMean;
    const error = this.target - this.pos;
    this.integral = Math.max(-INTEGRAL_LIMIT, Math.min(INTEGRAL_LIMIT, this.integral + error * dt));
    const noisy = this.pos + noise;
    const gyroD = (noisy - this.prevNoisyPos) / dt;
    this.prevNoisyPos = noisy;
    const dNoise = (noise - this.prevNoise) / dt;
    this.prevNoise = noise;
    this.ff += 0.15 * ((this.target - this.prevTarget) / dt - this.ff);
    this.prevTarget = this.target;
    const force = p.kp * error + p.ki * this.integral - p.kd * gyroD + p.kff * this.ff;

    this.buffer.push({ t: this.time, f: force });
    const due = this.time - p.delayMs / 1000;
    while (this.buffer.length > 1 && this.buffer[1]!.t <= due) this.buffer.shift();
    const applied = this.buffer[0]!;
    this.lastAppliedDelay = this.time - applied.t;

    const a = applied.f / p.mass - (p.drag * this.vel) / p.mass + p.cg;
    this.vel += a * dt;
    this.pos += this.vel * dt;
    this.heat += 0.05 * (Math.abs(p.kd * dNoise) - this.heat);
  }
}

export interface ClassicStepResult {
  t: Float32Array;
  target: Float32Array;
  pos: Float32Array;
  metrics: StepMetrics;
}

/**
 * Classic-mode step response through the SAME pipeline as the live sim (handle smoothing, FF,
 * delay, fixed step) — unlike the original, whose panel used a different model.
 * Noise is disabled so the curve is deterministic.
 */
export function classicStepResponse(
  p: ClassicParams,
  amplitude = 50,
  durationS = 6,
  decimate = 10,
): ClassicStepResult {
  const sim = new ClassicSim({ ...p, noise: 0 });
  const n = Math.round(durationS / sim.h);
  const m = Math.floor(n / decimate);
  const t = new Float32Array(m);
  const target = new Float32Array(m);
  const pos = new Float32Array(m);
  const tFull = new Float64Array(n);
  const yFull = new Float64Array(n);
  sim.setHandle(amplitude);
  for (let i = 0; i < n; i++) {
    sim.step();
    tFull[i] = sim.out.t;
    yFull[i] = sim.out.pos;
    if (i % decimate === 0 && i / decimate < m) {
      const k = i / decimate;
      t[k] = sim.out.t;
      target[k] = sim.out.target;
      pos[k] = sim.out.pos;
    }
  }
  return { t, target, pos, metrics: stepMetrics(tFull, yFull, 0, amplitude, 0) };
}
