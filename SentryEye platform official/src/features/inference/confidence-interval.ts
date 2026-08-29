// Small-sample statistics for quick test results.
//
// A 20-frame probe that detects a yawn in 3 frames is not evidence of a 15%
// detection rate — the interval around it is enormous. Wilson intervals stay
// sensible at small n and never escape [0, 1], unlike the normal approximation.

export interface Interval {
  value: number;
  low: number;
  high: number;
}

const Z = 1.959963985; // 95%

/** Binomial proportion interval (Wilson score). */
export function wilsonInterval(successes: number, total: number): Interval {
  if (total <= 0) return { value: 0, low: 0, high: 0 };
  const p = successes / total;
  const z2 = Z * Z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const spread = (Z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return {
    value: p,
    low: Math.max(0, centre - spread),
    high: Math.min(1, centre + spread),
  };
}

/** Mean with a 95% normal interval; null when there is no sample. */
export function meanInterval(values: number[]): Interval | null {
  const n = values.length;
  if (n === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { value: mean, low: mean, high: mean };
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const half = (Z * Math.sqrt(variance)) / Math.sqrt(n);
  return { value: mean, low: Math.max(0, mean - half), high: Math.min(1, mean + half) };
}
