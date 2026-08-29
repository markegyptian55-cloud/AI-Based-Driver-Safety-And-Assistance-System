import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Contrast, Download, FileText, Play, RotateCcw, Square, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DetectionOverlay } from "@/components/live/detection-overlay";
import { useHighContrastOverlay } from "@/hooks/use-high-contrast";
import { RiskPanel } from "@/components/live/risk-panel";
import { YawnPanel } from "@/components/live/yawn-panel";

import { LiveEventTimeline } from "@/components/live/live-event-timeline";
import { ProviderStatus } from "@/components/live/provider-status";
import { PipelineProgress } from "@/components/live/pipeline-progress";
import { StartupStageTimeline } from "@/components/live/startup-stage-timeline";
import { WorkerDebugPanel } from "@/components/live/worker-debug-panel";
import { EngineStrip } from "@/components/live/engine-strip";
import {
  useDetectionSession,
  type FrameSourceFactory,
  type LiveSessionSettings,
} from "@/features/session/use-live-session";
import { createVideoFileSource } from "@/features/session/video-file-source";
import {
  decodeMediaError,
  describeMediaLoadFailure,
  extOf,
  mediaSnapshot,
  probeSupport,
} from "@/features/session/video-support";
import {
  getLastFfmpegLog,
  getRecentFfmpegLog,
  transcodeToMp4,
  type TranscodeStage,
} from "@/features/session/video-transcoder";
import {
  decideVideoPath,
  VIDEO_PATH_LABEL,
  type VideoPathDecision,
} from "@/features/session/video-pipeline";
import { useAnalysisSession } from "@/features/session/analysis-session-context";
import {
  detachMediaElement,
  loadMediaElement,
  waitForVideoReady,
} from "@/features/session/media-element-lifecycle";
import type { SessionSource } from "@/features/session/session-source";
import { useUserSettings, CLIENT_DEFAULTS } from "@/hooks/use-user-settings";
import type { ProviderId } from "@/features/inference/registry";
import { useModelSelection } from "@/hooks/use-model-selection";
import { useModelContext } from "@/features/inference/model-context";
import { makeTrace, type ConversionPath } from "@/features/session/pipeline-trace";
import { ModelSelector } from "@/components/model-selector";
import { errorMessage } from "@/lib/format-error";
import { buildLocalReport } from "@/features/session/driver-report";
import { computeSafety } from "@/features/drowsiness/safety-score";
import { DriverReportView } from "@/components/report/driver-report-view";
import { ExportPdfButton } from "@/components/report/export-pdf-button";
import { SessionPdfButton } from "@/components/report/session-pdf-button";
import { LastSessionExport } from "@/components/report/last-session-export";
import { QualityCuesOverlay } from "@/components/live/quality-cues-overlay";
import { ReplayScrubber } from "@/components/live/replay-scrubber";
import { useQualityMonitor } from "@/hooks/use-quality-monitor";
import type { ReplayFrame } from "@/features/session/replay-buffer";
import { DriverPicker } from "@/components/drivers/driver-picker";
import { useShiftMonitor } from "@/features/fleet/shift-context";
import { ShiftControlBar } from "@/components/fleet/shift-control-bar";
import { OfflineModelNotice } from "@/components/live/offline-model-notice";
import { useDrivers } from "@/hooks/use-drivers";
import { PerfMetricsBar } from "@/components/inference/PerfMetricsBar";


export const Route = createFileRoute("/_authenticated/video")({
  head: () => ({
    meta: [
      { title: "Video detection — SentryEye driver fatigue analysis" },
      {
        name: "description",
        content:
          "Upload a driver clip and run the full SentryEye detection pipeline in the browser: conversion, inference, scoring and session recording.",
      },
      { property: "og:title", content: "Video detection — SentryEye" },
      {
        property: "og:description",
        content:
          "Analyse a recorded driver clip end to end and generate a professional driver fatigue report.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VideoPage,
});

const ACCEPTED =
  ".mp4,.mov,.avi,.webm,.mkv,video/mp4,video/quicktime,video/x-msvideo,video/webm,video/x-matroska";

const MEDIA_LOAD_TIMEOUT_MS = 30_000;

// Human-readable labels for the pipeline stages emitted by useDetectionSession /
// BrowserOnnxProvider / browser-worker. Anything unknown falls back to the raw
// stage id so we never hide progress from the user.
const STAGE_LABELS: Record<string, string> = {
  idle: "Idle",
  starting: "Preparing…",
  "loading-model-metadata": "Loading model metadata…",
  "model-metadata-loaded": "Model metadata loaded",
  "creating-provider": "Creating inference provider…",
  "provider-init": "Initializing inference engine…",
  "creating-worker": "Preparing worker…",
  "worker-created": "Worker created",
  "posting-init": "Handing off to worker…",
  "worker-init-received": "Worker received init",
  "ep-preferred": "Selecting execution provider…",
  "model-cache-hit": "Model loaded from device cache",
  "model-cache-miss": "Model not cached yet — downloading…",
  "model-download-start": "Downloading model…",
  "model-download-progress": "Downloading model…",
  "model-download-done": "Model download complete",
  "session-create-start": "Creating ONNX inference session…",
  "session-create-fallback-wasm": "WebGPU failed, falling back to WASM…",
  "session-create-done": "Inference session ready",
  "engine-self-test": "Verifying backend output…",
  "engine-warmup-done": "Engine warmed up",
  "engine-warmup-skipped": "Warm-up skipped",
  "provider-ready": "Provider ready",
  "starting-recorder": "Starting session recorder…",
  "recorder-started": "Session recorder started",
  "creating-frame-source": "Preparing video frame source…",
  "starting-source": "Starting playback…",
  "first-frame-received": "First frame received",
  "first-inference-complete": "First inference complete",
  "first-inference-done": "First inference complete",
  running: "Running",
  "source-ended": "Video ended",
  error: "Error",
};

// Which high-level pipeline card a low-level engine stage belongs to.
const ENGINE_STAGES = new Set([
  "starting",
  "loading-model-metadata",
  "model-metadata-loaded",
  "creating-provider",
  "provider-init",
  "creating-worker",
  "worker-created",
  "posting-init",
  "worker-init-received",
  "ep-preferred",
  "model-cache-hit",
  "model-cache-miss",
  "model-download-start",
  "model-download-progress",
  "model-download-done",
  "session-create-start",
  "session-create-fallback-wasm",
  "session-create-done",
  "engine-self-test",
  "engine-warmup-done",
  "engine-warmup-skipped",
]);

const INFERENCE_STAGES = new Set([
  "provider-ready",
  "starting-recorder",
  "recorder-started",
  "creating-frame-source",
  "starting-source",
  "first-frame-received",
  "first-inference-complete",
  "first-inference-done",
  "running",
]);

const TRANSCODE_STAGE_LABELS: Record<TranscodeStage, string> = {
  "loading-ffmpeg": "Preparing video… (loading ffmpeg)",
  "checking-encoders": "Checking browser ffmpeg encoders…",
  "mounting-input": "Opening video without copying it into memory…",
  analyzing: "Analyzing codec…",
  remuxing: "Repackaging without re-encoding…",
  transcoding: "Converting video…",
  validating: "Validating generated MP4…",
  optimizing: "Optimizing for browser…",
  finalizing: "Finalizing…",
};

function stageLabel(stage: string, detail: Record<string, unknown> | null) {
  const base = STAGE_LABELS[stage] ?? stage;
  if (stage === "model-download-progress" && detail) {
    const received = Number(detail.received ?? 0);
    const total = Number(detail.total ?? 0);
    if (total > 0) {
      const pct = ((received / total) * 100).toFixed(0);
      return `Downloading model… ${pct}% (${fmtMb(received)}/${fmtMb(total)})`;
    }
    return `Downloading model… ${fmtMb(received)}`;
  }
  if (stage === "ep-preferred" && detail?.providers) {
    return `Selecting execution provider… (${(detail.providers as string[]).join(" → ")})`;
  }
  return base;
}

function fmtMb(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKey(f: File) {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

/** Snapshot of the live telemetry, in the shape persisted by the session. */
function buildLiveStats(state: {
  snapshot: { framesProcessed: number } | null;
  perclos: number;
  yawnRate: number;
  latencyMs: number;
  processedFps: number;
  engine: string;
  modelName: string;
  modelVersion: string;
}) {
  return {
    framesProcessed: state.snapshot?.framesProcessed ?? 0,
    perclos: state.perclos,
    yawnRate: state.yawnRate,
    latencyMs: state.latencyMs,
    processedFps: state.processedFps,
    engine: state.engine,
    modelName: state.modelName,
    modelVersion: state.modelVersion,
  };
}

function VideoPage() {
  const { user } = useAuth();
  const analysis = useAnalysisSession();
  const {
    originalFile,
    activeFile,
    objectUrl,
    converted,
    fileError,
    transcode: transcoding,
    pipeline,
    setOriginalFile,
    setActiveFile,
    clearObjectUrl,
    setFileError,
    setTranscode,
    setStage: setPipelineStage,
    completeRun,
    playbackPositionRef,
    detectionsRef,
    frameIndexRef,
    resumeRef,
    setLiveStats,
    transcodeAttemptedRef,
    reset: resetAnalysis,
  } = analysis;

  const file = activeFile ?? originalFile;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startRequestedRef = useRef(false);
  const selectedFileRef = useRef<File | null>(activeFile ?? originalFile);
  const objectUrlRef = useRef<string | null>(objectUrl);
  const mediaListenerCleanupRef = useRef<(() => void) | null>(null);
  const videoElementIdRef = useRef(0);
  const transcodeAbortRef = useRef<AbortController | null>(null);
  const convertedRef = useRef(converted);
  // Which object URL is currently installed in the live element. Restoring is
  // keyed on this so a route remount, a new file and a conversion each get a
  // clean load, while a re-render never reloads the media.
  const loadedUrlRef = useRef<string | null>(null);
  const { settings } = useUserSettings();
  const { selectedId: modelId } = useModelSelection();
  const { loadTrace, hardRetry, constrained, warmup } = useModelContext();
  const [highContrast, setHighContrast] = useHighContrastOverlay();
  // Which route this clip actually took. Recorded when the decision is made so
  // the stored trace reports the path that ran, not the one we hoped for.
  const conversionPathRef = useRef<ConversionPath>("none");
  // Refs so the trace builder (called at stop time) always reads current values
  // without re-creating the session hook on every render.
  const pipelineRef = useRef(pipeline);
  pipelineRef.current = pipeline;
  const loadTraceRef = useRef(loadTrace);
  loadTraceRef.current = loadTrace;

  selectedFileRef.current = activeFile ?? originalFile;
  objectUrlRef.current = objectUrl;
  convertedRef.current = converted;

  // Only ONE element may own the blob URL. When React swaps the node (route
  // remount, keyed recreation) the outgoing element is detached first so its
  // decoder and blob reader are released before the new one attaches.
  const setVideoElementRef = useCallback((node: HTMLVideoElement | null) => {
    setVideoEl(node);
    if (!node) {
      // React detaches the ref before re-attaching the SAME node (dev remount,
      // re-render with a new ref identity). Tearing the media pipeline down here
      // would wipe the source of an element that is about to come back, so the
      // outgoing element is only released when a DIFFERENT node attaches, or by
      // the unmount cleanup below.
      return;
    }
    const previous = videoRef.current;
    if (previous && previous !== node) {
      mediaListenerCleanupRef.current?.();
      mediaListenerCleanupRef.current = null;
      detachMediaElement(previous);
      loadedUrlRef.current = null;
      // A new element is never ready until its own load sequence completes.
      loadGenerationRef.current += 1;
      setMediaReady(false);
    }
    videoElementIdRef.current += 1;
    videoRef.current = node;
  }, []);


  // The analysis session outlives this page, the media element does not.
  // Listeners, the in-flight transcode and the element's media pipeline are
  // torn down here; object URLs, files and results stay alive in the context.
  useEffect(() => {
    return () => {
      mediaListenerCleanupRef.current?.();
      mediaListenerCleanupRef.current = null;
      transcodeAbortRef.current?.abort();
      transcodeAbortRef.current = null;
      detachMediaElement(videoRef.current);
      loadedUrlRef.current = null;
    };
  }, []);

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

  const deviceInfo = useMemo(
    () =>
      file
        ? {
            filename: file.name,
            sizeBytes: file.size,
            mimeType: file.type || "video/*",
          }
        : undefined,
    [file],
  );

  // NOTE: Video detection MUST NOT touch getUserMedia. The frame source is
  // strictly an uploaded-file source; no CameraFrameSource is imported or
  // constructed on this page.
  const createSource: FrameSourceFactory = useCallback((ctx) => {
    const video = videoRef.current;
    if (!video) {
      throw new Error("Video element is not mounted; cannot create uploaded-video frame source.");
    }
    return createVideoFileSource({
      video,
      onFrame: ctx.onFrame,
      onEnded: ctx.onEnded,
      onError: ctx.onError,
    });
  }, []);

  // The overlay/detection state is owned by the analysis session, not by this
  // page, so it survives navigation together with the clip.
  const { driverLabel, driverId } = useDrivers();
  const driver = useMemo(() => ({ id: driverId, label: driverLabel }), [driverId, driverLabel]);

  // Uploaded clips can't run the interactive wizard, so the pipeline derives
  // the driver's thresholds from the first seconds of the clip itself — the
  // same maths, measured instead of guessed, so a dark phone clip and a bright
  // laptop clip score comparably.
  const mediaTime = useCallback(
    () => (videoRef.current ? videoRef.current.currentTime * 1000 : null),
    [],
  );

  const {
    state,
    start,
    stop,
    getReplay,
    getTimeline,
    getStartedAt,
    reportQuality,
  } = useDetectionSession({
    settings: liveSettings,
    source: "video-upload" satisfies SessionSource,
    createSource,
    deviceInfo,
    driver,
    detectionsRef,
    frameIndexRef,
    autoCalibrate: true,
    mediaTime,
    pipelineTrace: () => {
      const stages = pipelineRef.current
        .filter((st) => st.status !== "pending")
        .map((st) => ({
          id: st.id,
          label: st.label,
          status: st.status,
          durationMs: st.durationMs,
        }));
      const convert = pipelineRef.current.find((st) => st.id === "convert");
      return makeTrace({
        source: "video-upload",
        conversionPath: conversionPathRef.current,
        conversionMs: convert?.status === "skipped" ? 0 : (convert?.durationMs ?? null),
        stages,
        model: loadTraceRef.current,
      });
    },
  });

  // Fleet: uploaded-clip analysis also contributes safety events to an active
  // shift, so a driver reviewing dashcam footage still gets it on their record.
  useShiftMonitor(state.recentEvents, state.running);

  const [autoStart, setAutoStart] = useState(false);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(true);
  // True only once waitForVideoReady() has resolved for the CURRENT element and
  // object URL. Every load (new file, conversion, route remount) resets it, so
  // no code path can start inference against a half-loaded decoder.
  const [mediaReady, setMediaReady] = useState(false);
  // Human-readable reason the current element could not be loaded, surfaced in
  // the UI so a failed load never looks like "still preparing".
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);
  // Monotonic id of the newest load; stale loads never flip mediaReady.
  const loadGenerationRef = useRef(0);

  // Live quality assessment for the clip: same monitor the webcam page uses,
  // so blur/darkness/distance are explained on the picture instead of being
  // hidden inside a score.
  const quality = useQualityMonitor(videoEl, state, {
    enabled: state.running,
    onScore: reportQuality,
  });

  // Replay snapshot, taken when a run finishes.
  const [replay, setReplay] = useState<ReplayFrame[]>([]);
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (state.running) wasRunningRef.current = true;
    else if (wasRunningRef.current) {
      wasRunningRef.current = false;
      setReplay(getReplay().slice());
    }
  }, [state.running, getReplay]);


  // Single load path for the media element: diagnostics are attached BEFORE the
  // source is assigned, the previous pipeline is torn down inside
  // loadMediaElement, and the element is only ready once waitForVideoReady
  // confirms metadata + canplay + readyState + non-zero dimensions.
  const loadIntoVideo = useCallback(
    async (v: HTMLVideoElement, f: File, url: string, position = 0) => {
      const generation = ++loadGenerationRef.current;
      setMediaReady(false);
      setLoadError(null);
      attachMediaDiagnosticsRef.current?.(v, f, url);
      loadedUrlRef.current = url;
      try {
        await loadMediaElement(v, url, { position, timeoutMs: MEDIA_LOAD_TIMEOUT_MS });
        await waitForVideoReady(v, { timeoutMs: MEDIA_LOAD_TIMEOUT_MS });
        if (generation !== loadGenerationRef.current || videoRef.current !== v) return;
        setMediaReady(true);
      } catch (err) {
        // A superseded load is expected — only the newest one may report.
        if (generation !== loadGenerationRef.current) return;
        loadedUrlRef.current = null;
        console.warn("[video] load sequence did not complete", err);
        setLoadError(errorMessage(err));
      }
    },
    [],
  );

  const retryLoad = useCallback(() => {
    loadedUrlRef.current = null;
    setLoadError(null);
    setLoadNonce((n) => n + 1);
  }, []);


  const runTranscode = useCallback(
    async (sourceFile: File, decision?: VideoPathDecision) => {
      const key = fileKey(sourceFile);
      if (transcodeAttemptedRef.current.has(key)) {
        setFileError(
          `Automatic conversion already attempted for "${sourceFile.name}" and failed. See details above.`,
        );
        setPipelineStage("convert", { status: "error", detail: "Conversion already failed" });
        return;
      }
      transcodeAttemptedRef.current.add(key);
      mediaListenerCleanupRef.current?.();
      mediaListenerCleanupRef.current = null;
      detachMediaElement(videoRef.current);
      loadGenerationRef.current += 1;
      setMediaReady(false);
      loadedUrlRef.current = null;
      setFileError(null);
      setAutoStart(false);
      const controller = new AbortController();
      transcodeAbortRef.current?.abort();
      transcodeAbortRef.current = controller;
      setPipelineStage("convert", {
        status: "active",
        detail: decision?.reason ?? "Converting video…",
        progress: null,
      });
      setTranscode({ stage: "loading-ffmpeg", progress: 0, etaSeconds: null });
      try {
        const result = await transcodeToMp4(sourceFile, {
          signal: controller.signal,
          preferRemux: decision?.path === "remux",
          onProgress: (p) => setTranscode(p),
        });

        if (controller.signal.aborted) return;
        const outExt = result.mimeType === "video/webm" ? "webm" : "mp4";
        const convertedFile = new File(
          [result.blob],
          sourceFile.name.replace(/\.[^.]+$/, "") + `.converted.${outExt}`,
          { type: result.mimeType },
        );

        startRequestedRef.current = false;
        detachMediaElement(videoRef.current);
        loadedUrlRef.current = null;
        playbackPositionRef.current = 0;
        const nextUrl = setActiveFile(convertedFile, { converted: true });
        selectedFileRef.current = convertedFile;
        objectUrlRef.current = nextUrl;
        convertedRef.current = true;
        setTranscode(null);
        setPipelineStage("convert", {
          status: "done",
          detail:
            result.mode === "remux"
              ? `Stream copy (no re-encode) · ${fmtMb(result.blob.size)}`
              : `${result.mode === "webm-fallback" ? "Re-encoded to WebM" : "Re-encoded to MP4"} · ${fmtMb(result.blob.size)}`,
          progress: null,
        });
        // The <video> element is keyed by the object URL, so the swap to the
        // converted blob remounts it and the single load effect below owns the
        // load. Loading here as well would race that effect and leave the
        // surviving element without a source.

        setAutoStart(true);
      } catch (err) {
        if (controller.signal.aborted) {
          setTranscode(null);
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        const log = getLastFfmpegLog();
        const recentLog = getRecentFfmpegLog();
        console.error("[video] transcode failed", { err, ffmpegLog: log });
        setTranscode(null);
        setPipelineStage("convert", { status: "error", detail: msg, progress: null });
        setFileError(
          `Automatic conversion failed for "${sourceFile.name}".\n\nffmpeg error: ${msg}${
            log ? `\n\nLast ffmpeg log:\n${log}` : ""
          }${recentLog ? `\n\nRecent ffmpeg log:\n${recentLog}` : ""}`,
        );
        toast.error("Automatic video conversion failed");
      } finally {
        if (transcodeAbortRef.current === controller) transcodeAbortRef.current = null;
      }
    },
    [
      loadIntoVideo,
      playbackPositionRef,
      setActiveFile,
      setFileError,
      setPipelineStage,
      setTranscode,
      transcodeAttemptedRef,
    ],
  );

  const attachMediaDiagnosticsRef = useRef<
    ((video: HTMLVideoElement, nextFile: File, nextObjectUrl: string) => void) | null
  >(null);

  const attachMediaDiagnostics = useCallback(
    (video: HTMLVideoElement, nextFile: File, nextObjectUrl: string) => {
      mediaListenerCleanupRef.current?.();
      mediaListenerCleanupRef.current = null;
      const log = (name: string) => () =>
        console.info(
          `[video] ${name}`,
          mediaSnapshot(video, selectedFileRef.current, objectUrlRef.current),
        );
      const onError = () => {
        const currentFile = selectedFileRef.current;
        const currentObjectUrl = objectUrlRef.current;
        const d = decodeMediaError(video.error);
        const message = describeMediaLoadFailure(video, currentFile, currentObjectUrl);
        console.error("[video] error event", {
          error: d,
          snapshot: mediaSnapshot(video, currentFile, currentObjectUrl),
          message,
        });
        if (d.code === 4 && currentFile && convertedRef.current) {
          setFileError(
            `${message}\n\nThe automatically converted MP4 also failed browser validation. Last ffmpeg log:\n${getRecentFfmpegLog() || getLastFfmpegLog() || "(no ffmpeg log)"}`,
          );
          setPipelineStage("prepare", { status: "error", detail: "Converted MP4 is unplayable" });
          setAutoStart(false);
          toast.error("Converted video still cannot be played");
          return;
        }
        if (
          d.code === 4 &&
          currentFile &&
          !transcodeAttemptedRef.current.has(fileKey(currentFile))
        ) {
          void runTranscode(currentFile);
          return;
        }
        setFileError(message);
        setPipelineStage("prepare", { status: "error", detail: `${d.name}: ${d.message}` });
        setAutoStart(false);
        toast.error(`Video error: ${d.name}: ${d.message}`);
      };
      const onTimeout = () => {
        if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return;
        const currentFile = selectedFileRef.current;
        const currentObjectUrl = objectUrlRef.current;
        const message = describeMediaLoadFailure(video, currentFile, currentObjectUrl);
        console.error("[video] canplay timeout", {
          snapshot: mediaSnapshot(video, currentFile, currentObjectUrl),
          message,
        });
        if (currentFile && !transcodeAttemptedRef.current.has(fileKey(currentFile))) {
          void runTranscode(currentFile);
          return;
        }
        setFileError(message);
        setPipelineStage("prepare", { status: "error", detail: "Timed out while decoding" });
        setAutoStart(false);
      };
      const events: [string, EventListener][] = [
        ["loadstart", log("loadstart")],
        ["loadedmetadata", log("loadedmetadata")],
        ["loadeddata", log("loadeddata")],
        ["canplay", log("canplay")],
        ["canplaythrough", log("canplaythrough")],
        ["playing", log("playing")],
        ["stalled", log("stalled")],
        ["suspend", log("suspend")],
        ["waiting", log("waiting")],
        ["error", onError],
      ];
      for (const [name, fn] of events) video.addEventListener(name, fn);
      const timeout = window.setTimeout(onTimeout, MEDIA_LOAD_TIMEOUT_MS);
      mediaListenerCleanupRef.current = () => {
        window.clearTimeout(timeout);
        for (const [name, fn] of events) video.removeEventListener(name, fn);
      };
    },
    [runTranscode, setFileError, setPipelineStage, transcodeAttemptedRef],
  );

  useEffect(() => {
    attachMediaDiagnosticsRef.current = attachMediaDiagnostics;
  }, [attachMediaDiagnostics]);

  // ---- Single media load owner --------------------------------------------
  // Exactly one place loads the element: whenever the mounted element or the
  // object URL changes (new file, finished conversion, route remount) this
  // effect loads the persisted blob from scratch and restores the playback
  // position after loadedmetadata. Nothing is re-uploaded or re-converted.
  useEffect(() => {
    const v = videoEl;
    const f = activeFile;
    if (!v || !f || !objectUrl) return;
    if (loadedUrlRef.current === objectUrl && v.getAttribute("src")) return;
    void loadIntoVideo(v, f, objectUrl, playbackPositionRef.current);
  }, [videoEl, activeFile, objectUrl, playbackPositionRef, loadIntoVideo, loadNonce]);


  // ---- Media controls ------------------------------------------------------
  // Play/Pause is the single freeze switch: pausing the element stops the
  // frame source (rVFC yields no frames), which freezes inference, telemetry
  // and the overlay together. Nothing is reset, so resuming continues from the
  // current frame.
  const togglePlayback = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.currentSrc) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  useEffect(() => {
    if (!videoEl) return;
    const sync = () => setPaused(videoEl.paused);
    sync();
    videoEl.addEventListener("play", sync);
    videoEl.addEventListener("pause", sync);
    return () => {
      videoEl.removeEventListener("play", sync);
      videoEl.removeEventListener("pause", sync);
    };
  }, [videoEl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName))
      )
        return;
      if (!videoRef.current?.currentSrc) return;
      e.preventDefault();
      togglePlayback();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlayback]);

  // Persist playback position without re-rendering the page.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      playbackPositionRef.current = v.currentTime;
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [objectUrl, playbackPositionRef]);

  // ---- Professional pipeline stage mapping --------------------------------
  useEffect(() => {
    if (!originalFile) return;
    setPipelineStage("upload", {
      status: "done",
      detail: `${originalFile.name} · ${fmtMb(originalFile.size)}`,
    });
  }, [originalFile, setPipelineStage]);

  useEffect(() => {
    if (!transcoding) return;
    setPipelineStage("prepare", { status: "done", detail: "Browser cannot decode this file" });
    setPipelineStage("convert", {
      status: "active",
      detail: TRANSCODE_STAGE_LABELS[transcoding.stage],
      progress: transcoding.stage === "transcoding" ? (transcoding.progress ?? 0) : null,
    });
  }, [transcoding, setPipelineStage]);

  useEffect(() => {
    const s = state.stage;
    if (s === "idle") return;
    const label = stageLabel(s, state.stageDetail);
    if (ENGINE_STAGES.has(s)) {
      let progress: number | null = null;
      if (s === "model-download-progress" && state.stageDetail) {
        const total = Number(state.stageDetail["total"] ?? 0);
        const received = Number(state.stageDetail["received"] ?? 0);
        progress = total > 0 ? Math.min(1, received / total) : null;
      }
      setPipelineStage("engine", { status: "active", detail: label, progress });
      return;
    }
    if (INFERENCE_STAGES.has(s)) {
      setPipelineStage("engine", {
        status: "done",
        detail: "Inference engine ready",
        progress: null,
      });
      setPipelineStage("inference", { status: "active", detail: label, progress: null });
      return;
    }
    if (s === "source-ended") {
      setPipelineStage("inference", { status: "done", detail: "Video fully analysed" });
    }
    if (s === "error") {
      setPipelineStage("inference", { status: "error", detail: state.error ?? "Pipeline error" });
    }
  }, [state.stage, state.stageDetail, state.error, setPipelineStage]);

  // Analysis progress. Frames are pulled straight off playback, so the clip's
  // own position IS the progress: sampled on a 500 ms timer rather than per
  // frame, so the percentage never competes with inference for the main thread.
  const [analysisPct, setAnalysisPct] = useState(0);
  useEffect(() => {
    if (!state.running) return;
    const tick = () => {
      const el = videoRef.current;
      if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
      setAnalysisPct(Math.min(100, Math.round((el.currentTime / el.duration) * 100)));
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [state.running]);
  useEffect(() => {
    if (!state.running) return;
    setPipelineStage("inference", {
      status: "active",
      detail: `Analysing frames — ${analysisPct}%`,
      progress: analysisPct / 100,
    });
  }, [analysisPct, state.running, setPipelineStage]);


  // Persist in-flight telemetry so returning to the page shows the same
  // statistics that were on screen when the user left.
  const liveStatsRef = useRef<ReturnType<typeof buildLiveStats> | null>(null);
  liveStatsRef.current =
    state.running || state.starting ? buildLiveStats(state) : liveStatsRef.current;
  useEffect(() => {
    if (!state.running) return;
    const id = window.setInterval(() => {
      if (liveStatsRef.current) setLiveStats(liveStatsRef.current);
    }, 1000);
    return () => window.clearInterval(id);
  }, [state.running, setLiveStats]);
  const runningRef = useRef(false);
  runningRef.current = state.running || state.starting;
  const videoElRefForTeardown = useRef<HTMLVideoElement | null>(null);
  videoElRefForTeardown.current = videoEl;
  useEffect(() => {
    return () => {
      if (liveStatsRef.current) setLiveStats(liveStatsRef.current);
      // Leaving mid-run finalizes the recorder; remember that inference should
      // pick up again from the restored playback position on return.
      resumeRef.current = runningRef.current;
      // Never leave stale boxes behind: without inference running they would be
      // re-drawn over a moving video on return and look like a frozen model.
      detectionsRef.current = [];
      // Keep the picture and the analysis in sync — a video that keeps playing
      // while the pipeline is torn down would advance past un-analysed frames.
      const v = videoElRefForTeardown.current;
      if (v && !v.paused) v.pause();
    };
  }, [setLiveStats, resumeRef, detectionsRef, videoEl]);

  // Remembered at mount: the run was interrupted by leaving the page. If the
  // automatic resume below cannot fire (element gone, decoder not ready), the
  // user gets an explicit "Resume analysis" button instead of silence.
  const [wasInterrupted, setWasInterrupted] = useState(() => resumeRef.current);
  useEffect(() => {
    if (state.running || state.starting) setWasInterrupted(false);
  }, [state.running, state.starting]);

  // Resume inference from the current frame when the user comes back mid-run.
  // `mediaReady` can lag the remount (the element re-decodes the blob), so this
  // polls for a decodable element for a bounded window before giving up and
  // leaving the explicit "Resume analysis" button as the fallback.
  useEffect(() => {
    if (!resumeRef.current || !file) return;
    if (state.running || state.starting) return;
    let cancelled = false;
    let attempts = 0;
    const tryResume = () => {
      if (cancelled || !resumeRef.current) return true;
      const v = videoElRefForTeardown.current;
      const ready = mediaReady && !!v && v.readyState >= 2;
      if (!ready) return false;
      resumeRef.current = false;
      startRequestedRef.current = false;
      void startProcessing({ fromCurrentPosition: true });
      return true;
    };
    if (tryResume()) return;
    const id = window.setInterval(() => {
      attempts++;
      if (tryResume() || attempts > 40) window.clearInterval(id); // ~10s budget
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [mediaReady, file, state.running, state.starting, resumeRef]);


  // Keep the last non-empty detection set so the overlay survives navigation.
  const lastDetectionsRef = useRef<typeof analysis.detections>(
    detectionsRef.current.length ? detectionsRef.current : analysis.detections,
  );
  useEffect(() => {
    if (state.detections.length) lastDetectionsRef.current = state.detections;
  }, [state.detections]);

  // Timeline data: live events while running, persisted ones after navigation.
  // Events arrive newest-first, so the rail reverses them into real chronology.
  const timelineEvents = useMemo(() => {
    const src = state.recentEvents.length ? state.recentEvents : analysis.recentEvents;
    return [...src].sort((a, b) => a.ts - b.ts);
  }, [state.recentEvents, analysis.recentEvents]);
  const timelineStartedAt =
    state.snapshot?.startedAt ?? (timelineEvents.length ? timelineEvents[0].ts : null);


  // Completion: report generation + persistence are finished once the recorder
  // returns the session id and summary.
  const completedIdRef = useRef<string | null>(analysis.lastSessionId);
  useEffect(() => {
    if (!state.lastSessionId || state.running || state.starting) return;
    if (completedIdRef.current === state.lastSessionId) return;
    completedIdRef.current = state.lastSessionId;
    setPipelineStage("inference", { status: "done", detail: "Video fully analysed" });
    setPipelineStage("report", {
      status: "done",
      detail: state.lastSummary
        ? `Safety score ${state.lastSummary.safetyScore} · ${state.lastSummary.fatigueLevel} fatigue`
        : "Driver report ready",
    });
    setPipelineStage("save", {
      status: "done",
      detail: `Session ${state.lastSessionId.slice(0, 8)}`,
    });
    setPipelineStage("complete", { status: "done", detail: "Analysis finished" });
    analysis.setDetections(lastDetectionsRef.current);
    analysis.setRecentEvents(state.recentEvents);
    completeRun({
      sessionId: state.lastSessionId,
      stats: {
        framesProcessed: state.snapshot?.framesProcessed ?? 0,
        perclos: state.perclos,
        yawnRate: state.yawnRate,
        latencyMs: state.latencyMs,
        processedFps: state.processedFps,
        engine: state.engine,
        modelName: state.modelName,
        modelVersion: state.modelVersion,
      },
    });
  }, [
    state.lastSessionId,
    state.running,
    state.starting,
    state.lastSummary,
    state.recentEvents,
    state.snapshot,
    state.perclos,
    state.yawnRate,
    state.latencyMs,
    state.processedFps,
    state.engine,
    state.modelName,
    state.modelVersion,
    setPipelineStage,
    completeRun,
    analysis,
  ]);

  const handleFile = (f: File | null) => {
    if (!f) return;
    const probe = probeSupport(f);
    console.info("[video] file selected", {
      filename: f.name,
      extension: extOf(f.name),
      mimeType: f.type || "",
      sizeBytes: f.size,
      canPlayType: probe.probed,
      bestCanPlayType: probe.best,
    });
    if (state.running || state.starting) {
      toast.error("Stop the current session before loading a new video");
      return;
    }
    mediaListenerCleanupRef.current?.();
    mediaListenerCleanupRef.current = null;
    // Release the element BEFORE the context revokes the previous object URL:
    // a URL must never be revoked while an element still reads from it.
    detachMediaElement(videoRef.current);
    loadGenerationRef.current += 1;
    setMediaReady(false);
    loadedUrlRef.current = null;
    completedIdRef.current = null;
    lastDetectionsRef.current = [];
    startRequestedRef.current = false;
    setOriginalFile(f);
    selectedFileRef.current = f;
    convertedRef.current = false;
    playbackPositionRef.current = 0;
    setPipelineStage("upload", { status: "done", detail: `${f.name} · ${fmtMb(f.size)}` });
    setPipelineStage("prepare", { status: "active", detail: "Checking browser codec support…" });

    // Decide the route BEFORE any ffmpeg module is fetched. Loading the wasm
    // core for a file the browser plays natively is pure wasted time, and it
    // was the biggest contributor to the "why is this so slow" complaint.
    void (async () => {
      const decision = await decideVideoPath(f);
      console.info("[video] path decision", decision);
      conversionPathRef.current = decision.path as ConversionPath;
      if (selectedFileRef.current !== f) return;
      setPipelineStage("prepare", {
        status: decision.path === "native" ? "done" : "active",
        detail: decision.reason,
      });
      if (decision.path === "native") {
        setPipelineStage("convert", {
          status: "skipped",
          detail: `Not needed — ${VIDEO_PATH_LABEL.native}`,
        });
        const url = setActiveFile(f, { converted: false });
        objectUrlRef.current = url;
        if (videoRef.current) void loadIntoVideo(videoRef.current, f, url, 0);
        setAutoStart(true);
        return;
      }
      clearObjectUrl();
      void runTranscode(f, decision);
    })();
  };


  const startProcessing = useCallback(
    async (opts?: { fromCurrentPosition?: boolean }) => {
      if (!file || !videoRef.current) {
        toast.error("Choose a video first");
        return;
      }
      const video = videoRef.current;
      // THE gate: never hand a half-loaded element to the inference pipeline.
      // This awaits rather than refusing, so a click that lands one frame early
      // simply waits instead of failing.
      setPipelineStage("prepare", { status: "active", detail: "Waiting for the video decoder…" });
      try {
        await waitForVideoReady(video, { timeoutMs: MEDIA_LOAD_TIMEOUT_MS });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setFileError(message);
        setPipelineStage("prepare", { status: "error", detail: message });
        toast.error(message);
        return;
      }
      if (videoRef.current !== video) return;
      setMediaReady(true);
      setPipelineStage("prepare", { status: "done", detail: "Video decoded by the browser" });
      if (!opts?.fromCurrentPosition) video.currentTime = 0;
      startRequestedRef.current = true;
      completedIdRef.current = state.lastSessionId;
      setPipelineStage("engine", { status: "active", detail: "Preparing AI engine…" });
      setPipelineStage("report", { status: "pending", detail: null });
      setPipelineStage("save", { status: "pending", detail: null });
      setPipelineStage("complete", { status: "pending", detail: null });
      await start();
    },
    [file, start, setFileError, setPipelineStage, state.lastSessionId],
  );

  const handleStop = useCallback(async () => {
    setPipelineStage("inference", { status: "done", detail: "Stopped by user" });
    setPipelineStage("report", { status: "active", detail: "Computing session summary…" });
    setPipelineStage("save", { status: "active", detail: "Writing session to the database…" });
    await stop();
  }, [stop, setPipelineStage]);

  const handleNewAnalysis = useCallback(() => {
    mediaListenerCleanupRef.current?.();
    mediaListenerCleanupRef.current = null;
    transcodeAbortRef.current?.abort();
    transcodeAbortRef.current = null;
    // Detach first so the object URL revoked by resetAnalysis() has no reader.
    detachMediaElement(videoRef.current);
    loadedUrlRef.current = null;
    completedIdRef.current = null;
    lastDetectionsRef.current = [];
    detectionsRef.current = [];
    startRequestedRef.current = false;
    convertedRef.current = false;
    setAutoStart(false);
    loadGenerationRef.current += 1;
    setMediaReady(false);
    if (inputRef.current) inputRef.current.value = "";
    resetAnalysis();
  }, [detectionsRef, resetAnalysis]);

  // Auto-start detection. `mediaReady` is set exclusively by the load path once
  // waitForVideoReady() resolved, so this effect can never fire early: it is
  // state-driven, not readyState-polled.
  useEffect(() => {
    if (!autoStart || !mediaReady || !file || state.running || state.starting) return;
    if (startRequestedRef.current) return;
    setPipelineStage("prepare", { status: "done", detail: "Video decoded by the browser" });
    if (!convertedRef.current) {
      setPipelineStage("convert", {
        status: "skipped",
        detail: "Browser plays this format natively",
      });
    }
    setAutoStart(false);
    void startProcessing();
  }, [
    autoStart,
    mediaReady,
    file,
    state.running,
    state.starting,
    startProcessing,
    setPipelineStage,
  ]);

  const showLoader = state.starting || (autoStart && !!file && !state.running);
  const currentStageLabel = stageLabel(state.stage, state.stageDetail);
  const transcodeLabel = transcoding ? TRANSCODE_STAGE_LABELS[transcoding.stage] : null;
  const transcodePct = transcoding ? Math.round((transcoding.progress || 0) * 100) : 0;
  const transcodeEta =
    transcoding && transcoding.etaSeconds != null
      ? `${Math.max(1, Math.round(transcoding.etaSeconds))}s remaining`
      : null;
  const reportSessionId = user ? (state.lastSessionId ?? analysis.lastSessionId) : null;
  const stats = analysis.stats;

  // Everyone gets the report for the clip they just analysed, built from the
  // in-memory summary. Signed-in users additionally get the persisted version
  // at /report/:id; visitors only ever have this one.
  const localReport = useMemo(() => {
    if (state.running || state.starting || !state.lastSummary) return null;
    return buildLocalReport({
      sessionId: state.lastSessionId ?? "guest-session",
      driverLabel: driverLabel,
      source: "video-upload",
      provider: liveSettings.providerId,
      engineKind: state.engine ?? "onnx",
      startedAt: new Date(Date.now() - state.lastSummary.durationSec * 1000).toISOString(),
      endedAt: new Date().toISOString(),
      modelName: state.modelName ?? "",
      modelVersion: state.modelVersion ?? "",
      avgFps: state.processedFps ?? 0,
      avgLatencyMs: state.latencyMs ?? 0,
      perclos: state.perclos ?? 0,
      summary: state.lastSummary,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    driverLabel,
    state.running,
    state.starting,
    state.lastSummary,
    state.lastSessionId,
    state.engine,
    state.modelName,
    state.modelVersion,
    state.processedFps,
    state.latencyMs,
    state.perclos,
  ]);

  // Provisional report while the clip is still being analysed, so there is
  // always a report view for the current video — not only after it ends.
  const liveReport = useMemo(() => {
    if (!state.running && !state.starting) return null;
    const c = state.closure;
    const durationSec = Math.max(1, (state.snapshot?.framesProcessed ?? 0) / Math.max(1, state.processedFps || 1));
    const safety = computeSafety({
      eyeClosureRatio: state.perclos ?? 0,
      yawnPerMin: state.yawnRate ?? 0,
      alerts: { low: c.blinks, medium: 0, high: c.microsleeps, critical: c.criticalMicrosleeps },
      durationSec,
    });
    return { safety, c };
  }, [
    state.running,
    state.starting,
    state.closure,
    state.perclos,
    state.yawnRate,
    state.processedFps,
    state.snapshot,
  ]);

  const reportSectionRef = useRef<HTMLDivElement>(null);
  const scrollToReport = useCallback(() => {
    reportSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);



  // The playable MP4 — either ffmpeg's converted output or an original that is
  // already MP4. Downloaded through a throwaway object URL so the session's own
  // blob URL stays untouched.
  const downloadableMp4 =
    file && (converted || file.type === "video/mp4" || extOf(file.name) === "mp4") ? file : null;

  const handleDownloadMp4 = useCallback(() => {
    if (!downloadableMp4) return;
    // A WebM fallback can only be downloaded as WebM — never mislabel it .mp4.
    const ext = downloadableMp4.type === "video/webm" ? "webm" : "mp4";
    const url = URL.createObjectURL(downloadableMp4);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${downloadableMp4.name.replace(/\.[^.]+$/, "").replace(/\.converted$/, "")}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`${ext.toUpperCase()} download started`);
  }, [downloadableMp4]);


  return (
    <div className="space-y-6">
      <ShiftControlBar compact />

      <OfflineModelNotice />

      {/* Header: title + primary actions only. Secondary/result actions live in
          their own bar below so the description never gets squeezed into a
          narrow, ten-line column when a run finishes. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-[16rem] flex-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Video detection</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Upload a driver clip and run it through the same pipeline as the live webcam.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <Button
            variant="secondary"
            className="flex-1 sm:flex-none"
            onClick={() => inputRef.current?.click()}
            disabled={state.running || state.starting || !!transcoding}
          >
            <Upload className="mr-2 h-4 w-4" /> Choose video
          </Button>
          {state.running ? (
            <Button variant="destructive" className="flex-1 sm:flex-none" onClick={handleStop}>
              <Square className="mr-2 h-4 w-4" /> Stop
            </Button>
          ) : (
            <Button
              className="flex-1 sm:flex-none"
              onClick={() => void startProcessing()}
              disabled={!file || !mediaReady || state.starting || !!transcoding}
            >
              {state.starting || (!!file && !mediaReady && !transcoding) ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />{" "}
                  {state.starting ? "Loading…" : "Preparing video…"}
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" /> Process video
                </>
              )}
            </Button>
          )}
          {wasInterrupted && file && !state.running && !state.starting ? (
            <Button
              className="flex-1 sm:flex-none"
              onClick={() => {
                setWasInterrupted(false);
                resumeRef.current = false;
                startRequestedRef.current = false;
                void startProcessing({ fromCurrentPosition: true });
              }}
            >
              <Play className="mr-2 h-4 w-4" /> Resume analysis
            </Button>
          ) : null}
        </div>
      </div>

      {(file && !state.running && !state.starting) ||
      (downloadableMp4 && !transcoding) ||
      localReport ||
      (!state.running && reportSessionId) ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card/40 p-2">
          {file && !state.running && !state.starting ? (
            <Button
              size="sm"
              variant="outline"
              onClick={handleNewAnalysis}
              disabled={!!transcoding}
            >
              <RotateCcw className="mr-2 h-4 w-4" /> New analysis
            </Button>
          ) : null}
          {downloadableMp4 && !transcoding ? (
            <Button size="sm" variant="outline" onClick={handleDownloadMp4}>
              <Download className="mr-2 h-4 w-4" /> Download MP4
            </Button>
          ) : null}
          {localReport ? (
            <Button size="sm" variant="outline" onClick={scrollToReport}>
              <FileText className="mr-2 h-4 w-4" /> Driver report
            </Button>
          ) : null}
          {!state.running && reportSessionId ? (
            <Button asChild size="sm" variant="ghost">
              <Link to="/report/$sessionId" params={{ sessionId: reportSessionId }}>
                <FileText className="mr-2 h-4 w-4" /> Open saved report
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}


      <Card className="border-border/60 bg-card/60 p-4">
        <ModelSelector disabled={state.running || state.starting} />
      </Card>

      <DriverPicker disabled={state.running || state.starting} />

      {file ? (
        <div className="rounded-md border border-border/60 bg-card/40 px-4 py-2 font-mono text-xs text-muted-foreground">
          <span className="break-all text-foreground">{file.name}</span>{" "}
          <span>· {(file.size / (1024 * 1024)).toFixed(1)} MB</span>{" "}
          <span>· {file.type || "video/*"}</span>
          {converted ? <span> · auto-converted</span> : null}
        </div>
      ) : null}

      {fileError ? (
        <Card className="border-destructive/40 bg-destructive/10 p-4 text-sm">
          <div className="font-mono text-[10px] uppercase tracking-wider text-destructive">
            Unsupported video
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words text-sm text-destructive-foreground">
            {fileError}
          </div>
        </Card>
      ) : null}

      {loadError ? (
        <Card className="border-destructive/40 bg-destructive/10 p-4 text-sm">
          <div className="font-mono text-[10px] uppercase tracking-wider text-destructive">
            Video could not be loaded
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words text-sm text-destructive-foreground">
            {loadError}
          </div>
          <Button size="sm" variant="outline" className="mt-3" onClick={retryLoad}>
            <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Retry load
          </Button>
        </Card>
      ) : null}


      {state.error ? (
        <Card className="border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive-foreground">
          <div className="font-mono text-[10px] uppercase tracking-wider text-destructive">
            Pipeline error · stage: {state.stage}
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words font-mono text-sm">
            {state.error}
          </div>
          {state.errorStack ? (
            <pre className="mt-3 max-h-48 overflow-auto rounded bg-black/40 p-3 text-[11px] leading-relaxed text-destructive-foreground/80">
              {state.errorStack}
            </pre>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card className="relative overflow-hidden border-border/60 bg-black">
            <div className="relative aspect-video w-full">
              {/* Keyed by the object URL: a new media source always gets a
                  brand-new element instead of reusing a decoder that may have
                  been disconnected by a previous route unmount. */}
              <video
                key={objectUrl ?? "no-source"}
                ref={setVideoElementRef}
                className="h-full w-full object-contain"
                playsInline
                muted
                controls={!state.running}
                onClick={state.running ? undefined : togglePlayback}
              />
              <DetectionOverlay
                detectionsRef={detectionsRef}
                video={videoEl}
                highContrast={highContrast}
              />
              <button
                type="button"
                onClick={() => setHighContrast(!highContrast)}
                aria-pressed={highContrast}
                className="absolute right-2 top-2 z-10 flex min-h-11 items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-3 text-[11px] font-medium backdrop-blur"
              >
                <Contrast className="h-4 w-4" aria-hidden="true" />
                {highContrast ? "High contrast on" : "High contrast"}
              </button>
              <QualityCuesOverlay assessment={quality} visible={state.running} />
              {/* Click-to-toggle layer. Sits above the overlay canvas but below
                  the loading/state overlays, and is disabled while the native
                  controls are visible so scrubbing keeps working. */}
              {file && state.running ? (
                <button
                  type="button"
                  aria-label={paused ? "Play video" : "Pause video"}
                  className="absolute inset-0 h-full w-full cursor-pointer bg-transparent"
                  onClick={togglePlayback}
                />
              ) : null}
              {!file ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-muted-foreground">
                  Upload an MP4, MOV, AVI, WebM, or MKV clip to begin
                </div>
              ) : null}
              {showLoader && !transcoding ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Stage: {state.stage}
                  </div>
                  <div className="text-sm text-foreground">{currentStageLabel}</div>
                </div>
              ) : null}
              {transcoding ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-8 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Automatic conversion · {transcoding.stage}
                  </div>
                  <div className="text-sm text-foreground">{transcodeLabel}</div>
                  {transcoding.stage === "transcoding" ? (
                    <>
                      <div className="mt-2 h-2 w-full max-w-xs overflow-hidden rounded bg-white/10">
                        <div
                          className="h-full bg-primary transition-[width] duration-200"
                          style={{ width: `${transcodePct}%` }}
                        />
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {transcodePct}%{transcodeEta ? ` · ${transcodeEta}` : ""}
                      </div>
                    </>
                  ) : null}
                  {transcoding.ffmpegLog ? (
                    <div className="mt-1 w-full max-w-lg truncate font-mono text-[10px] text-muted-foreground/80">
                      ffmpeg: {transcoding.ffmpegLog}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Card>

          {(state.running || state.starting) && state.modelName !== "-" ? (
            <div className="space-y-2">
              <EngineStrip state={state} />
              <PerfMetricsBar state={state} />

              <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 font-mono text-[11px] text-muted-foreground">
                <span>source {state.cameraFps.toFixed(0)} fps</span>
                <span>analysed {state.processedFps.toFixed(1)} fps</span>
                <span>budget {state.targetInferenceFps.toFixed(0)} fps</span>
                <span>skipped {state.droppedFrames}</span>
                <span>post {state.postprocessMs.toFixed(1)} ms</span>
              </div>
              {state.engine === "wasm" && state.modelName.includes("960") ? (
                <p className="px-1 text-xs text-muted-foreground">
                  Full 960 analysis is running on CPU. Sampling is paced to keep playback responsive; select the 480 model before the next run for higher analysis FPS.
                </p>
              ) : null}
            </div>
          ) : null}

          <PipelineProgress stages={pipeline} />
        </div>

        <div className="space-y-4">
          <RiskPanel state={state} />
          <YawnPanel episodes={state.yawnEpisodes} probe={state.yawnProbe} />

          {liveReport ? (
            <Card className="border-primary/40 bg-primary/5 p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-primary">
                Live report · in progress
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3 font-mono text-xs">
                <Metric label="Safety score" value={`${liveReport.safety.safetyScore.toFixed(0)}/100`} />
                <Metric label="Fatigue" value={liveReport.safety.fatigueLevel} />
                <Metric label="PERCLOS" value={`${((state.perclos ?? 0) * 100).toFixed(1)}%`} />
                <Metric label="Yawns/min" value={(state.yawnRate ?? 0).toFixed(1)} />
                <Metric label="Microsleeps" value={String(liveReport.c.microsleeps)} />
                <Metric label="Critical" value={String(liveReport.c.criticalMicrosleeps)} />
                <Metric label="Blinks" value={String(liveReport.c.blinks)} />
                <Metric
                  label="Longest closure"
                  value={`${(liveReport.c.longestClosureMs / 1000).toFixed(1)}s`}
                />
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Driver: {driverLabel}. The full report appears below when the clip ends.
              </p>
            </Card>
          ) : null}
          <ProviderStatus state={state} />
          <StartupStageTimeline />
          <WorkerDebugPanel
            onHardRetry={hardRetry}
            defaultOpen={constrained && warmup.status === "error"}
          />
          <Card className="border-border/60 bg-card/60 p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Pipeline stage
            </div>
            <div className="mt-1 truncate font-mono text-sm">{currentStageLabel}</div>
          </Card>
          {!state.running && stats ? (
            <Card className="border-border/60 bg-card/60 p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Last completed analysis
              </div>
              <dl className="mt-2 space-y-1 font-mono text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Frames</dt>
                  <dd>{stats.framesProcessed}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">PERCLOS</dt>
                  <dd>{(stats.perclos * 100).toFixed(1)}%</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Yawn rate</dt>
                  <dd>{stats.yawnRate.toFixed(1)}/min</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Latency</dt>
                  <dd>{stats.latencyMs.toFixed(0)} ms</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Engine</dt>
                  <dd className="truncate">{stats.engine}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="truncate">
                    {stats.modelName} {stats.modelVersion}
                  </dd>
                </div>
              </dl>
            </Card>
          ) : null}
        </div>
      </div>

      {timelineEvents.length > 0 ? (
        <LiveEventTimeline
          className="border-border/60 bg-card/60"
          events={timelineEvents}
          startedAt={timelineStartedAt}
          onSeek={(seconds) => {
            const v = videoEl;
            if (v) v.currentTime = seconds;
          }}
        />
      ) : null}

      {!state.running && replay.length > 0 ? (
        <ReplayScrubber
          frames={replay}
          video={videoEl}
          onSeekDetections={(dets) => {
            detectionsRef.current = dets;
          }}
        />
      ) : null}

      {localReport ? (
        <section ref={reportSectionRef} className="scroll-mt-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-bold tracking-tight">Driver report</h2>
              <p className="text-sm text-muted-foreground">
                {user
                  ? "Report for the clip you just analysed. The saved copy is also in your history."
                  : "Visitor mode — this report lives in your browser only. Sign in to save it."}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SessionPdfButton
                className="w-full sm:w-auto"
                build={() => ({
                  meta: {
                    sessionId: state.lastSessionId,
                    driverLabel,
                    source: "video-upload",
                    modelName: state.modelName,
                    modelVersion: state.modelVersion,
                    engine: state.engine,
                    preset: state.presetId,
                  },
                  startedAt: getStartedAt(),
                  timeline: getTimeline(),
                  events: [...state.recentEvents].reverse(),
                  quality,
                  calibration: state.calibration,
                  autoCalibrated: state.autoCalibrated,
                })}
              />
              <ExportPdfButton report={localReport} className="w-full sm:w-auto" />
            </div>
          </div>
          <DriverReportView report={localReport} />
          <LastSessionExport refreshKey={state.lastSessionId} />
        </section>
      ) : null}

    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm text-foreground">{value}</div>
    </div>
  );
}
