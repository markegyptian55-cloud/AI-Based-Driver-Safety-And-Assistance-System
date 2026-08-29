// Automatic fallback control.
//
// Watches live telemetry and asks the page to switch to the fastest compatible
// model when performance stays under the bar. Switching happens at most once
// per run so a slow device cannot ping-pong between models.
//
// The bar itself is not owned here — it comes from useFallbackSettings, so the
// preset shown, the numbers saved to the account, and the numbers the monitor
// enforces can never drift apart.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Rabbit, Smartphone, X } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useModelContext } from "@/features/inference/model-context";
import { rankAlternatives } from "@/features/inference/model-compatibility";
import {
  FALLBACK_THRESHOLDS,
  createFallbackMonitor,
  type FallbackPreference,
} from "@/features/inference/auto-fallback";
import { useFallbackSettings } from "@/features/inference/use-fallback-settings";
import {
  clearFallbackEvents,
  describeFallback,
  readFallbackEvents,
  reasonFor,
  recordFallback,
  subscribeFallback,
  type FallbackEvent,
} from "@/features/inference/fallback-log";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { LiveSessionState } from "@/features/session/use-live-session";

/** Presets are just named (fps, latency) pairs over the same two numbers. */
const PRESETS = FALLBACK_THRESHOLDS.filter((t) => t.id !== "off");

function matchPreset(pref: FallbackPreference): string {
  if (!pref.enabled) return "off";
  const hit = PRESETS.find(
    (p) => p.minFps === pref.minFps && p.maxLatencyMs === pref.maxLatencyMs,
  );
  return hit ? hit.id : "custom";
}

export function AutoFallbackControl({
  state,
  onSwitch,
  disabled,
}: {
  state: LiveSessionState;
  /** Restart the run on a lighter model. */
  onSwitch: (modelId: string) => void;
  disabled?: boolean;
}) {
  const { selected, models, constrained } = useModelContext();
  const { account, device, effective, threshold, saveAccount, saveDevice } =
    useFallbackSettings();
  const [showCustom, setShowCustom] = useState(false);
  // Replayed from the log so the explanation survives the toast and a reload.
  const [events, setEvents] = useState<FallbackEvent[]>([]);
  useEffect(() => {
    setEvents(readFallbackEvents());
    return subscribeFallback(setEvents);
  }, []);

  const monitorRef = useRef(createFallbackMonitor(threshold));
  const startedAtRef = useRef<number | null>(null);
  const switchedRef = useRef(false);

  useEffect(() => {
    monitorRef.current = createFallbackMonitor(threshold);
  }, [threshold]);

  // Reset the streak whenever a run begins so a previous bad run cannot
  // trigger an immediate switch.
  useEffect(() => {
    if (state.running) {
      startedAtRef.current = performance.now();
      switchedRef.current = false;
      monitorRef.current.reset();
    } else {
      startedAtRef.current = null;
    }
  }, [state.running]);

  useEffect(() => {
    if (!state.running || switchedRef.current || startedAtRef.current == null) return;
    const sample = {
      t: performance.now() - startedAtRef.current,
      fps: state.processedFps,
      latencyMs: state.latencyMs,
    };
    if (!monitorRef.current.observe(sample)) return;

    const faster = rankAlternatives(models, { constrained }, selected?.id ?? null).filter(
      (a) => !selected || a.model.imgsz <= selected.imgsz,
    );
    const target = faster[0];
    if (!target) return;

    switchedRef.current = true;
    const event: FallbackEvent = {
      at: Date.now(),
      elapsedMs: Math.round(sample.t),
      fps: Number(sample.fps.toFixed(1)),
      latencyMs: Math.round(sample.latencyMs),
      minFps: threshold.minFps,
      maxLatencyMs: threshold.maxLatencyMs,
      fromModel: selected?.modelName ?? "the current model",
      toModel: target.model.modelName,
      toModelId: target.model.id,
      reason: reasonFor({
        fps: sample.fps,
        latencyMs: sample.latencyMs,
        minFps: threshold.minFps,
        maxLatencyMs: threshold.maxLatencyMs,
      }),
    };
    recordFallback(event);
    toast.warning("Switching to a faster model", {
      description: describeFallback(event),
      duration: 10000,
    });
    onSwitch(target.model.id);
  }, [
    state.running,
    state.processedFps,
    state.latencyMs,
    models,
    selected,
    constrained,
    onSwitch,
    threshold,
  ]);

  const scopedToDevice = device !== null;
  const presetId = matchPreset(effective);

  /** Writes to whichever scope the user has chosen. */
  function apply(next: Partial<FallbackPreference>) {
    const merged = { ...effective, ...next };
    if (scopedToDevice) saveDevice(merged);
    else void saveAccount(merged);
  }

  return (
    <Card className="space-y-4 border-border/60 bg-card/60 p-4">
      {events.length ? (
        <Alert className="border-warning/50 bg-warning/10">
          <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
          <AlertTitle className="flex items-center gap-2 text-sm">
            Auto-fallback switched the model
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2 text-[11px] text-muted-foreground"
              onClick={() => clearFallbackEvents()}
            >
              <X className="mr-1 h-3 w-3" aria-hidden="true" />
              Dismiss
            </Button>
          </AlertTitle>
          <AlertDescription className="space-y-1 text-xs">
            {events.slice(0, 3).map((e) => (
              <p key={e.at}>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {new Date(e.at).toLocaleTimeString()} ·{" "}
                  {(e.elapsedMs / 1000).toFixed(0)}s into the run —{" "}
                </span>
                {describeFallback(e)}
              </p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-start gap-3">
        <Rabbit className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Automatic fallback</div>
          <p className="text-xs text-muted-foreground">
            If detection stays slower than your bar for several seconds, the run restarts on the
            fastest model that passes every compatibility check on this device.
          </p>
        </div>
        <Select
          value={presetId}
          disabled={disabled}
          onValueChange={(v) => {
            if (v === "off") {
              setShowCustom(false);
              apply({ enabled: false });
              return;
            }
            if (v === "custom") {
              setShowCustom(true);
              apply({ enabled: true });
              return;
            }
            const preset = PRESETS.find((p) => p.id === v);
            if (!preset) return;
            setShowCustom(false);
            apply({
              enabled: true,
              minFps: preset.minFps,
              maxLatencyMs: preset.maxLatencyMs,
            });
          }}
        >
          <SelectTrigger className="w-full sm:w-[16rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Never switch automatically</SelectItem>
            {PRESETS.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
            <SelectItem value="custom">Custom threshold…</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(showCustom || presetId === "custom") && effective.enabled ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fallback-fps" className="text-xs">
              Switch below (FPS)
            </Label>
            <Input
              id="fallback-fps"
              type="number"
              min={1}
              max={30}
              step={1}
              disabled={disabled}
              value={effective.minFps}
              onChange={(e) => apply({ minFps: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fallback-latency" className="text-xs">
              Or above (latency, ms)
            </Label>
            <Input
              id="fallback-latency"
              type="number"
              min={50}
              max={5000}
              step={10}
              disabled={disabled}
              value={effective.maxLatencyMs}
              onChange={(e) => apply({ maxLatencyMs: Number(e.target.value) })}
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-border/50 pt-3">
        <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Label htmlFor="fallback-device" className="min-w-0 flex-1 text-xs font-normal">
          Use these numbers on this device only
          <span className="block text-[11px] text-muted-foreground">
            {scopedToDevice
              ? `This device overrides your account bar of ${account.minFps} FPS / ${account.maxLatencyMs} ms.`
              : "Your account setting applies everywhere you sign in."}
          </span>
        </Label>
        <Switch
          id="fallback-device"
          checked={scopedToDevice}
          disabled={disabled}
          onCheckedChange={(on) => saveDevice(on ? { ...effective } : null)}
        />
      </div>
    </Card>
  );
}
