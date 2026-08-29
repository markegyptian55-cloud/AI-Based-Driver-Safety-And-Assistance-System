// Pure image → NCHW float32 conversion. Shared by browser and remote providers.
// Model-agnostic: resize strategy and normalization come from model metadata,
// never hardcoded per architecture.

export type ResizeMode = "letterbox" | "stretch";
export type NormalizeMode = "unit" | "imagenet";

export interface PreprocessOptions {
  resize: ResizeMode;
  normalize: NormalizeMode;
  /**
   * Linear brightness multiplier applied before normalization. Used by the
   * low-light preset so a dark phone frame is not fed to the model as noise.
   * 1 = untouched.
   */
  gain?: number;
}

export interface PreprocessResult {
  /** Float32 NCHW tensor data, length = 3 * imgsz * imgsz */
  data: Float32Array;
  /** Uniform scale applied (letterbox). For "stretch" this is 1 and sx/sy carry the mapping. */
  scale: number;
  /** Per-axis scale from source px → model px (stretch mode). */
  scaleX: number;
  scaleY: number;
  /** Padding added on x/y in model input space. */
  padX: number;
  padY: number;
  /** Original source dimensions. */
  srcW: number;
  srcH: number;
  /** Mean luma of the frame BEFORE gain, 0..1 — the true scene brightness. */
  luma: number;
  /** Gain actually applied. */
  gain: number;
}

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

export function preprocessFrame(
  frame: ImageBitmap,
  imgsz: number,
  ctx: OffscreenCanvasRenderingContext2D,
  opts: PreprocessOptions,
  /**
   * Optional destination buffer, reused across frames. A 960×960 tensor is
   * 11 MB per frame; allocating one per frame stalls the worker on GC.
   */
  out?: Float32Array,
): PreprocessResult {
  const srcW = frame.width;
  const srcH = frame.height;

  let scale = 1;
  let scaleX: number;
  let scaleY: number;
  let padX = 0;
  let padY = 0;

  if (opts.resize === "letterbox") {
    scale = Math.min(imgsz / srcW, imgsz / srcH);
    const dstW = Math.round(srcW * scale);
    const dstH = Math.round(srcH * scale);
    padX = Math.floor((imgsz - dstW) / 2);
    padY = Math.floor((imgsz - dstH) / 2);
    scaleX = scale;
    scaleY = scale;
    ctx.fillStyle = "rgb(114,114,114)";
    ctx.fillRect(0, 0, imgsz, imgsz);
    ctx.drawImage(frame, padX, padY, dstW, dstH);
  } else {
    scaleX = imgsz / srcW;
    scaleY = imgsz / srcH;
    ctx.clearRect(0, 0, imgsz, imgsz);
    ctx.drawImage(frame, 0, 0, imgsz, imgsz);
  }

  const { data: rgba } = ctx.getImageData(0, 0, imgsz, imgsz);
  const size = imgsz * imgsz;
  const dst =
    out && out.length === 3 * size ? out : new Float32Array(3 * size);
  const useImagenet = opts.normalize === "imagenet";
  const gain = opts.gain && opts.gain > 0 ? opts.gain : 1;
  let lumaSum = 0;
  let lumaCount = 0;

  // Hot loop: 3·imgsz² writes per frame (2.8 M at 960 px). Divisions are hoisted
  // into a single multiplier, the normalisation branch is lifted out of the loop
  // and luma is sampled on a sparse grid — the mean brightness of every 8th
  // pixel is indistinguishable from the full average at a fraction of the cost.
  const INV255 = 1 / 255;
  const k = gain * INV255;
  const green = size;
  const blue = 2 * size;

  if (useImagenet) {
    const [mr, mg, mb] = IMAGENET_MEAN;
    const [sr, sg, sb] = IMAGENET_STD;
    for (let i = 0, p = 0; i < size; i++, p += 4) {
      const r = rgba[p] * k;
      const g = rgba[p + 1] * k;
      const b = rgba[p + 2] * k;
      dst[i] = ((r > 1 ? 1 : r) - mr) / sr;
      dst[i + green] = ((g > 1 ? 1 : g) - mg) / sg;
      dst[i + blue] = ((b > 1 ? 1 : b) - mb) / sb;
      if ((i & 7) === 0) {
        lumaSum +=
          (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]) * INV255;
        lumaCount++;
      }
    }
  } else {
    for (let i = 0, p = 0; i < size; i++, p += 4) {
      const r = rgba[p] * k;
      const g = rgba[p + 1] * k;
      const b = rgba[p + 2] * k;
      dst[i] = r > 1 ? 1 : r;
      dst[i + green] = g > 1 ? 1 : g;
      dst[i + blue] = b > 1 ? 1 : b;
      if ((i & 7) === 0) {
        lumaSum +=
          (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]) * INV255;
        lumaCount++;
      }
    }
  }

  return {
    data: dst,
    scale,
    scaleX,
    scaleY,
    padX,
    padY,
    srcW,
    srcH,
    luma: lumaCount ? lumaSum / lumaCount : 0,

    gain,
  };
}

/** Back-compat helper: letterbox + [0,1] normalization (Ultralytics default). */
export function letterbox(
  frame: ImageBitmap,
  imgsz: number,
  ctx: OffscreenCanvasRenderingContext2D,
): PreprocessResult {
  return preprocessFrame(frame, imgsz, ctx, { resize: "letterbox", normalize: "unit" });
}
