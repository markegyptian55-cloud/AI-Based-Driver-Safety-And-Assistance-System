"""
app.py
------
Streamlit dashboard for the Driver Drowsiness Detector (Faster R-CNN from scratch).

Runs the trained model on an uploaded image, a camera snapshot, or a video file,
and shows the detected cues (open_eye / closed_eye / yawn) plus the driver state.

Designed to run on Streamlit Community Cloud (CPU-only, no local webcam):
    streamlit run app.py

Requires: the model weights at checkpoints/tuned/best.pth (or checkpoints/best.pth),
plus config.py, models/, utils/, inference.py.
"""

import os
import tempfile

import cv2
import numpy as np
import torch
import streamlit as st

import config
from inference import load_model, detect_image
from utils.visualization import draw_detections
from utils.driver_state import DriverStateMonitor

# real-time webcam (browser camera -> server) via WebRTC; optional dependency
try:
    from streamlit_webrtc import webrtc_streamer, VideoProcessorBase, RTCConfiguration
    import av
    WEBRTC_OK = True
except ImportError:
    WEBRTC_OK = False

# ----------------------------------------------------------------------------
st.set_page_config(page_title="Driver Drowsiness Detection", page_icon="🚗", layout="wide")

STATE_COLORS = {
    "NORMAL": "#2E7D32",
    "YAWNING": "#F9A825",
    "DROWSY / SLEEPING": "#C62828",
}

# candidate checkpoints, best first
CKPT_CANDIDATES = ["checkpoints/tuned/best.pth", "checkpoints/best.pth"]


@st.cache_resource(show_spinner="Loading model…")
def get_model(checkpoint):
    """Load the model once and cache it across reruns."""
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    model = load_model(checkpoint, device)
    return model, device


def frame_status(labels):
    """Single-frame interpretation (no temporal smoothing)."""
    labels = [int(l) for l in labels]
    n_open = labels.count(1)
    n_closed = labels.count(2)
    n_yawn = labels.count(3)
    if n_yawn > 0:
        return "YAWNING", STATE_COLORS["YAWNING"]
    if n_closed > 0 and n_closed > n_open:
        return "EYES CLOSED", STATE_COLORS["DROWSY / SLEEPING"]
    return "EYES OPEN / NORMAL", STATE_COLORS["NORMAL"]


def run_on_bgr(model, device, img_bgr, score):
    """Detect on a BGR image, return (annotated_rgb, boxes, labels, scores)."""
    boxes, labels, scores = detect_image(model, img_bgr, device, score)
    annotated = img_bgr.copy()
    draw_detections(annotated, boxes, labels, scores)
    annotated_rgb = cv2.cvtColor(annotated, cv2.COLOR_BGR2RGB)
    return annotated_rgb, boxes, labels, scores


def show_detection_table(labels, scores):
    if len(labels) == 0:
        st.info("No objects detected. Try lowering the score threshold in the sidebar.")
        return
    rows = [{"class": config.MODEL_LABELS[int(l)], "confidence": f"{s*100:.1f}%"}
            for l, s in zip(labels, scores)]
    st.dataframe(rows, use_container_width=True, hide_index=True)


# ----------------------------------------------------------------------------
# Sidebar
# ----------------------------------------------------------------------------
st.sidebar.title("⚙️ Settings")

available = [c for c in CKPT_CANDIDATES if os.path.exists(c)]
if not available:
    st.error("No model checkpoint found. Expected checkpoints/tuned/best.pth "
             "or checkpoints/best.pth in the repository.")
    st.stop()

checkpoint = st.sidebar.selectbox("Model checkpoint", available)
score = st.sidebar.slider("Score threshold", 0.05, 0.95, float(config.SCORE_THRESH), 0.05)
st.sidebar.caption("Lower = more (noisier) detections · Higher = fewer, more confident")

try:
    model, device = get_model(checkpoint)
except Exception as e:
    st.error(f"Could not load the model from {checkpoint}.\n\n"
             f"If this is the 9-anchor baseline, the current config uses 16 anchors — "
             f"use checkpoints/tuned/best.pth instead.\n\nError: {e}")
    st.stop()

st.sidebar.success(f"Model loaded on **{device.type.upper()}**")
st.sidebar.caption(f"Classes: {', '.join(config.CLASS_NAMES)}")

# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
st.title("🚗 Driver Drowsiness Detection")
st.caption("Faster R-CNN (built from scratch) — detects open/closed eyes and yawning.")

tab_live, tab_img, tab_cam, tab_vid = st.tabs(
    ["🎥 Live (real-time)", "🖼️ Image", "📸 Camera", "🎬 Video"])

# ---- Live real-time webcam ----
with tab_live:
    st.caption("Real-time detection from your browser webcam. Click START and allow "
               "camera access. Runs frame-by-frame through the model.")
    if not WEBRTC_OK:
        st.error("Real-time mode needs extra packages. Install them with:\n\n"
                 "`pip install streamlit-webrtc av`")
    else:
        RTC_CONFIG = RTCConfiguration(
            {"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]})

        class LiveProcessor(VideoProcessorBase):
            def __init__(self):
                self.monitor = DriverStateMonitor()
                self.score = float(config.SCORE_THRESH)

            def recv(self, frame):
                img = frame.to_ndarray(format="bgr24")
                boxes, labels, scores = detect_image(model, img, device, self.score)
                state = self.monitor.update(labels)
                draw_detections(img, boxes, labels, scores)
                col = ((0, 0, 255) if "DROWSY" in state
                       else (0, 180, 255) if state == "YAWNING" else (0, 200, 0))
                cv2.putText(img, state, (10, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.9, col, 2)
                return av.VideoFrame.from_ndarray(img, format="bgr24")

        ctx = webrtc_streamer(
            key="live",
            video_processor_factory=LiveProcessor,
            rtc_configuration=RTC_CONFIG,
            media_stream_constraints={"video": True, "audio": False},
            async_processing=True,
        )
        # keep the processor's threshold in sync with the sidebar slider
        if ctx.video_processor:
            ctx.video_processor.score = score
        st.caption("Tip: on the free cloud tier this runs on CPU, so the live feed "
                   "will be a few FPS. It is much smoother locally on a GPU.")

# ---- Image ----
with tab_img:
    up = st.file_uploader("Upload an image", type=["jpg", "jpeg", "png"], key="img")
    if up is not None:
        data = np.frombuffer(up.getvalue(), np.uint8)
        img_bgr = cv2.imdecode(data, cv2.IMREAD_COLOR)
        annotated_rgb, boxes, labels, scores = run_on_bgr(model, device, img_bgr, score)
        status, color = frame_status(labels)
        c1, c2 = st.columns([3, 1])
        with c1:
            st.image(annotated_rgb, use_container_width=True)
        with c2:
            st.markdown(f"### Status")
            st.markdown(f"<h2 style='color:{color}'>{status}</h2>", unsafe_allow_html=True)
            show_detection_table(labels, scores)

# ---- Camera ----
with tab_cam:
    snap = st.camera_input("Take a photo")
    if snap is not None:
        data = np.frombuffer(snap.getvalue(), np.uint8)
        img_bgr = cv2.imdecode(data, cv2.IMREAD_COLOR)
        annotated_rgb, boxes, labels, scores = run_on_bgr(model, device, img_bgr, score)
        status, color = frame_status(labels)
        st.markdown(f"<h2 style='color:{color}'>{status}</h2>", unsafe_allow_html=True)
        st.image(annotated_rgb, use_container_width=True)
        show_detection_table(labels, scores)

# ---- Video (real-time playback of an uploaded clip) ----
with tab_vid:
    st.caption("Upload a clip and watch detection play back in real time, frame by frame. "
               "On the free cloud tier (CPU) playback is a few FPS.")
    vup = st.file_uploader("Upload a video", type=["mp4", "avi", "mov"], key="vid")
    stride = st.slider("Process every Nth frame", 1, 10, 2,
                       help="Higher = faster playback but skips more frames")
    if vup is not None and st.button("▶ Play with detection"):
        tfile = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        tfile.write(vup.getvalue())
        tfile.close()

        cap = cv2.VideoCapture(tfile.name)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        monitor = DriverStateMonitor()

        state_ph = st.empty()      # live status line (updates every frame)
        video_ph = st.empty()      # live video frame
        prog = st.progress(0.0)
        states = []
        idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            idx += 1
            if idx % stride != 0:
                continue
            boxes, labels, scores = detect_image(model, frame, device, score)
            state = monitor.update(labels)
            states.append(state)
            draw_detections(frame, boxes, labels, scores)

            # push this annotated frame to the UI -> looks like live playback
            color = STATE_COLORS.get(state, "#888888")
            state_ph.markdown(f"<h3 style='color:{color};margin:0'>State: {state}</h3>",
                              unsafe_allow_html=True)
            video_ph.image(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB),
                           channels="RGB", use_container_width=True)
            if total:
                prog.progress(min(idx / total, 1.0))
        cap.release()
        os.unlink(tfile.name)
        prog.empty()

        if states:
            n_drowsy = sum("DROWSY" in s for s in states)
            n_yawn = sum(s == "YAWNING" for s in states)
            c1, c2, c3 = st.columns(3)
            c1.metric("Frames analyzed", len(states))
            c2.metric("Drowsy frames", n_drowsy)
            c3.metric("Yawning frames", n_yawn)
        else:
            st.warning("Could not read frames from this video.")

st.markdown("---")
st.caption("⚠️ Educational project — not a substitute for a real driver-monitoring system.")
