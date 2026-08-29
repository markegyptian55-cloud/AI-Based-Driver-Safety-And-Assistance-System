// Benchmark history.
//
// A single sweep tells you what is fastest today. Regressions only show up
// when you can compare today's ranking to last month's on the *same* device,
// so every run is stored with the device fingerprint that produced it — a
// ranking without the hardware behind it is not comparable to anything.

import { supabase } from "@/integrations/supabase/client";
import type { BenchResult } from "@/features/inference/benchmark";

export interface BenchDeviceStats {
  userAgent: string;
  platform: string;
  cores: number | null;
  memoryGb: number | null;
  screen: string;
  dpr: number;
  /** Actual camera frame size used for the sweep, when known. */
  frameSize: string | null;
  constrained: boolean;
  engine: string | null;
}

export interface BenchmarkRun {
  id: string;
  createdAt: string;
  frameSource: string;
  frameCount: number;
  device: BenchDeviceStats;
  results: BenchResult[];
  bestModelId: string | null;
  bestModelLabel: string | null;
  bestFps: number | null;
  bestLatencyP95Ms: number | null;
}

export function collectDeviceStats(extra: Partial<BenchDeviceStats> = {}): BenchDeviceStats {
  const nav = typeof navigator === "undefined" ? null : navigator;
  return {
    userAgent: nav?.userAgent ?? "unknown",
    platform: nav?.platform ?? "unknown",
    cores: nav?.hardwareConcurrency ?? null,
    memoryGb: (nav as unknown as { deviceMemory?: number })?.deviceMemory ?? null,
    screen:
      typeof window === "undefined"
        ? "unknown"
        : `${window.screen.width}×${window.screen.height}`,
    dpr: typeof window === "undefined" ? 1 : window.devicePixelRatio,
    frameSize: null,
    constrained: false,
    engine: null,
    ...extra,
  };
}

export async function saveBenchmarkRun(input: {
  frameSource: string;
  frameCount: number;
  device: BenchDeviceStats;
  results: BenchResult[];
}): Promise<BenchmarkRun | null> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  // Visitors keep the on-screen ranking; only signed-in drivers get history.
  if (!uid) return null;
  const best = input.results.find((r) => r.ok) ?? null;
  const { data, error } = await supabase
    .from("benchmark_runs")
    .insert({
      user_id: uid,
      frame_source: input.frameSource,
      frame_count: input.frameCount,
      device: JSON.parse(JSON.stringify(input.device)),
      results: JSON.parse(JSON.stringify(input.results)),
      best_model_id: best?.id ?? null,
      best_model_label: best?.label ?? null,
      best_fps: best?.fps ?? null,
      best_latency_p95_ms: best?.latencyP95 ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function listBenchmarkRuns(limit = 20): Promise<BenchmarkRun[]> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.id) return [];
  const { data, error } = await supabase
    .from("benchmark_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

export async function deleteBenchmarkRun(id: string): Promise<void> {
  const { error } = await supabase.from("benchmark_runs").delete().eq("id", id);
  if (error) throw error;
}

/** Speed change for one model between two runs, as a percentage of the older. */
export function fpsDelta(current: number | null, previous: number | null): number | null {
  if (!current || !previous) return null;
  return ((current - previous) / previous) * 100;
}

function mapRow(row: Record<string, unknown>): BenchmarkRun {
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    frameSource: String(row.frame_source ?? "camera"),
    frameCount: Number(row.frame_count ?? 0),
    device: (row.device ?? {}) as BenchDeviceStats,
    results: (row.results ?? []) as BenchResult[],
    bestModelId: (row.best_model_id as string | null) ?? null,
    bestModelLabel: (row.best_model_label as string | null) ?? null,
    bestFps: (row.best_fps as number | null) ?? null,
    bestLatencyP95Ms: (row.best_latency_p95_ms as number | null) ?? null,
  };
}
