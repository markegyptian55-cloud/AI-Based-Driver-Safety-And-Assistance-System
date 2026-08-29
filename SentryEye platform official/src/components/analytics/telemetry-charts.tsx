// Speed trends across sessions.
//
// Kept apart from the safety charts on purpose: these say whether the run was
// measured reliably, not whether the driver was tired. Each chart plots the
// median and the 95th percentile together — the gap between the two is the
// stutter, and averaging it away is what makes "it felt laggy" unexplainable.

import { useState } from "react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartEmpty } from "./analytics-empty";
import {
  buildModelTelemetry,
  buildTelemetryTrend,
  type AnalyticsSession,
} from "@/features/analytics/analytics-data";

const AXIS = { stroke: "var(--muted-foreground)", fontSize: 11 } as const;

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--foreground)",
} as const;

const legendStyle = { fontSize: 11 } as const;

function ChartCard({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/60 bg-card/60 p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {empty ? (
        <ChartEmpty label="No telemetry recorded for the current filters." />
      ) : (
        children
      )}
    </Card>
  );
}

/** Per-metric visibility: with six lines on two charts, the interesting one
 *  is usually hidden behind the others. */
const METRICS = [
  { id: "fpsP50", label: "FPS p50" },
  { id: "fpsP95", label: "FPS p95" },
  { id: "latencyP50", label: "Latency p50" },
  { id: "latencyP95", label: "Latency p95" },
  { id: "inferP50", label: "Model p50" },
  { id: "dropPct", label: "Drop rate" },
] as const;

type MetricId = (typeof METRICS)[number]["id"];

export function TelemetryCharts({ sessions }: { sessions: AnalyticsSession[] }) {
  const trend = buildTelemetryTrend(sessions);
  const models = buildModelTelemetry(sessions);
  const empty = trend.length === 0;
  const [hidden, setHidden] = useState<MetricId[]>([]);
  const on = (id: MetricId) => !hidden.includes(id);
  const toggle = (id: MetricId) =>
    setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-border/60 bg-card/60 p-3 lg:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Metrics
          </span>
          {METRICS.map((m) => (
            <Button
              key={m.id}
              size="sm"
              variant={on(m.id) ? "secondary" : "ghost"}
              className="h-7 px-2.5 text-xs"
              onClick={() => toggle(m.id)}
              aria-pressed={on(m.id)}
            >
              {m.label}
            </Button>
          ))}
          <Badge variant="outline" className="ml-auto font-mono text-[10px]">
            {trend.length} sessions in range
          </Badge>
        </div>
      </Card>

      <ChartCard
        title="Frame rate trend"
        subtitle="Median and best-case FPS per session, oldest → newest"
        empty={empty}
      >
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
            <XAxis dataKey="label" {...AXIS} tickLine={false} />
            <YAxis {...AXIS} tickLine={false} width={44} unit=" fps" />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={legendStyle} />
{on("fpsP50") && (
            <Line
              type="monotone"
              dataKey="fpsP50"
              name="FPS p50"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={false}
            />
            )}
{on("fpsP95") && (
            <Line
              type="monotone"
              dataKey="fpsP95"
              name="FPS p95"
              stroke="var(--chart-2)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
            />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Latency trend"
        subtitle="End-to-end p50 vs p95 — the gap is the stutter"
        empty={empty}
      >
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
            <XAxis dataKey="label" {...AXIS} tickLine={false} />
            <YAxis {...AXIS} tickLine={false} width={52} unit=" ms" />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={legendStyle} />
{on("latencyP50") && (
            <Line
              type="monotone"
              dataKey="latencyP50"
              name="Latency p50"
              stroke="var(--chart-3)"
              strokeWidth={2}
              dot={false}
            />
            )}
{on("latencyP95") && (
            <Line
              type="monotone"
              dataKey="latencyP95"
              name="Latency p95"
              stroke="var(--chart-4)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
            />
            )}
{on("inferP50") && (
            <Line
              type="monotone"
              dataKey="inferP50"
              name="Model p50"
              stroke="var(--chart-5)"
              strokeWidth={1.5}
              dot={false}
            />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Dropped frames"
        subtitle="Share of delivered frames skipped to keep up"
        empty={empty}
      >
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
            <XAxis dataKey="label" {...AXIS} tickLine={false} />
            <YAxis {...AXIS} tickLine={false} width={44} unit="%" />
            <Tooltip contentStyle={tooltipStyle} />
{on("dropPct") && (
            <Line
              type="monotone"
              dataKey="dropPct"
              name="Drop rate"
              stroke="var(--chart-2)"
              strokeWidth={2}
              dot={false}
            />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <Card className="border-border/60 bg-card/60 p-4 sm:p-5">
        <div className="mb-4">
          <h3 className="font-semibold">Model comparison</h3>
          <p className="text-xs text-muted-foreground">
            Averages per model across the filtered sessions, fastest first
          </p>
        </div>
        {models.length === 0 ? (
          <ChartEmpty label="No telemetry recorded for the current filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left font-mono text-[10px] uppercase text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 text-right font-medium">Runs</th>
                  <th className="py-2 pr-3 text-right font-medium">FPS p50</th>
                  <th className="py-2 pr-3 text-right font-medium">Lat p95</th>
                  <th className="py-2 text-right font-medium">Drops</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.model} className="border-b border-border/40 last:border-0">
                    <td className="max-w-[180px] truncate py-2 pr-3">{m.model}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{m.sessions}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs text-primary">
                      {m.fpsP50.toFixed(1)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{m.latencyP95} ms</td>
                    <td className="py-2 text-right font-mono text-xs">
                      {m.dropPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
