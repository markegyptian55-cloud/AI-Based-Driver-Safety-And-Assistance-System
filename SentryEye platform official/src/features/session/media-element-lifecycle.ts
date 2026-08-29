// Browser media-element lifecycle helpers.
//
// Since the analysis session outlives the Video page, the <video> element does
// NOT: it is destroyed on every route change and recreated on the way back.
// Chromium keeps a decoder pipeline plus an open Blob reader attached to an
// element until the element is explicitly detached; simply dropping the node
// leaves that reader alive. A second element then loads the same blob URL, the
// first pipeline is torn down by GC, and the live one loses its data source ->
// MEDIA_ERR_DECODE / PIPELINE_ERROR_DISCONNECTED.
//
// These helpers guarantee:
//  - exactly one element owns a given blob URL at a time,
//  - detachment always releases the decoder before the URL can be revoked,
//  - loading is a deterministic sequence: listeners -> src -> load() ->
//    loadedmetadata -> seek -> ready.

export interface LoadMediaOptions {
  /** Playback position (seconds) to restore once metadata is known. */
  position?: number;
  /** Abort a load that never reaches loadedmetadata. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Fully release an element's media pipeline. Safe to call repeatedly and on
 * elements that never had a source. After this returns the underlying Blob URL
 * has no reader left, so it may be revoked.
 */
export function detachMediaElement(video: HTMLVideoElement | null): void {
  if (!video) return;
  try {
    video.pause();
  } catch {
    /* element may already be detached from the document */
  }
  try {
    // Order matters: clearing the attribute and calling load() is the only way
    // to make the resource-selection algorithm drop the current data source.
    video.removeAttribute("src");
    video.srcObject = null;
    video.load();
  } catch {
    /* noop */
  }
}

/** True when `t` is inside a seekable range of the element. */
export function isSeekableTo(video: HTMLVideoElement, t: number): boolean {
  const ranges = video.seekable;
  for (let i = 0; i < ranges.length; i++) {
    if (t >= ranges.start(i) && t <= ranges.end(i)) return true;
  }
  return false;
}

/**
 * Deterministically load a blob URL into a freshly mounted element and restore
 * the playback position. Resolves once the element has metadata (and has
 * finished seeking, when a position was requested).
 */
export function loadMediaElement(
  video: HTMLVideoElement,
  url: string,
  opts: LoadMediaOptions = {},
): Promise<void> {
  const { position = 0, timeoutMs = 30_000, signal } = opts;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: number | undefined;

    const cleanup = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onError);
      video.removeEventListener("seeked", onSeeked);
      signal?.removeEventListener("abort", onAbort);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onSeeked = () => done();
    const onMeta = () => {
      const target = position;
      if (target > 0 && Number.isFinite(video.duration) && isSeekableTo(video, target)) {
        video.addEventListener("seeked", onSeeked);
        try {
          video.currentTime = target;
          return;
        } catch {
          video.removeEventListener("seeked", onSeeked);
        }
      }
      done();
    };
    const onError = () =>
      fail(new Error(`Media load failed (code ${video.error?.code ?? 0})`));
    const onAbort = () => fail(new Error("Media load aborted"));

    // Always start from a clean pipeline: never reuse a decoder that may have
    // been disconnected by a previous route unmount.
    detachMediaElement(video);

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = window.setTimeout(() => fail(new Error("Media load timed out")), timeoutMs);

    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.load();
  });
}

export interface WaitForVideoReadyOptions {
  /** Abort if the element never becomes playable. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * The single readiness gate for inference.
 *
 * Resolves only once the element is genuinely decodable:
 *   - a source is attached (src/currentSrc),
 *   - metadata is known (`loadedmetadata`),
 *   - the first frame is decoded and more is buffered (`canplay`,
 *     readyState >= HAVE_FUTURE_DATA),
 *   - intrinsic dimensions are non-zero.
 *
 * Purely event-driven: no readyState polling loop. Rejects with a descriptive
 * error on media errors, abort, or timeout so callers can surface a real
 * message instead of silently refusing to start.
 */
export function waitForVideoReady(
  video: HTMLVideoElement,
  opts: WaitForVideoReadyOptions = {},
): Promise<void> {
  const { timeoutMs = 30_000, signal } = opts;

  const isReady = () =>
    video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0;

  if (isReady()) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: number | undefined;
    const events = ["loadedmetadata", "loadeddata", "canplay", "canplaythrough", "playing"];

    const cleanup = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      for (const name of events) video.removeEventListener(name, onProgress);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    function onProgress() {
      if (isReady()) done();
    }
    const onError = () =>
      fail(new Error(`Video failed to decode (media error code ${video.error?.code ?? 0})`));
    const onAbort = () => fail(new Error("Waiting for the video was aborted"));

    if (!video.currentSrc && !video.getAttribute("src")) {
      fail(new Error("No video source is attached to the media element"));
      return;
    }

    for (const name of events) video.addEventListener(name, onProgress);
    video.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = window.setTimeout(
      () =>
        fail(
          new Error(
            `Video never became playable within ${Math.round(timeoutMs / 1000)}s ` +
              `(readyState=${video.readyState}, ${video.videoWidth}x${video.videoHeight}).`,
          ),
        ),
      timeoutMs,
    );

    // A `canplay` may have fired between the isReady() check and listener
    // attachment; re-check once now that listeners are installed.
    onProgress();
  });
}
