// Where the FastAPI inference service lives, and whether it is reachable.
//
// The remote path only earns its place if we can prove it is alive and fast
// *before* routing a driver's frames to it. Everything here is cheap, cached,
// and safe to call from the UI.

const URL_KEY = "sentryeye.remote.baseUrl";
const ENABLED_KEY = "sentryeye.remote.enabled";

/** Trailing slashes and stray `/v1` suffixes are the usual paste errors. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.replace(/\/v1$/, "");
}

export function readRemoteBaseUrl(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(URL_KEY) ?? "";
}

export function writeRemoteBaseUrl(url: string) {
  if (typeof localStorage === "undefined") return;
  const clean = normalizeBaseUrl(url);
  if (clean) localStorage.setItem(URL_KEY, clean);
  else localStorage.removeItem(URL_KEY);
}

/** Remote fallback is opt-in: a driver on mobile data should not be surprised. */
export function readRemoteEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(ENABLED_KEY) === "1";
}

export function writeRemoteEnabled(on: boolean) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
}

export interface RemoteHealth {
  ok: boolean;
  /** Round-trip time of the health probe (ms) — the network floor per frame. */
  rttMs: number;
  modelName?: string;
  modelVersion?: string;
  engine?: string;
  imgsz?: number;
  labels?: Record<string, string>;
  error?: string;
}

export async function probeRemote(
  baseUrl: string,
  timeoutMs = 4000,
): Promise<RemoteHealth> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return { ok: false, rttMs: 0, error: "No service URL configured." };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(`${base}/health`, { signal: ctrl.signal });
    const rttMs = performance.now() - t0;
    if (!res.ok) return { ok: false, rttMs, error: `Service replied ${res.status}.` };
    const body = (await res.json()) as Partial<RemoteHealth> & { status?: string };
    return {
      ok: body.status === "ok" || body.ok === true,
      rttMs,
      modelName: body.modelName,
      modelVersion: body.modelVersion,
      engine: body.engine,
      imgsz: body.imgsz,
      labels: body.labels,
    };
  } catch (err) {
    return {
      ok: false,
      rttMs: performance.now() - t0,
      error:
        err instanceof DOMException && err.name === "AbortError"
          ? `No answer within ${timeoutMs} ms.`
          : err instanceof Error
            ? err.message
            : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
