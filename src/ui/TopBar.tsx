import { useState } from 'react';
import { DRONE_PRESETS } from '../engine/presets.ts';
import { actions, shareHash, useStore } from '../state/store.ts';

const SPEEDS = [0.25, 0.5, 1];

export function TopBar() {
  const mode = useStore((s) => s.mode);
  const paused = useStore((s) => s.paused);
  const speed = useStore((s) => s.speed);
  const droneId = useStore((s) => s.droneId);
  const [toast, setToast] = useState<string | null>(null);

  const share = async () => {
    const url = location.origin + location.pathname + shareHash(useStore.getState());
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      setToast('Link copied');
    } catch {
      setToast('Copy the URL from the address bar');
    }
    setTimeout(() => setToast(null), 1800);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="7" fill="#151c26" />
          <path
            d="M4 20c4 0 5-10 9-10s4 12 8 12 4-6 7-6"
            fill="none"
            stroke="#ffb020"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
        LoopLab <small>PID &amp; filter lab</small>
      </div>
      <div className="seg" role="group" aria-label="Mode">
        <button aria-pressed={mode === 'bf'} onClick={() => actions.setMode('bf')}>
          Betaflight
        </button>
        <button aria-pressed={mode === 'classic'} onClick={() => actions.setMode('classic')}>
          Classic
        </button>
      </div>
      {mode === 'bf' ? (
        <select
          className="sel"
          value={droneId}
          onChange={(e) => actions.selectDrone(e.target.value)}
          aria-label="Preset"
        >
          {Object.values(DRONE_PRESETS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}
      <span className="grow" />
      <button className="btn" onClick={() => actions.setPaused(!paused)} aria-pressed={paused}>
        {paused ? '▶ Run' : '❚❚ Pause'}
      </button>
      <div className="seg" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} aria-pressed={speed === s} onClick={() => actions.setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <button className="btn" onClick={actions.resetSim} title="Restart the simulation, keep settings">
        Reset sim
      </button>
      <button className="btn" onClick={actions.resetAll} title="Restore all defaults for this preset">
        Reset all
      </button>
      <button className="btn" onClick={share}>
        Share
      </button>
      <button className="btn primary" onClick={() => actions.setHelp(true)}>
        What am I looking at?
      </button>
      {toast ? <div className="toast">{toast}</div> : null}
    </header>
  );
}
