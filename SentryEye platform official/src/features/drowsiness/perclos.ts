// Rolling PERCLOS (percentage of eye closure) over a time window.
// Pure, testable — no browser APIs.

export interface PerclosSample {
  ts: number;
  closed: boolean;
}

export class PerclosWindow {
  private samples: PerclosSample[] = [];
  constructor(private windowMs: number) {}

  add(sample: PerclosSample) {
    this.samples.push(sample);
    const cutoff = sample.ts - this.windowMs;
    while (this.samples.length && this.samples[0].ts < cutoff) this.samples.shift();
  }

  /** Ratio 0..1 of samples in the window where eye was closed. */
  ratio(): number {
    if (!this.samples.length) return 0;
    let closed = 0;
    for (const s of this.samples) if (s.closed) closed++;
    return closed / this.samples.length;
  }

  size() {
    return this.samples.length;
  }

  reset() {
    this.samples = [];
  }
}
