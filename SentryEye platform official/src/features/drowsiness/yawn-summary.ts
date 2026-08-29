// Yawn audit statistics.
//
// Turns the raw episode trail into the numbers that tell you WHY yawns are or
// are not being detected in your lighting and at your distance: how many
// mouth-open spells were seen, how many became yawns, and which gate threw the
// rest away. The "confusion" here is spell-level, not pixel-level — it is the
// only ground truth available without a labelled set, and it is the number
// that actually moves when a threshold changes.
//
// Pure and DOM-free.

import type { YawnEpisode, YawnRejectReason } from "./types";

export interface YawnAudit {
  /** Every mouth-open spell the aggregator saw. */
  spells: number;
  confirmed: number;
  rejected: number;
  /** Share of spells that became yawns (0..1). */
  confirmRate: number;
  /** Rejections grouped by the gate that killed them. */
  byReason: Record<YawnRejectReason, number>;
  /** The gate responsible for most rejections, when there is one. */
  dominantFailure: YawnRejectReason | null;
  medianDurationMs: number;
  medianFrames: number;
  peakConfidence: number;
  medianAspect: number;
  medianBaseline: number;
  /** Worst near-misses: rejected spells sorted by how close they came. */
  topFailures: YawnEpisode[];
}

const EMPTY_REASONS: Record<YawnRejectReason, number> = {
  confirmed: 0,
  too_short: 0,
  too_few_frames: 0,
  low_confidence: 0,
  low_aspect: 0,
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function summarizeYawnEpisodes(episodes: YawnEpisode[]): YawnAudit {
  const byReason = { ...EMPTY_REASONS };
  const confirmed: YawnEpisode[] = [];
  const rejected: YawnEpisode[] = [];
  for (const e of episodes) {
    byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
    (e.confirmed ? confirmed : rejected).push(e);
  }

  let dominantFailure: YawnRejectReason | null = null;
  let worst = 0;
  for (const [reason, n] of Object.entries(byReason) as Array<[YawnRejectReason, number]>) {
    if (reason === "confirmed") continue;
    if (n > worst) {
      worst = n;
      dominantFailure = reason;
    }
  }

  // A near miss is a rejected spell that was long and confident — those are the
  // ones worth showing, because a small threshold change would flip them.
  const topFailures = [...rejected]
    .sort((a, b) => b.durationMs * b.peakConfidence - a.durationMs * a.peakConfidence)
    .slice(0, 5);

  return {
    spells: episodes.length,
    confirmed: confirmed.length,
    rejected: rejected.length,
    confirmRate: episodes.length ? confirmed.length / episodes.length : 0,
    byReason,
    dominantFailure,
    medianDurationMs: Math.round(median(episodes.map((e) => e.durationMs))),
    medianFrames: Math.round(median(episodes.map((e) => e.frames))),
    peakConfidence: episodes.reduce((m, e) => Math.max(m, e.peakConfidence), 0),
    medianAspect: Number(median(episodes.map((e) => e.peakAspect)).toFixed(3)),
    medianBaseline: Number(median(episodes.map((e) => e.baseline)).toFixed(3)),
    topFailures,
  };
}

/** One-line, human-readable verdict for the report and the live panel. */
export function yawnAuditVerdict(audit: YawnAudit): string {
  if (!audit.spells) {
    return "No mouth-open spells were observed — the mouth class never cleared the detector.";
  }
  if (!audit.rejected) {
    return `All ${audit.spells} mouth-open spells were confirmed as yawns.`;
  }
  const reason: Record<YawnRejectReason, string> = {
    confirmed: "",
    too_short: "spells ended before the confirm window",
    too_few_frames: "too few analysed frames per spell (raise capture FPS)",
    low_confidence: "mouth confidence stayed under the floor",
    low_aspect: "the mouth box stayed too flat (smile or camera angle)",
  };
  const cause = audit.dominantFailure ? reason[audit.dominantFailure] : "mixed causes";
  return `${audit.confirmed} of ${audit.spells} spells confirmed; most rejections were because ${cause}.`;
}
