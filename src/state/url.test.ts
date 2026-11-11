import { describe, expect, it } from 'vitest';
import { defaultBfParams } from '../engine/presets.ts';
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
});
