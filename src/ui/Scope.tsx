import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLatest } from './hooks.ts';
import { scopeData, SCOPE_SECONDS } from '../state/scopeData.ts';
import { actions, useStore } from '../state/store.ts';
import {
  BF_CHANNELS,
  CLASSIC_CHANNELS,
  SCOPE_HZ,
  type BfChannel,
  type ClassicChannel,
} from '../worker/protocol.ts';

interface TraceDef {
  key: string;
  label: string;
  color: string;
  pane: 0 | 1;
  /** Drawn on a fixed 0..1 scale (motor outputs). */
  unit?: boolean;
}

const BF_TRACES: Record<BfChannel, TraceDef> = {
  setpoint: { key: 'setpoint', label: 'Setpoint', color: '#ffb020', pane: 0 },
  gyroFilt: { key: 'gyroFilt', label: 'Gyro', color: '#38d6ff', pane: 0 },
  gyroRaw: { key: 'gyroRaw', label: 'Gyro raw', color: '#5d6d84', pane: 0 },
  p: { key: 'p', label: 'P', color: '#ff5d7d', pane: 1 },
  i: { key: 'i', label: 'I', color: '#b38bff', pane: 1 },
  d: { key: 'd', label: 'D', color: '#93e35a', pane: 1 },
  f: { key: 'f', label: 'FF', color: '#4f8dff', pane: 1 },
  motorL: { key: 'motorL', label: 'Motor L', color: '#ff8b3d', pane: 1, unit: true },
  motorR: { key: 'motorR', label: 'Motor R', color: '#2fd6ab', pane: 1, unit: true },
};

const CLASSIC_TRACES: Record<ClassicChannel, TraceDef> = {
  target: { key: 'target', label: 'Target', color: '#ffb020', pane: 0 },
  pos: { key: 'pos', label: 'Follower', color: '#38d6ff', pane: 0 },
  meas: { key: 'meas', label: 'Measured', color: '#5d6d84', pane: 0 },
  p: { key: 'p', label: 'P', color: '#ff5d7d', pane: 1 },
  i: { key: 'i', label: 'I', color: '#b38bff', pane: 1 },
  d: { key: 'd', label: 'D', color: '#93e35a', pane: 1 },
  ff: { key: 'ff', label: 'FF', color: '#4f8dff', pane: 1 },
  force: { key: 'force', label: 'Force', color: '#e8edf5', pane: 1 },
};

const WINDOWS = [0.25, 0.5, 1, 2, 5, 10];
const PANE_UNITS = { bf: ['deg/s', 'PID'], classic: ['units', 'force'] } as const;

/** Round up to 1/2/5 × 10^n. */
function niceCeil(x: number): number {
  if (x <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
}

export function Scope() {
  const mode = useStore((s) => s.mode);
  const paused = useStore((s) => s.paused);
  const bfTraces = useStore((s) => s.bfTraces);
  const classicTraces = useStore((s) => s.classicTraces);
  const [win, setWin] = useState(2);
  const [cursors, setCursors] = useState<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const view = useRef({ win: 2, offset: 0, scale: [100, 100] });
  useLayoutEffect(() => {
    view.current.win = win;
    if (!paused) view.current.offset = 0;
  }, [win, paused]);

  const defs: TraceDef[] =
    mode === 'bf'
      ? BF_CHANNELS.map((k) => ({ ...BF_TRACES[k], on: bfTraces[k] })).filter((d) => d.on)
      : CLASSIC_CHANNELS.map((k) => ({ ...CLASSIC_TRACES[k], on: classicTraces[k] })).filter((d) => d.on);
  const indexOf = (key: string) =>
    mode === 'bf'
      ? (BF_CHANNELS as readonly string[]).indexOf(key)
      : (CLASSIC_CHANNELS as readonly string[]).indexOf(key);
  const defsRef = useLatest(defs);
  const cursorsRef = useLatest(cursors);

  useEffect(() => {
    const cv = canvasRef.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    let lastVersion = -1;
    let lastW = 0;
    let lastKey = '';
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      const key = JSON.stringify([
        defsRef.current.map((d) => d.key),
        cursorsRef.current,
        view.current.win,
        view.current.offset,
      ]);
      if (scopeData.version === lastVersion && W === lastW && key === lastKey) return;
      lastVersion = scopeData.version;
      lastW = W;
      lastKey = key;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr);
        cv.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const gap = 10;
      const paneH = [(H - gap) * 0.55, (H - gap) * 0.45];
      const paneY = [0, paneH[0]! + gap];
      const left = 44;
      const plotW = W - left - 8;
      const rate = SCOPE_HZ;
      const len = scopeData.rings[0]?.length ?? 0;
      const winS = view.current.win;
      const nWin = Math.round(winS * rate);
      const end = Math.max(0, len - Math.round(view.current.offset * rate));
      const start = Math.max(0, end - nWin);
      const tEnd = scopeData.tEnd - view.current.offset;

      for (let pane = 0; pane < 2; pane++) {
        const y0 = paneY[pane]!;
        const h = paneH[pane]!;
        const ds = defsRef.current.filter((d) => d.pane === pane && !d.unit);
        // autoscale: symmetric, with slow decay
        let mx = 0;
        for (const d of ds) {
          const ring = scopeData.rings[indexOf(d.key)];
          if (!ring) continue;
          for (let i = start; i < end; i++) mx = Math.max(mx, Math.abs(ring.get(i)));
        }
        const target = niceCeil(mx * 1.1 || (pane === 0 ? 100 : 50));
        const cur = view.current.scale[pane]!;
        const sc = target > cur ? target : cur * 0.97 + target * 0.03;
        view.current.scale[pane] = sc;
        const yOf = (v: number) => y0 + h / 2 - (v / sc) * (h / 2);
        // frame + grid
        ctx.fillStyle = '#0d1118';
        ctx.fillRect(left, y0, plotW, h);
        ctx.strokeStyle = '#1f2834';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let g = -2; g <= 2; g++) {
          const y = Math.round(y0 + h / 2 - (g / 2) * (h / 2)) + 0.5;
          ctx.moveTo(left, y);
          ctx.lineTo(left + plotW, y);
        }
        const tickS = winS <= 0.5 ? 0.05 : winS <= 2 ? 0.25 : winS <= 5 ? 1 : 2;
        for (let t = Math.ceil((tEnd - winS) / tickS) * tickS; t <= tEnd; t += tickS) {
          const x = Math.round(left + plotW - ((tEnd - t) / winS) * plotW) + 0.5;
          ctx.moveTo(x, y0);
          ctx.lineTo(x, y0 + h);
        }
        ctx.stroke();
        ctx.strokeStyle = '#2a3544';
        ctx.beginPath();
        ctx.moveTo(left, Math.round(y0 + h / 2) + 0.5);
        ctx.lineTo(left + plotW, Math.round(y0 + h / 2) + 0.5);
        ctx.stroke();
        // labels
        ctx.fillStyle = '#7f8ca0';
        ctx.font = '10px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${+sc.toPrecision(3)}`, left - 4, y0 + 10);
        ctx.fillText(`${-+sc.toPrecision(3)}`, left - 4, y0 + h - 2);
        ctx.fillText(PANE_UNITS[mode][pane]!, left - 4, y0 + h / 2 + 3);

        // traces (min/max per pixel column)
        const all = defsRef.current.filter((d) => d.pane === pane);
        for (const d of all) {
          const ring = scopeData.rings[indexOf(d.key)];
          if (!ring || end - start < 2) continue;
          const yv = d.unit ? (v: number) => y0 + h - v * h : yOf;
          ctx.strokeStyle = d.color;
          ctx.lineWidth = d.key === 'gyroRaw' || d.key === 'meas' ? 1 : 1.6;
          ctx.globalAlpha = d.unit ? 0.75 : 1;
          ctx.beginPath();
          const count = end - start;
          const perPx = count / plotW;
          const xOfIdx = (i: number) => left + plotW - ((end - 1 - i) / nWin) * plotW;
          if (perPx <= 2) {
            for (let i = start; i < end; i++) {
              const x = xOfIdx(i);
              const y = yv(ring.get(i));
              if (i === start) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
          } else {
            const cols = Math.ceil(plotW);
            let first = true;
            for (let c = 0; c < cols; c++) {
              const a = Math.floor(end - nWin + (c / cols) * nWin);
              const b = Math.floor(end - nWin + ((c + 1) / cols) * nWin);
              let lo = Infinity;
              let hi = -Infinity;
              for (let i = Math.max(start, a); i < Math.min(end, b); i++) {
                const v = ring.get(i);
                if (v < lo) lo = v;
                if (v > hi) hi = v;
              }
              if (lo === Infinity) continue;
              const x = left + c + 0.5;
              if (first) {
                ctx.moveTo(x, yv(lo));
                first = false;
              } else ctx.lineTo(x, yv(lo));
              ctx.lineTo(x, yv(hi));
            }
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (pane === 1 && all.some((d) => d.unit)) {
          ctx.fillStyle = '#7f8ca0';
          ctx.textAlign = 'left';
          ctx.fillText('motors 0–100 %', left + 4, y0 + 10);
        }
      }

      // cursors
      const cs = cursorsRef.current;
      const parts: string[] = [];
      cs.forEach((t, k) => {
        const x = left + plotW - ((tEnd - t) / winS) * plotW;
        if (x < left || x > left + plotW) return;
        ctx.strokeStyle = k === 0 ? '#ffffff' : '#ffb020';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, H);
        ctx.stroke();
        ctx.setLineDash([]);
        const i = len - 1 - Math.round((scopeData.tEnd - t) * rate);
        const vals = defsRef.current
          .filter((d) => d.pane === 0)
          .map((d) => `${d.label} ${scopeData.rings[indexOf(d.key)]?.get(Math.max(0, i)).toFixed(1)}`);
        parts.push(`${k === 0 ? 'A' : 'B'} ${t.toFixed(3)} s · ${vals.join(' · ')}`);
      });
      if (cs.length === 2) parts.push(`Δt ${((cs[1]! - cs[0]!) * 1000).toFixed(1)} ms`);
      if (readoutRef.current)
        readoutRef.current.textContent = parts.length
          ? parts.join('   ')
          : 'Click the scope to place cursors A/B (Δt).';
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const timeAt = (clientX: number) => {
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    const left = 44;
    const plotW = r.width - left - 8;
    const x = clientX - r.left;
    const tEnd = scopeData.tEnd - view.current.offset;
    return tEnd - ((left + plotW - x) / plotW) * view.current.win;
  };

  const drag = useRef<{ x: number; offset: number } | null>(null);

  return (
    <section className="panel">
      <div className="panel-h">
        <span className="title">Scope</span>
        <span className="spacer" />
        <div className="chips" role="group" aria-label="Traces">
          {mode === 'bf'
            ? BF_CHANNELS.map((k) => (
                <button
                  key={k}
                  className="chip"
                  aria-pressed={bfTraces[k]}
                  style={{ color: bfTraces[k] ? BF_TRACES[k].color : undefined }}
                  onClick={() => actions.toggleBfTrace(k)}
                >
                  <i />
                  <span style={{ color: 'var(--text)' }}>{BF_TRACES[k].label}</span>
                </button>
              ))
            : CLASSIC_CHANNELS.map((k) => (
                <button
                  key={k}
                  className="chip"
                  aria-pressed={classicTraces[k]}
                  style={{ color: classicTraces[k] ? CLASSIC_TRACES[k].color : undefined }}
                  onClick={() => actions.toggleClassicTrace(k)}
                >
                  <i />
                  <span style={{ color: 'var(--text)' }}>{CLASSIC_TRACES[k].label}</span>
                </button>
              ))}
        </div>
      </div>
      <div className="scope-wrap">
        <canvas
          ref={canvasRef}
          className="scope-canvas"
          role="img"
          aria-label={
            mode === 'bf'
              ? 'Scope: setpoint and gyro (deg/s) on top, PID terms and motor outputs below. Click to place time cursors.'
              : 'Scope: target and follower on top, controller terms below. Click to place time cursors.'
          }
          onPointerDown={(e) => {
            if (paused) drag.current = { x: e.clientX, offset: view.current.offset };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const r = canvasRef.current!.getBoundingClientRect();
            const dt = ((e.clientX - drag.current.x) / (r.width - 52)) * view.current.win;
            view.current.offset = Math.max(
              0,
              Math.min(SCOPE_SECONDS - view.current.win, drag.current.offset + dt),
            );
          }}
          onPointerUp={(e) => {
            const moved = drag.current && Math.abs(e.clientX - drag.current.x) > 4;
            drag.current = null;
            if (moved) return;
            const t = timeAt(e.clientX);
            setCursors((c) => (c.length >= 2 ? [t] : [...c, t]));
          }}
          onWheel={(e) => {
            if (!paused) return;
            const i = WINDOWS.indexOf(win);
            const next = WINDOWS[Math.max(0, Math.min(WINDOWS.length - 1, i + (e.deltaY > 0 ? 1 : -1)))]!;
            setWin(next);
          }}
        />
      </div>
      <div className="scope-tools">
        <div className="seg" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button key={w} aria-pressed={w === win} onClick={() => setWin(w)}>
              {w < 1 ? `${w * 1000} ms` : `${w} s`}
            </button>
          ))}
        </div>
        <button className="btn ghost" onClick={() => setCursors([])}>
          Clear cursors
        </button>
        <span className="num" ref={readoutRef} style={{ flex: '1 1 300px' }} />
        {paused ? <span>Paused — drag to pan, wheel to zoom.</span> : null}
      </div>
    </section>
  );
}
