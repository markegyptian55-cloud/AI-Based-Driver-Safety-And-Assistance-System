// Cross-device calibration sync.
//
// A calibration profile is measured on one device but describes the DRIVER as
// much as the hardware (blink length, yawn length, confidence they read at).
// Syncing it to the account means a driver who calibrated on their phone gets
// sane thresholds the first time they open the laptop, instead of every blink
// being scored as a microsleep.
//
// Conflict rule: newest wins, by `createdAt`. Local storage stays the source
// of truth for the running pipeline, so sync failures never break a session.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  readCalibration,
  writeCalibration,
  type CalibrationProfile,
} from "@/features/session/calibration";

type SyncStatus = "idle" | "loading" | "synced" | "local-only" | "error";

function isProfile(v: unknown): v is CalibrationProfile {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as CalibrationProfile).eyeClosedMsThreshold === "number"
  );
}

export function useCalibrationSync() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [enabled, setEnabled] = useState(true);
  const [profile, setProfile] = useState<CalibrationProfile | null>(() => readCalibration());
  const [error, setError] = useState<string | null>(null);

  // Pull on sign-in: adopt the account profile when it is newer than local.
  useEffect(() => {
    if (!user) {
      setStatus("local-only");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    void (async () => {
      const { data, error: err } = await supabase
        .from("user_settings")
        .select("calibration_profile, calibration_sync_enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setStatus("error");
        return;
      }
      const syncOn = data?.calibration_sync_enabled ?? true;
      setEnabled(syncOn);
      const remote = isProfile(data?.calibration_profile)
        ? (data?.calibration_profile as CalibrationProfile)
        : null;
      const local = readCalibration();
      if (syncOn && remote && (!local || remote.createdAt > local.createdAt)) {
        writeCalibration(remote);
        setProfile(remote);
      } else {
        setProfile(local ?? remote);
      }
      setStatus("synced");
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  /** Pushes the local profile up so other devices pick it up. */
  const push = useCallback(
    async (next?: CalibrationProfile | null) => {
      const p = next ?? readCalibration();
      setProfile(p);
      if (!user || !enabled || !p) return false;
      const { error: err } = await supabase
        .from("user_settings")
        .update({
          calibration_profile: p as unknown as never,
          calibration_updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id);
      if (err) {
        setError(err.message);
        setStatus("error");
        return false;
      }
      setStatus("synced");
      return true;
    },
    [user, enabled],
  );

  /** Turns cross-device sync on or off for this account. */
  const setSyncEnabled = useCallback(
    async (value: boolean) => {
      setEnabled(value);
      if (!user) return;
      const { error: err } = await supabase
        .from("user_settings")
        .update({ calibration_sync_enabled: value })
        .eq("user_id", user.id);
      if (err) {
        setError(err.message);
        setStatus("error");
        return;
      }
      if (value) await push();
    },
    [user, push],
  );

  return { profile, status, enabled, error, push, setSyncEnabled, signedIn: Boolean(user) };
}
