import type { DroneParams, MassItem } from './types.ts';

export const G = 9.80665;
const RPM_TO_RADS = (2 * Math.PI) / 60;

/** Motor order follows Betaflight QUAD X: 0 = rear-right, 1 = front-right, 2 = rear-left, 3 = front-left. */
export const MOTOR_SIDE = [1, 1, -1, -1] as const; // +1 right, −1 left
export const MOTOR_FRONT = [-1, 1, -1, 1] as const; // +1 front, −1 rear

export interface MassSummary {
  totalKg: number;
  cg: { x: number; y: number; z: number };
  /** Inertia about CG, kg·m². */
  jRoll: number;
  jPitch: number;
  items: MassItem[];
}

/** Motor point masses at the ends of an X frame. */
export function motorItems(d: DroneParams): MassItem[] {
  const a = d.armM * Math.SQRT1_2;
  return MOTOR_SIDE.map((side, i) => ({
    name: `motor ${i + 1}`,
    kg: d.motorMassKg,
    x: MOTOR_FRONT[i]! * a,
    y: side * a,
    z: d.motorZ,
    lx: 0,
    ly: 0,
    lz: 0,
  }));
}

/** CG and roll/pitch inertia from point/box masses (parallel-axis theorem). */
export function massSummary(d: DroneParams): MassSummary {
  const items = [...d.mass, ...motorItems(d)];
  let m = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const it of items) {
    m += it.kg;
    cx += it.kg * it.x;
    cy += it.kg * it.y;
    cz += it.kg * it.z;
  }
  cx /= m;
  cy /= m;
  cz /= m;
  let jRoll = 0;
  let jPitch = 0;
  for (const it of items) {
    const dy = it.y - cy;
    const dz = it.z - cz;
    const dx = it.x - cx;
    jRoll += it.kg * (dy * dy + dz * dz) + (it.kg * (it.ly * it.ly + it.lz * it.lz)) / 12;
    jPitch += it.kg * (dx * dx + dz * dz) + (it.kg * (it.lx * it.lx + it.lz * it.lz)) / 12;
  }
  return { totalKg: m, cg: { x: cx, y: cy, z: cz }, jRoll, jPitch, items };
}

/** Derived constants of the motor / thrust model. */
export interface MotorModel {
  /** Loaded full-throttle speed, rad/s. */
  omegaMax: number;
  /** Hover speed, rad/s. */
  omegaHover: number;
  /** Thrust coefficient, N/(rad/s)². */
  kT: number;
  /** Lateral lever arm of each motor about the roll axis, m. */
  armY: number;
  /** Thrust-to-weight ratio at full throttle (all motors). */
  twr: number;
}

/** Motor output (0..1 of full speed) for a mixer throttle/command, with dshot idle mapping. */
export const motorOutput = (cmd: number, idle: number) => idle + (1 - idle) * cmd;

export function motorModel(d: DroneParams, totalKg: number): MotorModel {
  const omegaMax = d.motorKv * d.cells * d.voltsPerCell * d.kvLoadFactor * RPM_TO_RADS;
  const omegaHover = motorOutput(d.hoverThrottle, d.idle) * omegaMax;
  const kT = (totalKg * G) / (4 * omegaHover * omegaHover);
  const twr = (4 * kT * omegaMax * omegaMax) / (totalKg * G);
  return { omegaMax, omegaHover, kT, armY: d.armM * Math.SQRT1_2, twr };
}

/**
 * Two-sided mixer for one axis around hover throttle, in the spirit of Betaflight
 * `flight/mixer.c` (QUAD X roll column: right motors −1, left motors +1) with airmode:
 * if the differential does not fit in [0, 1], first scale it down (motorMixRange > 1), then
 * shift throttle so both sides stay inside the range.
 */
export function mixAxis(throttle: number, u: number): { left: number; right: number; saturated: boolean } {
  let mixL = u;
  let mixR = -u;
  const range = Math.abs(mixL - mixR);
  let saturated = false;
  if (range > 1) {
    mixL /= range;
    mixR /= range;
    saturated = true;
  }
  const mixMax = Math.max(mixL, mixR);
  const mixMin = Math.min(mixL, mixR);
  let thr = throttle;
  if (thr + mixMax > 1) {
    thr = 1 - mixMax;
    saturated = true;
  }
  if (thr + mixMin < 0) {
    thr = -mixMin;
    saturated = true;
  }
  return { left: thr + mixL, right: thr + mixR, saturated };
}

/**
 * Four motors with first-order lag and quadratic thrust, driving a single rotational axis.
 * J·dω/dt = τ_motors − b·ω + τ_cg   (SI units internally, rad/s).
 */
export class RigidAxis {
  readonly mm: MotorModel;
  readonly mass: MassSummary;
  readonly j: number;
  readonly tauCg: number;
  private readonly alpha: number;
  private readonly spread: number[];
  readonly omega = new Float64Array(4);
  /** Body rate, rad/s. */
  rate = 0;
  /** Attitude, rad (for display only). */
  angle = 0;

  private readonly d: DroneParams;
  readonly h: number;

  constructor(d: DroneParams, h: number) {
    this.d = d;
    this.h = h;
    this.mass = massSummary(d);
    this.mm = motorModel(d, this.mass.totalKg);
    this.j = this.mass.jRoll;
    this.tauCg = this.mass.totalKg * G * d.cgOffsetM;
    this.alpha = 1 - Math.exp(-h / d.tauMotorS);
    // front/rear props run slightly different speeds in real quads (pitch/yaw trim)
    this.spread = MOTOR_FRONT.map((f) => 1 + f * d.noise.motorSpread);
    this.omega.fill(this.mm.omegaHover);
    for (let i = 0; i < 4; i++) this.omega[i] = this.mm.omegaHover * this.spread[i]!;
  }

  /** Steady-state motor speeds for given side commands (used to start in trimmed hover). */
  settle(left: number, right: number): void {
    for (let i = 0; i < 4; i++) {
      const cmd = MOTOR_SIDE[i]! > 0 ? right : left;
      this.omega[i] = motorOutput(cmd, this.d.idle) * this.mm.omegaMax * this.spread[i]!;
    }
  }

  /** Advance one physics step with side commands (mixer throttle space, 0..1). */
  step(left: number, right: number): void {
    let torque = 0;
    for (let i = 0; i < 4; i++) {
      const side = MOTOR_SIDE[i]!;
      const cmd = side > 0 ? right : left;
      const target = motorOutput(cmd, this.d.idle) * this.mm.omegaMax * this.spread[i]!;
      const w = this.omega[i]! + this.alpha * (target - this.omega[i]!);
      this.omega[i] = w;
      // positive roll (right side down) comes from left-side thrust
      torque -= side * this.mm.armY * this.mm.kT * w * w;
    }
    torque += this.tauCg - this.d.rotDrag * this.rate;
    this.rate += (torque / this.j) * this.h;
    this.angle += this.rate * this.h;
  }

  /** Motor rotation frequency, Hz. */
  motorHz(i: number): number {
    return this.omega[i]! / (2 * Math.PI);
  }
}
