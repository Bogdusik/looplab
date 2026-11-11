/**
 * URL state: only the differences from defaults are stored, as base64url-encoded JSON in the
 * hash (`#s=…`), so links stay short and old links survive new default values.
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural diff: returns undefined when equal. Arrays are compared and stored whole. */
export function diff(base: unknown, value: unknown): Json | undefined {
  if (isObj(base) && isObj(value)) {
    const out: Record<string, Json> = {};
    for (const k of Object.keys(value)) {
      const d = diff(base[k], value[k]);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(base) === JSON.stringify(value) ? undefined : (value as Json);
}

/** Deep-merge a diff onto a base (only keys present in base are accepted, types must match). */
export function merge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) {
    if (patch === undefined) return base;
    if (Array.isArray(base) && Array.isArray(patch) && patch.length === base.length) return patch as T;
    if (typeof patch === typeof base && !isObj(patch)) return patch as T;
    return base;
  }
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(base)) if (k in patch) out[k] = merge(base[k], patch[k]);
  return out as T;
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeState(state: Json): string {
  return toBase64Url(JSON.stringify(state));
}

export function decodeState(s: string): unknown {
  try {
    return JSON.parse(fromBase64Url(s));
  } catch {
    return null;
  }
}

export function readHashState(hash: string): unknown {
  const m = /[#&]s=([A-Za-z0-9_-]+)/.exec(hash);
  return m ? decodeState(m[1]!) : null;
}
