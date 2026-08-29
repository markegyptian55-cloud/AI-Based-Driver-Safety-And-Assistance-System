// Generic detection-session hook: binds a FrameSource + inference provider +
// event aggregator + session recorder into one lifecycle. Works for webcam,
// uploaded video, or any future frame source — no source-specific code here.
// UI components consume this hook only; no AI logic in JSX.

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { toast } from "sonner";

import { type ProviderId } from "../inference/registry";
import { acquireProvider, isWarm, releaseProvider } from "../inference/provider-cache";
import { readEnginePreference, isConstrainedDevice } from "../inference/engine-preference";
import {
  readPresetPreference,
  selectPreset,
  type InferencePreset,
  type PresetId,
} from "../inference/mobile-presets";
import { createDetectionTracker, type TrackerStats } from "../inference/detection-tracker";
import { liveProviderConfig } from "../inference/live-config";
import {
  readCalibration,
  applyCalibrationToPreset,
  type CalibrationProfile,
} from "./calibration";
import { createAutoCalibrator, type AutoCalibrator } from "./auto-calibrate";
import type { SessionPipelineTrace } from "./pipeline-trace";
import { createReplayBuffer, type ReplayBuffer, type ReplayFrame } from "./replay-buffer";
import { readLowLightPreference } from "./low-light";
import {
  buildSessionCsv,
  csvFilename,
  downloadCsv,
  type TimelineSample,
} from "./session-csv";
import {
  createDiagnosticsLog,
  type DiagnosticsBundle,
  type DiagnosticsLog,
} from "./diagnostics-log";
import type {
  Detection,
  InferenceProvider,
  InferenceResult,
  YawnProbeFrame,
} from "../inference/types";
import { loadModelMetadata } from "../drowsiness/labels";
import { EventAggregator } from "../drowsiness/event-aggregator";
import type {
  ClosureStats,
  RiskLevel,
  ScoringConfig,
  SemanticEvent,
  YawnEpisode,
} from "../drowsiness/types";

import { playAlarm, stopAlarm, unlockAlarm } from "../drowsiness/alarm";
import type { FrameSource } from "./frame-source";
import type { SessionSource } from "./session-source";
import { SessionRecorder, type SessionSnapshot } from "./session-recorder";
import type { SessionSummary } from "./session-stats";
import { createSupabaseSessionPort } from "./supabase-session-port";
import { createGuestSessionPort } from "./guest-session-port";
import { useAuth } from "@/hooks/use-auth";
import { formatError, IS_DEV } from "@/lib/format-error";
import { createCaptureProfiler, type CaptureProfileStats } from "./capture-profiler";
import { telemetryFromProfile } from "./telemetry";
import { saveLastSession } from "./last-session";
import { buildFullBundle, type FullDiagnosticsBundle } from "./diagnostics-bundle";
import { readRemoteBaseUrl } from "../inference/remote-endpoint";
import { HybridAutoProvider } from "../inference/hybrid-router";
import { inspectDetections, selectPlausibleFaceFeatures } from "../inference/postprocess";

export interface LiveSessionSettings {
  providerId: ProviderId;
  /** Selected model from the registry; null = best active model. */
  modelId?: string | null;
  confThreshold: number;
  iouThreshold: number;
  scoring: ScoringConfig;
}

export interface LiveSessionState {
  running: boolean;
  starting: boolean;
  error: string | null;
  errorStack: string | null;
  stage: string;
  stageDetail: Record<string, unknown> | null;
  detections: Detection[];
  risk: RiskLevel;
  perclos: number;
  yawnRate: number;
  cameraFps: number;
  processedFps: number;
  inferenceFps: number;
  /** Current source-side adaptive submission budget. */
  targetInferenceFps: number;
  latencyMs: number;
  /** Model-only inference time on the last frame (ms). */
  inferMs: number;
  /** Preprocessing time on the last frame (ms). */
  preprocessMs: number;
  /** Postprocessing/decode time on the last frame (ms). */
  postprocessMs: number;
  engine: string;
  /** Median session.run() cost measured on this device right after warm-up. */
  benchmarkMs: number | null;
  /** Whether frames are prepared on the GPU (zero-copy) or on the CPU. */
  preprocess: "gpu" | "cpu" | null;
  modelName: string;
  modelVersion: string;
  snapshot: SessionSnapshot | null;
  recentEvents: SemanticEvent[];
  /** Id of the most recently completed session — links to its driver report. */
  lastSessionId: string | null;
  /** Computed summary of the most recently completed session. */
  lastSummary: SessionSummary | null;
  /** Live eye-closure / microsleep counters. */
  closure: ClosureStats;
  /** Every mouth-open spell this run, confirmed or rejected, with reasons. */
  yawnEpisodes: YawnEpisode[];
  /** Last frame's class-2 pipeline probe (raw score → threshold → NMS). */
  yawnProbe: YawnProbeFrame | null;

  /** True while the driver's eyes are closed past the microsleep threshold. */
  microsleepActive: boolean;
  /** Frames discarded because the backend returned implausible output. */
  rejectedFrames: number;
  /** Frames delivered by the source but skipped because inference was busy. */
  droppedFrames: number;
  /** Median end-to-end capture→result latency over the last ~5s (ms). */
  latencyP50Ms: number;
  /** 95th percentile end-to-end capture→result latency over the last ~5s (ms). */
  latencyP95Ms: number;
  /** Captured frames waiting for a free pipeline slot right now. */
  queuedFrames: number;
  /** Frames currently inside the pipeline (submitted, awaiting a result). */
  inFlightFrames: number;
  /** How many frames the source may keep in flight. */
  pipelineDepth: number;
  /** Share of source frames intentionally not analysed (0..1). */
  dropRate: number;
  /** Height the source is currently capturing at (adaptive, never below model input). */
  captureHeight: number;
  /** Active inference preset. */
  presetId: PresetId;
  /** Mean scene luma (0..1) of the last analysed frame. */
  luma: number;
  /** Auto-gain multiplier applied to the last analysed frame. */
  gain: number;
  /** Tracker bookkeeping for the debug overlay. */
  tracker: TrackerStats;
  /** Highest confidence per semantic class on the last analysed frame. */
  topConfidence: Record<string, number>;
  /** Calibration profile applied to this run, if the driver calibrated. */
  calibration: CalibrationProfile | null;
  /** Low-light capture mode requested for this run. */
  lowLight: boolean;
  /** Number of frames captured in the exportable confidence timeline. */
  timelineSamples: number;
  /** True once thresholds were derived automatically from this clip/run. */
  autoCalibrated: boolean;
  /** Frames retained for replay scrubbing. */
  replayFrames: number;
}

export interface FrameSourceContext {
  onFrame: (bitmap: ImageBitmap, ts: number) => Promise<void>;
  onEnded: () => void;
  onError: (err: Error) => void;
}

export type FrameSourceFactory = (ctx: FrameSourceContext) => FrameSource;

export interface UseDetectionSessionArgs {
  settings: LiveSessionSettings;
  source: SessionSource;
  createSource: FrameSourceFactory;
  /** Extra device_info persisted with the session (e.g. video filename). */
  deviceInfo?: Record<string, unknown>;
  /** Who is behind the wheel; stored on the session for reports and history. */
  driver?: { id: string | null; label: string } | null;
  /**
   * Externally-owned detections ref. When provided, the hook writes overlay
   * state into it instead of a local ref, so the overlay survives the
   * component (and the media element) being unmounted and remounted.
   */
  detectionsRef?: MutableRefObject<Detection[]>;
  /** Frame counter shared with the owner of the analysis session. */
  frameIndexRef?: MutableRefObject<number>;
  /**
   * Derives a calibration profile from the first seconds of the run itself.
   * Used for uploaded clips, where nobody can perform the interactive wizard,
   * so results stay comparable across devices and lighting.
   */
  autoCalibrate?: boolean;
  /** Position inside the source media (ms), recorded on each replay frame. */
  mediaTime?: () => number | null;
  /**
   * Performance trace for this run (stage timings, video conversion path,
   * model cache hit/miss). Read at stop() so it captures the final numbers.
   */
  pipelineTrace?: () => SessionPipelineTrace | null;
}

export function useDetectionSession({
  settings,
  source,
  createSource,
  deviceInfo,
  driver,
  detectionsRef: externalDetectionsRef,
  frameIndexRef: externalFrameIndexRef,
  autoCalibrate = false,
  mediaTime,
  pipelineTrace,
}: UseDetectionSessionArgs) {
  const { user } = useAuth();
  const [state, setState] = useState<LiveSessionState>(() => initialState());
  const localDetectionsRef = useRef<Detection[]>([]);
  const localFrameIndexRef = useRef(0);
  const detectionsRef = externalDetectionsRef ?? localDetectionsRef;
  const frameIndexRef = externalFrameIndexRef ?? localFrameIndexRef;
  const providerRef = useRef<InferenceProvider | null>(null);
  const aggregatorRef = useRef<EventAggregator | null>(null);
  const recorderRef = useRef<SessionRecorder | null>(null);
  const sourceRef = useRef<FrameSource | null>(null);
  const runningRef = useRef(false);
  // Set synchronously at the top of start(): guarantees that a second call
  // (double click, effect re-fire, resume-on-return) can never build a second
  // provider, recorder or frame source while the first start() is in flight.
  const startingRef = useRef(false);
  const trackerRef = useRef<ReturnType<typeof createDetectionTracker> | null>(null);
  const presetRef = useRef<InferencePreset | null>(null);
  const diagnosticsRef = useRef<DiagnosticsLog>(createDiagnosticsLog());
  // Exportable per-frame timeline (bounded — an hour at 10 fps is 36k rows).
  const timelineRef = useRef<TimelineSample[]>([]);
  const startedAtRef = useRef<number>(Date.now());
  // Latest quality score, reported by the quality monitor in the UI layer.
  const qualityRef = useRef<number>(100);
  // Per-frame timing/quality trace: the evidence behind "it's slow on Android".
  const profilerRef = useRef(createCaptureProfiler());
  // Auto-calibration (uploaded clips) and the replay scrub buffer.
  const autoCalRef = useRef<AutoCalibrator | null>(null);
  const replayRef = useRef<ReplayBuffer>(createReplayBuffer());
  const mediaTimeRef = useRef(mediaTime);
  mediaTimeRef.current = mediaTime;
  const pipelineTraceRef = useRef(pipelineTrace);
  pipelineTraceRef.current = pipelineTrace;

  const stateRef = useRef(state);
  stateRef.current = state;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const driverRef = useRef(driver ?? null);
  driverRef.current = driver ?? null;

  const stop = useCallback(async () => {
    if (!runningRef.current && !providerRef.current) {
      return;
    }
    runningRef.current = false;
    stopAlarm();
    sourceRef.current?.stop();
    let completedId: string | null = null;
    let completedSummary: SessionSummary | null = null;
    const profile = profilerRef.current.stats();
    const telemetry = telemetryFromProfile(profile, profilerRef.current.samples());
    try {
      const src = sourceRef.current;
      const recorder = recorderRef.current;
      if (recorder && src?.totalFrames) recorder.setTotalFrames(src.totalFrames());
      recorder?.setTelemetry(telemetry);
      recorder?.setPipelineTrace(pipelineTraceRef.current?.() ?? null);
      const done = await recorder?.end();
      completedId = done?.id ?? null;
      completedSummary = recorder?.getSummary() ?? null;
    } catch (err) {
      console.error(err);
    }
    // Snapshot the run so it can still be exported after leaving the page.
    try {
      const st = stateRef.current;
      saveLastSession({
        version: 1,
        startedAt: startedAtRef.current,
        endedAt: Date.now(),
        durationSec: Math.round((Date.now() - startedAtRef.current) / 1000),
        meta: {
          sessionId: completedId,
          driverLabel: driverRef.current?.label ?? "Driver",
          source,
          modelName: st.modelName,
          modelVersion: st.modelVersion,
          engine: st.engine,
          preset: st.presetId,
        },
        telemetry,
        counts: {
          frames: profile.frames,
          microsleeps: st.closure.microsleeps ?? 0,
          yawns: completedSummary?.yawnFrames ?? 0,
          alerts: completedSummary?.totalAlerts ?? st.recentEvents.length,
        },
        events: [...st.recentEvents].reverse(),
        timeline: timelineRef.current,
      });
    } catch (err) {
      console.error(err);
    }
    // Keep the model warm in the cache; only the session is torn down.
    releaseProvider(providerRef.current);
    trackerRef.current?.reset();
    detectionsRef.current = [];
    providerRef.current = null;
    aggregatorRef.current = null;
    recorderRef.current = null;
    sourceRef.current = null;
    setState((s) => ({
      ...s,
      running: false,
      starting: false,
      detections: [],
      lastSessionId: completedId ?? s.lastSessionId,
      lastSummary: completedSummary ?? s.lastSummary,
    }));
  }, [detectionsRef, source]);

  const setStage = useCallback((stage: string, detail?: Record<string, unknown>) => {
    console.info("[pipeline] stage=%s", stage, detail ?? "");
    diagnosticsRef.current.add(`stage:${stage}`, detail);
    setState((s) => ({ ...s, stage, stageDetail: detail ?? null }));
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current || startingRef.current) return;
    startingRef.current = true;
    // start() is always behind a user gesture — unlock audio for the alarm.
    unlockAlarm();

    console.info("[pipeline] start() invoked, source=%s", source);
    setState((s) => ({
      ...s,
      starting: true,
      error: null,
      errorStack: null,
      stage: "starting",
      stageDetail: null,
    }));
    try {
      diagnosticsRef.current.clear();
      profilerRef.current = createCaptureProfiler();
      const constrained =
        typeof navigator !== "undefined" && isConstrainedDevice(navigator as never);
      const calibration = readCalibration();
      const lowLight = readLowLightPreference();
      const base = selectPreset(readPresetPreference(), constrained);
      // Calibration first (driver-specific), then low-light capture (scene-specific).
      const calibrated = applyCalibrationToPreset(base, calibration);
      const preset: InferencePreset = lowLight
        ? {
            ...calibrated,
            autoGain: true,
            autoGainTargetLuma: Math.max(calibrated.autoGainTargetLuma, 0.42),
          }
        : calibrated;
      presetRef.current = preset;
      timelineRef.current = [];
      replayRef.current.clear();
      // A stored profile always wins; auto-calibration only fills the gap when
      // the driver never ran the wizard (typical for an uploaded clip).
      autoCalRef.current = autoCalibrate && !calibration ? createAutoCalibrator() : null;
      startedAtRef.current = Date.now();
      const tracker = createDetectionTracker({
        ...preset.tracker,
        // Mouth-only relaxations: a yawn box is rarer and weaker than an eye
        // box, so it must not be held to the eye track's evidence bar.
        mouthIntakeConfThreshold: Math.min(0.15, preset.tracker.intakeConfThreshold),
        mouthDisplayConfThreshold: Math.min(0.3, preset.tracker.displayConfThreshold),
        mouthMinHits: 1,
      });
      trackerRef.current = tracker;

      diagnosticsRef.current.setMeta({ source, preset: preset.id });
      setStage("preset-selected", {
        preset: preset.id,
        constrainedDevice: constrained,
        confThreshold: preset.confThreshold,
        autoGain: preset.autoGain,
        lowLightCapture: lowLight,
        calibrated: Boolean(calibration),
        autoCalibrating: Boolean(autoCalRef.current),
        eyeClosedMsThreshold: preset.scoring.eyeClosedMsThreshold,
      });
      setState((s) => ({
        ...s,
        presetId: preset.id,
        calibration,
        lowLight,
        autoCalibrated: false,
        replayFrames: 0,
      }));

      setStage("loading-model-metadata");
      const meta = await loadModelMetadata(settingsRef.current.modelId ?? null);
      setStage("model-metadata-loaded", {
        modelName: meta.modelName,
        version: meta.version,
        imgsz: meta.imgsz,
      });

      setStage("acquiring-provider", {
        providerId: settingsRef.current.providerId,
        modelId: meta.id,
        warm: isWarm(settingsRef.current.providerId, meta.id),
      });
      const provider = await acquireProvider(
        settingsRef.current.providerId,
        // Shared with quick test and the pre-start warm-up so a measured run
        // and a real run preprocess frames identically.
        liveProviderConfig(meta, preset),
        { onStage: (s, d) => setStage(s, d) },
      );
      providerRef.current = provider;
      if (provider instanceof HybridAutoProvider) {
        diagnosticsRef.current.add("hybrid-router-armed", {
          remote: readRemoteBaseUrl() ? "configured" : "none",
        });
      }
      diagnosticsRef.current.setMeta({
        provider: provider.id,
        engine: provider.status().engine,
        modelName: meta.modelName,
        modelVersion: meta.version,
      });
      {
        const st = provider.status();
        setStage("provider-ready", {
          engine: st.engine,
          benchmarkMs: st.benchmarkMs,
          preprocess: st.preprocess,
        });
        setState((s) => ({
          ...s,
          engine: st.engine,
          benchmarkMs: st.benchmarkMs ?? null,
          preprocess: st.preprocess ?? null,
        }));
      }

      setStage("starting-recorder");
      // Visitors (no account) run the identical pipeline against an in-memory
      // port — nothing is persisted, everything else behaves the same.
      const recorder = new SessionRecorder(
        user ? createSupabaseSessionPort(user.id) : createGuestSessionPort(),
      );
      await recorder.start({
        provider: provider.id,
        engineKind: provider.status().engine,
        modelId: meta.id,
        driverId: driverRef.current?.id ?? null,
        driverLabel:
          driverRef.current?.label ??
          (user
            ? ((user.user_metadata?.["display_name"] as string | undefined) ??
              user.email ??
              `Driver-${user.id.slice(0, 8)}`)
            : "Visitor"),
        modelName: meta.modelName,
        modelVersion: meta.version,
        source,
        deviceInfo,
      });
      recorderRef.current = recorder;
      diagnosticsRef.current.setMeta({ sessionId: recorder.getSnapshot()?.id ?? null });
      setStage("recorder-started");

      const aggregator = new EventAggregator({
        cfg: { ...settingsRef.current.scoring, ...presetScoring(preset, settingsRef.current) },
        emit: (event) => {
          recorder.onEvent(event);
          diagnosticsRef.current.add(
            `event:${event.kind}`,
            { risk: event.riskLevel, confidence: event.confidence, ...(event.metadata ?? {}) },
            event.kind === "critical_microsleep" ? "warn" : "info",
          );
          if (event.kind === "critical_microsleep") playAlarm("critical");
          else if (event.kind === "microsleep") playAlarm("microsleep");
          else if (event.kind === "drowsy_yawn") playAlarm("microsleep");
          setState((s) => ({
            ...s,
            recentEvents: [event, ...s.recentEvents].slice(0, 200),
            risk: event.riskLevel,
          }));
        },
        now: () => Date.now(),
      });
      aggregatorRef.current = aggregator;

      let firstFrameLogged = false;
      let firstResultLogged = false;
      // The overlay reads detectionsRef directly, so React does not need a full
      // Live-page render for every inference result. On Android that render was
      // on the critical path before the camera could drain its next frame.
      // Keep safety/event processing frame-accurate while refreshing visual
      // counters at 5 Hz.
      let lastUiUpdateAt = 0;
      // Rolling end-to-end latency window (capture timestamp → result applied).
      // Percentiles beat the instantaneous number here: a single slow frame is
      // normal, a shifted p95 is the thing that makes a run feel laggy.
      const latencyWindow: Array<{ at: number; ms: number }> = [];
      const percentile = (p: number) => {
        if (!latencyWindow.length) return 0;
        const sorted = latencyWindow.map((e) => e.ms).sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
        return Math.round(sorted[idx]!);
      };
      let lastFrameDiagnosticAt = 0;

      setStage("creating-frame-source");
      const src = createSource({
        onFrame: async (bitmap, ts) => {
          if (!runningRef.current) {
            bitmap.close();
            return;
          }
          if (!firstFrameLogged) {
            firstFrameLogged = true;
            setStage("first-frame-received", { ts });
          }
          try {
            const result: InferenceResult = await provider.infer(bitmap, ts);
            if (!runningRef.current) return;
            if (!firstResultLogged) {
              firstResultLogged = true;
              setStage("first-inference-complete", {
                latencyMs: result.latencyMs,
                detections: result.detections.length,
              });
            }
            // Temporal smoothing: the aggregator and the overlay both consume
            // tracked detections, so a single dropped frame on a slow phone can
            // no longer flip an eye from closed to open.
            const health = inspectDetections(result.detections, 12);
            if (health.degenerate) {
              tracker.reset();
              detectionsRef.current = [];
              diagnosticsRef.current.add("rejected-detection-flood", {
                reason: health.reason,
                count: result.detections.length,
              }, "warn");
              setState((s) => ({
                ...s,
                detections: [],
                rejectedFrames: s.rejectedFrames + 1,
                tracker: tracker.stats(),
              }));
              return;
            }
            const plausible = selectPlausibleFaceFeatures(result.detections);
            const stable = tracker.update(plausible, result.ts);
            detectionsRef.current = stable;
            frameIndexRef.current += 1;
            recorder.onResult(result);
            const frameSummary = aggregator.ingest(result.ts, stable);
            recorder.onFrameSummary(frameSummary);
            if (src.totalFrames) recorder.setTotalFrames(src.totalFrames());
            recorder.updatePerclos(aggregator.perclosRatio());
            const status = provider.status();
            const closure = aggregator.closureStats();
            const microsleepActive = aggregator.isMicrosleepActive();
            if (!microsleepActive && !aggregator.isDrowsyYawnActive()) stopAlarm();
            const analysed = src.analysedFrames?.() ?? frameIndexRef.current;
            const delivered = src.totalFrames?.() ?? analysed;
            const sample: TimelineSample = {
              ts: result.ts,
              t: Math.max(0, result.ts - startedAtRef.current),
              eyeOpenConf: topConfidenceOf(stable)["eye_open"] ?? 0,
              eyeClosedConf: topConfidenceOf(stable)["eye_closed"] ?? 0,
              yawnConf: frameSummary.topYawnConf ?? 0,
              perclos: aggregator.perclosRatio(),
              closureMs: closure.currentClosureMs,
              microsleepActive,
              risk: aggregator.currentRisk(),
              luma: result.meta.luma ?? 0,
              gain: result.meta.gain ?? 1,
              qualityScore: qualityRef.current,
              latencyMs: result.latencyMs,
              tracks: stable.length,
            };
            timelineRef.current.push(sample);
            // Trim in chunks instead of shifting the full array every frame
            // once a long video reaches the cap.
            if (timelineRef.current.length > 42000) timelineRef.current.splice(0, 2000);

            // Replay record: what the model actually saw at this instant.
            const eyes = stable.filter((d) => d.semantic.startsWith("eye"));
            const eyesClosed = eyes.length > 0 && eyes.every((d) => d.semantic === "eye_closed");
            const replayFrame: ReplayFrame = {
              t: sample.t,
              mediaMs: mediaTimeRef.current?.() ?? undefined,
              detections: stable,
              risk: aggregator.currentRisk(),
              riskScore: aggregator.perclosRatio(),
              perclos: sample.perclos,
              closureMs: closure.currentClosureMs,
              eyesClosed,
              yawning: (frameSummary.topYawnConf ?? 0) > 0,
            };
            replayRef.current.push(replayFrame);

            // Auto-calibration: derive this clip's own thresholds, then retune
            // the live tracker and scoring without restarting the run.
            const cal = autoCalRef.current;
            if (cal) {
              const profile = cal.ingest(result.ts, stable, result.meta.luma ?? 0);
              if (profile) {
                autoCalRef.current = null;
                const base = presetRef.current;
                if (base) {
                  const tuned = applyCalibrationToPreset(base, profile);
                  presetRef.current = tuned;
                  tracker.configure(tuned.tracker);
                  aggregator.updateConfig({
                    ...settingsRef.current.scoring,
                    ...presetScoring(tuned, settingsRef.current),
                  });
                }
                diagnosticsRef.current.add("auto-calibrated", {
                  eyeClosedMsThreshold: profile.eyeClosedMsThreshold,
                  displayConfThreshold: profile.displayConfThreshold,
                  yawnConfirmMs: profile.yawnConfirmMs,
                  frames: profile.frames,
                  partial: profile.partial,
                });
                setState((s) => ({ ...s, calibration: profile, autoCalibrated: true }));
              }
            }
            profilerRef.current.record({
              captureToResultMs: Math.max(0, Date.now() - result.ts),
              preprocessMs: result.meta.preprocessMs ?? 0,
              inferMs: result.meta.inferMs ?? result.meta.providerLatencyMs,
              postprocessMs: result.meta.postprocessMs ?? 0,
              transportMs: result.meta.transportMs ?? 0,
              dropped: Math.max(0, delivered - analysed),
              sourceFps: src.sourceFps(),
              analysedFps: src.processedFps(),
              luma: result.meta.luma ?? 0,
              gain: result.meta.gain ?? 1,
              route: result.meta.route ?? "on-device",
              quality: qualityRef.current,
            });
            // The router reads tracking confidence as a health signal: boxes
            // the tracker can no longer hold together mean the phone is behind.
            if (provider instanceof HybridAutoProvider) {
              provider.observeTracking(
                stable.length
                  ? stable.reduce((a, d) => a + d.confidence, 0) / stable.length
                  : 0,
              );
            }
            const uiNow = performance.now();
            latencyWindow.push({ at: uiNow, ms: result.latencyMs });
            while (latencyWindow.length && latencyWindow[0]!.at < uiNow - 5000) {
              latencyWindow.shift();
            }
            // Diagnostics are observability, not safety logic. One aggregate
            // sample per second is enough to diagnose a run and avoids JSON
            // object churn on every frame of a long uploaded clip.
            if (uiNow - lastFrameDiagnosticAt >= 1000) {
              lastFrameDiagnosticAt = uiNow;
              diagnosticsRef.current.add("frame", {
                latencyMs: Math.round(result.latencyMs),
                detections: stable.length,
                raw: result.detections.length,
                luma: round3(result.meta.luma),
                gain: round3(result.meta.gain),
                sourceFps: src.sourceFps(),
                analysedFps: src.processedFps(),
                targetInferenceFps: src.targetInferenceFps?.() ?? null,
                degenerate: result.meta.degenerate ?? false,
              });
            }
            if (uiNow - lastUiUpdateAt >= 200) {
              lastUiUpdateAt = uiNow;
              setState((s) => ({
                ...s,
                detections: stable,
                closure,
                yawnEpisodes: aggregator.yawnEpisodes(),
                yawnProbe: result.meta.yawnProbe ?? s.yawnProbe,

                microsleepActive,
                perclos: aggregator.perclosRatio(),
                yawnRate: aggregator.yawnRatePerMin(),
                risk: aggregator.currentRisk(),
                latencyMs: result.latencyMs,
                inferMs: result.meta.inferMs ?? result.meta.providerLatencyMs,
                preprocessMs: result.meta.preprocessMs ?? 0,
                postprocessMs: result.meta.postprocessMs ?? 0,
                inferenceFps: status.fps,
                targetInferenceFps: src.targetInferenceFps?.() ?? src.processedFps(),
                engine: result.meta.engine,
                modelName: result.meta.modelName,
                modelVersion: result.meta.modelVersion,
                rejectedFrames: result.meta.rejectedFrames ?? s.rejectedFrames,
                droppedFrames: Math.max(0, delivered - analysed),
                latencyP50Ms: percentile(0.5),
                latencyP95Ms: percentile(0.95),
                queuedFrames: src.queuedFrames?.() ?? 0,
                inFlightFrames: src.inFlightFrames?.() ?? 0,
                pipelineDepth: src.pipelineDepth?.() ?? 1,
                dropRate:
                  src.dropRate?.() ??
                  (delivered > 0 ? Math.max(0, (delivered - analysed) / delivered) : 0),
                captureHeight: src.captureHeight?.() ?? 0,
                luma: result.meta.luma ?? s.luma,
                gain: result.meta.gain ?? s.gain,
                tracker: tracker.stats(),
                topConfidence: topConfidenceOf(stable),
                timelineSamples: timelineRef.current.length,
                replayFrames: replayRef.current.frames().length,
                cameraFps: src.sourceFps(),
                processedFps: src.processedFps(),
                snapshot: recorder.getSnapshot(),
              }));
            }
          } catch (err) {
            if (runningRef.current) console.error("[pipeline] infer error", err);
          }
        },
        onEnded: () => {
          setStage("source-ended");
          void stop();
        },
        onError: (err) => {
          const f = formatError(err);
          console.error("[pipeline] source error", err, f);
          setState((s) => ({
            ...s,
            error: f.message,
            errorStack: IS_DEV ? (f.stack ?? null) : null,
            stage: "error",
            starting: false,
          }));
          toast.error(f.message);
          void stop();
        },
      });

      sourceRef.current = src;
      runningRef.current = true;
      setStage("starting-source");
      await src.start();
      setStage("running");
      setState((s) => ({ ...s, running: true, starting: false, snapshot: recorder.getSnapshot() }));
    } catch (err) {
      const f = formatError(err);
      console.error("[pipeline] start error", err, f);
      setState((s) => ({
        ...s,
        starting: false,
        running: false,
        error: f.message,
        errorStack: IS_DEV ? (f.stack ?? null) : null,
        stage: "error",
      }));
      toast.error(`Failed to start: ${f.message}`);
      await stop();
    } finally {
      startingRef.current = false;
    }

  }, [user, source, createSource, deviceInfo, stop, setStage, autoCalibrate]);

  // Live update aggregator config when thresholds change mid-session.
  useEffect(() => {
    const preset = presetRef.current;
    aggregatorRef.current?.updateConfig(
      preset ? { ...settings.scoring, ...presetScoring(preset, settings) } : settings.scoring,
    );
  }, [settings, settings.scoring]);

  // Cleanup: unmount and browser tab close/refresh must finalize gracefully.
  useEffect(() => {
    const finalize = () => {
      runningRef.current = false;
      sourceRef.current?.stop();
      void recorderRef.current?.end();
      releaseProvider(providerRef.current);
    };
    const onUnload = () => finalize();
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      finalize();
    };
  }, []);

  /** Snapshot of the run's diagnostics for download or native share. */
  const buildDiagnostics = useCallback((): DiagnosticsBundle => diagnosticsRef.current.build(), []);

  /** Timing/quality breakdown of the current run for the profiler panel. */
  const getProfile = useCallback((): CaptureProfileStats => profilerRef.current.stats(), []);

  /** Sensor state (exposure/ISO) reported by the camera source, when exposed. */
  const reportSensor = useCallback(
    (settings: Parameters<ReturnType<typeof createCaptureProfiler>["setSensor"]>[0]) => {
      profilerRef.current.setSensor(settings);
    },
    [],
  );

  /** One shareable file: log + timings + per-frame quality + model identity. */
  const buildBundle = useCallback(
    (extra?: { benchmark?: FullDiagnosticsBundle["benchmark"] }): FullDiagnosticsBundle =>
      buildFullBundle({
        log: diagnosticsRef.current,
        profile: profilerRef.current.stats(),
        frames: profilerRef.current.samples(),
        benchmark: extra?.benchmark ?? null,
        model: {
          name: stateRef.current.modelName,
          version: stateRef.current.modelVersion,

        },
        runtime: {
          provider: settingsRef.current.providerId,
          engine: stateRef.current.engine,
          preset: stateRef.current.presetId,
          route:
            providerRef.current instanceof HybridAutoProvider
              ? providerRef.current.routeId()
              : "on-device",
          enginePreference: readEnginePreference(),
        },
      }),
    [],
  );

  /** Lets the UI-side quality monitor stamp each timeline row with a score. */
  const reportQuality = useCallback((score: number) => {
    qualityRef.current = score;
  }, []);

  /** Downloads the run as one CSV: metadata, events, and the frame timeline. */
  const exportCsv = useCallback(() => {
    const meta = {
      sessionId: recorderRef.current?.getSnapshot()?.id ?? stateRef.current.lastSessionId,
      driverLabel: driverRef.current?.label,
      source,
      modelName: stateRef.current.modelName,
      modelVersion: stateRef.current.modelVersion,
      engine: stateRef.current.engine,
      preset: stateRef.current.presetId,
    };
    const csv = buildSessionCsv({
      meta,
      startedAt: startedAtRef.current,
      events: [...stateRef.current.recentEvents].reverse(),
      timeline: timelineRef.current,
    });
    downloadCsv(csv, csvFilename(meta));
    return timelineRef.current.length;
  }, [source]);

  /** Frame-by-frame replay record (scrub mode). */
  const getReplay = useCallback(() => replayRef.current.frames(), []);
  /** Per-frame confidence/PERCLOS timeline (PDF + CSV). */
  const getTimeline = useCallback(() => timelineRef.current, []);
  /** When the run started, so replay/PDF can map to wall-clock. */
  const getStartedAt = useCallback(() => startedAtRef.current, []);

  return useMemo(
    () => ({
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
    }),
    [
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
    ],
  );
}

/**
 * Preset timings override the stored user scoring config while a preset is
 * active: a 300 ms closure threshold tuned on a 30 fps laptop misfires on a
 * 12 fps phone, so the mobile preset lengthens the windows.
 */
function presetScoring(
  preset: InferencePreset,
  settings: LiveSessionSettings,
): Partial<ScoringConfig> {
  const s = preset.scoring as InferencePreset["scoring"] & {
    yawnMinAspect?: number;
    yawnConfThreshold?: number;
  };
  // Calibrated mouth thresholds apply on every preset, desktop included —
  // they come from the driver's own footage, not from the device class.
  const mouth: Partial<ScoringConfig> = {
    ...(s.yawnMinAspect != null ? { yawnMinAspect: s.yawnMinAspect } : {}),
    ...(s.yawnConfThreshold != null ? { yawnConfThreshold: s.yawnConfThreshold } : {}),
  };
  if (preset.id === "desktop") return mouth;
  return {
    ...mouth,
    eyeClosedMsThreshold: Math.max(settings.scoring.eyeClosedMsThreshold, s.eyeClosedMsThreshold),
    eventCooldownMs: s.eventCooldownMs,
    yawnStartMs: s.yawnStartMs,
    yawnConfirmMs: s.yawnConfirmMs,
    longYawnMs: s.longYawnMs,
  } as Partial<ScoringConfig>;
}


function topConfidenceOf(detections: Detection[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of detections) {
    const key = d.semantic ?? d.label;
    if (!out[key] || d.confidence > out[key]) out[key] = d.confidence;
  }
  return out;
}

function round3(n: number | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

function emptyClosure(): ClosureStats {
  return {
    analysedFrames: 0,
    closedFrames: 0,
    currentClosureFrames: 0,
    currentClosureMs: 0,
    longestClosureMs: 0,
    blinks: 0,
    microsleeps: 0,
    criticalMicrosleeps: 0,
    yawns: 0,
    longYawns: 0,
    smilesRejected: 0,
    currentYawnMs: 0,
  };
}

function initialState(): LiveSessionState {
  return {
    running: false,
    starting: false,
    error: null,
    errorStack: null,
    stage: "idle",
    stageDetail: null,
    detections: [],
    risk: "safe",
    perclos: 0,
    yawnRate: 0,
    cameraFps: 0,
    processedFps: 0,
    inferenceFps: 0,
    targetInferenceFps: 0,
    latencyMs: 0,
    inferMs: 0,
    preprocessMs: 0,
    postprocessMs: 0,
    engine: "-",
    benchmarkMs: null,
    preprocess: null,
    modelName: "-",
    modelVersion: "-",
    snapshot: null,
    recentEvents: [],
    closure: emptyClosure(),
    yawnEpisodes: [],
    yawnProbe: null,

    microsleepActive: false,
    rejectedFrames: 0,
    droppedFrames: 0,
    latencyP50Ms: 0,
    latencyP95Ms: 0,
    queuedFrames: 0,
    inFlightFrames: 0,
    pipelineDepth: 1,
    dropRate: 0,
    captureHeight: 0,
    presetId: "desktop",
    luma: 0,
    gain: 1,
    tracker: { activeTracks: 0, emitted: 0, coasting: 0 },
    topConfidence: {},
    lastSessionId: null,
    lastSummary: null,
    calibration: null,
    lowLight: false,
    timelineSamples: 0,
    autoCalibrated: false,
    replayFrames: 0,
  };
}
