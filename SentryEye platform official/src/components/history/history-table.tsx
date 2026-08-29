import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronDown,
  ChevronRight,
  FileText,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { PerformanceTimeline } from "./performance-timeline";
import type { FatigueLevel } from "@/features/drowsiness/safety-score";
import type { HistorySession, HistorySortKey } from "@/features/history/history-data";

const TYPE_LABEL: Record<string, string> = {
  webcam: "Live camera",
  "video-upload": "Video upload",
  "image-upload": "Image upload",
};

const FATIGUE_TONE: Record<FatigueLevel, string> = {
  low: "text-safe border-safe/40",
  medium: "text-warn border-warn/40",
  high: "text-danger border-danger/40",
  critical: "text-danger border-danger/60",
};

const COLUMNS: { key: HistorySortKey | null; label: string; className?: string }[] = [
  { key: null, label: "" },
  { key: null, label: "Session ID" },
  { key: null, label: "Driver" },
  { key: "date", label: "Date" },
  { key: null, label: "Type" },
  { key: null, label: "Model" },
  { key: "duration", label: "Duration" },
  { key: "processing_time", label: "Processing" },
  { key: "safety_score", label: "Safety" },
  { key: "fatigue_level", label: "Fatigue" },
  { key: null, label: "Alerts" },
  { key: null, label: "Status" },
];

export function HistoryTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  onDelete,
  deletingId,
}: {
  rows: HistorySession[];
  sortKey: HistorySortKey;
  sortDir: "asc" | "desc";
  onSort: (key: HistorySortKey) => void;
  onDelete: (session: HistorySession) => void;
  deletingId: string | null;
}) {
  const [pending, setPending] = useState<HistorySession | null>(null);
  // Only one performance panel is open at a time: these rows are wide and the
  // point is to compare a single run against its own stages.
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Card className="border-border/60 bg-card/60">
      <div className="w-full overflow-x-auto">
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((c) => (
                <TableHead key={c.label || "expand"} className="whitespace-nowrap">
                  {c.key ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.key!)}
                      className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider hover:text-foreground"
                    >
                      {c.label}
                      {sortKey === c.key ? (
                        sortDir === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : null}
                    </button>
                  ) : (
                    <span className="font-mono text-[10px] uppercase tracking-wider">
                      {c.label}
                    </span>
                  )}
                </TableHead>
              ))}
              <TableHead className="w-12 text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <Fragment key={s.id}>
              <TableRow className={deletingId === s.id ? "opacity-50" : undefined}>
                <TableCell className="w-8 pr-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-expanded={openId === s.id}
                    aria-label={
                      openId === s.id ? "Hide performance timeline" : "Show performance timeline"
                    }
                    onClick={() => setOpenId((cur) => (cur === s.id ? null : s.id))}
                  >
                    {openId === s.id ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                </TableCell>
                <TableCell className="font-mono text-xs">{s.id.slice(0, 8)}…</TableCell>
                <TableCell className="whitespace-nowrap">{s.driverLabel}</TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {new Date(s.startedAt).toLocaleString()}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {TYPE_LABEL[s.analysisType] ?? s.analysisType}
                </TableCell>
                <TableCell className="max-w-[180px] truncate text-sm">{s.modelLabel}</TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {formatDuration(s.durationSec)}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {(s.processingTimeMs / 1000).toFixed(1)} s
                </TableCell>
                <TableCell className={`font-mono text-sm ${scoreTone(s.safetyScore)}`}>
                  {Math.round(s.safetyScore)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={FATIGUE_TONE[s.fatigueLevel]}>
                    {s.fatigueLevel}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">{s.totalAlerts}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {s.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Session actions">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to="/report/$sessionId" params={{ sessionId: s.id }}>
                          <FileText className="mr-2 h-4 w-4" /> View driver report
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/analytics">
                          <BarChart3 className="mr-2 h-4 w-4" /> Open analytics
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={(e) => {
                          e.preventDefault();
                          setPending(s);
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete session
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
              {openId === s.id ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={COLUMNS.length + 1} className="bg-muted/30 p-4">
                    <PerformanceTimeline trace={s.pipeline} />
                  </TableCell>
                </TableRow>
              ) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              Session {pending?.id.slice(0, 8)}… for {pending?.driverLabel} and its detection
              events will be permanently removed. Other sessions are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) onDelete(pending);
                setPending(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function scoreTone(score: number) {
  return score >= 80 ? "text-safe" : score >= 60 ? "text-warn" : "text-danger";
}

function formatDuration(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}
