import { useEffect } from 'react';
import { actions, useStore } from '../state/store.ts';

export function HelpDrawer() {
  const open = useStore((s) => s.helpOpen);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && actions.setHelp(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={() => actions.setHelp(false)} />
      <aside className="drawer" role="dialog" aria-label="What am I looking at?">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2 style={{ flex: 1 }}>What am I looking at?</h2>
          <button className="btn ghost" onClick={() => actions.setHelp(false)} aria-label="Close help">
            ✕
          </button>
        </div>
        <p>
          LoopLab simulates one axis (roll) of a quad running the Betaflight rate loop: sticks → ACTUAL rates
          → RC smoothing → PID → mixer → motors (lag, saturation) → rigid body → gyro with motor-harmonic
          noise → filters → back to the PID. Everything is deterministic and frame-rate independent.
        </p>

        <h3>The stick track</h3>
        <p>
          Drag the orange handle (or use ←/→). The amber bar is the setpoint the PID is chasing, the cyan box
          is the filtered gyro. With “spring” on, the stick re-centres like a real gimbal.
        </p>

        <h3>Scope</h3>
        <p>
          Top: setpoint vs gyro (deg/s). Bottom: P, I, D, FF in Betaflight PID units (±500 is full authority)
          and motor outputs. Pause to pan/zoom; click twice to measure Δt between two points — e.g. setpoint →
          gyro delay, as in PIDToolbox.
        </p>

        <h3>Lesson 1 — hover → spectrum</h3>
        <p>
          Leave the sticks alone and open <b>Spectrum → Gyro</b>. The pre-filter peaks sit on the motor
          fundamental and its 2nd/3rd harmonics. Increase <b>Drone → CG offset</b> and the left/right motors
          split into two clusters. Noise floor below −40 dB is great; above about −30/−25 dB, investigate (try{' '}
          <b>Noise → Electrical</b>).
        </p>

        <h3>Lesson 2 — RPM filter minimum</h3>
        <p>
          Set <b>Filters → RPM min frequency</b> about 25–30 Hz below the lowest motor frequency seen in the
          hover. Turn the RPM filter off and watch the post-filter spectrum, D-term noise and motor
          temperature climb.
        </p>

        <h3>Lesson 3 — filter delay vs noise</h3>
        <p>
          Lower the gyro / D-term filter multipliers: less noise, more delay (<b>Filter delay</b> panel),
          worse step response and lower stable gains. Don&apos;t over-filter. When in doubt, filter D-term
          rather than gyro.
        </p>

        <h3>Lesson 4 — damping (P:D) sweep</h3>
        <p>
          Switch to <b>Linear tuning rates</b>, set FF = 0 (Stick response 0), then sweep <b>Damping</b> from
          0.6 to 1.4 while watching the step response (FF off). Stop where overshoot disappears. The 7&quot;
          preset starts with clear overshoot.
        </p>

        <h3>Lesson 5 — master multiplier</h3>
        <p>
          Raise <b>Master multiplier</b> in 0.2 steps. Latency (50 %) drops, then flattens. Stop when it stops
          improving, when the D-term spectrum crosses ≈ −10 dB, when oscillation appears, or when motors get
          hot.
        </p>

        <h3>Lesson 6 — I and FF</h3>
        <p>
          I ≈ 1.0 is fine over a wide range — it only has to hold the CG offset. FF 0.5–1.0: it cuts latency a
          lot, but with snappy inputs on the heavy 7&quot; preset it heats the motors. Turn{' '}
          <b>Include feed-forward</b> on in the step panel to see why FF makes “step” analysis misleading.
        </p>

        <h3>Classic mode</h3>
        <p>
          A friendly mass-on-a-track toy inspired by Joshua Bardwell&apos;s PID Controller Simulator (no code
          reused). Gains there are conceptual and do not map to real drones. We fixed frame-rate dependence
          and the delay-buffer reset — see <code>docs/FINDINGS.md</code>.
        </p>

        <h3>Limits</h3>
        <ul>
          <li>
            Educational model, one axis. Absolute gains need calibration before they transfer to a real quad.
          </li>
          <li>Not yet modelled (M4): D-max, anti-gravity, TPA, dynamic notch, battery sag, pitch axis.</li>
          <li>
            Spectrum dB follows the PIDToolbox convention (Brian White&apos;s PSSpec2d) at the selected
            Blackbox logging rate. Noise levels are calibrated so the masterclass guidelines read sensibly; a
            real log of the same craft may read differently.
          </li>
        </ul>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>
          Credits: Betaflight (GPL-3.0) for the algorithms; Joshua Bardwell for the inspiration; Brian White /
          PIDToolbox for the tuning procedure.
        </p>
      </aside>
    </>
  );
}
