// Public viewer for a shared diagnostics bundle.
//
// No login: the 48-character token in the URL is the credential, and the link
// expires. Everything shown here was redacted on the reporter's device.

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Download, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { readDiagnosticsShare } from "@/lib/diagnostics-share.functions";

export const Route = createFileRoute("/share/$token")({
  head: () => ({
    meta: [
      { title: "Shared diagnostics — SentryEye" },
      {
        name: "description",
        content:
          "Redacted, expiring diagnostics report from a SentryEye drowsiness detection session.",
      },
      { property: "og:title", content: "Shared diagnostics — SentryEye" },
      {
        property: "og:description",
        content: "Redacted, expiring diagnostics report from a SentryEye session.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SharedDiagnosticsPage,
});

function SharedDiagnosticsPage() {
  const { token } = Route.useParams();
  const read = useServerFn(readDiagnosticsShare);
  const { data, isPending, error } = useQuery({
    queryKey: ["diagnostics-share", token],
    queryFn: () => read({ data: { token } }),
    retry: false,
  });

  return (
    <main className="mx-auto min-h-dvh w-full max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Shared diagnostics</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A redacted snapshot of one detection session. This link expires automatically.
      </p>

      {isPending ? (
        <Card className="mt-6 p-6 text-sm text-muted-foreground">Loading report…</Card>
      ) : error || !data || data.status !== "ok" ? (
        <Card
          className="mt-6 flex items-start gap-3 border-destructive/40 bg-destructive/10 p-5 text-sm"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <p>
            {data?.status === "expired"
              ? "This diagnostics link has expired and the report was deleted."
              : "This diagnostics link is invalid or no longer exists."}
          </p>
        </Card>
      ) : (
        <Report data={data} />
      )}
    </main>
  );
}

function Report({
  data,
}: {
  data: {
    payload: unknown;
    redaction: string[];
    createdAt: string;
    expiresAt: string;
  };
}) {
  const json = JSON.stringify(data.payload, null, 2);
  const bundle = data.payload as {
    meta?: Record<string, unknown>;
    device?: Record<string, unknown>;
    durationMs?: number;
    entries?: Array<{ t: number; level: string; kind: string; data?: Record<string, unknown> }>;
  };
  const entries = bundle.entries ?? [];

  return (
    <div className="mt-6 space-y-4">
      <Card className="flex flex-wrap items-center gap-3 border-primary/30 bg-primary/5 p-4 text-xs">
        <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="text-foreground">
          Redacted before upload: {data.redaction.length ? data.redaction.join(", ") : "nothing sensitive found"}.
        </span>
        <span className="ml-auto font-mono text-muted-foreground">
          expires {new Date(data.expiresAt).toLocaleString()}
        </span>
      </Card>

      <Card className="p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px] sm:grid-cols-3">
          {Object.entries({ ...(bundle.meta ?? {}), ...(bundle.device ?? {}) }).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt className="truncate text-muted-foreground">{k}</dt>
              <dd className="shrink-0 truncate text-foreground">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {entries.length} log entries
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([json], { type: "application/json" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "sentryeye-shared-diagnostics.json";
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 5000);
            }}
          >
            <Download className="mr-2 h-4 w-4" /> Download JSON
          </Button>
        </div>
        <ul className="mt-3 max-h-[28rem] space-y-1 overflow-auto font-mono text-[11px]">
          {entries.slice(-500).map((e, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-16 shrink-0 text-muted-foreground">{(e.t / 1000).toFixed(1)}s</span>
              <span
                className={
                  e.level === "error"
                    ? "w-12 shrink-0 text-destructive"
                    : e.level === "warn"
                      ? "w-12 shrink-0 text-warning"
                      : "w-12 shrink-0 text-muted-foreground"
                }
              >
                {e.level}
              </span>
              <span className="shrink-0 text-foreground">{e.kind}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {e.data ? JSON.stringify(e.data) : ""}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
