"""About page: method explanation, class legend, environment report,
vendored-code provenance."""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from core.adas_render import CLASS_HEX, CLASSES
from core.detect import describe_device
from core.video_io import nvenc_available
from ui.components import class_legend, section_header
from ui.i18n import t

section_header(t("about.title"), eyebrow="ADAS")

st.markdown(f"### {t('about.how')}")
st.write(t("about.how.body"))

st.markdown(f"### {t('about.scoring')}")
st.write(t("about.scoring.body"))

st.markdown(f"### {t('about.events')}")
st.write(t("about.events.body"))

st.markdown(f"### {t('about.classes')}")
class_legend(CLASS_HEX, {i: f"class.{name}" for i, name in enumerate(CLASSES)})

st.divider()
st.markdown(f"### {t('about.limits')}")
st.info(t("about.limits.hud"))
st.info(t("about.limits.acc"))

st.divider()
st.markdown(f"### {t('about.env')}")
device = describe_device()
try:
    import streamlit as _st_mod
    st_ver = _st_mod.__version__
except Exception:
    st_ver = "?"
try:
    from ultralytics import __version__ as ul_ver
except Exception:
    ul_ver = "?"
try:
    import av
    av_ver = av.__version__
except Exception:
    av_ver = "?"

env_rows = [
    ("Streamlit", st_ver),
    ("Ultralytics", ul_ver),
    ("PyTorch", device.get("torch") or "?"),
    ("CUDA", t("common.yes") if device.get("cuda") else t("common.no")),
    ("Device", device.get("name", "CPU")),
    ("OpenCV", cv2.__version__),
    ("NumPy", np.__version__),
    ("PyAV", av_ver),
    ("H.264 hardware encode (NVENC)", t("common.yes") if nvenc_available() else t("common.no")),
]
for label, value in env_rows:
    c1, c2 = st.columns([1, 2])
    c1.markdown(f"**{label}**")
    c2.markdown(f"<span class='nb-ltr'>{value}</span>", unsafe_allow_html=True)

st.divider()
st.markdown(f"### {t('about.provenance')}")
st.write(t("about.provenance.body"))
st.caption(
    "Vendored from src/demo_video.py: adas_render.py, detect.py. "
    "Rewritten from src/inference.py: analyzer.py (instance thresholds, "
    "injected time base — see module docstring for the full diff)."
)
