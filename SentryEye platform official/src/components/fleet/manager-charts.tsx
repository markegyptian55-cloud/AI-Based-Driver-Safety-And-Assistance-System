// Manager analytics grid. Everything here is derived from the daily stats the
// dashboard already loads — no extra queries, no new tables.

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyStatRow, DriverSummary } from "@/features/fleet/fleet-data";
import { RISK_ORDER } from "@/features/fleet/safety-score";
import type { RiskLevel } from "@/features/fleet/types";

const AXIS = { fontSize: 11 } as const;

const RISK_COLOR: Record<RiskLevel, string> = {
  low: "var(--chart-2)",
  moderate: "var(--warn)",
  high: "var(--chart-4)",
  critical: "var(--danger)",
};

function firstName(name: string) {
  return name.split(" ")[0] ?? name;
}

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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="h-64">
        {empty ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No data for the selected period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export function ManagerCharts({
  rows,
  summaries,
}: {
  rows: DailyStatRow[];
  summaries: DriverSummary[];
}) {
  // ---- daily aggregation -------------------------------------------------
  const byDay = new Map<
    string,
    {
      date: string;
      score: number;
      n: number;
      drowsiness: number;
      eyesClosed: number;
      yawning: number;
      phone: number;
      critical: number;
      hours: number;
      shifts: number;
    }
  >();
  for (const r of rows) {
    const d = byDay.get(r.date) ?? {
      date: r.date,
      score: 0,
      n: 0,
      drowsiness: 0,
      eyesClosed: 0,
      yawning: 0,
      phone: 0,
      critical: 0,
      hours: 0,
      shifts: 0,
    };
    d.score += r.safetyScore;
    d.n += 1;
    d.drowsiness += r.drowsinessEvents;
    d.eyesClosed += r.eyesClosedEvents;
    d.yawning += r.yawningEvents;
    d.phone += r.phoneUsageEvents;
    d.critical += r.criticalEvents;
    d.hours += r.monitoredSeconds / 3600;
    d.shifts += r.completedShifts;
    byDay.set(r.date, d);
  }
  const daily = [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      label: d.date.slice(5),
      score: Math.round(d.score / Math.max(d.n, 1)),
      hours: Number(d.hours.toFixed(1)),
    }));

  const ranked = [...summaries].sort((a, b) => b.safetyScore - a.safetyScore);
  const safest = ranked.slice(0, 5).map((s) => ({
    name: firstName(s.fullName),
    score: Math.round(s.safetyScore),
  }));
  const riskiest = ranked
    .slice(-5)
    .reverse()
    .map((s) => ({
      name: firstName(s.fullName),
      score: Math.round(s.safetyScore),
      risk: s.riskLevel,
    }));

  const riskMix = RISK_ORDER.map((level) => ({
    name: level,
    value: summaries.filter((s) => s.riskLevel === level).length,
  })).filter((d) => d.value > 0);

  const perDay = [...summaries]
    .map((s) => ({ name: firstName(s.fullName), rate: Number(s.avgAlertsPerDay.toFixed(2)) }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 8);

  const noDaily = daily.length === 0;
  const noDrivers = summaries.length === 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Fleet safety score trend"
        subtitle="Average score across all drivers, per day"
        empty={noDaily}
      >
        <LineChart data={daily}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis domain={[0, 100]} {...AXIS} />
          <Tooltip />
          <Line type="monotone" dataKey="score" name="Safety score" stroke="var(--chart-1)" dot={false} strokeWidth={2} />
        </LineChart>
      </ChartCard>

      <ChartCard
        title="Event mix over time"
        subtitle="Drowsiness, eyes closed, yawning and phone use per day"
        empty={noDaily}
      >
        <AreaChart data={daily}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis allowDecimals={false} {...AXIS} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" stackId="1" dataKey="drowsiness" name="Drowsiness" stroke="var(--danger)" fill="var(--danger)" fillOpacity={0.35} />
          <Area type="monotone" stackId="1" dataKey="eyesClosed" name="Eyes closed" stroke="var(--chart-4)" fill="var(--chart-4)" fillOpacity={0.35} />
          <Area type="monotone" stackId="1" dataKey="yawning" name="Yawning" stroke="var(--warn)" fill="var(--warn)" fillOpacity={0.35} />
          <Area type="monotone" stackId="1" dataKey="phone" name="Phone use" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.35} />
        </AreaChart>
      </ChartCard>

      <ChartCard
        title="Top safe drivers"
        subtitle="Highest safety scores this period"
        empty={noDrivers}
      >
        <BarChart data={safest} layout="vertical" margin={{ left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis type="number" domain={[0, 100]} {...AXIS} />
          <YAxis type="category" dataKey="name" width={80} {...AXIS} />
          <Tooltip />
          <Bar dataKey="score" name="Safety score" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard
        title="Highest-risk drivers"
        subtitle="Lowest safety scores this period"
        empty={noDrivers}
      >
        <BarChart data={riskiest} layout="vertical" margin={{ left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis type="number" domain={[0, 100]} {...AXIS} />
          <YAxis type="category" dataKey="name" width={80} {...AXIS} />
          <Tooltip />
          <Bar dataKey="score" name="Safety score" radius={[0, 4, 4, 0]}>
            {riskiest.map((d) => (
              <Cell key={d.name} fill={RISK_COLOR[d.risk]} />
            ))}
          </Bar>
        </BarChart>
      </ChartCard>

      <ChartCard
        title="Risk distribution"
        subtitle="How the fleet splits across risk levels"
        empty={riskMix.length === 0}
      >
        <PieChart>
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Pie data={riskMix} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
            {riskMix.map((d) => (
              <Cell key={d.name} fill={RISK_COLOR[d.name as RiskLevel]} />
            ))}
          </Pie>
        </PieChart>
      </ChartCard>

      <ChartCard
        title="Alerts per monitored day"
        subtitle="Average alerts a driver triggers per active day"
        empty={perDay.length === 0}
      >
        <BarChart data={perDay}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="name" {...AXIS} />
          <YAxis {...AXIS} />
          <Tooltip />
          <Bar dataKey="rate" name="Alerts / day" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard
        title="Critical events per day"
        subtitle="Microsleep-grade events across the fleet"
        empty={noDaily}
      >
        <BarChart data={daily}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis allowDecimals={false} {...AXIS} />
          <Tooltip />
          <Bar dataKey="critical" name="Critical events" fill="var(--danger)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartCard>

      <ChartCard
        title="Monitored hours vs completed shifts"
        subtitle="Coverage of the fleet, day by day"
        empty={noDaily}
      >
        <ComposedChart data={daily}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey="label" {...AXIS} />
          <YAxis yAxisId="left" {...AXIS} />
          <YAxis yAxisId="right" orientation="right" allowDecimals={false} {...AXIS} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="left" dataKey="hours" name="Monitored hours" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
          <Line yAxisId="right" type="monotone" dataKey="shifts" name="Completed shifts" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ChartCard>
    </div>
  );
}
