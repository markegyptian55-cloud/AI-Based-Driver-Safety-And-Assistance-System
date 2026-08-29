// Turns per-frame detections into debounced semantic events. Persists only
// meaningful transitions — never one row per frame.
//
// Closure state machine (all thresholds are configuration, never hardcoded):
//   closed >= eyeClosedMsThreshold  -> eye_closed_sustained (warn)
//   closed >= microsleepMs          -> microsleep (danger, wake-up alarm)
//   closed >= criticalMicrosleepMs  -> critical_microsleep (danger, continuous alarm)
// A spell that ends below the microsleep threshold is counted as a blink.

import type { Detection } from "../inference/types";
import { MOUTH_DEFAULTS, MouthBaseline, readMouth } from "./mouth-state";
import { PerclosWindow } from "./perclos";
import type {
  ClosureStats,
  FrameSummary,
  RiskLevel,
  ScoringConfig,
  SemanticEvent,
  YawnEpisode,
  YawnRejectReason,
} from "./types";


export interface AggregatorDeps {
  cfg: ScoringConfig;
  emit: (event: SemanticEvent) => void;
  /** Injectable clock for tests. */
  now?: () => number;
}

export class EventAggregator {
  private cfg: ScoringConfig;
  private emit: (e: SemanticEvent) => void;
  private now: () => number;
  private perclos: PerclosWindow;
  private eyeClosedSince: number | null = null;
  private lastEventAt = new Map<string, number>();
  private lastRisk: RiskLevel = "safe";
  private yawnTimestamps: number[] = [];

  // Closure counters (frames, spells, durations).
  private analysedFrames = 0;
  private closedFrames = 0;
  private currentClosureFrames = 0;
  private currentClosureMs = 0;
  private longestClosureMs = 0;
  private blinks = 0;
  private microsleeps = 0;
  private criticalMicrosleeps = 0;
  private spellReachedMicrosleep = false;
  private spellReachedCritical = false;
  /** True while the current closure spell is at or past the microsleep line. */
  private microsleepActive = false;

  // Mouth / yawn spell counters.
  private mouthOpenSince: number | null = null;
  private currentYawnMs = 0;
  private spellStarted = false;
  private spellConfirmedYawn = false;
  private spellLongYawn = false;
  private spellDrowsyYawn = false;
  private yawns = 0;
  private longYawns = 0;
  private smilesRejected = 0;
  private smileFrames = 0;
  /** Timestamp of the last frame that actually showed a yawn-shaped mouth. */
  private lastYawnFrameTs: number | null = null;
  /** Frames in the current spell that showed a yawn-shaped mouth. */
  private yawnFrames = 0;
  private mouthBaseline = new MouthBaseline();
  private lastMouth = { aspect: 0, confidence: 0, reject: "no_box" as string };
  /** Every mouth-open spell, confirmed or not — the yawn audit trail. */
  private episodes: YawnEpisode[] = [];
  private spellPeakConf = 0;
  private spellPeakAspect = 0;




  constructor(deps: AggregatorDeps) {
    this.cfg = deps.cfg;
    this.emit = deps.emit;
    this.now = deps.now ?? (() => performance.now());
    this.perclos = new PerclosWindow(deps.cfg.windowMs);
  }

  updateConfig(cfg: ScoringConfig) {
    this.cfg = cfg;
    this.perclos = new PerclosWindow(cfg.windowMs);
  }

  ingest(ts: number, detections: Detection[]): FrameSummary {
    const summary = summarize(ts, detections, this.cfg, this.mouthBaseline.value());
    this.perclos.add({ ts, closed: summary.eyeClosed });
    this.analysedFrames++;

    if (summary.eyeClosed) {
      this.closedFrames++;
      if (this.eyeClosedSince == null) {
        this.eyeClosedSince = ts;
        this.currentClosureFrames = 0;
        this.spellReachedMicrosleep = false;
        this.spellReachedCritical = false;
      }
      this.currentClosureFrames++;
      const dur = ts - this.eyeClosedSince;
      this.currentClosureMs = dur;
      if (dur > this.longestClosureMs) this.longestClosureMs = dur;

      if (dur >= this.cfg.criticalMicrosleepMs) {
        if (!this.spellReachedCritical) {
          this.spellReachedCritical = true;
          this.criticalMicrosleeps++;
        }
        this.microsleepActive = true;
        this.maybeEmit({
          kind: "critical_microsleep",
          ts,
          confidence: summary.topEyeConf,
          riskLevel: "danger",
          metadata: { durationMs: Math.round(dur), frames: this.currentClosureFrames },
        });
      } else if (dur >= this.cfg.microsleepMs) {
        if (!this.spellReachedMicrosleep) {
          this.spellReachedMicrosleep = true;
          this.microsleeps++;
        }
        this.microsleepActive = true;
        this.maybeEmit({
          kind: "microsleep",
          ts,
          confidence: summary.topEyeConf,
          riskLevel: "danger",
          metadata: { durationMs: Math.round(dur), frames: this.currentClosureFrames },
        });
      } else if (dur >= this.cfg.eyeClosedMsThreshold) {
        this.maybeEmit({
          kind: "eye_closed_sustained",
          ts,
          confidence: summary.topEyeConf,
          riskLevel: "warn",
          metadata: { durationMs: Math.round(dur), frames: this.currentClosureFrames },
        });
      }
    } else {
      if (this.eyeClosedSince != null && !this.spellReachedMicrosleep) this.blinks++;
      this.eyeClosedSince = null;
      this.currentClosureFrames = 0;
      this.currentClosureMs = 0;
      this.microsleepActive = false;
    }

    // Yawn spell state machine — the mouth-open counterpart of the microsleep
    // machine. A wide, short mouth (smile) never enters it, and a candidate that
    // does not stay open long enough is discarded as talking/laughing.
    this.ingestMouth(ts, summary);


    const risk = this.currentRisk();
    const prevRisk = this.lastRisk;
    if (risk !== prevRisk) {
      if (risk === "danger") {
        this.maybeEmit({
          kind: "drowsy",
          ts,
          confidence: this.perclos.ratio(),
          riskLevel: "danger",
          metadata: {
            perclos: this.perclos.ratio(),
            yawnsPerMin: this.yawnTimestamps.length,
          },
        });
      } else if (prevRisk === "danger") {
        this.maybeEmit({
          kind: "alert_cleared",
          ts,
          confidence: 1,
          riskLevel: risk,
        });
      }
      this.lastRisk = risk;
    }

    return summary;
  }

  /**
   * Yawn spell machine. A candidate must HOLD:
   *   held >= yawnStartMs   -> yawn_started (info/warn)
   *   held >= yawnConfirmMs -> yawn (warn), counted once per spell
   *   held >= longYawnMs    -> long_yawn (warn, strong fatigue signal)
   * Eyes closed during a confirmed yawn -> drowsy_yawn (danger + alarm).
   * A spell that ends before yawnStartMs is discarded as a smile/talking.
   */
  private ingestMouth(ts: number, summary: FrameSummary) {
    const startMs = this.cfg.yawnStartMs ?? 400;
    const confirmMs = this.cfg.yawnConfirmMs ?? 1200;
    const longMs = this.cfg.longYawnMs ?? 2500;
    // A single missing mouth box must not reset the spell: at 2-6 analysed FPS
    // one dropped frame used to restart the clock, so the confirm window was
    // never reached on a phone.
    const gapMs = this.cfg.yawnGapMs ?? 500;
    const confirmFrames = this.cfg.yawnConfirmFrames ?? 2;

    this.lastMouth = {
      aspect: summary.mouthAspect ?? 0,
      confidence: summary.topYawnConf,
      reject: summary.mouthReject ?? "no_box",
    };
    if (summary.smiling) this.smileFrames++;
    // Resting-mouth baseline learns only from non-yawn frames.
    if (!summary.yawning && summary.mouthAspect) this.mouthBaseline.push(summary.mouthAspect);

    if (!summary.yawning) {
      // Grace window: keep the spell alive through short dropouts.
      if (
        this.mouthOpenSince != null &&
        this.lastYawnFrameTs != null &&
        ts - this.lastYawnFrameTs <= gapMs
      ) {
        this.currentYawnMs = this.lastYawnFrameTs - this.mouthOpenSince;
        return;
      }
      if (this.mouthOpenSince != null) {
        if (!this.spellConfirmedYawn) this.smilesRejected++;
        this.recordEpisode(startMs, confirmMs, confirmFrames);
      }
      this.mouthOpenSince = null;
      this.lastYawnFrameTs = null;
      this.yawnFrames = 0;
      this.currentYawnMs = 0;
      this.spellStarted = false;
      this.spellConfirmedYawn = false;
      this.spellLongYawn = false;
      this.spellDrowsyYawn = false;
      this.spellPeakConf = 0;
      this.spellPeakAspect = 0;
      return;
    }

    if (this.mouthOpenSince == null) {
      this.mouthOpenSince = ts;
      this.yawnFrames = 0;
      this.spellPeakConf = 0;
      this.spellPeakAspect = 0;
    }
    this.lastYawnFrameTs = ts;
    this.yawnFrames++;
    this.spellPeakConf = Math.max(this.spellPeakConf, summary.topYawnConf);
    this.spellPeakAspect = Math.max(this.spellPeakAspect, summary.mouthAspect ?? 0);
    const held = ts - this.mouthOpenSince;
    this.currentYawnMs = held;


    if (!this.spellStarted && held >= startMs) {
      this.spellStarted = true;
      this.maybeEmit({
        kind: "yawn_started",
        ts,
        confidence: summary.topYawnConf,
        riskLevel: "safe",
        metadata: { heldMs: Math.round(held), mouthAspect: summary.mouthAspect ?? null },
      });
    }

    if (!this.spellConfirmedYawn && held >= confirmMs && this.yawnFrames >= confirmFrames) {
      this.spellConfirmedYawn = true;
      this.yawns++;
      this.yawnTimestamps.push(ts);
      const cutoff = ts - 60_000;
      while (this.yawnTimestamps.length && this.yawnTimestamps[0] < cutoff) {
        this.yawnTimestamps.shift();
      }
      this.maybeEmit({
        kind: "yawn",
        ts,
        confidence: summary.topYawnConf,
        riskLevel: "warn",
        metadata: {
          durationMs: Math.round(held),
          mouthAspect: summary.mouthAspect ?? null,
          yawnsPerMin: this.yawnTimestamps.length,
        },
      });
    }

    if (this.spellConfirmedYawn && !this.spellLongYawn && held >= longMs) {
      this.spellLongYawn = true;
      this.longYawns++;
      this.maybeEmit({
        kind: "long_yawn",
        ts,
        confidence: summary.topYawnConf,
        riskLevel: "warn",
        metadata: { durationMs: Math.round(held) },
      });
    }

    // Yawning alone is a warning; yawning with the eyes closing is danger.
    if (this.spellConfirmedYawn && summary.eyeClosed && !this.spellDrowsyYawn) {
      this.spellDrowsyYawn = true;
      this.maybeEmit({
        kind: "drowsy_yawn",
        ts,
        confidence: Math.max(summary.topYawnConf, summary.topEyeConf),
        riskLevel: "danger",
        metadata: {
          durationMs: Math.round(held),
          closureMs: Math.round(this.currentClosureMs),
        },
      });
    }
  }

  /**
   * Files the spell that just ended. Rejected spells are kept with the reason
   * that killed them so thresholds can be tuned from evidence, not guesswork.
   */
  private recordEpisode(startMs: number, confirmMs: number, confirmFrames: number) {
    const start = this.mouthOpenSince;
    const end = this.lastYawnFrameTs ?? start;
    if (start == null || end == null) return;
    const durationMs = Math.max(0, end - start);
    let reason: YawnRejectReason = "confirmed";
    if (!this.spellConfirmedYawn) {
      if (durationMs < startMs) reason = "too_short";
      else if (this.yawnFrames < confirmFrames) reason = "too_few_frames";
      else if (durationMs < confirmMs) reason = "too_short";
      else reason = "low_confidence";
    }
    this.episodes.push({
      startTs: start,
      endTs: end,
      durationMs: Math.round(durationMs),
      frames: this.yawnFrames,
      peakConfidence: this.spellPeakConf,
      peakAspect: this.spellPeakAspect,
      baseline: this.mouthBaseline.value(),
      confirmed: this.spellConfirmedYawn,
      reason,
    });
    // Bounded: a long session must not grow this without limit.
    if (this.episodes.length > 500) this.episodes.shift();
  }

  /** Full yawn audit trail (confirmed and rejected spells). */
  yawnEpisodes(): YawnEpisode[] {
    return [...this.episodes];
  }

  /** True while a confirmed yawn overlaps an eye closure. */
  isDrowsyYawnActive() {
    return this.spellDrowsyYawn;
  }


  currentRisk(): RiskLevel {
    const perclos = this.perclos.ratio();
    const yawnRate = this.yawnTimestamps.length; // yawns/min
    if (this.microsleepActive) return "danger";
    if (this.spellDrowsyYawn) return "danger";
    if (perclos >= this.cfg.drowsyPerclosThreshold) return "danger";
    if (yawnRate >= this.cfg.yawnRatePerMinThreshold) return "warn";
    if (this.spellConfirmedYawn) return "warn";
    if (this.eyeClosedSince != null) return "warn";
    return "safe";
  }

  perclosRatio() {
    return this.perclos.ratio();
  }

  yawnRatePerMin() {
    return this.yawnTimestamps.length;
  }

  /** Snapshot of the closure counters for the live UI and the driver report. */
  closureStats(): ClosureStats {
    return {
      analysedFrames: this.analysedFrames,
      closedFrames: this.closedFrames,
      currentClosureFrames: this.currentClosureFrames,
      currentClosureMs: Math.round(this.currentClosureMs),
      longestClosureMs: Math.round(this.longestClosureMs),
      blinks: this.blinks,
      microsleeps: this.microsleeps,
      criticalMicrosleeps: this.criticalMicrosleeps,
      yawns: this.yawns,
      longYawns: this.longYawns,
      smilesRejected: this.smilesRejected,
      currentYawnMs: Math.round(this.currentYawnMs),
      mouthAspect: this.lastMouth.aspect,
      mouthBaseline: this.mouthBaseline.value(),
      topMouthConf: this.lastMouth.confidence,
      yawnFrames: this.yawnFrames,
      mouthReject: this.lastMouth.reject as ClosureStats["mouthReject"],
    };
  }

  /** True while the driver's eyes are closed past the microsleep threshold. */
  isMicrosleepActive() {
    return this.microsleepActive;
  }

  reset() {
    this.perclos.reset();
    this.eyeClosedSince = null;
    this.yawnTimestamps = [];
    this.lastEventAt.clear();
    this.lastRisk = "safe";
    this.analysedFrames = 0;
    this.closedFrames = 0;
    this.currentClosureFrames = 0;
    this.currentClosureMs = 0;
    this.longestClosureMs = 0;
    this.blinks = 0;
    this.microsleeps = 0;
    this.criticalMicrosleeps = 0;
    this.spellReachedMicrosleep = false;
    this.spellReachedCritical = false;
    this.microsleepActive = false;
    this.mouthOpenSince = null;
    this.currentYawnMs = 0;
    this.spellStarted = false;
    this.spellConfirmedYawn = false;
    this.spellLongYawn = false;
    this.spellDrowsyYawn = false;
    this.yawns = 0;
    this.longYawns = 0;
    this.smilesRejected = 0;
    this.smileFrames = 0;
    this.lastYawnFrameTs = null;
    this.yawnFrames = 0;
    this.mouthBaseline.reset();
    this.lastMouth = { aspect: 0, confidence: 0, reject: "no_box" };
    this.episodes = [];
    this.spellPeakConf = 0;
    this.spellPeakAspect = 0;

  }

  private maybeEmit(e: SemanticEvent) {
    const last = this.lastEventAt.get(e.kind) ?? 0;
    if (e.ts - last < this.cfg.eventCooldownMs) return;
    this.lastEventAt.set(e.kind, e.ts);
    this.emit(e);
  }
}

function summarize(
  ts: number,
  detections: Detection[],
  cfg: ScoringConfig,
  baseline = 0,
): FrameSummary {
  let topEyeClosed = 0;
  let topEyeOpen = 0;
  for (const d of detections) {
    if (d.semantic === "eye_closed") topEyeClosed = Math.max(topEyeClosed, d.confidence);
    else if (d.semantic === "eye_open") topEyeOpen = Math.max(topEyeOpen, d.confidence);
  }
  const mouth = readMouth(
    detections,
    {
      yawnMinAspect: cfg.yawnMinAspect ?? MOUTH_DEFAULTS.yawnMinAspect,
      yawnConfThreshold: cfg.yawnConfThreshold ?? MOUTH_DEFAULTS.yawnConfThreshold,
      baselineMultiplier: MOUTH_DEFAULTS.baselineMultiplier,
      obviousYawnAspect: MOUTH_DEFAULTS.obviousYawnAspect,
    },
    baseline,
  );
  return {
    ts,
    eyeClosed: topEyeClosed > topEyeOpen && topEyeClosed > 0,
    eyeOpen: topEyeOpen >= topEyeClosed && topEyeOpen > 0,
    yawning: mouth.state === "yawn_candidate",
    smiling: mouth.state === "smile",
    mouthAspect: mouth.aspect,
    mouthReject: mouth.reject,
    topEyeConf: Math.max(topEyeClosed, topEyeOpen),
    topYawnConf: mouth.confidence,
  };
}

