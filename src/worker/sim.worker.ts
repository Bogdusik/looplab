/// <reference lib="webworker" />
import { BfSim } from '../engine/bfsim.ts';
import { classicStepResponse, ClassicSim, type ClassicParams } from '../engine/classic.ts';
import { Ring } from '../engine/ring.ts';
import { Runner } from '../engine/runner.ts';
import { BlackboxDecimator, DEFAULT_BLACKBOX_HZ } from '../engine/blackbox.ts';
import { spectrumNfft, toDb, welch } from '../engine/spectrum.ts';
import { DEFAULT_STEP_OPTIONS, idealStepResponse } from '../engine/stepResponse.ts';
import type { BfParams } from '../engine/types.ts';
import {
  BF_CHANNELS,
  CLASSIC_CHANNELS,
  SCOPE_HZ,
  SPECTRUM_SECONDS,
  type FromWorker,
  type Mode,
  type StepOptionsMsg,
  type ToWorker,
} from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

const TICK_MS = 16;
const MAX_FRAME_SAMPLES = 400;
const SPECTRUM_MAX_HZ = 1000;

let mode: Mode = 'bf';
let bfParams: BfParams | null = null;
let classicParams: ClassicParams | null = null;
let bf: BfSim | null = null;
let classic: ClassicSim | null = null;
let runner: Runner<BfSim> | Runner<ClassicSim> | null = null;
let stick = 0;
let paused = false;
let speed = 1;
let stepOptions: StepOptionsMsg = { feedforward: false, rcSmoothing: false };
let last = performance.now();

// scope accumulation
let frameBuf: Float32Array[] = [];
let frameN = 0;
let frameT0 = 0;
let decim = 8;

// spectrum: plain Blackbox-style decimation to the log rate
let blackboxHz: number = DEFAULT_BLACKBOX_HZ;
let decimator = new BlackboxDecimator(8000, blackboxHz);
let preRing = new Ring(SPECTRUM_SECONDS * blackboxHz);
let postRing = new Ring(SPECTRUM_SECONDS * blackboxHz);
let dRing = new Ring(SPECTRUM_SECONDS * blackboxHz);

function resetSpectrum(gyroHz: number) {
  decimator = new BlackboxDecimator(gyroHz, blackboxHz);
  const cap = Math.round(SPECTRUM_SECONDS * decimator.logHz);
  preRing = new Ring(cap);
  postRing = new Ring(cap);
  dRing = new Ring(cap);
}
let lastSpectrum = 0;

// status accumulation
let satCount = 0;
let pidCount = 0;
let lastStatus = 0;

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

function allocFrame(nch: number) {
  frameBuf = Array.from({ length: nch }, () => new Float32Array(MAX_FRAME_SAMPLES));
  frameN = 0;
}

function rebuild(keepThermal = false) {
  if (!bfParams || !classicParams) return;
  resetSpectrum(bfParams.loop.gyroHz);
  if (mode === 'bf') {
    const prev = bf;
    bf = new BfSim(bfParams);
    if (keepThermal && prev) {
      bf.thermalL.tempC = prev.thermalL.tempC;
      bf.thermalR.tempC = prev.thermalR.tempC;
    }
    classic = null;
    runner = new Runner(bf);
    decim = Math.round(bfParams.loop.gyroHz / SCOPE_HZ);
    allocFrame(BF_CHANNELS.length);
  } else {
    classic = new ClassicSim(classicParams, stick * 100);
    bf = null;
    runner = new Runner(classic);
    decim = Math.max(1, Math.round(1 / classic.h / SCOPE_HZ));
    allocFrame(CLASSIC_CHANNELS.length);
  }
  runner.paused = paused;
  runner.speed = speed;
  frameT0 = 0;
  sendStatus(true);
}

let stepTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleStep() {
  if (stepTimer) clearTimeout(stepTimer);
  stepTimer = setTimeout(computeStep, 120);
}

function computeStep() {
  stepTimer = null;
  if (mode === 'bf' && bfParams) {
    const r = idealStepResponse(bfParams, {
      ...DEFAULT_STEP_OPTIONS,
      feedforward: stepOptions.feedforward,
      rcSmoothing: stepOptions.rcSmoothing,
    });
    post(
      {
        type: 'step',
        mode,
        t: r.t,
        setpoint: r.setpoint,
        y: r.gyro,
        metrics: r.metrics,
        amplitude: r.amplitude,
        options: stepOptions,
      },
      [r.t.buffer, r.setpoint.buffer, r.gyro.buffer],
    );
  } else if (mode === 'classic' && classicParams) {
    const r = classicStepResponse(classicParams);
    post(
      {
        type: 'step',
        mode,
        t: r.t,
        setpoint: r.target,
        y: r.pos,
        metrics: r.metrics,
        amplitude: 50,
        options: stepOptions,
      },
      [r.t.buffer, r.target.buffer, r.pos.buffer],
    );
  }
}

function flushFrame() {
  if (frameN === 0) return;
  const channels = frameBuf.map((b) => b.slice(0, frameN));
  let follower = 0;
  let setpoint = 0;
  let angle = 0;
  if (bf) {
    follower = bf.out.gyroFilt;
    setpoint = bf.out.setpoint;
    angle = bf.out.angle;
  } else if (classic) {
    follower = classic.out.pos;
    setpoint = classic.out.target;
  }
  post(
    {
      type: 'frame',
      mode,
      t0: frameT0,
      dt: 1 / SCOPE_HZ,
      n: frameN,
      channels,
      follower,
      setpoint,
      angle,
    },
    channels.map((c) => c.buffer),
  );
  frameN = 0;
}

function sendSpectrum() {
  const fs = decimator.logHz;
  const nfft = spectrumNfft(fs);
  if (!bf || preRing.length < nfft * 2) return;
  const pre = welch(preRing.toArray(), fs, nfft);
  const postS = welch(postRing.toArray(), fs, nfft);
  const dS = welch(dRing.toArray(), fs, nfft);
  const bins = pre.f.findIndex((f) => f > Math.min(SPECTRUM_MAX_HZ, fs / 2));
  const n = bins < 0 ? pre.f.length : bins;
  const f = new Float32Array(n);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  const c = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    f[k] = pre.f[k]!;
    a[k] = toDb(pre.psd[k]!);
    b[k] = toDb(postS.psd[k]!);
    c[k] = toDb(dS.psd[k]!);
  }
  const rpm = bfParams!.filters.rpm;
  post(
    {
      type: 'spectrum',
      f,
      pre: a,
      post: b,
      dterm: c,
      motorHz: [bf.out.hzL, bf.out.hzR],
      rpmMinHz: rpm.enabled ? rpm.minHz : null,
      seconds: preRing.length / fs,
      fs,
    },
    [f.buffer, a.buffer, b.buffer, c.buffer],
  );
}

function sendStatus(withInfo = false) {
  const s = bf?.out;
  post({
    type: 'status',
    mode,
    t: runner ? runner.simTime : 0,
    tempL: s?.tempL ?? 0,
    tempR: s?.tempR ?? 0,
    saturation: pidCount ? satCount / pidCount : 0,
    hzL: s?.hzL ?? 0,
    hzR: s?.hzR ?? 0,
    heat: classic?.out.heat ?? 0,
    info: withInfo || bf ? (bf?.info ?? null) : null,
  });
  satCount = 0;
  pidCount = 0;
}

function tick() {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  if (!runner) return;
  if (frameN === 0) frameT0 = runner.simTime;
  if (bf) {
    const sim = bf;
    const r = runner as Runner<BfSim>;
    r.frame(
      dt,
      () => sim.setStick(stick),
      (s) => {
        const i = Math.round(s.out.t / s.h);
        const o = s.out;
        if (o.pidTick) {
          pidCount++;
          satCount += o.saturated;
        }
        if (decimator.tick()) {
          preRing.push(o.gyroRaw);
          postRing.push(o.gyroFilt);
          dRing.push(o.d);
        }
        if (i % decim === 0 && frameN < MAX_FRAME_SAMPLES) {
          const v = [o.setpoint, o.gyroFilt, o.gyroRaw, o.p, o.i, o.d, o.f, o.motorL, o.motorR];
          for (let c = 0; c < v.length; c++) frameBuf[c]![frameN] = v[c]!;
          frameN++;
        }
      },
    );
  } else if (classic) {
    const sim = classic;
    const r = runner as Runner<ClassicSim>;
    r.frame(
      dt,
      () => sim.setHandle(stick * 100),
      (s) => {
        const i = Math.round(s.out.t / s.h);
        const o = s.out;
        if (i % decim === 0 && frameN < MAX_FRAME_SAMPLES) {
          const v = [o.target, o.pos, o.meas, o.p, o.i, o.d, o.ff, o.force];
          for (let c = 0; c < v.length; c++) frameBuf[c]![frameN] = v[c]!;
          frameN++;
        }
      },
    );
  }
  flushFrame();
  if (now - lastSpectrum > 500) {
    lastSpectrum = now;
    sendSpectrum();
  }
  if (now - lastStatus > 100) {
    lastStatus = now;
    sendStatus();
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'params': {
      const modeChanged = m.mode !== mode;
      mode = m.mode;
      bfParams = m.bf;
      classicParams = m.classic;
      rebuild(!modeChanged);
      scheduleStep();
      if (modeChanged) frameN = 0;
      break;
    }
    case 'stick':
      stick = Math.max(-1, Math.min(1, m.value));
      break;
    case 'control':
      paused = m.paused;
      speed = m.speed;
      if (runner) {
        runner.paused = paused;
        runner.speed = speed;
      }
      break;
    case 'reset':
      rebuild();
      break;
    case 'analysis':
      blackboxHz = m.blackboxHz;
      if (bfParams) resetSpectrum(bfParams.loop.gyroHz);
      break;
    case 'stepOptions':
      stepOptions = m.options;
      scheduleStep();
      break;
  }
};

setInterval(tick, TICK_MS);
