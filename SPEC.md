# Project brief for Claude Code — "LoopLab": a Betaflight-faithful PID & filter simulator in the browser

> Working name: **LoopLab** (rename freely). Everything below is the full context — you do not need anything else to start.

---

## 0. How to work with me

- **Talk to me in Russian.** Write all code, comments, commit messages, README and docs in **English** (the audience is the international FPV community).
- **Plan first.** Before writing code, create `PLAN.md` (milestones, file tree, key data types, open questions) and show me a short summary. Then proceed without waiting unless something is genuinely ambiguous or contradicts this brief.
- **Build only milestones M0–M3 now** (see §11). Stop after M3, run everything, and report: what works, test results, screenshots, known gaps, `TODO(verify)` list. Do not start M4+ until I say so.
- One commit per logical step, Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`…). Run typecheck + tests before each commit.
- Keep the simulation engine **pure TypeScript with zero DOM/React imports**, so it is unit-testable and can run in a Web Worker and in Node.
- When this brief says "port from Betaflight" or "verify", **look at the actual Betaflight source** (github.com/betaflight/betaflight, `master`/2026.x) and cite file + function in a code comment. If you cannot access it, implement a clearly documented approximation and mark it `TODO(verify)` — never present a guess as Betaflight-exact.
- Don't add features outside the milestone scope. Ask before adding dependencies beyond those listed in §4.

---

## 1. Background and motivation

**Joshua Bardwell** (FPV educator, fpvknowitall.com) published an interactive **PID Controller Simulator** (https://www.fpvknowitall.com/pid-controller-simulator/) alongside a ~1-hour video explaining P, I, D and feed-forward. It is a single-file React page (React UMD + in-browser Babel, ~600 lines) where you drag an orange "setpoint" handle and a "follower" tries to track it. It has P/I/D/FF knobs, physics sliders (Mass, Drag, Delay, Noise, CG offset), a live scope, a step-response panel and a "motor heat" gauge. It is a great teaching toy. The page itself states the gains are conceptual and **do not relate to real drones**. Bardwell said viewers may modify it and take it in their own direction. **But the code has no license**, so we will **not copy its code or styling**. We write our own engine from scratch and credit it as inspiration.

Separately, Bardwell recorded a 2h18m **"Betaflight PID Tuning Masterclass" with Brian White** (author of PIDToolbox; tuned 1000+ drones). Their procedure is the real-world workflow we want our simulator to teach and mirror:

1. Mechanical check, CPU load < 50 %, RC-link preset, **bidirectional DShot on**, Blackbox ≥ 2 kHz (4 kHz on small quads first).
2. **Hover test 30–40 s → spectrum** of the pre-filter gyro. Peaks should sit on motor fundamentals/harmonics (2nd, 3rd). Noise floor below −40 dB is great; above about −30/−25 dB investigate (electrical/frame).
3. **Filters:** set the RPM-filter minimum frequency about 25–30 Hz below the lowest motor frequency seen in the hover. Turn gyro LPF1 off if noise above ~500 Hz is below −40 dB. Don't over-filter, because **filter delay hurts the PID loop**. Bigger quads tolerate more filter delay. Filter D-term rather than gyro when in doubt.
4. **Wobble tests** (rapid small-to-full stick inputs, linear "tuning rates") with FF = 0, dynamic damping (D-max) = 0, I ≈ 0. Sweep the **Damping (P:D) slider 0.6 → 1.4** until overshoot disappears. Raise pitch separately if pitch inertia is higher (battery/GoPro placement).
5. **Master multiplier** in 0.2 steps on a **fresh pack** (battery sag changes latency). Stop when latency improvement flattens, motors get hot, oscillation appears, or **D-term noise exceeds about −10 dB**.
6. I gain about 1.0 (wide, non-linear window). **FF 0.5–1.0**: 1.0 cut latency a lot but made motors hot on their 7". D-max off unless needed. Leave yaw alone.

**Our goal:** a free, open-source, browser simulator that keeps Bardwell's "feel it with a handle" pedagogy, but models the **actual Betaflight control pipeline** (rates → RC smoothing → PID → mixer → motors with lag/saturation → rigid body → gyro with realistic motor-harmonic noise → filters). That way the masterclass lessons (filter delay vs noise, P:D balance, master multiplier, FF and motor heat, pitch vs roll inertia, battery sag) can be **seen and practiced on a virtual drone** before touching a real one. Later (M5+) it should accept real Blackbox data.

---

## 2. Findings about the original simulator (context and material for `docs/FINDINGS.md`)

**Original model** (for reference; reimplement the idea, don't copy code). Each animation frame, with `dt = frameTime` clamped to 50 ms:

- `error = target − pos`
- `integral += error·dt` (clamped ±200)
- `gyroD = (pos + noise − prevNoisyPos)/dt`, where noise is uniform white with running-mean subtraction
- `ff = EMA_0.15(dTarget/dt)`
- `F = Kp·error + Ki·integral − Kd·gyroD + Kff·ff`
- F goes through a time-based delay buffer, then `a = F/m − drag·v/m + CG`; semi-implicit Euler for v and pos
- Defaults: Kp 7.9, Ki 1.75, Kd 3.8, Kff 1.0, mass 1, drag 0.10, delay 15 ms, noise 5/1000
- The handle target is EMA-smoothed (α = 0.15 per frame)
- "Motor heat" = EMA of |D contribution caused by noise|
- A separate step-response panel re-simulates 0→50 for 10 s at a fixed 240 Hz, **without FF and without setpoint smoothing**

**Bugs we found (verified):**

1. **Delay buffer is wiped while the setpoint moves.** The physics loop lives in a `useEffect` whose dependency list includes `targetPos`, and the loop itself calls `setTargetPos(...)` every frame while the EMA-smoothed target is converging. Every change tears down and recreates the effect. That clears the force/delay buffer and resets `lastTime`.
   - Instrumenting the live page (wrapping `cancelAnimationFrame`) showed **0 effect re-creations at idle vs ~118/s while dragging**, continuing for **3–5 s after release**.
   - In a faithful Python port, the delay actually applied right after a stick move was **~0.2 ms instead of the configured 15 ms**.
   - With P = 20, delay 30 ms, D = 0, the oscillation amplitude 6 s after a step was **91 (as shipped) vs 271 (fixed)**.
   - So the simulator's core lesson, "delay + high P = runaway", is **understated about 3×** exactly when the user is interacting.
2. **Physics depends on monitor refresh rate.** The integration step equals the display frame time, and noise-driven D scales with `1/dt`. With default settings the motor-heat reading at hover was **1.22 (OK) at 60 Hz, 3.02 (WARM) at 144 Hz, 5.16 (BURN) at 240 Hz**. The FF and setpoint EMA coefficients are per-frame as well.

**Smaller issues:**

- Noise enters only the D term (P uses the clean position). Real gyro noise affects every term.
- The step-response panel (240 Hz, no FF, no smoothing) doesn't match the live sim.
- Performance: the step response is recomputed every frame (2400 steps), and a 3600-element history array is copied every frame, so the whole app re-renders at frame rate.
- Rise time is measured 10–90 %. PIDToolbox / Brian White use latency to 50 %.

**Modelling gaps vs the masterclass:**

- No filters (gyro LPF, D-term LPF, RPM notch, dynamic notch), so the "filter delay vs noise" trade-off is invisible. A single lumped "delay" slider stands in for everything.
- White noise instead of RPM-dependent motor harmonics. No spectrum view.
- No motor model (lag, saturation, idle).
- Raw knobs instead of Betaflight sliders.
- Single axis, no roll/pitch inertia difference, no battery sag, no wobble test, no deconvolution-based step response.

**Minimal fixes we will suggest upstream** (put them in FINDINGS.md):

- (a) Keep `targetPos` in a ref and remove it from the effect dependencies (or move the loop into a ref-driven, mount-once effect).
- (b) Use a fixed-step accumulator `acc += frameDt; while (acc >= h) { step(h); acc -= h; }` with a fixed `h` (e.g. 1 ms), and derive EMA coefficients from time constants: `α = 1 − exp(−h/τ)`.

**Reproduction snippet for FINDINGS.md** (paste in DevTools on the original page, then drag the handle):

```js
let c = 0; const oc = cancelAnimationFrame.bind(window);
window.cancelAnimationFrame = id => { c++; return oc(id); };
setInterval(() => { console.log('effect re-creations/s:', c); c = 0; }, 1000);
```

> **Important:** before publishing, re-verify bug #2 and the delay effect yourself. Implement the original toy model as our "Classic" mode (§5.9) with a dev flag that reproduces frame-based stepping, and add a test/plot showing the difference. The numbers above came from our port. Keep FINDINGS.md factual, respectful and credit-giving; the goal is to help, not to dunk.

---

## 3. Goals and non-goals

**Goals (v1):**

- Deterministic, frame-rate-independent simulation (identical results on 60/144/240 Hz displays).
- Betaflight-faithful single-axis rate loop (roll; pitch selectable) with real units: deg/s, Hz, ms, motor 0–1.
- Filters with visible delay, realistic motor-harmonic noise, spectrum view, motor temperature model.
- Betaflight-style slider layer plus an "advanced" raw-gain view.
- Step response (ideal) plus PIDToolbox-style metrics (latency at 50 %, overshoot).
- Classic mode (Bardwell-style toy, fixed) for absolute beginners.
- Clean, fast, mobile-friendly UI; shareable URL state; deployable as a static site.

**Non-goals (v1):** 3D flight sim, full 6-DOF, angle mode, GPS, INAV/ArduPilot, Blackbox import/system ID (designed for, built in M5+), and accounts/backends.

---

## 4. Architecture and stack

- **Vite + React 18 + TypeScript (strict)**. State: Zustand (or useReducer). Charts: **uPlot** (fast time series). Scope: Canvas 2D with ring buffers. FFT: a small, well-known library (e.g. `fft.js`) or your own radix-2.
- **Testing:** Vitest. **Lint/format:** ESLint + Prettier. **CI:** GitHub Actions (typecheck, lint, test, build). **Deploy:** GitHub Pages (or Vercel) via Actions.
- **Engine in a Web Worker** (Comlink optional). The UI sends params/stick input; the worker streams **downsampled, transferable Float32Array chunks** (~30–60 Hz) to the UI. Never copy full histories per frame.
- Suggested layout:

```
src/engine/        # pure TS: clock, prng, plant, motors, sensors, filters, pid, rates, sliders, classic, metrics
src/engine/__tests__/
src/worker/        # sim worker + message protocol (typed)
src/ui/            # components: StickTrack, Scope, StepResponse, Spectrum, SlidersPanel, FiltersPanel, DronePanel, NoisePanel, MotorTemp, Presets
src/state/         # store, URL (de)serialization
docs/              # MODEL.md, FINDINGS.md, ROADMAP.md
```

---

## 5. Simulation model spec

### 5.1 Timing

- Fixed physics step `h` = 1/8000 s (gyro rate). The PID loop runs at 4 kHz or 8 kHz (configurable; default PID = gyro/2 = 4 kHz, like modern BF on many FCs; verify).
- The UI render rate is decoupled: accumulate real time and step the engine N times per frame. Support pause, 0.25×/0.5×/1× speed.
- Seeded PRNG (mulberry32 or similar). **Same seed + same inputs ⇒ bitwise-identical output regardless of render rate.**

### 5.2 Stick input → setpoint

- The stick handle gives normalized stick −1…1.
- Rates: implement Betaflight **ACTUAL** rates (port from `rc.c`, `applyActualRates`; verify). Default 70 / 670 / 0.00. Add preset "My rates" 50 / 670 / 0.45. Add a "Linear tuning rates" preset for wobble tests.
- RC link: packet rate (50/150/250/500/1000 Hz) as a sample-and-hold of stick input.
- **RC smoothing** on setpoint and FF in the spirit of BF (PT-n with auto cutoff from packet rate; port the idea from `rc.c`/`rc_smoothing`; verify). Presets "Freestyle / Cinematic / Race" adjust smoothing like the BF RC-link preset "flight style".

### 5.3 Plant (rigid body, one rotational axis)

- `J · dω/dt = τ_motors − b·ω + τ_cg`, with ω in deg/s for I/O (rad/s internally).
- **Two motor pairs** for the selected axis (e.g. left/right for roll). The mixer works around the hover throttle `T0`: `cmd_L = T0 − u`, `cmd_R = T0 + u`, clipped to `[idle, 1]`. Show a saturation indicator.
- Motor dynamics: first-order lag of motor speed to command, `dΩ/dt = (Ω_cmd(cmd) − Ω)/τ_m`. Thrust `F = k_T·Ω²`. Torque `= arm · (F_R − F_L)`. Ω_cmd from KV, voltage and command (approximate, documented).
- Inertia J is estimated from a simple mass model: body + battery (with **fore/aft offset**) + optional camera mass at the front + four motor point masses. That makes **pitch inertia > roll inertia** when the battery/GoPro is spread along the pitch axis (the masterclass 7" case).
- Battery sag (M4): pack voltage decays over a pack duration (fresh ~4.2 V/cell → ~3.5 V/cell), which scales Ω_cmd/thrust. A "fresh pack" button resets it.
- CG/disturbance torque `τ_cg` (constant or slow random) is what makes I necessary.

### 5.4 Sensor and noise

- `gyro_raw = ω + noise`, where noise is the sum of:
  - (a) **motor harmonics**: for each motor, sinusoids at its rotation frequency `Ω/2π` and its 2nd and 3rd harmonics, amplitudes scaling with RPM and a "prop/motor balance" knob, with small random phase/frequency jitter;
  - (b) broadband white noise (an "electrical noise" knob);
  - (c) optional **frame resonance** peak (fixed frequency, Q, amplitude), not covered by the RPM filter.
- When the left and right motors (or front and back, for pitch) run at different RPM because of a CG offset, the spectrum must show **two peak clusters**, as in the masterclass.
- Optional gyro sample-rate quantization/aliasing (M4; nice for teaching the anti-alias role of gyro LPF2).

### 5.5 Filters (port behaviour from `common/filter.c`, `sensors/gyro.c`, `flight/rpm_filter.c`, `flight/dyn_notch_filter.c`; verify)

- Gyro LPF1 (PT1/PT2/PT3/biquad, static or dynamic vs throttle), gyro LPF2 (static PT1), D-term LPF1 (dynamic) and LPF2.
- **RPM filter:** notches on motor fundamental + harmonics (configurable count, Q, **min frequency + fade range**), using the motor RPM the sim knows (bidirectional DShot telemetry).
- Dynamic notch: M4.
- Defaults: use Betaflight 2026.x defaults (look them up; mark `TODO(verify)` if unsure).
- Compute and display **group delay** of the gyro filter chain and the D-term chain (ms at a reference frequency, e.g. 100 Hz) and the analytic magnitude response (Bode plot, M3/M4).

### 5.6 PID controller (port structure from `flight/pid.c`; verify)

- Rate controller on error = setpoint − filtered gyro.
- Betaflight scaling constants for P/I/D/FF (in `pid.h`; e.g. `PTERM_SCALE`, `ITERM_SCALE`, `DTERM_SCALE`, `FEEDFORWARD_SCALE`; verify values), so gains look like BF numbers.
- **D on measurement** (derivative of filtered gyro), then the D-term filters.
- I term with **iterm_relax** (setpoint high-pass based; port `applyItermRelax` idea; verify) and windup limit. Anti-gravity: M4.
- **Feed-forward** from the smoothed setpoint derivative (port the essential parts: gain, smoothing/averaging, boost optional; verify).
- **D-max / dynamic damping** (D rises toward D-max on fast setpoint/gyro changes; verify): M4.
- PID sum limit, motor output limit, TPA (optional): M4.

### 5.7 Slider layer ("Simplified tuning")

- Implement Betaflight simplified tuning from the firmware (`src/main/config/simplified_tuning.c` in BF ≥ 4.3; verify): Master multiplier, Damping (P:D balance) incl. pitch damping, Tracking (P&I) incl. pitch tracking, Drift-wobble (I), Dynamic damping (D-max), Stick response (FF), plus gyro/D-term filter multipliers.
- The UI shows the resulting P/I/D/D-max/FF numbers live, like the Configurator. An "Advanced" tab allows raw gains (sliders disabled, like BF).
- Add unit tests with known slider → gain pairs taken from Betaflight defaults (document the source).

### 5.8 Motor temperature (qualitative)

- First-order thermal model per motor: `C·dT/dt = P_loss − (T − T_amb)/R_th`, with `P_loss ∝ (mean current)² + k·(high-frequency command energy, e.g. RMS of cmd above ~100 Hz)²`.
- Calibrate so that the default 5" preset sits "cool". Excessive D with noise, or FF ≈ 1.0+ with jerky inputs on a heavy 7" preset, should drive it to "hot" within ~20–40 s. Label it as qualitative in the UI.

### 5.9 Classic mode (beginner)

- Reimplement the **idea** of the original toy model (§2) in our engine: setpoint/follower, P/I/D/FF knobs, mass/drag/delay/noise/CG. Use **fixed-step, correct delay, and noise applied to the measurement for all terms**.
- Keep the friendly visuals (handle + follower track).
- A dev-only flag `legacyFrameStepping` reproduces frame-based stepping, for FINDINGS.md comparison plots only (not exposed in the normal UI).

---

## 6. Analysis and metrics

- **Step response (ideal):** recompute on parameter change (debounced, in the worker). Show a 0→N deg/s step through the full pipeline (RC smoothing optional on/off). Metrics: **latency to 50 %** (primary, PIDToolbox-style), rise 10–90 %, peak overshoot, settling time, steady-state error. **FF on/off toggle** (explain why FF distorts "step" analysis).
- **Spectrum:** Welch PSD (Hann, 50 % overlap) in dB of gyro pre-filter, gyro post-filter and D-term. Mark motor fundamental/harmonics bands, RPM-filter min-freq line, and the −40/−30/−25 dB reference lines (pre-filter gyro) plus the **−10 dB D-term guideline**.
- **Filter delay readout:** gyro and D-term group delay in ms. Show a size-based guideline from the masterclass (bigger quads tolerate more; e.g. 7": gyro ~2.2–2.4 ms, D-term ~1.5–1.7 ms as rough targets). Label it "rough guideline".
- **Scope:** setpoint, gyro (filtered and raw), P, I, D, FF, motor cmd L/R. Toggle traces, pause, zoom/pan, and cursor readout with Δt between two points (like PIDToolbox's setpoint→gyro delay measurement).
- M5: **Wobble-test generator** (band-limited random setpoint) and **measured step response via Wiener deconvolution** of setpoint→gyro over windows, averaged with quality gating, as PID-Analyzer / PIDToolbox do. Re-derive the math; don't copy code unless the license is compatible. Validate against the ideal step response in tests.

---

## 7. UI spec

- Dark, clean, technical aesthetic (inspired by, **not copying**, the original). Responsive down to ~380 px width, touch-friendly stick track.
- Layout (desktop): left column with tabs **Tune** (BF sliders / Advanced), **Filters**, **Drone** (preset, mass model, motors, battery), **Noise**. Center: **Stick track + mini drone attitude view**, **Scope**. Right/bottom: **Step response**, **Spectrum**, **Motor temp**, **Filter delay**.
- Top bar: Mode (Betaflight / Classic), preset selector, Pause, Speed, Reset sim, Reset all, Share (URL), "What am I looking at?" help drawer with short explanations tied to masterclass lessons.
- Every control: double-click resets to default; hover/long-press tooltip explains what it does and what to watch for.
- Performance budget: smooth 60 fps on a mid-range phone. No per-frame React re-render of the whole tree; canvases update imperatively.

---

## 8. Presets (approximate, documented as such)

Provide three drone presets with plausible, clearly labeled approximate parameters: **1S whoop (65–75 mm)**, **5" freestyle 6S**, **7" long-range 6S with GoPro on the front**. Each preset defines AUW, arm length, mass distribution, motor KV / τ_m / thrust-to-weight, hover throttle, noise profile, and BF default tune. Note in the UI that absolute gains only transfer to real drones after calibration (M6 system ID).

---

## 9. Testing and acceptance criteria (M0–M3)

Unit/integration tests (Vitest) must cover:

1. **Render-rate invariance:** same seed + same scripted stick input stepped with render frames of 1/60, 1/144 and 1/240 s ⇒ identical engine outputs (bitwise or ≤ 1e-12).
2. **Delay correctness:** the applied command delay equals the configured delay at all times, including while the stick moves (regression test for bug #1).
3. **Filters:** PT1 −3 dB at cutoff (±2 %); notch attenuation ≥ 20 dB at center for the default Q; group delay matches the analytic value (±5 %).
4. **PID:** D is on measurement (a setpoint step gives no D kick); I windup is bounded; iterm_relax reduces overshoot after a fast stick move vs off.
5. **Stability trend:** critical P decreases monotonically as delay or filter strength increases (Classic and BF modes).
6. **Slider mapping:** known slider positions → expected gains (from BF source/defaults).
7. **Metrics:** latency-to-50 % and overshoot are correct on an analytic 2nd-order system.
8. **Noise model:** the spectrum peak frequencies match motor RPM/60 × harmonic (±2 %), and two clusters appear with a CG offset.
9. **Classic mode:** reproduces the qualitative lessons (more P → faster + more overshoot; more D → damping but more noise heat; delay → instability); the legacy flag reproduces the frame-rate dependence for FINDINGS plots.

Acceptance for M3: all tests green in CI, site builds and runs, the default 5" preset feels plausible, and FINDINGS.md has before/after plots generated by a script (`npm run findings`).

---

## 10. Repo, docs, license

- **License: GPL-3.0** (compatible with porting logic from Betaflight, which is GPL-3.0). Add a NOTICE section in the README crediting:
  - Joshua Bardwell's PID Controller Simulator (inspiration; no code reused)
  - the Betaflight project (algorithms referenced/ported, with file references)
  - Brian White / PIDToolbox (tuning procedure and analysis concepts)
- `README.md`: what it is, live demo link, screenshots/GIF, features, how it differs from the original simulator (and why), the "masterclass lessons you can try" section, limitations (educational; absolute gains need calibration), roadmap, contributing, credits, license.
- `docs/MODEL.md`: every equation and parameter with units and sources. `docs/FINDINGS.md`: §2 content, reproduction, before/after plots, suggested minimal upstream fixes. `docs/ROADMAP.md`: M4–M6.
- `.github/workflows/ci.yml` and `deploy.yml` (Pages). Issue templates optional.

---

## 11. Milestones

- **M0 — Scaffold:** Vite/React/TS strict, ESLint/Prettier, Vitest, CI, Pages deploy skeleton, PLAN.md.
- **M1 — Engine core:** clock + accumulator, PRNG, plant + motors + mixer, sensor with motor-harmonic noise, filter library (PT1/PT2/PT3/biquad LPF/notch) + group delay, BF-style PID (P, I with iterm_relax, D on measurement + D-term filters, FF), ACTUAL rates + RC smoothing, Classic model. Tests 1–5, 7–9 (no UI yet).
- **M2 — UI v1:** worker protocol, stick track, scope (ring buffers, Canvas), Advanced raw gains, Classic mode UI, step response panel + metrics, presets, URL state.
- **M3 — BF layer + analysis:** simplified-tuning sliders (test 6), filters panel incl. RPM filter, spectrum (Welch) with reference lines, filter-delay readout, motor temperature, help drawer, README + MODEL.md + FINDINGS.md with generated plots. **Stop here and report.**
- M4 — dynamic notch, D-max, anti-gravity, TPA, battery sag, pitch axis + inertia from mass model, Bode plots, aliasing demo.
- M5 — wobble-test generator, Wiener-deconvolution step response, **guided "Masterclass mode"** that walks the user through Brian White's steps on the virtual drone (hover → spectrum → RPM min → damping sweep → master multiplier sweep with latency deltas → FF test with motor temp).
- M6 — Blackbox CSV import (Blackbox Explorer export) and export (sim → CSV that opens in Blackbox Explorer/PIDToolbox), then system identification (fit τ_m, J-gain, delay, noise profile from a wobble/chirp log, incl. Betaflight 2026.06 chirp logs) for a "digital twin" what-if mode.

---

## 12. References to consult

- Betaflight firmware (GPL-3.0): `src/main/flight/pid.c`, `pid.h`, `pid_init.c`, `src/main/fc/rc.c`, `src/main/common/filter.c`, `src/main/sensors/gyro.c`, `src/main/flight/rpm_filter.c`, `src/main/flight/dyn_notch_filter.c`, `src/main/config/simplified_tuning.c`, `src/main/flight/mixer.c`.
- Betaflight Configurator PID tab (slider UI semantics) and the Betaflight docs on filters, feed-forward, iterm_relax, D-max.
- Plasmatree PID-Analyzer wiki (step response via deconvolution); PIDToolbox / PIDscope docs (latency definition, spectrum conventions).
- Bardwell's simulator page (behaviour only): https://www.fpvknowitall.com/pid-controller-simulator/
- Bardwell × Brian White masterclass: https://www.youtube.com/watch?v=FsJNHI2HWlg

Start with PLAN.md.
