"""
Entrypoint. Sets page config, wires session defaults, injects theme/i18n CSS,
then hands off to st.navigation.

Programmatic navigation (st.Page / st.navigation) is used instead of the
filesystem `pages/` auto-discovery specifically because auto-discovered page
titles come from the filename and can't be translated -- Page titles here are
built from `t()` so switching language relabels the sidebar nav too.
"""

from __future__ import annotations

from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent
import sys
sys.path.insert(0, str(ROOT))

from core.detect import describe_device
from core.registry import load_registry
from ui.components import device_badge
from ui.i18n import LANGUAGES, current_lang, t
from ui.model_picker import render_model_picker
from ui.theme import THEMES, inject_theme

st.set_page_config(
    page_title="Drowsiness Detection Platform",
    page_icon="🚗",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------------------------------------------------------------- defaults

_DEFAULTS = {
    "lang": "en",
    "theme": "neon",
    "conf": 0.35,
    "window_size": 30,
    "warning_threshold": 0.40,
    "critical_threshold": 0.65,
    "critical_hold": 1.5,
    "hud_pos": "top-right",
    "sound_enabled": True,
    "video_player_size": "medium",
    "video_player_t": 0.0,
    # "auto" uses each model's measured batch size; "off" forces 1. Default
    # auto is safe because an untuned model falls back to 1 anyway, so the
    # setting can never make a model slower than it was before tuning.
    "batch_mode": "auto",
    "use_half": False,
}
for k, v in _DEFAULTS.items():
    st.session_state.setdefault(k, v)

theme = inject_theme(st.session_state["theme"], st.session_state["lang"])
st.session_state["_theme_obj"] = theme  # pages read this rather than re-injecting

entries, missing = load_registry()
st.session_state["_model_entries"] = entries
st.session_state["_model_missing"] = missing
if "model_key" not in st.session_state and entries:
    from core.registry import best_key
    st.session_state["model_key"] = best_key(entries)

device_info = describe_device()
st.session_state["_device_info"] = device_info

# ---------------------------------------------------------------- sidebar

with st.sidebar:
    st.markdown(
        f"""<div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.4rem">
              <span style="font-size:1.5rem">🚗</span>
              <div>
                <div style="font-weight:700;font-size:1.02rem;line-height:1.15">{t('app.title')}</div>
                <div style="font-size:.72rem;color:var(--nb-muted)">{t('app.subtitle')}</div>
              </div>
            </div>""",
        unsafe_allow_html=True,
    )
    st.divider()

    lang_col, theme_col = st.columns(2)
    with lang_col:
        st.markdown(f'<span class="nb-eyebrow">{t("side.language")}</span>', unsafe_allow_html=True)
        new_lang = st.segmented_control(
            "lang", options=list(LANGUAGES.keys()), format_func=lambda k: LANGUAGES[k],
            default=st.session_state["lang"], key="_lang_ctrl", label_visibility="collapsed",
        )
    with theme_col:
        st.markdown(f'<span class="nb-eyebrow">{t("side.theme")}</span>', unsafe_allow_html=True)
        theme_labels = {k: t(f"side.theme.{k}") for k in THEMES}
        new_theme = st.segmented_control(
            "theme", options=list(THEMES.keys()), format_func=lambda k: theme_labels[k],
            default=st.session_state["theme"], key="_theme_ctrl", label_visibility="collapsed",
        )

    if new_lang and new_lang != st.session_state["lang"]:
        st.session_state["lang"] = new_lang
        st.rerun()
    if new_theme and new_theme != st.session_state["theme"]:
        st.session_state["theme"] = new_theme
        st.rerun()

    st.divider()

    if missing:
        st.caption(f"⚠ {len(missing)} " + t("models.missing").lower())

    render_model_picker(entries, key="model_key", theme=theme)

    st.divider()
    with st.expander(t("side.settings"), expanded=False):
        hud_pos_options = ["top-right", "top-left", "bottom-right", "bottom-left", "auto", "off"]
        st.selectbox(
            t("side.hud_pos"),
            options=hud_pos_options,
            format_func=lambda k: t(f"side.hud_pos.{k}"),
            key="hud_pos",
        )
        st.slider(t("side.conf"), 0.05, 0.90, key="conf", step=0.05, help=t("side.conf.help"))
        st.slider(t("side.window"), 10, 90, key="window_size", step=5, help=t("side.window.help"))
        st.slider(t("side.warn_thr"), 0.10, 0.90, key="warning_threshold", step=0.05)
        st.slider(t("side.crit_thr"), 0.10, 0.95, key="critical_threshold", step=0.05)
        st.slider(t("side.hold"), 0.0, 5.0, key="critical_hold", step=0.25, help=t("side.hold.help"))
        if st.button(t("side.reset"), width='stretch'):
            for k, v in _DEFAULTS.items():
                if k not in ("lang", "theme"):
                    st.session_state[k] = v
            st.rerun()

    with st.expander(t("side.performance"), expanded=False):
        from core.autotune import cached_batch, load_cache

        st.toggle(
            t("side.batch"),
            value=st.session_state.get("batch_mode", "auto") == "auto",
            key="_batch_ctrl",
            help=t("side.batch.help"),
            on_change=lambda: st.session_state.__setitem__(
                "batch_mode", "auto" if st.session_state["_batch_ctrl"] else "off"),
        )

        sel_key = st.session_state.get("model_key")
        tuned = cached_batch(sel_key) if sel_key else None
        if st.session_state.get("batch_mode") == "auto":
            if tuned:
                info = (load_cache().get(sel_key) or {})
                gain = info.get("gain_vs_batch1")
                gain_s = f" · {gain:.2f}x" if isinstance(gain, (int, float)) else ""
                st.caption(f"{t('side.batch.tuned')}: {tuned}{gain_s}")
            else:
                st.caption(t("side.batch.untuned"))

        if st.button(t("side.autotune"), width='stretch',
                     help=t("side.autotune.help")):
            entry = entries.get(sel_key) if sel_key else None
            if entry is None:
                st.warning(t("side.autotune.nomodel"))
            else:
                with st.spinner(t("side.autotune.running")):
                    from core.autotune import tune_model
                    from core.detect import load_model as _lm
                    try:
                        _m = _lm(entry.checkpoint, family=entry.family,
                                 resolution=entry.resolution,
                                 rfdetr_class=entry.rfdetr_class)
                        res = tune_model(_m, entry.key, entry.resolution,
                                         family=entry.family)
                        g = res.get("gain_vs_batch1", 1.0)
                        st.success(f"{t('side.batch.tuned')}: {res['batch']} · {g:.2f}x")
                    except Exception as exc:
                        # Surfaced, not swallowed: a tuning failure means the
                        # model keeps batch 1, which is correct but the user
                        # should know why no speed-up appeared.
                        st.error(f"{t('side.autotune.failed')}: {exc}")

        st.toggle(t("side.half"), key="use_half", help=t("side.half.help"))
        if not device_info.get("cuda"):
            st.caption(t("side.half.cpu"))

    with st.expander(t("side.alerts"), expanded=False):
        st.toggle(t("side.sound"), key="sound_enabled")
        c_snd1, c_snd2 = st.columns(2)
        with c_snd1:
            if st.button(t("side.test_sound"), width='stretch', help=t("side.test_sound.help")):
                from core.audio import cue_bytes
                st.audio(cue_bytes("test"), format="audio/wav", autoplay=True)
                st.toast("🔊 ADAS Warning Tone Tested", icon="🔊")
        with c_snd2:
            if st.button("🚨 Siren", width='stretch', help="Test Critical ADAS Alarm Siren"):
                from core.audio import cue_bytes
                st.audio(cue_bytes("critical"), format="audio/wav", autoplay=True)
                st.toast("🚨 CRITICAL SIREN ALARM TESTED", icon="🚨")

    st.divider()
    st.caption(f"{t('side.device')}: {device_badge(device_info)}")

# ---------------------------------------------------------------- pages

pages = [
    st.Page("pages/1_video.py", title=t("nav.video"), icon="🎬", default=True),
    st.Page("pages/2_webcam.py", title=t("nav.webcam"), icon="📷"),
    st.Page("pages/3_models.py", title=t("nav.models"), icon="📊"),
    st.Page("pages/4_about.py", title=t("nav.about"), icon="ℹ️"),
]
nav = st.navigation(pages, position="sidebar")
nav.run()
