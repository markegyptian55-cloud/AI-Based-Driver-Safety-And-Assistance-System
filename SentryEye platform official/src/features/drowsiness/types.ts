export type RiskLevel = "safe" | "warn" | "danger";

export interface ScoringConfig {
  /** Window (ms) for PERCLOS rolling average. */
  windowMs: number;
  /** Eye must be closed continuously for this many ms to count as a sustained closure. */
  eyeClosedMsThreshold: number;
  /** Continuous closure (ms) treated as a microsleep — the driver is asleep. */
  microsleepMs: number;
  /** Continuous closure (ms) treated as a critical microsleep (continuous alarm). */
  criticalMicrosleepMs: number;
  /** PERCLOS ratio that flips risk to danger. */
  drowsyPerclosThreshold: number;
  /** Yawns/min above this flip risk to warn. */
  yawnRatePerMinThreshold: number;
  /** Debounce window for emitting a "same" event again. */
  eventCooldownMs: number;

  // --- Yawn discrimination (all optional; sane defaults in the aggregator) ---
  /** Minimum mouth box height/width ratio to be a yawn rather than a smile. */
  yawnMinAspect?: number;
  /** Minimum detector confidence for the mouth class. */
  yawnConfThreshold?: number;
  /** Mouth must stay open this long before the yawn spell is even tracked. */
  yawnStartMs?: number;
  /** Held this long → a confirmed yawn event. */
  yawnConfirmMs?: number;
  /** Held this long → a long yawn, a strong fatigue signal. */
  longYawnMs?: number;
  /** A mouth-open spell survives this long without a mouth box before it ends. */
  yawnGapMs?: number;
  /** Minimum number of yawn-shaped frames needed to confirm a yawn. */
  yawnConfirmFrames?: number;
}

export type SemanticEventKind =
  | "eye_closed_sustained"
  | "microsleep"
  | "critical_microsleep"
  | "yawn_started"
  | "yawn"
  | "long_yawn"
  | "drowsy_yawn"
  | "drowsy"
  | "alert_cleared";

export interface SemanticEvent {
  kind: SemanticEventKind;
  ts: number;
  confidence: number;
  riskLevel: RiskLevel;
  metadata?: Record<string, unknown>;
}

export interface FrameSummary {
  ts: number;
  eyeClosed: boolean;
  eyeOpen: boolean;
  yawning: boolean;
  /** Diagnostic: which gate rejected the mouth box this frame. */
  mouthReject?: string;
  /** Mouth open but with smile geometry — explicitly NOT a yawn. */
  smiling?: boolean;
  /** Mouth box height/width ratio for the strongest mouth detection. */
  mouthAspect?: number;
  topEyeConf: number;
  topYawnConf: number;
}


/** Live fatigue counters exposed by the aggregator for the UI and the report. */
export interface ClosureStats {
  /** Frames analysed since the session started. */
  analysedFrames: number;
  /** Frames where the eyes were classified closed. */
  closedFrames: number;
  /** Frames in the current uninterrupted closure spell. */
  currentClosureFrames: number;
  /** Duration (ms) of the current uninterrupted closure spell. */
  currentClosureMs: number;
  /** Longest uninterrupted closure (ms) in the session. */
  longestClosureMs: number;
  /** Completed closure spells shorter than the microsleep threshold. */
  blinks: number;
  /** Closures that reached the microsleep threshold. */
  microsleeps: number;
  /** Closures that reached the critical microsleep threshold. */
  criticalMicrosleeps: number;
  /** Confirmed yawns (held past the confirm threshold). */
  yawns: number;
  /** Confirmed yawns that were also unusually long. */
  longYawns: number;
  /** Mouth-open spells rejected as smiles/talking by geometry or duration. */
  smilesRejected: number;
  /** Duration (ms) of the current mouth-open spell. */
  currentYawnMs: number;
  /** Diagnostics: aspect of the strongest mouth box on the last frame. */
  mouthAspect?: number;
  /** Diagnostics: learned resting mouth aspect for this driver. */
  mouthBaseline?: number;
  /** Diagnostics: confidence of the strongest mouth box on the last frame. */
  topMouthConf?: number;
  /** Diagnostics: yawn-shaped frames in the current spell. */
  yawnFrames?: number;
  /** Diagnostics: why the last mouth box was not a yawn. */
  mouthReject?: "none" | "no_box" | "low_confidence" | "low_aspect";
}

/** Why a mouth-open spell never became a confirmed yawn. */
export type YawnRejectReason =
  | "confirmed"
  | "too_short"
  | "too_few_frames"
  | "low_confidence"
  | "low_aspect";

/**
 * One mouth-open spell, confirmed or not. Rejected spells are kept on purpose:
 * they are the evidence needed to tune thresholds for a driver's lighting and
 * camera distance instead of guessing.
 */
export interface YawnEpisode {
  /** Spell start (ms, same clock as the events). */
  startTs: number;
  /** Last frame in the spell. */
  endTs: number;
  durationMs: number;
  /** Yawn-shaped frames observed in the spell. */
  frames: number;
  peakConfidence: number;
  peakAspect: number;
  baseline: number;
  confirmed: boolean;
  reason: YawnRejectReason;
}


