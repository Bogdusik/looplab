import { create } from 'zustand';
import { CLASSIC_DEFAULTS, type ClassicParams } from '../engine/classic.ts';
import { DEFAULT_DRONE_ID, defaultBfParams, DRONE_PRESETS } from '../engine/presets.ts';
import {
  SIMPLIFIED_DEFAULTS,
  simplifiedFilters,
  simplifiedPids,
  type SimplifiedTuning,
} from '../engine/sliders.ts';
import type { BfParams } from '../engine/types.ts';
import type { BfChannel, ClassicChannel, Mode, SpectrumMsg, StatusMsg, StepMsg } from '../worker/protocol.ts';
import { diff, encodeState, merge, readHashState } from './url.ts';

export type LeftTab = 'tune' | 'filters' | 'drone' | 'noise';
export type TuneMode = 'sliders' | 'advanced';

export interface Tuning {
  mode: TuneMode;
  /** Filter sliders active (Configurator: "Gyro / D-term filter multiplier"). */
  filterSliders: boolean;
  s: SimplifiedTuning;
}

export interface Persisted {
  mode: Mode;
  droneId: string;
  bf: BfParams;
  classic: ClassicParams;
  tuning: Tuning;
}

export interface AppState extends Persisted {
  leftTab: LeftTab;
  paused: boolean;
  speed: number;
  helpOpen: boolean;
  stepFf: boolean;
  stepRcSmoothing: boolean;
  bfTraces: Record<BfChannel, boolean>;
  classicTraces: Record<ClassicChannel, boolean>;
  step: StepMsg | null;
  spectrum: SpectrumMsg | null;
  status: StatusMsg | null;
  /** Bumps on "Reset sim" so the host can tell the worker. */
  resetToken: number;
}

export const DEFAULT_TUNING: Tuning = { mode: 'sliders', filterSliders: true, s: { ...SIMPLIFIED_DEFAULTS } };

export function defaultPersisted(droneId = DEFAULT_DRONE_ID): Persisted {
  return {
    mode: 'bf',
    droneId,
    bf: defaultBfParams(droneId),
    classic: { ...CLASSIC_DEFAULTS },
    tuning: structuredClone(DEFAULT_TUNING),
  };
}

/** Apply slider positions to the engine params (roll axis; pitch shown for reference). */
export function applyTuning(bf: BfParams, t: Tuning): BfParams {
  const next = structuredClone(bf);
  if (t.mode === 'sliders') {
    const g = simplifiedPids(t.s, 'roll');
    next.pid.gains = { p: g.p, i: g.i, d: g.d, f: g.f };
  }
  if (t.filterSliders) next.filters = simplifiedFilters(t.s, next.filters);
  return next;
}

function initialPersisted(): Persisted {
  const base = defaultPersisted();
  if (typeof location === 'undefined') return base;
  const raw = readHashState(location.hash) as Partial<Record<keyof Persisted, unknown>> | null;
  if (!raw) return base;
  const droneId =
    typeof raw.droneId === 'string' && raw.droneId in DRONE_PRESETS ? raw.droneId : DEFAULT_DRONE_ID;
  const fresh = defaultPersisted(droneId);
  return {
    mode: raw.mode === 'classic' ? 'classic' : 'bf',
    droneId,
    bf: merge(fresh.bf, raw.bf),
    classic: merge(fresh.classic, raw.classic),
    tuning: merge(fresh.tuning, raw.tuning),
  };
}

/** Serialise the persisted part as a diff against the defaults of the chosen drone. */
export function shareHash(s: Persisted): string {
  const fresh = defaultPersisted(s.droneId);
  const payload: Record<string, unknown> = { droneId: s.droneId };
  if (s.mode !== 'bf') payload.mode = s.mode;
  const b = diff(fresh.bf, s.bf);
  const c = diff(fresh.classic, s.classic);
  const t = diff(fresh.tuning, s.tuning);
  if (b !== undefined) payload.bf = b;
  if (c !== undefined) payload.classic = c;
  if (t !== undefined) payload.tuning = t;
  return '#s=' + encodeState(payload as never);
}

const p0 = initialPersisted();

export const useStore = create<AppState>(() => ({
  ...p0,
  leftTab: 'tune',
  paused: false,
  speed: 1,
  helpOpen: false,
  stepFf: false,
  stepRcSmoothing: false,
  bfTraces: {
    setpoint: true,
    gyroFilt: true,
    gyroRaw: false,
    p: false,
    i: false,
    d: true,
    f: false,
    motorL: false,
    motorR: false,
  },
  classicTraces: {
    target: true,
    pos: true,
    meas: false,
    p: false,
    i: false,
    d: false,
    ff: false,
    force: false,
  },
  step: null,
  spectrum: null,
  status: null,
  resetToken: 0,
}));

const set = useStore.setState;
const get = useStore.getState;

export const actions = {
  setMode(mode: Mode) {
    set({ mode, step: null, spectrum: null });
  },
  /** Edit engine params directly (Advanced tab, filters, drone, noise). */
  editBf(mutate: (p: BfParams) => void) {
    const next = structuredClone(get().bf);
    mutate(next);
    set({ bf: next });
  },
  setRawGains(g: Partial<BfParams['pid']['gains']>) {
    const next = structuredClone(get().bf);
    Object.assign(next.pid.gains, g);
    set({ bf: next, tuning: { ...get().tuning, mode: 'advanced' } });
  },
  setTuneMode(mode: TuneMode) {
    const tuning = { ...get().tuning, mode };
    set({ tuning, bf: applyTuning(get().bf, tuning) });
  },
  setSlider(key: keyof SimplifiedTuning, value: number) {
    const tuning = { ...get().tuning, s: { ...get().tuning.s, [key]: value } };
    set({ tuning, bf: applyTuning(get().bf, tuning) });
  },
  setFilterSliders(on: boolean) {
    const tuning = { ...get().tuning, filterSliders: on };
    set({ tuning, bf: applyTuning(get().bf, tuning) });
  },
  editClassic(patch: Partial<ClassicParams>) {
    set({ classic: { ...get().classic, ...patch } });
  },
  selectDrone(id: string) {
    const fresh = defaultPersisted(id);
    const tuning = structuredClone(DEFAULT_TUNING);
    set({ droneId: id, bf: applyTuning(fresh.bf, tuning), tuning, step: null, spectrum: null });
  },
  resetSim() {
    set({ resetToken: get().resetToken + 1 });
  },
  resetAll() {
    const fresh = defaultPersisted(get().droneId);
    set({ ...fresh, mode: get().mode, step: null, spectrum: null, resetToken: get().resetToken + 1 });
  },
  setPaused(paused: boolean) {
    set({ paused });
  },
  setSpeed(speed: number) {
    set({ speed });
  },
  setLeftTab(leftTab: LeftTab) {
    set({ leftTab });
  },
  setHelp(helpOpen: boolean) {
    set({ helpOpen });
  },
  toggleBfTrace(k: BfChannel) {
    set({ bfTraces: { ...get().bfTraces, [k]: !get().bfTraces[k] } });
  },
  toggleClassicTrace(k: ClassicChannel) {
    set({ classicTraces: { ...get().classicTraces, [k]: !get().classicTraces[k] } });
  },
  setStepOptions(o: { ff?: boolean; rcSmoothing?: boolean }) {
    set({ stepFf: o.ff ?? get().stepFf, stepRcSmoothing: o.rcSmoothing ?? get().stepRcSmoothing });
  },
};
