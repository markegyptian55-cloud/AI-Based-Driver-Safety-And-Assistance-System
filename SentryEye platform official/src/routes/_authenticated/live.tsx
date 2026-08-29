import { createFileRoute, Link } from "@tanstack/react-router";
import { runtimeModelAsset } from "@/features/inference/engine-preference";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  CloudOff,
  FileText,
  Moon,
  Play,
  RotateCw,
  SlidersHorizontal,
  Square,
  Table2,
  TrendingDown,
  Contrast,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelChoiceList } from "@/components/live/model-choice-list";
import { ModelDownloadButton } from "@/components/live/model-download-button";
import { DiagnosticsCard } from "@/components/live/diagnostics-card";
import { StartupStageTimeline } from "@/components/live/startup-stage-timeline";
import { WorkerDebugPanel } from "@/components/live/worker-debug-panel";
import { DeviceCapabilityModal } from "@/components/live/device-capability-modal";

import { DetectionOverlay } from "@/components/live/detection-overlay";
import { useHighContrastOverlay } from "@/hooks/use-high-contrast";
import { ModelSelector } from "@/components/model-selector";
import { ModelManager } from "@/components/live/model-manager";
import { DriverPicker } from "@/components/drivers/driver-picker";
import {
  readCaptureSettings,
  type CaptureSettingsSnapshot,
} from "@/features/session/capture-profiler";
import { useShiftMonitor } from "@/features/fleet/shift-context";
import { ShiftControlBar } from "@/components/fleet/shift-control-bar";
import { OfflineModelNotice } from "@/components/live/offline-model-notice";
import { useDrivers } from "@/hooks/use-drivers";
import { RiskPanel } from "@/components/live/risk-panel";
import { YawnPanel } from "@/components/live/yawn-panel";

import { ProviderStatus } from "@/components/live/provider-status";
import { EngineStrip } from "@/components/live/engine-strip";
import { PerfMetricsBar } from "@/components/inference/PerfMetricsBar";
import { DebugOverlay } from "@/components/live/debug-overlay";
import { CalibrationWizard } from "@/components/live/calibration-wizard";
import { QualityGate } from "@/components/live/quality-gate";
import { QualityCuesOverlay } from "@/components/live/quality-cues-overlay";
import { ReplayScrubber } from "@/components/live/replay-scrubber";
import { SessionPdfButton } from "@/components/report/session-pdf-button";
import { LastSessionExport } from "@/components/report/last-session-export";
import { useCalibrationSync } from "@/hooks/use-calibration-sync";
import type { ReplayFrame } from "@/features/session/replay-buffer";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useQualityMonitor } from "@/hooks/use-quality-monitor";
import { readCalibration, type CalibrationProfile } from "@/features/session/calibration";
import { readLowLightPreference, writeLowLightPreference } from "@/features/session/low-light";
import {
  readAutoStartPreference,
  readAutoSwitchPreference,
  readOrientationPreference,
  AUTOSWITCH_EVENT,
  writeAutoStartPreference,
  writeAutoSwitchPreference,
  writeOrientationPreference,
  type OrientationPreference,
} from "@/features/session/live-preferences";
import { hasCachedModel } from "@/features/inference/model-store";
import {
  useDetectionSession,
  type FrameSourceFactory,
  type LiveSessionSettings,
} from "@/features/session/use-live-session";
import { createCamera } from "@/features/session/camera";
import type { SessionSource } from "@/features/session/session-source";
import { useUserSettings, CLIENT_DEFAULTS } from "@/hooks/use-user-settings";
import type { ProviderId } from "@/features/inference/registry";
import { useModelSelection } from "@/hooks/use-model-selection";
import { makeTrace } from "@/features/session/pipeline-trace";
import { useAutoDowngrade } from "@/hooks/use-auto-downgrade";
import { checkRegression, recordRun } from "@/features/inference/latency-baseline";
import { useModelContext } from "@/features/inference/model-context";
import { ModelCompatibilityPanel } from "@/components/live/model-compatibility-panel";
import { QuickTestPanel } from "@/components/live/quick-test-panel";
import { LiveBenchmarkPanel } from "@/components/live/live-benchmark-panel";
import { DeviceModelReport } from "@/components/live/device-model-report";
import { TelemetryPanel } from "@/components/live/telemetry-panel";
import { AutoFallbackControl } from "@/components/live/auto-fallback-control";
import { readBrowserCapabilities } from "@/features/system/system-status";

export const Route = createFileRoute("/_authenticated/live")({
  head: () => ({
    meta: [
      { title: "Live Driver Detection — SentryEye" },
      {
        name: "description",
        content: "Run private, real-time driver drowsiness detection with an offline-ready model.",
      },
      { property: "og:title", content: "Live Driver Detection — SentryEye" },
      {
        property: "og:description",
        content: "Run private, real-time driver drowsiness detection with an offline-ready model.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LivePage,
});

function LivePage() {
  const videoRef = useRef<HTMLVideoElement>(null!);
  const { settings } = useUserSettings();
  const { selectedId: modelId, models, selected } = useModelSelection();
  const {
    compatibility,
    warmup,
    select: selectModel,
    loadTrace,
    constrained,
    verification,
    reverify,
    retryWarmup,
    hardRetry,
    useCpuMode,
    useSafeMode,
    compatibilityFor,
    enginePreference,
  } = useModelContext();
  const [highContrast, setHighContrast] = useHighContrastOverlay();
  const loadTraceRef = useRef(loadTrace);
  loadTraceRef.current = loadTrace;

  // Capability probe runs after mount so SSR markup stays stable.
  const [capable, setCapable] = useState(true);
  // The overlay must subscribe to a real element, never to a ref read during
  // render (which is null on the first pass and would leave the canvas blank).
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  // Expert controls start collapsed: the phone-first flow is pick model → start.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationProfile | null>(null);
  const [lowLight, setLowLight] = useState(false);
  // Mirror the selfie preview when the active camera faces the driver.
  const [mirrored, setMirrored] = useState(false);
  // Offline/auto-start state: null while the cache is still being inspected.
  const [offlineReady, setOfflineReady] = useState<boolean | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [orientation, setOrientation] = useState<OrientationPreference>("auto");
  const [devicePortrait, setDevicePortrait] = useState(true);
  // Real aspect ratio of the camera stream, so the preview shows the whole
  // picture instead of a hard crop that looks like a zoomed-in face.
  const [streamAspect, setStreamAspect] = useState<number | null>(null);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    const caps = readBrowserCapabilities();
    setCapable(caps.webassembly && caps.webWorker && caps.mediaDevices);
    setCalibration(readCalibration());
    setLowLight(readLowLightPreference());
    setAutoStart(readAutoStartPreference());
    setAutoSwitch(readAutoSwitchPreference());
    setPreferencesReady(true);
    setOrientation(readOrientationPreference());
    const syncOrientation = () => setDevicePortrait(window.innerHeight >= window.innerWidth);
    syncOrientation();
    window.addEventListener("resize", syncOrientation);
    window.screen?.orientation?.addEventListener?.("change", syncOrientation);
    return () => {
      window.removeEventListener("resize", syncOrientation);
      window.screen?.orientation?.removeEventListener?.("change", syncOrientation);
    };
  }, []);

  useEffect(() => {
    const syncAutoSwitch = (event: Event) => {
      const next = (event as CustomEvent<boolean>).detail;
      setAutoSwitch(typeof next === "boolean" ? next : readAutoSwitchPreference());
    };
    window.addEventListener(AUTOSWITCH_EVENT, syncAutoSwitch);
    return () => window.removeEventListener(AUTOSWITCH_EVENT, syncAutoSwitch);
  }, []);

  // The 960 graph is the desktop accuracy model. On a constrained phone we
  // pre-select the 480 low-device export — but only while automatic switching
  // is enabled. The previous 320px lookup could never match the current model
  // registry and left phones trying to prepare the 960px graph.
  useEffect(() => {
    // Not gated on the auto-switch preference any more: a phone that opens Live
    // with the 960 desktop graph remembered would sit on "Preparing model…"
    // forever, which is exactly the Android hang drivers reported.
    if (!preferencesReady) return;
    if (!constrained || !selected || selected.imgsz <= 480) return;
    const mobile = [...models]
      .filter((model) => model.imgsz <= 480)
      .sort((a, b) => a.imgsz - b.imgsz)[0];
    if (mobile && mobile.id !== selected.id) selectModel(mobile.id);
  }, [preferencesReady, constrained, selected, models, selectModel]);

  // Wall-clock feedback while the model is being prepared. Without it a stalled
  // driver is indistinguishable from a slow download.
  const [prepareElapsed, setPrepareElapsed] = useState(0);
  useEffect(() => {
    if (warmup.status !== "loading" || !warmup.startedAt) {
      setPrepareElapsed(0);
      return;
    }
    const startedAt = warmup.startedAt;
    const tick = () => setPrepareElapsed(Math.round((Date.now() - startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [warmup.status, warmup.startedAt]);

  const recommendedModel = useMemo(() => {
    if (!models.length) return null;
    const sorted = [...models].sort((a, b) => a.imgsz - b.imgsz);
    return (constrained ? sorted[0] : sorted[sorted.length - 1]) ?? null;
  }, [models, constrained]);

  // Is the selected model's file already on this device? That is the question
  // that decides whether we can start with no connection at all.
  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setOfflineReady(null);
      return;
    }
    const asset = runtimeModelAsset(selected);
    void hasCachedModel(asset.id, asset.url).then((ok) => {
      if (!cancelled) setOfflineReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, warmup.status]);

  // Opening the live page re-runs the quick check on the remembered model, so
  // the driver learns about a bad device state before the camera opens.
  const reverifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (warmup.status !== "ready" || !selected) return;
    if (reverifiedRef.current === selected.id) return;
    reverifiedRef.current = selected.id;
    void reverify();
  }, [warmup.status, selected, reverify]);



  const liveSettings: LiveSessionSettings = useMemo(
    () => ({
      providerId: (settings?.inference_provider as ProviderId) ?? "browser-onnx",
      modelId,
      confThreshold: CLIENT_DEFAULTS.confThreshold,
      iouThreshold: CLIENT_DEFAULTS.iouThreshold,
      scoring: {
        windowMs: CLIENT_DEFAULTS.perclosWindowMs,
        eyeClosedMsThreshold: settings?.eye_closed_ms_threshold ?? 400,
        microsleepMs: CLIENT_DEFAULTS.microsleepMs,
        criticalMicrosleepMs: CLIENT_DEFAULTS.criticalMicrosleepMs,
        drowsyPerclosThreshold: settings?.drowsy_perclos_threshold ?? 0.4,
        yawnRatePerMinThreshold: settings?.yawn_rate_per_min_threshold ?? 3,
        eventCooldownMs: CLIENT_DEFAULTS.eventCooldownMs,
        yawnMinAspect: CLIENT_DEFAULTS.yawnMinAspect,
        yawnConfThreshold: CLIENT_DEFAULTS.yawnConfThreshold,
        yawnStartMs: CLIENT_DEFAULTS.yawnStartMs,
        yawnConfirmMs: CLIENT_DEFAULTS.yawnConfirmMs,
        longYawnMs: CLIENT_DEFAULTS.longYawnMs,
        yawnGapMs: CLIENT_DEFAULTS.yawnGapMs,
        yawnConfirmFrames: CLIENT_DEFAULTS.yawnConfirmFrames,
      },
    }),
    [settings, modelId],
  );

  const createSource: FrameSourceFactory = useCallback(
    (ctx) =>
      createCamera({
        video: videoRef.current,
        onFrame: ctx.onFrame,
        lowLight: readLowLightPreference(),
        onLowLight: (outcome) => toast.info(outcome.message),
        onTrack: (track) => {
          reportSensorRef.current?.(readCaptureSettings(track));
          const trackSettings = track?.getSettings();
          const facing = trackSettings?.facingMode;
          // No facingMode reported (most desktop webcams) still means a
          // user-facing camera, so mirror unless it is explicitly the rear one.
          setMirrored(track ? facing !== "environment" : false);
        },
      }),
    [],
  );

  // The camera source is built before the session hook exists, so the sensor
  // reporter is reached through a ref rather than a stale closure.
  const reportSensorRef = useRef<((s: CaptureSettingsSnapshot | null) => void) | null>(null);

  const { driverLabel, driverId } = useDrivers();
  const {
    state,
    start,
    stop,
    detectionsRef,
    buildDiagnostics,
    buildBundle,
    getProfile,
    reportSensor,
    exportCsv,
    reportQuality,
    getReplay,
    getTimeline,
    getStartedAt,
  } = useDetectionSession({
    settings: liveSettings,
    source: "webcam" satisfies SessionSource,
    createSource,
    driver: { id: driverId, label: driverLabel },
    // Live capture never converts anything; the interesting cost is the model.
    pipelineTrace: () =>
      makeTrace({
        source: "webcam",
        conversionPath: "none",
        conversionMs: 0,
        model: loadTraceRef.current,
      }),
    autoCalibrate: true,
  });

  reportSensorRef.current = reportSensor;

  // Fleet: feed safety events of this run into the active shift (no-op when
  // no shift is running or the user is a visitor).
  useShiftMonitor(state.recentEvents, state.running);

  // Automatic fallback: stop the run, swap the model, and resume once the new
  // one has finished downloading and warming up.
  const pendingRestartRef = useRef(false);
  const handleFallbackSwitch = useCallback(
    (modelId: string) => {
      pendingRestartRef.current = true;
      // Stop first, then switch: the old worker must be released before the new
      // model is acquired, otherwise the overlay keeps drawing stale boxes.
      void Promise.resolve(stop()).then(() => selectModel(modelId));
    },
    [selectModel, stop],
  );

  // Any model change wipes the overlay immediately, so boxes from the previous
  // model can never be shown on top of the new one's first frames.
  useEffect(() => {
    detectionsRef.current = [];
  }, [modelId, detectionsRef]);
  useEffect(() => {
    if (!pendingRestartRef.current) return;
    if (state.running || state.starting) return;
    if (warmup.status !== "ready" || !compatibility.ok) return;
    pendingRestartRef.current = false;
    void start();
  }, [state.running, state.starting, warmup.status, compatibility.ok, start]);

  /** One tap: no preflight, no settings — go straight to the camera. */
  const startNow = useCallback(() => {
    setCalibrating(false);
    void start();
  }, [start]);

  // Auto-start. When the model is already downloaded (so no network is needed)
  // and it has finished warming up, the session begins by itself exactly once
  // per page visit. Any manual stop keeps it stopped.
  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    if (!capable || offlineReady !== true) return;
    if (warmup.status !== "ready" || !compatibility.ok) return;
    // Never auto-start a model that failed its quick check on this device.
    if (!verification || verification.status === "fail") return;
    if (state.running || state.starting || calibrating) return;
    autoStartedRef.current = true;
    toast.info("Model already on this device — starting live detection");
    void start();
  }, [
    autoStart,
    capable,
    offlineReady,
    warmup.status,
    compatibility.ok,
    verification,
    state.running,
    state.starting,
    calibrating,
    start,
  ]);


  // Calibration follows the account across devices (newest profile wins).
  const calSync = useCalibrationSync();
  useEffect(() => {
    if (calSync.profile) setCalibration(calSync.profile);
  }, [calSync.profile]);

  // Replay snapshot: taken when a run finishes so the buffer can keep filling.
  const [replay, setReplay] = useState<ReplayFrame[]>([]);
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (state.running) wasRunningRef.current = true;
    else if (wasRunningRef.current) {
      wasRunningRef.current = false;
      setReplay(getReplay().slice());
      // Compare this run against this device's own history for the same model,
      // then fold it in. A slowdown here means the device changed (thermal
      // throttling, another tab), not that the model changed.
      const stats = getProfile();
      const modelKey = state.modelName || modelId;
      if (stats && stats.frames > 30 && modelKey) {
        const current = { fpsP50: stats.analysedFps, latencyP50Ms: stats.latency.p50 };
        void checkRegression(modelKey, state.engine, current)
          .then((verdict) => {
            if (verdict?.regressed) {
              toast.warning("This run was slower than usual on this device", {
                description: verdict.message,
                duration: 10_000,
              });
            }
            return recordRun(modelKey, state.engine, {
              fpsP50: stats.analysedFps,
              fpsP95: stats.analysedFps,
              latencyP50Ms: stats.latency.p50,
              latencyP95Ms: stats.latency.p95,
            });
          })
          .catch(() => undefined);
      }
    }
  }, [state.running, getReplay, getProfile, state.modelName, state.engine, modelId]);


  const quality = useQualityMonitor(videoEl, state, {
    enabled: state.running,
    onScore: reportQuality,
  });
  // Quality is advisory: it never stops inference and never gates on framing.
  // Sustained frame starvation can step down to a lighter model, but only while
  // automatic switching is still allowed — a hand-picked model stays put.
  const downgrade = useAutoDowngrade({
    enabled: preferencesReady && autoSwitch && readAutoSwitchPreference(),
    running: state.running,
    quality: quality?.score ?? null,
    analysedFrames: state.snapshot?.framesProcessed ?? 0,
    models,
    currentModelId: modelId,
    onSwitch: handleFallbackSwitch,
  });

  // Live run quality, measured on the frames that actually reached the model:
  // how many were analysed and how often the model found anything at all.
  const [liveStats, setLiveStats] = useState({ frames: 0, hits: 0 });
  useEffect(() => {
    if (!state.running) return;
    setLiveStats((s) => ({
      frames: s.frames + 1,
      hits: s.hits + (state.detections.length > 0 ? 1 : 0),
    }));
  }, [state.detections, state.running]);
  useEffect(() => {
    if (state.starting) setLiveStats({ frames: 0, hits: 0 });
  }, [state.starting]);
  const detectionRate = liveStats.frames ? (liveStats.hits / liveStats.frames) * 100 : 0;

  // A model that fails its check is a dead end on this device: offer the retry
  // and the alternative model right where the failure is shown.
  const alternativeModel = useMemo(
    () => models.find((m) => m.id !== modelId) ?? null,
    [models, modelId],
  );



  return (
    <div className="space-y-6">
      {/* Model-first control strip stays visible on phones and desktops. */}
      <div className="sticky top-0 z-30 -mx-4 border-b border-border/60 bg-background/80 px-4 py-2 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <Select
            value={selected?.id ?? ""}
            onValueChange={selectModel}
            disabled={state.running || state.starting}
          >
            <SelectTrigger className="h-9 min-w-0" aria-label="Detection model">
              <SelectValue placeholder="Choose model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.modelName} · {model.imgsz}px
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ModelDownloadButton
            model={selected ?? null}
            className="shrink-0"
            onDone={() => setOfflineReady(true)}
          />
        </div>
      </div>

      <DeviceCapabilityModal />
      <ShiftControlBar />

      <OfflineModelNotice />


      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">

        <div className="min-w-[16rem] flex-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Live detection</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            On-device inference. Overlay runs decoupled from inference so the feed stays smooth.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">

          {!state.running && state.lastSessionId ? (
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/report/$sessionId" params={{ sessionId: state.lastSessionId }}>
                <FileText className="mr-2 h-4 w-4" /> Driver report
              </Link>
            </Button>
          ) : null}
          {!state.running && state.timelineSamples > 0 ? (
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => toast.success(`Exported ${exportCsv()} timeline rows to CSV`)}
            >
              <Table2 className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          ) : null}
          {state.timelineSamples > 0 ? (
            <SessionPdfButton
              className="w-full sm:w-auto"
              build={() => ({
                meta: {
                  sessionId: state.lastSessionId,
                  driverLabel,
                  source: "webcam",
                  modelName: state.modelName,
                  modelVersion: state.modelVersion,
                  engine: state.engine,
                  preset: state.presetId,
                },
                startedAt: getStartedAt(),
                timeline: getTimeline(),
                events: [...state.recentEvents].reverse(),
                quality,
                calibration: state.calibration ?? calibration,
                autoCalibrated: state.autoCalibrated,
              })}
            />
          ) : null}
          {state.running ? (
            <Button variant="destructive" className="w-full sm:w-auto" onClick={stop}>
              <Square className="mr-2 h-4 w-4" /> Stop session
            </Button>
          ) : null}
        </div>
      </div>

      {!capable ? (
        <Card
          className="flex items-start gap-3 border-warning/40 bg-warning/10 p-4 text-sm"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            This browser can't run on-device inference (WebAssembly or Web Workers unavailable). Use
            a recent Chrome, Edge, or Safari over HTTPS.
          </p>
        </Card>
      ) : null}

      {state.error ? (
        <Card
          className="flex flex-wrap items-start gap-3 border-destructive/40 bg-destructive/10 p-4 text-sm"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="min-w-0 flex-1 break-words text-foreground">{state.error}</p>
          <Button size="sm" variant="outline" onClick={start} disabled={state.starting}>
            {state.starting ? "Retrying…" : "Try again"}
          </Button>
        </Card>
      ) : null}

      {/* One-tap entry point. Everything needed to drive is on this card. */}
      {!state.running ? (
        <Card className="flex flex-col gap-3 border-primary/40 bg-primary/5 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Ready to drive</h2>
            {offlineReady === true ? (
              <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] text-safe">
                <CloudOff className="h-3 w-3" aria-hidden="true" /> works offline
              </Badge>
            ) : offlineReady === false ? (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-warning">
                not downloaded yet
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {offlineReady === true
              ? `${state.modelName || selected?.modelName || "Your model"} is saved on this device — no internet needed.`
              : "Download a model below once, then this page starts instantly every time."}
          </p>
          {verification?.status === "fail" ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>This model didn't pass the quick check</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{verification.reason}</p>
                <p className="text-xs">
                  You can still start the session, run the check again, or try another model.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void reverify()}>
                    Run check again
                  </Button>
                  <Button size="sm" variant="outline" onClick={retryWarmup}>
                    Reload model
                  </Button>
                  {alternativeModel ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => selectModel(alternativeModel.id)}
                    >
                      Use {alternativeModel.modelName}
                    </Button>
                  ) : null}
                </div>
              </AlertDescription>
            </Alert>
          ) : verification?.status === "warn" ? (
            <p className="text-xs text-warning" role="status">
              Model check: {verification.reason}
            </p>
          ) : verification?.status === "pass" ? (
            <p className="text-xs text-safe" role="status">
              Model checked on this device — {Math.round(verification.latencyMs)} ms per frame.
            </p>
          ) : warmup.status === "ready" ? (
            <p className="text-xs text-muted-foreground">Checking model…</p>
          ) : null}
          <DiagnosticsCard engine={state.engine} />
          <StartupStageTimeline />
          <WorkerDebugPanel
            onHardRetry={hardRetry}
            defaultOpen={constrained && warmup.status === "error"}
          />
          <ModelChoiceList
            models={models}
            selectedId={selected?.id ?? null}
            onSelect={selectModel}
            recommendedId={recommendedModel?.id ?? null}
            disabled={state.starting}
            blockedReason={(m) => {
              const report = compatibilityFor(m);
              return report.ok ? null : (report.errors[0]?.message ?? null);
            }}
          />
          {warmup.status === "loading" ? (
            <div className="rounded-lg border border-border/60 p-3" role="status" aria-live="polite">
              <p className="text-xs text-muted-foreground">
                Preparing {selected?.modelName ?? "model"} —{" "}
                {warmup.stage?.replace(/-/g, " ") ?? "starting"}
                {warmup.progress !== null ? ` ${Math.round(warmup.progress * 100)}%` : ""} ·{" "}
                {prepareElapsed}s
              </p>
              {prepareElapsed > 20 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={retryWarmup}>
                    Cancel and retry
                  </Button>
                  {enginePreference !== "wasm" ? (
                    <Button size="sm" variant="outline" onClick={useCpuMode}>
                      Try CPU mode
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {warmup.status === "error" ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>This model couldn't start on your device</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{warmup.error}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={hardRetry}>
                    Try again
                  </Button>
                  {enginePreference !== "wasm" ? (
                    <Button size="sm" variant="outline" onClick={useCpuMode}>
                      Try CPU mode
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={useSafeMode}>
                    Safe mode (lightest model, CPU)
                  </Button>
                  {recommendedModel && recommendedModel.id !== selected?.id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => selectModel(recommendedModel.id)}
                    >
                      Use {recommendedModel.modelName}
                    </Button>
                  ) : null}
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          <Button
            size="lg"
            className="h-14 w-full text-base"
            onClick={startNow}
            disabled={state.starting || !capable || !compatibility.ok || warmup.status !== "ready"}
          >
            <Play className="mr-2 h-5 w-5" aria-hidden="true" />
            {state.starting
              ? "Starting…"
              : warmup.status !== "ready" && compatibility.ok
                ? "Preparing model…"
                : "Start live detection"}
          </Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={autoStart}
              onCheckedChange={(next) => {
                setAutoStart(next);
                writeAutoStartPreference(next);
                if (!next) autoStartedRef.current = true;
              }}
              aria-label="Start automatically when the model is ready"
            />
            Start automatically when a downloaded model is ready
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={autoSwitch}
              onCheckedChange={(next) => {
                setAutoSwitch(next);
                writeAutoSwitchPreference(next);
              }}
              aria-label="Allow automatic model switching"
            />
            Let the app switch to a lighter model on its own
          </label>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr] lg:gap-6">
        <Card className="relative overflow-hidden border-border/60 bg-background">
          <div
            className="relative mx-auto w-full max-h-[75vh]"
            style={{
              // Match the real stream shape so nothing is cropped: what you see
              // is the phone camera's own picture, not a zoomed centre cut.
              aspectRatio:
                streamAspect ??
                (constrained
                  ? orientation === "landscape" ||
                    (orientation === "auto" && !devicePortrait)
                    ? 16 / 9
                    : 3 / 4
                  : 16 / 9),
            }}
          >
            <video
              ref={(el) => {
                videoRef.current = el!;
                setVideoEl(el);
              }}
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                if (el.videoWidth > 0 && el.videoHeight > 0)
                  setStreamAspect(el.videoWidth / el.videoHeight);
              }}
              className={`h-full w-full object-contain${mirrored ? " -scale-x-100" : ""}`}
              playsInline
              muted
            />
            <DetectionOverlay
              detectionsRef={detectionsRef}
              video={videoEl}
              mirrored={mirrored}
              highContrast={highContrast}
            />
            <button
              type="button"
              onClick={() => setHighContrast(!highContrast)}
              aria-pressed={highContrast}
              className="absolute right-2 top-2 flex min-h-11 items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-3 text-[11px] font-medium backdrop-blur"
            >
              <Contrast className="h-4 w-4" aria-hidden="true" />
              {highContrast ? "High contrast on" : "High contrast"}
            </button>
            <QualityCuesOverlay assessment={quality} visible={state.running} />
            {!state.running ? (
              <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-muted-foreground">
                {state.starting ? "Requesting camera…" : "Camera ready"}
              </div>
            ) : null}
          </div>
          {state.running ? (
            <div className="grid grid-cols-2 gap-px border-t border-border/60 bg-border/40 sm:grid-cols-4">
              {[
                ["inference", `${Math.round(state.inferMs || state.latencyMs)} ms`],
                ["fps", `${state.processedFps}/${state.cameraFps}`],
                ["frames", `${liveStats.frames}`],
                ["detection rate", `${detectionRate.toFixed(0)}%`],
              ].map(([label, value]) => (
                <div key={label} className="bg-card/80 px-3 py-2">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {label}
                  </div>
                  <div className="font-mono text-sm text-foreground">{value}</div>
                </div>
              ))}
            </div>
          ) : null}
        </Card>


        <div className="space-y-4">
          {downgrade.notice ? (
            <Alert>
              <TrendingDown className="h-4 w-4" />
              <AlertTitle>Switched to a lighter model</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{downgrade.notice.from} was too slow for reliable live detection. Now running {downgrade.notice.to}.</p>
                <Button size="sm" variant="outline" onClick={downgrade.dismiss}>Dismiss</Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {quality ? <QualityGate assessment={quality} /> : null}
          <RiskPanel state={state} />
        </div>
      </div>

      {!state.running ? <LastSessionExport refreshKey={state.lastSessionId} /> : null}


      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full justify-between">
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Advanced settings
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4 space-y-4">
          <ModelManager disabled={state.running || state.starting} />
          <Card className="border-border/60 bg-card/60 p-4">
            <ModelSelector disabled={state.running || state.starting} />
          </Card>

          {!state.running ? <ModelCompatibilityPanel /> : null}
          {!state.running && !state.starting ? <QuickTestPanel /> : null}
          {!state.running && !state.starting ? <DeviceModelReport /> : null}
          {!state.running && !state.starting ? <LiveBenchmarkPanel /> : null}

          <AutoFallbackControl
            state={state}
            disabled={state.running || state.starting}
            onSwitch={handleFallbackSwitch}
          />

          <DriverPicker disabled={state.running || state.starting} />

          {!state.running && !state.starting ? (
            <Button variant="outline" className="w-full" onClick={() => setCalibrating(true)} disabled={calibrating}>
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              {calibration ? "Re-calibrate manually" : "Manual calibration"}
            </Button>
          ) : null}

          <Card className="flex flex-wrap items-center gap-3 border-border/60 bg-card/60 p-4">
            <Moon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Low-light capture</div>
              <p className="text-xs text-muted-foreground">
                Raises sensor exposure and gain where the device allows it, then boosts the
                preprocessing pipeline for dark cabins.
              </p>
            </div>
            <Switch
              checked={lowLight}
              disabled={state.running || state.starting}
              onCheckedChange={(next) => {
                setLowLight(next);
                writeLowLightPreference(next);
              }}
              aria-label="Toggle low-light capture mode"
            />
          </Card>

          <Card className="space-y-3 border-border/60 bg-card/60 p-4">
            <div className="flex items-center gap-2">
              <RotateCw className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="text-sm font-medium">Camera orientation</div>
            </div>
            <p className="text-xs text-muted-foreground">
              Remembered on this device and applied every time you open the live page. "Follow
              device" uses your phone's current rotation.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["auto", "Follow device"],
                  ["portrait", "Portrait"],
                  ["landscape", "Landscape"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={orientation === value ? "default" : "outline"}
                  disabled={state.running || state.starting}
                  onClick={() => {
                    setOrientation(value);
                    writeOrientationPreference(value);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </Card>

        </CollapsibleContent>
      </Collapsible>

      {calibration ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11px] text-muted-foreground">
            Calibrated {new Date(calibration.createdAt).toLocaleString()} · closure threshold{" "}
            {calibration.eyeClosedMsThreshold} ms · confidence floor{" "}
            {(calibration.displayConfThreshold * 100).toFixed(0)}%
            {calibration.partial ? " · partial, re-run for a better fit" : ""}
          </p>
          {calSync.signedIn ? (
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Switch
                checked={calSync.enabled}
                onCheckedChange={(v) => void calSync.setSyncEnabled(v)}
                aria-label="Sync calibration to my account"
              />
              Sync calibration &amp; history to my account
              {calSync.status === "error" ? (
                <span className="text-destructive">sync failed</span>
              ) : null}
            </label>
          ) : null}
        </div>
      ) : null}

      {calibrating && !state.running ? (
        <CalibrationWizard
          modelId={modelId}
          onDone={(profile) => {
            setCalibration(profile);
            setCalibrating(false);
            // Push straight away so the next device starts already tuned.
            void calSync.push(profile);
          }}
          onCancel={() => setCalibrating(false)}
        />
      ) : null}

      <div className="space-y-4">
          {state.running || state.benchmarkMs != null ? <EngineStrip state={state} /> : null}
          {state.running ? <PerfMetricsBar state={state} /> : null}
          <YawnPanel episodes={state.yawnEpisodes} probe={state.yawnProbe} />
          <ProviderStatus state={state} />

          {state.running || state.processedFps > 0 ? (
            <TelemetryPanel state={state} getProfile={getProfile} />
          ) : null}

          <DebugOverlay
            state={state}
            buildDiagnostics={buildDiagnostics}
            buildBundle={buildBundle}
            getProfile={getProfile}
            exportCsv={exportCsv}
          />
      </div>

      {!state.running && replay.length > 0 ? (
        <ReplayScrubber
          frames={replay}
          onSeekDetections={(dets) => {
            detectionsRef.current = dets;
          }}
        />
      ) : null}

      {state.recentEvents.length > 0 ? (
        <Card className="border-border/60 bg-card/60 p-5">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Recent events
          </div>
          <ul className="space-y-1 font-mono text-xs">
            {state.recentEvents.slice(0, 8).map((e, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</span>
                <span className="text-foreground">{e.kind}</span>
                <span className="ml-auto text-muted-foreground">
                  {(e.confidence * 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
