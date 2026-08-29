import { Card } from "@/components/ui/card";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartEmpty } from "./analytics-empty";
import {
  buildAlertDistribution,
  buildTrend,
  fatigueFromRank,
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
      {empty ? <ChartEmpty label="No data for the current filters." /> : children}
    </Card>
  );
}

export function AnalyticsCharts({ sessions }: { sessions: AnalyticsSession[] }) {
  const trend = buildTrend(sessions);
  const alerts = buildAlertDistribution(sessions);
  const empty = trend.length === 0;
  const noAlerts = alerts.every((a) => a.count === 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Safety score trend"
        subtitle="Score per completed session, oldest → newest"
        empty={empty}
      >
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="safetyFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" {...AXIS} tickLine={false} />
            <YAxis domain={[0, 100]} {...AXIS} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area
              type="monotone"
              dataKey="safetyScore"
              name="Safety score"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#safetyFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Fatigue trend"
        subtitle="Fatigue level progression (low → critical)"
        empty={empty}
      >
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" {...AXIS} tickLine={false} />
            <YAxis
              domain={[0, 3]}
              ticks={[0, 1, 2, 3]}
              tickFormatter={(v: number) => fatigueFromRank(v)}
              width={70}
              {...AXIS}
              tickLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number) => [fatigueFromRank(v), "Fatigue"]}
            />
            <Line
              type="stepAfter"
              dataKey="fatigueRank"
              name="Fatigue"
              stroke="var(--chart-3)"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Alert distribution"
        subtitle="Alerts by severity across filtered sessions"
        empty={empty || noAlerts}
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={alerts} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" {...AXIS} tickLine={false} />
            <YAxis allowDecimals={false} {...AXIS} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.3 }} />
            <Bar dataKey="count" name="Alerts" radius={[4, 4, 0, 0]}>
              {alerts.map((a) => (
                <Cell
                  key={a.severity}
                  fill={
                    a.severity === "critical"
                      ? "var(--danger)"
                      : a.severity === "high"
                        ? "var(--chart-4)"
                        : a.severity === "medium"
                          ? "var(--warn)"
                          : "var(--chart-2)"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Eye closure ratio"
        subtitle="PERCLOS per completed session (%)"
        empty={empty}
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" {...AXIS} tickLine={false} />
            <YAxis unit="%" {...AXIS} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.3 }} />
            <Bar
              dataKey="eyeClosureRatio"
              name="Eye closure"
              unit="%"
              fill="var(--chart-5)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Yawning frequency"
        subtitle="Yawns per minute, per completed session"
        empty={empty}
      >
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" {...AXIS} tickLine={false} />
            <YAxis {...AXIS} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line
              type="monotone"
              dataKey="yawnPerMin"
              name="Yawns / min"
              stroke="var(--chart-2)"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
