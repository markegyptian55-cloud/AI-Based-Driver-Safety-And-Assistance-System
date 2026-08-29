"""
Video decode and browser-safe H.264 encode, via PyAV.

WHY PyAV AND NOT cv2.VideoCapture / cv2.VideoWriter
===================================================
Decode: the requirement is "supports all video formats". `cv2.VideoCapture`
depends on whichever FFmpeg/codec set the installed OpenCV wheel happened to
build against, and there are four competing OpenCV distributions installed in
the source environment. `av.open()` carries its own FFmpeg and reads
avi/mkv/mov/webm/wmv/flv/mp4/mpg reliably.

Encode: the parent project's `demo_video.py` writes with the `mp4v` fourcc
(MPEG-4 Part 2). That is the reason its output videos show a black player in
Chrome -- browsers do not decode it. Here we encode H.264 via libx264 with
`yuv420p` and `+faststart`, both of which are required: without yuv420p Safari
and some Chrome builds refuse the file, and without faststart the moov atom
lands at the end so the video won't start until fully downloaded.

Timestamps: `iter_frames` yields true presentation timestamps, not
frame_index/fps. Micro-event durations depend on this, and it is the only
correct answer for variable-frame-rate sources (most phone video).

Rotation: PyAV does NOT auto-apply the rotation side-data that cv2 silently
applies. Portrait phone clips would render sideways and every detection would
look wrong. Handled explicitly below.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Iterator

import av
import numpy as np

DEFAULT_FPS = 30.0


@dataclass(frozen=True)
class VideoInfo:
    width: int
    height: int
    fps: float
    duration_s: float
    n_frames_est: int
    codec: str
    container: str
    rotation: int
    has_audio: bool

    @property
    def resolution_label(self) -> str:
        return f"{self.width}x{self.height}"


def _rotation_of(stream) -> int:
    """Rotation in degrees (0/90/180/270), from container or stream metadata."""
    try:
        rot = stream.metadata.get("rotate")
        if rot is not None:
            return int(rot) % 360
    except Exception:
        pass
    # PyAV >= 10 exposes display-matrix side data on some builds
    try:
        for sd in getattr(stream, "side_data", None) or []:
            if getattr(sd, "type", None) and "DISPLAYMATRIX" in str(sd.type):
                return int(round(float(getattr(sd, "rotation", 0)))) % 360
    except Exception:
        pass
    return 0


def _apply_rotation(img: np.ndarray, rotation: int) -> np.ndarray:
    if rotation == 90:
        return np.ascontiguousarray(np.rot90(img, k=-1))
    if rotation == 180:
        return np.ascontiguousarray(np.rot90(img, k=2))
    if rotation == 270:
        return np.ascontiguousarray(np.rot90(img, k=1))
    return img


def probe(path: str | Path) -> VideoInfo:
    """Read stream metadata without decoding the whole file."""
    path = Path(path)
    with av.open(str(path)) as container:
        if not container.streams.video:
            raise ValueError(f"No video stream in {path.name}")
        vs = container.streams.video[0]

        rate = vs.average_rate or vs.guessed_rate
        fps = float(rate) if rate and float(rate) > 0 else DEFAULT_FPS

        duration_s = 0.0
        if vs.duration is not None and vs.time_base:
            duration_s = float(vs.duration * vs.time_base)
        elif container.duration:
            duration_s = float(container.duration / av.time_base)

        n_frames = vs.frames or 0
        if not n_frames and duration_s:
            n_frames = int(round(duration_s * fps))

        rotation = _rotation_of(vs)
        w, h = int(vs.codec_context.width), int(vs.codec_context.height)
        if rotation in (90, 270):
            w, h = h, w

        return VideoInfo(
            width=w,
            height=h,
            fps=fps,
            duration_s=duration_s,
            n_frames_est=int(n_frames),
            codec=vs.codec_context.name or "unknown",
            container=(container.format.name or "unknown").split(",")[0],
            rotation=rotation,
            has_audio=bool(container.streams.audio),
        )


def iter_frames(
    path: str | Path,
    max_seconds: float | None = None,
) -> Iterator[tuple[np.ndarray, float]]:
    """Yield (bgr_frame, presentation_timestamp_seconds).

    `max_seconds` stops decoding once video time passes that mark -- this is
    what backs the UI's "first N seconds only" limit, and it stops the *decode*
    rather than filtering afterwards, so it actually saves the time.
    """
    path = Path(path)
    with av.open(str(path)) as container:
        vs = container.streams.video[0]
        vs.thread_type = "AUTO"          # multithreaded decode, meaningful speedup
        rotation = _rotation_of(vs)
        time_base = vs.time_base or Fraction(1, 1000)

        for i, frame in enumerate(container.decode(video=0)):
            if frame.pts is None:
                rate = float(vs.average_rate) if (vs.average_rate and float(vs.average_rate) > 0) else DEFAULT_FPS
                t = i / rate
            else:
                t = float(frame.pts * time_base)

            if max_seconds is not None and t > max_seconds:
                return

            img = frame.to_ndarray(format="bgr24")
            if rotation:
                img = _apply_rotation(img, rotation)
            yield img, t


def nvenc_available() -> bool:
    try:
        return "h264_nvenc" in av.codecs_available
    except Exception:
        return False


class H264Writer:
    """Browser-safe H.264 mp4 writer. Context manager.

    Dimensions are forced even -- H.264 4:2:0 chroma subsampling requires it,
    and an odd-sized source (some webcams, some crops) otherwise fails at
    encoder open with an unhelpful error.
    """

    def __init__(
        self,
        path: str | Path,
        width: int,
        height: int,
        fps: float,
        crf: int = 20,
        preset: str = "veryfast",
        use_nvenc: bool = False,
    ) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.width = width - (width % 2)
        self.height = height - (height % 2)
        self.fps = fps if fps and fps > 0 else DEFAULT_FPS

        codec = "h264_nvenc" if (use_nvenc and nvenc_available()) else "libx264"

        self._container = av.open(str(self.path), mode="w", format="mp4")
        self._stream = self._container.add_stream(codec, rate=Fraction(self.fps).limit_denominator(1000))
        self._stream.width = self.width
        self._stream.height = self.height
        self._stream.pix_fmt = "yuv420p"

        if codec == "libx264":
            self._stream.options = {
                "crf": str(crf),
                "preset": preset,
                "movflags": "+faststart",
            }
        else:
            self._stream.options = {
                "preset": "p4",
                "rc": "vbr",
                "cq": str(crf),
                "movflags": "+faststart",
            }
        self._closed = False
        self._frame_idx = 0

    def write(self, bgr: np.ndarray) -> None:
        if self._closed:
            raise RuntimeError("writer already closed")
        if bgr.shape[0] != self.height or bgr.shape[1] != self.width:
            import cv2
            bgr = cv2.resize(bgr, (self.width, self.height), interpolation=cv2.INTER_AREA)
        frame = av.VideoFrame.from_ndarray(np.ascontiguousarray(bgr), format="bgr24")
        frame.pts = self._frame_idx
        self._frame_idx += 1
        for packet in self._stream.encode(frame):
            self._container.mux(packet)

    def close(self) -> None:
        if self._closed:
            return
        try:
            for packet in self._stream.encode():   # flush
                self._container.mux(packet)
        finally:
            self._container.close()
            self._closed = True

    def __enter__(self) -> "H264Writer":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
