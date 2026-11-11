import { useMemo } from 'react';
import type uPlot from 'uplot';
import { actions, useStore } from '../state/store.ts';
import { Panel, Toggle } from './controls.tsx';
import { AXIS_STYLE, useUplot } from './useUplot.ts';

const ms = (s: number) => (Number.isFinite(s) ? `${(s * 1000).toFixed(1)} ms` : '—');

export function StepResponse() {
  const step = useStore((s) => s.step);
  const mode = useStore((s) => s.mode);
  const ff = useStore((s) => s.stepFf);
  const rcs = useStore((s) => s.stepRcSmoothing);

  const data = useMemo<uPlot.AlignedData | null>(() => {
    if (!step || step.mode !== mode) return null;
    const scale = mode === 'bf' ? 1000 : 1;
    const t = Float64Array.from(step.t, (v) => v * scale);
    const sp = Float64Array.from(step.setpoint, (v) => v / step.amplitude);
    const y = Float64Array.from(step.y, (v) => v / step.amplitude);
    return [t, sp, y];
  }, [step, mode]);

  const host = useUplot(
    () => ({
      height: 220,
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false }, y: { range: [-0.1, 1.6] } },
      axes: [
        { ...AXIS_STYLE, label: mode === 'bf' ? 'ms' : 's', labelSize: 14, labelFont: '10px ui-monospace' },
        { ...AXIS_STYLE, size: 36, values: (_u, v) => v.map((x) => x.toFixed(1)) },
      ],
      series: [{}, { stroke: '#ffb020', width: 1.5, dash: [5, 4] }, { stroke: '#38d6ff', width: 2 }],
      hooks: {
        draw: [
          (u) => {
            const ctx = u.ctx;
            const y50 = u.valToPos(0.5, 'y', true);
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y50);
            ctx.lineTo(u.bbox.left + u.bbox.width, y50);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    }),
    data,
    [mode],
  );

  const m = step && step.mode === mode ? step.metrics : null;
  return (
    <Panel
      title="Step response"
      right={
        <span>{mode === 'bf' ? `ideal · ${step?.amplitude.toFixed(0) ?? '—'}°/s` : 'classic · 0 → 50'}</span>
      }
    >
      <div ref={host} className="uplot-host" />
      <div className="metrics">
        <div
          className="metric primary"
          title="Time to reach 50 % of the step — the latency figure PIDtoolbox and Brian White use."
        >
          <div className="k">Latency (50 %)</div>
          <div className="v">{m ? ms(m.latency50) : '—'}</div>
        </div>
        <div className="metric">
          <div className="k">Overshoot</div>
          <div className="v">{m ? `${m.overshootPct.toFixed(1)} %` : '—'}</div>
        </div>
        <div className="metric">
          <div className="k">Rise 10–90 %</div>
          <div className="v">{m ? ms(m.rise1090) : '—'}</div>
        </div>
        <div className="metric">
          <div className="k">Settling ±5 %</div>
          <div className="v">{m ? (Number.isFinite(m.settling5) ? ms(m.settling5) : 'never') : '—'}</div>
        </div>
        <div className="metric">
          <div className="k">Steady-state err</div>
          <div className="v">{m ? m.steadyStateError.toFixed(2) : '—'}</div>
        </div>
        <div className="metric">
          <div className="k">Source</div>
          <div className="v" style={{ fontSize: 12 }}>
            {mode === 'bf' ? 'noise-free sim' : 'same model'}
          </div>
        </div>
      </div>
      {mode === 'bf' ? (
        <div style={{ marginTop: 8 }}>
          <Toggle
            label="Include feed-forward"
            checked={ff}
            onChange={(v) => actions.setStepOptions({ ff: v })}
            hint="FF reacts to how fast the setpoint changes. A step changes it infinitely fast, so FF fires one big kick and the curve no longer shows the PID loop itself. PIDtoolbox-style tuning looks at the response with FF off (or with real stick inputs)."
          />
          <Toggle
            label="Include RC smoothing"
            checked={rcs}
            onChange={(v) => actions.setStepOptions({ rcSmoothing: v })}
            hint="Blackbox logs the already-smoothed setpoint, so PIDtoolbox latency excludes RC smoothing. Turn this on to see the extra delay from stick to setpoint."
          />
        </div>
      ) : null}
    </Panel>
  );
}
