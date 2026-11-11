import { CLASSIC_DEFAULTS } from '../engine/classic.ts';
import type { LpfType } from '../engine/filters.ts';
import { massSummary, motorModel } from '../engine/plant.ts';
import {
  BF_DEFAULT_ROLL,
  DEFAULT_FILTERS,
  DEFAULT_RC,
  DRONE_PRESETS,
  RATE_PRESETS,
  RC_STYLE_PRESETS,
} from '../engine/presets.ts';
import { SIMPLIFIED_DEFAULTS, simplifiedPids, SLIDER_META } from '../engine/sliders.ts';
import type { LpfConfig, PacketRate } from '../engine/types.ts';
import { actions, useStore, type LeftTab } from '../state/store.ts';
import { Slider, Toggle } from './controls.tsx';
import { fmt } from './format.ts';

const TABS: { id: LeftTab; label: string }[] = [
  { id: 'tune', label: 'Tune' },
  { id: 'filters', label: 'Filters' },
  { id: 'drone', label: 'Drone' },
  { id: 'noise', label: 'Noise' },
];

export function LeftPanel() {
  const mode = useStore((s) => s.mode);
  const tab = useStore((s) => s.leftTab);
  if (mode === 'classic') {
    return (
      <section className="panel">
        <div className="panel-h">
          <span className="title">Classic controls</span>
        </div>
        <div className="panel-b">
          <ClassicPanel />
        </div>
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => actions.setLeftTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel-b">
        {tab === 'tune' && <TunePanel />}
        {tab === 'filters' && <FiltersPanel />}
        {tab === 'drone' && <DronePanel />}
        {tab === 'noise' && <NoisePanel />}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------

function TunePanel() {
  const tuning = useStore((s) => s.tuning);
  const gains = useStore((s) => s.bf.pid.gains);
  const pid = useStore((s) => s.bf.pid);
  const rates = useStore((s) => s.bf.rates);
  const rc = useStore((s) => s.bf.rc);
  const pitch = simplifiedPids(tuning.s, 'pitch');
  const roll = simplifiedPids(tuning.s, 'roll');
  const ratesKey =
    Object.entries(RATE_PRESETS).find(([, v]) => JSON.stringify(v.rates) === JSON.stringify(rates))?.[0] ??
    'custom';

  return (
    <>
      <div className="seg" role="group" aria-label="Tuning mode" style={{ width: '100%', display: 'flex' }}>
        <button
          style={{ flex: 1 }}
          aria-pressed={tuning.mode === 'sliders'}
          onClick={() => actions.setTuneMode('sliders')}
        >
          Sliders
        </button>
        <button
          style={{ flex: 1 }}
          aria-pressed={tuning.mode === 'advanced'}
          onClick={() => actions.setTuneMode('advanced')}
        >
          Advanced
        </button>
      </div>

      {tuning.mode === 'sliders' ? (
        <>
          <p className="note">Betaflight simplified tuning (simplified_tuning.c). Values: 1.00 = default.</p>
          {SLIDER_META.map((m) => (
            <Slider
              key={m.key}
              label={m.label}
              value={tuning.s[m.key]}
              min={m.min}
              max={m.max}
              step={5}
              defaultValue={SIMPLIFIED_DEFAULTS[m.key]}
              format={fmt.x}
              hint={m.hint}
              onChange={(v) => actions.setSlider(m.key, v)}
            />
          ))}
        </>
      ) : (
        <>
          <p className="note">
            Raw gains (Betaflight units). Editing here disables the sliders, like the Configurator.
          </p>
          <Slider
            label="P"
            value={gains.p}
            min={0}
            max={250}
            defaultValue={BF_DEFAULT_ROLL.p}
            onChange={(v) => actions.setRawGains({ p: v })}
            hint="Proportional: reacts to the current error. More P = tighter tracking, until delay turns it into oscillation."
          />
          <Slider
            label="I"
            value={gains.i}
            min={0}
            max={250}
            defaultValue={BF_DEFAULT_ROLL.i}
            onChange={(v) => actions.setRawGains({ i: v })}
            hint="Integral: removes steady error (CG offset, wind). Too much → slow bounce-back / wobble."
          />
          <Slider
            label="D"
            value={gains.d}
            min={0}
            max={250}
            defaultValue={BF_DEFAULT_ROLL.d}
            onChange={(v) => actions.setRawGains({ d: v })}
            hint="Derivative (on measurement): damping. Amplifies gyro noise → D-term noise and motor heat."
          />
          <Slider
            label="FF"
            value={gains.f}
            min={0}
            max={1000}
            step={5}
            defaultValue={BF_DEFAULT_ROLL.f}
            onChange={(v) => actions.setRawGains({ f: v })}
            hint="Feed-forward: pushes in proportion to stick speed, before any error exists. Cuts latency; jerky inputs → motor heat."
          />
          <Toggle
            label="I-term relax (RP, setpoint)"
            checked={pid.itermRelax}
            onChange={(v) => actions.editBf((p) => (p.pid.itermRelax = v))}
            hint="Stops I from winding up while the setpoint changes fast (pid.c applyItermRelax). Turn off to see I-term bounce-back after flips."
          />
          <Slider
            label="I-term relax cutoff"
            value={pid.itermRelaxCutoff}
            min={1}
            max={50}
            defaultValue={15}
            format={fmt.hz}
            onChange={(v) => actions.editBf((p) => (p.pid.itermRelaxCutoff = v))}
            hint="Cutoff of the setpoint high-pass that drives iterm_relax. Lower = relax acts longer."
          />
        </>
      )}

      <div className="gains" aria-label="Resulting gains">
        <span />
        <span className="h">P</span>
        <span className="h">I</span>
        <span className="h">D</span>
        <span className="h">D-max</span>
        <span className="h">FF</span>
        <span className="ax">Roll</span>
        <span className="v">{gains.p}</span>
        <span className="v">{gains.i}</span>
        <span className="v">{gains.d}</span>
        <span className="v dim" title="D-max is modelled from M4">
          {tuning.mode === 'sliders' ? roll.dMax : '—'}
        </span>
        <span className="v">{gains.f}</span>
        <span className="ax dim">Pitch</span>
        <span className="v dim">{tuning.mode === 'sliders' ? pitch.p : '—'}</span>
        <span className="v dim">{tuning.mode === 'sliders' ? pitch.i : '—'}</span>
        <span className="v dim">{tuning.mode === 'sliders' ? pitch.d : '—'}</span>
        <span className="v dim">{tuning.mode === 'sliders' ? pitch.dMax : '—'}</span>
        <span className="v dim">{tuning.mode === 'sliders' ? pitch.f : '—'}</span>
      </div>
      <p className="note">
        Simulated axis: roll. Pitch numbers shown for reference (pitch axis arrives in M4).
      </p>

      <div className="group-title">Rates & RC link</div>
      <select
        className="sel"
        style={{ width: '100%' }}
        value={ratesKey}
        onChange={(e) => {
          const r = RATE_PRESETS[e.target.value];
          if (r) actions.editBf((p) => (p.rates = { ...r.rates }));
        }}
        aria-label="Rates preset"
      >
        {Object.entries(RATE_PRESETS).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
        {ratesKey === 'custom' ? <option value="custom">Custom</option> : null}
      </select>
      <Slider
        label="Center sensitivity"
        value={rates.centerRate}
        min={10}
        max={1000}
        step={10}
        defaultValue={70}
        format={(v) => `${v}°/s`}
        onChange={(v) => actions.editBf((p) => (p.rates.centerRate = v))}
        hint="ACTUAL rates: slope at stick centre (deg/s per full stick)."
      />
      <Slider
        label="Max rate"
        value={rates.maxRate}
        min={10}
        max={2000}
        step={10}
        defaultValue={670}
        format={(v) => `${v}°/s`}
        onChange={(v) => actions.editBf((p) => (p.rates.maxRate = v))}
        hint="ACTUAL rates: rotation rate at full stick."
      />
      <Slider
        label="Expo"
        value={rates.expo}
        min={0}
        max={1}
        step={0.01}
        defaultValue={0}
        format={fmt.f2}
        onChange={(v) => actions.editBf((p) => (p.rates.expo = v))}
        hint="ACTUAL rates expo: flattens the middle of the stick."
      />
      <label className="ctl-row" style={{ margin: '8px 0' }}>
        <span className="ctl-label">Packet rate</span>
        <select
          className="sel"
          value={rc.packetHz}
          onChange={(e) => actions.editBf((p) => (p.rc.packetHz = Number(e.target.value) as PacketRate))}
        >
          {[50, 150, 250, 500, 1000].map((r) => (
            <option key={r} value={r}>
              {r} Hz
            </option>
          ))}
        </select>
      </label>
      <label className="ctl-row" style={{ margin: '8px 0' }}>
        <span className="ctl-label">Flight style (RC link preset)</span>
        <select
          className="sel"
          value=""
          onChange={(e) => {
            const pr = RC_STYLE_PRESETS[e.target.value];
            if (pr) actions.editBf((p) => Object.assign(p.rc, pr.patch));
          }}
        >
          <option value="">Apply…</option>
          {Object.entries(RC_STYLE_PRESETS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <Toggle
        label="RC smoothing"
        checked={rc.smoothing}
        onChange={(v) => actions.editBf((p) => (p.rc.smoothing = v))}
        hint="PT3 on setpoint and FF, cutoff auto-derived from the packet rate (rc.c)."
      />
      <Slider
        label="RC smoothing auto factor"
        value={rc.autoFactor}
        min={0}
        max={250}
        step={5}
        defaultValue={DEFAULT_RC.autoFactor}
        onChange={(v) => actions.editBf((p) => (p.rc.autoFactor = v))}
        hint="Cutoff = max(15 Hz, packet rate × 1.5 / (1 + factor/10)). Higher = smoother, slower."
      />
      <Slider
        label="FF smoothing"
        value={rc.ffSmoothFactor}
        min={0}
        max={95}
        step={5}
        defaultValue={DEFAULT_RC.ffSmoothFactor}
        onChange={(v) => actions.editBf((p) => (p.rc.ffSmoothFactor = v))}
        hint="feedforward_smooth_factor: PT1 on the stick-speed estimate."
      />
      <Slider
        label="FF jitter reduction"
        value={rc.ffJitterFactor}
        min={0}
        max={20}
        defaultValue={DEFAULT_RC.ffJitterFactor}
        onChange={(v) => actions.editBf((p) => (p.rc.ffJitterFactor = v))}
        hint="feedforward_jitter_factor: attenuates FF for slow / small stick movements."
      />
      <Slider
        label="FF boost"
        value={rc.ffBoost}
        min={0}
        max={50}
        defaultValue={DEFAULT_RC.ffBoost}
        onChange={(v) => actions.editBf((p) => (p.rc.ffBoost = v))}
        hint="feedforward_boost: adds stick acceleration to overcome motor lag at the start of a move."
      />
    </>
  );
}

// ------------------------------------------------------------------------------------------------

function LpfEditor({
  label,
  cfg,
  def,
  onChange,
  disabled,
  dynamicAllowed,
}: {
  label: string;
  cfg: LpfConfig;
  def: LpfConfig;
  onChange: (c: LpfConfig) => void;
  disabled: boolean;
  dynamicAllowed: boolean;
}) {
  const set = (patch: Partial<LpfConfig>) => onChange({ ...cfg, ...patch });
  return (
    <>
      <div className="group-title">{label}</div>
      <div className="ctl-row" style={{ gap: 8, marginBottom: 4 }}>
        <Toggle label="On" checked={cfg.enabled} onChange={(v) => set({ enabled: v })} />
        <select
          className="sel"
          value={cfg.type}
          onChange={(e) => set({ type: e.target.value as LpfType })}
          aria-label={`${label} type`}
        >
          {(['PT1', 'PT2', 'PT3', 'SVF'] as const).map((t) => (
            <option key={t} value={t}>
              {t === 'SVF' ? 'SVF (2nd-order)' : t}
            </option>
          ))}
        </select>
        {dynamicAllowed ? (
          <Toggle label="Dynamic" checked={cfg.dynamic} onChange={(v) => set({ dynamic: v })} />
        ) : null}
      </div>
      {cfg.enabled ? (
        cfg.dynamic ? (
          <>
            <Slider
              label="Min cutoff"
              value={cfg.minHz}
              min={20}
              max={1000}
              step={5}
              defaultValue={def.minHz}
              format={fmt.hz}
              disabled={disabled}
              onChange={(v) => set({ minHz: v, staticHz: v })}
              hint="Cutoff at zero throttle (dynamic lowpass)."
            />
            <Slider
              label="Max cutoff"
              value={cfg.maxHz}
              min={20}
              max={1000}
              step={5}
              defaultValue={def.maxHz}
              format={fmt.hz}
              disabled={disabled}
              onChange={(v) => set({ maxHz: v })}
              hint="Cutoff at full throttle."
            />
          </>
        ) : (
          <Slider
            label="Cutoff"
            value={cfg.staticHz}
            min={20}
            max={1000}
            step={5}
            defaultValue={def.staticHz}
            format={fmt.hz}
            disabled={disabled}
            onChange={(v) => set({ staticHz: v })}
            hint="Static lowpass cutoff. Lower = less noise, more delay."
          />
        )
      ) : null}
    </>
  );
}

function FiltersPanel() {
  const f = useStore((s) => s.bf.filters);
  const tuning = useStore((s) => s.tuning);
  const info = useStore((s) => s.status?.info);
  const sl = tuning.filterSliders;
  return (
    <>
      <Toggle
        label="Filter sliders (multipliers)"
        checked={sl}
        onChange={(v) => actions.setFilterSliders(v)}
        hint="Configurator filter sliders scale the default LPF cutoffs. Turn off to edit cutoffs directly."
      />
      {sl ? (
        <>
          <Slider
            label="Gyro filter multiplier"
            value={tuning.s.gyroFilter}
            min={10}
            max={200}
            step={5}
            defaultValue={100}
            format={fmt.x}
            onChange={(v) => actions.setSlider('gyroFilter', v)}
            hint="Scales gyro LPF1/LPF2 cutoffs. Higher = less filtering, less delay, more noise."
          />
          <Slider
            label="D-term filter multiplier"
            value={tuning.s.dtermFilter}
            min={10}
            max={200}
            step={5}
            defaultValue={100}
            format={fmt.x}
            onChange={(v) => actions.setSlider('dtermFilter', v)}
            hint="Scales D-term LPF cutoffs. When in doubt, filter D-term rather than gyro (masterclass)."
          />
        </>
      ) : null}
      <LpfEditor
        label="Gyro LPF1"
        cfg={f.gyroLpf1}
        def={DEFAULT_FILTERS.gyroLpf1}
        disabled={sl}
        dynamicAllowed
        onChange={(c) => actions.editBf((p) => (p.filters.gyroLpf1 = c))}
      />
      <LpfEditor
        label="Gyro LPF2 (static, gyro rate)"
        cfg={f.gyroLpf2}
        def={DEFAULT_FILTERS.gyroLpf2}
        disabled={sl}
        dynamicAllowed={false}
        onChange={(c) => actions.editBf((p) => (p.filters.gyroLpf2 = c))}
      />
      <LpfEditor
        label="D-term LPF1"
        cfg={f.dtermLpf1}
        def={DEFAULT_FILTERS.dtermLpf1}
        disabled={sl}
        dynamicAllowed
        onChange={(c) => actions.editBf((p) => (p.filters.dtermLpf1 = c))}
      />
      <LpfEditor
        label="D-term LPF2"
        cfg={f.dtermLpf2}
        def={DEFAULT_FILTERS.dtermLpf2}
        disabled={sl}
        dynamicAllowed={false}
        onChange={(c) => actions.editBf((p) => (p.filters.dtermLpf2 = c))}
      />

      <div className="group-title">RPM filter (bidirectional DShot)</div>
      <Toggle
        label="Enabled"
        checked={f.rpm.enabled}
        onChange={(v) => actions.editBf((p) => (p.filters.rpm.enabled = v))}
        hint="Notches that follow each motor's RPM (rpm_filter.c). Needs bidirectional DShot on a real quad."
      />
      {f.rpm.enabled ? (
        <>
          <label className="ctl-row" style={{ margin: '6px 0' }}>
            <span className="ctl-label">Harmonics</span>
            <select
              className="sel"
              value={f.rpm.harmonics}
              onChange={(e) =>
                actions.editBf((p) => (p.filters.rpm.harmonics = Number(e.target.value) as 1 | 2 | 3))
              }
            >
              {[1, 2, 3].map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          <Slider
            label="Min frequency"
            value={f.rpm.minHz}
            min={50}
            max={200}
            step={1}
            defaultValue={100}
            format={fmt.hz}
            onChange={(v) => actions.editBf((p) => (p.filters.rpm.minHz = v))}
            hint="Masterclass: set it ≈ 25–30 Hz below the lowest motor frequency seen in a hover (spectrum panel)."
          />
          <Slider
            label="Fade range"
            value={f.rpm.fadeHz}
            min={0}
            max={200}
            step={5}
            defaultValue={50}
            format={fmt.hz}
            onChange={(v) => actions.editBf((p) => (p.filters.rpm.fadeHz = v))}
            hint="Notch weight fades to zero over this range above min frequency."
          />
          <Slider
            label="Q"
            value={f.rpm.q}
            min={1}
            max={10}
            step={0.1}
            defaultValue={5}
            format={fmt.f2}
            onChange={(v) => actions.editBf((p) => (p.filters.rpm.q = v))}
            hint="Notch sharpness (Betaflight rpm_filter_q = Q × 100). Higher Q = narrower notch, less delay."
          />
          <p className="note">
            Hover motor frequency ≈ {info ? `${info.hoverHz.toFixed(0)} Hz` : '…'} → suggested min ≈{' '}
            {info ? `${Math.max(50, Math.round(info.hoverHz - 28))} Hz` : '…'}.
          </p>
        </>
      ) : (
        <p className="note warn">
          RPM filter off: motor noise reaches the PID loop — watch the spectrum and motor temperature.
        </p>
      )}
      <div className="group-title">Loop</div>
      <LoopEditor />
    </>
  );
}

function LoopEditor() {
  const loop = useStore((s) => s.bf.loop);
  return (
    <label className="ctl-row" style={{ margin: '6px 0' }}>
      <span className="ctl-label">PID loop</span>
      <select
        className="sel"
        value={loop.pidDenom}
        onChange={(e) => actions.editBf((p) => (p.loop.pidDenom = Number(e.target.value) as 1 | 2))}
      >
        <option value={1}>8 kHz (denom 1, BF default)</option>
        <option value={2}>4 kHz (denom 2)</option>
      </select>
    </label>
  );
}

// ------------------------------------------------------------------------------------------------

function DronePanel() {
  const droneId = useStore((s) => s.droneId);
  const d = useStore((s) => s.bf.drone);
  const ms = massSummary(d);
  const mm = motorModel(d, ms.totalKg);
  return (
    <>
      <select
        className="sel"
        style={{ width: '100%' }}
        value={droneId}
        onChange={(e) => actions.selectDrone(e.target.value)}
        aria-label="Drone preset"
      >
        {Object.values(DRONE_PRESETS).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <p className="note">
        {d.description}. Approximate, plausible numbers — absolute gains transfer to a real quad only after
        calibration (M6).
      </p>
      <dl className="kv">
        <dt>AUW</dt>
        <dd>{(ms.totalKg * 1000).toFixed(0)} g</dd>
        <dt>Roll inertia</dt>
        <dd>{(ms.jRoll * 1e4).toFixed(2)} kg·cm²</dd>
        <dt>Pitch inertia</dt>
        <dd>{(ms.jPitch * 1e4).toFixed(2)} kg·cm²</dd>
        <dt>Thrust / weight</dt>
        <dd>{mm.twr.toFixed(1)} : 1</dd>
        <dt>Hover RPM</dt>
        <dd>{((mm.omegaHover * 60) / (2 * Math.PI)).toFixed(0)}</dd>
      </dl>
      <div className="group-title">Motors</div>
      <Slider
        label="Motor time constant"
        value={d.tauMotorS * 1000}
        min={5}
        max={100}
        step={1}
        defaultValue={DRONE_PRESETS[droneId]!.tauMotorS * 1000}
        format={(v) => `${v.toFixed(0)} ms`}
        onChange={(v) => actions.editBf((p) => (p.drone.tauMotorS = v / 1000))}
        hint="How fast motor + prop reach a new speed. Heavier props → slower motors → more phase lag → lower usable gains."
      />
      <Slider
        label="Hover throttle"
        value={d.hoverThrottle}
        min={0.15}
        max={0.7}
        step={0.01}
        defaultValue={DRONE_PRESETS[droneId]!.hoverThrottle}
        format={fmt.pct}
        onChange={(v) => actions.editBf((p) => (p.drone.hoverThrottle = v))}
        hint="Throttle at hover (sets thrust-to-weight, hover RPM and the dynamic-filter cutoffs)."
      />
      <Slider
        label="Transport delay"
        value={d.transportDelayS * 1000}
        min={0}
        max={10}
        step={0.25}
        defaultValue={DRONE_PRESETS[droneId]!.transportDelayS * 1000}
        format={(v) => `${v.toFixed(2)} ms`}
        onChange={(v) => actions.editBf((p) => (p.drone.transportDelayS = v / 1000))}
        hint="ESC / DShot / gyro-chip latency. More delay → lower critical P."
      />
      <div className="group-title">Disturbance</div>
      <Slider
        label="CG offset (lateral)"
        value={d.cgOffsetM * 1000}
        min={-20}
        max={20}
        step={0.5}
        defaultValue={DRONE_PRESETS[droneId]!.cgOffsetM * 1000}
        format={(v) => `${v.toFixed(1)} mm`}
        onChange={(v) => actions.editBf((p) => (p.drone.cgOffsetM = v / 1000))}
        hint="Constant roll torque. I-term must hold it; left/right motors run at different RPM → two peak clusters in the spectrum."
      />
    </>
  );
}

function NoisePanel() {
  const n = useStore((s) => s.bf.drone.noise);
  const droneId = useStore((s) => s.droneId);
  const enabled = useStore((s) => s.bf.noiseEnabled);
  const def = DRONE_PRESETS[droneId]!.noise;
  const edit = (patch: Partial<typeof n>) => actions.editBf((p) => Object.assign(p.drone.noise, patch));
  return (
    <>
      <Toggle
        label="Gyro noise"
        checked={enabled}
        onChange={(v) => actions.editBf((p) => (p.noiseEnabled = v))}
      />
      <Slider
        label="Prop / motor balance"
        value={n.balance}
        min={0}
        max={4}
        step={0.1}
        defaultValue={def.balance}
        format={(v) => `${v.toFixed(1)}×`}
        onChange={(v) => edit({ balance: v })}
        hint="Scales motor-harmonic vibration (1 = typical, 3+ = bent prop / bad bearing)."
      />
      <Slider
        label="Electrical noise"
        value={n.electricalDps}
        min={0}
        max={5}
        step={0.05}
        defaultValue={def.electricalDps}
        format={(v) => `${v.toFixed(2)} °/s`}
        onChange={(v) => edit({ electricalDps: v })}
        hint="Broadband noise floor. Masterclass: floor below −40 dB is great; above ≈ −30/−25 dB investigate wiring / frame."
      />
      <Slider
        label="1st harmonic"
        value={n.harmonicDps[0]}
        min={0}
        max={20}
        step={0.5}
        defaultValue={def.harmonicDps[0]}
        format={(v) => `${v.toFixed(1)} °/s`}
        onChange={(v) => edit({ harmonicDps: [v, n.harmonicDps[1], n.harmonicDps[2]] })}
        hint="Vibration at the motor rotation frequency (per motor, at hover)."
      />
      <Slider
        label="2nd harmonic"
        value={n.harmonicDps[1]}
        min={0}
        max={20}
        step={0.5}
        defaultValue={def.harmonicDps[1]}
        format={(v) => `${v.toFixed(1)} °/s`}
        onChange={(v) => edit({ harmonicDps: [n.harmonicDps[0], v, n.harmonicDps[2]] })}
      />
      <Slider
        label="3rd harmonic"
        value={n.harmonicDps[2]}
        min={0}
        max={20}
        step={0.5}
        defaultValue={def.harmonicDps[2]}
        format={(v) => `${v.toFixed(1)} °/s`}
        onChange={(v) => edit({ harmonicDps: [n.harmonicDps[0], n.harmonicDps[1], v] })}
      />
      <div className="group-title">Frame resonance</div>
      <Slider
        label="Amplitude"
        value={n.frameDps}
        min={0}
        max={15}
        step={0.5}
        defaultValue={def.frameDps}
        format={(v) => `${v.toFixed(1)} °/s`}
        onChange={(v) => edit({ frameDps: v })}
        hint="A fixed-frequency frame/arm resonance. The RPM filter can't follow it — only the LPFs (or a dynamic notch, M4) help."
      />
      <Slider
        label="Frequency"
        value={n.frameHz}
        min={80}
        max={900}
        step={5}
        defaultValue={def.frameHz}
        format={fmt.hz}
        onChange={(v) => edit({ frameHz: v })}
      />
      <Slider
        label="Q"
        value={n.frameQ}
        min={2}
        max={40}
        step={1}
        defaultValue={def.frameQ}
        format={fmt.int}
        onChange={(v) => edit({ frameQ: v })}
      />
    </>
  );
}

// ------------------------------------------------------------------------------------------------

function ClassicPanel() {
  const c = useStore((s) => s.classic);
  const e = actions.editClassic;
  const D = CLASSIC_DEFAULTS;
  return (
    <>
      <p className="note">
        The beginner toy: drag the handle, watch the follower. Fixed-step physics, true delay, noise on every
        term.
      </p>
      <Slider
        label="P"
        value={c.kp}
        min={0}
        max={40}
        step={0.1}
        defaultValue={D.kp}
        format={fmt.f2}
        onChange={(v) => e({ kp: v })}
        hint="Pulls towards the target in proportion to the error. More P → faster, then overshoot, then oscillation."
      />
      <Slider
        label="I"
        value={c.ki}
        min={0}
        max={20}
        step={0.05}
        defaultValue={D.ki}
        format={fmt.f2}
        onChange={(v) => e({ ki: v })}
        hint="Accumulates error to cancel constant offsets (try CG offset)."
      />
      <Slider
        label="D"
        value={c.kd}
        min={0}
        max={20}
        step={0.1}
        defaultValue={D.kd}
        format={fmt.f2}
        onChange={(v) => e({ kd: v })}
        hint="Damps motion — but differentiates noise too (watch motor heat)."
      />
      <Slider
        label="FF"
        value={c.kff}
        min={0}
        max={3}
        step={0.05}
        defaultValue={D.kff}
        format={fmt.f2}
        onChange={(v) => e({ kff: v })}
        hint="Pushes in proportion to how fast the target moves."
      />
      <div className="group-title">Physics</div>
      <Slider
        label="Mass"
        value={c.mass}
        min={0.2}
        max={5}
        step={0.05}
        defaultValue={D.mass}
        format={fmt.f2}
        onChange={(v) => e({ mass: v })}
      />
      <Slider
        label="Drag"
        value={c.drag}
        min={0}
        max={3}
        step={0.01}
        defaultValue={D.drag}
        format={fmt.f2}
        onChange={(v) => e({ drag: v })}
      />
      <Slider
        label="Delay"
        value={c.delayMs}
        min={1}
        max={100}
        step={1}
        defaultValue={D.delayMs}
        format={(v) => `${v} ms`}
        onChange={(v) => e({ delayMs: v })}
        hint="Applied exactly, always — including while you drag (fixes the original's bug #1)."
      />
      <Slider
        label="Noise"
        value={c.noise}
        min={0}
        max={1}
        step={0.01}
        defaultValue={D.noise}
        format={fmt.f2}
        onChange={(v) => e({ noise: v })}
        hint="Sensor noise on the measured position (affects P, I and D)."
      />
      <Slider
        label="CG offset"
        value={c.cg}
        min={-50}
        max={50}
        step={1}
        defaultValue={D.cg}
        format={fmt.int}
        onChange={(v) => e({ cg: v })}
        hint="Constant push to one side — only I removes the resulting offset."
      />
    </>
  );
}
