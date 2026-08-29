// Visual quality cues drawn over the live preview.
//
// Advisory only. Earlier revisions drew a dashed framing oval plus darkness /
// blur veils and implied the driver had to fit inside a guide before the model
// would run — that is wrong for a real cabin. The detector works off the
// detected eyes, wherever they are, so all that remains here is a small,
// unobtrusive status line naming the weakest factor and its fix.

import { AlertTriangle } from "lucide-react";
import type { QualityAssessment } from "@/features/session/detection-quality";
import { QUALITY_WARN_SCORE } from "@/features/session/detection-quality";

const REASON_HINT: Record<string, string> = {
  lighting: "Lighting is low",
  blur: "Picture is soft",
  distance: "Face is a little far",
  occlusion: "Eyes are hard to see",
  confidence: "Model is unsure about the eyes",
  framerate: "Few frames reach the model",
};

export function QualityCuesOverlay({
  assessment,
  visible = true,
}: {
  assessment: QualityAssessment | null;
  visible?: boolean;
}) {
  if (!assessment || !visible) return null;

  const { score, reason } = assessment;
  if (score >= QUALITY_WARN_SCORE || !reason) return null;

  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20">
      <div className="inline-flex max-w-full items-start gap-2 rounded-lg bg-background/85 px-2.5 py-1.5 text-[11px] text-foreground shadow-sm backdrop-blur">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span className="truncate">
          <strong className="font-semibold">
            Quality {Math.round(score)} — {REASON_HINT[reason.id] ?? reason.label}.
          </strong>{" "}
          {reason.fix}
        </span>
      </div>
    </div>
  );
}

