import { Lowpass, Pt1, pt1FilterGain, SvfNotch, type FilterSpec } from './filters.ts';
import { lpfCutoffAt, lpfSpec } from './pid.ts';
import type { FilterConfig, LpfConfig, RpmFilterConfig } from './types.ts';

function makeLpf(cfg: LpfConfig, throttle: number, dt: number): Lowpass | null {
  const fc = lpfCutoffAt(cfg, throttle);
  return cfg.enabled && fc > 0 && fc < 0.5 / dt ? new Lowpass(cfg.type, fc, dt) : null;
}

/** rpm_filter.c: notch frequency and fade weight for one harmonic of one motor. */
export function rpmNotchParams(
  cfg: RpmFilterConfig,
  harmonic: number,
  motorHz: number,
  pidHz: number,
): { hz: number; weight: number } {
  const maxHz = 0.48 * pidHz; // "don't go quite to nyquist to avoid oscillations"
  const hz = Math.max(cfg.minHz, Math.min(maxHz, (harmonic + 1) * motorHz));
  const margin = hz - cfg.minHz;
  let weight = 1;
  if (margin < cfg.fadeHz) weight = margin / cfg.fadeHz;
  weight *= Math.max(0, Math.min(1, cfg.weights[harmonic]!));
  return { hz, weight };
}

/**
 * Gyro filter chain, ordered as in Betaflight `sensors/gyro.c` + `gyro_filter_impl.c`:
 *   gyro LPF2 (static, at gyro sample rate — doubles as the downsampling filter)
 *   → RPM notches (`flight/rpm_filter.c`, at PID rate)
 *   → gyro LPF1 (dynamic vs throttle, at PID rate)  → gyro.gyroADCf.
 * Static gyro notches and the dynamic notch are not included (dynamic notch is M4).
 */
export class GyroChain {
  private readonly cfg: FilterConfig;
  private readonly pidDt: number;
  private readonly lpf2: Lowpass | null;
  private readonly lpf1: Lowpass | null;
  private readonly notches: SvfNotch[][] = [];
  private readonly motorLpf: Pt1[] = [];
  private sum = 0;
  private count = 0;

  /** Last LPF2 output (gyro rate). */
  stage2 = 0;
  /** Filtered gyro (PID rate). */
  out = 0;

  constructor(cfg: FilterConfig, throttle: number, gyroDt: number, pidDt: number, motorHz: number) {
    this.cfg = cfg;
    this.pidDt = pidDt;
    this.lpf2 = makeLpf(cfg.gyroLpf2, throttle, gyroDt);
    this.lpf1 = makeLpf(cfg.gyroLpf1, throttle, pidDt);
    if (cfg.rpm.enabled) {
      const k = pt1FilterGain(cfg.rpm.lpfHz, pidDt);
      for (let m = 0; m < 4; m++) {
        const f = new Pt1(k);
        f.reset(motorHz);
        this.motorLpf.push(f);
        const row: SvfNotch[] = [];
        for (let hIdx = 0; hIdx < cfg.rpm.harmonics; hIdx++) {
          const { hz, weight } = rpmNotchParams(cfg.rpm, hIdx, motorHz, 1 / pidDt);
          row.push(new SvfNotch(hz, pidDt, cfg.rpm.q, weight));
        }
        this.notches.push(row);
      }
    }
  }

  /** Every gyro sample. */
  sample(raw: number): void {
    if (this.lpf2) {
      this.stage2 = this.lpf2.apply(raw);
    } else {
      this.sum += raw;
      this.count++;
      this.stage2 = raw;
    }
  }

  /** Every PID loop; `motorHz` = bidirectional-DShot rotation frequency per motor. */
  run(motorHz: ArrayLike<number>): number {
    let x: number;
    if (this.lpf2) x = this.stage2;
    else {
      x = this.count ? this.sum / this.count : this.stage2;
      this.sum = 0;
      this.count = 0;
    }
    if (this.cfg.rpm.enabled) {
      const pidHz = 1 / this.pidDt;
      for (let m = 0; m < 4; m++) {
        const f = this.motorLpf[m]!.apply(motorHz[m]!);
        const row = this.notches[m]!;
        for (let hIdx = 0; hIdx < row.length; hIdx++) {
          const { hz, weight } = rpmNotchParams(this.cfg.rpm, hIdx, f, pidHz);
          const n = row[hIdx]!;
          if (weight > 0) {
            n.update(hz, this.pidDt, this.cfg.rpm.q, weight);
            x = n.apply(x);
          }
        }
      }
    }
    if (this.lpf1) x = this.lpf1.apply(x);
    this.out = x;
    return x;
  }

  prime(v: number): void {
    this.lpf2?.reset(v);
    this.lpf1?.reset(v);
    this.stage2 = v;
    this.out = v;
  }
}

/** RPM notches for given motor frequencies (analytic specs). */
export function rpmSpecs(cfg: RpmFilterConfig, motorHz: readonly number[], pidHz: number): FilterSpec[] {
  if (!cfg.enabled) return [];
  const out: FilterSpec[] = [];
  for (const f of motorHz) {
    for (let h = 0; h < cfg.harmonics; h++) {
      const { hz, weight } = rpmNotchParams(cfg, h, f, pidHz);
      if (weight > 0) out.push({ kind: 'notch', fc: hz, q: cfg.q, weight, fs: pidHz });
    }
  }
  return out;
}

/** Analytic gyro chain (LPF2 → RPM notches at the given motor frequencies → LPF1). */
export function gyroChainSpecs(
  cfg: FilterConfig,
  throttle: number,
  gyroHz: number,
  pidHz: number,
  motorHz: readonly number[] = [],
): FilterSpec[] {
  return [
    ...lpfSpec(cfg.gyroLpf2, throttle, gyroHz),
    ...rpmSpecs(cfg.rpm, motorHz, pidHz),
    ...lpfSpec(cfg.gyroLpf1, throttle, pidHz),
  ];
}

export function dtermChainSpecs(cfg: FilterConfig, throttle: number, pidHz: number): FilterSpec[] {
  return [...lpfSpec(cfg.dtermLpf1, throttle, pidHz), ...lpfSpec(cfg.dtermLpf2, throttle, pidHz)];
}
