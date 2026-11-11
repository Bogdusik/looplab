import { dynLpfCutoffFreq, Lowpass, Pt1, pt1FilterGain, type FilterSpec } from './filters.ts';
import type { LpfConfig, PidConfig } from './types.ts';

/** flight/pid.h scaling constants (betaflight@f97bdbc). */
export const PTERM_SCALE = 0.032029;
export const ITERM_SCALE = 0.244381;
export const DTERM_SCALE = 0.000529;
export const FEEDFORWARD_SCALE = 0.013754;
export const ITERM_RELAX_SETPOINT_THRESHOLD = 40;
/** flight/pid.h PID_MIXER_SCALING. */
export const PID_MIXER_SCALING = 1000;

/** Effective cutoff of a (possibly dynamic) lowpass at a given throttle. */
export function lpfCutoffAt(cfg: LpfConfig, throttle: number): number {
  return cfg.dynamic ? dynLpfCutoffFreq(throttle, cfg.minHz, cfg.maxHz, cfg.expo) : cfg.staticHz;
}

export function lpfSpec(cfg: LpfConfig, throttle: number, fs: number): FilterSpec[] {
  if (!cfg.enabled) return [];
  const fc = lpfCutoffAt(cfg, throttle);
  return fc > 0 ? [{ kind: 'lpf', type: cfg.type, fc, fs }] : [];
}

class OptionalLpf {
  private f: Lowpass | null;
  constructor(cfg: LpfConfig, throttle: number, dt: number) {
    const fc = lpfCutoffAt(cfg, throttle);
    // pid_init.c: cutoffs at/above Nyquist·0.95 disable the filter
    this.f = cfg.enabled && fc > 0 && fc < 0.95 * (0.5 / dt) ? new Lowpass(cfg.type, fc, dt) : null;
  }
  apply(x: number): number {
    return this.f ? this.f.apply(x) : x;
  }
  reset(v = 0): void {
    this.f?.reset(v);
  }
}

export interface PidTerms {
  p: number;
  i: number;
  d: number;
  f: number;
  sum: number;
  /** Gyro after D-term filters (input to the derivative). */
  dtermInput: number;
}

/**
 * Single-axis Betaflight rate PID — port of `src/main/flight/pid.c` pidController()
 * for one roll/pitch axis in acro mode, plus `applyItermRelax()` (SETPOINT type, RP mode).
 *
 * Not modelled yet (M4): anti-gravity, D-max, TPA, crash recovery, launch control, S-term.
 */
export class BfPid {
  readonly cfg: PidConfig;
  readonly dT: number;
  readonly pidFrequency: number;
  readonly kp: number;
  readonly ki: number;
  readonly kd: number;
  readonly kf: number;
  readonly itermLimit: number;

  private dtermLpf1: OptionalLpf;
  private dtermLpf2: OptionalLpf;
  private windupLpf: Pt1;
  private prevGyroRateDterm = 0;
  iterm = 0;
  readonly out: PidTerms = { p: 0, i: 0, d: 0, f: 0, sum: 0, dtermInput: 0 };

  constructor(cfg: PidConfig, dtermLpf1: LpfConfig, dtermLpf2: LpfConfig, throttle: number, pidDt: number) {
    this.cfg = cfg;
    this.dT = pidDt;
    this.pidFrequency = 1 / pidDt;
    // pid_init.c pidInitConfig()
    this.kp = PTERM_SCALE * cfg.gains.p;
    this.ki = ITERM_SCALE * cfg.gains.i;
    this.kd = DTERM_SCALE * cfg.gains.d;
    this.kf = FEEDFORWARD_SCALE * (cfg.gains.f * 0.01);
    this.itermLimit = 0.01 * cfg.itermWindup * cfg.pidSumLimit;
    this.dtermLpf1 = new OptionalLpf(dtermLpf1, throttle, pidDt);
    this.dtermLpf2 = new OptionalLpf(dtermLpf2, throttle, pidDt);
    this.windupLpf = new Pt1(pt1FilterGain(cfg.itermRelaxCutoff, pidDt));
  }

  /** Initialise filter/derivative state for a steady gyro value (avoids a start-up D spike). */
  prime(gyro: number, iterm = 0): void {
    this.dtermLpf1.reset(gyro);
    this.dtermLpf2.reset(gyro);
    this.prevGyroRateDterm = gyro;
    this.iterm = iterm;
  }

  /**
   * One PID loop. `setpoint` and `feedforward` come from the RC pipeline (smoothed),
   * `gyroRate` is the filtered gyro (gyro.gyroADCf).
   */
  update(setpoint: number, feedforward: number, gyroRate: number): PidTerms {
    const o = this.out;

    // D-term input: dterm notch (off by default) → dterm LPF1 → dterm LPF2
    let gyroRateDterm = this.dtermLpf1.apply(gyroRate);
    gyroRateDterm = this.dtermLpf2.apply(gyroRateDterm);
    o.dtermInput = gyroRateDterm;

    const errorRate = setpoint - gyroRate;
    let itermErrorRate = errorRate;

    // pid.c applyItermRelax(): setpoint HPF reduces I accumulation during fast stick moves
    const setpointLpf = this.windupLpf.apply(setpoint);
    if (this.cfg.itermRelax) {
      const setpointHpf = Math.abs(setpoint - setpointLpf);
      const itermRelaxFactor = Math.max(0, 1 - setpointHpf / ITERM_RELAX_SETPOINT_THRESHOLD);
      itermErrorRate *= itermRelaxFactor;
    }

    o.p = this.kp * errorRate;

    const iTermChange = this.ki * this.dT * itermErrorRate;
    this.iterm = Math.max(-this.itermLimit, Math.min(this.itermLimit, this.iterm + iTermChange));
    o.i = this.iterm;

    // D on measurement: derivative of the D-term-filtered gyro, fixed dT (pidFrequency)
    if (this.kd > 0) {
      const delta = -(gyroRateDterm - this.prevGyroRateDterm) * this.pidFrequency;
      o.d = this.kd * delta;
    } else {
      o.d = 0;
    }
    this.prevGyroRateDterm = gyroRateDterm;

    o.f = this.kf * feedforward;
    o.sum = o.p + o.i + o.d + o.f;
    return o;
  }
}
