import { useRef, useState, type ReactNode } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: ReactNode;
  disabled?: boolean;
}

/** Hover (desktop) or long-press (touch) tooltip state. */
function useTip() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return {
    open,
    bind: {
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
      onTouchStart: () => {
        timer.current = setTimeout(() => setOpen(true), 450);
      },
      onTouchEnd: () => {
        if (timer.current) clearTimeout(timer.current);
        setTimeout(() => setOpen(false), 1800);
      },
    },
  };
}

/** Labelled range control. Double-click resets to default; hover/long-press explains it. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  onChange,
  format = (v) => String(v),
  hint,
  disabled,
}: SliderProps) {
  const tip = useTip();
  const fill = ((value - min) / (max - min)) * 100;
  const changed = Math.abs(value - defaultValue) > step / 2;
  return (
    <div
      className={`ctl${disabled ? ' disabled' : ''}${changed ? ' changed' : ''}`}
      onDoubleClick={() => !disabled && onChange(defaultValue)}
    >
      <div className="ctl-row">
        <span className="ctl-label" {...tip.bind}>
          {label}
        </span>
        <span className="ctl-value">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        style={{ ['--fill' as string]: `${Math.max(0, Math.min(100, fill))}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {tip.open && hint ? (
        <div className="tip" role="tooltip">
          {hint}
          <div style={{ marginTop: 4, color: 'var(--muted)' }}>
            Double-click to reset ({format(defaultValue)}).
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
}

export function Toggle({ label, checked, onChange, hint }: ToggleProps) {
  const tip = useTip();
  return (
    <div className="ctl" style={{ padding: 0 }}>
      <label className="toggle" {...tip.bind}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {tip.open && hint ? (
        <div className="tip" role="tooltip">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function Panel({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-h">
        <span className="title">{title}</span>
        <span className="spacer" />
        {right}
      </div>
      <div className="panel-b">{children}</div>
    </section>
  );
}
