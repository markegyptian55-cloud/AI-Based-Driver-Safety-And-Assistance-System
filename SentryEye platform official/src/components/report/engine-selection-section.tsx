// "Engine selection" — the per-execution-provider attempt ledger from the last
// worker init, shown inside a report so a slow past session can be explained
// (e.g. WebGPU rejected at self-test → WASM at 350ms/frame) after the fact.

import { useSyncExternalStore } from "react";

import { Card } from "@/components/ui/card";
import {
  readEngineAttempts,
  subscribeEngineAttempts,
  type EngineAttempt,
} from "@/features/inference/engine-attempts";

export function useEngineAttemptsLedger(): EngineAttempt[] {
  return useSyncExternalStore(
    subscribeEngineAttempts,
    readEngineAttempts,
    () => [] as EngineAttempt[],
  );
}

export function EngineSelectionSection({ attempts }: { attempts?: EngineAttempt[] }) {
  const live = useEngineAttemptsLedger();
  const list = attempts ?? live;
  if (!list.length) return null;

  return (
    <Card className="border-border/60 bg-card/60 p-4">
      <h3 className="text-sm font-semibold">Engine selection</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Every execution provider this device attempted, in order, and why it was rejected.
      </p>
      <ul className="mt-3 space-y-2">
        {list.map((a, i) => (
          <li
            key={`${a.engine}-${i}`}
            className="rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed"
          >
            <span className="font-mono font-medium">{a.engine}</span>
            <span className="text-muted-foreground">
              {a.asset ? ` | ${a.asset}` : ""} |{" "}
              {a.stage === "ready" ? "selected" : `stopped at ${a.stage}`}
              {a.cause ? ` | ${a.cause}` : ""}
              {typeof a.ms === "number" ? ` | ${a.ms}ms` : ""}
            </span>
            {a.error ? (
              <span className="mt-1 block break-words font-mono text-destructive">{a.error}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
