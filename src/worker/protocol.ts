import type { ClassicParams } from '../engine/classic.ts';
import type { StepMetrics } from '../engine/metrics.ts';
import type { BfInfo } from '../engine/bfsim.ts';
import type { BfParams } from '../engine/types.ts';

export type Mode = 'bf' | 'classic';

/** Scope channels streamed from the worker (order = index into `frame.channels`). */
export const BF_CHANNELS = [
  'setpoint',
  'gyroFilt',
  'gyroRaw',
  'p',
  'i',
  'd',
  'f',
  'motorL',
  'motorR',
] as const;
export const CLASSIC_CHANNELS = ['target', 'pos', 'meas', 'p', 'i', 'd', 'ff', 'force'] as const;
export type BfChannel = (typeof BF_CHANNELS)[number];
export type ClassicChannel = (typeof CLASSIC_CHANNELS)[number];

/** Scope sample rate (Hz) for both modes. */
export const SCOPE_HZ = 1000;
/** Spectrum analysis rate ("Blackbox log rate"). */
export const SPECTRUM_FS = 4000;

export interface StepOptionsMsg {
  feedforward: boolean;
  rcSmoothing: boolean;
}

export type ToWorker =
  | { type: 'params'; mode: Mode; bf: BfParams; classic: ClassicParams }
  | { type: 'stick'; value: number }
  | { type: 'control'; paused: boolean; speed: number }
  | { type: 'reset' }
  | { type: 'stepOptions'; options: StepOptionsMsg };

export interface FrameMsg {
  type: 'frame';
  mode: Mode;
  /** Sim time of the first sample, s. */
  t0: number;
  /** Sample spacing, s. */
  dt: number;
  n: number;
  channels: Float32Array[];
  /** Latest values for the stick-track follower and attitude view. */
  follower: number;
  setpoint: number;
  angle: number;
}

export interface StepMsg {
  type: 'step';
  mode: Mode;
  t: Float32Array;
  setpoint: Float32Array;
  y: Float32Array;
  metrics: StepMetrics;
  amplitude: number;
  options: StepOptionsMsg;
}

export interface SpectrumMsg {
  type: 'spectrum';
  f: Float32Array;
  pre: Float32Array;
  post: Float32Array;
  dterm: Float32Array;
  /** Mean motor fundamental per side, Hz. */
  motorHz: [number, number];
  rpmMinHz: number | null;
  seconds: number;
}

export interface StatusMsg {
  type: 'status';
  mode: Mode;
  t: number;
  tempL: number;
  tempR: number;
  /** Fraction of PID loops saturated over the last status interval. */
  saturation: number;
  hzL: number;
  hzR: number;
  heat: number;
  info: BfInfo | null;
}

export type FromWorker = FrameMsg | StepMsg | SpectrumMsg | StatusMsg;
