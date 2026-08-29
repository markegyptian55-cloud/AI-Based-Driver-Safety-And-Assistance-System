// Fallback thresholds, resolved once for every consumer.
//
// Two scopes, deliberately: the account setting expresses what the driver
// considers unusable and follows them everywhere; the device override stays in
// this browser, because the phone that actually needs the escape hatch should
// not drag the desktop's bar down with it. The device value always wins.

import { useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_FALLBACK_PREFERENCE,
  clampPreference,
  readDeviceOverride,
  resolveFallbackThreshold,
  writeDeviceOverride,
  type FallbackDeviceOverride,
  type FallbackPreference,
} from "@/features/inference/auto-fallback";

export function useFallbackSettings() {
  const [account, setAccount] = useState<FallbackPreference>(DEFAULT_FALLBACK_PREFERENCE);
  const [device, setDevice] = useState<FallbackDeviceOverride>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setDevice(readDeviceOverride());

    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        // Visitors have no row; they simply keep the defaults plus whatever
        // this device says.
        if (!uid) return;
        const { data } = await supabase
          .from("user_settings")
          .select("fallback_enabled,fallback_min_fps,fallback_max_latency_ms")
          .eq("user_id", uid)
          .maybeSingle();
        if (cancelled || !data) return;
        setAccount(
          clampPreference({
            enabled: data.fallback_enabled ?? true,
            minFps: data.fallback_min_fps ?? DEFAULT_FALLBACK_PREFERENCE.minFps,
            maxLatencyMs:
              data.fallback_max_latency_ms ?? DEFAULT_FALLBACK_PREFERENCE.maxLatencyMs,
          }),
        );
      } catch {
        /* offline or signed out — defaults apply */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveAccount = useCallback(async (next: Partial<FallbackPreference>) => {
    const pref = clampPreference({ ...DEFAULT_FALLBACK_PREFERENCE, ...next });
    setAccount(pref);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;
      await supabase
        .from("user_settings")
        .update({
          fallback_enabled: pref.enabled,
          fallback_min_fps: pref.minFps,
          fallback_max_latency_ms: pref.maxLatencyMs,
        })
        .eq("user_id", uid);
    } catch {
      /* the in-memory value still drives this run */
    }
  }, []);

  const saveDevice = useCallback((next: FallbackDeviceOverride) => {
    const pref = next ? clampPreference(next) : null;
    setDevice(pref);
    writeDeviceOverride(pref);
  }, []);

  const threshold = useMemo(() => resolveFallbackThreshold(account, device), [account, device]);
  const effective = useMemo(() => clampPreference(device ?? account), [account, device]);

  return { account, device, effective, threshold, loading, saveAccount, saveDevice };
}
