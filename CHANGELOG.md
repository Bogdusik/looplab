# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-11

First public release.

### Added

- **Betaflight mode:** a single-axis (roll) simulation of the Betaflight rate loop, ported from betaflight@f97bdbc.
  - Inputs: ACTUAL rates, RC link with packet-rate sample-and-hold, RC smoothing (PT3, auto cutoff) and feed-forward
    (`rc.c`).
  - Controller: PID with iterm_relax and D on measurement, using the `pid.h` scale factors.
  - Filters: gyro LPF1/LPF2, D-term LPF1/LPF2 (PT1/PT2/PT3/SVF) and the RPM filter with fade.
  - Airframe: motors with lag and airmode-like saturation, inertia from a mass model, and gyro noise from motor
    harmonics, broadband noise and frame resonance.
- **Simplified tuning sliders** that reproduce the firmware integers exactly (float32 + integer truncation), plus an
  Advanced tab for raw gains.
- **Analysis:**
  - Ideal step response with latency to 50 %, overshoot, rise, settling and steady-state error.
  - Spectrum in the PIDtoolbox (`PSSpec2d`) convention, at a selectable Blackbox logging rate (1.6 / 2 / 3.2 / 4 kHz).
  - Filter group-delay readout and a qualitative motor-temperature model.
- **Presets:** 1S whoop, 5" freestyle 6S and 7" long-range 6S with a GoPro.
  - Rates: Betaflight default, smooth freestyle, linear tuning.
  - Betaflight 2026.6 RC-link flight styles (Racing … Ultra Cinematic).
- **Classic mode:** a beginner handle-and-follower model with fixed-step physics, an exact delay line and noise on every
  term.
- **UI:**
  - Canvas scope with A/B cursors, shareable URL state and a help drawer with masterclass lessons.
  - Mobile layout down to 390 px.
  - Keyboard and screen-reader support.
- **Docs:** `docs/MODEL.md` (equations, sources, calibration), `docs/FINDINGS.md` (two issues in the original
  simulator, with reproducible plots from `npm run findings`) and `docs/ROADMAP.md`.
- Tooling: CI (typecheck, lint, format, tests, build), GitHub Pages deploy, Dependabot and issue templates.

[0.1.0]: https://github.com/Bogdusik/looplab/releases/tag/v0.1.0
