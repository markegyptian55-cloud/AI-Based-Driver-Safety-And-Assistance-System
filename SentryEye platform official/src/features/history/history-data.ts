// Session History data access. Everything (search, filters, sorting,
// pagination) is resolved server-side so the page never loads the full
// session table into memory.

import { supabase } from "@/integrations/supabase/client";
import type { FatigueLevel } from "../drowsiness/safety-score";
import { parseTrace, type SessionPipelineTrace } from "../session/pipeline-trace";

export interface HistorySession {
  id: string;
  driverLabel: string;
  driverId: string;
  startedAt: string;
  analysisType: string;
  modelId: string | null;
  modelLabel: string;
  durationSec: number;
  processingTimeMs: number;
  safetyScore: number;
  fatigueLevel: FatigueLevel;
  totalAlerts: number;
  status: string;
  /** Per-stage timings, conversion route and model cache status for this run. */
  pipeline: SessionPipelineTrace | null;
}

export type HistorySortKey =
  | "date"
  | "safety_score"
  | "fatigue_level"
  | "processing_time"
  | "duration";

export interface HistoryQuery {
  search: string;
  driver: string; // "all" | driver_label
  model: string; // "all" | model id | "none"
  analysisType: string; // "all" | source
  fatigue: string; // "all" | FatigueLevel
  from: string | null; // yyyy-mm-dd
  to: string | null;
  sortKey: HistorySortKey;
  sortDir: "asc" | "desc";
  page: number; // 1-based
  pageSize: number;
}

export const DEFAULT_HISTORY_QUERY: HistoryQuery = {
  search: "",
  driver: "all",
  model: "all",
  analysisType: "all",
  fatigue: "all",
  from: null,
  to: null,
  sortKey: "date",
  sortDir: "desc",
  page: 1,
  pageSize: 10,
};

const SELECT =
  "id,user_id,driver_label,source,status,started_at,duration_sec,processing_time_ms," +
  "safety_score,fatigue_level,total_alerts,model_id,pipeline,model_registry(name,version)";

// Sorting maps to persisted columns. `fatigue_level` is stored as text, so it
// is ordered through its inverse driver (safety score) to keep the ranking
// low → medium → high → critical meaningful instead of alphabetical.
const SORT_COLUMN: Record<HistorySortKey, { column: string; invert?: boolean }> = {
  date: { column: "started_at" },
  safety_score: { column: "safety_score" },
  fatigue_level: { column: "safety_score", invert: true },
  processing_time: { column: "processing_time_ms" },
  duration: { column: "duration_sec" },
};

function mapRow(row: Record<string, unknown>): HistorySession {
  const num = (k: string) => Number(row[k] ?? 0) || 0;
  const model = (row["model_registry"] ?? null) as { name?: string; version?: string } | null;
  return {
    id: String(row["id"]),
    driverLabel: (row["driver_label"] as string | null) ?? "Driver",
    driverId: String(row["user_id"] ?? ""),
    startedAt: String(row["started_at"]),
    analysisType: (row["source"] as string | null) ?? "unknown",
    modelId: (row["model_id"] as string | null) ?? null,
    modelLabel: model?.name ? `${model.name} ${model.version ?? ""}`.trim() : "Unknown model",
    durationSec: num("duration_sec"),
    processingTimeMs: num("processing_time_ms"),
    safetyScore: num("safety_score"),
    fatigueLevel: ((row["fatigue_level"] as FatigueLevel | null) ?? "low") as FatigueLevel,
    totalAlerts: num("total_alerts"),
    status: (row["status"] as string | null) ?? "completed",
    pipeline: parseTrace(row["pipeline"]),
  };
}

const UUID_FRAGMENT = /^[0-9a-f-]{2,36}$/i;

/**
 * PostgREST parses filter strings, so any character that carries syntactic
 * meaning in a `.or()` clause (comma, parentheses, quotes, wildcards) is
 * stripped before the term is interpolated into a filter.
 */
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()"'%*\\]/g, "").slice(0, 100);
}


/**
 * Session ids are uuids and PostgREST cannot pattern-match them directly, so a
 * uuid-looking search term is resolved through a lightweight id-only lookup and
 * applied as an `in` filter on the paged query.
 */
async function resolveIdMatches(term: string): Promise<string[] | null> {
  if (!UUID_FRAGMENT.test(term)) return null;
  const { data, error } = await supabase
    .from("sessions")
    .select("id")
    .eq("status", "completed")
    .limit(1000);
  if (error) throw error;
  const needle = term.toLowerCase();
  return (data ?? []).map((r) => String(r.id)).filter((id) => id.toLowerCase().includes(needle));
}

export interface HistoryPage {
  rows: HistorySession[];
  total: number;
}

export async function fetchHistoryPage(q: HistoryQuery): Promise<HistoryPage> {
  const term = sanitizeSearchTerm(q.search.trim());
  let idMatches: string[] | null = null;
  if (term) idMatches = await resolveIdMatches(term);

  let query = supabase
    .from("sessions")
    .select(SELECT, { count: "exact" })
    .eq("status", "completed");

  if (term) {
    if (idMatches && idMatches.length) {
      // idMatches are uuids read back from the database, so they are safe to
      // join; `term` is sanitized above.
      query = query.or(`driver_label.ilike.%${term}%,id.in.(${idMatches.join(",")})`);
    } else {
      query = query.ilike("driver_label", `%${term}%`);
    }
  }
  if (q.driver !== "all") query = query.eq("driver_label", q.driver);
  if (q.model !== "all") {
    if (q.model === "none") query = query.is("model_id", null);
    else query = query.eq("model_id", q.model);
  }
  if (q.analysisType !== "all") query = query.eq("source", q.analysisType);
  if (q.fatigue !== "all") query = query.eq("fatigue_level", q.fatigue);
  if (q.from) query = query.gte("started_at", new Date(`${q.from}T00:00:00`).toISOString());
  if (q.to) query = query.lte("started_at", new Date(`${q.to}T23:59:59.999`).toISOString());

  const sort = SORT_COLUMN[q.sortKey];
  const ascending = sort.invert ? q.sortDir === "desc" : q.sortDir === "asc";
  query = query.order(sort.column, { ascending, nullsFirst: false });

  const fromIdx = (q.page - 1) * q.pageSize;
  query = query.range(fromIdx, fromIdx + q.pageSize - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    rows: (data ?? []).map((r) => mapRow(r as unknown as Record<string, unknown>)),
    total: count ?? 0,
  };
}

export interface HistoryFilterOptions {
  drivers: string[];
  models: { id: string; label: string }[];
  analysisTypes: string[];
}

/** Distinct filter values, loaded once from a slim projection. */
export async function fetchHistoryFilterOptions(): Promise<HistoryFilterOptions> {
  const { data, error } = await supabase
    .from("sessions")
    .select("driver_label,source,model_id,model_registry(name,version)")
    .eq("status", "completed")
    .limit(1000);
  if (error) throw error;

  const drivers = new Set<string>();
  const types = new Set<string>();
  const models = new Map<string, string>();
  for (const raw of data ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    drivers.add((row["driver_label"] as string | null) ?? "Driver");
    types.add((row["source"] as string | null) ?? "unknown");
    const model = (row["model_registry"] ?? null) as { name?: string; version?: string } | null;
    models.set(
      (row["model_id"] as string | null) ?? "none",
      model?.name ? `${model.name} ${model.version ?? ""}`.trim() : "Unknown model",
    );
  }
  return {
    drivers: [...drivers].sort(),
    analysisTypes: [...types].sort(),
    models: [...models.entries()].map(([id, label]) => ({ id, label })),
  };
}

/** Deletes exactly one session; detection events cascade at the database. */
export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await supabase.from("sessions").delete().eq("id", sessionId);
  if (error) throw error;
}
