// Shared model selector + warm-up status. Used on the header, Live, Video and
// Image pages so the selected model is identical everywhere.

import { Brain, CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useModelContext } from "@/features/inference/model-context";
import {
  accuracyGrade,
  formatBytes,
  modelAccuracy,
  modelBestFor,
} from "@/features/drowsiness/labels";

function mb(bytes: number | null | undefined): string | null {
  if (!bytes) return null;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human sentence for the current warm-up stage. */
function stageLabel(stage: string | null): string {
  switch (stage) {
    case "model-download-progress":
      return "downloading";
    case "model-download-done":
      return "download complete";
    case "session-create":
    case "creating-session":
      return "preparing model";
    case "warmup":
      return "warming up";
    case "ready":
      return "ready";
    default:
      return "initializing";
  }
}

export function ModelStatusPill({ className }: { className?: string }) {
  const { selected, warmup, retryWarmup } = useModelContext();
  if (!selected) return null;

  const pct = warmup.progress != null ? Math.round(warmup.progress * 100) : null;
  const bytes =
    warmup.receivedBytes != null && warmup.totalBytes != null
      ? `${mb(warmup.receivedBytes)} / ${mb(warmup.totalBytes)}`
      : null;

  const detail =
    warmup.status === "ready"
      ? `Ready · ${selected.modelName}`
      : warmup.status === "error"
        ? `${selected.modelName} failed to load`
        : warmup.stage === "model-download-progress" && pct != null
          ? `Loading ${selected.modelName} — downloading ${pct}%${bytes ? ` (${bytes})` : ""}`
          : `Loading ${selected.modelName} — ${stageLabel(warmup.stage)}…`;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider",
        warmup.status === "ready" && "text-safe",
        warmup.status === "error" && "text-destructive",
        warmup.status !== "ready" && warmup.status !== "error" && "text-muted-foreground",
        className,
      )}
      role="status"
      aria-live="polite"
      title={warmup.error ?? detail}
    >
      {warmup.status === "ready" ? (
        <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
      ) : warmup.status === "error" ? (
        <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
      ) : (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
      )}
      <span className="min-w-0 truncate">{detail}</span>
      {warmup.status !== "ready" && warmup.progress != null ? (
        <span
          className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-border"
          aria-hidden="true"
        >
          <span
            className="block h-full bg-primary transition-[width] duration-200"
            style={{ width: `${Math.round(warmup.progress * 100)}%` }}
          />
        </span>
      ) : null}
      {warmup.status === "error" ? (
        <button
          type="button"
          onClick={retryWarmup}
          className="underline underline-offset-2 hover:text-foreground"
        >
          retry
        </button>
      ) : null}
    </span>
  );
}

export function ModelSelector({
  className,
  disabled,
  showStatus = true,
}: {
  className?: string;
  disabled?: boolean;
  showStatus?: boolean;
}) {
  const { models, selectedId, select, isLoading, error, warmup, retryWarmup, savedModelMissing } =
    useModelContext();

  if (error) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-destructive", className)}>
        <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="truncate">Model registry unavailable</span>
      </div>
    );
  }

  // Lightest first: the ordering people actually shop by on a phone.
  const sorted = [...models].sort(
    (a, b) => (a.fileSizeBytes ?? 0) - (b.fileSizeBytes ?? 0) || a.imgsz - b.imgsz,
  );
  const current = sorted.find((m) => m.id === selectedId) ?? null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Brain className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <Select value={selectedId ?? undefined} onValueChange={select} disabled={disabled || isLoading}>
        {/* The trigger shows a single compact line — the full three-line card
            with size, resolution, accuracy and guidance lives in the list. */}
        <SelectTrigger
          className="h-auto min-h-9 w-full min-w-0 whitespace-normal py-1.5 sm:w-[320px] [&>span]:line-clamp-none"
          aria-label="Detection model"
        >
          {current ? (
            <span className="!flex min-w-0 flex-1 flex-col items-start gap-0.5 overflow-hidden text-left">
              <span className="max-w-full truncate font-mono text-xs">{current.modelName}</span>
              <span className="max-w-full truncate font-mono text-[10px] text-muted-foreground">
                {formatBytes(current.fileSizeBytes)} · {current.imgsz}px ·{" "}
                <span className="text-primary">
                  {modelAccuracy(current).value} {accuracyGrade(current)}
                </span>
              </span>
            </span>
          ) : (
            <span className="truncate text-sm text-muted-foreground">
              {isLoading ? "Loading models…" : "Select model"}
            </span>
          )}
        </SelectTrigger>
        <SelectContent className="max-w-[min(92vw,26rem)]">
          {sorted.map((m) => {
            const acc = modelAccuracy(m);
            return (
              <SelectItem key={m.id} value={m.id} className="whitespace-normal pr-8">
                <span className="flex min-w-0 flex-col items-start gap-0.5 py-0.5">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{m.modelName}</span>
                    <span className="text-[10px] text-muted-foreground">v{m.version}</span>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                    <span>{formatBytes(m.fileSizeBytes)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{m.imgsz}px</span>
                    <span aria-hidden="true">·</span>
                    <span className="text-primary">
                      {acc.value} {accuracyGrade(m)}
                    </span>
                  </span>
                  <span className="min-w-0 whitespace-normal break-words text-[10px] leading-snug text-muted-foreground">
                    {modelBestFor(m)}
                  </span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {showStatus ? <ModelStatusPill /> : null}
      {warmup.status === "error" && showStatus === false ? (
        <Button size="sm" variant="outline" onClick={retryWarmup}>
          Retry load
        </Button>
      ) : null}
      {savedModelMissing ? (
        <p className="w-full text-[11px] text-muted-foreground">
          Your saved model is no longer available — switched to the recommended default.
        </p>
      ) : null}
    </div>

  );
}
