import { useMemo, useState } from 'react';
import { useLatest } from './hooks.ts';
import type uPlot from 'uplot';
import { useStore } from '../state/store.ts';
import { Panel } from './controls.tsx';
import { AXIS_STYLE, useUplot } from './useUplot.ts';

type Which = 'gyro' | 'dterm';

/**
 * Welch PSD of pre-filter gyro, post-filter gyro and the D term (10·log10 of units²/Hz,
 * Hann, 50 % overlap, 4 kHz "blackbox rate"). Reference lines follow the masterclass guidelines.
 */
export function Spectrum() {
  const spec = useStore((s) => s.spectrum);
  const harmonics = useStore((s) => s.bf.filters.rpm.harmonics);
  const [which, setWhich] = useState<Which>('gyro');
  const markers = useLatest<{ motor: [number, number]; rpmMin: number | null; h: number }>({
    motor: spec?.motorHz ?? [0, 0],
    rpmMin: spec?.rpmMinHz ?? null,
    h: harmonics,
  });

  const data = useMemo<uPlot.AlignedData | null>(() => {
    if (!spec) return null;
    const f = Float64Array.from(spec.f);
    return which === 'gyro'
      ? [f, Float64Array.from(spec.pre), Float64Array.from(spec.post)]
      : [f, Float64Array.from(spec.dterm)];
  }, [spec, which]);

  const host = useUplot(
    () => ({
      height: 250,
      legend: { show: false },
      cursor: { drag: { x: true, y: false } },
      scales: {
        x: { time: false, range: [0, 1000] },
        y: { range: which === 'gyro' ? [-80, 20] : [-60, 20] },
      },
      axes: [
        { ...AXIS_STYLE, label: 'Hz', labelSize: 14, labelFont: '10px ui-monospace' },
        { ...AXIS_STYLE, size: 36, label: 'dB', labelSize: 12, labelFont: '10px ui-monospace' },
      ],
      series:
        which === 'gyro'
          ? [
              {},
              { stroke: '#7d8ba0', width: 1.2, fill: 'rgba(125,139,160,0.08)' },
              { stroke: '#38d6ff', width: 1.6 },
            ]
          : [{}, { stroke: '#93e35a', width: 1.6, fill: 'rgba(147,227,90,0.08)' }],
      hooks: {
        drawClear: [
          (u) => {
            const ctx = u.ctx;
            const { left, top, width, height } = u.bbox;
            ctx.save();
            const band = (f0: number, f1: number, color: string) => {
              const x0 = u.valToPos(f0, 'x', true);
              const x1 = u.valToPos(f1, 'x', true);
              if (x1 < left || x0 > left + width) return;
              ctx.fillStyle = color;
              ctx.fillRect(Math.max(left, x0), top, Math.min(left + width, x1) - Math.max(left, x0), height);
            };
            const m = markers.current;
            const [l, r] = m.motor;
            if (l > 0 && r > 0) {
              for (let h = 1; h <= 3; h++) {
                const lo = Math.min(l, r) * h;
                const hi = Math.max(l, r) * h;
                band(lo - 4, hi + 4, h === 1 ? 'rgba(255,139,61,0.13)' : 'rgba(255,139,61,0.07)');
              }
            }
            ctx.restore();
          },
        ],
        draw: [
          (u) => {
            const ctx = u.ctx;
            const { left, top, width, height } = u.bbox;
            ctx.save();
            ctx.font = `${10 * devicePixelRatio}px ui-monospace, Menlo, monospace`;
            const hline = (db: number, color: string, label: string, at = 1) => {
              const y = u.valToPos(db, 'y', true);
              if (y < top || y > top + height) return;
              ctx.strokeStyle = color;
              ctx.fillStyle = color;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(left, y);
              ctx.lineTo(left + width, y);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.textAlign = at === 1 ? 'right' : at === 0 ? 'left' : 'center';
              const x = at === 1 ? left + width - 4 : at === 0 ? left + 4 : left + width * 0.55;
              ctx.fillText(label, x, y - 3);
            };
            if (which === 'gyro') {
              hline(-40, 'rgba(74,222,128,0.6)', '−40 dB great', 1);
              hline(-30, 'rgba(251,191,36,0.6)', '−30', 0.5);
              hline(-25, 'rgba(244,63,94,0.6)', '−25 investigate', 1);
            } else {
              hline(-10, 'rgba(244,63,94,0.7)', '−10 dB D-term guideline');
            }
            const rm = markers.current.rpmMin;
            if (rm) {
              const x = u.valToPos(rm, 'x', true);
              ctx.strokeStyle = 'rgba(255,176,32,0.8)';
              ctx.beginPath();
              ctx.moveTo(x, top);
              ctx.lineTo(x, top + height);
              ctx.stroke();
              ctx.fillStyle = 'rgba(255,176,32,0.9)';
              ctx.textAlign = 'left';
              ctx.fillText('RPM min', x + 3, top + 12 * devicePixelRatio);
            }
            ctx.restore();
          },
        ],
      },
    }),
    data,
    [which],
    250,
  );

  return (
    <Panel
      title="Spectrum"
      right={
        <div className="seg" role="group" aria-label="Spectrum source">
          <button aria-pressed={which === 'gyro'} onClick={() => setWhich('gyro')}>
            Gyro
          </button>
          <button aria-pressed={which === 'dterm'} onClick={() => setWhich('dterm')}>
            D-term
          </button>
        </div>
      }
    >
      <div ref={host} className="uplot-host" />
      <p className="note">
        {which === 'gyro' ? (
          <>
            <span style={{ color: '#7d8ba0' }}>■</span> pre-filter ·{' '}
            <span style={{ color: 'var(--gyro)' }}>■</span> post-filter · orange bands = motor fundamental and
            harmonics (left/right). Analysis window: {spec ? `last ${spec.seconds.toFixed(1)} s` : '…'} —
            hover with the sticks centred for a clean picture.
          </>
        ) : (
          <>D-term output (PID units). Keep its noise below ≈ −10 dB when raising the master multiplier.</>
        )}
      </p>
      <p className="note">
        Welch PSD, Hann, 50 % overlap, 4 kHz, 10·log10(units²/Hz). dB reference scale: TODO(verify) vs
        PIDToolbox.
      </p>
    </Panel>
  );
}
