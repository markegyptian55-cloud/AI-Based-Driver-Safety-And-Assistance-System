// Inference startup log.
//
// When a phone hangs while "preparing the model", the only useful evidence is
// the ordered list of stages the worker actually reached and the timestamp of
// each one. This module is a tiny observable ring buffer that the model
// context writes to and the debug panel / stage timeline read from.

export interface StartupLogEntry {
  stage: string;
  /** Epoch ms. */
  at: number;
  /** ms since the attempt began. */
  t: number;
  detail?: Record<string, unknown>;
  level: "info" | "error";
}

export interface StartupLogSnapshot {
  startedAt: number | null;
  label: string | null;
  entries: StartupLogEntry[];
}

const MAX_ENTRIES = 120;

let snapshot: StartupLogSnapshot = { startedAt: null, label: null, entries: [] };
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function subscribeStartupLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startupLogSnapshot(): StartupLogSnapshot {
  return snapshot;
}

/** Begin a fresh attempt. Everything previously logged is dropped. */
export function resetStartupLog(label?: string): void {
  snapshot = { startedAt: Date.now(), label: label ?? null, entries: [] };
  emit();
}

function push(entry: Omit<StartupLogEntry, "t">) {
  const startedAt = snapshot.startedAt ?? entry.at;
  const entries = [...snapshot.entries, { ...entry, t: entry.at - startedAt }];
  snapshot = {
    startedAt,
    label: snapshot.label,
    entries: entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries,
  };
  emit();
}

export function recordStartupStage(stage: string, detail?: Record<string, unknown>): void {
  push({ stage, at: Date.now(), level: "info", ...(detail ? { detail } : {}) });
}

export function recordStartupError(message: string, stage?: string | null): void {
  push({
    stage: stage ? `error:${stage}` : "error",
    at: Date.now(),
    level: "error",
    detail: { message },
  });
}

/** Plain-text dump for the copy button / diagnostics bundle. */
export function formatStartupLog(): string {
  const s = snapshot;
  const head = `SentryEye inference startup log${s.label ? ` — ${s.label}` : ""}\nstarted: ${
    s.startedAt ? new Date(s.startedAt).toISOString() : "n/a"
  }\nua: ${typeof navigator === "undefined" ? "n/a" : navigator.userAgent}`;
  const body = s.entries
    .map((e) => {
      const detail = e.detail ? ` ${JSON.stringify(e.detail)}` : "";
      return `+${String(e.t).padStart(6, " ")}ms  ${e.level === "error" ? "!" : " "} ${e.stage}${detail}`;
    })
    .join("\n");
  return `${head}\n${body}`;
}

/** The four stages users are told to watch for when a boot hangs. */
export interface NamedStage {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "skipped" | "error";
  startedAt: number | null;
  durationMs: number | null;
  detail?: string;
}

const STAGE_SPECS: {
  id: string;
  label: string;
  start: string[];
  end: string[];
  skip?: string[];
}[] = [
  {
    id: "adapter",
    label: "Adapter probe",
    start: ["worker-init-received", "webgpu-adapter-probe"],
    end: ["ep-preferred", "runtime-load-done"],
    skip: ["webgpu-adapter-unavailable"],
  },
  {
    id: "session",
    label: "Session create",
    start: ["session-create-start"],
    end: ["session-create-done"],
  },
  {
    id: "selftest",
    label: "Self-test",
    start: ["engine-self-test-start", "session-create-done"],
    end: ["engine-self-test", "verifying-model", "engine-warmup-done"],
  },
  {
    id: "warmup",
    label: "Warm-up",
    start: ["compiling-kernels", "engine-warmup-start"],
    end: ["engine-warmup-done", "ready", "engine-warmup-skipped"],
  },
];

/** Derive the four named stages (with timings) from a raw log snapshot. */
export function namedStages(snap: StartupLogSnapshot = snapshot): NamedStage[] {
  const failed = snap.entries.find((e) => e.level === "error");
  const find = (ids: string[]) =>
    snap.entries.find((e) => ids.includes(e.stage)) ?? null;

  return STAGE_SPECS.map((spec) => {
    const start = find(spec.start);
    const end = find(spec.end);
    const skipped = spec.skip ? find(spec.skip) : null;
    if (!start) {
      return {
        id: spec.id,
        label: spec.label,
        status: failed ? "error" : "pending",
        startedAt: null,
        durationMs: null,
      } satisfies NamedStage;
    }
    if (end) {
      return {
        id: spec.id,
        label: spec.label,
        status: skipped && !spec.end.includes(end.stage) ? "skipped" : "done",
        startedAt: start.at,
        durationMs: Math.max(0, end.at - start.at),
        ...(end.detail ? { detail: summarize(end.detail) } : {}),
      } satisfies NamedStage;
    }
    return {
      id: spec.id,
      label: spec.label,
      status: failed ? "error" : "active",
      startedAt: start.at,
      durationMs: null,
    } satisfies NamedStage;
  });
}

function summarize(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}
