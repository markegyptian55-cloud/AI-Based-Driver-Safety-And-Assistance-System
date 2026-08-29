import { describe, expect, it } from "vitest";

import { EventAggregator } from "./event-aggregator";
import { MOUTH_DEFAULTS, readMouth } from "./mouth-state";
import type { Detection } from "../inference/types";
import type { ScoringConfig, SemanticEvent } from "./types";

function mouth(w: number, h: number, confidence = 0.8): Detection {
  return { classId: 2, label: "yawn", semantic: "yawn", confidence, bbox: [0.4, 0.6, w, h] };
}

const CFG: ScoringConfig = {
  windowMs: 10_000,
  eyeClosedMsThreshold: 400,
  microsleepMs: 500,
  criticalMicrosleepMs: 1500,
  drowsyPerclosThreshold: 0.4,
  yawnRatePerMinThreshold: 3,
  eventCooldownMs: 0,
  yawnMinAspect: MOUTH_DEFAULTS.yawnMinAspect,
  yawnConfThreshold: MOUTH_DEFAULTS.yawnConfThreshold,
  yawnStartMs: 400,
  yawnConfirmMs: 1200,
  longYawnMs: 2500,
  yawnGapMs: 500,
  yawnConfirmFrames: 2,
};

function makeAgg() {
  const events: SemanticEvent[] = [];
  const agg = new EventAggregator({ cfg: CFG, emit: (e) => events.push(e) });
  return { agg, events };
}

describe("readMouth", () => {
  it("accepts a moderately tall mouth box that the old 0.55 veto rejected", () => {
    expect(readMouth([mouth(0.1, 0.065)]).state).toBe("yawn_candidate");
  });

  it("still rejects a wide flat smile", () => {
    const r = readMouth([mouth(0.2, 0.04)]);
    expect(r.state).toBe("smile");
    expect(r.reject).toBe("low_aspect");
  });

  it("uses the driver baseline to accept a mid-aspect mouth", () => {
    const r = readMouth([mouth(0.1, 0.045)], MOUTH_DEFAULTS, 0.3);
    expect(r.state).toBe("yawn_candidate");
  });

  it("reports a confidence rejection", () => {
    expect(readMouth([mouth(0.1, 0.08, 0.1)]).reject).toBe("low_confidence");
  });
});

describe("yawn spell", () => {
  it("counts a yawn that is interrupted by one missing frame at low FPS", () => {
    const { agg, events } = makeAgg();
    const open = [mouth(0.1, 0.08)];
    // ~3 fps: 0, 333, (gap), 999, 1332
    agg.ingest(0, open);
    agg.ingest(333, open);
    agg.ingest(666, []); // dropped mouth box
    agg.ingest(999, open);
    agg.ingest(1332, open);
    expect(agg.closureStats().yawns).toBe(1);
    expect(events.some((e) => e.kind === "yawn")).toBe(true);
  });

  it("ends the spell when the mouth stays shut past the grace window", () => {
    const { agg } = makeAgg();
    const open = [mouth(0.1, 0.08)];
    agg.ingest(0, open);
    agg.ingest(300, open);
    agg.ingest(1200, []); // 900 ms gap > yawnGapMs
    agg.ingest(1400, open);
    expect(agg.closureStats().yawns).toBe(0);
  });

  it("does not confirm a yawn from a single frame", () => {
    const { agg } = makeAgg();
    agg.ingest(0, [mouth(0.1, 0.08)]);
    agg.ingest(2000, [mouth(0.1, 0.08)]);
    expect(agg.closureStats().yawns).toBe(1);
  });

  it("never counts a smile as a yawn", () => {
    const { agg } = makeAgg();
    const smile = [mouth(0.2, 0.04)];
    for (let t = 0; t <= 3000; t += 200) agg.ingest(t, smile);
    expect(agg.closureStats().yawns).toBe(0);
  });
});
