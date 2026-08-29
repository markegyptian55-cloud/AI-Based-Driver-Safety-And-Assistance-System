// Export card for the last completed run.
//
// Shown after a run finishes and on the history page, so the driver can still
// download the evidence after navigating away — the snapshot lives on the
// device, not in page state.
//
// The export is customisable because the useful slice is rarely the whole
// run: a model comparison wants telemetry only, an incident review wants the
// ninety seconds around it.

import { useEffect, useMemo, useState } from "react";
import { FileDown, Gauge, SlidersHorizontal, Table2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/features/session/session-csv";
import {
  clearLastSession,
  readLastSession,
  type LastSessionRecord,
} from "@/features/session/last-session";
import {
  buildLastSessionCsv,
  buildLastSessionPdf,
  lastSessionCsvName,
  lastSessionPdfName,
  telemetryRows,
} from "@/features/report/last-session-report";
import {
  allMetricLabels,
  applyExportOptions,
  defaultExportOptions,
  describeRange,
  selectedTelemetryRows,
  type ExportOptions,
} from "@/features/report/export-options";
import { errorMessage } from "@/lib/format-error";

export function LastSessionExport({
  className,
  refreshKey,
}: {
  className?: string;
  /** Change this after a run ends to re-read the stored snapshot. */
  refreshKey?: unknown;
}) {
  const [record, setRecord] = useState<LastSessionRecord | null>(null);
  const [options, setOptions] = useState<ExportOptions | null>(null);
  const [customising, setCustomising] = useState(false);

  useEffect(() => {
    const next = readLastSession();
    setRecord(next);
    setOptions(next ? defaultExportOptions(next) : null);
  }, [refreshKey]);

  const rows = useMemo(() => (record ? telemetryRows(record) : []), [record]);
  const metricLabels = useMemo(() => (record ? allMetricLabels(record) : []), [record]);

  if (!record || !options) return null;

  const set = (patch: Partial<ExportOptions>) => setOptions({ ...options, ...patch });
  const filtered = applyExportOptions(record, options);
  const chosenRows = selectedTelemetryRows(record, options);

  function onCsv() {
    try {
      downloadCsv(buildLastSessionCsv(filtered, chosenRows), lastSessionCsvName(record!));
      toast.success("Session CSV downloaded");
    } catch (err) {
      toast.error(`Could not build the CSV: ${errorMessage(err)}`);
    }
  }

  function onPdf() {
    try {
      buildLastSessionPdf(
        filtered,
        chosenRows,
        describeRange(options!, record!.durationSec),
      ).save(lastSessionPdfName(record!));
      toast.success("Session PDF downloaded");
    } catch (err) {
      toast.error(`Could not build the PDF: ${errorMessage(err)}`);
    }
  }

  return (
    <Card className={cn("space-y-4 border-border/60 bg-card/60 p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Gauge className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 className="font-mono text-sm font-semibold">Last session export</h2>
        <Badge variant="outline" className="font-mono text-[10px] uppercase">
          {record.meta.source}
        </Badge>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {new Date(record.endedAt).toLocaleString()}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {record.meta.modelName} {record.meta.modelVersion} on {record.meta.engine || "unknown"} ·{" "}
        {record.meta.driverLabel}. Choose what to include before downloading.
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="truncate font-mono text-[10px] uppercase text-muted-foreground">
              {label}
            </dt>
            <dd className="truncate font-mono text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex items-center gap-3 rounded-md border border-border/60 p-3">
        <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Label htmlFor="export-custom" className="min-w-0 flex-1 text-xs font-normal">
          Customise this export
          <span className="block text-[11px] text-muted-foreground">
            {describeRange(options, record.durationSec)} ·{" "}
            {options.metrics.length}/{metricLabels.length} metrics ·{" "}
            {options.includeDetectionHistory
              ? `${filtered.events.length} detection rows`
              : "no detection rows"}
          </span>
        </Label>
        <Switch id="export-custom" checked={customising} onCheckedChange={setCustomising} />
      </div>

      {customising ? (
        <div className="space-y-4 rounded-md border border-border/60 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="export-from" className="text-xs">
                From (seconds into the run)
              </Label>
              <Input
                id="export-from"
                type="number"
                min={0}
                max={record.durationSec}
                placeholder="start"
                value={options.fromSec ?? ""}
                onChange={(e) =>
                  set({ fromSec: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="export-to" className="text-xs">
                To (seconds into the run, ends at {record.durationSec}s)
              </Label>
              <Input
                id="export-to"
                type="number"
                min={0}
                max={record.durationSec}
                placeholder="end"
                value={options.toSec ?? ""}
                onChange={(e) =>
                  set({ toSec: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Telemetry columns
              </Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() =>
                  set({
                    metrics:
                      options.metrics.length === metricLabels.length ? [] : [...metricLabels],
                  })
                }
              >
                {options.metrics.length === metricLabels.length ? "Clear all" : "Select all"}
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {metricLabels.map((label) => {
                const on = options.metrics.includes(label);
                return (
                  <label key={label} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(v) =>
                        set({
                          metrics: v
                            ? [...options.metrics, label]
                            : options.metrics.filter((m) => m !== label),
                        })
                      }
                    />
                    <span className="min-w-0 truncate">{label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={options.includeDetectionHistory}
                onCheckedChange={(v) => set({ includeDetectionHistory: v === true })}
              />
              Include detection history rows ({record.events.length} recorded)
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={options.includeTimeline}
                onCheckedChange={(v) => set({ includeTimeline: v === true })}
              />
              Include per-frame timeline (CSV only, {record.timeline.length} rows)
            </label>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setOptions(defaultExportOptions(record))}
          >
            Reset to everything
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onPdf} className="gap-2">
          <FileDown className="h-4 w-4" aria-hidden="true" />
          Download PDF
        </Button>
        <Button onClick={onCsv} variant="secondary" className="gap-2">
          <Table2 className="h-4 w-4" aria-hidden="true" />
          Download CSV
        </Button>
        <Button
          variant="ghost"
          className="gap-2 text-muted-foreground"
          onClick={() => {
            clearLastSession();
            setRecord(null);
            toast.success("Stored session cleared from this device");
          }}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Clear
        </Button>
      </div>
    </Card>
  );
}
