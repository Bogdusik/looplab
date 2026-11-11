# LoopLab — implementation plan (M0–M3)

Source of truth for requirements: [SPEC.md](SPEC.md). This file is the working plan.

Betaflight reference snapshot: `betaflight/betaflight@f97bdbc` (master, 2026-11-11). Every ported
algorithm cites file + function in a code comment.

---

## 1. Milestones

| ID     | Scope                                                                                                                                                                                                | Exit criteria                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **M0** | Vite 8 + React 18 + TS strict, ESLint/Prettier, Vitest, CI + Pages deploy workflows, PLAN.md                                                                                                         | `npm run typecheck && npm run lint && npm test && npm run build` green            |
| **M1** | Pure-TS engine: clock, PRNG, rates, RC link + smoothing + FF, PID, mixer, motors, plant, gyro noise, filter library + analytic response, Classic model, metrics                                      | Tests 1–5, 7–9 green, no UI                                                       |
| **M2** | Worker protocol, stick track, canvas scope, Advanced raw gains, Classic UI, step-response panel, presets, URL state                                                                                  | App runs; scope streams; step response updates on param change                    |
| **M3** | Simplified-tuning sliders (test 6), Filters panel incl. RPM filter, Welch spectrum + reference lines, filter-delay readout, motor temp, help drawer, README/MODEL/FINDINGS, `npm run findings` plots | All tests green, build OK, docs + generated plots committed. **Stop and report.** |

M4+ is out of scope until approved.

---

## 2. Stack and versions (checked 2026-11-11)

| Package                                                                 | Version | Note                                                                        |
| ----------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| vite                                                                    | ^8.3    | Node ≥ 22.12                                                                |
| react / react-dom                                                       | 18.3.1  | spec requires 18                                                            |
| typescript                                                              | ~6.0.3  | typescript-eslint 8 supports `<6.1`; TS 7 not yet supported by lint tooling |
| vitest                                                                  | ^5.1    |                                                                             |
| zustand                                                                 | ^5.1    | UI state                                                                    |
| uplot                                                                   | ^1.6.32 | step response + spectrum charts                                             |
| eslint 10, typescript-eslint 8, eslint-plugin-react-hooks 7, prettier 3 |         |                                                                             |

- **No `fft.js`**: own iterative radix-2 FFT (≈40 lines, unit-tested) — one fewer dependency.
- **No `tsx`/`ts-node`**: `npm run findings` runs with Node's built-in type stripping
  (`node --experimental-strip-types`). Engine therefore uses only erasable TS syntax
  (`erasableSyntaxOnly`) and `.ts` import extensions (`allowImportingTsExtensions`).
- No Comlink: the worker protocol is a small typed discriminated union.

---

## 3. File tree

```
looplab/
├─ SPEC.md  PLAN.md  README.md  LICENSE (GPL-3.0)
├─ index.html  vite.config.ts  vitest.config.ts  tsconfig*.json  eslint.config.js  .prettierrc
├─ .github/workflows/ci.yml  deploy.yml
├─ scripts/
│  ├─ findings.ts            # npm run findings → docs/img/*.svg + docs/findings-data.json
│  └─ svgplot.ts             # tiny dependency-free SVG line-plot writer
├─ docs/  MODEL.md  FINDINGS.md  ROADMAP.md  img/
└─ src/
   ├─ engine/                # pure TS, zero DOM/React imports
   │  ├─ types.ts            # all param / state / sample types
   │  ├─ prng.ts             # mulberry32 + Box–Muller
   │  ├─ clock.ts            # fixed-step accumulator
   │  ├─ filters.ts          # PT1/PT2/PT3, SVF LPF, SVF notch, RPM notch, analytic H(f), group delay
   │  ├─ rates.ts            # ACTUAL rates (rc.c applyActualRates)
   │  ├─ rc.ts               # RC link sample&hold, rc smoothing (PT3 auto), feedforward (rc.c calculateFeedforward)
   │  ├─ pid.ts              # single-axis BF PID (pid.c pidController), iterm_relax, D on measurement, D-term filters
   │  ├─ motors.ts           # mixer around T0, first-order motor lag, thrust k_T·Ω²
   │  ├─ plant.ts            # mass model → inertia, rigid-body integration
   │  ├─ noise.ts            # motor harmonics + white + frame resonance
   │  ├─ gyro.ts             # gyro chain: LPF2 @ gyro rate → RPM notches → LPF1 (dynamic) @ PID rate
   │  ├─ thermal.ts          # qualitative motor temperature
   │  ├─ bfsim.ts            # Betaflight-mode simulator (composes all of the above)
   │  ├─ classic.ts          # Classic toy model + legacyFrameStepping dev flag
   │  ├─ sliders.ts          # simplified_tuning.c port
   │  ├─ presets.ts          # whoop / 5" / 7" presets, rate presets
   │  ├─ stepResponse.ts     # ideal step through full pipeline
   │  ├─ metrics.ts          # latency-50 %, rise 10–90, overshoot, settling, sse
   │  ├─ spectrum.ts         # FFT + Welch PSD (Hann, 50 %)
   │  ├─ ring.ts             # Float32 ring buffers
   │  └─ __tests__/
   ├─ worker/  protocol.ts  sim.worker.ts  host.ts (main-thread side)
   ├─ state/   store.ts  url.ts  defaults.ts
   └─ ui/      App.tsx, TopBar, StickTrack, AttitudeView, Scope, StepResponse, Spectrum,
               SlidersPanel, AdvancedPanel, FiltersPanel, DronePanel, NoisePanel, MotorTemp,
               FilterDelay, HelpDrawer, controls/ (Knob/Slider with dbl-click reset + tooltip)
```

---

## 4. Key data types (engine)

```ts
type Axis = 'roll' | 'pitch';
interface LoopConfig {
  gyroHz: 8000;
  pidDenom: 1 | 2;
} // physics h = 1/gyroHz
interface RatesConfig {
  rcRate: number;
  rate: number;
  expo: number;
} // ACTUAL: 70 / 670 / 0.00
interface RcConfig {
  packetHz: 50 | 150 | 250 | 500 | 1000;
  smoothing: boolean;
  autoFactor: number;
  ffAveraging: 0 | 2 | 3 | 4;
  ffSmoothFactor: number;
  ffJitterFactor: number;
  ffBoost: number;
  ffMaxRateLimit: number;
}
interface PidGains {
  p: number;
  i: number;
  d: number;
  f: number;
} // BF integer units
interface PidConfig {
  gains: PidGains;
  itermRelax: boolean;
  itermRelaxCutoff: number;
  itermWindup: number;
  pidSumLimit: number;
}
interface FilterConfig {
  gyroLpf1: DynLpf;
  gyroLpf2: StaticLpf;
  dtermLpf1: DynLpf;
  dtermLpf2: StaticLpf;
  rpm: { enabled: boolean; harmonics: 1 | 2 | 3; minHz: number; fadeHz: number; q: number };
}
interface DroneParams {
  name;
  auwKg;
  armM;
  motorKv;
  cells;
  tauMotorS;
  hoverThrottle;
  idle;
  mass: MassModel;
  noise: NoiseParams;
  cgTorqueNm;
  dragNmPerRadS;
  extraDelayS;
}
interface SimParams {
  mode: 'bf' | 'classic';
  axis;
  loop;
  rates;
  rc;
  pid;
  filters;
  drone;
  seed;
}
interface SimSample {
  t;
  stick;
  setpoint;
  gyroRaw;
  gyroFilt;
  dtermIn;
  p;
  i;
  d;
  f;
  sum;
  motorL;
  motorR;
  rpmL;
  rpmR;
  tempL;
  tempR;
  saturated;
}
```

Engine API: `createBfSim(params) → { step(), stepN(n, out), setStick(x), setParams(p), snapshot() }`.
Deterministic: all randomness from one seeded mulberry32; no `Math.random`, no wall-clock.

---

## 5. Model decisions (details go to docs/MODEL.md)

- **Timing:** physics, gyro sampling, noise and gyro LPF2 at 8 kHz; PID loop (RPM filter, LPF1,
  PID, D-term filters, mixer) every `pidDenom` gyro samples. BF default `pid_process_denom = 1`
  (`flight/pid.c`, `DEFAULT_PID_PROCESS_DENOM`), targets may override to 2 — exposed as a setting,
  default 1 (8 kHz). UI: accumulator steps the engine N times per animation frame; speed 0.25/0.5/1×.
- **Filters:** BF master replaced biquad with **SVF (TPT state-variable)** for 2nd-order LPF and
  notches (`common/filter.c`). We port PT1/PT2/PT3 (with BF cutoff correction 1.5538 / 1.9615),
  SVF LPF (Q = 1/√2), SVF notch and the weighted RPM notch exactly; dynamic LPF via
  `dynLpfCutoffFreq(throttle, min, max, expo)`.
- **Defaults (BF):** gyro LPF1 dyn PT1 250–500 Hz expo 5, gyro LPF2 PT1 500 Hz; D-term LPF1 dyn PT1
  75–150 Hz expo 5, LPF2 PT1 150 Hz; RPM 3 harmonics, min 100 Hz, fade 50 Hz, Q 5.00.
  PIDs roll 45/80/30/F120, pitch 47/84/34/F125; iterm_relax RP setpoint cutoff 15; windup 80 %;
  pidsum limit 500; rates ACTUAL 7/67/0 → 70/670/0.00; rc_smoothing on, auto factor 30.
- **PID:** `P = 0.032029·P·err`, `I += 0.244381·I·dT·err_relaxed` clamped ±(windup·pidSumLimit),
  `D = 0.000529·D·(−Δgyro_dterm·f_pid)`, `F = 0.013754·(F/100)·ffRaw`. Sum clamped ±500, mixer
  divides by 1000 (`PID_MIXER_SCALING`). D-max not modelled until M4 (D = base D).
- **Motors/plant:** `Ω_max = KV·V·2π/60·η_load`, `Ω_cmd = cmd·Ω_max`, first-order lag `τ_m`,
  thrust `k_T·Ω²` with `k_T` set so 4 motors at `T0` lift AUW. Torque = 2·arm_y·(F_R − F_L).
  Inertia from point/box mass model (body, battery w/ fore-aft offset, camera, 4 motors).
- **Noise:** per motor, sinusoids at Ω/2π ×{1,2,3} with amplitude ∝ (Ω/Ω_hover)²·balance and
  slow random phase/frequency jitter; + white (electrical); + optional frame-resonance (2nd-order
  resonator driven by white noise). CG torque → L/R RPM split → two peak clusters.
- **Thermal:** `C·dT/dt = P_loss − (T−T_amb)/R_th`, `P_loss = a·cmd_mean² + b·rms(HPF_100Hz(cmd))²`,
  calibrated so default 5" sits "cool", labelled qualitative.
- **Metrics:** latency to 50 % (primary), rise 10–90 %, overshoot, settling (±5 %), SSE.

Anything not verifiable from source is marked `TODO(verify)` in code and listed in the M3 report.

---

## 6. Tests (Vitest) → spec §9

| #   | File                        | What                                                                                                |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | `render-invariance.test.ts` | Same seed + scripted stick at 1/60, 1/144, 1/240 frames → identical outputs (BF + Classic)          |
| 2   | `classic.test.ts`           | applied delay == configured while stick moves (bug #1 regression)                                   |
| 3   | `filters.test.ts`           | PT1 −3 dB at fc ±2 %; notch ≥ 20 dB at centre; group delay vs analytic ±5 %                         |
| 4   | `pid.test.ts`               | no D kick on setpoint step; I bounded; iterm_relax reduces overshoot                                |
| 5   | `stability.test.ts`         | critical P monotonic ↓ vs delay / filter strength (Classic + BF)                                    |
| 6   | `sliders.test.ts`           | slider → gain pairs from `simplified_tuning.c` (M3)                                                 |
| 7   | `metrics.test.ts`           | latency-50 % and overshoot on analytic 2nd-order system                                             |
| 8   | `noise.test.ts`             | spectral peaks at RPM/60×h ±2 %; two clusters with CG offset                                        |
| 9   | `classic.test.ts`           | P→faster+overshoot; D→damping+heat; delay→instability; legacy flag reproduces frame-rate dependence |

Plus unit tests for PRNG, FFT, rates, RC smoothing, URL round-trip.

---

## 7. Worker protocol (M2)

UI → worker: `init(params)`, `setParams(partial)`, `stick(x)`, `control({paused, speed})`,
`reset()`, `requestStepResponse()`. Worker → UI: `frame({chunk: Float32Array per channel, t0, dt})`
(~60 Hz, transferable, decimated to ≈1 kHz), `stepResponse({t, y, sp, metrics})`,
`spectrum({f, pre, post, dterm, markers})` (~2 Hz), `status({temp, delays, saturation})`.
The worker owns the real-time accumulator (`performance.now()` deltas → fixed steps), so the
React tree never re-renders per frame; canvases draw imperatively from ring buffers.

---

## 8. Process

- Branch `feature/m0-m3` (personal rule: no direct commits to `main`); Conventional Commits;
  `typecheck + test` before every commit; no `Co-Authored-By` trailers.
- No GitHub remote is created or pushed without explicit approval.

## 9. Open questions (non-blocking; defaults chosen)

1. Default PID rate 8 kHz (BF generic default) vs 4 kHz (spec suggestion) — **chose 8 kHz, selectable**.
2. `feedforward_max_rate_limit` is used unscaled (90) in `rc.c` master — ported as-is, flagged `TODO(verify)`.
3. Live demo URL needs a GitHub repo — README gets a placeholder until you create the remote.
