import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CloudOff, HardDrive, RefreshCw, Trash2, Video, WifiOff } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ModelManager } from "@/components/live/model-manager";
import {
  cachedModelStats,
  deleteCachedKey,
  deletePartialKey,
  modelCacheKey,
  orphanedStats,
  partialDownloadStats,
  type CachedModelStat,
  type PartialDownloadStat,
} from "@/features/inference/model-store";
import { formatBytes } from "@/features/drowsiness/labels";
import { ModelStatusPill } from "@/components/model-selector";
import { useModelContext } from "@/features/inference/model-context";
import { useOnlineStatus } from "@/hooks/use-online-status";

export const Route = createFileRoute("/_authenticated/models")({
  head: () => ({
    meta: [
      { title: "Model downloads — SentryEye" },
      {
        name: "description",
        content:
          "Download detection models for offline use, see storage used on this device, and switch the active model.",
      },
      { property: "og:title", content: "Model downloads — SentryEye" },
      {
        property: "og:description",
        content: "Manage offline detection models and device storage for SentryEye.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ModelsPage,
});

function ModelsPage() {
  const { models } = useModelContext();
  const online = useOnlineStatus();
  const [stats, setStats] = useState<CachedModelStat[]>([]);
  const [partials, setPartials] = useState<PartialDownloadStat[]>([]);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStats(await cachedModelStats());
    setPartials(await partialDownloadStats());
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage != null && est?.quota != null)
        setQuota({ usage: est.usage, quota: est.quota });
    } catch {
      /* estimate unsupported */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Every key a current model build could legitimately occupy: both the GPU
  // (fp16) and the CPU (fp32) export of every registered model.
  const liveKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const m of models) {
      keys.add(modelCacheKey(m.id, m.modelUrl));
      if (m.cpuModelUrl) keys.add(modelCacheKey(`${m.id}:cpu`, m.cpuModelUrl));
    }
    return keys;
  }, [models]);

  const storedKeys = useMemo(() => new Set(stats.map((s) => s.key)), [stats]);
  const storedModels = useMemo(
    () =>
      models.filter(
        (m) =>
          storedKeys.has(modelCacheKey(m.id, m.modelUrl)) ||
          (m.cpuModelUrl ? storedKeys.has(modelCacheKey(`${m.id}:cpu`, m.cpuModelUrl)) : false),
      ),
    [models, storedKeys],
  );
  const readyOffline = storedModels.length > 0;

  const orphans = useMemo(() => orphanedStats(stats, liveKeys), [stats, liveKeys]);
  const orphanBytes = orphans.reduce((sum, s) => sum + s.bytes, 0);
  const used = stats.reduce((sum, s) => sum + s.bytes, 0);
  const partialBytes = partials.reduce((sum, p) => sum + p.bytes, 0);

  const removeOne = async (key: string, bytes: number) => {
    setPendingKey(key);
    try {
      await deleteCachedKey(key);
      toast.success(`Removed ${formatBytes(bytes)} from this device`);
    } finally {
      setPendingKey(null);
      void refresh();
    }
  };

  const removeAllUnused = async () => {
    setPendingKey("__unused__");
    try {
      for (const o of orphans) await deleteCachedKey(o.key);
      toast.success(`Freed ${formatBytes(orphanBytes)}`);
    } finally {
      setPendingKey(null);
      void refresh();
    }
  };

  const discardPartial = async (key: string, bytes: number) => {
    setPendingKey(key);
    try {
      await deletePartialKey(key);
      toast.success(`Discarded ${formatBytes(bytes)} of unfinished download`);
    } finally {
      setPendingKey(null);
      void refresh();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-[16rem] flex-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Offline models</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Save a detection model to this device once. Live and video detection then start
            instantly and keep working with no internet connection.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <ModelStatusPill />
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> Refresh
          </Button>
          <Button asChild>
            <Link to="/live">
              <Video className="mr-2 h-4 w-4" aria-hidden="true" /> Go to live detection
            </Link>
          </Button>
        </div>
      </div>

      <Card
        className={`flex flex-wrap items-center gap-4 p-4 ${
          readyOffline
            ? "border-primary/40 bg-primary/5"
            : "border-amber-500/40 bg-amber-500/5"
        }`}
      >
        {readyOffline ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <CloudOff className="h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {readyOffline
              ? "Ready offline — you can drive with no connection"
              : "Download a model to drive without a connection"}
          </div>
          <p className="text-xs text-muted-foreground">
            {readyOffline
              ? `${storedModels.length} of ${models.length} detection model${
                  models.length === 1 ? "" : "s"
                } stored on this device. Shift reports are saved locally and sync when you're back online.`
              : "Detection runs entirely on your device, but the model file has to be downloaded once while you still have a connection."}
          </p>
        </div>
        {!online ? (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-amber-400">
            <WifiOff className="h-3 w-3" aria-hidden="true" /> Offline right now
          </span>
        ) : null}
      </Card>

      <Card className="flex flex-wrap items-center gap-4 border-border/60 bg-card/60 p-4">
        <HardDrive className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {stats.length} model{stats.length === 1 ? "" : "s"} stored · {formatBytes(used)} used
            {orphanBytes > 0 ? ` · ${formatBytes(orphanBytes)} unused` : ""}
          </div>
          <p className="text-xs text-muted-foreground">
            {quota
              ? `This site is using ${formatBytes(quota.usage)} of roughly ${formatBytes(
                  quota.quota,
                )} available on this device.`
              : "Stored in this browser's private storage — clearing site data removes the downloads."}
          </p>
        </div>
        {orphans.length > 0 ? (
          <Button
            variant="outline"
            disabled={pendingKey !== null}
            onClick={() => void removeAllUnused()}
          >
            <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Remove all unused ({formatBytes(orphanBytes)})
          </Button>
        ) : null}
      </Card>

      <ModelManager />

      {stats.length > 0 ? (
        <Card className="border-border/60 bg-card/60 p-5">
          <h2 className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Stored files
          </h2>
          <ul className="space-y-2 text-xs">
            {stats.map((s) => {
              const unused = !liveKeys.has(s.key);
              return (
                <li
                  key={s.key}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/40 pb-2 last:border-0 last:pb-0"
                >
                  <span className="font-mono text-foreground">{s.modelId}</span>
                  <span className="font-mono text-muted-foreground">{formatBytes(s.bytes)}</span>
                  {unused ? (
                    <Badge variant="outline" className="text-warning">
                      Unused (old build)
                    </Badge>
                  ) : null}
                  <span className="font-mono text-muted-foreground">
                    saved {new Date(s.savedAt).toLocaleString()}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto min-h-11 text-destructive hover:text-destructive"
                    disabled={pendingKey !== null}
                    aria-label={`Delete stored file ${s.modelId} (${formatBytes(s.bytes)})`}
                    onClick={() => void removeOne(s.key, s.bytes)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" /> Delete
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {partials.length > 0 ? (
        <Card className="border-border/60 bg-card/60 p-5">
          <h2 className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Unfinished downloads
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            {formatBytes(partialBytes)} of partly downloaded files are kept so a download can
            resume where it stopped. Discard them to free the space.
          </p>
          <ul className="space-y-2 text-xs">
            {partials.map((p) => (
              <li
                key={p.key}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/40 pb-2 last:border-0 last:pb-0"
              >
                <span className="font-mono text-foreground">{p.modelId}</span>
                <span className="font-mono text-muted-foreground">
                  {formatBytes(p.bytes)}
                  {p.total ? ` of ${formatBytes(p.total)}` : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto min-h-11 text-destructive hover:text-destructive"
                  disabled={pendingKey !== null}
                  aria-label={`Discard unfinished download ${p.modelId}`}
                  onClick={() => void discardPartial(p.key, p.bytes)}
                >
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" /> Discard
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
