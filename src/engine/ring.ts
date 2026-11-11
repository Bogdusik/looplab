/** Fixed-capacity Float32 ring buffer; `toArray` returns oldest → newest. */
export class Ring {
  readonly buf: Float32Array;
  private head = 0;
  private count = 0;

  constructor(capacity: number) {
    this.buf = new Float32Array(capacity);
  }

  push(v: number): void {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.buf.length;
    if (this.count < this.buf.length) this.count++;
  }

  get length(): number {
    return this.count;
  }

  /** i = 0 is the oldest retained sample. */
  get(i: number): number {
    const cap = this.buf.length;
    return this.buf[(this.head - this.count + i + cap * 2) % cap]!;
  }

  latest(): number {
    return this.count ? this.get(this.count - 1) : 0;
  }

  toArray(out?: Float32Array): Float32Array {
    const res = out && out.length >= this.count ? out : new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) res[i] = this.get(i);
    return res;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}
