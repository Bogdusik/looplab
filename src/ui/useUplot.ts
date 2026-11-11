import { useEffect, useRef } from 'react';
import { useLatest } from './hooks.ts';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export const AXIS_STYLE: Partial<uPlot.Axis> = {
  stroke: '#7f8ca0',
  grid: { stroke: '#1f2834', width: 1 },
  ticks: { stroke: '#1f2834', width: 1 },
  font: '10px ui-monospace, Menlo, monospace',
};

/**
 * Mount a uPlot chart into a div and keep it sized to its container.
 * `build(width)` creates options; `data` updates go through setData (no re-create).
 */
export function useUplot(
  build: (width: number) => Omit<uPlot.Options, 'width'>,
  data: uPlot.AlignedData | null,
  deps: unknown[],
  height = 220,
) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const dataRef = useLatest(data);

  useEffect(() => {
    const el = host.current!;
    const w = Math.max(200, el.clientWidth);
    const u = new uPlot({ ...build(w), width: w, height }, dataRef.current ?? [[]], el);
    plot.current = u;
    const ro = new ResizeObserver(() => {
      const nw = Math.max(200, el.clientWidth);
      if (Math.abs(nw - u.width) > 1) u.setSize({ width: nw, height });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.destroy();
      plot.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (plot.current && data) plot.current.setData(data);
  }, [data]);

  return host;
}
