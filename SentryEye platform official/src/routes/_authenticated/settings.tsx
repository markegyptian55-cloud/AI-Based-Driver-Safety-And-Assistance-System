import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { Card } from "@/components/ui/card";
import {
  readEnginePreference,
  writeEnginePreference,
  type EnginePreference,
} from "@/features/inference/engine-preference";
import {
  readPresetPreference,
  writePresetPreference,
  type PresetPreference,
} from "@/features/inference/mobile-presets";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUserSettings } from "@/hooks/use-user-settings";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — SentryEye" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { settings, isLoading, update } = useUserSettings();
  const [form, setForm] = useState(settings);
  const [engine, setEngine] = useState<EnginePreference>("auto");
  const [preset, setPreset] = useState<PresetPreference>("auto");

  useEffect(() => {
    setEngine(readEnginePreference());
    setPreset(readPresetPreference());
  }, []);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  if (isLoading || !form) {
    return <div className="text-sm text-muted-foreground">Loading settings…</div>;
  }

  async function save() {
    if (!form) return;
    try {
      await update({
        inference_provider: form.inference_provider,
        drowsy_perclos_threshold: form.drowsy_perclos_threshold,
        eye_closed_ms_threshold: form.eye_closed_ms_threshold,
        yawn_rate_per_min_threshold: form.yawn_rate_per_min_threshold,
        alarm_enabled: form.alarm_enabled,
        alarm_volume: form.alarm_volume,
      });
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Provider, drowsiness thresholds, and alarm behavior. Applies live to the next inference
          frame.
        </p>
      </div>

      <Card className="border-border/60 bg-card/60 p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider">Inference</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <Label>Provider</Label>
            <Select
              value={form.inference_provider}
              onValueChange={(v) => setForm({ ...form, inference_provider: v })}
            >
              <SelectTrigger className="mt-2 font-mono text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="browser-onnx">Browser ONNX (WebGPU / WASM)</SelectItem>
                <SelectItem value="remote-fastapi" disabled>
                  Remote FastAPI (Phase 2)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Execution backend</Label>
            <Select
              value={engine}
              onValueChange={(v) => {
                const pref = v as EnginePreference;
                setEngine(pref);
                writeEnginePreference(pref);
                toast.success("Backend preference saved — applies on the next session start");
              }}
            >
              <SelectTrigger className="mt-2 font-mono text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (CPU on mobile, GPU on desktop)</SelectItem>
                <SelectItem value="webgpu">Force WebGPU (GPU)</SelectItem>
                <SelectItem value="wasm">Force CPU (WASM)</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs text-muted-foreground">
              Some mobile GPU drivers run the model incorrectly and produce a grid of bogus boxes.
              Auto keeps phones on CPU and self-tests the backend before every session.
            </p>
          </div>
          <div>
            <Label>Detection preset</Label>
            <Select
              value={preset}
              onValueChange={(v) => {
                const pref = v as PresetPreference;
                setPreset(pref);
                writePresetPreference(pref);
                toast.success("Preset saved — applies on the next session start");
              }}
            >
              <SelectTrigger className="mt-2 font-mono text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (by device)</SelectItem>
                <SelectItem value="desktop">Desktop / good lighting</SelectItem>
                <SelectItem value="mobile-lowlight">Mobile / low light</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs text-muted-foreground">
              The mobile preset lowers the confidence floor, brightens dark frames, smooths boxes
              across frames, and lengthens the closure windows so a 12 fps phone camera does not
              miss a microsleep.
            </p>
          </div>
        </div>
      </Card>


      <Card className="border-border/60 bg-card/60 p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider">Drowsiness thresholds</h2>
        <div className="mt-4 space-y-6">
          <SliderRow
            label="Drowsy PERCLOS"
            hint="Ratio of closed-eye frames (over window) that trips DANGER."
            value={form.drowsy_perclos_threshold}
            min={0.1}
            max={0.9}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setForm({ ...form, drowsy_perclos_threshold: v })}
          />
          <SliderRow
            label="Eye-closed duration"
            hint="Sustained closure (ms) that emits an eye_closed_sustained event."
            value={form.eye_closed_ms_threshold}
            min={100}
            max={2000}
            step={50}
            format={(v) => `${v} ms`}
            onChange={(v) => setForm({ ...form, eye_closed_ms_threshold: v })}
          />
          <SliderRow
            label="Yawn rate"
            hint="Yawns per minute that flip risk to WARN."
            value={form.yawn_rate_per_min_threshold}
            min={1}
            max={15}
            step={1}
            format={(v) => `${v}/min`}
            onChange={(v) => setForm({ ...form, yawn_rate_per_min_threshold: v })}
          />
        </div>
      </Card>

      <Card className="border-border/60 bg-card/60 p-4 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider">Alarm</h2>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <Label>Enable alarm</Label>
            <p className="text-xs text-muted-foreground">Audio cue on DANGER risk.</p>
          </div>
          <Switch
            checked={form.alarm_enabled}
            onCheckedChange={(c) => setForm({ ...form, alarm_enabled: c })}
          />
        </div>
        <div className="mt-6">
          <SliderRow
            label="Volume"
            value={form.alarm_volume}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setForm({ ...form, alarm_volume: v })}
          />
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save}>
          <Save className="mr-2 h-4 w-4" /> Save settings
        </Button>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">{format(value)}</span>
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <Slider
        className="mt-3"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}
