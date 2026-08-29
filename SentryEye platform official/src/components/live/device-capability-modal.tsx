// Quick device capability probe.
//
// Runs once per page visit, right after mount, and takes a few milliseconds: a
// fixed arithmetic workload plus the hardware hints the browser exposes. It is
// only used to warn — never to block. A low score shows a dismissible note so a
// driver on a weak Android phone understands why detection may run slower,
// instead of assuming the app is broken.

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "sentryeye.lowspec-dismissed";

export interface CapabilityVerdict {
  /** Higher is faster. Roughly "million ops per second" of scalar maths. */
  score: number;
  cores: number;
  memoryGb: number | null;
  lowSpec: boolean;
}

/** Synchronous micro-benchmark; deliberately tiny so it never blocks paint. */
export function probeDeviceCapability(): CapabilityVerdict {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 2;
  const memoryGb = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;

  const t0 = performance.now();
  let acc = 0;
  for (let i = 1; i < 400_000; i++) acc += Math.sqrt(i) % 7;
  const elapsed = Math.max(0.1, performance.now() - t0);
  // Guard against the loop being optimised away entirely.
  if (acc === 0) return { score: 0, cores, memoryGb, lowSpec: true };
  const score = Math.round(400 / elapsed); // ops per ms, normalised

  // Calibrated against real hardware: a modern laptop scores in the hundreds,
  // a mid Android phone lands around 40-80, and a genuinely struggling device
  // falls below 30. Core/memory hints only count when they agree with the
  // measurement, so a fast 4-core phone is never labelled slow.
  const lowSpec = score < 30 || (cores <= 4 && (memoryGb ?? 8) <= 4);
  return { score, cores, memoryGb, lowSpec };
}

export function DeviceCapabilityModal({
  onVerdict,
}: {
  onVerdict?: (verdict: CapabilityVerdict) => void;
}) {
  const [verdict, setVerdict] = useState<CapabilityVerdict | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Defer past the first paint so the camera card renders immediately.
    const id = window.setTimeout(() => {
      const result = probeDeviceCapability();
      setVerdict(result);
      onVerdict?.(result);
      let dismissed = false;
      try {
        dismissed = window.sessionStorage.getItem(DISMISS_KEY) === "1";
      } catch {
        /* storage unavailable — show the note */
      }
      if (result.lowSpec && !dismissed) setOpen(true);
    }, 120);
    return () => window.clearTimeout(id);
  }, [onVerdict]);

  const dismiss = () => {
    setOpen(false);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* nothing to persist to — the note simply reappears next visit */
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-warning" aria-hidden="true" />
            Your device performance is limited
          </DialogTitle>
          <DialogDescription>
            Detection speed may vary on this device. The lightest model is used automatically and
            everything still runs on-device.
            {verdict ? (
              <span className="mt-2 block font-mono text-[11px]">
                score {verdict.score} · {verdict.cores} cores
                {verdict.memoryGb ? ` · ${verdict.memoryGb} GB` : ""}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button className="w-full" onClick={dismiss}>
            Dismiss &amp; continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
