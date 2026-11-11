/**
 * `npm run findings` — regenerates docs/img/*.svg and docs/findings-data.json.
 * Runs with Node's built-in TypeScript stripping; the engine is pure TS with no DOM.
 *
 * The "legacy" curves come from LegacyClassicSim, our emulation of the ORIGINAL simulator's
 * mechanisms (frame-based stepping, per-frame EMAs, delay buffer wiped while the target moves).
 * They are not produced by the original code.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BfSim } from '../src/engine/bfsim.ts';
import { CLASSIC_DEFAULTS, ClassicSim, LegacyClassicSim, type ClassicParams } from '../src/engine/classic.ts';
import { defaultBfParams } from '../src/engine/presets.ts';
import { SIMPLIFIED_DEFAULTS, simplifiedPids } from '../src/engine/sliders.ts';
import { BlackboxDecimator, DEFAULT_BLACKBOX_HZ } from '../src/engine/blackbox.ts';
import { spectrumNfft, toDb, welch } from '../src/engine/spectrum.ts';
import { DEFAULT_STEP_OPTIONS, idealStepResponse } from '../src/engine/stepResponse.ts';
import { linePlot } from './svgplot.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const img = join(root, 'docs', 'img');
mkdirSync(img, { recursive: true });
const data: Record<string, unknown> = {};
const write = (name: string, svg: string) => {
  writeFileSync(join(img, name), svg);
  console.log(`  wrote docs/img/${name}`);
};
const COLORS = { c60: '#2563eb', c144: '#d97706', c240: '#dc2626', fixed: '#059669', target: '#6b7280' };

// ------------------------------------------------------------------------------------------------
// Bug #2 — physics (and "motor heat") depend on the display refresh rate
// ------------------------------------------------------------------------------------------------
{
  const seconds = 10;
  const legacy = (fps: number) => {
    const s = new LegacyClassicSim(CLASSIC_DEFAULTS);
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < fps * seconds; i++) {
      s.frame(1 / fps);
      if (i % Math.round(fps / 30) === 0) {
        x.push((i + 1) / fps);
        y.push(s.heat);
      }
    }
    return { x, y, final: s.heat };
  };
  const fixed = (fps: number) => {
    // fixed-step model driven by the same render rate via the accumulator → identical result
    const s = new ClassicSim(CLASSIC_DEFAULTS);
    const x: number[] = [];
    const y: number[] = [];
    let acc = 0;
    for (let i = 0; i < fps * seconds; i++) {
      acc += 1 / fps;
      const n = Math.floor(acc / s.h + 1e-9);
      acc -= n * s.h;
      s.run(n);
      if (i % Math.round(fps / 30) === 0) {
        x.push(s.out.t);
        y.push(s.out.heat);
      }
    }
    return { x, y, final: s.out.heat };
  };
  const l60 = legacy(60);
  const l144 = legacy(144);
  const l240 = legacy(240);
  const f60 = fixed(60);
  const f144 = fixed(144);
  const f240 = fixed(240);
  data.bug2 = {
    legacyHeat: { hz60: l60.final, hz144: l144.final, hz240: l240.final },
    fixedHeat: { hz60: f60.final, hz144: f144.final, hz240: f240.final },
    legacyRatio240to60: l240.final / l60.final,
  };
  write(
    'bug2-legacy-heat-vs-refresh.svg',
    linePlot({
      title: 'Bug #2 (legacy emulation): "motor heat" at hover depends on monitor refresh rate',
      subtitle: 'Default gains, sticks centred. Frame-stepped physics: D of noise scales with 1/frame-time.',
      xLabel: 'time (s)',
      yLabel: 'heat (legacy units)',
      series: [
        { name: 'legacy @ 60 Hz', color: COLORS.c60, x: l60.x, y: l60.y },
        { name: 'legacy @ 144 Hz', color: COLORS.c144, x: l144.x, y: l144.y },
        { name: 'legacy @ 240 Hz', color: COLORS.c240, x: l240.x, y: l240.y },
      ],
    }),
  );
  write(
    'bug2-fixed-heat-vs-refresh.svg',
    linePlot({
      title: 'Fixed-step model: identical heat at 60 / 144 / 240 Hz',
      subtitle: '1 ms physics step, render frames only decide how many steps run per frame.',
      xLabel: 'time (s)',
      yLabel: 'heat (fixed-model units)',
      series: [
        { name: 'fixed @ 60 Hz', color: COLORS.c60, x: f60.x, y: f60.y, width: 5 },
        { name: 'fixed @ 144 Hz', color: COLORS.c144, x: f144.x, y: f144.y, width: 3 },
        { name: 'fixed @ 240 Hz', color: COLORS.c240, x: f240.x, y: f240.y, dash: '6 4' },
      ],
    }),
  );
}

// ------------------------------------------------------------------------------------------------
// Bug #1 — the delay buffer is wiped while the (smoothed) target moves
// ------------------------------------------------------------------------------------------------
{
  const fps = 60;
  const p: ClassicParams = { ...CLASSIC_DEFAULTS, kp: 20, kd: 0, ki: 0, kff: 0, delayMs: 30, noise: 0 };
  const seconds = 8;
  const legacy = new LegacyClassicSim(p);
  const fixed = new ClassicSim(p);
  const xs: number[] = [];
  const legacyPos: number[] = [];
  const fixedPos: number[] = [];
  const target: number[] = [];
  const legacyDelay: number[] = [];
  let acc = 0;
  for (let i = 0; i < fps * seconds; i++) {
    const t = i / fps;
    const handle = t >= 0.5 ? 50 : 0;
    legacy.setHandle(handle);
    fixed.setHandle(handle);
    legacy.frame(1 / fps);
    acc += 1 / fps;
    const n = Math.floor(acc / fixed.h + 1e-9);
    acc -= n * fixed.h;
    fixed.run(n);
    xs.push(t + 1 / fps);
    legacyPos.push(legacy.position);
    fixedPos.push(fixed.out.pos);
    target.push(fixed.out.target);
    legacyDelay.push(legacy.lastAppliedDelay * 1000);
  }
  const ampAt = (pos: number[], t0: number, t1: number) => {
    let lo = Infinity;
    let hi = -Infinity;
    xs.forEach((t, i) => {
      if (t >= t0 && t < t1) {
        lo = Math.min(lo, pos[i]!);
        hi = Math.max(hi, pos[i]!);
      }
    });
    return (hi - lo) / 2;
  };
  data.bug1 = {
    params: { kp: 20, kd: 0, delayMs: 30, fps },
    oscillationAmplitudeAround6s: { legacy: ampAt(legacyPos, 5.5, 6.5), fixed: ampAt(fixedPos, 5.5, 6.5) },
    recreations: legacy.recreations,
  };
  write(
    'bug1-delay-runaway.svg',
    linePlot({
      title: 'Bug #1: with the delay wiped during the move, "delay + high P" looks tame',
      subtitle: 'P = 20, D = 0, delay 30 ms, step 0 → 50 at t = 0.5 s, 60 Hz frames.',
      xLabel: 'time (s)',
      yLabel: 'position (track units)',
      yRange: [-250, 300],
      series: [
        { name: 'target (smoothed)', color: COLORS.target, x: xs, y: target, dash: '5 4' },
        { name: 'legacy emulation', color: COLORS.c240, x: xs, y: legacyPos },
        { name: 'fixed (true 30 ms delay)', color: COLORS.fixed, x: xs, y: fixedPos },
      ],
    }),
  );
  write(
    'bug1-applied-delay.svg',
    linePlot({
      title: 'Applied delay while the target is still converging (legacy emulation)',
      subtitle:
        'Configured 30 ms. The buffer is cleared on every frame in which the smoothed target changed.',
      xLabel: 'time (s)',
      yLabel: 'applied delay (ms)',
      yRange: [0, 40],
      hlines: [{ y: 30, label: 'configured / fixed model', color: COLORS.fixed }],
      series: [{ name: 'legacy applied delay', color: COLORS.c240, x: xs, y: legacyDelay }],
    }),
  );
}

// ------------------------------------------------------------------------------------------------
// Masterclass lesson — master multiplier sweep on the default 5" (README plot)
// ------------------------------------------------------------------------------------------------
{
  const masters = [60, 80, 100, 120, 140, 160, 180, 200, 220, 240];
  const latency: number[] = [];
  const overshoot: number[] = [];
  const dtermPeak: number[] = [];
  for (const mm of masters) {
    const p = defaultBfParams('freestyle5');
    const g = simplifiedPids({ ...SIMPLIFIED_DEFAULTS, master: mm }, 'roll');
    p.pid.gains = { p: g.p, i: g.i, d: g.d, f: g.f };
    const r = idealStepResponse(p, DEFAULT_STEP_OPTIONS);
    latency.push(r.metrics.latency50 * 1000);
    overshoot.push(r.metrics.overshootPct);
    const sim = new BfSim(p);
    sim.run(8000);
    // D-term spectrum on the default 2 kHz Blackbox stream, PIDtoolbox (PSSpec2d) scaling
    const fs = DEFAULT_BLACKBOX_HZ;
    const dec = new BlackboxDecimator(p.loop.gyroHz, fs);
    const d: number[] = [];
    for (let i = 0; i < p.loop.gyroHz * 6; i++) {
      sim.step();
      if (dec.tick()) d.push(sim.out.d);
    }
    const s = welch(d, fs, spectrumNfft(fs));
    let mx = -Infinity;
    for (let k = 0; k < s.f.length; k++)
      if (s.f[k]! >= 20 && s.f[k]! <= fs / 2) mx = Math.max(mx, toDb(s.psd[k]!));
    dtermPeak.push(mx);
  }
  const x = masters.map((m) => m / 100);
  data.masterSweep = { master: x, latencyMs: latency, overshootPct: overshoot, dtermPeakDb: dtermPeak };
  write(
    'lesson-master-multiplier.svg',
    linePlot({
      title: 'Master multiplier sweep — 5" freestyle preset (ideal step, FF off)',
      subtitle:
        'Latency flattens around ×2 while D-term noise (2 kHz log, PIDtoolbox scaling) climbs towards −10 dB.',
      xLabel: 'master multiplier',
      yLabel: 'ms  /  %  /  dB',
      yRange: [-40, 40],
      hlines: [{ y: -10, label: '−10 dB D-term guideline', color: '#dc2626' }],
      series: [
        { name: 'latency to 50 % (ms)', color: '#2563eb', x, y: latency },
        { name: 'overshoot (%)', color: '#d97706', x, y: overshoot },
        { name: 'D-term PSD peak (dB)', color: '#059669', x, y: dtermPeak },
      ],
    }),
  );
}

writeFileSync(join(root, 'docs', 'findings-data.json'), JSON.stringify(data, null, 2) + '\n');
console.log('  wrote docs/findings-data.json');
console.log(JSON.stringify(data, null, 2));
