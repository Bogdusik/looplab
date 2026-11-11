import { useEffect } from 'react';
import { useStore } from '../state/store.ts';
import { startHost } from '../worker/host.ts';
import { HelpDrawer } from './HelpDrawer.tsx';
import { LeftPanel } from './panels.tsx';
import { FilterDelay, MotorTemp } from './readouts.tsx';
import { Scope } from './Scope.tsx';
import { Spectrum } from './Spectrum.tsx';
import { StepResponse } from './StepResponse.tsx';
import { StickTrack } from './StickTrack.tsx';
import { TopBar } from './TopBar.tsx';
import './styles.css';

export function App() {
  const mode = useStore((s) => s.mode);
  useEffect(() => startHost(), []);
  return (
    <div className="app">
      <TopBar />
      <main className="main">
        <div className="col left">
          <LeftPanel />
        </div>
        <div className="col center">
          <section className="panel">
            <div className="panel-b">
              <StickTrack />
            </div>
          </section>
          <Scope />
        </div>
        <div className="col right">
          <StepResponse />
          {mode === 'bf' ? <Spectrum /> : null}
          <MotorTemp />
          <FilterDelay />
        </div>
      </main>
      <footer className="footer">
        GPL-3.0 · Algorithms ported from Betaflight · Inspired by Joshua Bardwell&apos;s PID Controller
        Simulator · Tuning procedure: Brian White / PIDtoolbox · Educational model — gains need calibration
        before they transfer to a real quad.
      </footer>
      <HelpDrawer />
    </div>
  );
}
