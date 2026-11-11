import { describe, expect, it } from 'vitest';
import { defaultBfParams, RATE_PRESETS } from '../engine/presets.ts';
import { decodeState, diff, encodeState, merge, readHashState } from './url.ts';

describe('URL state', () => {
  it('diff is empty for defaults and round-trips through base64url', () => {
    const a = defaultBfParams();
    expect(diff(a, structuredClone(a))).toBeUndefined();
    const b = structuredClone(a);
    b.pid.gains.p = 60;
    b.filters.rpm.weights = [1, 0.5, 0];
    b.drone.noise.balance = 2.5;
    const d = diff(a, b)!;
    const back = merge(defaultBfParams(), decodeState(encodeState(d)));
    expect(back).toEqual(b);
    expect(readHashState('#s=' + encodeState(d))).toEqual(d);
  });

  it('merge ignores unknown keys and wrong types', () => {
    const a = defaultBfParams();
    const m = merge(a, { pid: { gains: { p: 'x', nope: 1 } }, evil: true });
    expect(m).toEqual(a);
  });

  it('links made before the "My rates" → "Smooth freestyle" rename still load the same rates', () => {
    // v0.1.0-pre links store rate values, never the preset key
    const legacy = encodeState({ droneId: 'freestyle5', bf: { rates: { centerRate: 50, expo: 0.45 } } });
    const raw = readHashState('#s=' + legacy) as { bf: unknown };
    const bf = merge(defaultBfParams(), raw.bf);
    expect(bf.rates).toEqual(RATE_PRESETS.smoothFreestyle!.rates);
  });
});
