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
