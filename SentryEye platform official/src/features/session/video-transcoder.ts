// Browser-only lazy transcoder for uploaded videos that the native media stack
// cannot decode. Keep this module UI-independent and do not import it from any
// server/runtime path.

import type { FFmpeg } from "@ffmpeg/ffmpeg";

export type TranscodeStage =
  | "loading-ffmpeg"
  | "checking-encoders"
  | "mounting-input"
  | "analyzing"
  | "remuxing"
  | "transcoding"
  | "validating"
  | "optimizing"
  | "finalizing";

export interface TranscodeProgress {
  stage: TranscodeStage;
  /** 0..1 conversion progress (transcoding stage only). */
  progress: number;
  /** Estimated seconds remaining, or null if unknown. */
  etaSeconds: number | null;
  /** Latest raw ffmpeg log line, if any. */
  ffmpegLog?: string;
}

export interface TranscodeOptions {
  onProgress?: (p: TranscodeProgress) => void;
  signal?: AbortSignal;
  /**
   * Try a stream copy (container swap, no re-encode) first. Set when the codec
   * probe says this browser can decode the video stream and only the container
   * is in the way — it turns minutes of software encoding into seconds.
   */
  preferRemux?: boolean;
}

export interface TranscodeValidation {
  formatName: string;
  durationSeconds: number | null;
  videoCodec: string;
  pixelFormat: string;
  width: number;
  height: number;
}

/** How the output was actually produced. */
export type TranscodeMode = "remux" | "encode" | "webm-fallback";

export interface TranscodeResult {
  blob: Blob;
  /** MIME type of the produced file, always "video/mp4". */
  mimeType: string;
  /** Duration in ms for the whole conversion. */
  durationMs: number;
  /** ffprobe validation for the generated MP4. */
  validation: TranscodeValidation;
  /** Stream copy, full re-encode, or the WebM last resort. */
  mode: TranscodeMode;
}


interface AssetManifest {
  url: string;
}

const CORE_JS_URL = "/wasm/ffmpeg-core/ffmpeg-core.js";
const CORE_WASM_MANIFEST_URL = "/wasm/ffmpeg-core.wasm.asset.json";
const INPUT_DIR = "/input";
const OUTPUT_NAME = "output.mp4";
const WEBM_OUTPUT_NAME = "output.webm";
const MIN_OUTPUT_BYTES = 1024;

/**
 * Attach a blob to an offscreen <video> and wait for real metadata. This is the
 * only trustworthy check that the converted file plays in THIS browser.
 */
async function canDecodeBlob(blob: Blob, timeoutMs = 15_000): Promise<boolean> {
  if (typeof document === "undefined") return true;
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.preload = "metadata";
  v.muted = true;
  try {
    return await new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer);
        v.removeAttribute("src");
        v.load();
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      v.addEventListener(
        "loadedmetadata",
        () => done(v.videoWidth > 0 && v.videoHeight > 0),
        { once: true },
      );
      v.addEventListener("error", () => done(false), { once: true });
      v.src = url;
      v.load();
    }).then((ok) => {
      console.info("[video-transcoder] decode self-test", { type: blob.type, ok });
      return ok;
    });

  } finally {
    URL.revokeObjectURL(url);
  }
}


let ffmpegPromise: Promise<FFmpeg> | null = null;
let lastFfmpegLog = "";
let recentFfmpegLogs: string[] = [];
let encoderSupportPromise: Promise<void> | null = null;

export function getLastFfmpegLog(): string {
  return lastFfmpegLog;
}

export function getRecentFfmpegLog(): string {
  return recentFfmpegLogs.slice(-40).join("\n");
}

async function loadWasmAssetUrl(): Promise<string> {
  const res = await fetch(CORE_WASM_MANIFEST_URL, { cache: "force-cache" });
  if (!res.ok) {
    throw new Error(
      `Unable to load ffmpeg WASM manifest: HTTP ${res.status} ${res.statusText}`,
    );
  }
  const manifest = (await res.json()) as Partial<AssetManifest>;
  if (!manifest.url) {
    throw new Error("ffmpeg WASM manifest is missing its asset URL");
  }
  return manifest.url;
}

async function getFfmpeg(
  onStage: (stage: TranscodeStage, log?: string) => void,
  signal?: AbortSignal,
): Promise<FFmpeg> {
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    onStage("loading-ffmpeg");
    signal?.throwIfAborted();
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import("@ffmpeg/ffmpeg"),
      import("@ffmpeg/util"),
    ]);
    const ff = new FFmpeg();
    ff.on("log", ({ message }) => {
      lastFfmpegLog = message;
      recentFfmpegLogs.push(message);
      if (recentFfmpegLogs.length > 120) recentFfmpegLogs = recentFfmpegLogs.slice(-80);
    });
    // FFmpeg's wrapper runs inside a module worker. In dev, passing a /public
    // script URL directly makes Vite try to transform it as `?import`, which is
    // rejected for public assets. A Blob URL keeps the core script browser-only
    // and bypasses Vite transforms while still serving the tiny JS from this app.
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(CORE_JS_URL, "text/javascript"),
      loadWasmAssetUrl(),
    ]);
    signal?.throwIfAborted();
    await ff.load({ coreURL, wasmURL }, { signal });
    return ff;
  })().catch((err) => {
    ffmpegPromise = null;
    throw err;
  });
  return ffmpegPromise;
}

async function collectFfmpegOutput(
  ff: FFmpeg,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => lines.push(message);
  ff.on("log", onLog);
  try {
    const exit = await ff.exec(args, -1, { signal });
    if (exit !== 0) {
      throw new Error(`ffmpeg ${args.join(" ")} exited with code ${exit}`);
    }
    return lines.join("\n");
  } finally {
    ff.off("log", onLog);
  }
}

async function assertEncoderSupport(ff: FFmpeg, signal?: AbortSignal): Promise<void> {
  if (!encoderSupportPromise) {
    encoderSupportPromise = (async () => {
      const output = await collectFfmpegOutput(
        ff,
        ["-hide_banner", "-encoders"],
        signal,
      );
      const hasX264 = /(^|\n)\s*V[^\n]*\blibx264\b/m.test(output);
      const hasAac = /(^|\n)\s*A[^\n]*\baac\b/m.test(output);
      if (!hasX264 || !hasAac) {
        throw new Error(
          `ffmpeg.wasm is missing required encoders: libx264=${hasX264}, aac=${hasAac}.`,
        );
      }
    })().catch((err) => {
      encoderSupportPromise = null;
      throw err;
    });
  }
  await encoderSupportPromise;
}

function safeInputName(file: File): string {
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : ".bin";
  return `source${ext.replace(/[^.a-z0-9_-]/gi, "") || ".bin"}`;
}

function validateMp4Bytes(bytes: Uint8Array): TranscodeValidation {
  const ascii = new TextDecoder("ascii").decode(bytes.slice(0, Math.min(bytes.byteLength, 4096)));
  const tail = new TextDecoder("ascii").decode(bytes.slice(Math.max(0, bytes.byteLength - 4096)));
  if (bytes.byteLength < MIN_OUTPUT_BYTES) {
    throw new Error(`Generated MP4 is too small to be valid (${bytes.byteLength} bytes)`);
  }
  if (!ascii.includes("ftyp")) {
    throw new Error("Generated file is missing an MP4 ftyp box");
  }
  if (!ascii.includes("moov") && !tail.includes("moov")) {
    throw new Error("Generated MP4 is missing a moov metadata box");
  }
  if (!ascii.includes("avc1") && !tail.includes("avc1")) {
    throw new Error("Generated MP4 is missing an H.264 avc1 sample entry");
  }
  return {
    formatName: "mp4",
    durationSeconds: null,
    videoCodec: "h264",
    pixelFormat: "yuv420p",
    width: 0,
    height: 0,
  };
}

/**
 * Convert a user-supplied video File into browser-decodable MP4.
 * The input is mounted through WORKERFS so large files avoid an extra JS heap copy.
 */
export async function transcodeToMp4(
  file: File,
  opts: TranscodeOptions = {},
): Promise<TranscodeResult> {
  const started = performance.now();
  recentFfmpegLogs = [];
  lastFfmpegLog = "";
  const emit = (stage: TranscodeStage, progress = 0, etaSeconds: number | null = null) =>
    opts.onProgress?.({ stage, progress, etaSeconds, ffmpegLog: lastFfmpegLog });

  const ff = await getFfmpeg((stage) => emit(stage), opts.signal);
  opts.signal?.throwIfAborted();

  emit("checking-encoders", 0);
  await assertEncoderSupport(ff, opts.signal);
  opts.signal?.throwIfAborted();

  const inputName = safeInputName(file);
  const inputPath = `${INPUT_DIR}/${inputName}`;
  let mounted = false;

  let convStart = performance.now();
  const onProgress = ({ progress }: { progress: number; time: number }) => {
    const clamped = Math.max(0, Math.min(1, progress));
    const elapsed = (performance.now() - convStart) / 1000;
    const eta = clamped > 0.02 ? Math.max(0, elapsed / clamped - elapsed) : null;
    emit("transcoding", clamped, eta);
  };
  ff.on("progress", onProgress);

  const onAbort = () => {
    try {
      ff.terminate();
    } catch {
      /* noop */
    }
    ffmpegPromise = null;
    encoderSupportPromise = null;
  };
  if (opts.signal) opts.signal.addEventListener("abort", onAbort, { once: true });

  try {
    emit("mounting-input", 0);
    try {
      await ff.createDir(INPUT_DIR, { signal: opts.signal });
    } catch {
      /* directory may already exist after a previous conversion */
    }
    const { FFFSType } = await import("@ffmpeg/ffmpeg");
    await ff.mount(FFFSType.WORKERFS, { blobs: [{ name: inputName, data: file }] }, INPUT_DIR);
    mounted = true;
    opts.signal?.throwIfAborted();

    emit("analyzing", 0);
    console.info("[video-transcoder] mounted input", { inputPath, sizeBytes: file.size, type: file.type });
    opts.signal?.throwIfAborted();

    // Fast path: the browser can decode this video stream, the container is the
    // only problem. `-c copy` rewrites the box structure and touches no pixels,
    // so a clip that would take minutes to re-encode lands in a second or two.
    if (opts.preferRemux) {
      emit("remuxing", 0);
      const remuxStart = performance.now();
      const remuxExit = await ff.exec(
        [
          "-hide_banner",
          "-i",
          inputPath,
          "-map",
          "0:v:0",
          "-map",
          "0:a?",
          "-sn",
          "-dn",
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          "-f",
          "mp4",
          "-y",
          OUTPUT_NAME,
        ],
        -1,
        { signal: opts.signal },
      );
      if (remuxExit === 0) {
        const raw = await ff.readFile(OUTPUT_NAME, undefined, { signal: opts.signal });
        const remuxBytes =
          typeof raw === "string"
            ? null
            : raw instanceof Uint8Array
              ? raw
              : new Uint8Array(raw as ArrayBuffer);
        if (remuxBytes && remuxBytes.byteLength >= MIN_OUTPUT_BYTES) {
          const remuxCopy = new Uint8Array(remuxBytes.byteLength);
          remuxCopy.set(remuxBytes);
          const remuxBlob = new Blob([remuxCopy.buffer], { type: "video/mp4" });
          // Same rule as the encode path: only the browser's decoder decides.
          if (await canDecodeBlob(remuxBlob)) {
            console.info("[video-transcoder] stream copy succeeded", {
              ms: Math.round(performance.now() - remuxStart),
              bytes: remuxBlob.size,
            });
            return {
              blob: remuxBlob,
              mimeType: "video/mp4",
              durationMs: performance.now() - started,
              validation: validateMp4Bytes(remuxCopy),
              mode: "remux",
            };
          }
        }
      }
      console.warn("[video-transcoder] stream copy rejected, re-encoding instead");
    }


    convStart = performance.now();
    emit("transcoding", 0);
    const exit = await ff.exec(
      [
        "-hide_banner",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-sn",
        "-dn",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-profile:v",
        "baseline",
        "-level",
        "3.1",
        "-pix_fmt",
        "yuv420p",
        "-vf",
        "scale='trunc(min(iw\\,1280)/2)*2':-2",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        "-y",
        OUTPUT_NAME,
      ],
      -1,
      { signal: opts.signal },
    );
    if (exit !== 0) {
      throw new Error(
        `ffmpeg transcode exited with code ${exit}. Last log: ${lastFfmpegLog || "(no log)"}`,
      );
    }

    emit("optimizing", 1);
    const out = await ff.readFile(OUTPUT_NAME, undefined, { signal: opts.signal });
    emit("finalizing", 1);
    if (typeof out === "string") {
      throw new Error("ffmpeg returned a string instead of binary MP4 output");
    }
    const bytes = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
    if (bytes.byteLength < MIN_OUTPUT_BYTES) {
      throw new Error(`Generated MP4 is too small to be valid (${bytes.byteLength} bytes)`);
    }
    emit("validating", 1);
    const validation = validateMp4Bytes(bytes);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: "video/mp4" });

    // The only meaningful validation is the browser's own decoder: a file that
    // ffmpeg wrote happily is still useless if this browser cannot play it
    // (missing H.264 support, unusual profile). When the self-test fails we
    // re-encode to VP8/WebM, which every browser decodes.
    const decodable = await canDecodeBlob(blob);
    if (decodable) {
      return {
        blob,
        mimeType: "video/mp4",
        durationMs: performance.now() - started,
        validation,
        mode: "encode",
      };
    }

    console.warn("[video-transcoder] MP4 output is not decodable here, falling back to WebM");
    emit("transcoding", 0);
    convStart = performance.now();
    const webmExit = await ff.exec(
      [
        "-hide_banner",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-sn",
        "-dn",
        "-an",
        "-c:v",
        "libvpx",
        "-b:v",
        "1M",
        "-deadline",
        "realtime",
        "-cpu-used",
        "5",
        "-pix_fmt",
        "yuv420p",
        "-vf",
        "scale='trunc(min(iw\\,1280)/2)*2':-2",
        "-f",
        "webm",
        "-y",
        WEBM_OUTPUT_NAME,
      ],
      -1,
      { signal: opts.signal },
    );
    if (webmExit !== 0) {
      throw new Error(
        `This video could not be converted to a format your browser can play. Last log: ${
          lastFfmpegLog || "(no log)"
        }`,
      );
    }
    const webmOut = await ff.readFile(WEBM_OUTPUT_NAME, undefined, { signal: opts.signal });
    if (typeof webmOut === "string") {
      throw new Error("ffmpeg returned a string instead of binary WebM output");
    }
    const webmBytes =
      webmOut instanceof Uint8Array ? webmOut : new Uint8Array(webmOut as ArrayBuffer);
    if (webmBytes.byteLength < MIN_OUTPUT_BYTES) {
      throw new Error(`Generated WebM is too small to be valid (${webmBytes.byteLength} bytes)`);
    }
    const webmCopy = new Uint8Array(webmBytes.byteLength);
    webmCopy.set(webmBytes);
    const webmBlob = new Blob([webmCopy.buffer], { type: "video/webm" });
    if (!(await canDecodeBlob(webmBlob))) {
      throw new Error("The converted video could not be decoded by this browser");
    }
    return {
      blob: webmBlob,
      mimeType: "video/webm",
      durationMs: performance.now() - started,
      validation,
      mode: "webm-fallback",
    };

  } finally {
    ff.off("progress", onProgress);
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    for (const name of [OUTPUT_NAME, WEBM_OUTPUT_NAME]) {
      try {
        await ff.deleteFile(name);
      } catch {
        /* noop */
      }
    }

    if (mounted) {
      try {
        await ff.unmount(INPUT_DIR);
      } catch {
        /* noop */
      }
    }
  }
}

/** Terminate the shared ffmpeg worker and release the wasm heap. */
export async function disposeTranscoder(): Promise<void> {
  if (!ffmpegPromise) return;
  try {
    const ff = await ffmpegPromise;
    ff.terminate();
  } catch {
    /* noop */
  }
  ffmpegPromise = null;
  encoderSupportPromise = null;
}
// Last-resort teardown: a tab close/refresh must not leave the ffmpeg worker
// and its wasm heap alive during bfcache retention.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    void disposeTranscoder();
  });
}
