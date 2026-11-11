import { useEffect, useRef, useState } from 'react';
import { actualRate } from '../engine/rates.ts';
import { scopeData } from '../state/scopeData.ts';
import { useStore } from '../state/store.ts';
import { sendStick } from '../worker/host.ts';
import { useLatest } from './hooks.ts';

const PAD = 14;

/**
 * Drag the orange handle (stick, −1…1). Below it: setpoint (amber bar) and the follower
 * (cyan = gyro in Betaflight mode, position in Classic mode). Positions are written to the DOM
 * imperatively every animation frame — no React re-render per frame.
 */
export function StickTrack() {
  const mode = useStore((s) => s.mode);
  const rates = useStore((s) => s.bf.rates);
  const trackRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const spRef = useRef<HTMLDivElement>(null);
  const folRef = useRef<HTMLDivElement>(null);
  const readRef = useRef<HTMLSpanElement>(null);
  const stick = useRef(0);
  const dragging = useRef(false);
  const [spring, setSpring] = useState(true);
  const springRef = useLatest(spring && mode === 'bf');

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const el = trackRef.current;
      if (el) {
        const w = el.clientWidth - 2 * PAD;
        const xOf = (u: number) => PAD + ((Math.max(-1.05, Math.min(1.05, u)) + 1) / 2) * w;
        const range = mode === 'bf' ? actualRate(1, rates) : 100;
        if (!dragging.current && springRef.current && stick.current !== 0) {
          // time-constant spring-back (frame-rate independent), τ = 60 ms
          stick.current *= Math.exp(-dt / 0.06);
          if (Math.abs(stick.current) < 0.002) stick.current = 0;
          sendStick(stick.current);
        }
        handleRef.current!.style.transform = `translateX(${xOf(stick.current)}px)`;
        spRef.current!.style.transform = `translateX(${xOf(scopeData.setpoint / range)}px)`;
        folRef.current!.style.transform = `translateX(${xOf(scopeData.follower / range)}px)`;
        const v = stick.current.toFixed(2);
        if (el.getAttribute('aria-valuenow') !== v) {
          el.setAttribute('aria-valuenow', v);
          el.setAttribute(
            'aria-valuetext',
            mode === 'bf'
              ? `stick ${v}, setpoint ${scopeData.setpoint.toFixed(0)} degrees per second`
              : `handle ${(stick.current * 100).toFixed(0)}`,
          );
        }
        if (readRef.current) {
          readRef.current.textContent =
            mode === 'bf'
              ? `stick ${stick.current.toFixed(2)} · setpoint ${scopeData.setpoint.toFixed(0)}°/s · gyro ${scopeData.follower.toFixed(0)}°/s`
              : `target ${scopeData.setpoint.toFixed(1)} · follower ${scopeData.follower.toFixed(1)}`;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mode, rates, springRef]);

  const setFromEvent = (clientX: number) => {
    const el = trackRef.current!;
    const r = el.getBoundingClientRect();
    const u = ((clientX - r.left - PAD) / (r.width - 2 * PAD)) * 2 - 1;
    stick.current = Math.max(-1, Math.min(1, u));
    sendStick(stick.current);
  };

  return (
    <div className="stage">
      <div style={{ position: 'relative' }}>
        <span id="stick-help" className="sr-only">
          Left and right arrow keys move the stick in 0.1 steps; Home or 0 centres it.
          {mode === 'bf' ? ' With spring on, the stick re-centres when released.' : ''}
        </span>
        <div
          ref={trackRef}
          className="track"
          role="slider"
          aria-label={mode === 'bf' ? 'Roll stick' : 'Handle'}
          aria-describedby="stick-help"
          aria-valuemin={-1}
          aria-valuemax={1}
          aria-valuenow={0}
          aria-valuetext="centred"
          tabIndex={0}
          onPointerDown={(e) => {
            dragging.current = true;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            setFromEvent(e.clientX);
          }}
          onPointerMove={(e) => dragging.current && setFromEvent(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
          onKeyDown={(e) => {
            const d = e.key === 'ArrowRight' ? 0.1 : e.key === 'ArrowLeft' ? -0.1 : 0;
            if (d) {
              stick.current = Math.max(-1, Math.min(1, stick.current + d));
              sendStick(stick.current);
              e.preventDefault();
            }
            if (e.key === '0' || e.key === 'Home') {
              stick.current = 0;
              sendStick(0);
            }
          }}
        >
          <div className="axis" />
          <span className="lane-label" style={{ top: 6 }}>
            {mode === 'bf' ? 'stick' : 'handle'}
          </span>
          <div className="lane stick" />
          <span className="lane-label" style={{ top: 54 }}>
            {mode === 'bf' ? 'setpoint ▸ gyro' : 'target ▸ follower'}
          </span>
          <div className="lane rate" />
          <div ref={spRef} className="marker sp-marker" />
          <div ref={folRef} className="marker follower" />
          <div ref={handleRef} className="marker handle" />
          <span className="readout" style={{ bottom: 4 }} ref={readRef} aria-hidden="true" />
        </div>
        {mode === 'bf' ? (
          <label className="toggle" style={{ position: 'absolute', right: 10, top: 2, fontSize: 11 }}>
            <input
              type="checkbox"
              checked={spring}
              onChange={(e) => setSpring(e.target.checked)}
              aria-label="Spring: re-centre the stick on release"
            />
            spring
          </label>
        ) : null}
      </div>
      <AttitudeView />
    </div>
  );
}

/** Quad seen from behind, rolled by the simulated attitude. */
function AttitudeView() {
  const mode = useStore((s) => s.mode);
  const g = useRef<SVGGElement>(null);
  const lbl = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const a = mode === 'bf' ? scopeData.angle : 0;
      const wrapped = ((((a + 180) % 360) + 360) % 360) - 180;
      g.current?.setAttribute('transform', `rotate(${wrapped.toFixed(2)})`);
      if (lbl.current) lbl.current.textContent = mode === 'bf' ? `roll ${wrapped.toFixed(0)}°` : 'classic';
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mode]);
  return (
    <div className="attitude" aria-hidden>
      <svg viewBox="-60 -40 120 80" width="100%" height="90">
        <line x1="-60" y1="0" x2="60" y2="0" stroke="var(--line-2)" strokeDasharray="3 4" />
        <g ref={g}>
          <rect x="-12" y="-7" width="24" height="12" rx="3" fill="#2a3544" stroke="var(--faint)" />
          <rect x="-8" y="-13" width="16" height="6" rx="2" fill="var(--accent)" opacity="0.8" />
          <line x1="-44" y1="0" x2="44" y2="0" stroke="#566377" strokeWidth="3" strokeLinecap="round" />
          <rect x="-48" y="-6" width="8" height="6" rx="1.5" fill="var(--motorL)" />
          <rect x="40" y="-6" width="8" height="6" rx="1.5" fill="var(--motorR)" />
          <ellipse cx="-44" cy="-8" rx="15" ry="2" fill="rgba(255,255,255,0.18)" />
          <ellipse cx="44" cy="-8" rx="15" ry="2" fill="rgba(255,255,255,0.18)" />
        </g>
      </svg>
      <span className="lbl" ref={lbl} />
    </div>
  );
}
