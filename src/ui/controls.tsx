import { useId, useRef, useState, type ReactNode } from 'react';

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

/** Hover (desktop), long-press (touch) or keyboard-focus tooltip state. */
function useTip() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return {
    open,
    focus: { onFocus: () => setOpen(true), onBlur: () => setOpen(false) },
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

/**
 * Labelled range control. Double-click (or Delete / Backspace when focused) resets to default;
 * hover, long-press or keyboard focus shows the explanation, which is also exposed to screen readers.
 */
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
  const hintId = useId();
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
        aria-valuetext={format(value)}
        aria-describedby={hint ? hintId : undefined}
        style={{ ['--fill' as string]: `${Math.max(0, Math.min(100, fill))}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            onChange(defaultValue);
          }
        }}
        {...tip.focus}
      />
      {hint ? (
        <span id={hintId} className="sr-only">
          {hint} Default {format(defaultValue)}; press Delete to reset.
        </span>
      ) : null}
      {tip.open && hint ? (
        <div className="tip" aria-hidden="true">
          {hint}
          <div style={{ marginTop: 4, color: 'var(--muted)' }}>
            Double-click or press Delete to reset ({format(defaultValue)}).
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
  const hintId = useId();
  return (
    <div className="ctl" style={{ padding: 0 }}>
      <label className="toggle" {...tip.bind}>
        <input
          type="checkbox"
          checked={checked}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.checked)}
          {...tip.focus}
        />
        {label}
      </label>
      {hint ? (
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      ) : null}
      {tip.open && hint ? (
        <div className="tip" aria-hidden="true">
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
