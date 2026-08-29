// Per-device model report shown on Live.
//
// Two questions get answered before a driver presses start: does this model
// keep up on *this* device, and does it still find boxes while doing it. Both
// numbers come from stored benchmark runs, grouped per device class, so a
// phone row is never mixed with a laptop row.

import { useEffect, useState } from "react";
import { Monitor, Smartphone, Tablet, TrendingUp } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { listBenchmarkRuns } from "@/features/benchmark/benchmark-runs";
import {
  buildDeviceReports,
  REPORT_REALTIME_FPS,
  type DeviceReport,
  type ReportDeviceClass,
} from "@/features/benchmark/device-model-report";

function classIcon(cls: ReportDeviceClass) {
  if (cls === "desktop") return Monitor;
  if (cls === "tablet") return Tablet;
  return Smartphone;
}

function classLabel(cls: ReportDeviceClass) {
  if (cls === "desktop") return "Computer";
  if (cls === "tablet") return "Tablet";
  if (cls === "mobile") return "Phone";
  return "Unrecognised device";
}

export function DeviceModelReport({ className }: { className?: string }) {
  const [reports, setReports] = useState<DeviceReport[] | null>(null);

  useEffect(() => {
    let alive = true;
    void listBenchmarkRuns(40)
      .then((runs) => {
        if (alive) setReports(buildDeviceReports(runs));
      })
      .catch(() => {
        if (alive) setReports([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!reports) return null;

  return (
    <Card className={cn("space-y-4 border-border/60 bg-card/60 p-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <TrendingUp className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Model report per device
        </span>
      </div>

      {reports.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No measurements stored yet. Run the device benchmark below on each device you drive
          with, and every model appears here with its frames per second, latency and detection
          success rate.
        </p>
      ) : (
        reports.map((report) => {
          const Icon = classIcon(report.deviceClass);
          return (
            <div key={report.deviceClass} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  {classLabel(report.deviceClass)}
                </Badge>
                <span className="font-mono text-[10px] text-muted-foreground">
                  measured {new Date(report.measuredAt).toLocaleString()}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[440px] text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1">Model · path</th>
                      <th>FPS</th>
                      <th>Latency p50 / p95</th>
                      <th>Detection</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {report.rows.map((row) => (
                      <tr key={row.id} className="border-t border-border/60">
                        <td className="py-1 pr-3">{row.label}</td>
                        <td
                          className={cn(
                            "pr-3",
                            row.fps >= REPORT_REALTIME_FPS ? "text-safe" : "text-warn",
                          )}
                        >
                          {row.fps.toFixed(1)}
                        </td>
                        <td className="pr-3">
                          {row.latencyP50Ms.toFixed(0)} / {row.latencyP95Ms.toFixed(0)} ms
                        </td>
                        <td className="pr-3">
                          {(row.detectionRate * 100).toFixed(0)}%{" "}
                          <span className="text-muted-foreground">
                            ({row.meanDetections.toFixed(1)} boxes)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {report.best ? (
                <p className="text-xs text-muted-foreground">
                  Best on this {classLabel(report.deviceClass).toLowerCase()}:{" "}
                  <span className="font-mono text-foreground">{report.best.label}</span> —{" "}
                  {report.best.fps.toFixed(1)} fps,{" "}
                  {report.best.latencyP95Ms.toFixed(0)} ms p95,{" "}
                  {(report.best.detectionRate * 100).toFixed(0)}% detection.
                  {report.best.fps < REPORT_REALTIME_FPS
                    ? " Still below the 10 fps needed to catch a microsleep — use the CPU fallback model."
                    : ""}
                </p>
              ) : null}
            </div>
          );
        })
      )}
    </Card>
  );
}
