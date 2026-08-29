import { useEffect, useState } from "react";
import { Check, Cpu, Smartphone, Monitor } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { hasCachedModel } from "@/features/inference/model-store";
import { runtimeModelAssets } from "@/features/inference/engine-preference";
import { microsleepNote, type ModelMetadata } from "@/features/drowsiness/labels";

function sizeLabel(bytes: number | null) {
  if (!bytes) return null;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fitIcon(model: ModelMetadata) {
  if (model.bestFor === "high-quality" || model.bestFor === "desktop") return Monitor;
  if (model.bestFor === "cpu-fallback") return Cpu;
  return Smartphone;
}


/**
 * Explicit model picker on the Live start card. A driver whose device stalls on
 * one export needs to see, before starting, which model is active and which
 * alternatives are already stored on the phone.
 */
export function ModelChoiceList({
  models,
  selectedId,
  onSelect,
  recommendedId,
  disabled,
  blockedReason,
}: {
  models: ModelMetadata[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  recommendedId?: string | null;
  disabled?: boolean;
  /** Per-model reason this device cannot run it (e.g. not enough memory). */
  blockedReason?: (model: ModelMetadata) => string | null;
}) {
  const [cached, setCached] = useState<Record<string, { gpu: boolean; cpu: boolean }>>({});

  useEffect(() => {
    let alive = true;
    void Promise.all(
      models.map(async (model) => {
        const assets = runtimeModelAssets(model);
        const [gpu, cpu] = await Promise.all([
          hasCachedModel(assets.gpu.id, assets.gpu.url),
          assets.cpu ? hasCachedModel(assets.cpu.id, assets.cpu.url) : Promise.resolve(false),
        ]);
        return [model.id, { gpu, cpu }] as const;
      }),
    ).then((pairs) => {
      if (alive) setCached(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [models]);

  if (!models.length) return null;

  return (
    <div className="flex flex-col gap-2" role="radiogroup" aria-label="Detection model">
      {models.map((model) => {
        const active = model.id === selectedId;
        const Icon = fitIcon(model);
        const size = sizeLabel(model.fileSizeBytes);
        const blocked = blockedReason?.(model) ?? null;
        return (
          <button
            key={model.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled || !!blocked}
            onClick={() => onSelect(model.id)}
            className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
              active
                ? "border-primary bg-primary/10"
                : "border-border/60 hover:border-primary/50"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium">{model.modelName}</span>
                {model.id === recommendedId ? (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-safe">
                    best for this device
                  </Badge>
                ) : null}
                {cached[model.id]?.gpu || cached[model.id]?.cpu ? (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                    downloaded
                  </Badge>
                ) : null}
              </span>
              <span className="block text-xs text-muted-foreground">
                {model.imgsz}px input{size ? ` · ${size}` : ""}
                {model.exportPrecision ? ` · ${model.exportPrecision}` : ""}
              </span>
              {microsleepNote(model) ? (
                <span className="block text-xs text-muted-foreground/80">
                  {microsleepNote(model)}
                </span>
              ) : null}
              {blocked ? (
                <span className="mt-1 block text-xs text-destructive">{blocked}</span>
              ) : null}

            </span>
            {active ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}
