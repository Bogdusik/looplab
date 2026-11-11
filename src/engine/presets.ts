import type {
  BfParams,
  DroneParams,
  FilterConfig,
  LoopConfig,
  PidConfig,
  RatesConfig,
  RcConfig,
} from './types.ts';

/**
 * Betaflight defaults, betaflight@f97bdbc:
 *  - PIDs: flight/pid.h PID_ROLL_DEFAULT {45, 80, 30, F120}, PID_PITCH_DEFAULT {47, 84, 34, F125}
 *  - iterm_relax RP / SETPOINT / cutoff 15, iterm_windup 80, pidsum_limit 500 (flight/pid.c resetPidProfile)
 *  - gyro LPF1 dyn PT1 250–500 Hz expo 5, LPF2 PT1 500 Hz (sensors/gyro.c, gyro.h)
 *  - D-term LPF1 dyn PT1 75–150 Hz expo 5, LPF2 PT1 150 Hz (flight/pid.h, pid.c)
 *  - RPM filter: 3 harmonics, min 100 Hz, fade 50 Hz, Q 500 (=5.00), lpf 150 Hz (pg/rpm_filter.c)
 *  - rates ACTUAL 7 / 67 / 0 (fc/controlrate_profile.c)
 *  - rc_smoothing on, auto factor 30 (pg/rx.c); feedforward averaging 2-point, smooth 65, jitter 7,
 *    boost 15, max rate limit 90 (flight/pid.c)
 *  - pid_process_denom 1 (flight/pid.c DEFAULT_PID_PROCESS_DENOM; some targets override to 2)
 */
export const BF_DEFAULT_ROLL = { p: 45, i: 80, d: 30, f: 120 } as const;
export const BF_DEFAULT_PITCH = { p: 47, i: 84, d: 34, f: 125 } as const;

export const DEFAULT_LOOP: LoopConfig = { gyroHz: 8000, pidDenom: 1 };

export const DEFAULT_RATES: RatesConfig = { centerRate: 70, maxRate: 670, expo: 0 };

export const RATE_PRESETS: Record<string, { label: string; rates: RatesConfig }> = {
  bfDefault: { label: 'Betaflight default (70 / 670 / 0.00)', rates: DEFAULT_RATES },
  mine: { label: 'My rates (50 / 670 / 0.45)', rates: { centerRate: 50, maxRate: 670, expo: 0.45 } },
  // Linear: centre sensitivity == max rate → straight line; for wobble / tuning tests.
  linear: { label: 'Linear tuning rates (400 / 400 / 0)', rates: { centerRate: 400, maxRate: 400, expo: 0 } },
};

export const DEFAULT_RC: RcConfig = {
  packetHz: 250,
  smoothing: true,
  autoFactor: 30,
  ffAveraging: 1,
  ffSmoothFactor: 65,
  ffJitterFactor: 7,
  ffBoost: 15,
  ffMaxRateLimit: 90,
};

/**
 * RC-link "flight style" presets in the spirit of the Betaflight Configurator RC-link presets.
 * TODO(verify): exact values against betaflight/firmware-presets (presets/4.5/rc_link/*).
 */
export const RC_STYLE_PRESETS: Record<string, { label: string; patch: Partial<RcConfig> }> = {
  race: {
    label: 'Race',
    patch: { autoFactor: 15, ffAveraging: 0, ffSmoothFactor: 35, ffJitterFactor: 4, ffBoost: 18 },
  },
  freestyle: {
    label: 'Freestyle',
    patch: { autoFactor: 30, ffAveraging: 1, ffSmoothFactor: 65, ffJitterFactor: 7, ffBoost: 15 },
  },
  cinematic: {
    label: 'Cinematic',
    patch: { autoFactor: 60, ffAveraging: 3, ffSmoothFactor: 80, ffJitterFactor: 12, ffBoost: 5 },
  },
};

export const DEFAULT_PID: PidConfig = {
  gains: { ...BF_DEFAULT_ROLL },
  itermRelax: true,
  itermRelaxCutoff: 15,
  itermWindup: 80,
  pidSumLimit: 500,
};

export const DEFAULT_FILTERS: FilterConfig = {
  gyroLpf1: { enabled: true, type: 'PT1', dynamic: true, staticHz: 250, minHz: 250, maxHz: 500, expo: 5 },
  gyroLpf2: { enabled: true, type: 'PT1', dynamic: false, staticHz: 500, minHz: 0, maxHz: 0, expo: 0 },
  dtermLpf1: { enabled: true, type: 'PT1', dynamic: true, staticHz: 75, minHz: 75, maxHz: 150, expo: 5 },
  dtermLpf2: { enabled: true, type: 'PT1', dynamic: false, staticHz: 150, minHz: 0, maxHz: 0, expo: 0 },
  rpm: { enabled: true, harmonics: 3, minHz: 100, fadeHz: 50, q: 5, lpfHz: 150, weights: [1, 1, 1] },
};

/*
 * Drone presets. All physical numbers are plausible approximations for the class of craft,
 * not measurements of a specific build. Absolute gains transfer to a real quad only after
 * calibration (system identification, M6).
 */

const freestyle5: DroneParams = {
  id: 'freestyle5',
  name: '5" freestyle 6S',
  description: '≈ 610 g AUW, 2207 1850 KV, 6S 1100 mAh, 220 mm wheelbase',
  armM: 0.11,
  motorKv: 1850,
  cells: 6,
  voltsPerCell: 3.9,
  kvLoadFactor: 0.75,
  tauMotorS: 0.022,
  hoverThrottle: 0.28,
  idle: 0.055,
  motorMassKg: 0.037,
  motorZ: 0.012,
  mass: [
    { name: 'frame + electronics', kg: 0.26, x: 0, y: 0, z: 0, lx: 0.14, ly: 0.1, lz: 0.035 },
    { name: 'battery (6S 1100)', kg: 0.2, x: 0, y: 0, z: 0.04, lx: 0.075, ly: 0.035, lz: 0.035 },
  ],
  rotDrag: 0.002,
  cgOffsetM: 0.003,
  transportDelayS: 0.001,
  noise: {
    electricalDps: 0.5,
    harmonicDps: [5.5, 2.75, 1.25],
    balance: 1,
    motorSpread: 0.012,
    jitter: 0.003,
    frameHz: 320,
    frameQ: 12,
    frameDps: 0,
  },
  thermal: { ambientC: 22, tauS: 22, kMean: 160, kHf: 250000, hfCornerHz: 100 },
};

const longRange7: DroneParams = {
  id: 'longrange7',
  name: '7" long-range 6S + GoPro',
  description: '≈ 1.05 kg AUW, 2806.5 1300 KV, 6S 2200 mAh, GoPro on the front, 310 mm wheelbase',
  armM: 0.155,
  motorKv: 1300,
  cells: 6,
  voltsPerCell: 3.9,
  kvLoadFactor: 0.78,
  tauMotorS: 0.032,
  hoverThrottle: 0.4,
  idle: 0.05,
  motorMassKg: 0.065,
  motorZ: 0.014,
  mass: [
    { name: 'frame + electronics', kg: 0.32, x: 0, y: 0, z: 0, lx: 0.18, ly: 0.12, lz: 0.04 },
    { name: 'battery (6S 2200)', kg: 0.33, x: -0.03, y: 0, z: 0.045, lx: 0.11, ly: 0.045, lz: 0.04 },
    { name: 'GoPro', kg: 0.13, x: 0.1, y: 0, z: 0.03, lx: 0.06, ly: 0.04, lz: 0.035 },
  ],
  rotDrag: 0.004,
  cgOffsetM: 0.004,
  transportDelayS: 0.0012,
  noise: {
    electricalDps: 0.45,
    harmonicDps: [7, 3.5, 1.5],
    balance: 1,
    motorSpread: 0.012,
    jitter: 0.003,
    frameHz: 170,
    frameQ: 10,
    frameDps: 0,
  },
  thermal: { ambientC: 22, tauS: 30, kMean: 110, kHf: 250000, hfCornerHz: 100 },
};

const whoop: DroneParams = {
  id: 'whoop',
  name: '1S whoop (65–75 mm)',
  description: '≈ 31 g AUW, 0802 22000 KV, 1S 300 mAh, 65 mm wheelbase',
  armM: 0.0325,
  motorKv: 22000,
  cells: 1,
  voltsPerCell: 3.7,
  kvLoadFactor: 0.55,
  tauMotorS: 0.014,
  hoverThrottle: 0.5,
  idle: 0.07,
  motorMassKg: 0.0027,
  motorZ: 0.004,
  mass: [
    { name: 'frame + AIO + canopy', kg: 0.013, x: 0, y: 0, z: 0, lx: 0.06, ly: 0.06, lz: 0.02 },
    { name: 'battery (1S 300)', kg: 0.0075, x: 0, y: 0, z: -0.008, lx: 0.045, ly: 0.015, lz: 0.012 },
  ],
  rotDrag: 0.00002,
  cgOffsetM: 0.001,
  transportDelayS: 0.001,
  noise: {
    electricalDps: 1.0,
    harmonicDps: [6, 3, 1.6],
    balance: 1,
    motorSpread: 0.015,
    jitter: 0.004,
    frameHz: 450,
    frameQ: 8,
    frameDps: 0,
  },
  thermal: { ambientC: 22, tauS: 15, kMean: 70, kHf: 150000, hfCornerHz: 100 },
};

export const DRONE_PRESETS: Record<string, DroneParams> = {
  whoop,
  freestyle5,
  longRange7,
};

export const DEFAULT_DRONE_ID = 'freestyle5';

export function defaultBfParams(droneId = DEFAULT_DRONE_ID): BfParams {
  const drone = DRONE_PRESETS[droneId] ?? freestyle5;
  return structuredClone({
    loop: DEFAULT_LOOP,
    rates: DEFAULT_RATES,
    rc: DEFAULT_RC,
    pid: DEFAULT_PID,
    filters: DEFAULT_FILTERS,
    drone,
    noiseEnabled: true,
    seed: 1,
  });
}
