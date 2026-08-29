import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { History } from "lucide-react";

export function HistoryEmptyState({ filtered }: { filtered?: boolean }) {
  return (
    <Card className="border-dashed border-border/60 bg-card/40 p-8 text-center sm:p-10">
      <History className="mx-auto h-7 w-7 text-muted-foreground" />
      <h2 className="mt-3 font-semibold">
        {filtered ? "No sessions match your search" : "No driver sessions yet"}
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {filtered
          ? "Adjust the search term, filters or date range to find stored driver sessions."
          : "Completed driver sessions appear here with their safety score, fatigue level and alerts. Run a live or video analysis to record one."}
      </p>
      {!filtered && (
        <div className="mt-4 flex justify-center gap-2">
          <Button asChild variant="outline">
            <Link to="/live">Live detection</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/video">Video detection</Link>
          </Button>
        </div>
      )}
    </Card>
  );
}
