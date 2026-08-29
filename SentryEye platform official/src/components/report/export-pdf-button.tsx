import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { DriverReport } from "@/features/session/driver-report";
import { fetchSessionTimeline } from "@/features/session/session-timeline";
import { buildDriverReportPdf, driverReportFileName } from "@/features/report/pdf-report";
import { formatError } from "@/lib/format-error";

/**
 * Downloads a PDF built from the already-stored session data. No inference,
 * no re-analysis — only the persisted report plus its timeline events.
 */
export function ExportPdfButton({
  report,
  className,
}: {
  report: DriverReport;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      const events = await fetchSessionTimeline(report.sessionId);
      const doc = buildDriverReportPdf({ report, events });
      doc.save(driverReportFileName(report));
      toast.success("PDF report downloaded");
    } catch (err) {
      toast.error(`Could not generate the PDF: ${formatError(err).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={handleExport} disabled={busy} className={className}>
      {busy ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      {busy ? "Preparing PDF…" : "Export PDF"}
    </Button>
  );
}
