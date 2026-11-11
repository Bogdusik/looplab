import { Pt1, pt1FilterGainFromDelay, Pt3, pt3FilterGain } from './filters.ts';
import { actualRate } from './rates.ts';
import type { RatesConfig, RcConfig } from './types.ts';

/** rx.h rcUsSpanToNorm(): 1000 µs PWM range maps onto the normalised −1..1 range. */
export const rcUsSpanToNorm = (us: number) => (us * 2) / 1000;

/** RC channel resolution used for quantisation (1 µs). */
export const RC_RESOLUTION = rcUsSpanToNorm(1);

/** rc.c rcSmoothingSetFilterCutoffs(): auto cutoff from link rate. */
export function rcSmoothingCutoffHz(packetHz: number, autoFactor: number): number {
  const factor = 1.5 / (1 + autoFactor / 10);
  return Math.max(15, packetHz * factor);
}

/** pid_init.c: feedforward_smooth_factor → PT1 time constant normalised to 250 Hz links. */
export function ffSmoothingTau(smoothFactor: number): number {
  const s = 0.01 * smoothFactor;
  const rxDt = 1 / 250;
  return (rxDt * s) / (1 - s);
}

/** common/filter.c laggedMovingAverageUpdate(). */
class LaggedMovingAverage {
  private buf: Float64Array;
  private idx = 0;
  private primed = false;
  private sum = 0;
  constructor(window: number) {
    this.buf = new Float64Array(window);
  }
  update(x: number): number {
    this.sum += x;
    if (this.primed) this.sum -= this.buf[this.idx]!;
    this.buf[this.idx] = x;
    this.idx++;
    if (this.idx >= this.buf.length) {
      this.idx = 0;
      this.primed = true;
    }
    const denom = this.primed ? this.buf.length : this.idx;
    return this.sum / denom;
  }
}

/**
 * One axis of the RC pipeline: rcCommand → ACTUAL rates → feedforward (per packet), then
 * RC smoothing (per PID loop). Ports `src/main/fc/rc.c`:
 *   processRcCommand(), calculateFeedforward(), processRcSmoothingFilter().
 *
 * Simplifications (documented in docs/MODEL.md):
 *  - The link is assumed stable, so smoothedRxRateHz = currentRxRateHz = packetHz.
 *  - CRSF/ELRS path: `feedforwardInterpolate` is false for CRSF (pid_init.c), so duplicate-packet
 *    extrapolation is not modelled.
 *  - Roll/pitch only (no yaw hold term), feedforward_transition = 0.
 */
export class RcAxis {
  private rates: RatesConfig;
  private cfg: RcConfig;
  private pidDt: number;

  rcCommand = 0;
  rawSetpoint = 0;
  feedforwardRaw = 0;
  setpoint = 0;
  feedforward = 0;

  private prevRcCommand = 0;
  private prevSetpoint = 0;
  private prevSetpointSpeed = 0;
  private prevRcCommandDeltaAbs = 0;
  private speedFilter: Pt1;
  private deltaFilter: Pt1;
  private avg: LaggedMovingAverage | null;
  private spSmooth: Pt3;
  private ffSmooth: Pt3;
  private maxRcRate: number;
  private jitterInv: number;
  private boostFactor: number;

  constructor(rates: RatesConfig, cfg: RcConfig, pidDt: number) {
    this.rates = rates;
    this.cfg = cfg;
    this.pidDt = pidDt;
    const k = pt1FilterGainFromDelay(ffSmoothingTau(cfg.ffSmoothFactor), 1 / cfg.packetHz);
    this.speedFilter = new Pt1(k);
    this.deltaFilter = new Pt1(k);
    this.avg = cfg.ffAveraging > 0 ? new LaggedMovingAverage(cfg.ffAveraging + 1) : null;
    const kSp = pt3FilterGain(rcSmoothingCutoffHz(cfg.packetHz, cfg.autoFactor), pidDt);
    this.spSmooth = new Pt3(kSp);
    this.ffSmooth = new Pt3(kSp);
    this.maxRcRate = actualRate(1, rates);
    this.jitterInv = 1 / rcUsSpanToNorm(1 + cfg.ffJitterFactor);
    this.boostFactor = 0.001 * cfg.ffBoost;
  }

  get smoothingCutoffHz(): number {
    return rcSmoothingCutoffHz(this.cfg.packetHz, this.cfg.autoFactor);
  }

  /** New RX packet: rc.c processRcCommand() for one axis. */
  onPacket(rcCommand: number): void {
    this.rcCommand = rcCommand;
    this.rawSetpoint = actualRate(rcCommand, this.rates);
    this.calculateFeedforward();
  }

  /** rc.c calculateFeedforward() — non-interpolated (CRSF) path, roll/pitch branch. */
  private calculateFeedforward(): void {
    const rxRate = this.cfg.packetHz;
    const rcCommandDeltaAbs = Math.abs(this.rcCommand - this.prevRcCommand);
    const setpoint = this.rawSetpoint;
    const setpointDelta = setpoint - this.prevSetpoint;
    this.prevRcCommand = this.rcCommand;
    this.prevSetpoint = setpoint;

    let setpointSpeed = setpointDelta * rxRate;

    let jitterAttenuator =
      ((rcCommandDeltaAbs + this.prevRcCommandDeltaAbs) * 0.5 + rcUsSpanToNorm(1)) * this.jitterInv;
    jitterAttenuator = Math.min(jitterAttenuator, 1);
    this.prevRcCommandDeltaAbs = rcCommandDeltaAbs;

    setpointSpeed = this.speedFilter.apply(setpointSpeed);
    let setpointSpeedDelta = setpointSpeed - this.prevSetpointSpeed;
    this.prevSetpointSpeed = setpointSpeed;
    setpointSpeedDelta = this.deltaFilter.apply(setpointSpeedDelta);

    const feedforwardBoost = setpointSpeedDelta * rxRate * this.boostFactor;
    let feedforward = setpointSpeed + feedforwardBoost;
    feedforward *= jitterAttenuator;
    // feedforward_max_rate_limit is used unscaled in rc.c (units: 1/s against deg/s headroom).
    if (this.cfg.ffMaxRateLimit && feedforward * setpoint > 0) {
      const limit = (this.maxRcRate - Math.abs(setpoint)) * this.cfg.ffMaxRateLimit;
      feedforward = limit > 0 ? Math.max(-limit, Math.min(limit, feedforward)) : 0;
    }
    if (this.avg) feedforward = this.avg.update(feedforward);
    this.feedforwardRaw = feedforward;
  }

  /** Every PID loop: rc.c processRcSmoothingFilter() + getSetpointRate()/getFeedforward(). */
  tick(): void {
    if (this.cfg.smoothing) {
      this.setpoint = this.spSmooth.apply(this.rawSetpoint);
      this.feedforward = this.ffSmooth.apply(this.feedforwardRaw);
    } else {
      this.setpoint = this.rawSetpoint;
      this.feedforward = this.feedforwardRaw;
    }
  }

  get dt(): number {
    return this.pidDt;
  }
}

/** Quantise a stick value the way an RC link does (1 µs steps), clamped to −1..1. */
export function quantiseStick(stick: number): number {
  const s = Math.max(-1, Math.min(1, stick));
  return Math.round(s / RC_RESOLUTION) * RC_RESOLUTION;
}
