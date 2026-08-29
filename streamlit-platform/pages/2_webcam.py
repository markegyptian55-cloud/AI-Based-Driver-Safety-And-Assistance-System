"""
Live Camera page.

BOUNDED-BATCH FRAGMENT LOOP
============================
A bare `while True: cap.read()` would block the script runner forever and the
Stop button would never be processed -- Streamlit only handles new widget
interactions between script runs, not during one. Instead an `@st.fragment`
reads ~24 frames (~0.8s at typical webcam fps), repaints, then calls
`st.rerun(scope="fragment")`. `scope="fragment"` means only this fragment
re-executes, not the whole page (sidebar/model stay put, no reload).

CAMERA_SESSION LIVES IN session_state, NEVER cache_resource -- a VideoCapture
handle is per-process in cache_resource, so two browser tabs would fight over
the same physical camera and deadlock. Each browser session opens its own.
"""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import importlib
import time
import cv2

import core.webcam
import core.adas_render
import ui.report
importlib.reload(core.webcam)
importlib.reload(core.adas_render)
importlib.reload(ui.report)

from core.detect import load_model
from core.webcam import CameraSession, list_cameras, step
from ui.components import alert_banner, metric_row, section_header
from ui.i18n import t
from ui.report import get_live_driver_hud_html
from ui.theme import get_theme

BATCH_FRAMES = 6

theme = st.session_state.get("_theme_obj") or get_theme()
entries = st.session_state.get("_model_entries", {})
model_key = st.session_state.get("model_key")
entry = entries.get(model_key) if model_key else None

section_header(t("cam.title"), eyebrow="ADAS")

if entry is None:
    st.info(t("video.no_file"))
    st.stop()

if "_cam_indices" not in st.session_state:
    with st.spinner(t("cam.starting")):
        st.session_state["_cam_indices"] = list_cameras()

cam_indices = st.session_state["_cam_indices"]
if not cam_indices:
    st.warning(t("cam.none"))
    if st.button("↻", help="Rescan"):
        del st.session_state["_cam_indices"]
        st.rerun()
    st.stop()

ctrl_col, cam_col = st.columns([1, 3])
with ctrl_col:
    cam_index = st.selectbox(t("cam.select"), cam_indices, key="cam_index")
    running = st.session_state.get("cam_running", False)
    if not running:
        if st.button(t("cam.start"), type="primary", width='stretch'):
            model = load_model(entry.checkpoint, family=entry.family, resolution=entry.resolution,
                                rfdetr_class=entry.rfdetr_class,
                                half=bool(st.session_state.get("use_half", False)))
            try:
                st.session_state["cam_session"] = CameraSession(
                    cam_index,
                    window_size=st.session_state["window_size"],
                    warning_threshold=st.session_state["warning_threshold"],
                    critical_threshold=st.session_state["critical_threshold"],
                    critical_hold_seconds=st.session_state["critical_hold"],
                )
                st.session_state["cam_running"] = True
                st.rerun()
            except RuntimeError as exc:
                st.error(str(exc))
    else:
        c_stop, c_rst = st.columns(2)
        with c_stop:
            if st.button(f"🛑 {t('cam.stop')}", width='stretch', key="btn_stop_cam"):
                sess: CameraSession | None = st.session_state.get("cam_session")
                if sess is not None:
                    sess.release()
                st.session_state["cam_running"] = False
                st.session_state.pop("cam_session", None)
                st.rerun()
        with c_rst:
            if st.button(f"🔄 {t('video.restart')}", width='stretch', key="btn_restart_cam"):
                sess = st.session_state.get("cam_session")
                if sess is not None:
                    sess.release()
                st.session_state.pop("cam_session", None)
                st.session_state["cam_running"] = False
                st.session_state.pop("_cam_indices", None)
                st.rerun()

        last_frame = st.session_state.get("_cam_last_frame")
        if last_frame is not None:
            _, buf = cv2.imencode(".png", last_frame)
            st.download_button(
                f"📸 {t('cam.snapshot')}",
                buf.tobytes(),
                file_name=f"snapshot_{int(time.time())}.png",
                mime="image/png",
                width='stretch',
                key="btn_cam_snapshot",
            )

img_ph = cam_col.empty()
tiles_ph = st.empty()
alert_ph = st.empty()
recent_ph = st.empty()

if not st.session_state.get("cam_running"):
    st.info(t("cam.idle"))
    st.stop()


@st.fragment
def _camera_fragment():
    sess: CameraSession | None = st.session_state.get("cam_session")
    if sess is None or sess.released:
        return

    model = load_model(entry.checkpoint, family=entry.family, resolution=entry.resolution,
                        rfdetr_class=entry.rfdetr_class,
                        half=bool(st.session_state.get("use_half", False)))
    result = None
    for _ in range(BATCH_FRAMES):
        if not st.session_state.get("cam_running"):
            break
        result = step(
            sess, model,
            model_name=entry.display_name,
            conf=st.session_state["conf"],
            imgsz=entry.resolution,
            hud_pos=st.session_state.get("hud_pos", "top-right"),
            family=entry.family,
            half=bool(st.session_state.get("use_half", False)),
        )
        if result is None:
            st.session_state["cam_running"] = False
            sess.release()
            st.error(t("cam.none"))
            return
        
        st.session_state["_cam_last_frame"] = result.bgr
        img_ph.image(result.bgr, channels="BGR", width='stretch')
        with tiles_ph.container():
            st.markdown(
                get_live_driver_hud_html(
                    result.fatigue_score,
                    result.alert_level,
                    0.0,
                    1.0,
                    sess.frame_idx,
                    event_counts=sess.detector.counts(),
                    recent_events=sess.recent_events,
                ),
                unsafe_allow_html=True,
            )
        with alert_ph.container():
            alert_banner(result.alert_level)

        if result.alert_level in ("WARNING", "CRITICAL"):
            if result.escalated:
                if result.alert_level == "CRITICAL":
                    st.toast("🚨 CRITICAL DROWSINESS ALERT! Micro-sleep detected — Pull over!", icon="🚨")
                elif result.alert_level == "WARNING":
                    st.toast("⚠️ Warning: Elevated driver fatigue detected.", icon="⚠️")

            # Gated on `escalated` -- the analyser's own edge flag, set only
            # when the level rose against the previous frame -- for the same
            # reason as the video page: emitting per frame re-sent the cue's
            # base64 data URI (40.3 KB for the critical cue) on every frame
            # for as long as the alert held, and stacked one <audio autoplay>
            # element per frame. On a live feed that has no natural end, so
            # it grows until the tab or the connection gives out.
            if result.escalated and st.session_state.get("sound_enabled", True):
                from core.audio import cue_data_uri, cue_for_level
                cue = cue_for_level(result.alert_level)
                if cue:
                    st.markdown(f'<audio autoplay style="display:none" src="{cue_data_uri(cue)}"></audio>', unsafe_allow_html=True)

        if sess.recent_events:
            with recent_ph.container():
                st.caption(t("cam.recent"))
                for ev in sess.recent_events[:6]:
                    st.markdown(f"- **{t(f'event.{ev.kind}')}** — {ev.duration:.2f}s")

    if st.session_state.get("cam_running"):
        # First call happens inside the full script run triggered by the
        # Start button, where scope="fragment" is disallowed -- see the
        # matching comment/fix in pages/1_video.py::_run_fragment.
        try:
            st.rerun(scope="fragment")
        except st.errors.StreamlitAPIException:
            st.rerun()


_camera_fragment()
