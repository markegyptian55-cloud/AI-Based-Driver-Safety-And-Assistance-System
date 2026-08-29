import { useState } from "react";
import { Activity, AlertTriangle, Bell, BellOff, Eye, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { isAlarmEnabled, setAlarmEnabled, stopAlarm } from "@/features/drowsiness/alarm";
import type { LiveSessionState } from "@/features/session/use-live-session";

const RISK_META = {
  safe: { label: "SAFE", tone: "bg-safe/20 text-safe border-safe/30", icon: ShieldCheck },
  warn: { label: "WARN", tone: "bg-warn/20 text-warn border-warn/30", icon: Activity },
  danger: { label: "DANGER", tone: "bg-danger/20 text-danger border-danger/30", icon: AlertTriangle },
} as const;

export function RiskPanel({ state }: { state: LiveSessionState }) {
  const meta = RISK_META[state.risk];
  const Icon = meta.icon;
  const perclosPct = Math.round(state.perclos * 100);
  const c = state.closure;
  const [alarmOn, setAlarmOn] = useState(() => isAlarmEnabled());

  const toggleAlarm = () => {
    const next = !alarmOn;
    setAlarmEnabled(next);
    if (!next) stopAlarm();
    setAlarmOn(next);
  };

  return (
    <Card className="border-border/60 bg-card/60 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Risk
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={toggleAlarm}
            aria-label={alarmOn ? "Mute wake-up alarm" : "Unmute wake-up alarm"}
            title={alarmOn ? "Wake-up alarm on" : "Wake-up alarm muted"}
          >
            {alarmOn ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5 text-muted-foreground" />}
          </Button>
          <Badge variant="outline" className={`font-mono ${meta.tone}`}>
            <Icon className="mr-1 h-3 w-3" />
            {meta.label}
          </Badge>
        </div>
      </div>

      {state.microsleepActive ? (
        <div
          className="mt-4 flex items-center gap-2 rounded-md border border-danger/40 bg-danger/15 px-3 py-2 text-danger"
          role="alert"
          aria-live="assertive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse" />
          <span className="font-mono text-xs uppercase tracking-wide">
            Microsleep — eyes closed {(c.currentClosureMs / 1000).toFixed(1)}s
          </span>
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase text-muted-foreground">PERCLOS</span>
            <span className="font-mono text-sm">{perclosPct}%</span>
          </div>
          <Progress value={perclosPct} className="mt-1" />
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Yawns/min" value={state.yawnRate.toString()} />
          <Stat
            label="Events"
            value={String((state.snapshot?.closedEyeEvents ?? 0) + (state.snapshot?.yawnEvents ?? 0))}
          />
          <Stat label="Microsleeps" value={String(c.microsleeps)} tone={c.microsleeps > 0 ? "danger" : undefined} />
          <Stat
            label="Critical"
            value={String(c.criticalMicrosleeps)}
            tone={c.criticalMicrosleeps > 0 ? "danger" : undefined}
          />
          <Stat label="Closed frames" value={`${c.closedFrames}/${c.analysedFrames}`} />
          <Stat label="Longest closure" value={`${(c.longestClosureMs / 1000).toFixed(1)}s`} />
          {/* Confirmed yawns only — smiles and talking are filtered out by
              mouth geometry plus a hold time, and counted separately. */}
          <Stat label="Yawns" value={String(c.yawns)} tone={c.yawns > 0 ? "danger" : undefined} />
          <Stat label="Long yawns" value={String(c.longYawns)} />
        </div>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Eye className="h-3 w-3" />
            {c.blinks} blinks
          </span>
          <span>{c.smilesRejected} smiles ignored</span>
          {c.currentYawnMs > 0 ? <span>mouth open {(c.currentYawnMs / 1000).toFixed(1)}s</span> : null}
        </div>

      </div>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg ${tone === "danger" ? "text-danger" : ""}`}>{value}</div>
    </div>
  );
}
