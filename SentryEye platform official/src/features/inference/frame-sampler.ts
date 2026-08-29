// Frame sampling for the benchmark.
//
// A benchmark on synthetic noise proves nothing: the model must see faces in
// the driver's own lighting. So frames come from the user's own material — a
// clip, a photo, or a few seconds of their camera.

export interface SampleOptions {
  /** How many frames to collect. */
  count: number;
  /** Longest time to spend collecting (ms) before giving up. */
  timeoutMs?: number;
}

export async function sampleFromImage(file: File, count: number): Promise<ImageBitmap[]> {
  const bitmap = await createImageBitmap(file);
  // One decode, N handles: the benchmark clones per pass anyway.
  const frames = await Promise.all(Array.from({ length: count }, () => createImageBitmap(bitmap)));
  bitmap.close();
  return frames;
}

export async function sampleFromVideo(
  file: File,
  { count, timeoutMs = 20000 }: SampleOptions,
): Promise<ImageBitmap[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await once(video, "loadeddata", timeoutMs);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const frames: ImageBitmap[] = [];
    for (let i = 0; i < count; i++) {
      // Spread the samples across the clip so one static scene cannot
      // flatter a candidate.
      if (duration > 0) {
        video.currentTime = ((i + 0.5) / count) * duration;
        await once(video, "seeked", 5000);
      }
      frames.push(await createImageBitmap(video));
    }
    return frames;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function sampleFromCamera({
  count,
  timeoutMs = 20000,
}: SampleOptions): Promise<{ frames: ImageBitmap[]; track: MediaStreamTrack | null }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
    await once(video, "loadeddata", timeoutMs);
    const frames: ImageBitmap[] = [];
    for (let i = 0; i < count; i++) {
      frames.push(await createImageBitmap(video));
      await delay(120);
    }
    return { frames, track: stream.getVideoTracks()[0] ?? null };
  } finally {
    // The stream must die with the sampler; a live camera light after a
    // benchmark is a bug users rightly distrust.
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
  }
}

function once(el: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
      clearTimeout(timer);
    };
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error("This media could not be decoded by the browser."));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for "${event}".`));
    }, timeoutMs);
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function closeFrames(frames: ImageBitmap[]) {
  for (const f of frames) f.close();
}
