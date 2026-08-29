import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DriverReportView } from "@/components/report/driver-report-view";
import { fetchDriverReport } from "@/features/session/driver-report";
import { ExportPdfButton } from "@/components/report/export-pdf-button";

export const Route = createFileRoute("/_authenticated/report/$sessionId")({
  head: () => ({ meta: [{ title: "Driver report — SentryEye" }] }),
  component: ReportPage,
});

function ReportPage() {
  const { sessionId } = Route.useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["driver_report", sessionId],
    queryFn: () => fetchDriverReport(sessionId),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Driver report</h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            Session {sessionId}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {data ? <ExportPdfButton report={data} className="w-full sm:w-auto" /> : null}
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link to="/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to dashboard
            </Link>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card className="border-border/60 bg-card/60 p-8 text-sm text-muted-foreground">
          Loading report…
        </Card>
      ) : error ? (
        <Card className="border-destructive/40 bg-destructive/10 p-4 text-sm">
          {(error as Error).message}
        </Card>
      ) : !data ? (
        <Card className="border-border/60 bg-card/60 p-8 text-sm text-muted-foreground">
          This session was not found.
        </Card>
      ) : (
        <DriverReportView report={data} />
      )}
    </div>
  );
}
