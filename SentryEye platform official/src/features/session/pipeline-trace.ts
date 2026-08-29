// Per-session performance trace: where the wall-clock time actually went.
//
// Two questions cost the most time to answer after the fact: "why did this run
// take so long before any box appeared?" and "did it download the model again?".
// Both are answered by numbers that only exist while the run is happening, so
// they are captured live and stored with the session row.
//
// This module is deliberately framework-free and defensive when reading: a
// trace persisted by an older build must never break the History page.

export type ConversionPath = "native" | "remux" | "webcodecs" | "ffmpeg" | "none";

export const CONVERSION_PATH_LABEL: Record<ConversionPath, string> = {
  native: "Native playback",
  remux: "Container remux",
  webcodecs: "WebCodecs",
  ffmpeg: "ffmpeg fallback",
  none: "No conversion",
};

/** Why the path matters, in one line, for the history detail panel. */
export const CONVERSION_PATH_NOTE: Record<ConversionPath, string> = {
  native: "The browser decoded the file as-is — no conversion cost.",
  remux: "Only the container was rewritten (stream copy), frames untouched.",
  webcodecs: "Hardware decode through WebCodecs.",
  ffmpeg: "Full software re-encode — the slowest path, used as a last resort.",
  none: "Live camera capture: nothing to convert.",
};

export type ModelCacheState = "hit" | "miss" | "unknown";

export interface StageTiming {
  id: string;
  label: string;
  status: string;
  durationMs: number | null;
}

export interface ModelLoadTrace {
  modelId: string | null;
  modelName: string | null;
  /** Did the weights come out of the local store, or off the network? */
  cache: ModelCacheState;
  /** Size of the weights actually used, when known. */
  bytes: number | null;
  /** Time spent obtaining the weights (cache read or download). */
  fetchMs: number | null;
  /** Time spent building the inference session from those weights. */
  sessionMs: number | null;
  /** Kernel/shader compilation measured on synthetic frames. */
  warmupMs: number | null;
  /** Wall time from "model requested" to "ready for real frames". */
  totalMs: number | null;
  engine: string | null;
}

export interface SessionPipelineTrace {
  version: 1;
  source: string;
  conversionPath: ConversionPath;
  /** Measured cost of the conversion stage (0 for the native path). */
  conversionMs: number | null;
  stages: StageTiming[];
  model: ModelLoadTrace | null;
  capturedAt: string;
}

export function emptyModelTrace(): ModelLoadTrace {
  return {
    modelId: null,
    modelName: null,
    cache: "unknown",
    bytes: null,
    fetchMs: null,
    sessionMs: null,
    warmupMs: null,
    totalMs: null,
    engine: null,
  };
}

export function makeTrace(input: {
  source: string;
  conversionPath: ConversionPath;
  conversionMs?: number | null;
  stages?: StageTiming[];
  model?: ModelLoadTrace | null;
}): SessionPipelineTrace {
  return {
    version: 1,
    source: input.source,
    conversionPath: input.conversionPath,
    conversionMs: input.conversionMs ?? null,
    stages: input.stages ?? [],
    model: input.model ?? null,
    capturedAt: new Date().toISOString(),
  };
}

/** Sum of the measured stages — the "time before/around inference" figure. */
export function totalStageMs(trace: SessionPipelineTrace): number {
  return trace.stages.reduce((acc, s) => acc + (s.durationMs ?? 0), 0);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

const PATHS: ConversionPath[] = ["native", "remux", "webcodecs", "ffmpeg", "none"];

/** Tolerant reader for the jsonb column. Returns null when there is no trace. */
export function parseTrace(value: unknown): SessionPipelineTrace | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw["version"] !== 1) return null;
  const path = str(raw["conversionPath"]) as ConversionPath | null;
  const rawStages = Array.isArray(raw["stages"]) ? raw["stages"] : [];
  const stages: StageTiming[] = rawStages.flatMap((s) => {
    if (!s || typeof s !== "object") return [];
    const r = s as Record<string, unknown>;
    const id = str(r["id"]);
    if (!id) return [];
    return [
      {
        id,
        label: str(r["label"]) ?? id,
        status: str(r["status"]) ?? "done",
        durationMs: num(r["durationMs"]),
      },
    ];
  });

  let model: ModelLoadTrace | null = null;
  const rawModel = raw["model"];
  if (rawModel && typeof rawModel === "object") {
    const m = rawModel as Record<string, unknown>;
    const cache = str(m["cache"]);
    model = {
      modelId: str(m["modelId"]),
      modelName: str(m["modelName"]),
      cache: cache === "hit" || cache === "miss" ? cache : "unknown",
      bytes: num(m["bytes"]),
      fetchMs: num(m["fetchMs"]),
      sessionMs: num(m["sessionMs"]),
      warmupMs: num(m["warmupMs"]),
      totalMs: num(m["totalMs"]),
      engine: str(m["engine"]),
    };
  }

  return {
    version: 1,
    source: str(raw["source"]) ?? "unknown",
    conversionPath: path && PATHS.includes(path) ? path : "none",
    conversionMs: num(raw["conversionMs"]),
    stages,
    model,
    capturedAt: str(raw["capturedAt"]) ?? "",
  };
}
