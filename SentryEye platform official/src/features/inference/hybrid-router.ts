// Hybrid router — one provider face, two execution paths.
//
// The Android failure mode is not "the model is wrong", it is "the phone can't
// keep up": frame rate collapses, tracks stop matching, and confidence sags
// because every box is stale. Those are exactly the signals used here. When the
// on-device path degrades and a healthy FastAPI service is configured, frames
// are routed to it; when the network turns worse than the phone, routing goes
// back. Switching is hysteretic on purpose — a router that flaps every second
// is worse than either path alone.

import type {
  Frame,
  InferenceProvider,
  InferenceResult,
  InitOptions,
  ProviderConfig,
  ProviderStatus,
  TunableConfig,
} from "./types";
import { BrowserOnnxProvider } from "./browser-onnx-provider";
import { RemoteFastApiProvider } from "./remote-fastapi-provider";

export type RouteId = "on-device" | "remote";

export interface RouteMetrics {
  /** Rolling analysed frames per second on the active path. */
  fps: number;
  /** Median end-to-end latency (ms) on the active path. */
  latencyMs: number;
  /**
   * Mean confidence of currently tracked detections (0..1). Supplied by the
   * session; the router itself has no opinion about drowsiness semantics.
   */
  trackConfidence: number;
  /** Consecutive failures on the active path. */
  errors: number;
  /** Is a remote service configured and known-healthy? */
  remoteAvailable: boolean;
  /** How long (ms) the current path has been in its present condition. */
  degradedForMs: number;
  /** How long (ms) since the last route change. */
  sinceSwitchMs: number;
}

export interface RoutePolicy {
  /** Below this analysed fps the on-device path is considered failing. */
  minFps: number;
  /** Below this mean track confidence the on-device path is considered failing. */
  minTrackConfidence: number;
  /** Degradation must persist this long before a switch (anti-flap). */
  sustainMs: number;
  /** Minimum dwell time on a path before it may be left again. */
  cooldownMs: number;
  /** Consecutive remote errors that force a return to the device. */
  maxRemoteErrors: number;
}

export const DEFAULT_ROUTE_POLICY: RoutePolicy = {
  minFps: 6,
  minTrackConfidence: 0.35,
  sustainMs: 4000,
  cooldownMs: 12000,
  maxRemoteErrors: 3,
};

export interface RouteDecision {
  route: RouteId;
  changed: boolean;
  reason: string;
}

/**
 * Pure routing decision — no timers, no I/O, fully unit-testable.
 */
export function decideRoute(
  current: RouteId,
  m: RouteMetrics,
  policy: RoutePolicy = DEFAULT_ROUTE_POLICY,
): RouteDecision {
  const keep = (reason: string): RouteDecision => ({ route: current, changed: false, reason });
  const move = (route: RouteId, reason: string): RouteDecision => ({
    route,
    changed: route !== current,
    reason,
  });

  if (current === "remote") {
    // Failure beats dwell time: a dead service must never hold the driver.
    if (m.errors >= policy.maxRemoteErrors) {
      return move("on-device", `remote failed ${m.errors} times in a row`);
    }
    if (!m.remoteAvailable) return move("on-device", "remote service went unhealthy");
    if (m.sinceSwitchMs < policy.cooldownMs) return keep("remote cooldown");
    if (m.fps < policy.minFps && m.degradedForMs >= policy.sustainMs) {
      return move("on-device", `remote only reached ${m.fps.toFixed(1)} fps`);
    }
    return keep("remote is keeping up");
  }

  if (!m.remoteAvailable) return keep("no remote service available");
  if (m.sinceSwitchMs < policy.cooldownMs) return keep("on-device cooldown");

  const slow = m.fps < policy.minFps;
  const unsure = m.trackConfidence > 0 && m.trackConfidence < policy.minTrackConfidence;
  if ((slow || unsure) && m.degradedForMs >= policy.sustainMs) {
    return move(
      "remote",
      slow
        ? `on-device stuck at ${m.fps.toFixed(1)} fps`
        : `tracking confidence fell to ${(m.trackConfidence * 100).toFixed(0)}%`,
    );
  }
  return keep("on-device is healthy");
}

export interface RouterEvent {
  from: RouteId;
  to: RouteId;
  reason: string;
  at: number;
}

export interface HybridOptions {
  policy?: Partial<RoutePolicy>;
  onRoute?: (e: RouterEvent) => void;
}

export class HybridAutoProvider implements InferenceProvider {
  readonly id = "hybrid-auto" as const;

  private local = new BrowserOnnxProvider();
  private remote: RemoteFastApiProvider | null = null;
  private cfg: ProviderConfig | null = null;
  private policy: RoutePolicy;
  private onRoute?: (e: RouterEvent) => void;

  private route: RouteId = "on-device";
  private remoteHealthy = false;
  private remoteErrors = 0;
  private lastSwitchAt = 0;
  private degradedSince: number | null = null;
  private trackConfidence = 1;
  private latencies: number[] = [];
  private stamps: number[] = [];
  private switching: Promise<void> | null = null;
  private history: RouterEvent[] = [];

  constructor(opts: HybridOptions = {}) {
    this.policy = { ...DEFAULT_ROUTE_POLICY, ...opts.policy };
    this.onRoute = opts.onRoute;
  }

  async init(cfg: ProviderConfig, opts?: InitOptions) {
    this.cfg = cfg;
    this.lastSwitchAt = Date.now();
    // The device path always initializes: it is the fallback of last resort and
    // must be warm before the router is allowed to leave it.
    await this.local.init(cfg, opts);
    if (cfg.remoteBaseUrl) {
      try {
        const remote = new RemoteFastApiProvider();
        await remote.init(cfg, opts);
        this.remote = remote;
        this.remoteHealthy = true;
        opts?.onStage?.("hybrid-remote-standby", { baseUrl: cfg.remoteBaseUrl });
      } catch (err) {
        this.remoteHealthy = false;
        opts?.onStage?.("hybrid-remote-unavailable", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    opts?.onStage?.("hybrid-ready", { route: this.route, remote: this.remoteHealthy });
  }

  /** The session reports what the tracker sees; the router reads it as health. */
  observeTracking(meanConfidence: number) {
    if (Number.isFinite(meanConfidence)) this.trackConfidence = meanConfidence;
  }

  routeId(): RouteId {
    return this.route;
  }

  routeHistory(): RouterEvent[] {
    return this.history;
  }

  async infer(frame: Frame, ts: number): Promise<InferenceResult> {
    const active = this.active();
    let result: InferenceResult;
    try {
      result = await active.infer(frame, ts);
      if (this.route === "remote") this.remoteErrors = 0;
    } catch (err) {
      if (this.route === "remote") {
        this.remoteErrors++;
        this.evaluate();
        // Never drop a driver's frame budget on the floor because the network
        // hiccupped — but the bitmap is already consumed, so surface the error
        // and let the next frame land on the newly chosen path.
      }
      throw err;
    }
    const now = performance.now();
    this.pushLatency(result.latencyMs);
    this.pushFps(now);
    result.meta.route = this.route;
    this.evaluate();
    return result;
  }

  reconfigure(cfg: TunableConfig) {
    this.local.reconfigure(cfg);
    this.remote?.reconfigure(cfg);
    if (this.cfg) this.cfg = { ...this.cfg, ...cfg };
  }

  async dispose() {
    await Promise.allSettled([this.local.dispose(), this.remote?.dispose()]);
    this.remote = null;
  }

  status(): ProviderStatus {
    const base = this.active().status();
    return { ...base, id: this.id, engine: `${this.route}/${base.engine}` };
  }

  metrics(): RouteMetrics {
    return {
      fps: this.currentFps(),
      latencyMs: this.medianLatency(),
      trackConfidence: this.trackConfidence,
      errors: this.remoteErrors,
      remoteAvailable: this.remoteHealthy && this.remote !== null,
      degradedForMs: this.degradedSince === null ? 0 : Date.now() - this.degradedSince,
      sinceSwitchMs: Date.now() - this.lastSwitchAt,
    };
  }

  private active(): InferenceProvider {
    return this.route === "remote" && this.remote ? this.remote : this.local;
  }

  private evaluate() {
    const m = this.metrics();
    const failing =
      m.fps < this.policy.minFps ||
      (m.trackConfidence > 0 && m.trackConfidence < this.policy.minTrackConfidence) ||
      m.errors > 0;
    if (failing) this.degradedSince ??= Date.now();
    else this.degradedSince = null;

    const decision = decideRoute(this.route, this.metrics(), this.policy);
    if (!decision.changed) return;
    if (decision.route === "remote" && !this.remote) return;

    const event: RouterEvent = {
      from: this.route,
      to: decision.route,
      reason: decision.reason,
      at: Date.now(),
    };
    this.route = decision.route;
    this.lastSwitchAt = Date.now();
    this.degradedSince = null;
    this.remoteErrors = 0;
    this.latencies = [];
    this.stamps = [];
    this.history.push(event);
    if (this.history.length > 50) this.history.shift();
    this.onRoute?.(event);
  }

  private pushLatency(v: number) {
    this.latencies.push(v);
    if (this.latencies.length > 30) this.latencies.shift();
  }

  private medianLatency() {
    if (!this.latencies.length) return 0;
    const s = [...this.latencies].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  private pushFps(now: number) {
    this.stamps.push(now);
    while (this.stamps.length && now - this.stamps[0] > 3000) this.stamps.shift();
  }

  private currentFps() {
    if (this.stamps.length < 3) return Number.POSITIVE_INFINITY; // not enough data to judge
    const span = this.stamps[this.stamps.length - 1] - this.stamps[0];
    return span > 0 ? ((this.stamps.length - 1) * 1000) / span : 0;
  }
}
