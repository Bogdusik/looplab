/**
 * Blackbox-style plain decimation of the gyro-rate stream (no anti-alias filter), as Betaflight's
 * blackbox does when it logs every n-th loop. Spectra are computed on this stream because the dB
 * level of the noise floor depends on the sample rate.
 *
 * 2 kHz and 4 kHz divide the 8 kHz gyro rate exactly (every 4th / 2nd sample). 1.6 and 3.2 kHz are
 * native rates of 3.2 kHz gyros (e.g. BMI270) and do not divide 8 kHz: they are emulated by taking the
 * most recent sample at each log tick (integer phase accumulator, ≤ one gyro period of timing jitter).
 */
export const BLACKBOX_RATES = [1600, 2000, 3200, 4000] as const;
export type BlackboxRate = (typeof BLACKBOX_RATES)[number];
export const DEFAULT_BLACKBOX_HZ: BlackboxRate = 2000;

export class BlackboxDecimator {
  readonly gyroHz: number;
  readonly logHz: number;
  private phase: number;

  constructor(gyroHz: number, logHz: number) {
    this.gyroHz = gyroHz;
    this.logHz = Math.min(logHz, gyroHz);
    this.phase = gyroHz - this.logHz; // first sample is logged
  }

  /** Call once per gyro sample; true when this sample goes into the log. */
  tick(): boolean {
    this.phase += this.logHz;
    if (this.phase >= this.gyroHz) {
      this.phase -= this.gyroHz;
      return true;
    }
    return false;
  }

  /** True when the log rate is an exact divisor of the gyro rate (pure decimation). */
  get exact(): boolean {
    return this.gyroHz % this.logHz === 0;
  }
}
