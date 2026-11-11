import { BF_DEFAULT_PITCH, BF_DEFAULT_ROLL, DEFAULT_FILTERS } from './presets.ts';
import type { FilterConfig, PidGains } from './types.ts';

/**
 * Betaflight "simplified tuning" (sliders) — port of `src/main/config/simplified_tuning.c`
 * (betaflight@f97bdbc). Values are stored like Betaflight: 100 = 1.00×.
 *
 * Betaflight computes in float32 and passes the result to the integer `constrain()`, so the
 * float → int conversion truncates toward zero. We emulate float32 with Math.fround so slider
 * positions map to exactly the same integers as the firmware.
 */
export interface SimplifiedTuning {
  /** simplified_master_multiplier */
  master: number;
  /** simplified_d_gain — "Damping" (P:D balance) */
  dGain: number;
  /** simplified_pi_gain — "Tracking" (P & I) */
  piGain: number;
  /** simplified_i_gain — "Drift / Wobble" */
  iGain: number;
  /** simplified_d_max_gain — "Dynamic damping" */
  dMaxGain: number;
  /** simplified_feedforward_gain — "Stick response" */
  ffGain: number;
  /** simplified_roll_pitch_ratio — "Pitch damping" */
  pitchDGain: number;
  /** simplified_pitch_pi_gain — "Pitch tracking" */
  pitchPiGain: number;
  /** simplified_gyro_filter_multiplier */
  gyroFilter: number;
  /** simplified_dterm_filter_multiplier */
  dtermFilter: number;
}

export const SIMPLIFIED_DEFAULTS: SimplifiedTuning = {
  master: 100,
  dGain: 100,
  piGain: 100,
  iGain: 100,
  dMaxGain: 100,
  ffGain: 100,
  pitchDGain: 100,
  pitchPiGain: 100,
  gyroFilter: 100,
  dtermFilter: 100,
};

/** simplified_tuning.h limits. */
export const SIMPLIFIED_TUNING_PIDS_MIN = 0;
export const SIMPLIFIED_TUNING_FILTERS_MIN = 10;
export const SIMPLIFIED_TUNING_MAX = 200;
/** pid.h PID_GAIN_MAX, F_GAIN_MAX (pid.h: 1000). */
export const PID_GAIN_MAX = 250;
export const F_GAIN_MAX = 1000;
/** gyro.h DYN_LPF_MAX_HZ, filter.h LPF_MAX_HZ. */
const DYN_LPF_MAX_HZ = 1000;
const LPF_MAX_HZ = 1000;
/** pid.h D_MAX_DEFAULT {roll, pitch, yaw}. */
export const D_MAX_DEFAULT = { roll: 40, pitch: 46 } as const;

const f32 = Math.fround;
/** C `constrain(int amt, int lo, int hi)` with implicit float → int truncation. */
const constrainInt = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.trunc(x)));

export interface AxisGains extends PidGains {
  dMax: number;
}

/** simplified_tuning.c calculateNewPidValues() for roll or pitch. */
export function simplifiedPids(s: SimplifiedTuning, axis: 'roll' | 'pitch'): AxisGains {
  const def = axis === 'roll' ? BF_DEFAULT_ROLL : BF_DEFAULT_PITCH;
  const dMaxDef = axis === 'roll' ? D_MAX_DEFAULT.roll : D_MAX_DEFAULT.pitch;
  const masterMultiplier = f32(s.master / 100);
  const piGain = f32(s.piGain / 100);
  const dGain = f32(s.dGain / 100);
  const feedforwardGain = f32(s.ffGain / 100);
  const iGain = f32(s.iGain / 100);
  const pitchDGain = axis === 'pitch' ? f32(s.pitchDGain / 100) : 1;
  const pitchPiGain = axis === 'pitch' ? f32(s.pitchPiGain / 100) : 1;

  const mul = (...xs: number[]) => xs.reduce((a, b) => f32(a * b));
  const p = constrainInt(mul(def.p, masterMultiplier, piGain, pitchPiGain), 0, PID_GAIN_MAX);
  const i = constrainInt(mul(def.i, masterMultiplier, piGain, iGain, pitchPiGain), 0, PID_GAIN_MAX);
  const d = constrainInt(mul(def.d, masterMultiplier, dGain, pitchDGain), 0, PID_GAIN_MAX);
  const f = constrainInt(mul(def.f, masterMultiplier, pitchPiGain, feedforwardGain), 0, F_GAIN_MAX);
  const dMaxSlider = f32(s.dMaxGain / 100);
  const dMaxGain = dMaxDef > 0 ? f32(dMaxSlider + f32(f32(f32(1 - dMaxSlider) * def.d) / dMaxDef)) : 1;
  const dMax = constrainInt(mul(dMaxDef, masterMultiplier, dGain, pitchDGain, dMaxGain), 0, PID_GAIN_MAX);
  return { p, i, d, f, dMax };
}

/** C integer arithmetic `DEFAULT * multiplier / 100`. */
const scaleHz = (def: number, mult: number, max: number) =>
  constrainInt(Math.trunc((def * mult) / 100), 0, max);

/**
 * simplified_tuning.c calculateNewGyroFilterValues() / calculateNewDTermFilterValues():
 * returns a filter config whose LPF cutoffs follow the multipliers (types and RPM untouched).
 */
export function simplifiedFilters(s: SimplifiedTuning, base: FilterConfig): FilterConfig {
  const out: FilterConfig = structuredClone(base);
  const g = s.gyroFilter;
  const d = s.dtermFilter;
  const dg = DEFAULT_FILTERS;
  if (out.gyroLpf1.enabled) {
    out.gyroLpf1.minHz = scaleHz(dg.gyroLpf1.minHz, g, DYN_LPF_MAX_HZ);
    out.gyroLpf1.maxHz = scaleHz(dg.gyroLpf1.maxHz, g, DYN_LPF_MAX_HZ);
    out.gyroLpf1.staticHz = scaleHz(dg.gyroLpf1.staticHz, g, DYN_LPF_MAX_HZ);
  }
  if (out.gyroLpf2.enabled) out.gyroLpf2.staticHz = scaleHz(dg.gyroLpf2.staticHz, g, LPF_MAX_HZ);
  if (out.dtermLpf1.enabled) {
    out.dtermLpf1.minHz = scaleHz(dg.dtermLpf1.minHz, d, DYN_LPF_MAX_HZ);
    out.dtermLpf1.maxHz = scaleHz(dg.dtermLpf1.maxHz, d, DYN_LPF_MAX_HZ);
    out.dtermLpf1.staticHz = scaleHz(dg.dtermLpf1.staticHz, d, DYN_LPF_MAX_HZ);
  }
  if (out.dtermLpf2.enabled) out.dtermLpf2.staticHz = scaleHz(dg.dtermLpf2.staticHz, d, LPF_MAX_HZ);
  return out;
}

/** Slider metadata for the UI (labels follow the Betaflight Configurator PID tab). */
export const SLIDER_META: {
  key: keyof SimplifiedTuning;
  label: string;
  hint: string;
  min: number;
  max: number;
}[] = [
  {
    key: 'master',
    label: 'Master multiplier',
    hint: 'Scales P, I, D, D-max and FF together. Raise in 0.2 steps on a fresh pack; stop when latency stops improving, motors get hot, oscillation appears or D-term noise passes ≈ −10 dB.',
    min: 0,
    max: 200,
  },
  {
    key: 'dGain',
    label: 'Damping (P:D balance)',
    hint: 'Scales D (and D-max). Sweep 0.6 → 1.4 in wobble tests until overshoot disappears. More D = more damping, but more D-term noise and motor heat.',
    min: 0,
    max: 200,
  },
  {
    key: 'piGain',
    label: 'Tracking (P & I)',
    hint: 'Scales P and I together — how hard the quad pulls gyro towards setpoint.',
    min: 0,
    max: 200,
  },
  {
    key: 'iGain',
    label: 'Drift – wobble (I)',
    hint: 'Scales I only. I fights constant disturbances (CG offset, wind). About 1.0 is fine; it has a wide, non-linear window.',
    min: 0,
    max: 200,
  },
  {
    key: 'dMaxGain',
    label: 'Dynamic damping (D-max)',
    hint: 'How far D can rise towards D-max on fast moves. The masterclass leaves it off unless needed. Not simulated until M4 — the D-max number is shown for reference.',
    min: 0,
    max: 200,
  },
  {
    key: 'ffGain',
    label: 'Stick response (FF)',
    hint: 'Scales feed-forward. 0.5–1.0 is typical; 1.0 cuts latency a lot but can make motors hot on heavy quads with snappy inputs.',
    min: 0,
    max: 200,
  },
  {
    key: 'pitchDGain',
    label: 'Pitch damping',
    hint: 'Extra D on pitch (pitch usually has more inertia — battery/GoPro along the pitch axis). Pitch axis is simulated from M4.',
    min: 0,
    max: 200,
  },
  {
    key: 'pitchPiGain',
    label: 'Pitch tracking',
    hint: 'Extra P/I/FF on pitch. Pitch axis is simulated from M4.',
    min: 0,
    max: 200,
  },
];
