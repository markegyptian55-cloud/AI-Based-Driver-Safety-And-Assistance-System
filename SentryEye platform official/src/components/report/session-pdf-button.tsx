import { useState } from "react";
import { FileDown, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  buildSessionDiagnosticPdf,
  sessionPdfFileName,
  type SessionPdfInput,
} from "@/features/report/session-pdf";
import { formatError } from "@/lib/format-error";

/**
 * Builds the session quality/diagnostics PDF from state already held in the
 * page — no inference, no network. Offers the native share sheet when the
 * device supports sharing files (phones), otherwise a plain download.
 */
export function SessionPdfButton({
  build,
  disabled,
  className,
  variant = "outline",
}: {
  build: () => SessionPdfInput;
  disabled?: boolean;
  className?: string;
  variant?: "default" | "outline" | "secondary";
}) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      const input = build();
      const doc = buildSessionDiagnosticPdf(input);
      const name = sessionPdfFileName(input.meta);
      const blob = doc.output("blob");
      const file = new File([blob], name, { type: "application/pdf" });
      const nav = navigator as Navigator & {
        canShare?: (data: { files?: File[] }) => boolean;
      };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: "SentryEye session report" });
        toast.success("Session report shared");
        return;
      }
      doc.save(name);
      toast.success("Session report downloaded");
    } catch (err) {
      const e = formatError(err);
      if (e.message.toLowerCase().includes("abort")) return;
      toast.error(`Could not build the session report: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const canShare =
    typeof navigator !== "undefined" &&
    Boolean((navigator as Navigator & { canShare?: unknown }).canShare);

  return (
    <Button onClick={handleClick} disabled={disabled || busy} variant={variant} className={className}>
      {busy ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : canShare ? (
        <Share2 className="mr-2 h-4 w-4" />
      ) : (
        <FileDown className="mr-2 h-4 w-4" />
      )}
      {busy ? "Building PDF…" : "Session PDF"}
    </Button>
  );
}
