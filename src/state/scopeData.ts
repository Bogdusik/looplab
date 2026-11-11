import { Ring } from '../engine/ring.ts';
import { BF_CHANNELS, CLASSIC_CHANNELS, SCOPE_HZ, type FrameMsg, type Mode } from '../worker/protocol.ts';

/** Main-thread ring buffers fed by worker frames; canvases read them imperatively. */
export const SCOPE_SECONDS = 10;
const CAP = SCOPE_SECONDS * SCOPE_HZ;

class ScopeData {
  mode: Mode = 'bf';
  rings: Ring[] = BF_CHANNELS.map(() => new Ring(CAP));
  /** Sim time of the newest sample. */
  tEnd = 0;
  follower = 0;
  setpoint = 0;
  angle = 0;
  version = 0;
  frozen = false;

  reset(mode: Mode) {
    this.mode = mode;
    const n = mode === 'bf' ? BF_CHANNELS.length : CLASSIC_CHANNELS.length;
    this.rings = Array.from({ length: n }, () => new Ring(CAP));
    this.tEnd = 0;
    this.version++;
  }

  ingest(m: FrameMsg) {
    if (m.mode !== this.mode) this.reset(m.mode);
    this.follower = m.follower;
    this.setpoint = m.setpoint;
    this.angle = m.angle;
    if (this.frozen) return;
    for (let c = 0; c < m.channels.length && c < this.rings.length; c++) {
      const ch = m.channels[c]!;
      const ring = this.rings[c]!;
      for (let i = 0; i < m.n; i++) ring.push(ch[i]!);
    }
    this.tEnd = m.t0 + m.n * m.dt;
    this.version++;
  }
}

export const scopeData = new ScopeData();
