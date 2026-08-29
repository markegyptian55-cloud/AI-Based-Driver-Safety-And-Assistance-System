import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ManagerOnly } from "@/components/fleet/manager-only";
import { fetchAuditFeed } from "@/lib/manager.functions";

const PAGE = 50;
const RESERVED_MANAGER_EMAIL = "markegyptian55@gmail.com";

const ACTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All activity" },
  { value: "auth.signin", label: "Sign-ins" },
  { value: "auth.signup", label: "Sign-ups" },
  { value: "manager.access_granted", label: "Manager access allowed" },
  { value: "manager.access_denied", label: "Manager access denied" },
  { value: "manager.dashboard_refresh", label: "Dashboard refreshes" },
  { value: "shift.finalized", label: "Shifts finalized" },
];

export const Route = createFileRoute("/_authenticated/manager/audit")({
  head: () => ({
    meta: [
      { title: "Fleet activity log — sign-ins and access checks | SentryEye" },
      {
        name: "description",
        content:
          "Manager activity log: account sign-ins, manager access checks, dashboard refreshes and finalized shifts, filterable by action and date.",
      },
      { property: "og:title", content: "Fleet activity log — SentryEye" },
      {
        property: "og:description",
        content: "Sign-ins, manager access checks and dashboard refresh history for the fleet.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ManagerOnly>
      <AuditPage />
    </ManagerOnly>
  ),
});

function AuditPage() {
  const load = useServerFn(fetchAuditFeed);
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [showOwn, setShowOwn] = useState(false);

  const feed = useQuery({
    queryKey: ["manager-audit", action, from, to, page],
    queryFn: () =>
      load({
        data: {
          limit: PAGE,
          offset: page * PAGE,
          action: action || null,
          from: from ? new Date(from).toISOString() : null,
          to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
        },
      }),
    refetchInterval: 60_000,
  });

  const allRows = feed.data?.items ?? [];
  // The manager's own activity is not driver activity; it is hidden unless
  // explicitly requested so the log reads as a fleet log.
  const rows = showOwn
    ? allRows
    : allRows.filter(
        (r) => (r.actorEmail ?? "").toLowerCase() !== RESERVED_MANAGER_EMAIL,
      );
  const total = feed.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const reset = (fn: () => void) => {
    fn();
    setPage(0);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Activity log</h1>
          <p className="text-sm text-muted-foreground">
            Sign-ins, manager access checks, dashboard refreshes and finalized shifts.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void feed.refetch()} disabled={feed.isFetching}>
          {feed.isFetching ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Refresh
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="audit-action">Action</Label>
            <select
              id="audit-action"
              value={action}
              onChange={(e) => reset(() => setAction(e.target.value))}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-from">From</Label>
            <Input
              id="audit-from"
              type="date"
              value={from}
              onChange={(e) => reset(() => setFrom(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-to">To</Label>
            <Input
              id="audit-to"
              type="date"
              value={to}
              onChange={(e) => reset(() => setTo(e.target.value))}
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-3">
            <input
              id="audit-own"
              type="checkbox"
              checked={showOwn}
              onChange={(e) => setShowOwn(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <Label htmlFor="audit-own" className="text-sm font-normal">
              Include my own manager activity
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {total} {total === 1 ? "entry" : "entries"}
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <span className="font-mono">
              {page + 1} / {pages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !feed.isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No activity for these filters.
                  </td>
                </tr>
              ) : null}
              {rows.map((r) => {
                const denied = r.action === "manager.access_denied";
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-border/50 ${denied ? "bg-destructive/10" : ""}`}
                  >
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">{r.actorEmail ?? "—"}</td>
                    <td className={`px-4 py-2 font-medium ${denied ? "text-destructive" : ""}`}>
                      {labelFor(r.action)}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {r.targetType ?? "—"}
                    </td>
                    <td className="max-w-[22rem] truncate px-4 py-2 font-mono text-xs text-muted-foreground">
                      {summarise(r.metadata)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function labelFor(action: string) {
  return ACTIONS.find((a) => a.value === action)?.label ?? action;
}

function summarise(meta: Record<string, string | number | boolean | null>) {
  const entries = Object.entries(meta).filter(([, v]) => v !== null && v !== "");
  if (!entries.length) return "—";
  return entries.map(([k, v]) => `${k}=${String(v)}`).join(" · ");
}
