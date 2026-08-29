// App-lifetime ownership of the *analysis* session (uploaded clip + pipeline).
//
// The Video Detection page is a view over this context, never the owner. That
// is what lets the user navigate to History/Report/Monitoring and come back to
// exactly the same clip, playback position, overlays and statistics.
//
// Memory rules:
//  - exactly one object URL is alive per analysis session; replacing the active
//    file revokes the previous URL immediately;
//  - the original File and the converted File are kept as references only (no
//    ArrayBuffer copies are retained);
//  - everything is released in reset(), which is the ONLY teardown path
//    ("New analysis", removing the video, or a tab reload which drops the JS
//    heap anyway).

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Detection } from "../inference/types";
import type { SemanticEvent } from "../drowsiness/types";
import type { TranscodeProgress } from "./video-transcoder";
import { disposeTranscoder } from "./video-transcoder";

export type PipelineStageId =
  | "upload"
  | "prepare"
  | "convert"
  | "engine"
  | "inference"
  | "report"
  | "save"
  | "complete";

export type PipelineStatus = "pending" | "active" | "done" | "skipped" | "error";

export interface PipelineStage {
  id: PipelineStageId;
  label: string;
  status: PipelineStatus;
  /** Current operation text shown under the stage label. */
  detail: string | null;
  /** 0..1 when the stage reports measurable progress, otherwise null. */
  progress: number | null;
  /** Wall clock at which the stage went active (ms epoch), null if not started. */
  startedAt: number | null;
  /** Measured wall time once the stage settled. This is the number that tells
   *  you where the delay actually went — never an estimate. */
  durationMs: number | null;
}

export const PIPELINE_STAGE_ORDER: { id: PipelineStageId; label: string }[] = [
  { id: "upload", label: "Uploading video" },
  { id: "prepare", label: "Preparing video" },
  { id: "convert", label: "Converting format" },
  { id: "engine", label: "Preparing AI engine" },
  { id: "inference", label: "Running AI inference" },
  { id: "report", label: "Generating driver report" },
  { id: "save", label: "Saving session" },
  { id: "complete", label: "Completed" },
];

function freshPipeline(): PipelineStage[] {
  return PIPELINE_STAGE_ORDER.map((s) => ({
    id: s.id,
    label: s.label,
    status: "pending" as PipelineStatus,
    detail: null,
    progress: null,
    startedAt: null,
    durationMs: null,
  }));
}


/** Everything the Video page needs to rebuild itself after a navigation. */
export interface AnalysisSessionState {
  /** File as picked by the user (never mutated). */
  originalFile: File | null;
  /** File actually fed to <video> — the original, or the transcoded MP4. */
  activeFile: File | null;
  /** Object URL for activeFile. Owned by this context. */
  objectUrl: string | null;
  /** True when activeFile came out of ffmpeg.wasm. */
  converted: boolean;
  fileError: string | null;
  transcode: TranscodeProgress | null;
  pipeline: PipelineStage[];
  /** Last detections drawn — restores the overlay after a navigation. */
  detections: Detection[];
  recentEvents: SemanticEvent[];
  /** Completed run: id of the persisted session (drives the report link). */
  lastSessionId: string | null;
  /** Processing statistics of the completed run, as shown on the page. */
  stats: AnalysisStats | null;
  /** True once a run finished for the current clip. */
  analysisComplete: boolean;
}

export interface AnalysisStats {
  framesProcessed: number;
  perclos: number;
  yawnRate: number;
  latencyMs: number;
  processedFps: number;
  engine: string;
  modelName: string;
  modelVersion: string;
}

export interface AnalysisSessionValue extends AnalysisSessionState {
  /** Register the user's pick; also revokes any previously held URL. */
  setOriginalFile: (file: File) => void;
  /** Set the file that <video> should play (original or converted). */
  setActiveFile: (file: File, opts?: { converted?: boolean }) => string;
  /** Drop the object URL without dropping the file (transcode-only path). */
  clearObjectUrl: () => void;
  setFileError: (msg: string | null) => void;
  setTranscode: (p: TranscodeProgress | null) => void;
  setStage: (id: PipelineStageId, patch: Partial<Omit<PipelineStage, "id" | "label">>) => void;
  resetPipeline: () => void;
  setDetections: (d: Detection[]) => void;
  setRecentEvents: (e: SemanticEvent[]) => void;
  completeRun: (input: { sessionId: string | null; stats: AnalysisStats | null }) => void;
  /** Playback position survives navigation without re-rendering the page. */
  playbackPositionRef: React.MutableRefObject<number>;
  /**
   * Live overlay state. Owned by the context (NOT by the page or the video
   * element) so bounding boxes, confidences and semantic labels survive a
   * navigation and are re-rendered the instant the page mounts again.
   */
  detectionsRef: React.MutableRefObject<Detection[]>;
  /** Index of the last frame handed to the model — survives navigation. */
  frameIndexRef: React.MutableRefObject<number>;
  /** True when the run was still active as the page unmounted (auto-resume). */
  resumeRef: React.MutableRefObject<boolean>;
  /** Persist in-flight telemetry (throttled) without ending the run. */
  setLiveStats: (stats: AnalysisStats | null) => void;
  /** Files already handed to ffmpeg — prevents transcode loops across nav. */
  transcodeAttemptedRef: React.MutableRefObject<Set<string>>;
  /** Tear the whole analysis session down and free every resource. */
  reset: () => void;
  hasSession: boolean;
}

const Ctx = createContext<AnalysisSessionValue | null>(null);

function initialState(): AnalysisSessionState {
  return {
    originalFile: null,
    activeFile: null,
    objectUrl: null,
    converted: false,
    fileError: null,
    transcode: null,
    pipeline: freshPipeline(),
    detections: [],
    recentEvents: [],
    lastSessionId: null,
    stats: null,
    analysisComplete: false,
  };
}

export function AnalysisSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AnalysisSessionState>(initialState);
  // Mirrored so revocation never depends on a stale closure.
  const objectUrlRef = useRef<string | null>(null);
  const playbackPositionRef = useRef(0);
  const detectionsRef = useRef<Detection[]>([]);
  const frameIndexRef = useRef(0);
  const resumeRef = useRef(false);
  const transcodeAttemptedRef = useRef<Set<string>>(new Set());

  const revoke = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const setOriginalFile = useCallback(
    (file: File) => {
      revoke();
      playbackPositionRef.current = 0;
      transcodeAttemptedRef.current = new Set();
      detectionsRef.current = [];
      frameIndexRef.current = 0;
      setState({
        ...initialState(),
        originalFile: file,
        pipeline: freshPipeline(),
      });
    },
    [revoke],
  );

  const setActiveFile = useCallback(
    (file: File, opts?: { converted?: boolean }) => {
      revoke();
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      playbackPositionRef.current = 0;
      setState((s) => ({
        ...s,
        activeFile: file,
        objectUrl: url,
        converted: opts?.converted ?? false,
      }));
      return url;
    },
    [revoke],
  );

  const clearObjectUrl = useCallback(() => {
    revoke();
    setState((s) => ({ ...s, objectUrl: null, activeFile: null }));
  }, [revoke]);

  const setFileError = useCallback((msg: string | null) => {
    setState((s) => ({ ...s, fileError: msg }));
  }, []);

  const setTranscode = useCallback((p: TranscodeProgress | null) => {
    setState((s) => ({ ...s, transcode: p }));
  }, []);

  const setStage = useCallback(
    (id: PipelineStageId, patch: Partial<Omit<PipelineStage, "id" | "label">>) => {
      setState((s) => ({
        ...s,
        pipeline: s.pipeline.map((st) => {
          if (st.id !== id) return st;
          const next = { ...st, ...patch };
          // Timings are derived here so every call site gets real measured
          // durations without having to remember to stopwatch itself.
          if (patch.status === "active" && st.status !== "active") {
            next.startedAt = Date.now();
            next.durationMs = null;
          }
          if (
            patch.status &&
            patch.status !== "active" &&
            patch.status !== "pending" &&
            st.status === "active" &&
            st.startedAt != null &&
            patch.durationMs === undefined
          ) {
            next.durationMs = Date.now() - st.startedAt;
          }
          if (patch.status === "pending") {
            next.startedAt = null;
            next.durationMs = null;
          }
          return next;
        }),
      }));
    },
    [],
  );


  const resetPipeline = useCallback(() => {
    setState((s) => ({ ...s, pipeline: freshPipeline() }));
  }, []);

  const setDetections = useCallback((d: Detection[]) => {
    setState((s) => ({ ...s, detections: d }));
  }, []);

  const setRecentEvents = useCallback((e: SemanticEvent[]) => {
    setState((s) => ({ ...s, recentEvents: e }));
  }, []);

  const setLiveStats = useCallback((stats: AnalysisStats | null) => {
    setState((s) => (s.stats === stats ? s : { ...s, stats }));
  }, []);

  const completeRun = useCallback(
    (input: { sessionId: string | null; stats: AnalysisStats | null }) => {
      setState((s) => ({
        ...s,
        lastSessionId: input.sessionId ?? s.lastSessionId,
        stats: input.stats ?? s.stats,
        analysisComplete: true,
      }));
    },
    [],
  );

  const reset = useCallback(() => {
    revoke();
    playbackPositionRef.current = 0;
    transcodeAttemptedRef.current = new Set();
    detectionsRef.current = [];
    frameIndexRef.current = 0;
    resumeRef.current = false;
    setState(initialState());
    // ffmpeg.wasm holds tens of MB; release it with the session.
    void disposeTranscoder();
  }, [revoke]);

  const value = useMemo<AnalysisSessionValue>(
    () => ({
      ...state,
      setOriginalFile,
      setActiveFile,
      clearObjectUrl,
      setFileError,
      setTranscode,
      setStage,
      resetPipeline,
      setDetections,
      setRecentEvents,
      completeRun,
      playbackPositionRef,
      detectionsRef,
      frameIndexRef,
      resumeRef,
      setLiveStats,
      transcodeAttemptedRef,
      reset,
      hasSession: !!state.originalFile,
    }),
    [
      state,
      setOriginalFile,
      setActiveFile,
      clearObjectUrl,
      setFileError,
      setTranscode,
      setStage,
      resetPipeline,
      setDetections,
      setRecentEvents,
      setLiveStats,
      completeRun,
      reset,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAnalysisSession(): AnalysisSessionValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAnalysisSession must be used inside <AnalysisSessionProvider>");
  return ctx;
}
