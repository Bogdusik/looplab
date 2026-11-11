/** In-place iterative radix-2 complex FFT. `re.length` must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error('fft: length must be a power of two');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface Psd {
  /** Bin centre frequencies, Hz. */
  f: Float64Array;
  /** One-sided PSD in units²/Hz. */
  psd: Float64Array;
  segments: number;
}

const hannCache = new Map<number, Float64Array>();
function hann(n: number): Float64Array {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    hannCache.set(n, w);
  }
  return w;
}

/**
 * PSD scaling conventions.
 *  - 'pidtoolbox': PIDToolbox convention (Brian White's PSSpec2d.m, Beer-Ware; convention only, no code
 *    reused): Hann window, FFT, psd = |Y|² / (fs·N), one-sided ×2, no window-power correction.
 *  - 'density': MATLAB `pwelch` density, |Y|² / (fs·Σw²). For a Hann window Σw²/N = 3/8, so 'density' reads
 *    10·log10(8/3) ≈ +4.26 dB higher than 'pidtoolbox'.
 */
export type PsdScaling = 'pidtoolbox' | 'density';

/** Hann Σw²/N for a periodic window. */
export const HANN_POWER = 0.375;

/** Expected one-sided level of white noise with variance σ² sampled at fs (units²/Hz). */
export function whiteNoiseLevel(sigma2: number, fs: number, scaling: PsdScaling = 'pidtoolbox'): number {
  return scaling === 'pidtoolbox' ? (2 * sigma2 * HANN_POWER) / fs : (2 * sigma2) / fs;
}

/**
 * Segment-averaged PSD: Hann segments of `nfft`, 50 % overlap, per-segment mean removal, one-sided.
 * Averaging segments does not change the expected level, so with 'pidtoolbox' scaling the expected
 * floor equals that of a single FFT over the whole record (see core.test.ts) — averaging only reduces variance.
 */
export function welch(
  x: ArrayLike<number>,
  fs: number,
  nfft = 1024,
  scaling: PsdScaling = 'pidtoolbox',
): Psd {
  const n = nfft;
  const hop = n >> 1;
  const w = hann(n);
  let wss = 0;
  for (let i = 0; i < n; i++) wss += w[i]! * w[i]!;
  const bins = (n >> 1) + 1;
  const acc = new Float64Array(bins);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let segments = 0;
  for (let start = 0; start + n <= x.length; start += hop) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += x[start + i]!;
    mean /= n;
    for (let i = 0; i < n; i++) {
      re[i] = (x[start + i]! - mean) * w[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < bins; k++) acc[k] = acc[k]! + re[k]! * re[k]! + im[k]! * im[k]!;
    segments++;
  }
  const f = new Float64Array(bins);
  const psd = new Float64Array(bins);
  const norm = scaling === 'pidtoolbox' ? fs * n : fs * wss;
  const scale = segments > 0 ? 1 / (norm * segments) : 0;
  for (let k = 0; k < bins; k++) {
    f[k] = (k * fs) / n;
    const oneSided = k === 0 || k === bins - 1 ? 1 : 2;
    psd[k] = acc[k]! * scale * oneSided;
  }
  return { f, psd, segments };
}

/** Single Hann-windowed FFT over the longest power-of-two prefix of `x` (PSSpec2d-style, one window). */
export function singleFftPsd(x: ArrayLike<number>, fs: number, scaling: PsdScaling = 'pidtoolbox'): Psd {
  let n = 1;
  while (n * 2 <= x.length) n *= 2;
  return welch(Array.prototype.slice.call(x, 0, n) as number[], fs, n, scaling);
}

/** FFT length giving ≈ 0.5 s segments at a given log rate (power of two). */
export function spectrumNfft(fs: number): number {
  let n = 256;
  while (n / fs < 0.5) n *= 2;
  return n;
}

export const toDb = (p: number) => 10 * Math.log10(Math.max(p, 1e-20));

/** Local maxima of a PSD above `minDbOverFloor` relative to the median level, strongest first. */
export function findPeaks(
  spec: Psd,
  fMin: number,
  fMax: number,
  minDbOverFloor = 10,
): { f: number; db: number }[] {
  const idx: number[] = [];
  for (let k = 1; k < spec.f.length - 1; k++) if (spec.f[k]! >= fMin && spec.f[k]! <= fMax) idx.push(k);
  const levels = idx.map((k) => toDb(spec.psd[k]!)).sort((a, b) => a - b);
  const floor = levels[Math.floor(levels.length / 2)] ?? -200;
  const peaks: { f: number; db: number }[] = [];
  for (const k of idx) {
    const p = spec.psd[k]!;
    if (p > spec.psd[k - 1]! && p >= spec.psd[k + 1]! && toDb(p) - floor >= minDbOverFloor) {
      // parabolic interpolation on dB for sub-bin accuracy
      const a = toDb(spec.psd[k - 1]!);
      const b = toDb(p);
      const c = toDb(spec.psd[k + 1]!);
      const den = a - 2 * b + c;
      const off = den !== 0 ? (0.5 * (a - c)) / den : 0;
      const df = spec.f[1]! - spec.f[0]!;
      peaks.push({ f: spec.f[k]! + off * df, db: b });
    }
  }
  return peaks.sort((x, y) => y.db - x.db);
}
