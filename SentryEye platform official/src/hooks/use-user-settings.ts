import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export interface UserSettings {
  user_id: string;
  inference_provider: string;
  remote_api_url: string | null;
  drowsy_perclos_threshold: number;
  eye_closed_ms_threshold: number;
  yawn_rate_per_min_threshold: number;
  alarm_enabled: boolean;
  alarm_volume: number;
  browser_notifications_enabled: boolean;
  theme: string;
  /** Detection model the user last chose; reused on the next session. */
  selected_model_id: string | null;
}

const DEFAULTS: Omit<UserSettings, "user_id"> = {
  inference_provider: "browser-onnx",
  remote_api_url: null,
  drowsy_perclos_threshold: 0.4,
  eye_closed_ms_threshold: 400,
  yawn_rate_per_min_threshold: 3,
  alarm_enabled: true,
  alarm_volume: 0.7,
  browser_notifications_enabled: false,
  theme: "dark",
  selected_model_id: null,
};

export function useUserSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["user_settings", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<UserSettings> => {
      const { data, error } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as UserSettings;
      return { user_id: user!.id, ...DEFAULTS };
    },
  });

  const mutate = useMutation({
    mutationFn: async (patch: Partial<UserSettings>) => {
      if (!user) throw new Error("not signed in");
      const { error } = await supabase
        .from("user_settings")
        .upsert({ user_id: user.id, ...patch }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user_settings", user?.id] }),
  });

  return { settings: query.data, isLoading: query.isLoading, update: mutate.mutateAsync };
}

/** Extra client-only knobs not persisted in user_settings. */
export const CLIENT_DEFAULTS = {
  confThreshold: 0.35,
  iouThreshold: 0.5,
  perclosWindowMs: 10_000,
  eventCooldownMs: 2000,
  /** Continuous eye closure treated as a microsleep (driver briefly asleep). */
  microsleepMs: 500,
  /** Continuous eye closure treated as critical (continuous wake-up alarm). */
  criticalMicrosleepMs: 1500,
  /** Absolute floor on mouth height/width ratio; below this it is a smile. */
  yawnMinAspect: 0.38,
  /** Confidence floor for the mouth class — same bar as the eye classes. */
  yawnConfThreshold: 0.35,
  /** A mouth-open spell survives this long without a mouth box. */
  yawnGapMs: 500,
  /** Minimum yawn-shaped frames needed to confirm a yawn (low-FPS safety). */
  yawnConfirmFrames: 2,
  /** Mouth must stay open this long before a yawn spell is tracked. */
  yawnStartMs: 400,
  /** Held this long -> confirmed yawn. */
  yawnConfirmMs: 1200,
  /** Held this long -> long yawn (strong fatigue signal). */
  longYawnMs: 2500,
};
