// Video-file frame source. Plays an uploaded video element and forwards
// frames using requestVideoFrameCallback with the same adaptive skipping
// behaviour as the camera source. UI-independent, mockable.

import type { FrameSource, FrameSourceHandler } from "./frame-source";

export interface VideoFileDeps {
  video: HTMLVideoElement;
  onFrame: FrameSourceHandler;
  /** Called once the underlying video ends naturally. */
  onEnded?: () => void;
  /** Called when the underlying <video> emits a fatal error. */
  onError?: (err: Error) => void;
}

export function createVideoFileSource(deps: VideoFileDeps): FrameSource {
  let stopped = false;
  /** Frames submitted to the model that have not returned a result yet. */
  let inFlight = 0;
  let capturePending = false;
  let ended = false;
  let scheduledFrame: { kind: "rvfc" | "raf"; id: number } | null = null;
  let queued: { bitmap: ImageBitmap; ts: number } | null = null;
  const srcTimes: number[] = [];
  const processedTimes: number[] = [];
  let totalFrameCount = 0;
  let analysedFrameCount = 0;
  let lastCaptureAt = 0;

  // Uploaded clips share Live's duty-cycle scheduler. Playback remains smooth
  // at the source cadence while analysis converges to a rate this device can
  // sustain. Full-size frames still reach the selected model; only sampling
  // frequency changes when a 960/WASM run is expensive.
  const FAST_INTERVAL_MS = 1000 / 60;
  const SLOW_INTERVAL_MS = 1000 / 4;
  const DUTY_MIN = 0.55;
  const DUTY_MAX = 0.9;
  let dutyTarget = DUTY_MIN;
  let minCaptureIntervalMs = 1000 / 30;
  let inferEmaMs: number | null = null;
  /** Depth-2 pipeline: the worker runs frame N+1 while the page consumes N. */
  const PIPELINE_DEPTH = 2;

  // Adaptive capture size. The model input size never changes; this only
  // limits how large a decoded frame is handed to preprocessing, and never
  // goes below the largest model input, so accuracy is untouched.
  const CAPTURE_LADDER = [1080, 900, 720];
  let captureLadderIndex = 0;
  let captureHeight = CAPTURE_LADDER[0]!;
  let overloadedTicks = 0;
  let healthyTicks = 0;

  function noteInferenceCost(ms: number) {
    inferEmaMs = inferEmaMs == null ? ms : inferEmaMs * 0.8 + ms * 0.2;
    // Playback stays smooth as long as the source keeps delivering frames; when
    // it does, the sampler is allowed to claim a larger share of wall time.
    const playbackHealthy = srcTimes.length >= 20;
    dutyTarget = playbackHealthy
      ? Math.min(DUTY_MAX, dutyTarget + 0.02)
      : Math.max(DUTY_MIN, dutyTarget - 0.08);
    const congested = inFlight >= PIPELINE_DEPTH || queued !== null;
    const wanted = (inferEmaMs / dutyTarget) * (congested ? 1.15 : 1);
    minCaptureIntervalMs = Math.min(SLOW_INTERVAL_MS, Math.max(FAST_INTERVAL_MS, wanted));

    const atFloor = minCaptureIntervalMs >= SLOW_INTERVAL_MS * 0.95;
    if (atFloor) {
      overloadedTicks++;
      healthyTicks = 0;
    } else if (minCaptureIntervalMs <= FAST_INTERVAL_MS * 1.25) {
      healthyTicks++;
      overloadedTicks = 0;
    }
    if (overloadedTicks > 30 && captureLadderIndex < CAPTURE_LADDER.length - 1) {
      captureLadderIndex++;
      captureHeight = CAPTURE_LADDER[captureLadderIndex]!;
      overloadedTicks = 0;
    } else if (healthyTicks > 120 && captureLadderIndex > 0) {
      captureLadderIndex--;
      captureHeight = CAPTURE_LADDER[captureLadderIndex]!;
      healthyTicks = 0;
    }
  }

  const onEndedHandler = () => {
    ended = true;
    queued?.bitmap.close();
    queued = null;
    deps.onEnded?.();
  };
  const onErrorHandler = () => {
    const me = deps.video.error;
    const code = me?.code ?? 0;
    const name =
      ["UNKNOWN", "MEDIA_ERR_ABORTED", "MEDIA_ERR_NETWORK", "MEDIA_ERR_DECODE", "MEDIA_ERR_SRC_NOT_SUPPORTED"][code] ?? "UNKNOWN";
    const err = new Error(`Video element error: ${name} (${me?.message || "no message"})`);
    console.error("[video-file] element error", { code, name, message: me?.message });
    deps.onError?.(err);
  };

  async function start() {
    stopped = false;
    ended = false;
    deps.video.muted = true;
    deps.video.playsInline = true;
    deps.video.addEventListener("ended", onEndedHandler);
    deps.video.addEventListener("error", onErrorHandler);
    console.info("[video-file] start requested", {
      currentSrc: deps.video.currentSrc,
      readyState: deps.video.readyState,
      networkState: deps.video.networkState,
      paused: deps.video.paused,
      ended: deps.video.ended,
    });
    if (deps.video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      throw new Error(
        `Video source started before it was playable: readyState=${deps.video.readyState}, networkState=${deps.video.networkState}, currentSrc=${deps.video.currentSrc || "none"}`,
      );
    }
    try {
      await deps.video.play();
    } catch (err) {
      console.error("[video-file] play() rejected", err);
      throw err instanceof Error
        ? err
        : new Error(`video.play() rejected: ${String(err)}`);
    }
    scheduleNext();
  }

  function stop() {
    stopped = true;
    cancelScheduledFrame();
    queued?.bitmap.close();
    queued = null;
    deps.video.removeEventListener("ended", onEndedHandler);
    deps.video.removeEventListener("error", onErrorHandler);
    try { deps.video.pause(); } catch { /* noop */ }
  }


  function scheduleNext() {
    if (stopped) return;
    cancelScheduledFrame();
    const anyVideo = deps.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number) => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    if (anyVideo.requestVideoFrameCallback) {
      scheduledFrame = {
        kind: "rvfc",
        id: anyVideo.requestVideoFrameCallback(onVideoFrame),
      };
    } else {
      scheduledFrame = {
        kind: "raf",
        id: requestAnimationFrame(() => onVideoFrame(performance.now())),
      };
    }
  }

  function cancelScheduledFrame() {
    if (!scheduledFrame) return;
    const frame = scheduledFrame;
    scheduledFrame = null;
    const anyVideo = deps.video as HTMLVideoElement & {
      cancelVideoFrameCallback?: (id: number) => void;
    };
    if (frame.kind === "rvfc" && anyVideo.cancelVideoFrameCallback) {
      anyVideo.cancelVideoFrameCallback(frame.id);
      return;
    }
    if (frame.kind === "raf") cancelAnimationFrame(frame.id);
  }

  function onVideoFrame(now: number) {
    scheduledFrame = null;
    if (stopped) return;
    pushWindow(srcTimes, now);
    totalFrameCount++;
    if (!deps.video.ended) scheduleNext();
    if (deps.video.readyState < 2 || deps.video.paused || deps.video.ended) return;
    // Keep capturing at the adaptive cadence while inference is busy. enqueue()
    // replaces and closes the one waiting bitmap, so the next run always sees
    // the newest decoded frame instead of the first frame that became stale.
    if (capturePending || now - lastCaptureAt < minCaptureIntervalMs) return;
    if (queued || inFlight >= PIPELINE_DEPTH) return;
    lastCaptureAt = now;
    capturePending = true;
    void enqueue();
  }

  async function enqueue() {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await captureBitmap();
      if (stopped || ended) {
        bitmap.close();
        return;
      }
      queued?.bitmap.close();
      queued = { bitmap, ts: Date.now() };
      bitmap = null;
      drain();
    } catch (err) {
      console.error("[video-file] frame capture error", err);
      bitmap?.close();
    } finally {
      capturePending = false;
    }
  }

  /** Decode without colour conversion / premultiply, downscaled when overloaded. */
  async function captureBitmap(): Promise<ImageBitmap> {
    const opts: ImageBitmapOptions = {
      imageOrientation: "none",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    };
    const natural = deps.video.videoHeight || 0;
    if (natural > captureHeight) {
      return createImageBitmap(deps.video, {
        ...opts,
        resizeHeight: captureHeight,
        resizeQuality: "medium",
      });
    }
    return createImageBitmap(deps.video, opts);
  }

  function drain() {
    while (!stopped && queued && inFlight < PIPELINE_DEPTH) {
      const next = queued;
      queued = null;
      inFlight++;
      pushWindow(processedTimes, performance.now());
      analysedFrameCount++;
      const startedAt = performance.now();
      void deps
        .onFrame(next.bitmap, next.ts)
        .catch((err) => console.error("[video-file] inference error", err))
        .finally(() => {
          inFlight--;
          noteInferenceCost(performance.now() - startedAt);
          if (queued && !stopped) drain();
        });
    }
  }

  function pushWindow(arr: number[], now: number) {
    arr.push(now);
    const cutoff = now - 1000;
    while (arr.length && arr[0] < cutoff) arr.shift();
  }

  return {
    start,
    stop,
    sourceFps: () => srcTimes.length,
    processedFps: () => processedTimes.length,
    totalFrames: () => totalFrameCount,
    analysedFrames: () => analysedFrameCount,
    targetInferenceFps: () => Math.round(1000 / minCaptureIntervalMs),
    queuedFrames: () => (queued ? 1 : 0),
    inFlightFrames: () => inFlight,
    pipelineDepth: () => PIPELINE_DEPTH,
    dropRate: () =>
      totalFrameCount > 0
        ? Math.max(0, (totalFrameCount - analysedFrameCount) / totalFrameCount)
        : 0,
    captureHeight: () => Math.min(captureHeight, deps.video.videoHeight || captureHeight),
    isEnded: () => ended,
  };
}
