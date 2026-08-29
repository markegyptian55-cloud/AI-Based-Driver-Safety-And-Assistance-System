import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-boundary";
import { Badge } from "@/components/ui/badge";
import { Activity, Video, History, Brain, Cpu, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useRoles } from "@/hooks/use-roles";
import { supabase } from "@/integrations/supabase/client";
import { useModelSelection } from "@/hooks/use-model-selection";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — SentryEye" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();
  const { roles } = useRoles();
  const { selected: selectedModel } = useModelSelection();
  const email = user?.email ?? "";

  const agg_ = useQuery({
    queryKey: ["dashboard_agg", user?.id],
    enabled: !!user?.id,
    refetchInterval: 30_000,
    queryFn: async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const [sessions, events, danger] = await Promise.all([
        supabase
          .from("sessions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id)
          .gte("started_at", startOfDay.toISOString()),
        supabase
          .from("detection_events")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id),
        supabase
          .from("detection_events")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id)
          .eq("risk_level", "danger"),
      ]);
      return {
        sessionsToday: sessions.count ?? 0,
        totalEvents: events.count ?? 0,
        dangerEvents: danger.count ?? 0,
      };
    },
  });

  const recent_ = useQuery({
    queryKey: ["recent_sessions", user?.id],
    enabled: !!user?.id,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id,started_at,duration_sec,frames_processed,max_risk_level,provider,status,safety_score")
        .eq("user_id", user!.id)
        .order("started_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const agg = agg_.data;
  const recent = recent_.data;
  const loading = agg_.isLoading || recent_.isLoading;
  const loadError = agg_.error ?? recent_.error;

  const stats = [
    {
      label: "Sessions today",
      value: agg?.sessionsToday ?? "—",
      icon: Video,
      tone: "text-primary",
    },
    {
      label: "Danger alerts",
      value: agg?.dangerEvents ?? "—",
      icon: Activity,
      tone: "text-danger",
    },
    { label: "Total events", value: agg?.totalEvents ?? "—", icon: History, tone: "text-info" },
    {
      label: "Active model",
      value: selectedModel?.modelName ?? "—",
      icon: Brain,
      tone: "text-primary",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {user ? "Welcome back" : "Welcome"}
            <span className="text-primary">.</span>
          </h1>
          <p className="mt-1 truncate text-muted-foreground">
            {user ? (
              <>
                Signed in as <span className="font-mono">{email}</span>
              </>
            ) : (
              "Exploring as a visitor — every detection feature is unlocked."
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {roles.map((r) => (
            <Badge key={r} variant="outline" className="font-mono text-[10px] uppercase">
              {r}
            </Badge>
          ))}
        </div>
      </div>

      {loadError ? (
        <ErrorState
          title="Couldn't load your dashboard"
          error={loadError}
          onRetry={() => {
            void agg_.refetch();
            void recent_.refetch();
          }}
          retrying={agg_.isFetching || recent_.isFetching}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="border-border/60 bg-card/60 p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </div>
                {loading ? (
                  <Skeleton className="mt-2 h-8 w-20" />
                ) : (
                  <div className="mt-2 text-2xl font-semibold">{s.value}</div>
                )}
              </div>
              <s.icon className={`h-5 w-5 ${s.tone}`} />
            </div>
          </Card>
        ))}
      </div>

      <Card className="border-primary/20 bg-card/60 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Cpu className="h-4 w-4 shrink-0 text-primary" />
            <h2 className="truncate font-semibold">Browser inference online</h2>
          </div>
          <Link to="/live" className="shrink-0 text-sm text-primary hover:underline">
            Start a session <ArrowRight className="ml-1 inline h-3 w-3" />
          </Link>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Inference runs entirely on this device in a background worker (WebGPU with a
          WebAssembly fallback). Only detection events and session summaries are stored — video
          never leaves your machine.
        </p>
      </Card>

      <Card className="border-border/60 bg-card/60 p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Recent sessions</h2>
          <Link to="/history" className="text-xs text-muted-foreground hover:text-primary">
            View history →
          </Link>
        </div>
        {recent_.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : !recent || recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sessions yet — start a live or video analysis to see it here.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 font-mono text-xs">
            {recent.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                {s.status === "completed" ? (
                  <Link
                    to="/report/$sessionId"
                    params={{ sessionId: s.id }}
                    className="text-muted-foreground hover:text-primary"
                  >
                    {new Date(s.started_at).toLocaleString()}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">
                    {new Date(s.started_at).toLocaleString()}
                  </span>
                )}
                {s.safety_score != null ? (
                  <span className="text-muted-foreground">score {s.safety_score.toFixed(0)}</span>
                ) : null}
                <span>{s.provider}</span>
                <span className="text-muted-foreground">{s.frames_processed} frames</span>
                <span className="text-muted-foreground">
                  {s.duration_sec ? `${s.duration_sec}s` : "…"}
                </span>
                <Badge
                  variant="outline"
                  className={`ml-auto font-mono text-[10px] uppercase ${
                    s.max_risk_level === "danger"
                      ? "text-danger border-danger/40"
                      : s.max_risk_level === "warn"
                        ? "text-warn border-warn/40"
                        : "text-safe border-safe/40"
                  }`}
                >
                  {s.max_risk_level ?? "safe"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
