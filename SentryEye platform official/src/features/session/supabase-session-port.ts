// Supabase adapter that fulfills the SessionPort contract.
// The SessionRecorder never imports Supabase directly — makes tests trivial.

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { PersistedEvent, PersistedSession, SessionPort } from "./session-recorder";

export function createSupabaseSessionPort(userId: string): SessionPort {
  return {
    async createSession(input) {
      const { data, error } = await supabase
        .from("sessions")
        .insert({
          user_id: userId,
          provider: input.provider,
          engine_kind: input.engineKind,
          source: input.source,
          model_id: input.modelId,
          driver_label: input.driverLabel,
          driver_id: input.driverId ?? null,
          status: "running",
          device_info: input.deviceInfo as Json,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: data.id };
    },
    async insertEvents(sessionId, events: PersistedEvent[]) {
      if (!events.length) return;
      const rows = events.map((e) => ({
        session_id: sessionId,
        user_id: userId,
        t_ms: e.t_ms,
        class_id: e.class_id,
        class_label: e.class_label,
        semantic_tag: e.semantic_tag,
        confidence: e.confidence,
        bbox: (e.bbox ?? null) as Json,
        risk_level: e.risk_level,
      }));
      const { error } = await supabase.from("detection_events").insert(rows);
      if (error) throw error;
    },
    async updateSession(sessionId, patch: Partial<PersistedSession>) {
      const { pipeline, ...rest } = patch;
      const row = pipeline ? { ...rest, pipeline: pipeline as unknown as Json } : rest;
      const { error } = await supabase.from("sessions").update(row).eq("id", sessionId);
      if (error) throw error;
    },
    async endSession(sessionId, patch) {
      // pipeline is a jsonb column: the trace object goes across as-is.
      const { pipeline, ...rest } = patch;
      const row = pipeline ? { ...rest, pipeline: pipeline as unknown as Json } : rest;
      const { error } = await supabase.from("sessions").update(row).eq("id", sessionId);
      if (error) throw error;
    },
  };
}
