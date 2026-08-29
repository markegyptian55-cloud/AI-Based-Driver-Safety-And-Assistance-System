import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DriverReportView } from "@/components/report/driver-report-view";
import { fetchLatestCompletedReport } from "@/features/session/driver-report";
import { useAuth } from "@/hooks/use-auth";
import { ErrorState } from "@/components/error-boundary";

export const Route = createFileRoute("/_authenticated/report/")({
  head: () => ({ meta: [{ title: "Driver report — SentryEye" }] }),
  component: LatestReportPage,
});

function LatestReportPage() {
  const { user } = useAuth();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["driver_report", "latest", user?.id],
    enabled: !!user?.id,
    queryFn: () => fetchLatestCompletedReport(user!.id),
  });

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Driver report</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your most recent completed driver session.
        </p>
      </div>

      {error ? (
        <ErrorState
          title="Couldn't load your latest report"
          error={error}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      ) : isLoading ? (
        <Card className="border-border/60 bg-card/60 p-8 text-sm text-muted-foreground">
          Loading report…
        </Card>
      ) : !data ? (
        <Card className="border-dashed border-border/60 bg-card/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No completed sessions yet. Run a live or video analysis to generate a driver report.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button asChild variant="outline">
              <Link to="/live">Live detection</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/video">Video detection</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <DriverReportView report={data} />
      )}
    </div>
  );
}
