// The product report, assembled from the same constants the runtime uses so it
// cannot drift from the shipped behaviour. Anything numeric here is imported,
// never retyped.

import { DESKTOP_PRESET, MOBILE_LOWLIGHT_PRESET } from "../inference/mobile-presets";
import { EVENT_TYPE_LABEL } from "../fleet/event-mapping";
import { DEFAULT_SCORING } from "../fleet/types";

export interface DocSection {
  id: string;
  title: string;
  summary: string;
  bullets: string[];
}

export interface MicroEventDoc {
  kind: string;
  persistedAs: string | null;
  severity: string;
  trigger: string;
}

/** Semantic events emitted by the aggregator and what each one becomes on sync. */
export const MICRO_EVENTS: MicroEventDoc[] = [
  {
    kind: "eye_closed_sustained",
    persistedAs: "eyes_closed",
    severity: "medium",
    trigger: `Eyes continuously closed past the closure threshold (${DESKTOP_PRESET.scoring.eyeClosedMsThreshold} ms desktop, ${MOBILE_LOWLIGHT_PRESET.scoring.eyeClosedMsThreshold} ms mobile/low light).`,
  },
  {
    kind: "microsleep",
    persistedAs: "microsleep",
    severity: "high",
    trigger: "Closure reaches the microsleep threshold (≥ 0.5 s). Wake-up alarm fires.",
  },
  {
    kind: "critical_microsleep",
    persistedAs: "microsleep",
    severity: "critical",
    trigger: "Closure reaches the critical threshold. Continuous alarm until the eyes reopen.",
  },
  {
    kind: "yawn_started",
    persistedAs: null,
    severity: "—",
    trigger: `Mouth open past the start threshold (${DESKTOP_PRESET.scoring.yawnStartMs} ms). Transient UI state, never stored.`,
  },
  {
    kind: "yawn",
    persistedAs: "yawning",
    severity: "low",
    trigger: `Mouth-open spell held past the confirm threshold (${DESKTOP_PRESET.scoring.yawnConfirmMs} ms) with yawn geometry, not a smile.`,
  },
  {
    kind: "long_yawn",
    persistedAs: "yawning",
    severity: "medium",
    trigger: `Confirmed yawn held past ${DESKTOP_PRESET.scoring.longYawnMs} ms — a strong fatigue signal.`,
  },
  {
    kind: "drowsy_yawn",
    persistedAs: "drowsiness",
    severity: "high",
    trigger: "A long yawn arriving while the risk state is already elevated.",
  },
  {
    kind: "drowsy",
    persistedAs: "drowsiness",
    severity: "high",
    trigger: "PERCLOS or yawn rate crosses the configured drowsiness thresholds.",
  },
  {
    kind: "alert_cleared",
    persistedAs: null,
    severity: "—",
    trigger: "Risk returns to safe. UI-only, so a recovery never inflates the event count.",
  },
];

/** Categories that reach the database, with their human labels. */
export const PERSISTED_EVENT_TYPES = Object.entries(EVENT_TYPE_LABEL).map(([type, label]) => ({
  type,
  label,
}));

export const SCORING_DOC = {
  weights: DEFAULT_SCORING.weights,
  caps: DEFAULT_SCORING.caps,
  thresholds: DEFAULT_SCORING.thresholds,
  formula:
    "score = 100 − Σ weightᵢ × min(1, indicatorᵢ / capᵢ) × 100, clamped to 0–100. Risk bands come from the organization thresholds; every classification carries the factor list that produced it.",
};

export const SYNC_STATES = [
  { state: "local", meaning: "Written to IndexedDB on the device. No network involved yet." },
  { state: "pending_sync", meaning: "Shift finalized and queued for upload." },
  { state: "syncing", meaning: "Upload in progress: shift → events → report, in dependency order." },
  { state: "synced", meaning: "Server accepted the idempotent upsert keyed on clientShiftId." },
  { state: "sync_error", meaning: "Upload failed. The drainer retries on reconnect; a retry can never create a second report." },
];

export const ENGINE_LADDER = [
  "WebGPU adapter probe (watchdog-guarded) → WGSL zero-copy letterbox preprocess",
  "Worker self-test on the created session rejects corrupt-output drivers",
  "WASM (SIMD + threads, self-hosted binaries) as the always-available floor",
  "Chosen engine and model are persisted, so the next boot skips re-probing",
  "Every attempt, and why it was rejected, is listed in the Diagnostics card",
];

export const ROLE_MATRIX = [
  {
    role: "Driver",
    can: "Live / Video / Image detection, automatic shift lifecycle, own shift reports and history, offline model downloads.",
    cannot: "See any other driver, edit a finalized report, reach manager pages.",
  },
  {
    role: "Manager",
    can: "Fleet KPIs from daily aggregates, driver detail with trends, reports feed with filters, sync health, audit log, notes.",
    cannot: "Run detection pages, change a computed score, act as a driver.",
  },
  {
    role: "Visitor",
    can: "Try live, video and image detection with no shift attached.",
    cannot: "Persist anything to the fleet, view reports or dashboards.",
  },
];

export const SECTIONS: DocSection[] = [
  {
    id: "inference",
    title: "On-device inference",
    summary:
      "All detection runs in the browser, in a Web Worker. Nothing about a frame leaves the device.",
    bullets: [
      "Two models only: yolo26n-480-fast and yolo26n-960-high, both fp32 (~10 MB), on every execution provider.",
      "Classes: closed_eye, open_eye, yawning. RGB, NCHW, letterbox padding, inverse-letterbox mapping back to display coordinates.",
      "Class-aware NMS with cross-class dedupe so a single eye never carries a stack of boxes.",
      `Confidence floors are per preset: ${DESKTOP_PRESET.confThreshold} desktop, ${MOBILE_LOWLIGHT_PRESET.confThreshold} mobile/low light, with IoU held at ${DESKTOP_PRESET.iouThreshold} in both.`,
      "Depth-2 pipelined loop, latest-frame-wins capture queue, adaptive duty-cycle scheduler and capture-resolution ladder, motion gate on still frames.",
      "A metrics HUD reports p50/p95 latency, inference vs preview FPS, queue occupancy and drop rate on Live and Video.",
    ],
  },
  {
    id: "quality",
    title: "Capture quality and calibration",
    summary: "Bad input is detected and explained before it becomes a bad report.",
    bullets: [
      "Quality score across lighting, blur, distance, occlusion, confidence and framerate, with the dominant reason and its fix.",
      "On-screen cues show where the problem is: framing ellipse, darkness veil, blur vignette.",
      "Low-light mode applies exposure, gain and frame-rate constraints to the camera track.",
      "Calibration wizard learns personal blink and yawn baselines; uploads are auto-calibrated from their first seconds through the same function.",
      "Calibration profiles sync to the account so they follow the driver across devices.",
    ],
  },
  {
    id: "fleet",
    title: "Shifts, scoring and the manager view",
    summary:
      "A driver's shift starts automatically and finalizes server-side, so the numbers cannot be influenced from the client.",
    bullets: [
      "finalize_shift() is a security-definer function: it computes the report, the daily aggregate and the audit row in one transaction.",
      "Reports are insert-once. Drivers have no UPDATE or DELETE path to a finalized report.",
      "Manager dashboards read driver_daily_stats, never raw events, and update over realtime with toasts and an unread badge.",
      "Drivers needing attention can be sorted by latest or by score and filtered by driver, risk level and date range.",
      "Audit log page covers signups, shift finalization and manager actions.",
    ],
  },
  {
    id: "offline",
    title: "Offline",
    summary: "The whole detection path works with no network at all.",
    bullets: [
      "Service worker caches the app shell in published tabs; previews unregister stale workers so cached code can never mask a fresh build.",
      "Models are cached in IndexedDB with resumable segmented downloads, checksum verification, per-model deletion and orphan purge.",
      "Shifts, events and reports are written locally first with a stable clientShiftId.",
      "A background drainer uploads queued shifts on reconnect; the manager sees fleet-wide sync health.",
      "The microsleep alarm is a WebAudio oscillator, so there is no asset to fetch when offline.",
    ],
  },
];
