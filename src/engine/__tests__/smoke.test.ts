import { describe, expect, it } from 'vitest';
import { BETAFLIGHT_REF } from '../version.ts';

describe('scaffold', () => {
  it('exposes the Betaflight reference', () => {
    expect(BETAFLIGHT_REF).toMatch(/^betaflight\/betaflight@/);
  });
});
