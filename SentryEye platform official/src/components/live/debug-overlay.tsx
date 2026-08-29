// Live debug overlay: the numbers you need when someone says "it works on your
// laptop but not on my phone" — frame rates, dropped frames, the backend that
// was actually chosen, scene brightness, and per-class confidence.

import { useState } from "react";
import { Activity, ChevronDown, Download, Package, Share2, Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { LiveSessionState } from "@/features/session/use-live-session";
import {
  canShareDiagnostics,
  downloadDiagnostics,
  shareDiagnostics,
  type DiagnosticsBundle,
} from "@/features/session/diagnostics-log";
import type { CaptureProfileStats } from "@/features/session/capture-profiler";
import {
  downloadFullBundle,
  redactFullBundle,
  type FullDiagnosticsBundle,
} from "@/features/session/diagnostics-bundle";
import { ShareDiagnosticsDialog } from "./share-diagnostics-dialog";
import { toast } from "sonner";

export function DebugOverlay({
  state,
  buildDiagnostics,
  buildBundle,
  getProfile,
  exportCsv,
}: {
  state: LiveSessionState;
  buildDiagnostics: () => DiagnosticsBundle;
  /** Full bundle: logs + timings + per-frame quality + model identity. */
  buildBundle?: () => FullDiagnosticsBundle;
  /** Live capture profile (timing breakdown) for this run. */
  getProfile?: () => CaptureProfileStats;
  /** Downloads events + confidence timeline as CSV; returns the row count. */
  exportCsv?: () => number;
}) {
  const [open, setOpen] = useState(false);
  // Recomputed on every render while the panel is open — cheap, and it must
  // reflect the frame that just landed rather than a stale snapshot.
  const profile = open && getProfile ? getProfile() : null;
  const shareable = canShareDiagnostics();

  const rows: Array<[string, string]> = [
    ["Preset", state.presetId],
    ["Provider", `${state.engine}`],
    ["Model", `${state.modelName} ${state.modelVersion}`],
    ["Source FPS", state.cameraFps.toFixed(1)],
    ["Analysed FPS", state.processedFps.toFixed(1)],
    ["Inference FPS", state.inferenceFps.toFixed(1)],
    ["Latency", `${state.latencyMs.toFixed(0)} ms`],
    ["Dropped frames", String(state.droppedFrames)],
    ["Rejected frames", String(state.rejectedFrames)],
    ["Tracks", `${state.tracker.activeTracks} (${state.tracker.coasting} coasting)`],
    ["Scene brightness", `${(state.luma * 100).toFixed(0)}%`],
    ["Auto-gain", `${state.gain.toFixed(2)}×`],
    ["Low-light capture", state.lowLight ? "on" : "off"],
    ["Calibrated", state.calibration ? new Date(state.calibration.createdAt).toLocaleDateString() : "no"],
    ["Timeline rows", String(state.timelineSamples)],
    // Mouth diagnostics — why a yawn did or did not register.
    ["Mouth conf", (state.closure.topMouthConf ?? 0).toFixed(2)],
    ["Mouth aspect", (state.closure.mouthAspect ?? 0).toFixed(2)],
    ["Mouth baseline", (state.closure.mouthBaseline ?? 0).toFixed(2)],
    [
      "Yawn spell",
      `${state.closure.currentYawnMs} ms · ${state.closure.yawnFrames ?? 0} frames`,
    ],
    ["Mouth verdict", state.closure.mouthReject ?? "-"],
    ["Yawns", `${state.closure.yawns} (${state.closure.smilesRejected} rejected)`],
  ];

  const confidences = Object.entries(state.topConfidence).sort((a, b) => b[1] - a[1]);

  return (
    <Card className="border-border/60 bg-card/60 p-4">
      <div className="flex items-center gap-3">
        <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="text-sm font-semibold">Debug overlay</span>
        <Switch
          className="ml-auto"
          checked={open}
          onCheckedChange={setOpen}
          aria-label="Toggle debug overlay"
        />
      </div>

      {open ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px]">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-2">
                <dt className="truncate text-muted-foreground">{k}</dt>
                <dd className="shrink-0 text-foreground">{v}</dd>
              </div>
            ))}
          </dl>

          {profile ? (
            <div className="mt-3 border-t border-border/60 pt-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Capture profile · where the frame budget goes
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px]">
                {(
                  [
                    ["Camera → result", `${profile.latency.p50.toFixed(0)} / ${profile.latency.p95.toFixed(0)} ms`],
                    ["Preprocess", `${profile.preprocessMs.p50.toFixed(1)} ms`],
                    ["Model", `${profile.inferMs.p50.toFixed(1)} ms`],
                    ["Postprocess", `${profile.postprocessMs.p50.toFixed(1)} ms`],
                    ["Network", `${profile.transportMs.p50.toFixed(0)} ms`],
                    ["Worst stall", `${profile.worstGapMs.toFixed(0)} ms`],
                    ["Drop rate", `${(profile.dropRate * 100).toFixed(0)}%`],
                    ["Mean quality", profile.meanQuality.toFixed(0)],
                    [
                      "Route",
                      Object.entries(profile.routeShare)
                        .map(([r, share]) => `${r} ${(share * 100).toFixed(0)}%`)
                        .join(" · ") || "-",
                    ],
                    [
                      "Sensor",
                      profile.sensor?.iso
                        ? `ISO ${profile.sensor.iso}${profile.sensor.exposureTimeUs ? ` · ${(profile.sensor.exposureTimeUs / 1000).toFixed(1)} ms` : ""}`
                        : (profile.sensor?.exposureMode ?? "not exposed"),
                    ],
                  ] as Array<[string, string]>
                ).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-2">
                    <dt className="truncate text-muted-foreground">{k}</dt>
                    <dd className="shrink-0 text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <div className="mt-3 border-t border-border/60 pt-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Detection confidence
            </div>
            {confidences.length ? (
              <ul className="mt-2 space-y-1 font-mono text-[11px]">
                {confidences.map(([label, conf]) => (
                  <li key={label} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-muted-foreground">{label}</span>
                    <span
                      className="h-1.5 rounded-full bg-primary"
                      style={{ width: `${Math.min(100, conf * 100)}%` }}
                      aria-hidden="true"
                    />
                    <span className="ml-auto text-foreground">{(conf * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">No detections in this frame.</p>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                downloadDiagnostics(buildDiagnostics());
                toast.success("Diagnostics downloaded");
              }}
            >
              <Download className="mr-2 h-4 w-4" /> Download logs
            </Button>
            {shareable ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void shareDiagnostics(buildDiagnostics()).catch((err) =>
                    toast.error(`Share failed: ${String(err)}`),
                  );
                }}
              >
                <Share2 className="mr-2 h-4 w-4" /> Share logs
              </Button>
            ) : null}
            {buildBundle ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const { bundle, removed } = redactFullBundle(buildBundle());
                  downloadFullBundle(bundle);
                  toast.success(
                    removed.length
                      ? `Bundle downloaded (removed ${removed.join(", ")})`
                      : "Diagnostics bundle downloaded",
                  );
                }}
              >
                <Package className="mr-2 h-4 w-4" /> Export bundle
              </Button>
            ) : null}
            <ShareDiagnosticsDialog buildDiagnostics={buildDiagnostics} />
            {exportCsv ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const rows = exportCsv();
                  toast.success(`Exported ${rows} timeline rows to CSV`);
                }}
              >
                <Table2 className="mr-2 h-4 w-4" /> Export CSV
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className="h-3 w-3" aria-hidden="true" /> Show FPS, dropped frames and
          confidence
        </button>
      )}
    </Card>
  );
}
