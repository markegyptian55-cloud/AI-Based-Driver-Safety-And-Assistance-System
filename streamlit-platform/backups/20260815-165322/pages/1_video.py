"""Video Analysis page: upload -> probe -> run -> results."""

from __future__ import annotations

import json
import sys
import time
import uuid
from pathlib import Path

import importlib
import pandas as pd
import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import core.pipeline
import core.adas_render
import core.detect
import ui.report
import ui.player
importlib.reload(core.pipeline)
importlib.reload(core.adas_render)
importlib.reload(core.detect)
importlib.reload(ui.report)
importlib.reload(ui.player)

from core.pipeline import Progress, Result, process_video
from core.registry import ModelEntry
from core.video_io import VideoInfo, probe
from ui import charts
from ui.components import (alert_banner, class_legend, fmt_pct, fmt_seconds,
                            metric_row, panel_end, panel_start, section_header)
from ui.i18n import t
from ui.player import render_player
from ui.report import (calculate_driver_score, generate_html_report,
                       get_live_driver_hud_html, render_driver_scorecard_ui)
from ui.theme import get_theme

STATIC_OUT = ROOT / "static" / "out"
RUNTIME_UPLOADS = ROOT / "runtime" / "uploads"
STATIC_OUT.mkdir(parents=True, exist_ok=True)
RUNTIME_UPLOADS.mkdir(parents=True, exist_ok=True)

theme = st.session_state.get("_theme_obj") or get_theme()
entries: dict[str, ModelEntry] = st.session_state.get("_model_entries", {})

section_header(t("video.title"), eyebrow="ADAS")

model_key = st.session_state.get("model_key")
entry = entries.get(model_key) if model_key else None

if entry is None:
    st.info(t("video.no_file"))
    st.stop()

# ---------------------------------------------------------------- input

up_col, path_col = st.columns([1.3, 1])
with up_col:
    uploaded = st.file_uploader(
        t("video.upload"), type=None, help=t("video.upload.help"),
        key="video_upload",
    )
with path_col:
    st.markdown(f'<span class="nb-eyebrow">{t("video.or_path")}</span>', unsafe_allow_html=True)
    local_path = st.text_input("local_path", placeholder=t("video.path_ph"),
                                label_visibility="collapsed", key="video_local_path")

source_path: Path | None = None
if uploaded is not None:
    # Deterministic per-upload identity, not a fresh uuid4() every script run.
    # `uploaded` is the SAME UploadedFile object across reruns as long as the
    # user hasn't re-picked a file -- Streamlit gives it a stable `file_id`.
    # Randomizing the destination name on every rerun (the old code) made
    # `result_key` below change on any full rerun -- including ones caused by
    # unrelated sidebar widgets (theme/language/model) firing while a video
    # was still processing -- which orphaned the `_video_run_id::...` key set
    # at click time and crashed with a KeyError two reruns later.
    upload_id = getattr(uploaded, "file_id", None) or f"{uploaded.name}_{uploaded.size}"
    dest = RUNTIME_UPLOADS / f"{upload_id}_{uploaded.name}"
    if not dest.exists():
        dest.write_bytes(uploaded.getbuffer())
    source_path = dest
elif local_path.strip():
    p = Path(local_path.strip().strip('"'))
    if p.exists() and p.is_file():
        source_path = p
    else:
        st.error(f"{local_path} — file not found")

if source_path is None:
    st.info(t("video.no_file"))
    st.stop()

# ---------------------------------------------------------------- probe

try:
    info: VideoInfo = probe(source_path)
except Exception as exc:
    st.error(f"{t('video.upload')}: {exc}")
    st.stop()

c = st.columns(5)
c[0].markdown(f"**{t('video.resolution')}**  \n<span class='nb-ltr'>{info.resolution_label}</span>",
              unsafe_allow_html=True)
c[1].markdown(f"**{t('video.duration')}**  \n<span class='nb-ltr'>{fmt_seconds(info.duration_s)}</span>",
              unsafe_allow_html=True)
c[2].markdown(f"**{t('video.fps')}**  \n<span class='nb-ltr'>{info.fps:.1f}</span>", unsafe_allow_html=True)
c[3].markdown(f"**{t('video.codec')}**  \n<span class='nb-ltr'>{info.codec}</span>", unsafe_allow_html=True)
c[4].markdown(f"**{t('video.frames')}**  \n<span class='nb-ltr'>{info.n_frames_est}</span>", unsafe_allow_html=True)

st.write("")
cfg_col1, cfg_col2 = st.columns([1.5, 1.5])
with cfg_col1:
    upper_limit = max(10, int(min(info.duration_s or 300, 300)))
    default_val = min(60, max(5, int(info.duration_s or 60)))
    max_seconds = st.slider(
        t("video.limit"), 5, upper_limit,
        value=default_val, step=5, help=t("video.limit.help"),
    )
with cfg_col2:
    player_size = st.segmented_control(
        t("video.size"),
        options=["small", "medium", "large"],
        format_func=lambda k: t(f"video.size.{k}"),
        default=st.session_state.get("video_player_size", "medium"),
        key="video_player_size_ctrl",
    )
    if player_size:
        st.session_state["video_player_size"] = player_size

result_key = f"video_result::{source_path.name}::{model_key}::{max_seconds}"

action_col1, action_col2 = st.columns([2, 1])
with action_col1:
    run_clicked = st.button(f"🚀 {t('video.run')}", type="primary", width='stretch', key="btn_run_video")
with action_col2:
    if st.button(f"🔄 {t('video.restart')}", width='stretch', key="btn_restart_video"):
        st.session_state.pop(result_key, None)
        st.session_state["_video_running"] = False
        st.rerun()

# ---------------------------------------------------------------- run

if run_clicked:
    st.session_state["_cancel_video"] = False
    from core.detect import get_cached_yolo_model

    model = get_cached_yolo_model(entry.checkpoint)
    run_id = uuid.uuid4().hex[:10]
    out_annotated = STATIC_OUT / f"{run_id}_annotated.mp4"
    out_raw = STATIC_OUT / f"{run_id}_raw.mp4"

    curr_size = st.session_state.get("video_player_size", "medium")
    if curr_size == "small":
        col_ratio = [1.3, 1.2]
    elif curr_size == "large":
        col_ratio = [2.4, 1.1]
    else:
        col_ratio = [1.8, 1.2]

    prog_box = st.container()
    with prog_box:
        c_prev, c_tiles = st.columns(col_ratio)
        with c_prev:
            preview = st.empty()
            progress_bar = st.progress(0.0)
            stop_col, _ = st.columns([1, 2])
            with stop_col:
                if st.button(f"🛑 {t('video.stop')}", key=f"stop_{run_id}", width='stretch'):
                    st.session_state["_cancel_video"] = True
        with c_tiles:
            live_tiles = st.empty()

    gen = process_video(
        source_path, model,
        model_name=entry.display_name,
        imgsz=entry.resolution,
        out_annotated=out_annotated,
        out_raw=out_raw,
        conf=st.session_state.get("conf", 0.35),
        max_seconds=float(max_seconds),
        window_size=st.session_state.get("window_size", 30),
        warning_threshold=st.session_state.get("warning_threshold", 0.40),
        critical_threshold=st.session_state.get("critical_threshold", 0.65),
        critical_hold_seconds=st.session_state.get("critical_hold", 1.5),
        hud_pos=st.session_state.get("hud_pos", "top-right"),
        preview_every=2,
        should_cancel=lambda: st.session_state.get("_cancel_video", False),
    )

    started = time.perf_counter()
    last_preview_t = 0.0
    final_res = None
    toasted_crit = False
    alarm_ph = st.empty()

    for item in gen:
        if isinstance(item, Progress):
            now_t = time.perf_counter()
            progress_bar.progress(item.pct)

            # Smooth preview pacing (~20 FPS target over websocket to prevent UI stutter/lag)
            if item.preview_bgr is not None and (now_t - last_preview_t >= 0.045):
                last_preview_t = now_t
                preview.image(item.preview_bgr, channels="BGR", width='stretch')
                elapsed = now_t - started
                remaining = (elapsed / max(item.pct, 1e-6)) * (1.0 - item.pct)
                with live_tiles.container():
                    st.markdown(
                        get_live_driver_hud_html(
                            item.fatigue_score,
                            item.alert_level,
                            remaining,
                            item.pct,
                            item.frame_idx,
                            event_counts=item.event_counts,
                            recent_events=item.all_events,
                        ),
                        unsafe_allow_html=True,
                    )

            if item.alert_level == "CRITICAL":
                if not toasted_crit:
                    st.toast(f"🚨 CRITICAL DANGER ALERT! Severe drowsiness detected ({item.fatigue_score*100:.0f}% fatigue) — Pull over!", icon="🚨")
                    toasted_crit = True
                if st.session_state.get("sound_enabled", True):
                    from core.audio import cue_data_uri
                    alarm_ph.markdown(f'<audio autoplay style="display:none" src="{cue_data_uri("critical")}"></audio>', unsafe_allow_html=True)
            elif item.alert_level == "WARNING":
                if st.session_state.get("sound_enabled", True):
                    from core.audio import cue_data_uri
                    alarm_ph.markdown(f'<audio autoplay style="display:none" src="{cue_data_uri("warning")}"></audio>', unsafe_allow_html=True)

        elif isinstance(item, Result):
            final_res = item
            break

    if final_res is not None:
        st.session_state[result_key] = {
            "annotated": str(final_res.annotated_path),
            "raw": str(final_res.raw_path),
            "events": final_res.events,
            "telemetry": final_res.telemetry,
            "summary": final_res.summary,
            "cancelled": final_res.cancelled,
        }
        st.session_state["_video_running"] = False
        st.rerun()

# ---------------------------------------------------------------- results

stored = st.session_state.get(result_key)
if stored:
    if stored["cancelled"]:
        st.warning(t("video.cancelled"))
    else:
        st.success(t("video.done"))

    summary = stored["summary"]
    events = stored["events"]
    telemetry = stored["telemetry"]

    section_header(t("video.player"))

    # Interactive Display & Control Buttons Toolbar
    btn_col1, btn_col2, btn_col3 = st.columns([2.0, 1.8, 1.2])
    with btn_col1:
        view_mode = st.segmented_control(
            t("video.view_mode"),
            options=["annotated", "raw", "split"],
            format_func=lambda k: t(f"video.view.{k}"),
            default="annotated",
            key=f"mode_{result_key}",
        )
    with btn_col2:
        # Quick Clinical Jump Buttons
        crit_events = [e for e in events if e.severity == "critical"]
        jump_col1, jump_col2 = st.columns(2)
        with jump_col1:
            if crit_events:
                first_crit = crit_events[0]
                if st.button(f"⚡ {t('video.jump_event')} ({first_crit.t_start:.1f}s)", width='stretch', key=f"btn_jump_crit_{result_key}"):
                    st.session_state["video_player_t"] = first_crit.t_start
                    st.rerun()
            else:
                st.button(f"⚡ {t('video.jump_event')}", disabled=True, width='stretch', key=f"btn_jump_crit_dis_{result_key}")
        with jump_col2:
            # Find peak fatigue timestamp
            if telemetry:
                peak_row = max(telemetry, key=lambda r: r.get("fatigue", 0.0))
                if st.button(f"⚡ {t('video.jump_peak')} ({peak_row['t']:.1f}s)", width='stretch', key=f"btn_jump_peak_{result_key}"):
                    st.session_state["video_player_t"] = peak_row["t"]
                    st.rerun()
            else:
                st.button(f"⚡ {t('video.jump_peak')}", disabled=True, width='stretch', key=f"btn_jump_peak_dis_{result_key}")
    with btn_col3:
        player_engine = st.segmented_control(
            t("video.engine"),
            options=["custom", "native"],
            format_func=lambda k: {
                "custom": "⚡ " + t("video.engine.custom"),
                "native": "📺 " + t("video.engine.native"),
            }[k],
            default="custom",
            key=f"eng_{result_key}",
        )

    # Size selection
    size = st.segmented_control(
        t("video.size"), options=["small", "medium", "large"],
        format_func=lambda k: t(f"video.size.{k}"),
        default=st.session_state.get("video_player_size", "medium"), key=f"size_{result_key}",
    )
    if size:
        st.session_state["video_player_size"] = size

    size_choice = st.session_state.get("video_player_size", "medium")
    if size_choice == "small":
        _, p_col, _ = st.columns([1, 4, 1])
    elif size_choice == "medium":
        _, p_col, _ = st.columns([0.3, 5.4, 0.3])
    else:
        p_col = st.container()

    with p_col:
        # Render selected video player configuration
        if player_engine == "native":
            v_path = stored["annotated"] if view_mode != "raw" else stored["raw"]
            st.video(v_path, start_time=int(st.session_state.get("video_player_t", 0)))
        elif view_mode == "split":
            c_raw, c_ann = st.columns(2)
            with c_raw:
                st.markdown(f"**🎬 {t('video.view.raw')}**")
                render_player(Path(stored["raw"]), events=[], theme=theme, size="small")
            with c_ann:
                st.markdown(f"**🎯 {t('video.view.annotated')}**")
                render_player(Path(stored["annotated"]), events=events, theme=theme, size="small")
        else:
            video_to_show = Path(stored["raw"] if view_mode == "raw" else stored["annotated"])
            render_player(video_to_show, events=[] if view_mode == "raw" else events, theme=theme, size=size_choice)

    latest_level = telemetry[-1]["alert"] if telemetry else "SAFE"
    alert_banner(latest_level if summary.get("time_critical_s", 0) > 0 else "SAFE")

    st.write("")
    driver_score = calculate_driver_score(summary, events, telemetry)
    render_driver_scorecard_ui(driver_score, theme)

    st.write("")
    metric_row([
        {"label": t("m.peak_fatigue"), "value": fmt_pct(summary.get("peak_fatigue")), "variant": "danger"},
        {"label": t("m.mean_fatigue"), "value": fmt_pct(summary.get("mean_fatigue")), "variant": "accent"},
        {"label": t("m.time_warning"), "value": fmt_seconds(summary.get("time_warning_s", 0)), "variant": "warning"},
        {"label": t("m.time_critical"), "value": fmt_seconds(summary.get("time_critical_s", 0)), "variant": "danger"},
    ])
    st.write("")
    metric_row([
        {"label": t("m.micro_blinks"), "value": str(summary.get("micro_blinks", 0))},
        {"label": t("m.micro_sleeps"), "value": str(summary.get("micro_sleeps", 0)), "variant": "warning"},
        {"label": t("m.full_closures"), "value": str(summary.get("full_closures", 0)), "variant": "danger"},
        {"label": t("m.longest_closure"), "value": fmt_seconds(summary.get("longest_closure_s", 0))},
    ])

    st.write("")
    section_header(t("video.timeline"))
    st.plotly_chart(charts.fatigue_timeline(telemetry, events, theme),
                     width='stretch', config={"displayModeBar": False})

    from core.adas_render import CLASS_HEX, CLASSES
    class_legend(CLASS_HEX, {i: f"class.{name}" for i, name in enumerate(CLASSES)})
    st.plotly_chart(charts.class_timeline(telemetry, CLASS_HEX, theme),
                     width='stretch', config={"displayModeBar": False})

    st.write("")
    section_header(t("video.events"))
    if events:
        filter_col, jump_col = st.columns([1.5, 2.5])
        with filter_col:
            filter_mode = st.segmented_control(
                t("video.filter_events"),
                options=["all", "warn_crit", "crit"],
                format_func=lambda k: t(f"video.filter.{k}"),
                default="all",
                key=f"filter_{result_key}",
            )
        
        filtered_events = events
        if filter_mode == "warn_crit":
            filtered_events = [e for e in events if e.severity in ("warning", "critical")]
        elif filter_mode == "crit":
            filtered_events = [e for e in events if e.severity == "critical"]

        with jump_col:
            if filtered_events:
                ev_opts = {
                    f"{t(f'event.{e.kind}')} ({e.t_start:.2f}s - {e.t_end:.2f}s, {e.duration:.2f}s) — {t(f'sev.{e.severity}')}": e.t_start
                    for e in filtered_events
                }
                c_sel, c_btn = st.columns([2.5, 1.2])
                with c_sel:
                    selected_ev_label = st.selectbox(
                        t("video.jump_select"),
                        options=list(ev_opts.keys()),
                        label_visibility="collapsed",
                        key=f"sel_ev_{result_key}",
                    )
                with c_btn:
                    if selected_ev_label:
                        target_t = ev_opts[selected_ev_label]
                        if st.button(f"⚡ ({target_t:.1f}s)", width='stretch', key=f"btn_jump_to_sel_ev_{result_key}"):
                            st.session_state["video_player_t"] = target_t
                            st.rerun()

        if filtered_events:
            df = pd.DataFrame([{
                t("event.kind"): t(f"event.{e.kind}"),
                t("event.start"): round(e.t_start, 2),
                t("event.end"): round(e.t_end, 2),
                t("event.duration"): round(e.duration, 2),
                t("event.severity"): t(f"sev.{e.severity}"),
            } for e in filtered_events])
            st.dataframe(df, width='stretch', hide_index=True)
        else:
            st.caption(t("video.no_events"))

        dl_col1, dl_col2, dl_col3, dl_col4 = st.columns(4)
        dl_col1.download_button(
            t("video.download_csv"), df.to_csv(index=False).encode("utf-8-sig") if filtered_events else b"",
            file_name="events.csv", mime="text/csv", width='stretch',
        )
        with open(stored["annotated"], "rb") as vf:
            dl_col2.download_button(
                t("video.download_video"), vf,
                file_name="annotated.mp4", mime="video/mp4", width='stretch',
            )
        telemetry_bytes = json.dumps(telemetry, indent=2).encode("utf-8")
        dl_col3.download_button(
            t("video.download_json"), telemetry_bytes,
            file_name="telemetry.json", mime="application/json", width='stretch',
        )
        html_report = generate_html_report(driver_score, summary, events, source_path.name, entry.display_name)
        dl_col4.download_button(
            f"📄 {t('video.download_report')}", html_report.encode("utf-8"),
            file_name="driver_safety_report.html", mime="text/html", width='stretch',
        )
    else:
        st.info(t("video.no_events"))

