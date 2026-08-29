// Engine-attempts ledger.
//
// browser-worker.ts already records, per execution provider, the stage it
// reached and why it was rejected. That evidence used to die inside the worker
// unless every provider failed. This module keeps the last ledger so the
// pre-start diagnostics panel and the session reports can show WHY the app
// ended up on WASM instead of WebGPU.

export interface EngineAttempt {
  engine: string;
  asset: string;
  /** Stage reached: runtime-load | model-download | session-create | self-test | ready. */
  stage: string;
  ms?: number;
  cause?: string;
  error?: string;
}

const STORAGE_KEY = "sentryeye.engine-attempts.v1";

let attempts: EngineAttempt[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

/** Coerce an unknown worker payload into the ledger shape. */
export function parseEngineAttempts(value: unknown): EngineAttempt[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .map((a) => ({
      engine: String(a["engine"] ?? "unknown"),
      asset: String(a["asset"] ?? ""),
      stage: String(a["stage"] ?? "unknown"),
      ...(typeof a["ms"] === "number" ? { ms: a["ms"] as number } : {}),
      ...(a["cause"] ? { cause: String(a["cause"]) } : {}),
      ...(a["error"] ? { error: String(a["error"]) } : {}),
    }));
}

function hydrate() {
  if (loaded || typeof localStorage === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) attempts = parseEngineAttempts(JSON.parse(raw));
  } catch {
    /* ignore unreadable storage */
  }
}

export function setEngineAttempts(next: EngineAttempt[]): void {
  loaded = true;
  attempts = next;
  try {
    localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage is best-effort */
  }
  emit();
}

export function readEngineAttempts(): EngineAttempt[] {
  hydrate();
  return attempts;
}

export function subscribeEngineAttempts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** One-line summary per attempt, used by the PDF builders and plain text dumps. */
export function describeEngineAttempt(a: EngineAttempt): string {
  const head = `${a.engine}${a.asset ? ` (${a.asset})` : ""} — ${
    a.stage === "ready" ? "selected" : `stopped at ${a.stage}`
  }`;
  const why = a.cause ? ` · ${a.cause}` : "";
  const err = a.error ? `: ${a.error}` : "";
  const ms = typeof a.ms === "number" ? ` [${a.ms}ms]` : "";
  return `${head}${why}${err}${ms}`;
}
