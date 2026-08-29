import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  RECOMMENDATION_LABEL,
  RISK_LABEL,
  type TrendDirection,
} from "@/features/fleet/safety-score";
import type { Recommendation, RiskLevel } from "@/features/fleet/types";

const RISK_CLASS: Record<RiskLevel, string> = {
  low: "border-safe/40 bg-safe/10 text-safe",
  moderate: "border-warn/40 bg-warn/10 text-warn",
  high: "border-destructive/40 bg-destructive/10 text-destructive",
  critical: "border-destructive bg-destructive/20 text-destructive",
};

export function RiskBadge({ level, className }: { level: RiskLevel; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-[10px] uppercase tracking-wider", RISK_CLASS[level], className)}
    >
      {RISK_LABEL[level]}
    </Badge>
  );
}

export function RecommendationBadge({ value }: { value: Recommendation }) {
  const tone =
    value === "excellent"
      ? "border-safe/40 text-safe"
      : value === "monitor"
        ? "border-border text-muted-foreground"
        : value === "needs_attention"
          ? "border-warn/40 text-warn"
          : "border-destructive/40 text-destructive";
  return (
    <Badge variant="outline" className={cn("text-[11px]", tone)}>
      {RECOMMENDATION_LABEL[value]}
    </Badge>
  );
}

export function TrendPill({ trend, pct }: { trend: TrendDirection; pct: number | null }) {
  const Icon =
    trend === "improving"
      ? ArrowDownRight
      : trend === "worsening"
        ? ArrowUpRight
        : trend === "stable"
          ? ArrowRight
          : Minus;
  const tone =
    trend === "improving"
      ? "text-safe"
      : trend === "worsening"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", tone)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="capitalize">{trend}</span>
      {pct !== null ? <span className="font-mono">{pct > 0 ? "+" : ""}{pct.toFixed(0)}%</span> : null}
    </span>
  );
}
