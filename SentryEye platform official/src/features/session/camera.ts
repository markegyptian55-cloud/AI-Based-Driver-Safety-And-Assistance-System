// Camera abstraction — getUserMedia + rVFC loop + adaptive frame skipping.
// UI-independent, mockable. Implements the generic FrameSource contract.

import { applyLowLightCapture, type LowLightOutcome } from "./low-light";
import { readOrientationPreference } from "./live-preferences";
import type { FrameSource, FrameSourceHandler } from "./frame-source";
import { isMobileDevice } from "../inference/engine-preference";

export interface CameraDeps {
  video: HTMLVideoElement;
  onFrame: FrameSourceHandler;
  constraints?: MediaStreamConstraints;
  /** Push the sensor toward a longer exposure for dark cabins. */
  lowLight?: boolean;
  /** Reports which sensor controls the device actually accepted. */
  onLowLight?: (outcome: LowLightOutcome) => void;
  /**
   * Reports the live video track once acquired, so the profiler can read
   * exposure/ISO. Called again with null when the camera stops.
   */
  onTrack?: (track: MediaStreamTrack | null) => void;
}

/** Backwards-compat alias — camera returns the generic FrameSource. */
export type CameraController = FrameSource;

export function createCamera(deps: CameraDeps): FrameSource {
  let stream: MediaStream | null = null;
  let stopped = false;
  /** Frames submitted to the model that have not returned a result yet. */
  let inFlight = 0;
  const cameraTimes: number[] = [];
  const processedTimes: number[] = [];
  let totalFrameCount = 0;
  let analysedFrameCount = 0;
  let capturePending = false;
  let lastCaptureAt = 0;

  // Capture quality ladder. The preview resolution is independent of the model
  // input (preprocessing downscales anyway), so a sharper stream costs the
  // model nothing — the adaptive frame queue still protects inference FPS.
  //
  // We ask for the sensor's natural 16:9 frame and never force a portrait
  // resolution unless the driver explicitly picked "Portrait": asking a phone
  // for 720x1280 makes many devices crop the sensor, which looks like the
  // camera zoomed hard into the face. The page then displays the stream at its
  // real aspect ratio, so what you see is the normal phone camera picture.
  const mobile =
    typeof navigator !== "undefined" && isMobileDevice(navigator as never);
  // Phones should use the sensor/browser's native orientation. Swapping width
  // and height constraints often asks Android for a cropped digital mode,
  // producing the apparent face zoom. Desktop webcams benefit from an explicit
  // resolution ladder and remain landscape.
  const LADDER: MediaTrackConstraints[] = mobile
    ? [
        { facingMode: "user", frameRate: { ideal: 24, max: 30 } },
        { facingMode: "user" },
        {},
      ]
    : [
        {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode: "user",
        },
        {
          width: { ideal: 960 },
          height: { ideal: 540 },
          frameRate: { ideal: 30 },
          facingMode: "user",
        },
        { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        { facingMode: "user" },
        {},
      ];
  // Inference throttle. The <video> preview is never touched by this — it keeps
  // painting at the display's own rate (60 FPS) because the browser composites
  // the stream directly. This floor only limits how often a frame is captured
  // and handed to the model: ~18 FPS on phones and ~30 FPS on desktop, which is
  // above the rate a drowsiness signal needs while leaving the main thread and
  // GPU free for smooth scrolling and overlay animation.
  //
  // Adaptive scheduler. The bounds below are the range the pipeline is allowed
  // to move inside; where it actually sits is decided every frame from the
  // measured inference cost, so a phone that starts thermal-throttling backs
  // off to 15 FPS instead of saturating the main thread and dragging the 60 FPS
  // preview down with it. A fast device drifts back up to the ceiling.
  // Ceiling and floor for the analysis rate. The ceiling is deliberately high:
  // a device that finishes a frame in 15 ms should be allowed to run at ~50 FPS
  // instead of idling against an arbitrary 30 FPS cap. The duty-cycle rule below
  // is what actually protects the 60 FPS preview — a slow device converges to
  // the floor on its own, a fast one climbs to the ceiling.
  const fastIntervalMs = mobile ? 1000 / 40 : 1000 / 60;
  const slowIntervalMs = mobile ? 1000 / 12 : 1000 / 15;
  // Share of wall time inference may occupy before the rate is reduced.
  // Inference runs in a worker (and on the GPU), so the preview loop is not
  // competing for the same slot. The share is no longer a fixed constant: it
  // ramps up while the preview keeps delivering frames at the source rate and
  // backs off the moment the preview starts dropping them, so a healthy device
  // climbs toward the ceiling instead of idling under an arbitrary budget.
  const DUTY_MIN = mobile ? 0.5 : 0.7;
  const DUTY_MAX = mobile ? 0.85 : 0.95;
  let dutyTarget = mobile ? 0.6 : 0.8;
  let minCaptureIntervalMs = mobile ? 1000 / 20 : 1000 / 30;
  /** Smoothed cost of one analysed frame (ms), null until the first one lands. */
  let inferEmaMs: number | null = null;

  // Adaptive capture resolution. The model's own input size is fixed by the
  // registry and is never touched here; this only decides how large a frame is
  // handed to preprocessing. A 1080p bitmap costs decode + upload time for
  // detail the model discards, so an overloaded device steps down the ladder
  // and a recovering one steps back up. The floor stays well above the largest
  // model input (960), so detection accuracy is unaffected.
  const CAPTURE_LADDER = [1080, 900, 720];
  let captureLadderIndex = mobile ? 1 : 0;
  let captureHeight = CAPTURE_LADDER[captureLadderIndex]!;
  /** Consecutive scheduler ticks spent pinned at the slowest allowed rate. */
  let overloadedTicks = 0;
  let healthyTicks = 0;

  /** Preview health: source FPS over the last second vs. what the stream offers. */
  function previewHealthy(): boolean {
    const fps = cameraTimes.length;
    if (fps === 0) return true; // no signal yet — don't punish the ramp
    return fps >= (mobile ? 22 : 50);
  }

  function noteInferenceCost(ms: number) {
    inferEmaMs = inferEmaMs == null ? ms : inferEmaMs * 0.8 + ms * 0.2;
    // Ramp gently up while the preview is smooth, drop fast when it is not.
    dutyTarget = previewHealthy()
      ? Math.min(DUTY_MAX, dutyTarget + 0.02)
      : Math.max(DUTY_MIN, dutyTarget - 0.08);
    // Motion spikes: when the scene is busy every slot produces a real
    // inference, so the queue is the thing under pressure, not the model. A
    // frame that had to wait behind a full pipeline is a signal to sample less
    // often rather than pile up latency.
    const congested = inFlight >= 2 || queued !== null;
    const wanted = (inferEmaMs / dutyTarget) * (congested ? 1.15 : 1);
    minCaptureIntervalMs = Math.min(slowIntervalMs, Math.max(fastIntervalMs, wanted));

    // Capture ladder hysteresis: several seconds of sustained overload before
    // stepping down, and a longer healthy stretch before stepping back up, so
    // the frame size does not oscillate on a noisy device.
    const atFloor = minCaptureIntervalMs >= slowIntervalMs * 0.95;
    if (atFloor) {
      overloadedTicks++;
      healthyTicks = 0;
    } else if (minCaptureIntervalMs <= fastIntervalMs * 1.25) {
      healthyTicks++;
      overloadedTicks = 0;
    }
    if (overloadedTicks > 45 && captureLadderIndex < CAPTURE_LADDER.length - 1) {
      captureLadderIndex++;
      captureHeight = CAPTURE_LADDER[captureLadderIndex]!;
      overloadedTicks = 0;
    } else if (healthyTicks > 180 && captureLadderIndex > 0) {
      captureLadderIndex--;
      captureHeight = CAPTURE_LADDER[captureLadderIndex]!;
      healthyTicks = 0;
    }
  }

  // Motion gate. A perfectly still scene does not need a fresh inference every
  // slot: we compare a tiny grayscale thumbnail of consecutive frames and skip
  // the model when nothing moved. The gate is deliberately conservative — it
  // never withholds a frame for longer than STILL_MAX_GAP_MS, so eye-closure
  // timing (PERCLOS, microsleep) keeps a guaranteed sampling floor.
  const STILL_MAX_GAP_MS = 200;
  const STILL_THRESHOLD = 3.0; // mean abs 0-255 difference
  const GRID_W = 32;
  const GRID_H = 24;
  let motionCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  let motionCtx:
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null = null;
  let lastThumb: Float32Array | null = null;
  let lastAnalysedAt = 0;

  /** True when the frame is close enough to the previous one to skip. */
  function frameIsStill(now: number): boolean {
    if (now - lastAnalysedAt >= STILL_MAX_GAP_MS) return false;
    try {
      if (!motionCtx) {
        motionCanvas =
          typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(GRID_W, GRID_H)
            : Object.assign(document.createElement("canvas"), {
                width: GRID_W,
                height: GRID_H,
              });
        motionCtx = (motionCanvas as HTMLCanvasElement).getContext("2d", {
          willReadFrequently: true,
        }) as CanvasRenderingContext2D | null;
      }
      if (!motionCtx) return false;
      motionCtx.drawImage(deps.video as CanvasImageSource, 0, 0, GRID_W, GRID_H);
      const { data } = motionCtx.getImageData(0, 0, GRID_W, GRID_H);
      const thumb = new Float32Array(GRID_W * GRID_H);
      for (let i = 0, p = 0; i < thumb.length; i++, p += 4) {
        thumb[i] = (data[p]! * 299 + data[p + 1]! * 587 + data[p + 2]! * 114) / 1000;
      }
      const prev = lastThumb;
      lastThumb = thumb;
      if (!prev) return false;
      let sum = 0;
      for (let i = 0; i < thumb.length; i++) sum += Math.abs(thumb[i]! - prev[i]!);
      return sum / thumb.length < STILL_THRESHOLD;
    } catch {
      return false;
    }
  }




  const candidates: MediaStreamConstraints[] = deps.constraints
    ? [deps.constraints]
    : LADDER.map((video) => ({ video, audio: false }));

  async function start() {
    stopped = false;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "This browser doesn't expose a camera API. Use a recent Chrome, Edge, or Safari over HTTPS.",
      );
    }
    let lastErr: unknown = null;
    for (const candidate of candidates) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(candidate);
        break;
      } catch (err) {
        lastErr = err;
        stream = null;
      }
    }
    if (!stream) throw new Error(describeMediaError(lastErr));

    if (deps.lowLight) {
      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          deps.onLowLight?.(await applyLowLightCapture(track));
        } catch (err) {
          console.warn("[camera] low-light capture failed", err);
        }
      }
    }
    deps.onTrack?.(stream.getVideoTracks()[0] ?? null);
    deps.video.srcObject = stream;
    deps.video.muted = true;
    deps.video.playsInline = true;
    try {
      await deps.video.play();
    } catch (err) {
      stop();
      throw new Error(
        `The camera stream could not be played back: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    scheduleNext();
  }

  function stop() {
    stopped = true;
    queued?.bitmap.close();
    queued = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    deps.onTrack?.(null);
    try {
      deps.video.pause();
    } catch {
      /* noop */
    }
    if (deps.video.srcObject) deps.video.srcObject = null;
  }

  function scheduleNext() {
    if (stopped) return;
    const anyVideo = deps.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number) => void) => number;
    };
    if (anyVideo.requestVideoFrameCallback) {
      anyVideo.requestVideoFrameCallback(onVideoFrame);
    } else {
      requestAnimationFrame(() => onVideoFrame(performance.now()));
    }
  }

  // Latest-frame-wins queue with a depth-2 pipeline.
  //
  // The old loop awaited the full result — inference *and* the main thread's
  // tracker/overlay/state work — before submitting anything else, so those two
  // phases never overlapped. Now up to PIPELINE_DEPTH frames may be in flight:
  // while the worker runs frame N+1, the main thread finishes consuming frame
  // N. The worker itself still executes frames strictly one at a time, so
  // results stay in order and nothing races inside the session.
  const PIPELINE_DEPTH = 2;
  let queued: { bitmap: ImageBitmap; ts: number } | null = null;

  function onVideoFrame(now: number) {
    if (stopped) return;
    pushWindow(cameraTimes, now);
    totalFrameCount++;
    scheduleNext();
    if (deps.video.readyState < 2) return;
    if (capturePending) return;
    // Throttled capture. The preview keeps running at the source's own rate;
    // only the analysis path is rate-limited, so the UI thread stays free
    // between inferences instead of chasing every single camera frame.
    if (now - lastCaptureAt < minCaptureIntervalMs) return;
    if (queued) return; // a fresher frame is already waiting for the model
    if (inFlight >= PIPELINE_DEPTH) return; // pipeline full — let it drain
    // Nothing moved since the last analysed frame — reuse the previous result
    // instead of paying for an inference. Bounded by STILL_MAX_GAP_MS above.
    if (frameIsStill(now)) {
      lastCaptureAt = now;
      return;
    }
    capturePending = true;

    lastCaptureAt = now;
    void enqueue();


  }

  async function enqueue() {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await captureBitmap();
      if (stopped) {
        bitmap.close();
        return;
      }
      // Drop the stale frame still waiting for the model.
      queued?.bitmap.close();
      queued = { bitmap, ts: Date.now() };
      bitmap = null;
      drain();
    } catch (err) {
      console.error("[camera] frame error", err);
      bitmap?.close();
    } finally {
      capturePending = false;
    }
  }

  /**
   * Capture options matter for latency: skipping colour-space conversion,
   * alpha premultiplication and EXIF orientation removes per-frame work the
   * model never benefits from. On overloaded devices the capture is also
   * downscaled — never below CAPTURE_FLOOR, so the model still receives more
   * detail than its own input size and accuracy is untouched.
   */
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
      lastAnalysedAt = performance.now();
      analysedFrameCount++;

      const startedAt = performance.now();
      void deps
        .onFrame(next.bitmap, next.ts) // ownership transferred
        .catch((err) => console.error("[camera] inference error", err))
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
    sourceFps: () => cameraTimes.length,
    processedFps: () => processedTimes.length,
    totalFrames: () => totalFrameCount,
    analysedFrames: () => analysedFrameCount,
    /** Current adaptive inference budget, for telemetry/debug panels. */
    targetInferenceFps: () => Math.round(1000 / minCaptureIntervalMs),
    queuedFrames: () => (queued ? 1 : 0),
    inFlightFrames: () => inFlight,
    pipelineDepth: () => PIPELINE_DEPTH,
    dropRate: () =>
      totalFrameCount > 0
        ? Math.max(0, (totalFrameCount - analysedFrameCount) / totalFrameCount)
        : 0,
    captureHeight: () => Math.min(captureHeight, deps.video.videoHeight || captureHeight),
  };
}

/** Maps getUserMedia DOMExceptions to actionable, user-facing guidance. */
export function describeMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : (err as { name?: string })?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was denied. Allow camera permission for this site in your browser settings, then start the session again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No compatible camera was found. Connect a webcam or pick a different device, then try again.";
    case "NotReadableError":
      return "The camera is already in use by another application. Close it and try again.";
    case "AbortError":
      return "Camera start was interrupted. Please try again.";
    default:
      return err instanceof Error
        ? `Camera could not be started: ${err.message}`
        : "Camera could not be started.";
  }
}

/**
 * True when the camera should be opened in portrait.
 *
 * Phones are held upright by default, so a landscape ("film") stream wastes
 * most of the frame on the cabin instead of the driver's face. We follow the
 * viewport/screen orientation, so a user who rotates the device — or unlocks
 * rotation — immediately gets a landscape capture again. Desktops always stay
 * landscape.
 */
export function prefersPortraitCapture(): boolean {
  if (typeof window === "undefined") return false;
  // An explicit per-device choice always wins over the sensor/UA guess.
  const pref = readOrientationPreference();
  if (pref === "portrait") return true;
  if (pref === "landscape") return false;
  const nav = window.navigator;
  const touch = (nav.maxTouchPoints ?? 0) > 1;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent ?? "");
  if (!touch && !mobileUa) return false;
  const type = window.screen?.orientation?.type;
  if (typeof type === "string") return type.startsWith("portrait");
  return window.innerHeight >= window.innerWidth;
}
