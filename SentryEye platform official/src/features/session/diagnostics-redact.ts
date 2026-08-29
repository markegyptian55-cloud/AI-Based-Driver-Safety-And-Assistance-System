// Redaction for shared diagnostics.
//
// A diagnostics bundle is safe to keep locally but is about to be handed to a
// stranger over a link. Anything that identifies the driver, the account, or
// the deployment is stripped or coarsened here BEFORE it leaves the device —
// redaction on the client, never on the server, so the raw bundle is never
// transmitted at all.

import type { DiagnosticsBundle, DiagnosticEntry } from "./diagnostics-log";

export interface RedactionReport {
  bundle: DiagnosticsBundle;
  /** Human-readable list of what was removed, shown before sharing. */
  removed: string[];
}

const SENSITIVE_KEYS =
  /^(email|user|user_id|userid|driver|driverlabel|driver_id|driverid|name|token|access_token|apikey|api_key|authorization|password|url|modelurl|src|filename|file|path)$/i;

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const JWT_RE = /\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{6,}\b/g;
const URL_RE = /\bhttps?:\/\/[^\s"']+/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function scrubString(value: string, removed: Set<string>): string {
  let out = value;
  if (EMAIL_RE.test(out)) {
    removed.add("email addresses");
    out = out.replace(EMAIL_RE, "[email]");
  }
  if (JWT_RE.test(out)) {
    removed.add("tokens");
    out = out.replace(JWT_RE, "[token]");
  }
  if (URL_RE.test(out)) {
    removed.add("URLs");
    out = out.replace(URL_RE, "[url]");
  }
  if (UUID_RE.test(out)) {
    removed.add("identifiers");
    out = out.replace(UUID_RE, "[id]");
  }
  return out;
}

function scrubValue(value: unknown, removed: Set<string>): unknown {
  if (typeof value === "string") return scrubString(value, removed);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, removed));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(k)) {
        removed.add(`field "${k}"`);
        continue;
      }
      out[k] = scrubValue(v, removed);
    }
    return out;
  }
  return value;
}

/** Coarse browser/OS instead of the full, near-unique user-agent string. */
export function coarseUserAgent(ua: unknown): string {
  const s = typeof ua === "string" ? ua : "";
  const browser =
    /Edg\//.test(s) ? "Edge"
    : /OPR\//.test(s) ? "Opera"
    : /Chrome\//.test(s) ? "Chrome"
    : /Firefox\//.test(s) ? "Firefox"
    : /Safari\//.test(s) ? "Safari"
    : "unknown";
  const os =
    /Android/.test(s) ? "Android"
    : /iPhone|iPad|iOS/.test(s) ? "iOS"
    : /Mac OS X/.test(s) ? "macOS"
    : /Windows/.test(s) ? "Windows"
    : /Linux/.test(s) ? "Linux"
    : "unknown";
  const major = s.match(/(?:Chrome|Firefox|Version|Edg)\/(\d+)/)?.[1] ?? "?";
  return `${browser} ${major} on ${os}`;
}

export function redactDiagnostics(bundle: DiagnosticsBundle): RedactionReport {
  const removed = new Set<string>();

  const entries: DiagnosticEntry[] = bundle.entries.map((e) => ({
    t: e.t,
    level: e.level,
    kind: e.kind,
    data: e.data ? (scrubValue(e.data, removed) as Record<string, unknown>) : undefined,
  }));

  const device = { ...bundle.device } as Record<string, unknown>;
  if (device["userAgent"]) {
    device["userAgent"] = coarseUserAgent(device["userAgent"]);
    removed.add("full user-agent string");
  }

  const meta = { ...bundle.meta };
  if (meta.sessionId) {
    removed.add("session id");
    meta.sessionId = null;
  }

  return {
    bundle: {
      ...bundle,
      // Only the duration matters for debugging; the wall-clock start does not.
      generatedAt: new Date(bundle.generatedAt).toISOString(),
      meta,
      device: scrubValue(device, removed) as Record<string, unknown>,
      entries,
    },
    removed: [...removed].sort(),
  };
}
