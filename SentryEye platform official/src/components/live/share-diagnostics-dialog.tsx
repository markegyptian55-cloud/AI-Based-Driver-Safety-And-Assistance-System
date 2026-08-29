// One-tap shareable diagnostics link.
//
// The bundle is redacted on this device first, the user is shown exactly what
// was removed, and only then is it uploaded behind an unguessable token with a
// hard expiry. Nothing identifying leaves the browser.

import { useState } from "react";
import { Copy, Link2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createDiagnosticsShare } from "@/lib/diagnostics-share.functions";
import { redactDiagnostics } from "@/features/session/diagnostics-redact";
import type { DiagnosticsBundle } from "@/features/session/diagnostics-log";
import { formatError } from "@/lib/format-error";

const TTL_OPTIONS = [
  { value: "3600", label: "1 hour" },
  { value: "21600", label: "6 hours" },
  { value: "86400", label: "24 hours" },
  { value: "604800", label: "7 days" },
];

export function ShareDiagnosticsDialog({
  buildDiagnostics,
}: {
  buildDiagnostics: () => DiagnosticsBundle;
}) {
  const createShare = useServerFn(createDiagnosticsShare);
  const [open, setOpen] = useState(false);
  const [ttl, setTtl] = useState("86400");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);

  const preview = open ? redactDiagnostics(buildDiagnostics()) : null;

  async function generate() {
    setBusy(true);
    try {
      const redacted = redactDiagnostics(buildDiagnostics());
      const res = await createShare({
        data: {
          payload: redacted.bundle,
          redaction: redacted.removed,
          ttlSeconds: Number(ttl),
        },
      });
      const url = `${window.location.origin}/share/${res.token}`;
      setLink(url);
      setExpiresAt(res.expiresAt);
      setRemoved(redacted.removed);
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      toast.success("Share link created and copied");
    } catch (err) {
      toast.error(formatError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setLink(null);
          setExpiresAt(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Link2 className="mr-2 h-4 w-4" /> Share link
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share diagnostics</DialogTitle>
          <DialogDescription>
            Creates an expiring link to a redacted copy of this session's logs. No video frames are
            ever included.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Redacted before
              upload
            </div>
            <p className="mt-1 text-muted-foreground">
              {(link ? removed : (preview?.removed ?? [])).length
                ? (link ? removed : (preview?.removed ?? [])).join(", ")
                : "No identifying values were found in this log."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="share-ttl">Link expires after</Label>
            <Select value={ttl} onValueChange={setTtl} disabled={busy || Boolean(link)}>
              <SelectTrigger id="share-ttl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {link ? (
            <div className="space-y-2">
              <Label htmlFor="share-link">Shareable link</Label>
              <div className="flex gap-2">
                <input
                  id="share-link"
                  readOnly
                  value={link}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                />
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Copy link"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              {expiresAt ? (
                <p className="text-xs text-muted-foreground">
                  Expires {new Date(expiresAt).toLocaleString()} — the report is deleted after that.
                </p>
              ) : null}
            </div>
          ) : (
            <Button className="w-full" onClick={() => void generate()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
              {busy ? "Creating link…" : "Create expiring link"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
