// Session diagnostics — a bounded, exportable trace of a live run.
//
// When a phone produces bad results the useful evidence (which backend was
// chosen, what the self-test said, the frame rate, which frames were rejected)
// is scattered across console logs the driver will never send. This collects
// it in a ring buffer and hands back one JSON file.
//
// Privacy: never store video frames, images, emails, or tokens — only device
// capabilities, timings, and detection bookkeeping.

export type DiagnosticLevel = "info" | "warn" | "error";

export interface DiagnosticEntry {
  /** ms since the log was created. */
  t: number;
  level: DiagnosticLevel;
  kind: string;
  data?: Record<string, unknown>;
}

export interface DiagnosticsMeta {
  sessionId?: string | null;
  source?: string;
  provider?: string;
  engine?: string;
  preset?: string;
  modelName?: string;
  modelVersion?: string;
}

export interface DiagnosticsBundle {
  schema: "sentryeye.diagnostics.v1";
  generatedAt: string;
  durationMs: number;
  meta: DiagnosticsMeta;
  device: Record<string, unknown>;
  entries: DiagnosticEntry[];
  truncatedEntries: number;
}

export interface DiagnosticsLog {
  add(kind: string, data?: Record<string, unknown>, level?: DiagnosticLevel): void;
  setMeta(meta: DiagnosticsMeta): void;
  entries(): DiagnosticEntry[];
  size(): number;
  build(): DiagnosticsBundle;
  clear(): void;
}

const DEFAULT_LIMIT = 2000;

export function createDiagnosticsLog(limit = DEFAULT_LIMIT): DiagnosticsLog {
  const started = Date.now();
  let buffer: DiagnosticEntry[] = [];
  let dropped = 0;
  let meta: DiagnosticsMeta = {};

  return {
    add(kind, data, level = "info") {
      buffer.push({ t: Date.now() - started, level, kind, data });
      if (buffer.length > limit) {
        buffer = buffer.slice(buffer.length - limit);
        dropped++;
      }
    },
    setMeta(next) {
      meta = { ...meta, ...next };
    },
    entries: () => buffer,
    size: () => buffer.length,
    build: () => ({
      schema: "sentryeye.diagnostics.v1" as const,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      meta,
      device: describeDevice(),
      entries: buffer,
      truncatedEntries: dropped,
    }),
    clear() {
      buffer = [];
      dropped = 0;
    },
  };
}

/** Non-identifying device/browser facts that explain most mobile failures. */
export function describeDevice(): Record<string, unknown> {
  if (typeof navigator === "undefined") return {};
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string; downlink?: number };
    userAgentData?: { mobile?: boolean; platform?: string };
  };
  return {
    userAgent: nav.userAgent,
    platform: nav.userAgentData?.platform,
    mobile: nav.userAgentData?.mobile ?? null,
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    maxTouchPoints: nav.maxTouchPoints ?? null,
    webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
    crossOriginIsolated:
      typeof globalThis !== "undefined"
        ? ((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? null)
        : null,
    connection: nav.connection?.effectiveType ?? null,
    screen:
      typeof window !== "undefined"
        ? {
            width: window.screen?.width ?? null,
            height: window.screen?.height ?? null,
            dpr: window.devicePixelRatio ?? null,
          }
        : null,
    language: nav.language,
  };
}

export function diagnosticsFilename(bundle: DiagnosticsBundle): string {
  const stamp = bundle.generatedAt.replace(/[:.]/g, "-");
  const id = bundle.meta.sessionId ? `-${bundle.meta.sessionId.slice(0, 8)}` : "";
  return `sentryeye-diagnostics${id}-${stamp}.json`;
}

export function diagnosticsBlob(bundle: DiagnosticsBundle): Blob {
  return new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
}

/** Triggers a file download. Call from a user gesture. */
export function downloadDiagnostics(bundle: DiagnosticsBundle): void {
  const url = URL.createObjectURL(diagnosticsBlob(bundle));
  const a = document.createElement("a");
  a.href = url;
  a.download = diagnosticsFilename(bundle);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been dispatched, never before.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function canShareDiagnostics(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({
      files: [new File(["{}"], "probe.json", { type: "application/json" })],
    });
  } catch {
    return false;
  }
}

/** Opens the native share sheet with the diagnostics file attached. */
export async function shareDiagnostics(bundle: DiagnosticsBundle): Promise<boolean> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const file = new File([diagnosticsBlob(bundle)], diagnosticsFilename(bundle), {
    type: "application/json",
  });
  if (typeof nav.share !== "function") return false;
  try {
    await nav.share({ files: [file], title: "SentryEye diagnostics" });
    return true;
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") return false;
    throw err;
  }
}
