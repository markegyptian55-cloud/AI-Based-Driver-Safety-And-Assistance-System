// Per-(device, model, engine) latency baseline, stored locally.
//
// A benchmark number is only meaningful next to yesterday's number on the same
// phone. This keeps a small rolling history in IndexedDB so a run that is
// meaningfully slower than this device's own history can be called out while
// the driver is still in front of the screen.

export interface LatencyRecord {
  key: string;
  modelId: string;
  engine: string;
  device: string;
  /** ISO timestamps + metrics, newest last. */
  runs: Array<{
    at: number;
    fpsP50: number;
    fpsP95: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
  }>;
}

export interface LatencyBaseline {
  runs: number;
  fpsP50: number;
  latencyP50Ms: number;
}

export interface RegressionVerdict {
  regressed: boolean;
  /** Positive = slower than baseline, as a ratio (0.25 = 25% slower). */
  latencyDelta: number;
  fpsDelta: number;
  baseline: LatencyBaseline;
  message: string;
}

/** A run must be this much slower than the baseline to raise an alert. */
export const REGRESSION_RATIO = 0.2;
const MAX_RUNS = 20;
const DB_NAME = "sentryeye-perf";
const STORE = "latency-baselines";

export function deviceKey(): string {
  if (typeof navigator === "undefined") return "unknown-device";
  const nav = navigator as Navigator & { deviceMemory?: number };
  return [
    nav.hardwareConcurrency ?? 0,
    nav.deviceMemory ?? 0,
    typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "0x0",
    /android/i.test(nav.userAgent) ? "android" : /iphone|ipad/i.test(nav.userAgent) ? "ios" : "desktop",
  ].join("-");
}

export function baselineKey(modelId: string, engine: string, device = deviceKey()): string {
  return `${device}|${modelId}|${engine}`;
}

/** Median of the stored runs — robust against one bad session. */
export function summarize(record: LatencyRecord | null): LatencyBaseline | null {
  if (!record || record.runs.length === 0) return null;
  const med = (values: number[]) => {
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return {
    runs: record.runs.length,
    fpsP50: med(record.runs.map((r) => r.fpsP50)),
    latencyP50Ms: med(record.runs.map((r) => r.latencyP50Ms)),
  };
}

/** Pure comparison so the rule is unit-testable without IndexedDB. */
export function compareToBaseline(
  current: { fpsP50: number; latencyP50Ms: number },
  baseline: LatencyBaseline | null,
  ratio = REGRESSION_RATIO,
): RegressionVerdict | null {
  if (!baseline || baseline.runs < 2 || baseline.latencyP50Ms <= 0) return null;
  const latencyDelta = (current.latencyP50Ms - baseline.latencyP50Ms) / baseline.latencyP50Ms;
  const fpsDelta = baseline.fpsP50 > 0 ? (baseline.fpsP50 - current.fpsP50) / baseline.fpsP50 : 0;
  const regressed = latencyDelta >= ratio || fpsDelta >= ratio;
  return {
    regressed,
    latencyDelta,
    fpsDelta,
    baseline,
    message: regressed
      ? `This run is ${Math.round(Math.max(latencyDelta, fpsDelta) * 100)}% slower than this device's usual result (${Math.round(
          baseline.latencyP50Ms,
        )} ms / ${baseline.fpsP50.toFixed(1)} fps over ${baseline.runs} runs).`
      : `In line with this device's usual result (${Math.round(baseline.latencyP50Ms)} ms / ${baseline.fpsP50.toFixed(1)} fps).`,
  };
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function readRecord(key: string): Promise<LatencyRecord | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as LatencyRecord) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function recordRun(
  modelId: string,
  engine: string,
  run: { fpsP50: number; fpsP95: number; latencyP50Ms: number; latencyP95Ms: number },
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const device = deviceKey();
  const key = baselineKey(modelId, engine, device);
  const existing = (await readRecord(key)) ?? { key, modelId, engine, device, runs: [] };
  existing.runs = [...existing.runs, { at: Date.now(), ...run }].slice(-MAX_RUNS);
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(existing);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Read the stored baseline and compare the current run against it. */
export async function checkRegression(
  modelId: string,
  engine: string,
  current: { fpsP50: number; latencyP50Ms: number },
): Promise<RegressionVerdict | null> {
  const record = await readRecord(baselineKey(modelId, engine));
  return compareToBaseline(current, summarize(record));
}
