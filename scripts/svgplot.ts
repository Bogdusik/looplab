/** Tiny dependency-free SVG line plot writer for docs (light background, readable on GitHub). */

export interface Series {
  name: string;
  color: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  dash?: string;
  width?: number;
}

export interface PlotOptions {
  title: string;
  subtitle?: string;
  xLabel: string;
  yLabel: string;
  series: Series[];
  width?: number;
  height?: number;
  xRange?: [number, number];
  yRange?: [number, number];
  hlines?: { y: number; label: string; color: string }[];
}

function niceTicks(lo: number, hi: number, n = 6): number[] {
  const span = hi - lo || 1;
  const raw = span / n;
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / e;
  const step = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * e;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function linePlot(o: PlotOptions): string {
  const W = o.width ?? 760;
  const H = o.height ?? 360;
  const m = { l: 64, r: 16, t: o.subtitle ? 56 : 40, b: 72 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const s of o.series) {
    for (let i = 0; i < s.x.length; i++) {
      const x = s.x[i]!;
      const y = s.y[i]!;
      if (!Number.isFinite(y)) continue;
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
    }
  }
  if (o.xRange) [xmin, xmax] = o.xRange;
  if (o.yRange) [ymin, ymax] = o.yRange;
  else {
    const pad = (ymax - ymin) * 0.06 || 1;
    ymin -= pad;
    ymax += pad;
  }
  const X = (x: number) => m.l + ((x - xmin) / (xmax - xmin)) * pw;
  const Y = (y: number) => m.t + ph - ((y - ymin) / (ymax - ymin)) * ph;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text x="${m.l}" y="22" font-size="15" font-weight="600" fill="#111827">${esc(o.title)}</text>`,
  );
  if (o.subtitle)
    parts.push(`<text x="${m.l}" y="40" font-size="12" fill="#4b5563">${esc(o.subtitle)}</text>`);
  parts.push(`<g stroke="#e5e7eb" stroke-width="1">`);
  for (const t of niceTicks(xmin, xmax))
    parts.push(`<line x1="${X(t)}" x2="${X(t)}" y1="${m.t}" y2="${m.t + ph}"/>`);
  for (const t of niceTicks(ymin, ymax))
    parts.push(`<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}"/>`);
  parts.push(`</g>`);
  parts.push(`<g font-size="11" fill="#4b5563">`);
  for (const t of niceTicks(xmin, xmax))
    parts.push(`<text x="${X(t)}" y="${m.t + ph + 16}" text-anchor="middle">${t}</text>`);
  for (const t of niceTicks(ymin, ymax))
    parts.push(`<text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`);
  parts.push(
    `<text x="${m.l + pw / 2}" y="${m.t + ph + 34}" text-anchor="middle" font-size="12">${esc(o.xLabel)}</text>`,
    `<text transform="translate(16 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="12">${esc(o.yLabel)}</text>`,
    `</g>`,
    `<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="none" stroke="#9ca3af"/>`,
    `<clipPath id="c"><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></clipPath>`,
  );
  for (const h of o.hlines ?? []) {
    parts.push(
      `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="${h.color}" stroke-dasharray="5 4"/>`,
      `<text x="${m.l + pw - 4}" y="${Y(h.y) - 4}" text-anchor="end" font-size="11" fill="${h.color}">${esc(h.label)}</text>`,
    );
  }
  parts.push(`<g clip-path="url(#c)" fill="none" stroke-linejoin="round">`);
  for (const s of o.series) {
    let d = '';
    for (let i = 0; i < s.x.length; i++) {
      const y = s.y[i]!;
      if (!Number.isFinite(y)) continue;
      d += `${d ? 'L' : 'M'}${X(s.x[i]!).toFixed(1)} ${Y(y).toFixed(1)}`;
    }
    parts.push(
      `<path d="${d}" stroke="${s.color}" stroke-width="${s.width ?? 1.6}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`,
    );
  }
  parts.push(`</g>`);
  // legend
  let lx = m.l;
  const ly = H - 14;
  parts.push(`<g font-size="12" fill="#111827">`);
  for (const s of o.series) {
    parts.push(
      `<line x1="${lx}" x2="${lx + 22}" y1="${ly - 4}" y2="${ly - 4}" stroke="${s.color}" stroke-width="2.5"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`,
      `<text x="${lx + 28}" y="${ly}">${esc(s.name)}</text>`,
    );
    lx += 40 + s.name.length * 6.6;
  }
  parts.push(`</g></svg>`);
  return parts.join('\n');
}
