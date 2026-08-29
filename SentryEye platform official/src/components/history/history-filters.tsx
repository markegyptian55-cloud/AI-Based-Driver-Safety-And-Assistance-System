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
import { RotateCcw, Search } from "lucide-react";
import {
  DEFAULT_HISTORY_QUERY,
  type HistoryFilterOptions,
  type HistoryQuery,
} from "@/features/history/history-data";

const FATIGUE_LEVELS = ["low", "medium", "high", "critical"] as const;

const TYPE_LABEL: Record<string, string> = {
  webcam: "Live camera",
  "video-upload": "Video upload",
  "image-upload": "Image upload",
};

export function HistoryFilterBar({
  options,
  query,
  onChange,
}: {
  options: HistoryFilterOptions;
  query: HistoryQuery;
  onChange: (patch: Partial<HistoryQuery>) => void;
}) {
  return (
    <Card className="border-border/60 bg-card/60 p-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by session ID or driver…"
          value={query.search}
          onChange={(e) => onChange({ search: e.target.value, page: 1 })}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Field label="Driver">
          <Select value={query.driver} onValueChange={(v) => onChange({ driver: v, page: 1 })}>
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
        </Field>

        <Field label="Model">
          <Select value={query.model} onValueChange={(v) => onChange({ model: v, page: 1 })}>
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
        </Field>

        <Field label="Analysis type">
          <Select
            value={query.analysisType}
            onValueChange={(v) => onChange({ analysisType: v, page: 1 })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {options.analysisTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABEL[t] ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Fatigue level">
          <Select value={query.fatigue} onValueChange={(v) => onChange({ fatigue: v, page: 1 })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              {FATIGUE_LEVELS.map((f) => (
                <SelectItem key={f} value={f}>
                  {f[0].toUpperCase() + f.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="From">
          <Input
            type="date"
            value={query.from ?? ""}
            onChange={(e) => onChange({ from: e.target.value || null, page: 1 })}
          />
        </Field>

        <Field label="To">
          <Input
            type="date"
            value={query.to ?? ""}
            onChange={(e) => onChange({ to: e.target.value || null, page: 1 })}
          />
        </Field>
      </div>

      <div className="mt-3 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...DEFAULT_HISTORY_QUERY, pageSize: query.pageSize })}
        >
          <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reset
        </Button>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
