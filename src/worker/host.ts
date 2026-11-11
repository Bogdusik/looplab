import { scopeData } from '../state/scopeData.ts';
import { shareHash, useStore } from '../state/store.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

let worker: Worker | null = null;

function send(msg: ToWorker) {
  worker?.postMessage(msg);
}

export function sendStick(value: number) {
  send({ type: 'stick', value });
}

/** Start the worker and keep it in sync with the store. Returns a disposer. */
export function startHost(): () => void {
  worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    switch (m.type) {
      case 'frame':
        scopeData.ingest(m);
        break;
      case 'step':
        useStore.setState({ step: m });
        break;
      case 'spectrum':
        useStore.setState({ spectrum: m });
        break;
      case 'status':
        useStore.setState({ status: m });
        break;
    }
  };

  const s0 = useStore.getState();
  scopeData.reset(s0.mode);
  send({ type: 'params', mode: s0.mode, bf: s0.bf, classic: s0.classic });
  send({ type: 'control', paused: s0.paused, speed: s0.speed });
  send({ type: 'stepOptions', options: { feedforward: s0.stepFf, rcSmoothing: s0.stepRcSmoothing } });

  let hashTimer: ReturnType<typeof setTimeout> | null = null;
  const unsub = useStore.subscribe((s, prev) => {
    if (s.mode !== prev.mode) scopeData.reset(s.mode);
    if (s.mode !== prev.mode || s.bf !== prev.bf || s.classic !== prev.classic) {
      send({ type: 'params', mode: s.mode, bf: s.bf, classic: s.classic });
    }
    if (s.paused !== prev.paused || s.speed !== prev.speed) {
      scopeData.frozen = s.paused;
      send({ type: 'control', paused: s.paused, speed: s.speed });
    }
    if (s.resetToken !== prev.resetToken) {
      scopeData.reset(s.mode);
      send({ type: 'reset' });
    }
    if (s.stepFf !== prev.stepFf || s.stepRcSmoothing !== prev.stepRcSmoothing) {
      send({ type: 'stepOptions', options: { feedforward: s.stepFf, rcSmoothing: s.stepRcSmoothing } });
    }
    if (
      s.mode !== prev.mode ||
      s.bf !== prev.bf ||
      s.classic !== prev.classic ||
      s.tuning !== prev.tuning ||
      s.droneId !== prev.droneId
    ) {
      if (hashTimer) clearTimeout(hashTimer);
      hashTimer = setTimeout(() => {
        const st = useStore.getState();
        history.replaceState(null, '', shareHash(st));
      }, 300);
    }
  });

  return () => {
    unsub();
    worker?.terminate();
    worker = null;
  };
}
