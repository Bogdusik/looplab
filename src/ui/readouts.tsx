import { CLASSIC_HEAT_HOT, CLASSIC_HEAT_WARM } from '../engine/classic.ts';
import { HEAT_HOT_C, HEAT_WARM_C, heatLevel } from '../engine/thermal.ts';
import { useStore } from '../state/store.ts';
import { Panel } from './controls.tsx';

function Thermo({ label, c }: { label: string; c: number }) {
  const lvl = heatLevel(c);
  const pct = Math.max(0, Math.min(100, ((c - 20) / (HEAT_HOT_C + 20 - 20)) * 100));
  const color = lvl === 'hot' ? 'var(--hot)' : lvl === 'warm' ? 'var(--warn)' : 'var(--ok)';
  return (
    <div className="thermo">
      <div className="ctl-row">
        <span className="ctl-label" style={{ cursor: 'default' }}>
          {label}
        </span>
        <span className={`badge ${lvl}`}>{lvl}</span>
      </div>
      <div className="num" style={{ fontSize: 20 }}>
        {c.toFixed(0)}°C
      </div>
      <div className="bar">
        <div style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function MotorTemp() {
  const status = useStore((s) => s.status);
  const mode = useStore((s) => s.mode);
  if (mode === 'classic') {
    const h = status?.heat ?? 0;
    const lvl = h >= CLASSIC_HEAT_HOT ? 'hot' : h >= CLASSIC_HEAT_WARM ? 'warm' : 'cool';
    return (
      <Panel title="Motor heat" right={<span className={`badge ${lvl}`}>{lvl}</span>}>
        <div className="num" style={{ fontSize: 22 }}>
          {h.toFixed(2)}
        </div>
        <p className="note">
          Average |D contribution caused by sensor noise|. Fixed-step, so it no longer depends on your
          monitor&apos;s refresh rate.
        </p>
      </Panel>
    );
  }
  const sat = status?.saturation ?? 0;
  return (
    <Panel
      title="Motor temperature"
      right={
        <span className={`sat${sat > 0.01 ? ' on' : ''}`}>
          {sat > 0.01 ? `saturating ${(sat * 100).toFixed(0)} %` : 'no saturation'}
        </span>
      }
    >
      <div className="temps">
        <Thermo label="Left motors" c={status?.tempL ?? 22} />
        <Thermo label="Right motors" c={status?.tempR ?? 22} />
      </div>
      <p className="note">
        Qualitative model: steady thrust + high-frequency command energy (D noise, aggressive FF) → heat. Warm
        ≥ {HEAT_WARM_C}°C, hot ≥ {HEAT_HOT_C}°C. Motor speed L/R:{' '}
        {status ? `${status.hzL.toFixed(0)} / ${status.hzR.toFixed(0)} Hz` : '…'}.
      </p>
    </Panel>
  );
}

/** Masterclass rough guidelines (7" quad): gyro ~2.2–2.4 ms, D-term ~1.5–1.7 ms. */
export function FilterDelay() {
  const info = useStore((s) => s.status?.info);
  const mode = useStore((s) => s.mode);
  if (mode !== 'bf') return null;
  return (
    <Panel title="Filter delay" right={<span>group delay @ 100 Hz</span>}>
      <dl className="kv">
        <dt>Gyro chain (LPF2 → RPM → LPF1)</dt>
        <dd style={{ color: 'var(--gyro)' }}>{info ? `${info.gyroDelayMs.toFixed(2)} ms` : '…'}</dd>
        <dt>D-term filters (LPF1 → LPF2)</dt>
        <dd style={{ color: 'var(--d)' }}>{info ? `${info.dtermDelayMs.toFixed(2)} ms` : '…'}</dd>
        <dt>RC smoothing cutoff</dt>
        <dd>{info ? `${info.rcSmoothingHz.toFixed(0)} Hz` : '…'}</dd>
        <dt>PID loop</dt>
        <dd>{info ? `${(info.pidHz / 1000).toFixed(0)} kHz` : '…'}</dd>
      </dl>
      <p className="note">
        Rough guideline (masterclass, 7&quot;): gyro ≈ 2.2–2.4 ms, D-term ≈ 1.5–1.7 ms. Bigger quads tolerate
        more delay; filter delay hurts the PID loop, so don&apos;t over-filter. The D-term figure is on top of
        the gyro chain.
      </p>
    </Panel>
  );
}
