import { groupDelay } from './filters.ts';
import { dtermChainSpecs, GyroChain, gyroChainSpecs } from './gyro.ts';
import { GyroNoise } from './noise.ts';
import { BfPid, PID_MIXER_SCALING } from './pid.ts';
import { mixAxis, motorOutput, RigidAxis, MOTOR_SIDE } from './plant.ts';
import { quantiseStick, RcAxis } from './rc.ts';
import { MotorThermal } from './thermal.ts';
import type { BfParams } from './types.ts';

const RAD2DEG = 180 / Math.PI;

/** Everything the UI / analysis may want from one physics step. PID-rate values hold between loops. */
export interface BfOut {
  t: number;
  stick: number;
  rcCommand: number;
  setpointRaw: number;
  setpoint: number;
  feedforward: number;
  /** True body rate, deg/s. */
  gyroTrue: number;
  /** Pre-filter gyro (true + noise), deg/s. */
  gyroRaw: number;
  /** Filtered gyro (gyroADCf), deg/s. */
  gyroFilt: number;
  dtermInput: number;
  p: number;
  i: number;
  d: number;
  f: number;
  sum: number;
  /** Motor outputs (0..1 of full speed) left / right side. */
  motorL: number;
  motorR: number;
  /** Mean motor rotation frequency per side, Hz. */
  hzL: number;
  hzR: number;
  tempL: number;
  tempR: number;
  saturated: number;
  /** Attitude, deg. */
  angle: number;
  pidTick: number;
}

export interface BfInfo {
  massKg: number;
  jRoll: number;
  jPitch: number;
  twr: number;
  hoverHz: number;
  pidHz: number;
  gyroHz: number;
  /** Group delay at 100 Hz, ms. */
  gyroDelayMs: number;
  dtermDelayMs: number;
  rcSmoothingHz: number;
  trimU: number;
}

/**
 * Betaflight-mode single-axis simulator (roll).
 * One `step()` = one gyro sample (physics h = 1/gyroHz); the PID runs every `pidDenom` samples.
 * Deterministic: output depends only on params, seed and the per-step stick sequence.
 */
export class BfSim {
  readonly params: BfParams;
  readonly h: number;
  readonly pidDt: number;
  readonly plant: RigidAxis;
  readonly rc: RcAxis;
  readonly pid: BfPid;
  readonly gyro: GyroChain;
  readonly noise: GyroNoise;
  readonly thermalL: MotorThermal;
  readonly thermalR: MotorThermal;
  readonly out: BfOut;
  readonly info: BfInfo;

  private stepIndex = 0;
  private stick = 0;
  private latched = 0;
  private rxNew = false;
  private packetPhase = 0;
  private readonly delayL: Float64Array;
  private readonly delayR: Float64Array;
  private delayIdx = 0;
  private cmdL: number;
  private cmdR: number;
  private readonly motorHz = new Float64Array(4);

  constructor(params: BfParams) {
    this.params = params;
    const { loop, drone } = params;
    this.h = 1 / loop.gyroHz;
    this.pidDt = this.h * loop.pidDenom;
    const T0 = drone.hoverThrottle;
    this.plant = new RigidAxis(drone, this.h);
    const hoverHz = this.plant.mm.omegaHover / (2 * Math.PI);
    this.rc = new RcAxis(params.rates, params.rc, this.pidDt);
    this.pid = new BfPid(params.pid, params.filters.dtermLpf1, params.filters.dtermLpf2, T0, this.pidDt);
    this.gyro = new GyroChain(params.filters, T0, this.h, this.pidDt, hoverHz);
    this.noise = new GyroNoise(drone.noise, this.h, this.plant.mm.omegaHover, params.seed);

    // start in trimmed hover: I-term already holds the CG torque, motors settled
    const trimU = this.trimDifferential();
    const trim = mixAxis(T0, trimU);
    this.cmdL = trim.left;
    this.cmdR = trim.right;
    this.plant.settle(trim.left, trim.right);
    this.pid.prime(0, trimU * PID_MIXER_SCALING);

    const n = Math.max(1, Math.round(drone.transportDelayS / this.h));
    this.delayL = new Float64Array(n).fill(trim.left);
    this.delayR = new Float64Array(n).fill(trim.right);

    this.thermalL = new MotorThermal(drone.thermal, this.pidDt, motorOutput(trim.left, drone.idle));
    this.thermalR = new MotorThermal(drone.thermal, this.pidDt, motorOutput(trim.right, drone.idle));

    const pidHz = 1 / this.pidDt;
    const motorHzNow = [0, 1, 2, 3].map((m) => this.plant.motorHz(m));
    this.info = {
      massKg: this.plant.mass.totalKg,
      jRoll: this.plant.mass.jRoll,
      jPitch: this.plant.mass.jPitch,
      twr: this.plant.mm.twr,
      hoverHz,
      pidHz,
      gyroHz: loop.gyroHz,
      gyroDelayMs: 1000 * groupDelay(gyroChainSpecs(params.filters, T0, loop.gyroHz, pidHz, motorHzNow), 100),
      dtermDelayMs: 1000 * groupDelay(dtermChainSpecs(params.filters, T0, pidHz), 100),
      rcSmoothingHz: this.rc.smoothingCutoffHz,
      trimU,
    };
    for (let m = 0; m < 4; m++) this.motorHz[m] = this.plant.motorHz(m);
    this.out = {
      t: 0,
      stick: 0,
      rcCommand: 0,
      setpointRaw: 0,
      setpoint: 0,
      feedforward: 0,
      gyroTrue: 0,
      gyroRaw: 0,
      gyroFilt: 0,
      dtermInput: 0,
      p: 0,
      i: this.pid.iterm,
      d: 0,
      f: 0,
      sum: this.pid.iterm,
      motorL: motorOutput(trim.left, drone.idle),
      motorR: motorOutput(trim.right, drone.idle),
      hzL: (motorHzNow[2]! + motorHzNow[3]!) / 2,
      hzR: (motorHzNow[0]! + motorHzNow[1]!) / 2,
      tempL: this.thermalL.tempC,
      tempR: this.thermalR.tempC,
      saturated: 0,
      angle: 0,
      pidTick: 0,
    };
  }

  /** Differential u (mixer units) whose steady motor torque cancels the CG torque. */
  private trimDifferential(): number {
    const { kT, armY, omegaMax } = this.plant.mm;
    const d = this.params.drone;
    const torqueAt = (u: number) => {
      const m = mixAxis(d.hoverThrottle, u);
      const wl = motorOutput(m.left, d.idle) * omegaMax;
      const wr = motorOutput(m.right, d.idle) * omegaMax;
      return 2 * armY * kT * (wl * wl - wr * wr) + this.plant.tauCg;
    };
    let lo = -0.5;
    let hi = 0.5;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (torqueAt(mid) > 0) hi = mid;
      else lo = mid;
    }
    return 0.5 * (lo + hi);
  }

  setStick(x: number): void {
    this.stick = x;
  }

  /** Make the next step a packet arrival (used to align analysis steps with the link). */
  alignPacket(): void {
    this.packetPhase = this.params.loop.gyroHz;
  }

  get time(): number {
    return this.stepIndex * this.h;
  }

  step(): void {
    const { loop, rc, drone } = this.params;
    const o = this.out;

    // RC link: sample-and-hold at packet rate (integer phase accumulator → exact, deterministic)
    this.packetPhase += rc.packetHz;
    if (this.packetPhase >= loop.gyroHz) {
      this.packetPhase -= loop.gyroHz;
      this.latched = quantiseStick(this.stick);
      this.rxNew = true;
    }

    // actuators: transport delay line, then motors + rigid body
    const di = this.delayIdx;
    const cl = this.delayL[di]!;
    const cr = this.delayR[di]!;
    this.delayL[di] = this.cmdL;
    this.delayR[di] = this.cmdR;
    this.delayIdx = (di + 1) % this.delayL.length;
    this.plant.step(cl, cr);

    // sensor
    const rateDeg = this.plant.rate * RAD2DEG;
    const raw = this.params.noiseEnabled ? rateDeg + this.noise.sample(this.plant.omega) : rateDeg;
    this.gyro.sample(raw);

    o.pidTick = 0;
    if (this.stepIndex % loop.pidDenom === 0) {
      o.pidTick = 1;
      if (this.rxNew) {
        this.rc.onPacket(this.latched);
        this.rxNew = false;
      }
      this.rc.tick();
      for (let m = 0; m < 4; m++) this.motorHz[m] = this.plant.motorHz(m);
      const gf = this.gyro.run(this.motorHz);
      const t = this.pid.update(this.rc.setpoint, this.rc.feedforward, gf);
      const limit = this.params.pid.pidSumLimit;
      const u = Math.max(-limit, Math.min(limit, t.sum)) / PID_MIXER_SCALING;
      const mix = mixAxis(drone.hoverThrottle, u);
      this.cmdL = mix.left;
      this.cmdR = mix.right;
      const outL = motorOutput(mix.left, drone.idle);
      const outR = motorOutput(mix.right, drone.idle);
      this.thermalL.update(outL);
      this.thermalR.update(outR);

      o.rcCommand = this.rc.rcCommand;
      o.setpointRaw = this.rc.rawSetpoint;
      o.setpoint = this.rc.setpoint;
      o.feedforward = this.rc.feedforward;
      o.gyroFilt = gf;
      o.dtermInput = t.dtermInput;
      o.p = t.p;
      o.i = t.i;
      o.d = t.d;
      o.f = t.f;
      o.sum = t.sum;
      o.motorL = outL;
      o.motorR = outR;
      o.saturated = mix.saturated || Math.abs(t.sum) > limit ? 1 : 0;
      o.tempL = this.thermalL.tempC;
      o.tempR = this.thermalR.tempC;
    }

    this.stepIndex++;
    o.t = this.stepIndex * this.h;
    o.stick = this.stick;
    o.gyroTrue = rateDeg;
    o.gyroRaw = raw;
    let l = 0;
    let r = 0;
    for (let m = 0; m < 4; m++) {
      if (MOTOR_SIDE[m]! > 0) r += this.plant.motorHz(m);
      else l += this.plant.motorHz(m);
    }
    o.hzL = l / 2;
    o.hzR = r / 2;
    o.angle = this.plant.angle * RAD2DEG;
  }

  /** Run `n` steps; optional callback after each. */
  run(n: number, each?: (o: BfOut) => void): void {
    for (let i = 0; i < n; i++) {
      this.step();
      each?.(this.out);
    }
  }
}
