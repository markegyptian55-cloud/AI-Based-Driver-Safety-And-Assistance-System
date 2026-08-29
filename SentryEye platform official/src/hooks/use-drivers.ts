import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDriver,
  deleteDriver,
  driverDisplayLabel,
  fetchDrivers,
  type Driver,
} from "@/features/drivers/drivers-data";
import { useAuth } from "@/hooks/use-auth";

const STORAGE_KEY = "sentryeye.active-driver";

/**
 * Roster + currently selected driver. Signed-in users get a persisted roster;
 * visitors keep a local-only label so their report still names a driver.
 */
export function useDrivers() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setActiveId(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const selectDriver = useCallback((id: string | null) => {
    setActiveId(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ["drivers", user?.id ?? "guest"],
    queryFn: fetchDrivers,
    enabled: !!user,
  });

  const add = useMutation({
    mutationFn: (input: { fullName: string; driverCode: string; notes?: string | null }) =>
      createDriver({ userId: user!.id, ...input }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ["drivers"] });
      selectDriver(d.id);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteDriver(id),
    onSuccess: (_r, id) => {
      void qc.invalidateQueries({ queryKey: ["drivers"] });
      if (activeId === id) selectDriver(null);
    },
  });

  const active: Driver | null = useMemo(
    () => drivers.find((d) => d.id === activeId) ?? null,
    [drivers, activeId],
  );

  const fallbackLabel = user
    ? ((user.user_metadata?.["display_name"] as string | undefined) ??
      user.email ??
      `Driver-${user.id.slice(0, 8)}`)
    : "Visitor";

  return {
    drivers,
    isLoading,
    active,
    activeId,
    selectDriver,
    add,
    remove,
    signedIn: !!user,
    driverLabel: active ? driverDisplayLabel(active) : fallbackLabel,
    driverId: active?.id ?? null,
  };
}
