import { Card } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

export function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 text-center">
      <BarChart3 className="h-5 w-5 text-muted-foreground" />
      <p className="px-4 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function AnalyticsEmptyState({ filtered }: { filtered?: boolean }) {
  return (
    <Card className="border-dashed border-border/60 bg-card/40 p-8 text-center sm:p-10">
      <BarChart3 className="mx-auto h-7 w-7 text-muted-foreground" />
      <h2 className="mt-3 font-semibold">
        {filtered ? "No sessions match these filters" : "No analytics yet"}
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {filtered
          ? "Widen the driver, model, analysis type or date range to see stored session metrics."
          : "Analytics are computed from completed session summaries. Run a live or video detection session and its metrics appear here — nothing is re-inferred."}
      </p>
    </Card>
  );
}
