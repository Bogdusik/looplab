import type { LpfType } from './filters.ts';

/** Betaflight ACTUAL rates in display units: centre sensitivity (deg/s), max rate (deg/s), expo 0..1. */
export interface RatesConfig {
  centerRate: number;
  maxRate: number;
  expo: number;
}

export type PacketRate = 50 | 150 | 250 | 500 | 1000;

export interface RcConfig {
  packetHz: PacketRate;
  /** rx.c rc_smoothing (PT3 on setpoint and feedforward, auto cutoff from link rate). */
  smoothing: boolean;
  /** rc_smoothing_auto_factor_rpy, 0..250 (default 30). */
  autoFactor: number;
  /** feedforward_averaging: 0 = off, 1 = 2-point, 2 = 3-point, 3 = 4-point. */
  ffAveraging: 0 | 1 | 2 | 3;
  /** feedforward_smooth_factor, 0..95. */
  ffSmoothFactor: number;
  /** feedforward_jitter_factor, 0..20. */
  ffJitterFactor: number;
  /** feedforward_boost, 0..50. */
  ffBoost: number;
  /** feedforward_max_rate_limit, 0..200. */
  ffMaxRateLimit: number;
}

/** Gains in Betaflight integer units (as shown in the Configurator). */
export interface PidGains {
  p: number;
  i: number;
  d: number;
  f: number;
}

export interface PidConfig {
  gains: PidGains;
  /** iterm_relax = RP (true) or OFF (false); type is SETPOINT. */
  itermRelax: boolean;
  itermRelaxCutoff: number;
  /** iterm_windup, % of pidsum limit. */
  itermWindup: number;
  pidSumLimit: number;
}

export interface LpfConfig {
  enabled: boolean;
  type: LpfType;
  /** Dynamic (throttle-dependent) cutoff between minHz and maxHz; otherwise staticHz. */
  dynamic: boolean;
  staticHz: number;
  minHz: number;
  maxHz: number;
  /** dyn_lpf curve expo, 0..10. */
  expo: number;
}

export interface RpmFilterConfig {
  enabled: boolean;
  harmonics: 1 | 2 | 3;
  minHz: number;
  fadeHz: number;
  /** Notch Q (Betaflight stores ×100: rpm_filter_q = 500 → 5.00). */
  q: number;
  /** rpm_filter_lpf_hz: PT1 on motor telemetry frequency. */
  lpfHz: number;
  weights: [number, number, number];
}

export interface FilterConfig {
  gyroLpf1: LpfConfig;
  gyroLpf2: LpfConfig;
  dtermLpf1: LpfConfig;
  dtermLpf2: LpfConfig;
  rpm: RpmFilterConfig;
}

/** A box-shaped mass. Position (centre) and size in metres; x forward, y right, z up. */
export interface MassItem {
  name: string;
  kg: number;
  x: number;
  y: number;
  z: number;
  lx: number;
  ly: number;
  lz: number;
}

export interface NoiseParams {
  /** Broadband (electrical / sensor) noise, deg/s RMS. */
  electricalDps: number;
  /** Motor 1st/2nd/3rd harmonic amplitude per motor at hover RPM, deg/s. */
  harmonicDps: [number, number, number];
  /** Prop/motor balance multiplier (1 = typical, 0 = perfect, 3 = bent prop). */
  balance: number;
  /** Relative RPM spread front vs rear motors (e.g. 0.01 = ±1 %). */
  motorSpread: number;
  /** Relative frequency jitter (slow random walk), e.g. 0.003. */
  jitter: number;
  /** Frame resonance: centre frequency, Q and RMS amplitude (deg/s). 0 amplitude = off. */
  frameHz: number;
  frameQ: number;
  frameDps: number;
}

export interface ThermalParams {
  ambientC: number;
  /** Thermal time constant R·C, s. */
  tauS: number;
  /** Steady-state rise per unit of (mean motor output)², K. */
  kMean: number;
  /** Steady-state rise per unit of (high-frequency command RMS)², K. */
  kHf: number;
  /** Corner of the high-pass that defines "high-frequency" command energy, Hz. */
  hfCornerHz: number;
}

export interface DroneParams {
  id: string;
  name: string;
  description: string;
  /** Centre-to-motor distance (X frame), m. */
  armM: number;
  motorKv: number;
  cells: number;
  /** Loaded pack voltage per cell (battery sag is M4). */
  voltsPerCell: number;
  /** Loaded RPM / (KV·V) — props hold the motor below its no-load speed. */
  kvLoadFactor: number;
  /** Motor + prop first-order time constant, s. */
  tauMotorS: number;
  /** Throttle (0..1, before idle mapping) at which the quad hovers. */
  hoverThrottle: number;
  /** dshot_idle_value as a fraction (0.055 = 5.5 %). */
  idle: number;
  motorMassKg: number;
  motorZ: number;
  mass: MassItem[];
  /** Rotational aerodynamic damping, N·m·s/rad. */
  rotDrag: number;
  /** Lateral CG offset (+ = towards the right motors), m. Creates a constant roll torque. */
  cgOffsetM: number;
  /** ESC / DShot / motor driver transport delay, s. */
  transportDelayS: number;
  noise: NoiseParams;
  thermal: ThermalParams;
}

export interface LoopConfig {
  /** Gyro sample rate = physics rate. */
  gyroHz: number;
  /** pid_process_denom. */
  pidDenom: 1 | 2;
}

export interface BfParams {
  loop: LoopConfig;
  rates: RatesConfig;
  rc: RcConfig;
  pid: PidConfig;
  filters: FilterConfig;
  drone: DroneParams;
  noiseEnabled: boolean;
  seed: number;
}
