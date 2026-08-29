// Yawn-specific timeline and summary.
//
// Eyes were always easy to trust: two boxes, obvious transitions. The mouth is
// the class that fails quietly, so this panel shows the whole audit trail —
// every mouth-open spell, confirmed or not, and the reason a rejected one was
// thrown away — next to the raw class-2 pipeline probe.

import { AlertTriangle, CheckCircle2, Wind } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { YawnEpisode, YawnRejectReason } from "@/features/drowsiness/types";
import { summarizeYawnEpisodes, yawnAuditVerdict } from "@/features/drowsiness/yawn-summary";
import type { YawnProbeFrame } from "@/features/inference/types";


const REASON_LABEL: Record<YawnRejectReason, string> = {
  confirmed: "confirmed",
  too_short: "too short",
  too_few_frames: "too few frames",
  low_confidence: "low confidence",
  low_aspect: "mouth too flat",
};

export function YawnPanel({
  episodes,
  probe,
  startedAt,
}: {
  episodes: YawnEpisode[];
  probe: YawnProbeFrame | null;
  /** Session start (ms) so episode times can be shown relative to the run. */
  startedAt?: number;
}) {
  const audit = summarizeYawnEpisodes(episodes);
  const recent = [...episodes].reverse().slice(0, 12);
  const t0 = startedAt ?? episodes[0]?.startTs ?? 0;

  return (
    <Card className="border-border/60 bg-card/60 p-4">
      <div className="flex items-center gap-2">
        <Wind className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Yawn detection</h3>
        <Badge variant="outline" className="ml-auto font-mono text-[10px]">
          {audit.confirmed} confirmed · {audit.rejected} rejected
        </Badge>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{yawnAuditVerdict(audit)}</p>


      {probe ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] sm:grid-cols-3">
          {(
            [
              ["Raw top score", probe.rawTop.toFixed(2)],
              ["Threshold", probe.appliedThreshold.toFixed(2)],
              ["Passed conf", String(probe.passedConf)],
              ["After NMS", String(probe.afterNms)],
              ["Raw anchors", String(probe.rawCount)],
              ["Dropped by dedupe", String(probe.suppressedCrossClass)],
            ] as Array<[string, string]>
          ).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt className="truncate text-muted-foreground">{k}</dt>
              <dd className="shrink-0 text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {recent.length ? (
        <ul className="mt-3 space-y-1">
          {recent.map((e, i) => (
            <li
              key={`${e.startTs}-${i}`}
              className="flex items-center gap-2 rounded-md border border-border/50 px-2 py-1.5 font-mono text-[11px]"
            >
              {e.confirmed ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="text-muted-foreground">
                {formatOffset(e.startTs - t0)}
              </span>
              <span className="text-foreground">{e.durationMs} ms</span>
              <span className="text-muted-foreground">{e.frames}f</span>
              <span className="text-muted-foreground">
                conf {e.peakConfidence.toFixed(2)} · ar {e.peakAspect.toFixed(2)}
              </span>
              <span className="ml-auto shrink-0 text-muted-foreground">
                {REASON_LABEL[e.reason]}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          No mouth-open spells yet. The raw score above tells you whether the model is seeing
          the mouth at all.
        </p>
      )}
    </Card>
  );
}

function formatOffset(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
