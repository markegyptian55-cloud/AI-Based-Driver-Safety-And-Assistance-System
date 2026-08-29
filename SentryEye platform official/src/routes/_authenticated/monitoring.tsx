import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  Brain,
  Cpu,
  Database,
  HardDrive,
  MonitorSmartphone,
  RefreshCw,
  Clock,
  Package,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/error-boundary";
import { useAuth } from "@/hooks/use-auth";
import { useModelSelection } from "@/hooks/use-model-selection";
import { APP_CHANNEL, APP_NAME, APP_VERSION } from "@/lib/app-version";
import { formatBytes } from "@/features/drowsiness/labels";
import {
  probeDatabase,
  probeLastAnalysis,
  probeStorage,
  readBrowserCapabilities,
  readEngineStatus,
  type HealthState,
} from "@/features/system/system-status";

export const Route = createFileRoute("/_authenticated/monitoring")({
  head: () => ({
    meta: [
      { title: "System status — SentryEye" },
      {
        name: "description",
        content:
          "Live health of the SentryEye detection platform: AI engine, loaded model, ONNX runtime, cache, browser capability, database and storage.",
      },
    ],
  }),
  component: () => (
    <ErrorBoundary title="System status is unavailable">
      <SystemStatusPage />
    </ErrorBoundary>
  ),
});

const stateStyles: Record<HealthState, string> = {
  ok: "border-safe/40 bg-safe/10 text-safe",
  warn: "border-warning/40 bg-warning/10 text-warning",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  idle: "border-border bg-muted/40 text-muted-foreground",
  unknown: "border-border bg-muted/40 text-muted-foreground",
};

const stateLabel: Record<HealthState, string> = {
  ok: "Operational",
  warn: "Degraded",
  error: "Failing",
  idle: "Idle",
  unknown: "Unknown",
};

function StatusBadge({ state }: { state: HealthState }) {
  return (
    <Badge
      variant="outline"
      className={`font-mono text-[10px] uppercase tracking-wider ${stateStyles[state]}`}
    >
      {stateLabel[state]}
    </Badge>
  );
}

function StatusCard({
  icon: Icon,
  label,
  state,
  value,
  detail,
  loading,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  state: HealthState;
  value: string;
  detail?: string;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        </div>
        {loading ? <Skeleton className="h-5 w-20" /> : <StatusBadge state={state} />}
      </div>
      {loading ? (
        <Skeleton className="h-6 w-2/3" />
      ) : (
        <p className="break-words text-lg font-semibold leading-tight">{value}</p>
      )}
      {detail && !loading ? (
        <p className="break-words text-xs text-muted-foreground">{detail}</p>
      ) : null}
      {children}
    </Card>
  );
}

function SystemStatusPage() {
  const { user } = useAuth();
  const {
    selected: model,
    isLoading: modelLoading,
    error: modelError,
  } = useModelSelection();

  // Capabilities are browser-only; read after mount so SSR output stays stable.
  const [caps, setCaps] = useState<ReturnType<typeof readBrowserCapabilities> | null>(null);
  const [engine, setEngine] = useState<ReturnType<typeof readEngineStatus> | null>(null);

  useEffect(() => {
    setCaps(readBrowserCapabilities());
    const tick = () => setEngine(readEngineStatus());
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, []);

  const backend = useQuery({
    queryKey: ["system_status", user?.id],
    queryFn: async () => {
      const [database, storage, lastAnalysis] = await Promise.all([
        probeDatabase(),
        probeStorage(),
        probeLastAnalysis(user?.id),
      ]);
      return { database, storage, lastAnalysis };
    },
    refetchInterval: 30_000,
    retry: 1,
  });

  const capabilityState: HealthState = useMemo(() => {
    if (!caps) return "unknown";
    if (!caps.webassembly || !caps.webWorker) return "error";
    if (!caps.webgpu || !caps.simd) return "warn";
    return "ok";
  }, [caps]);

  const engineState: HealthState = engine?.warm ? "ok" : "idle";
  const modelState: HealthState = modelError ? "error" : model ? "ok" : "warn";

  const capabilityRows = caps
    ? [
        ["WebGPU", caps.webgpu],
        ["WebAssembly", caps.webassembly],
        ["WASM SIMD", caps.simd],
        ["SharedArrayBuffer", caps.sharedArrayBuffer],
        ["Web Worker", caps.webWorker],
        ["OffscreenCanvas", caps.offscreenCanvas],
        ["Camera API", caps.mediaDevices],
        ["Frame callback", caps.requestVideoFrameCallback],
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">System status</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Live health of the detection platform. Every value is measured on this device or read
            from your backend — nothing is simulated.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setCaps(readBrowserCapabilities());
            setEngine(readEngineStatus());
            void backend.refetch();
          }}
          disabled={backend.isFetching}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${backend.isFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {backend.isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatusCard
          icon={Activity}
          label="AI engine"
          state={engineState}
          value={engine?.warm ? (engine.inUse ? "Running" : "Warm — ready") : "Idle"}
          detail={
            engine?.warm
              ? `provider: ${engine.providerId ?? "—"} · backend: ${engine.engine ?? "—"}`
              : "Loads on the first analysis, then stays warm."
          }
        />

        <StatusCard
          icon={Brain}
          label="Loaded model"
          state={modelState}
          value={model ? `${model.modelName} ${model.version}` : modelError ? "Unavailable" : "None selected"}
          detail={
            modelError
              ? modelError.message
              : model
                ? `${model.framework} · ${model.numClasses} classes · ${model.imgsz}px · ${formatBytes(model.fileSizeBytes)}`
                : "Register or activate a model to run analyses."
          }
          loading={modelLoading}
        />

        <StatusCard
          icon={Cpu}
          label="ONNX runtime"
          state={caps ? (caps.webassembly ? "ok" : "error") : "unknown"}
          value={
            engine?.engine
              ? `Active — ${engine.engine}`
              : caps?.webgpu
                ? "Ready (WebGPU available)"
                : caps?.webassembly
                  ? "Ready (WASM)"
                  : "Unsupported"
          }
          detail="onnxruntime-web executes inside a dedicated Web Worker."
          loading={!caps}
        />

        <StatusCard
          icon={Package}
          label="Model cache"
          state={engine?.warm ? "ok" : "idle"}
          value={engine?.warm ? "Warm" : "Empty"}
          detail={
            engine?.warm
              ? `model ${engine.modelId?.slice(0, 8)} compiled once and retained${engine.inUse ? " (in use)" : ""}`
              : "The model is downloaded and compiled on the next analysis."
          }
        />

        <StatusCard
          icon={Database}
          label="Database"
          state={backend.data?.database.state ?? "unknown"}
          value={backend.data?.database.value ?? "—"}
          detail={backend.error ? "Health probe failed." : backend.data?.database.detail}
          loading={backend.isLoading}
        />

        <StatusCard
          icon={HardDrive}
          label="Storage"
          state={backend.data?.storage.state ?? "unknown"}
          value={backend.data?.storage.value ?? "—"}
          detail={backend.data?.storage.detail}
          loading={backend.isLoading}
        />

        <StatusCard
          icon={Clock}
          label="Last successful analysis"
          state={backend.data?.lastAnalysis.state ?? "unknown"}
          value={backend.data?.lastAnalysis.value ?? "—"}
          detail={backend.data?.lastAnalysis.detail}
          loading={backend.isLoading}
        >
          {backend.data?.lastAnalysis.sessionId ? (
            <Button asChild variant="outline" size="sm" className="mt-1 self-start">
              <Link
                to="/report/$sessionId"
                params={{ sessionId: backend.data.lastAnalysis.sessionId }}
              >
                View report
              </Link>
            </Button>
          ) : null}
        </StatusCard>

        <StatusCard
          icon={Package}
          label="Application version"
          state="ok"
          value={`${APP_NAME} v${APP_VERSION}`}
          detail={`channel: ${APP_CHANNEL}`}
        />
      </div>

      <Card className="p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <MonitorSmartphone className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Browser capability
          </h2>
          {caps ? <StatusBadge state={capabilityState} /> : null}
        </div>

        {!caps ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {capabilityRows.map(([label, supported]) => (
                <li
                  key={label as string}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
                >
                  <span className="truncate text-sm">{label as string}</span>
                  <span
                    className={`font-mono text-[10px] uppercase ${
                      supported ? "text-safe" : "text-muted-foreground"
                    }`}
                  >
                    {supported ? "yes" : "no"}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="font-mono uppercase">CPU threads</dt>
                <dd>{caps.hardwareConcurrency ?? "unreported"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-mono uppercase">Device memory</dt>
                <dd>{caps.deviceMemoryGb ? `${caps.deviceMemoryGb} GB` : "unreported"}</dd>
              </div>
              <div className="flex min-w-0 gap-2 sm:col-span-2">
                <dt className="font-mono uppercase">User agent</dt>
                <dd className="min-w-0 break-all">{caps.userAgent}</dd>
              </div>
            </dl>
          </>
        )}
      </Card>
    </div>
  );
}
