// Model manager — the first thing a phone user sees on the live page.
//
// One job: pick a model, download it once, and know for certain that it will
// still work with no connection. Everything expert-level lives further down
// the page behind "Advanced settings".

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CloudOff, Download, HardDrive, Loader2, Trash2, Wifi, WifiOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useModelContext } from "@/features/inference/model-context";
import { accuracyGrade, formatBytes, modelAccuracy, modelBestFor } from "@/features/drowsiness/labels";
import {
  deleteCachedModel,
  discardPartialDownload,
  downloadModelToCache,
  hasCachedModel,
  partialDownloadBytes,
} from "@/features/inference/model-store";
import { runtimeModelAsset } from "@/features/inference/engine-preference";
import { errorMessage } from "@/lib/format-error";

type CacheState = Record<string, boolean>;

interface DownloadState {
  received: number;
  total: number | null;
}

export function ModelManager({ disabled }: { disabled?: boolean }) {
  const { models, selectedId, select, isLoading, warmup } = useModelContext();
  const [cached, setCached] = useState<CacheState>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadState>({ received: 0, total: null });
  /** Bytes already on disk from an interrupted download, per model. */
  const [partials, setPartials] = useState<Record<string, number>>({});
  const [online, setOnline] = useState(true);
  /** Lets the user stop a download that is crawling on a bad mobile link. */
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);


  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const refresh = useCallback(async () => {
    const entries = await Promise.all(
      models.map(
        async (m) =>
          [
            m.id,
            await hasCachedModel(runtimeModelAsset(m).id, runtimeModelAsset(m).url),
            await partialDownloadBytes(runtimeModelAsset(m).id, runtimeModelAsset(m).url),
          ] as const,
      ),
    );
    setCached(Object.fromEntries(entries.map(([id, ok]) => [id, ok])));
    setPartials(Object.fromEntries(entries.map(([id, , bytes]) => [id, bytes])));
  }, [models]);

  useEffect(() => {
    void refresh();
  }, [refresh, warmup.status]);

  const download = async (id: string, url: string, name: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusyId(id);
    setProgress({ received: 0, total: null });
    try {
      await downloadModelToCache(
        id,
        url,
        (received, total) => setProgress({ received, total }),
        controller.signal,
      );
      toast.success(`${name} saved on this device — it now works offline`);
    } catch (err) {
      if (controller.signal.aborted) {
        const kept = await partialDownloadBytes(id, url);
        toast.info(
          kept > 0
            ? `Download stopped — ${formatBytes(kept)} kept, you can resume later`
            : "Download stopped",
        );
      } else {
        const kept = await partialDownloadBytes(id, url);
        toast.error(
          kept > 0
            ? `Download interrupted at ${formatBytes(kept)} — tap Resume to continue where it stopped`
            : `Download failed: ${errorMessage(err)}`,
        );
      }
    } finally {
      abortRef.current = null;
      setBusyId(null);
      setProgress({ received: 0, total: null });
      void refresh();
    }
  };


  const remove = async (id: string, name: string) => {
    setBusyId(id);
    try {
      const meta = models.find((m) => m.id === id || runtimeModelAsset(m).id === id);
      await deleteCachedModel(id);
      if (meta) {
        // Both exports (GPU fp16 and CPU fp32) share the model row.
        await deleteCachedModel(meta.id);
        await deleteCachedModel(`${meta.id}:cpu`);
        await discardPartialDownload(meta.id, meta.modelUrl);
        if (meta.cpuModelUrl) {
          await discardPartialDownload(`${meta.id}:cpu`, meta.cpuModelUrl);
        }
      }
      toast.success(`${name} removed from this device`);
    } finally {
      setBusyId(null);
      void refresh();
    }
  };


  // Lightest first — the order people shop by on a phone.
  const sorted = [...models].sort(
    (a, b) => (a.fileSizeBytes ?? 0) - (b.fileSizeBytes ?? 0) || a.imgsz - b.imgsz,
  );

  return (
    <Card className="space-y-3 border-border/60 bg-card/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <HardDrive className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Choose your model</h2>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider",
            online ? "text-muted-foreground" : "text-warning",
          )}
        >
          {online ? (
            <>
              <Wifi className="h-3 w-3" aria-hidden="true" /> online
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3" aria-hidden="true" /> offline
            </>
          )}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Download a model once and it stays on this device — live detection then runs with no
        internet connection.
      </p>

      {isLoading ? (
        <p className="font-mono text-xs text-muted-foreground">Loading models…</p>
      ) : null}

      <ul className="space-y-2">
        {sorted.map((m) => {
          const active = m.id === selectedId;
          const saved = cached[m.id];
          // busyId holds the *asset* id, which is `<model>:cpu` on CPU-only
          // devices — comparing against m.id alone hid all progress there.
          const busy = busyId === m.id || busyId === runtimeModelAsset(m).id;

          const totalBytes = progress.total ?? m.fileSizeBytes ?? null;
          const pct = totalBytes
            ? Math.min(100, Math.round((progress.received / totalBytes) * 100))
            : null;
          return (
            <li key={m.id}>
              <div
                className={cn(
                  "rounded-lg border p-3 transition-colors",
                  active ? "border-primary/60 bg-primary/5" : "border-border/60 bg-background/40",
                )}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => !disabled && select(m.id)}
                  disabled={disabled}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{m.modelName}</span>
                    {active ? (
                      <Badge variant="default" className="h-5 gap-1 px-1.5 text-[10px]">
                        <Check className="h-3 w-3" aria-hidden="true" /> selected
                      </Badge>
                    ) : null}
                    {saved ? (
                      <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] text-safe">
                        <CloudOff className="h-3 w-3" aria-hidden="true" /> offline ready
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {formatBytes(m.fileSizeBytes)} · {m.imgsz}px ·{" "}
                    <span className="text-primary">
                      {modelAccuracy(m).value} {accuracyGrade(m)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    {modelBestFor(m)}
                  </p>
                  {m.accuracyUnverified ? (
                    // Honest labelling: this export reuses validated weights at a
                    // smaller input size and was never re-measured there.
                    <p className="mt-1 text-[11px] leading-snug text-warn">
                      Accuracy at this input size is not independently verified yet.
                    </p>
                  ) : null}
                </button>

                <div className="mt-2 flex flex-wrap gap-2">
                  {!saved ? (
                    <Button
                      size="sm"
                      variant={active ? "default" : "outline"}
                      className="flex-1 sm:flex-none"
                      disabled={disabled || busy || !online}
                      onClick={() =>
                        void download(
                          runtimeModelAsset(m).id,
                          runtimeModelAsset(m).url,
                          m.modelName,
                        )
                      }
                    >
                      {busy ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                      )}
                      {busy
                        ? "Downloading…"
                        : (partials[m.id] ?? 0) > 0
                          ? `Resume download (${formatBytes(partials[m.id])} saved)`
                          : "Download for offline"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 sm:flex-none"
                      disabled={disabled || busy}
                      onClick={() => void remove(m.id, m.modelName)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" /> Remove download
                    </Button>
                  )}
                  {!active ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1 sm:flex-none"
                      disabled={disabled}
                      onClick={() => select(m.id)}
                    >
                      Use this model
                    </Button>
                  ) : null}
                </div>

                {busy ? (
                  <div className="mt-2 space-y-1">
                    <Progress
                      value={pct}
                      className="h-1.5"
                      aria-label={`Download progress for ${m.modelName}`}
                    />
                    <div
                      className="flex justify-between font-mono text-[10px] text-muted-foreground"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      <span>
                        {formatBytes(progress.received)}
                        {progress.total ? ` / ${formatBytes(progress.total)}` : ""}
                      </span>
                      <span>{pct != null ? `${pct}% downloaded` : "downloading…"}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-11 w-full text-destructive hover:text-destructive"
                      onClick={() => abortRef.current?.abort()}
                    >
                      Stop download
                    </Button>
                  </div>
                ) : (partials[m.id] ?? 0) > 0 && !saved ? (

                  <p className="mt-2 font-mono text-[10px] text-warning">
                    Interrupted — {formatBytes(partials[m.id])} kept, resuming continues from here.
                  </p>
                ) : null}

              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
