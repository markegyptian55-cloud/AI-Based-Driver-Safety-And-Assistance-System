// Session lifecycle + batched event logging. Injects its own persistence port
// so unit tests can swap in a memory implementation.

import type { InferenceResult } from "../inference/types";
import type { FrameSummary, RiskLevel, SemanticEvent } from "../drowsiness/types";
import type { FatigueLevel } from "../drowsiness/safety-score";
import { SessionStats, type AlertSeverity, type SessionSummary } from "./session-stats";
import type { SessionPipelineTrace } from "./pipeline-trace";

export interface SessionSnapshot {
  id: string;
  startedAt: number;
  framesProcessed: number;
  closedEyeEvents: number;
  yawnEvents: number;
  maxRisk: RiskLevel;
  avgFps: number;
  avgLatencyMs: number;
  perclos: number;
  provider: string;
  engine: string;
  modelName: string;
  modelVersion: string;
}

export interface SessionPort {
  createSession(input: {
    provider: string;
    engineKind: string;
    source: string;
    modelId: string | null;
    driverLabel: string;
    driverId?: string | null;
    deviceInfo: Record<string, unknown>;
  }): Promise<{ id: string }>;
  insertEvents(sessionId: string, events: PersistedEvent[]): Promise<void>;
  updateSession(sessionId: string, patch: Partial<PersistedSession>): Promise<void>;
  endSession(sessionId: string, patch: Partial<PersistedSession>): Promise<void>;
}

export interface PersistedEvent {
  t_ms: number;
  class_id: number;
  class_label: string;
  semantic_tag: string;
  confidence: number;
  bbox: unknown;
  risk_level: RiskLevel;
}

/** Speed figures for the run, persisted so trends can be charted later. */
export interface SessionTelemetry {
  fps_p50: number;
  fps_p95: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  infer_p50_ms: number;
  infer_p95_ms: number;
  drop_rate: number;
  dropped_frames: number;
  worst_stall_ms: number;
}

export interface PersistedSession extends SessionTelemetry {
  status: "running" | "completed" | "failed";
  frames_processed: number;
  closed_eye_events: number;
  yawn_events: number;
  max_risk_level: RiskLevel;
  avg_fps: number;
  avg_latency_ms: number;
  perclos: number;
  duration_sec: number;
  ended_at: string;
  processing_time_ms: number;
  total_frames: number;
  analysed_frames: number;
  open_eye_frames: number;
  closed_eye_frames: number;
  yawn_frames: number;
  eye_closure_ratio: number;
  yawn_per_min: number;
  total_alerts: number;
  alerts_low: number;
  alerts_medium: number;
  alerts_high: number;
  alerts_critical: number;
  longest_eye_closure_ms: number;
  avg_eye_closure_ms: number;
  fatigue_level: FatigueLevel;
  safety_score: number;
  risk_score: number;
  /** Performance trace (stage timings, conversion path, model cache). */
  pipeline: SessionPipelineTrace | null;
}

export class SessionRecorder {
  private snapshot: SessionSnapshot | null = null;
  private queue: PersistedEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private latencySum = 0;
  private latencyCount = 0;
  private fpsWindow: number[] = [];
  private stats = new SessionStats();
  private lastSummary: SessionSummary | null = null;
  private telemetry: SessionTelemetry | null = null;
  private pipelineTrace: SessionPipelineTrace | null = null;

  /** Speed figures measured by the capture profiler; recorded on end(). */
  setTelemetry(t: SessionTelemetry) {
    this.telemetry = t;
  }

  /** Stage timings + conversion path + model cache result for this run. */
  setPipelineTrace(trace: SessionPipelineTrace | null) {
    this.pipelineTrace = trace;
  }

  constructor(
    private port: SessionPort,
    private flushIntervalMs = 2000,
  ) {}

  getSnapshot(): SessionSnapshot | null {
    return this.snapshot;
  }

  /** Summary of the most recently completed session (null before it ends). */
  getSummary(): SessionSummary | null {
    return this.lastSummary;
  }

  async start(input: {
    provider: string;
    engineKind: string;
    modelId?: string | null;
    modelName: string;
    modelVersion: string;
    driverLabel?: string;
    driverId?: string | null;
    source: string;
    deviceInfo?: Record<string, unknown>;
  }): Promise<SessionSnapshot> {
    const { id } = await this.port.createSession({
      provider: input.provider,
      engineKind: input.engineKind,
      source: input.source,
      modelId: input.modelId ?? null,
      driverLabel: input.driverLabel ?? "Driver",
      driverId: input.driverId ?? null,
      deviceInfo: { ...pickDeviceInfo(), ...(input.deviceInfo ?? {}) },
    });
    this.snapshot = {
      id,
      startedAt: Date.now(),
      framesProcessed: 0,
      closedEyeEvents: 0,
      yawnEvents: 0,
      maxRisk: "safe",
      avgFps: 0,
      avgLatencyMs: 0,
      perclos: 0,
      provider: input.provider,
      engine: input.engineKind,
      modelName: input.modelName,
      modelVersion: input.modelVersion,
    };
    this.queue = [];
    this.latencySum = 0;
    this.latencyCount = 0;
    this.fpsWindow = [];
    this.stats.reset();
    this.lastSummary = null;
    this.pipelineTrace = null;
    this.flushTimer = setInterval(() => this.flush().catch(console.error), this.flushIntervalMs);
    return this.snapshot;
  }

  onResult(result: InferenceResult) {
    if (!this.snapshot) return;
    this.snapshot.framesProcessed++;
    // Reports call this "inference latency", so persist the model's actual
    // execution time rather than camera capture + bitmap transfer + UI delivery.
    // End-to-end latency remains available in the performance timeline.
    this.latencySum += result.meta.inferMs ?? result.meta.providerLatencyMs;
    this.latencyCount++;
    this.snapshot.avgLatencyMs = this.latencySum / this.latencyCount;
    this.snapshot.engine = result.meta.engine;
    const now = performance.now();
    this.fpsWindow.push(now);
    while (this.fpsWindow.length && this.fpsWindow[0] < now - 1000) this.fpsWindow.shift();
    this.snapshot.avgFps = this.fpsWindow.length;
  }

  /** Per-frame semantic summary produced by the drowsiness aggregator. */
  onFrameSummary(summary: FrameSummary) {
    if (!this.snapshot) return;
    this.stats.onFrame(summary);
  }

  /** Raw frames delivered by the source, including skipped ones. */
  setTotalFrames(n: number) {
    this.stats.setTotalFrames(n);
  }

  onEvent(event: SemanticEvent, contribution?: { detectionClassId?: number; detectionLabel?: string; bbox?: unknown }) {
    if (!this.snapshot) return;
    if (event.kind === "eye_closed_sustained") this.snapshot.closedEyeEvents++;
    if (event.kind === "yawn") this.snapshot.yawnEvents++;
    if (rank(event.riskLevel) > rank(this.snapshot.maxRisk)) {
      this.snapshot.maxRisk = event.riskLevel;
    }
    this.stats.onEvent(event);
    this.queue.push({
      t_ms: Math.max(0, event.ts - this.snapshot.startedAt),
      class_id: contribution?.detectionClassId ?? -1,
      class_label: contribution?.detectionLabel ?? event.kind,
      semantic_tag: event.kind,
      confidence: event.confidence,
      bbox: contribution?.bbox ?? null,
      risk_level: event.riskLevel,
    });
  }

  updatePerclos(perclos: number) {
    if (this.snapshot) this.snapshot.perclos = perclos;
  }

  async flush() {
    if (!this.snapshot || !this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    try {
      await this.port.insertEvents(this.snapshot.id, batch);
    } catch (err) {
      // Requeue on failure — never lose events silently.
      this.queue.unshift(...batch);
      throw err;
    }
  }

  async end(): Promise<SessionSnapshot | null> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    if (!this.snapshot) return null;
    await this.flush().catch(console.error);
    const duration = Math.round((Date.now() - this.snapshot.startedAt) / 1000);
    const summary = this.stats.summarize(duration);
    this.lastSummary = summary;
    await this.port.endSession(this.snapshot.id, {
      status: "completed",
      frames_processed: this.snapshot.framesProcessed,
      closed_eye_events: this.snapshot.closedEyeEvents,
      yawn_events: this.snapshot.yawnEvents,
      max_risk_level: this.snapshot.maxRisk,
      avg_fps: this.snapshot.avgFps,
      avg_latency_ms: this.snapshot.avgLatencyMs,
      perclos: this.snapshot.perclos,
      duration_sec: duration,
      ended_at: new Date().toISOString(),
      processing_time_ms: Math.round(this.latencySum),
      total_frames: summary.totalFrames,
      analysed_frames: summary.analysedFrames,
      open_eye_frames: summary.openEyeFrames,
      closed_eye_frames: summary.closedEyeFrames,
      yawn_frames: summary.yawnFrames,
      eye_closure_ratio: summary.eyeClosureRatio,
      yawn_per_min: summary.yawnPerMin,
      total_alerts: summary.totalAlerts,
      alerts_low: summary.alerts.low,
      alerts_medium: summary.alerts.medium,
      alerts_high: summary.alerts.high,
      alerts_critical: summary.alerts.critical,
      longest_eye_closure_ms: summary.longestEyeClosureMs,
      avg_eye_closure_ms: summary.avgEyeClosureMs,
      fatigue_level: summary.fatigueLevel,
      safety_score: summary.safetyScore,
      risk_score: summary.safetyScore,
      ...(this.telemetry ?? {}),
      ...(this.pipelineTrace ? { pipeline: this.pipelineTrace } : {}),
    });
    const done = this.snapshot;
    this.snapshot = null;
    return done;
  }
}

export type { AlertSeverity, SessionSummary };

function rank(r: RiskLevel): number {
  return r === "danger" ? 2 : r === "warn" ? 1 : 0;
}

function pickDeviceInfo(): Record<string, unknown> {
  if (typeof navigator === "undefined") return {};
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    languages: navigator.languages,
    hardwareConcurrency: navigator.hardwareConcurrency,
  };
}
