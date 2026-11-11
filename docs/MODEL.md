# LoopLab simulation model

Betaflight reference snapshot: **betaflight/betaflight@f97bdbc** (master, 2026-11-11). Every ported function is cited
in the code next to its implementation. Items we could not confirm from source are marked **TODO(verify)**.

Units: rates in deg/s at the interfaces (rad/s inside the plant), frequencies in Hz, time in s (ms in the UI), motor
command/output 0…1, PID terms in Betaflight "PID units" (±500 = full authority, mixer divides by 1000).

## 1. Timing (`engine/clock.ts`, `engine/bfsim.ts`)

| Quantity                       | Value                                                          | Source                                                                 |
| ------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Physics / gyro sample step `h` | 1/8000 s                                                       | spec                                                                   |
| PID loop                       | every `pid_process_denom` samples; default **1** (8 kHz)       | `flight/pid.c` `DEFAULT_PID_PROCESS_DENOM` (targets may override to 2) |
| Render → physics               | accumulator, integer steps per frame, catch-up capped at 0.1 s | —                                                                      |
| Randomness                     | one seeded mulberry32 stream per sim (+ forks)                 | —                                                                      |

Same seed + same per-step input ⇒ bitwise-identical output at any render rate (spec test 1).
Order inside one step: RC packet sampling → actuators (delay line, motors, rigid body) → gyro sample + LPF2 → (PID tick:
RC processing, RPM notches, LPF1, PID, mixer, thermal). A command computed at step _k_ acts at step _k + 1 + n_delay_.

## 2. Sticks → setpoint (`engine/rates.ts`, `engine/rc.ts`)

**ACTUAL rates** — `fc/rc.c applyActualRates()`:

```
expof  = |x| · (x⁵·expo + x·(1 − expo))
rate   = x·center + max(0, max − center)·expof            (clamped to ±1998, rate_limit)
```

Default 70 / 670 / 0.00 (`fc/controlrate_profile.c`: rcRates 7, rates 67, expo 0). Presets: "My rates" 50/670/0.45,
"Linear tuning rates" 400/400/0.

**RC link.** Sample-and-hold of the stick at `packetHz` (50/150/250/500/1000), integer phase accumulator, stick
quantised to 1 µs (`rcUsSpanToNorm(1)` = 0.002). The link is assumed stable, so `smoothedRxRateHz = packetHz`.

**Feed-forward** — `fc/rc.c calculateFeedforward()`, CRSF/ELRS path (`feedforwardInterpolate = false` for CRSF,
`pid_init.c`), roll/pitch branch, per packet:

```
speed      = Δsetpoint · rxRate                       → PT1 (τ from smooth factor)
accel      = Δspeed                                   → PT1
boost      = accel · rxRate · 0.001·ff_boost
ff         = (speed + boost) · jitter
jitter     = min(1, ((|ΔrcCmd| + |ΔrcCmd_prev|)/2 + 0.002) / ((1 + jitter_factor)·0.002))
if ff·setpoint > 0: ff = clamp(ff, ±(maxRate − |setpoint|)·ff_max_rate_limit)
ff         = moving average over (averaging + 1) packets (laggedMovingAverageUpdate)
τ_smooth   = (1/250 · s)/(1 − s),  s = ff_smooth_factor/100     (pid_init.c, normalised to 250 Hz)
```

`feedforward_max_rate_limit` is used unscaled in `rc.c` master (headroom deg/s × 90 compared with deg/s²); ported
as-is. Defaults: averaging 2-point, smooth 65, jitter 7, boost 15, max-rate-limit 90 (`flight/pid.c`).

**RC smoothing** — `rc.c processRcSmoothingFilter()`, per PID loop: PT3 on setpoint and on FF with cutoff
`max(15, rxRate · 1.5 / (1 + auto_factor/10))` (`rcSmoothingSetFilterCutoffs()`), default factor 30 → 93.75 Hz at 250 Hz.

RC-link "flight style" presets (Race / Freestyle / Cinematic) — **TODO(verify)** against `betaflight/firmware-presets`.

## 3. PID (`engine/pid.ts`) — `flight/pid.c pidController()`, one acro axis

| Constant                      | Value                                                 | Source                |
| ----------------------------- | ----------------------------------------------------- | --------------------- |
| `PTERM_SCALE`                 | 0.032029                                              | `pid.h`               |
| `ITERM_SCALE`                 | 0.244381                                              | `pid.h`               |
| `DTERM_SCALE`                 | 0.000529                                              | `pid.h`               |
| `FEEDFORWARD_SCALE`           | 0.013754 (applied to F/100)                           | `pid.h`, `pid_init.c` |
| I limit                       | `iterm_windup`/100 · `pidsum_limit` = 0.8 · 500 = 400 | `pid_init.c`          |
| PID sum limit / mixer scaling | 500 / 1000                                            | `pid.h`               |

```
err   = setpoint − gyroADCf
relax: lpf = PT1_15Hz(setpoint);  hpf = |setpoint − lpf|;  errI = err · max(0, 1 − hpf/40)   (applyItermRelax, RP/SETPOINT)
P     = Kp·err
I     = clamp(I + Ki·dT·errI, ±400)
D     = Kd · −(gyroD[k] − gyroD[k−1]) · f_pid      gyroD = D-term LPF2(LPF1(gyroADCf))      (D on measurement)
F     = Kf · feedforward
sum   = P + I + D + F → clamp ±500 → /1000 → mixer
```

Defaults roll 45/80/30/F120, pitch 47/84/34/F125, iterm_relax RP / SETPOINT / 15 Hz (`flight/pid.c resetPidProfile`).
Not modelled until M4: D-max, anti-gravity, TPA, S-term, crash recovery.

## 4. Simplified tuning (`engine/sliders.ts`) — `config/simplified_tuning.c`

```
P   = trunc(P₀ · master · pi · pitchPi)              I = trunc(I₀ · master · pi · i · pitchPi)
D   = trunc(D₀ · master · d · pitchD)                F = trunc(F₀ · master · pitchPi · ff)
Dmax= trunc(Dmax₀ · master · d · pitchD · (s + (1 − s)·D₀/Dmax₀)),  s = d_max_gain/100
gyro/D-term LPF cutoffs = trunc(default · multiplier / 100)   (integer math)
```

Products are float32 (emulated with `Math.fround`) and truncated by the integer `constrain()` (`common/maths.h`), exactly
like the firmware. Limits: `PID_GAIN_MAX` 250, `F_GAIN_MAX` 1000, `DYN_LPF_MAX_HZ` / `LPF_MAX_HZ` 1000.

## 5. Mixer, motors and plant (`engine/plant.ts`)

**Mixer.** QUAD X roll column (left +, right −). Airmode-like: if `|2u| > 1` scale the differential down, then shift
throttle so both sides stay in [0, 1] (spirit of `flight/mixer.c applyMixerAdjustment`; simplified to two sides).
Motor output = `idle + (1 − idle)·cmd` (dshot_idle_value).

**Motors.** `Ω_max = KV · V_cell · cells · η_load · 2π/60`; target `Ω* = output · Ω_max · (1 ± spread)`;
first-order lag `Ω += (1 − e^{−h/τ_m})(Ω* − Ω)`. Thrust `F = k_T Ω²`, `k_T` chosen so four motors at hover throttle lift
the AUW (⇒ thrust-to-weight = (1/output_hover)²). Front/rear motors differ by ±`motorSpread` (pitch/yaw trims).

**Rigid body (roll).** `J·dω/dt = Σ −side·a_y·F_i − b·ω + τ_cg`, `a_y = arm·sin 45°`, `τ_cg = m·g·cg_offset`.
`J` comes from a mass model (boxes + motor point masses, parallel-axis theorem about the CG), so a battery or GoPro
spread along x makes pitch inertia > roll inertia (shown for M4). Semi-implicit Euler.

**Transport delay** `n = round(delay/h)` samples (ESC/DShot/gyro-chip latency), plus the inherent one-sample
compute delay.

## 6. Gyro noise (`engine/noise.ts`)

Per motor and harmonic k = 1…3: `A_k · balance · (Ω/Ω_hover)² · sin(φ)`, `φ += k·Ω·(1 + j)·h`, with `j` an
Ornstein–Uhlenbeck random walk (σ = `jitter`, 0.2 s correlation), random initial phases and signs. Plus white
"electrical" noise and an optional frame resonance (2nd-order resonator at `frameHz`, `Q`, driven by white noise, scaled
to an RMS). Different left/right RPM (CG offset) ⇒ two peak clusters (spec test 8).

## 7. Filters (`engine/filters.ts`, `engine/gyro.ts`) — `common/filter.c`, `sensors/gyro*.c`, `flight/rpm_filter.c`

- PT1 gain `k = ω/(ω + 1)`, `ω = 2π f_c dT` (`pt1FilterGain`). PT2/PT3 are cascades with cutoff corrections
  1.553773974 / 1.961459177. **Note:** with this gain the true −3 dB point sits 2–12 % below the nominal cutoff at
  typical settings (e.g. PT1 250 Hz @ 8 kHz → ≈ 229 Hz). This is Betaflight's behaviour, kept on purpose; tests compare
  simulation against the analytic response of the same discrete filter.
- 2nd-order lowpass and notches are **TPT state-variable filters** (Betaflight master replaced the biquad):
  SVF lowpass with Q = 1/√2, notch `H(S) = (S² + (1 − w)·S/Q + 1)/(S² + S/Q + 1)`, `S` = prewarped bilinear variable.
- Dynamic LPF cutoff: `curve = t(1 − t)·expo/10 + t`, `f = (max − min)·curve + min` (`dynLpfCutoffFreq`), with t = hover
  throttle (constant in v1).
- Gyro chain: **LPF2** (static, at gyro rate) → **RPM notches** (PID rate) → **LPF1** (dynamic) → `gyroADCf`.
- RPM filter: per motor and harmonic, `f = clamp((k)·f_motor, min, 0.48·f_pid)`, weight fades linearly to 0 over
  `fade_range` above `min`, motor frequency smoothed by PT1 `rpm_filter_lpf_hz` (150 Hz). All notches are updated every
  loop (Betaflight spreads updates over 1 ms — negligible here).
- Defaults: gyro LPF1 dyn PT1 250–500 Hz expo 5, LPF2 PT1 500 Hz; D-term LPF1 dyn PT1 75–150 Hz expo 5, LPF2 PT1
  150 Hz; RPM 3 harmonics, min 100 Hz, fade 50 Hz, Q 5.00.
- **Delay readout**: group delay `−dφ/dω` of the analytic chain at 100 Hz (central difference). Gyro chain includes
  the RPM notches at the current hover motor frequencies; the D-term figure covers the D-term filters only.

## 8. Motor temperature (`engine/thermal.ts`) — qualitative

```
τ·dT/dt = T_ss − T,   T_ss = T_amb + k_mean·mean(output)² + k_hf·RMS_hf(output)²
RMS_hf = sqrt(PT1_2Hz((output − PT1_100Hz(output))²)),  mean = PT1_1Hz(output)
```

Calibrated so the default 5" hover sits cool (≈ 38 °C), RPM filter off reaches hot within 40 s, and the 7" with FF 1.0
and snappy inputs gets hot within 40 s (FF 0 is markedly cooler). Labels: warm ≥ 50 °C, hot ≥ 70 °C.

## 9. Analysis (`engine/metrics.ts`, `engine/spectrum.ts`, `engine/stepResponse.ts`)

- **Step response (ideal):** noise off, full pipeline, step aligned with an RX packet; response = filtered gyro.
  Metrics: latency to 50 % (primary), rise 10–90 %, overshoot, settling ±5 %, steady-state error (mean of last 10 %).
  Options: FF on/off (default off — a step has infinite stick speed, so FF fires one kick), RC smoothing on/off
  (default off — Blackbox logs the smoothed setpoint, so PIDToolbox latency excludes it).
- **Spectrum:** see §9a.

## 9a. Spectrum convention and noise calibration (`engine/spectrum.ts`, `engine/blackbox.ts`)

**Reference:** PIDToolbox's spectral analysis by Brian White (`PSSpec2d.m`, Beer-Ware license). We follow its
_convention_ only; no code was copied.

```
x      = Blackbox-decimated stream at the logging rate fs (plain decimation, no anti-alias filter)
Y      = FFT(hann(N) · (x − mean))                    periodic Hann, N = 2^k with N/fs ≈ 0.5 s
psd    = |Y|² / (fs · N),  ×2 for 0 < f < fs/2         no window-power correction
dB     = 10·log10(psd)
```

- Segments overlap 50 % and their PSDs are averaged. Averaging does not change the expected level (it only lowers the
  variance), so the floor equals that of a single FFT over the record. `core.test.ts` checks both against the
  analytic white-noise level `10·log10(2·σ²·(3/8)/fs)` (3/8 = Σw²/N for Hann) within 0.2 dB at 1.6, 2 and 4 kHz.
- A MATLAB `pwelch`-style density (`/(fs·Σw²)`) reads `10·log10(8/3) ≈ +4.26 dB` higher. The test suite pins that
  offset too, so the two conventions cannot be mixed up silently.
- **Logging rate matters.** The same broadband noise reads +3 dB higher at 2 kHz than at 4 kHz (the variance is
  spread over half the bandwidth), and decimation aliases content above fs/2 into the band, as on a real log.
  Setting: 1.6 / 2 / 3.2 / 4 kHz, default **2 kHz** (masterclass: "Blackbox ≥ 2 kHz"). 2 and 4 kHz divide the
  8 kHz gyro exactly. 1.6 and 3.2 kHz are native to 3.2 kHz gyros (e.g. BMI270), so here they are emulated by taking
  the most recent gyro sample at each log tick, with up to one gyro period (125 µs) of timing jitter.

**Calibration of the preset noise (2 kHz, this convention, default tune, hover):**

| Preset        | Pre-filter floor (median 20 Hz…Nyquist) | Pre-filter motor peaks | D-term peak at master ×1 / ×2 / ×2.4 |
| ------------- | --------------------------------------- | ---------------------- | ------------------------------------ |
| 5" freestyle  | ≈ −40 dB (on the "great" line)          | ≈ +3 dB                | −30 / −16 / −10 dB                   |
| 7" long-range | ≈ −41 dB                                | ≈ +6 dB                | −32 / −25 / −23 dB                   |
| 1S whoop      | ≈ −34 dB (AIO whoops are noisy)         | ≈ +2 dB                | −21 / −2 / +22 dB (oscillating)      |

How the masterclass guidelines read with these numbers:

- **Floor −40 / −30 / −25 dB.** A clean default 5" sits at the −40 dB line. Raising `Noise → Electrical` ×2 moves it
  to ≈ −34 dB, and ×5 to ≈ −26 dB ("investigate").
- **D-term −10 dB.** On the 5", latency stops improving around master ×2 (11.8 ms vs 11.6 ms at ×2.4) and overshoot
  starts rising, while D-term noise reaches −10 dB at ≈ ×2.4. The D-term guideline is therefore the last of the
  stopping criteria to trigger, as in the masterclass procedure.
- The D-term peak is driven mainly by broadband ("electrical") noise amplified by the closed loop near its resonance.
  The motor harmonics are removed by the RPM filter, and doubling them leaves the D-term peak unchanged.
- No preset noise amplitudes had to change when the convention moved from pwelch at 4 kHz to PSSpec2d at 2 kHz: the
  −4.26 dB scaling change and the +3 dB rate change roughly cancel (net ≈ −1.5 dB on the D-term peak and ≈ −2.5 dB on the floor).

The reference lines are guidelines from the masterclass, not physical limits. Because the model is calibrated, a real
log of the same craft would not necessarily read the same dB values.

## 10. Classic mode (`engine/classic.ts`)

Mass on a track, 1 ms fixed step: `target` = PT1(handle, τ = 102.6 ms ≡ α 0.15 @ 60 fps), measurement = pos + N(0, σ),
`F = Kp·e + Ki·∫e − Kd·PT1_30Hz(d meas/dt) + Kff·PT1(d target/dt)`, integral ±200, exact delay line,
`a = F_delayed/m − drag·v/m + cg`. Heat = PT1_0.5s(|Kd · d noise/dt|). Defaults 7.9 / 1.75 / 3.8 / 1.0, mass 1,
drag 0.1, delay 15 ms. `LegacyClassicSim` emulates the original's frame stepping for `docs/FINDINGS.md` only.

## 11. Preset numbers (approximate, plausible — not measurements)

These numbers were **chosen so the masterclass lessons are visible**: for example, the 7" motor time constant (32 ms)
makes the damping sweep remove most overshoot, and the noise amplitudes put the 5" floor at −40 dB. They are not
measurements of any particular build.

|                           | 1S whoop          | 5" freestyle 6S  | 7" long-range 6S + GoPro                  |
| ------------------------- | ----------------- | ---------------- | ----------------------------------------- |
| AUW                       | ≈ 31 g            | ≈ 608 g          | ≈ 1040 g                                  |
| Arm (centre→motor)        | 32.5 mm           | 110 mm           | 155 mm                                    |
| Motor                     | 0802 22000 KV, 1S | 2207 1850 KV, 6S | 2806.5 1300 KV, 6S                        |
| τ_motor                   | 14 ms             | 22 ms            | 32 ms                                     |
| Hover throttle / TWR      | 0.50 / 3.5        | 0.28 / 9.8       | 0.40 / 5.4                                |
| Hover motor frequency     | ≈ 400 Hz          | ≈ 173 Hz         | ≈ 170 Hz                                  |
| J_roll / J_pitch (kg·cm²) | 0.11 / 0.12       | 13.6 / 16.4      | 40.3 / 64.0                               |
| Transport delay           | 1.0 ms            | 1.0 ms           | 1.2 ms                                    |
| Tune                      | BF defaults       | BF defaults      | BF defaults (overshoots → damping lesson) |
