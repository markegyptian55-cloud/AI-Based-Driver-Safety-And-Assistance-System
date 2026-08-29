"""Models page: card grid + cross-model comparison, built entirely from the
model cards produced by tools/build_models.py -- no inference runs here."""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ui import charts
from ui.components import section_header
from ui.i18n import t
from ui.model_picker import render_model_card
from ui.theme import get_theme

theme = st.session_state.get("_theme_obj") or get_theme()
entries = st.session_state.get("_model_entries", {})
missing = st.session_state.get("_model_missing", [])

section_header(t("models.title"), eyebrow=t("nav.models"))
st.caption(t("models.subtitle"))

if not entries:
    st.warning(t("models.missing"))
    st.stop()

ranked = sorted(entries.values(), key=lambda e: (e.map50_corrected or e.map50 or -1), reverse=True)
best = ranked[0].key if ranked else None

st.write("")
section_header(t("models.compare"))
compare_rows = [{"name": e.display_name, "map50": e.map50_corrected or e.map50} for e in ranked]
st.plotly_chart(charts.model_compare_bar(compare_rows, theme), width='stretch',
                 config={"displayModeBar": False})

st.write("")
for e in ranked:
    with st.container():
        if e.key == best:
            st.markdown(f"🏆 **{t('models.best')}**")
        render_model_card(e, theme)
        st.divider()

if missing:
    st.write("")
    section_header(t("models.missing"))
    for key in missing:
        st.caption(f"— {key}")
