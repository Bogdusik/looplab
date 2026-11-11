import { useMemo, useState } from 'react';
import type uPlot from 'uplot';
import { BLACKBOX_RATES, type BlackboxRate } from '../engine/blackbox.ts';
import { actions, useStore } from '../state/store.ts';
import { Panel } from './controls.tsx';
import { useLatest } from './hooks.ts';
import { AXIS_STYLE, useUplot } from './useUplot.ts';

type Which = 'gyro' | 'dterm';

/** A reference line with its label placed at a fraction of the plot width, on a dark plate. */
interface RefLine {
  db: number;
  color: string;
  label: string;
  /** 0 = left edge, 1 = right edge. */
  at: number;
}

const GYRO_LINES: RefLine[] = [
  { db: -25, color: 'rgba(255,112,136,0.75)', label: '−25 dB investigate', at: 1 },
  { db: -30, color: 'rgba(251,191,36,0.75)', label: '−30 dB', at: 0.42 },
  { db: -40, color: 'rgba(74,222,128,0.75)', label: '−40 dB great', at: 1 },
];
/** Same colour at full opacity, for label text (contrast). */
const opaque = (rgba: string) => rgba.replace(/,\s*[\d.]+\)$/, ',1)');
const DTERM_LINES: RefLine[] = [
  { db: -10, color: 'rgba(255,112,136,0.8)', label: '−10 dB D-term guideline', at: 1 },
];

/**
 * PSD of pre-filter gyro, post-filter gyro and the D term on the Blackbox-decimated stream,
 * PIDtoolbox convention (PSSpec2d): Hann, |Y|²/(fs·N), one-sided ×2, 10·log10.
 */
export function Spectrum() {
  const spec = useStore((s) => s.spectrum);
  const blackboxHz = useStore((s) => s.blackboxHz);
  const [which, setWhich] = useState<Which>('gyro');
  const fMax = Math.min(1000, blackboxHz / 2);
  const markers = useLatest<{ motor: [number, number]; rpmMin: number | null }>({
    motor: spec?.motorHz ?? [0, 0],
    rpmMin: spec?.rpmMinHz ?? null,
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
        x: { time: false, range: [0, fMax] },
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
            const [l, r] = markers.current.motor;
            if (l > 0 && r > 0) {
              for (let h = 1; h <= 3; h++) {
                band(
                  Math.min(l, r) * h - 4,
                  Math.max(l, r) * h + 4,
                  h === 1 ? 'rgba(255,139,61,0.13)' : 'rgba(255,139,61,0.07)',
                );
              }
            }
            ctx.restore();
          },
        ],
        draw: [
          (u) => {
            const ctx = u.ctx;
            const { left, top, width, height } = u.bbox;
            const px = devicePixelRatio;
            ctx.save();
            ctx.font = `${10 * px}px ui-monospace, Menlo, monospace`;
            ctx.textBaseline = 'middle';
            const plate = (text: string, x: number, y: number, color: string, align: 'left' | 'right') => {
              const w = ctx.measureText(text).width + 8 * px;
              const h = 14 * px;
              const x0 = align === 'right' ? x - w : x;
              ctx.fillStyle = 'rgba(13,17,24,0.88)';
              ctx.fillRect(x0, y - h / 2, w, h);
              ctx.fillStyle = color;
              ctx.textAlign = 'left';
              ctx.fillText(text, x0 + 4 * px, y);
            };
            const lines = which === 'gyro' ? GYRO_LINES : DTERM_LINES;
            for (const l of lines) {
              const y = u.valToPos(l.db, 'y', true);
              if (y < top || y > top + height) continue;
              ctx.strokeStyle = l.color;
              ctx.setLineDash([4 * px, 4 * px]);
              ctx.beginPath();
              ctx.moveTo(left, y);
              ctx.lineTo(left + width, y);
              ctx.stroke();
              ctx.setLineDash([]);
            }
            // labels after all lines so plates sit on top; neighbours are staggered above/below
            // their line so lines 5 dB apart never collide
            lines.forEach((l, i) => {
              const y = u.valToPos(l.db, 'y', true);
              if (y < top || y > top + height) return;
              const dy = (i % 2 === 0 ? -9 : 9) * px;
              if (l.at >= 1) plate(l.label, left + width - 4 * px, y + dy, opaque(l.color), 'right');
              else plate(l.label, left + width * l.at, y + dy, opaque(l.color), 'left');
            });
            const rm = markers.current.rpmMin;
            if (rm) {
              const x = u.valToPos(rm, 'x', true);
              ctx.strokeStyle = 'rgba(255,176,32,0.8)';
              ctx.beginPath();
              ctx.moveTo(x, top);
              ctx.lineTo(x, top + height);
              ctx.stroke();
              plate('RPM min', x + 3 * px, top + 10 * px, 'rgba(255,176,32,0.95)', 'left');
            }
            ctx.restore();
          },
        ],
      },
    }),
    data,
    [which, fMax],
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
      <div
        ref={host}
        className="uplot-host"
        role="img"
        aria-label={`Power spectral density, ${which === 'gyro' ? 'gyro before and after filtering' : 'D term'}, 0 to ${fMax} Hz, in dB with masterclass reference lines.`}
      />
      <label className="ctl-row" style={{ margin: '8px 0 2px' }}>
        <span
          className="ctl-label"
          title="The log rate sets the Nyquist frequency and the dB level of the noise floor (same signal, lower rate → higher floor). Plain decimation, no anti-alias filter, like Betaflight's blackbox."
        >
          Blackbox logging rate
        </span>
        <select
          className="sel"
          value={blackboxHz}
          onChange={(e) => actions.setBlackboxHz(Number(e.target.value) as BlackboxRate)}
        >
          {BLACKBOX_RATES.map((r) => (
            <option key={r} value={r}>
              {(r / 1000).toFixed(1)} kHz
            </option>
          ))}
        </select>
      </label>
      <p className="note">
        {which === 'gyro' ? (
          <>
            <span style={{ color: '#7d8ba0' }}>■</span> pre-filter ·{' '}
            <span style={{ color: 'var(--gyro)' }}>■</span> post-filter · orange bands = motor fundamental and
            harmonics (left/right). Analysis window: {spec ? `last ${spec.seconds.toFixed(1)} s` : '…'}. Hover
            with the sticks centred for a clean picture.
          </>
        ) : (
          <>D-term output (PID units). Keep its noise below ≈ −10 dB when raising the master multiplier.</>
        )}
      </p>
      <p className="note">
        PIDtoolbox convention (PSSpec2d): Hann, |Y|²/(fs·N), one-sided, 10·log10; 0.5 s segments averaged.
        {blackboxHz === 1600 || blackboxHz === 3200
          ? ' 1.6 / 3.2 kHz are native to 3.2 kHz gyros; here they are picked from the 8 kHz stream.'
          : ''}
      </p>
    </Panel>
  );
}
