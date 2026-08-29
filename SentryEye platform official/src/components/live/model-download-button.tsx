// Explicit "download this model now" control.
//
// The app already downloads a model lazily when it prepares one, but on a phone
// that happens behind a spinner. This button makes the file transfer a visible,
// cancellable action with its own progress bar, so a driver can pull the model
// over Wi-Fi before leaving and then start Live with no network at all.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { runtimeModelAsset } from "@/features/inference/engine-preference";
import { downloadModelToCache, hasCachedModel } from "@/features/inference/model-store";
import type { ModelMetadata } from "@/features/drowsiness/labels";
import { errorMessage } from "@/lib/format-error";

export function ModelDownloadButton({
  model,
  className,
  onDone,
}: {
  model: ModelMetadata | null;
  className?: string;
  onDone?: () => void;
}) {
  const [cached, setCached] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cachedLabel, setCachedLabel] = useState("saved");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProgress(null);
    setError(null);
    if (!model) {
      setCached(null);
      return;
    }
    const asset = runtimeModelAsset(model);
    setCachedLabel(asset.id.endsWith(":cpu") ? "CPU file saved" : "GPU file saved");
    void hasCachedModel(asset.id, asset.url).then((ok) => {
      if (!cancelled) setCached(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [model]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const download = useCallback(async () => {
    if (!model) return;
    const asset = runtimeModelAsset(model);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setError(null);
    setProgress(0);
    try {
      await downloadModelToCache(
        asset.id,
        asset.url,
        (received, total) => {
          if (controller.signal.aborted) return;
          setProgress(total && total > 0 ? Math.min(1, received / total) : null);
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setCached(true);
      setProgress(null);
      onDone?.();
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(errorMessage(err));
      setProgress(null);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [model, onDone]);

  const downloading = progress !== null || !!abortRef.current;

  if (cached) {
    return (
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-safe/40 bg-safe/10 px-2.5 py-1 text-[11px] font-medium text-safe ${className ?? ""}`}
      >
        <Check className="h-3 w-3" aria-hidden="true" /> {cachedLabel}
      </span>
    );
  }

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void download()}
          disabled={!model || downloading}
        >
          {downloading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          )}
          {downloading ? "Downloading…" : "Download"}
        </Button>
        {downloading ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label="Stop download"
            onClick={() => {
              abortRef.current?.abort();
              abortRef.current = null;
              setProgress(null);
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {downloading ? (
        <div aria-live="polite">
          <Progress value={Math.round((progress ?? 0) * 100)} className="h-1.5" />
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {progress !== null ? `${Math.round(progress * 100)}%` : "starting…"}
          </p>
        </div>
      ) : null}
      {error ? (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
