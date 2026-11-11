import { Pt1, pt1FilterGain } from './filters.ts';
import type { ThermalParams } from './types.ts';

export type HeatLevel = 'cool' | 'warm' | 'hot';

export const HEAT_WARM_C = 50;
export const HEAT_HOT_C = 70;

export const heatLevel = (c: number): HeatLevel =>
  c >= HEAT_HOT_C ? 'hot' : c >= HEAT_WARM_C ? 'warm' : 'cool';

/**
 * Qualitative first-order motor thermal model (one per motor side):
 *   C·dT/dt = P_loss − (T − T_amb)/R_th,  with R_th·C = τ
 *   P_loss ∝ kMean·(mean output)² + kHf·(RMS of the command above hfCornerHz)²
 * The first term stands in for I²R at steady thrust, the second for the extra current that
 * rapid command changes (noisy D, aggressive FF) push through the windings.
 */
export class MotorThermal {
  private readonly p: ThermalParams;
  private readonly dt: number;
  private readonly hp: Pt1;
  private readonly meanLpf: Pt1;
  private readonly hfPow: Pt1;
  tempC: number;

  constructor(p: ThermalParams, dt: number, initialOutput: number) {
    this.p = p;
    this.dt = dt;
    this.hp = new Pt1(pt1FilterGain(p.hfCornerHz, dt));
    this.hp.reset(initialOutput);
    this.meanLpf = new Pt1(pt1FilterGain(1, dt));
    this.meanLpf.reset(initialOutput);
    this.hfPow = new Pt1(pt1FilterGain(2, dt));
    this.tempC = p.ambientC + p.kMean * initialOutput * initialOutput;
  }

  /** Steady-state temperature for a constant output and HF RMS. */
  static steadyState(p: ThermalParams, mean: number, hfRms: number): number {
    return p.ambientC + p.kMean * mean * mean + p.kHf * hfRms * hfRms;
  }

  update(output: number): void {
    const hf = output - this.hp.apply(output);
    const pow = this.hfPow.apply(hf * hf);
    const mean = this.meanLpf.apply(output);
    const target = MotorThermal.steadyState(this.p, mean, Math.sqrt(pow));
    this.tempC += ((target - this.tempC) * this.dt) / this.p.tauS;
  }

  get hfRms(): number {
    return Math.sqrt(this.hfPow.state);
  }
}
