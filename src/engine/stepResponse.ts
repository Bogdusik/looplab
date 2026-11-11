import { BfSim } from './bfsim.ts';
import { stepMetrics, type StepMetrics } from './metrics.ts';
import { stickForRate } from './rates.ts';
import type { BfParams } from './types.ts';

export interface StepOptions {
  /** Step size, deg/s. */
  amplitude: number;
  /** Include RC smoothing (setpoint PT3) in the path. */
  rcSmoothing: boolean;
  /** Include feedforward (FF distorts a "step" — see docs/MODEL.md). */
  feedforward: boolean;
  /** Window after the step, s. */
  durationS: number;
  /** Window before the step, s. */
  preS: number;
  /** Output decimation (1 = every gyro sample). */
  decimate: number;
}

export const DEFAULT_STEP_OPTIONS: StepOptions = {
  amplitude: 200,
  rcSmoothing: false,
  feedforward: false,
  durationS: 0.3,
  preS: 0.02,
  decimate: 2,
};

export interface StepResult {
  t: Float32Array;
  setpoint: Float32Array;
  gyro: Float32Array;
  metrics: StepMetrics;
  amplitude: number;
}

/**
 * "Ideal" step response: noise off, full pipeline (RC link → rates → [RC smoothing] → PID →
 * mixer → motors → plant → gyro filters). The step is aligned with an RX packet, and time zero is
 * that packet. The response is the filtered gyro, as a Blackbox log would show it.
 */
export function idealStepResponse(base: BfParams, opts: StepOptions = DEFAULT_STEP_OPTIONS): StepResult {
  const params: BfParams = structuredClone(base);
  params.noiseEnabled = false;
  params.rc.smoothing = opts.rcSmoothing;
  if (!opts.feedforward) params.pid.gains.f = 0;
  const sim = new BfSim(params);
  // settle (filters/I in steady hover)
  sim.run(Math.round(0.1 / sim.h));
  const preSteps = Math.round(opts.preS / sim.h);
  const postSteps = Math.round(opts.durationS / sim.h);
  const n = Math.floor((preSteps + postSteps) / opts.decimate);
  const t = new Float32Array(n);
  const sp = new Float32Array(n);
  const gy = new Float32Array(n);
  const stick = stickForRate(opts.amplitude, params.rates);
  let k = 0;
  const record = (i: number) => {
    if (i % opts.decimate === 0 && k < n) {
      t[k] = (i - preSteps) * sim.h;
      sp[k] = sim.out.setpointRaw;
      gy[k] = sim.out.gyroFilt;
      k++;
    }
  };
  for (let i = 0; i < preSteps; i++) {
    sim.step();
    record(i);
  }
  sim.alignPacket();
  sim.setStick(stick);
  for (let i = preSteps; i < preSteps + postSteps; i++) {
    sim.step();
    record(i);
  }
  const target = sim.out.setpointRaw;
  // time 0 = the step packet; the sample stored at index preSteps ends at +h
  const metrics = stepMetrics(t, gy, 0, target, 0);
  return { t, setpoint: sp, gyro: gy, metrics, amplitude: target };
}
