// Pre-start diagnostics for Live.
//
// Android failures are almost always one of four things: camera permission,
// the worker not booting, no usable GPU adapter, or a model preparing on an
// engine the device can't sustain. This card answers all four before the
// driver taps Start, and — when preparation times out — names the exact stage
// that hung and how long it was given.

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Cpu, HelpCircle, Loader2, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { useModelContext } from "@/features/inference/model-context";
import { describeEngine } from "@/features/inference/engine-preference";
import { PREPARE_TIMEOUT_MS } from "@/features/inference/model-context";

type Status = "ok" | "warn" | "fail" | "pending";

function StatusDot({ status }: { status: Status }) {
  if (status === "pending")
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />;
  if (status === "ok") return <Check className="h-3.5 w-3.5 shrink-0 text-safe" aria-hidden="true" />;
  if (status === "warn")
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />;
  return <X className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />;
}

function Row({ label, status, value }: { label: string; status: Status; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1.5">
      <span className="min-w-0 truncate text-xs text-muted-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-foreground">
        <StatusDot status={status} />
        {value}
      </span>
    </div>
  );
}

export function DiagnosticsCard({ engine }: { engine?: string | null }) {
  const { warmup, enginePreference, engineAttempts } = useModelContext();
  const [permission, setPermission] = useState<Status>("pending");
  const [permissionText, setPermissionText] = useState("checking");
  const [gpu, setGpu] = useState<Status>("pending");
  const [gpuText, setGpuText] = useState("probing");
  const [worker, setWorker] = useState<Status>("pending");
  const [ledgerOpen, setLedgerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Camera permission. Not every browser implements the Permissions API for
    // "camera"; there we simply say it is asked for at start.
    const nav = navigator as Navigator & {
      permissions?: { query: (d: { name: string }) => Promise<PermissionStatus> };
    };
    if (nav.permissions?.query) {
      nav.permissions
        .query({ name: "camera" })
        .then((res) => {
          if (cancelled) return;
          const apply = () => {
            setPermission(
              res.state === "granted" ? "ok" : res.state === "denied" ? "fail" : "warn",
            );
            setPermissionText(res.state);
          };
          apply();
          res.addEventListener?.("change", apply);
        })
        .catch(() => {
          if (cancelled) return;
          setPermission("warn");
          setPermissionText("asked at start");
        });
    } else {
      setPermission("warn");
      setPermissionText("asked at start");
    }

    // Worker boot: a throwaway worker proves the environment allows them at all.
    try {
      const blob = new Blob(["self.postMessage('ok')"], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      const timer = setTimeout(() => {
        if (!cancelled) setWorker("fail");
        w.terminate();
        URL.revokeObjectURL(url);
      }, 3000);
      w.onmessage = () => {
        clearTimeout(timer);
        if (!cancelled) setWorker("ok");
        w.terminate();
        URL.revokeObjectURL(url);
      };
      w.onerror = () => {
        clearTimeout(timer);
        if (!cancelled) setWorker("fail");
        w.terminate();
        URL.revokeObjectURL(url);
      };
    } catch {
      if (!cancelled) setWorker("fail");
    }

    // GPU adapter, bounded: an Android driver that never answers must not leave
    // this row spinning forever.
    const anyNav = navigator as Navigator & {
      gpu?: { requestAdapter: () => Promise<unknown> };
    };
    if (!anyNav.gpu) {
      setGpu("warn");
      setGpuText("no WebGPU — CPU");
    } else {
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
      void Promise.race([anyNav.gpu.requestAdapter().catch(() => null), timeout]).then(
        (adapter) => {
          if (cancelled) return;
          setGpu(adapter ? "ok" : "warn");
          setGpuText(adapter ? "adapter ready" : "unavailable — CPU");
        },
      );
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const engineStatus: Status =
    warmup.status === "ready" ? "ok" : warmup.status === "error" ? "fail" : "pending";
  const engineText =
    warmup.status === "ready"
      ? describeEngine(engine ?? (enginePreference === "wasm" ? "wasm" : "auto"))
      : warmup.status === "error"
        ? (warmup.stage ?? "failed")
        : (warmup.stage?.replace(/-/g, " ") ?? "preparing");

  return (
    <Card className="border-border/60 bg-card/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Cpu className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Device diagnostics</h3>
      </div>
      <div className="divide-y divide-border/50">
        <Row label="Camera permission" status={permission} value={permissionText} />
        <Row label="Worker boot" status={worker} value={worker === "ok" ? "running" : worker === "fail" ? "blocked" : "booting"} />
        <Row label="GPU / WebGPU" status={gpu} value={gpuText} />
        {engineAttempts.length ? (
          <div className="py-1.5">
            <button
              type="button"
              onClick={() => setLedgerOpen((o) => !o)}
              aria-expanded={ledgerOpen}
              className="flex w-full items-center justify-between gap-2 text-left text-xs text-muted-foreground hover:text-foreground"
            >
              <span className="min-w-0 truncate">
                Engine selection ({engineAttempts.length} attempt
                {engineAttempts.length === 1 ? "" : "s"})
              </span>
              <span className="shrink-0 font-mono text-[11px]">
                {ledgerOpen ? "hide" : "show"}
              </span>
            </button>
            {ledgerOpen ? (
              <ul className="mt-2 space-y-2">
                {engineAttempts.map((a, i) => (
                  <li
                    key={`${a.engine}-${i}`}
                    className="rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed"
                  >
                    <span className="font-mono font-medium">{a.engine}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      | {a.stage === "ready" ? "selected" : `stopped at ${a.stage}`}
                      {a.cause ? ` | ${a.cause}` : ""}
                      {typeof a.ms === "number" ? ` | ${a.ms}ms` : ""}
                    </span>
                    {a.error ? (
                      <span className="mt-1 block break-words font-mono text-destructive">
                        {a.error}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <Row label="Model engine" status={engineStatus} value={engineText} />
      </div>
      {warmup.status === "error" ? (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-[11px] text-destructive" role="alert">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Stage <span className="font-mono">{warmup.stage ?? "unknown"}</span> failed within the{" "}
            {Math.round(PREPARE_TIMEOUT_MS / 1000)}s watchdog window: {warmup.error}
          </span>
        </p>
      ) : null}
    </Card>
  );
}
