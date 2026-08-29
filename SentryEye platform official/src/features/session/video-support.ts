// Browser video decode support probing + MediaError decoding.
// Pure functions, no DOM side-effects beyond a throwaway <video>.

export type CanPlay = "probably" | "maybe" | "";

const MIME_BY_EXT: Record<string, string[]> = {
  mp4: ["video/mp4", 'video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'],
  m4v: ["video/mp4"],
  mov: ["video/quicktime", 'video/mp4; codecs="avc1.42E01E"'],
  webm: ["video/webm", 'video/webm; codecs="vp9,opus"', 'video/webm; codecs="vp8,vorbis"'],
  mkv: ["video/x-matroska", "video/webm"],
  avi: ["video/x-msvideo", "video/avi", "video/msvideo"],
  ogv: ["video/ogg"],
};

const READY_STATE_LABELS = [
  "HAVE_NOTHING",
  "HAVE_METADATA",
  "HAVE_CURRENT_DATA",
  "HAVE_FUTURE_DATA",
  "HAVE_ENOUGH_DATA",
] as const;

const NETWORK_STATE_LABELS = [
  "NETWORK_EMPTY",
  "NETWORK_IDLE",
  "NETWORK_LOADING",
  "NETWORK_NO_SOURCE",
] as const;

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Probe all MIME candidates for a file (extension + browser-reported type). */
export function probeSupport(file: File): {
  extension: string;
  browserMime: string;
  best: CanPlay;
  probed: Array<{ mime: string; result: CanPlay }>;
} {
  const el = document.createElement("video");
  const mimes = new Set<string>();
  if (file.type) mimes.add(file.type);
  const extension = extOf(file.name);
  for (const m of MIME_BY_EXT[extension] ?? []) mimes.add(m);
  const probed = Array.from(mimes).map((mime) => ({
    mime,
    result: el.canPlayType(mime) as CanPlay,
  }));
  let best: CanPlay = "";
  for (const p of probed) {
    if (p.result === "probably") best = "probably";
    else if (p.result === "maybe" && best !== "probably") best = "maybe";
  }
  return { extension, browserMime: file.type, best, probed };
}

export function isLikelyAvi(file: File): boolean {
  return extOf(file.name) === "avi" || /msvideo|avi/i.test(file.type);
}

export function decodeMediaError(err: MediaError | null): {
  code: number;
  name: string;
  message: string;
} {
  if (!err) return { code: 0, name: "UNKNOWN", message: "Unknown media error" };
  const names = [
    "UNKNOWN",
    "MEDIA_ERR_ABORTED",
    "MEDIA_ERR_NETWORK",
    "MEDIA_ERR_DECODE",
    "MEDIA_ERR_SRC_NOT_SUPPORTED",
  ];
  return {
    code: err.code,
    name: names[err.code] ?? "UNKNOWN",
    message: err.message || names[err.code] || "Unknown media error",
  };
}

export function mediaSnapshot(
  video: HTMLVideoElement,
  file: File | null,
  objectUrl: string | null,
) {
  const mediaError = decodeMediaError(video.error);
  const support = file ? probeSupport(file) : null;
  return {
    filename: file?.name ?? null,
    extension: file ? extOf(file.name) : null,
    mimeType: file?.type || null,
    sizeBytes: file?.size ?? null,
    objectUrl,
    canPlayType: support?.probed ?? [],
    bestCanPlayType: support?.best ?? "",
    currentSrc: video.currentSrc,
    networkState: video.networkState,
    networkStateLabel: NETWORK_STATE_LABELS[video.networkState] ?? "UNKNOWN",
    readyState: video.readyState,
    readyStateLabel: READY_STATE_LABELS[video.readyState] ?? "UNKNOWN",
    mediaErrorCode: mediaError.code,
    mediaErrorName: mediaError.name,
    mediaErrorMessage: mediaError.message,
    duration: Number.isFinite(video.duration) ? video.duration : null,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
  };
}

export function describeMediaLoadFailure(
  video: HTMLVideoElement,
  file: File | null,
  objectUrl: string | null,
): string {
  const snapshot = mediaSnapshot(video, file, objectUrl);
  const browserReason = `${snapshot.mediaErrorName} (${snapshot.mediaErrorCode}): ${snapshot.mediaErrorMessage}`;
  const source = snapshot.currentSrc || objectUrl || "no source assigned";
  const support = snapshot.canPlayType
    .map((p) => `${p.mime}=${p.result || "unsupported"}`)
    .join(", ") || "no MIME candidates";

  const codecHint =
    snapshot.mediaErrorName === "MEDIA_ERR_SRC_NOT_SUPPORTED"
      ? " The browser reported that this container or codec is not supported. Try a browser-decodable MP4 (H.264/AAC) or WebM (VP9/Opus)."
      : "";

  return [
    `Video load failed: ${browserReason}.${codecHint}`,
    `File: ${snapshot.filename ?? "unknown"} (${snapshot.mimeType || "no MIME type"}, ${snapshot.sizeBytes ?? 0} bytes, .${snapshot.extension || "unknown"}).`,
    `Browser canPlayType: ${support}.`,
    `Source: ${source}.`,
    `Media state: readyState=${snapshot.readyState} ${snapshot.readyStateLabel}, networkState=${snapshot.networkState} ${snapshot.networkStateLabel}.`,
  ].join("\n");
}
