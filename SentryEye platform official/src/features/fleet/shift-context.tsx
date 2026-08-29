// Owns the driver's shift lifecycle for the whole app session.
//
// The inference engine is untouched: this context only observes the semantic
// events it already emits, persists the meaningful ones, and finalises the
// shift. Everything is written locally first, so the lifecycle works offline.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { SemanticEvent } from "../drowsiness/types";
import { mapSemanticEvent } from "./event-mapping";
import {
  activeLocalShift,
  appendEvents,
  getShift,
  pendingShifts,
  prune,
  putShift,
} from "./offline-queue";
import { buildLocalReport } from "./shift-report";
import { loadIdentity, syncPending, syncShift, type FleetIdentity } from "./shift-sync";
import type { LocalShift, SafetyEventInput, ShiftReport } from "./types";

interface StartInput {
  modelId?: string | null;
  modelName?: string | null;
  modelVersion?: string | null;
  modelImgsz?: number | null;
  executionProvider?: string | null;
  precision?: string | null;
}

interface ShiftContextValue {
  identity: FleetIdentity | null;
  identityLoading: boolean;
  isManager: boolean;
  shift: LocalShift | null;
  active: boolean;
  starting: boolean;
  ending: boolean;
  error: string | null;
  /** Seconds the AI has actually been monitoring during this shift. */
  monitoredSeconds: number;
  pendingCount: number;
  online: boolean;
  lastReport: ShiftReport | null;
  startShift: (input?: StartInput) => Promise<void>;
  endShift: (opts?: { longestClosureMs?: number }) => Promise<ShiftReport | null>;
  /** Called ~1 Hz by a running detection session. */
  heartbeat: (deltaSeconds: number) => void;
  /** Feed semantic events from any detection surface into the active shift. */
  recordSemanticEvents: (events: SemanticEvent[]) => void;
  recordEvent: (event: SafetyEventInput) => void;
  clearLastReport: () => void;
  retrySync: () => Promise<void>;
}

const Ctx = createContext<ShiftContextValue | null>(null);

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ShiftProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<FleetIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);
  const [shift, setShift] = useState<LocalShift | null>(null);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monitoredSeconds, setMonitoredSeconds] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [online, setOnline] = useState(true);
  const [lastReport, setLastReport] = useState<ShiftReport | null>(null);

  const shiftRef = useRef<LocalShift | null>(null);
  const monitoredRef = useRef(0);
  const seenEventIds = useRef<Set<string>>(new Set());

  shiftRef.current = shift;

  const refreshPending = useCallback(async () => {
    setPendingCount((await pendingShifts()).length);
  }, []);

  // Identity + recovery of an interrupted shift.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await loadIdentity().catch(() => null);
      if (cancelled) return;
      setIdentity(id);
      setIdentityLoading(false);
      const local = await activeLocalShift();
      if (!cancelled && local) {
        setShift(local);
        monitoredRef.current = local.monitoredSeconds;
        setMonitoredSeconds(local.monitoredSeconds);
        for (const e of local.events) seenEventIds.current.add(e.clientEventId);
      }
      await refreshPending();
      void prune();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshPending]);

  // Background sync. Shifts recorded with no connection stay in IndexedDB and
  // upload by themselves: as soon as the browser reports connectivity, when the
  // tab comes back to the foreground, and on a backoff timer while anything is
  // still queued (a "back online" event does not guarantee a reachable server).
  useEffect(() => {
    if (typeof window === "undefined") return;
    setOnline(navigator.onLine !== false);

    let disposed = false;
    let running = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (ms: number) => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void drain("timer"), ms);
    };

    const drain = async (reason: "online" | "focus" | "timer" | "boot") => {
      if (disposed || running) return;
      if (reason === "online") setOnline(true);
      if (navigator.onLine === false) {
        setOnline(false);
        return;
      }
      running = true;
      try {
        const rows = await pendingShifts();
        const queued = rows.filter((r) => r.status === "completed");
        if (queued.length) await syncPending(queued);
        await refreshPending();
        const left = (await pendingShifts()).filter((r) => r.status === "completed");
        if (left.length) {
          // Exponential backoff, capped at five minutes, so a flaky link does
          // not hammer the network or the battery.
          attempt = Math.min(attempt + 1, 6);
          schedule(Math.min(15_000 * 2 ** (attempt - 1), 300_000));
        } else {
          attempt = 0;
          if (timer) clearTimeout(timer);
        }
      } finally {
        running = false;
      }
    };

    const onOnline = () => void drain("online");
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") void drain("focus");
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    void drain("boot");

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshPending]);

  // Closing the tab is also "leaving the shift". The shift is finalised
  // locally (report included) and queued; the drainer uploads it on the next
  // load or as soon as the device is online again.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLeave = () => {
      const current = shiftRef.current;
      if (!current || current.status !== "active") return;
      const completed: LocalShift = {
        ...current,
        status: "completed",
        endedAt: new Date().toISOString(),
        monitoredSeconds: Math.round(monitoredRef.current),
        sync: "pending_sync",
      };
      const report = buildLocalReport(completed, { driverName: identity?.driverName });
      void putShift({ ...completed, report });
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [identity]);


  const startShift = useCallback(
    async (input?: StartInput) => {
      if (shiftRef.current?.status === "active") return;
      if (!identity) {
        setError("Sign in to start a shift.");
        return;
      }
      setStarting(true);
      setError(null);
      seenEventIds.current = new Set();
      monitoredRef.current = 0;
      setMonitoredSeconds(0);
      setLastReport(null);

      const next: LocalShift = {
        clientShiftId: uuid(),
        remoteId: null,
        organizationId: identity.organizationId,
        driverId: identity.driverId,
        userId: identity.userId,
        status: "active",
        startedAt: new Date().toISOString(),
        endedAt: null,
        monitoredSeconds: 0,
        modelId: input?.modelId ?? null,
        modelName: input?.modelName ?? null,
        modelVersion: input?.modelVersion ?? null,
        modelImgsz: input?.modelImgsz ?? null,
        executionProvider: input?.executionProvider ?? null,
        precision: input?.precision ?? null,
        deviceInfo: {
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        },
        sync: "local",
        events: [],
        report: null,
      };

      await putShift(next);
      setShift(next);

      try {
        const remoteId = await (await import("./shift-sync")).pushShift(next);
        if (remoteId) {
          const withRemote = { ...next, remoteId, sync: "synced" as const };
          await putShift(withRemote);
          setShift(withRemote);
        }
      } catch (e) {
        // Offline or refused: the shift lives locally and syncs on End Shift.
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("idx_one_active_shift_per_driver")) {
          setError("You already have an active shift on another device.");
        }
        await putShift({ ...next, sync: "pending_sync" });
        setShift({ ...next, sync: "pending_sync" });
      } finally {
        setStarting(false);
        void refreshPending();
      }
    },
    [identity, refreshPending],
  );

  const heartbeat = useCallback((deltaSeconds: number) => {
    if (!shiftRef.current || shiftRef.current.status !== "active") return;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    monitoredRef.current += deltaSeconds;
    setMonitoredSeconds(Math.round(monitoredRef.current));
  }, []);

  const recordEvent = useCallback((event: SafetyEventInput) => {
    const current = shiftRef.current;
    if (!current || current.status !== "active") return;
    if (seenEventIds.current.has(event.clientEventId)) return;
    seenEventIds.current.add(event.clientEventId);
    const next = { ...current, events: current.events.concat(event) };
    shiftRef.current = next;
    setShift(next);
    void appendEvents(current.clientShiftId, [event]);
  }, []);

  const recordSemanticEvents = useCallback(
    (events: SemanticEvent[]) => {
      const current = shiftRef.current;
      if (!current || current.status !== "active") return;
      for (const e of events) {
        const mapped = mapSemanticEvent(e, current.modelVersion);
        if (mapped) recordEvent(mapped);
      }
    },
    [recordEvent],
  );

  const endShift = useCallback(
    async (opts?: { longestClosureMs?: number }) => {
      const current = shiftRef.current;
      if (!current || current.status !== "active") return null;
      setEnding(true);
      setError(null);
      try {
        const completed: LocalShift = {
          ...current,
          status: "completed",
          endedAt: new Date().toISOString(),
          monitoredSeconds: Math.round(monitoredRef.current),
          sync: current.sync === "synced" ? "pending_sync" : "pending_sync",
        };
        const localReport = buildLocalReport(completed, {
          longestClosureMs: opts?.longestClosureMs ?? 0,
          driverName: identity?.driverName,
        });
        const withReport = { ...completed, report: localReport };
        await putShift(withReport);
        setShift(null);
        shiftRef.current = null;
        setLastReport(localReport);

        const synced = await syncShift(withReport);
        const stored = await getShift(withReport.clientShiftId);
        const finalReport = synced ?? localReport;
        setLastReport({ ...finalReport, sync: stored?.sync ?? "pending_sync" });
        await refreshPending();
        return finalReport;
      } finally {
        setEnding(false);
        monitoredRef.current = 0;
        setMonitoredSeconds(0);
      }
    },
    [identity, refreshPending],
  );

  const retrySync = useCallback(async () => {
    const rows = await pendingShifts();
    await syncPending(rows.filter((r) => r.status === "completed"));
    await refreshPending();
  }, [refreshPending]);

  const value = useMemo<ShiftContextValue>(
    () => ({
      identity,
      identityLoading,
      isManager: identity?.role === "manager" || identity?.role === "admin",
      shift,
      active: shift?.status === "active",
      starting,
      ending,
      error,
      monitoredSeconds,
      pendingCount,
      online,
      lastReport,
      startShift,
      endShift,
      heartbeat,
      recordSemanticEvents,
      recordEvent,
      clearLastReport: () => setLastReport(null),
      retrySync,
    }),
    [
      identity,
      identityLoading,
      shift,
      starting,
      ending,
      error,
      monitoredSeconds,
      pendingCount,
      online,
      lastReport,
      startShift,
      endShift,
      heartbeat,
      recordSemanticEvents,
      recordEvent,
      retrySync,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShift(): ShiftContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useShift must be used inside <ShiftProvider>");
  return ctx;
}

/**
 * Binds a running detection surface to the active shift: forwards new semantic
 * events and keeps the monitored-time counter honest. No-op when no shift is
 * running, which is what keeps visitor mode working unchanged.
 */
export function useShiftMonitor(recentEvents: SemanticEvent[], running: boolean) {
  const { active, heartbeat, recordSemanticEvents } = useShift();

  useEffect(() => {
    if (!active || !running) return;
    const id = window.setInterval(() => heartbeat(1), 1000);
    return () => window.clearInterval(id);
  }, [active, running, heartbeat]);

  useEffect(() => {
    if (!active || !recentEvents.length) return;
    recordSemanticEvents(recentEvents);
  }, [active, recentEvents, recordSemanticEvents]);
}
