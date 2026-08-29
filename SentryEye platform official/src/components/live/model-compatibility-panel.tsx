// Pre-start compatibility panel.
//
// Not just "incompatible" — it names the exact pipeline step that fails (input
// resolution, resize mode, normalisation, decoder, class map, download size),
// what the pipeline expects instead, and which registry models would pass.

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  XCircle,
  Zap,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useModelContext } from "@/features/inference/model-context";
import {
  compatibilityChecks,
  rankAlternatives,
  type CompatibilityCheck,
} from "@/features/inference/model-compatibility";
import { describePreprocessing, resolveLivePreset } from "@/features/inference/live-config";

export function ModelCompatibilityPanel() {
  const { compatibility, selected, models, select, constrained } = useModelContext();
  const [open, setOpen] = useState(false);

  const device = { constrained };
  const checks = compatibilityChecks(selected, device);
  const failing = checks.filter((c) => c.status !== "pass");
  const alternatives = rankAlternatives(models, device, selected?.id ?? null).slice(0, 3);
  const clean = compatibility.ok && compatibility.warnings.length === 0;

  const tone = clean
    ? "border-border/60 bg-card/60"
    : compatibility.ok
      ? "border-warn/40 bg-warn/10"
      : "border-destructive/40 bg-destructive/10";

  return (
    <Card className={cn("space-y-3 p-4 text-sm", tone)} role={clean ? "status" : "alert"}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        {clean ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-safe" aria-hidden="true" />
        ) : compatibility.ok ? (
          <Info className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Compatibility check
          </span>
          <span className="block truncate text-xs">
            {clean
              ? `${selected?.modelName} matches this detection pipeline.`
              : compatibility.ok
                ? `${failing.length} step${failing.length === 1 ? "" : "s"} will hurt performance on this device.`
                : `${failing.length} step${failing.length === 1 ? "" : "s"} fail — live detection cannot start.`}
          </span>
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {!clean ? (
        <ul className="space-y-1.5">
          {failing.map((c) => (
            <CheckRow key={c.id} check={c} />
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="space-y-3 border-t border-border/60 pt-3">
          <ul className="space-y-1.5">
            {checks
              .filter((c) => clean || c.status === "pass")
              .map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
          </ul>
          {selected ? (
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Live preprocessing: {describePreprocessing(selected, resolveLivePreset()).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {!clean && alternatives.length ? (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Models that pass every check here
          </p>
          {alternatives.map((alt) => (
            <div key={alt.model.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs">
                <span className="font-mono">{alt.model.modelName}</span>{" "}
                <span className="text-muted-foreground">— {alt.reason}</span>
              </span>
              <Button size="sm" variant="outline" onClick={() => select(alt.model.id)}>
                <Zap className="mr-2 h-3.5 w-3.5" /> Use this
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function CheckRow({ check }: { check: CompatibilityCheck }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      {check.status === "pass" ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-safe" aria-hidden="true" />
      ) : check.status === "warn" ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
      ) : (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
      )}
      <span className="min-w-0 break-words">
        <span className="font-medium">{check.label}:</span>{" "}
        <span className="font-mono">{check.actual}</span>
        {check.status === "pass" ? null : (
          <>
            {" "}
            <span className="text-muted-foreground">(expected {check.expected})</span>
          </>
        )}
        {check.detail ? (
          <span className="block text-muted-foreground">{check.detail}</span>
        ) : null}
      </span>
    </li>
  );
}
