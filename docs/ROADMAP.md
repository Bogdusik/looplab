# Roadmap

M0–M3 are done (scaffold, engine, UI, Betaflight slider layer + analysis + docs). Next:

## M4 — more of the Betaflight loop

- Dynamic notch (`flight/dyn_notch_filter.c`) and the frame-resonance lesson it solves.
- D-max / dynamic damping (`pid.c`, `D_MAX_*` in `pid_init.c`), anti-gravity, TPA, PID-sum / motor-output limits.
- Battery sag over a pack (≈ 4.2 → 3.5 V/cell) with a "fresh pack" button — latency changes with sag.
- Pitch axis with inertia from the mass model (pitch damping / tracking sliders become live).
- Bode plots of the gyro and D-term chains; gyro sample-rate aliasing demo (role of gyro LPF2).

## M5 — analysis like on a real quad

- Wobble-test generator (band-limited random setpoint).
- Measured step response via Wiener deconvolution over windows with quality gating (re-derived, validated against the
  ideal step response in tests).
- Guided **Masterclass mode**: hover → spectrum → RPM min → damping sweep → master-multiplier sweep with latency deltas
  → FF test with motor temperature.

## M6 — digital twin

- Blackbox CSV import (Blackbox Explorer export) and export (sim → CSV that opens in Blackbox Explorer / PIDtoolbox).
- System identification (τ_m, J-gain, delay, noise profile) from wobble or chirp logs (incl. Betaflight 2026.06 chirp
  logs) for a calibrated "what-if" mode.
