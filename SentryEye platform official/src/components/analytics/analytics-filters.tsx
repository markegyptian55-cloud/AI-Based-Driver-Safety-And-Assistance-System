import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarRange, RotateCcw } from "lucide-react";
import {
  DEFAULT_FILTERS,
  type AnalyticsFilters,
  type AnalyticsSession,
  buildFilterOptions,
} from "@/features/analytics/analytics-data";

export function AnalyticsFilterBar({
  sessions,
  filters,
  onChange,
}: {
  sessions: AnalyticsSession[];
  filters: AnalyticsFilters;
  onChange: (next: AnalyticsFilters) => void;
}) {
  const options = buildFilterOptions(sessions);
  const set = (patch: Partial<AnalyticsFilters>) => onChange({ ...filters, ...patch });

  // Quick ranges exist because the useful question is almost always "when did
  // it get slow", and typing two dates to answer it is friction.
  const RANGES: { id: string; label: string; days: number | null }[] = [
    { id: "24h", label: "24h", days: 1 },
    { id: "7d", label: "7 days", days: 7 },
    { id: "30d", label: "30 days", days: 30 },
    { id: "90d", label: "90 days", days: 90 },
    { id: "all", label: "All time", days: null },
  ];
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const applyRange = (days: number | null) => {
    if (days == null) {
      set({ from: null, to: null });
      return;
    }
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    onChange({ ...filters, from: isoDay(from), to: isoDay(to) });
  };
  const activeRange = (() => {
    if (!filters.from && !filters.to) return "all";
    const match = RANGES.find((r) => {
      if (r.days == null) return false;
      const from = isoDay(new Date(Date.now() - r.days * 86_400_000));
      return filters.from === from;
    });
    return match?.id ?? "custom";
  })();

  return (
    <Card className="border-border/60 bg-card/60 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Time range
        </span>
        {RANGES.map((r) => (
          <Button
            key={r.id}
            size="sm"
            variant={activeRange === r.id ? "secondary" : "ghost"}
            className="h-7 px-2.5 text-xs"
            onClick={() => applyRange(r.days)}
          >
            {r.label}
          </Button>
        ))}
        {activeRange === "custom" ? (
          <span className="font-mono text-[10px] text-muted-foreground">custom dates</span>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Driver
          </Label>
          <Select value={filters.driver} onValueChange={(v) => set({ driver: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All drivers</SelectItem>
              {options.drivers.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Model
          </Label>
          <Select value={filters.model} onValueChange={(v) => set({ model: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All models</SelectItem>
              {options.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Analysis type
          </Label>
          <Select value={filters.analysisType} onValueChange={(v) => set({ analysisType: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {options.analysisTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            From
          </Label>
          <Input
            type="date"
            value={filters.from ?? ""}
            max={filters.to ?? undefined}
            onChange={(e) => set({ from: e.target.value || null })}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            To
          </Label>
          <Input
            type="date"
            value={filters.to ?? ""}
            min={filters.from ?? undefined}
            onChange={(e) => set({ to: e.target.value || null })}
          />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_FILTERS)}>
          <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reset filters
        </Button>
      </div>
    </Card>
  );
}
