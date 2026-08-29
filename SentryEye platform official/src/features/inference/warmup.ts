// Kernel warm-up.
//
// Downloading and creating an ONNX session is only half the first-frame cost:
// the very first inference compiles shaders (WebGPU) or JIT-specialises WASM
// kernels, which is exactly the stutter drivers see on the first live frame.
// Running a couple of synthetic frames through the provider before Start pays
// that cost while the user is still reading the page.

import type { InferenceProvider } from "./types";

export interface WarmupTiming {
  /** Latency of the very first synthetic frame (ms) — the compile cost. */
  firstFrameMs: number;
  /** Latency of the last synthetic frame (ms) — the steady-state cost. */
  steadyFrameMs: number;
  frames: number;
}

/** Neutral mid-grey frame at the model's input size. */
async function syntheticFrame(imgsz: number): Promise<ImageBitmap> {
  const size = Math.max(64, Math.min(1536, Math.round(imgsz)));
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement("canvas"), { width: size, height: size });
  const ctx = (canvas as OffscreenCanvas).getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("2D canvas unavailable for warm-up");
  ctx.fillStyle = "#7f7f7f";
  ctx.fillRect(0, 0, size, size);
  return createImageBitmap(canvas as never);
}

/**
 * Push `frames` synthetic frames through the provider. Never throws: warm-up
 * is an optimisation, and a failure here must not block the session.
 */
export async function warmUpProvider(
  provider: InferenceProvider,
  imgsz: number,
  frames = 2,
): Promise<WarmupTiming | null> {
  try {
    let first = 0;
    let last = 0;
    for (let i = 0; i < frames; i += 1) {
      const bitmap = await syntheticFrame(imgsz);
      const startedAt = performance.now();
      await provider.infer(bitmap, Date.now());
      const elapsed = performance.now() - startedAt;
      bitmap.close?.();
      if (i === 0) first = elapsed;
      last = elapsed;
    }
    return { firstFrameMs: Math.round(first), steadyFrameMs: Math.round(last), frames };
  } catch (err) {
    console.warn("[warmup] synthetic frame failed", err);
    return null;
  }
}
