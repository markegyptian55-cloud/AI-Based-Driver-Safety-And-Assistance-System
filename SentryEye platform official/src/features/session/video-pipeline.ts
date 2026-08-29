// Which path an uploaded clip takes to reach the model.
//
// ffmpeg.wasm is a pure-software FFmpeg build: it cannot touch the GPU and runs
// one to two orders of magnitude slower than a native decode. Sending a file
// the browser can already play through it is the single biggest avoidable delay
// on the Video Detection page. So we decide once, up front, and say which path
// we took.
//
//   native   -> the browser decodes the file as-is; no conversion at all
//   remux    -> the video codec is decodable, only the container isn't; copy
//               the stream into MP4 (no re-encode, seconds instead of minutes)
//   ffmpeg   -> last resort: a real re-encode
//
// Pure-ish: touches a throwaway <video> and the WebCodecs/MediaCapabilities
// probes, never the DOM tree.

import { extOf, probeSupport } from "./video-support";

export type VideoPathId = "native" | "remux" | "ffmpeg";

export interface VideoPathDecision {
  path: VideoPathId;
  /** Short human sentence for the pipeline panel. */
  reason: string;
  /** What canPlayType said about the best MIME candidate. */
  canPlay: string;
  /** Codec string WebCodecs accepted, when it did. */
  webCodec: string | null;
}

/** Codec guesses per container, used only to ask WebCodecs a yes/no question. */
const CODEC_CANDIDATES: Record<string, string[]> = {
  mkv: ["avc1.42E01E", "avc1.640028", "vp09.00.10.08", "vp8"],
  avi: ["avc1.42E01E"],
  mov: ["avc1.42E01E", "avc1.640028"],
  mp4: ["avc1.42E01E", "avc1.640028", "hvc1.1.6.L93.B0"],
  webm: ["vp8", "vp09.00.10.08"],
  ts: ["avc1.42E01E"],
};

async function webCodecsSupports(ext: string): Promise<string | null> {
  const VD = (globalThis as { VideoDecoder?: typeof VideoDecoder }).VideoDecoder;
  if (!VD?.isConfigSupported) return null;
  for (const codec of CODEC_CANDIDATES[ext] ?? []) {
    try {
      const res = await VD.isConfigSupported({ codec });
      if (res.supported) return codec;
    } catch {
      /* unsupported codec strings throw — keep probing */
    }
  }
  return null;
}

async function mediaCapabilitiesSaysYes(mime: string): Promise<boolean> {
  const mc = (navigator as Navigator & { mediaCapabilities?: MediaCapabilities }).mediaCapabilities;
  if (!mc?.decodingInfo || !mime) return false;
  try {
    const info = await mc.decodingInfo({ type: "file", video: { contentType: mime, width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 } });
    return !!info.supported;
  } catch {
    return false;
  }
}

/**
 * Decide before any ffmpeg module is loaded. A `probably`/`maybe` from
 * canPlayType, or a positive MediaCapabilities answer, means we feed the file
 * straight to <video> and skip conversion entirely.
 */
export async function decideVideoPath(file: File): Promise<VideoPathDecision> {
  const support = probeSupport(file);
  const ext = extOf(file.name);

  if (support.best === "probably") {
    return {
      path: "native",
      reason: "Your browser decodes this file natively — conversion skipped.",
      canPlay: support.best,
      webCodec: null,
    };
  }

  const best = support.probed.find((p) => p.result)?.mime ?? file.type;
  if (support.best === "maybe" && (await mediaCapabilitiesSaysYes(best))) {
    return {
      path: "native",
      reason: "Hardware decode confirmed for this codec — conversion skipped.",
      canPlay: support.best,
      webCodec: null,
    };
  }

  const codec = await webCodecsSupports(ext);
  if (codec) {
    return {
      path: "remux",
      reason: `Container is unsupported but ${codec} decodes here — repackaging without re-encoding.`,
      canPlay: support.best || "unsupported",
      webCodec: codec,
    };
  }

  return {
    path: "ffmpeg",
    reason: "Neither the container nor the codec is supported — full conversion required.",
    canPlay: support.best || "unsupported",
    webCodec: null,
  };
}

export const VIDEO_PATH_LABEL: Record<VideoPathId, string> = {
  native: "native decode",
  remux: "stream copy",
  ffmpeg: "ffmpeg fallback",
};
