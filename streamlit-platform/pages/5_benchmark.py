"""
Benchmark page: measured inference speed per model.

WHAT THIS MEASURES, AND WHAT IT DOES NOT
========================================
Every number on this page is timed on THIS machine, on demand. Nothing is
copied from a specification sheet and nothing is estimated from parameter
counts or input resolution -- an assumption this project has already had
contradicted by measurement once, when reducing input resolution from 960
to 480 turned out not to reduce GPU latency at all because these models
are launch-overhead-bound rather than compute-bound at batch 1.

The timing covers the model forward pass on a synthetic frame of the
model's own input size. It deliberately excludes video decoding and
overlay rendering, which the Video page's own throughput figure includes,
so the two numbers answer different questions and should not be compared
directly.

CUDA is synchronised around every timed region. Without that, an
asynchronous kernel launch returns before the GPU has finished and the
measurement records dispatch speed rather than inference speed.
"""

from __future__ import annotations

import statistics
import sys
import time
from pathlib import Path

import numpy as np
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.autotune import CANDIDATES, cached_batch, load_cache, tune_model  # noqa: E402
from core.detect import describe_device, load_model  # noqa: E402
from core.registry import ModelEntry  # noqa: E402
from ui.components import metric_row, section_header  # noqa: E402
from ui.i18n import t  # noqa: E402
from ui.theme import get_theme  # noqa: E402

theme = st.session_state.get("_theme_obj") or get_theme()
entries: dict[str, ModelEntry] = st.session_state.get("_model_entries", {})

section_header(t("bench.title"), eyebrow="ADAS")
st.caption(t("bench.subtitle"))

if not entries:
    st.info(t("models.missing"))
    st.stop()

device = st.session_state.get("_device_info") or describe_device()
metric_row([
    {"label": t("bench.device"), "value": device.get("name", "CPU")},
    {"label": t("bench.backend"), "value": "CUDA" if device.get("cuda") else "CPU"},
    {"label": t("bench.models"), "value": str(len(entries))},
])

st.write("")


def _sync():
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.synchronize()
    except Exception:
        pass


def _time_model(model, imgsz: int, family: str, batch: int,
                reps: int, half: bool) -> dict:
    """Median ms/frame and FPS for one configuration."""
    dummy = np.zeros((imgsz, imgsz, 3), dtype=np.uint8)
    src = [dummy] * batch if batch > 1 else dummy

    if family == "rfdetr":
        from PIL import Image
        pil = Image.fromarray(np.zeros((imgsz, imgsz, 3), dtype=np.uint8))

        def once():
            model.predict(pil, threshold=0.35)
    else:
        def once():
            model.predict(source=src, imgsz=imgsz, half=half, verbose=False)

    for _ in range(3):
        once()
    _sync()

    samples = []
    for _ in range(reps):
        _sync()
        t0 = time.perf_counter()
        once()
        _sync()
        samples.append((time.perf_counter() - t0) * 1000.0 / max(batch, 1))

    samples.sort()
    med = statistics.median(samples)
    return {
        "ms": med,
        "fps": 1000.0 / med if med > 0 else 0.0,
        "p95": samples[min(int(len(samples) * 0.95), len(samples) - 1)],
    }


# ---------------------------------------------------------------- controls

with st.container():
    c1, c2, c3 = st.columns([2, 1, 1])
    with c1:
        chosen = st.multiselect(
            t("bench.select"),
            options=list(entries.keys()),
            default=[st.session_state.get("model_key")]
            if st.session_state.get("model_key") in entries else [],
            format_func=lambda k: entries[k].display_name,
        )
    with c2:
        reps = st.slider(t("bench.reps"), 5, 50, 15, step=5,
                         help=t("bench.reps.help"))
    with c3:
        use_tuned = st.toggle(t("bench.use_tuned"), value=True,
                              help=t("bench.use_tuned.help"))

    run_col, tune_col = st.columns(2)
    run_bench = run_col.button(t("bench.run"), type="primary", width="stretch",
                               disabled=not chosen)
    run_tune = tune_col.button(t("bench.tune_all"), width="stretch",
                               disabled=not chosen)

st.write("")

# ---------------------------------------------------------------- auto-tune

if run_tune:
    prog = st.progress(0.0)
    status = st.empty()
    for i, key in enumerate(chosen):
        e = entries[key]
        status.caption(f"{t('bench.tuning')} {e.display_name}")
        try:
            m = load_model(e.checkpoint, family=e.family, resolution=e.resolution,
                           rfdetr_class=e.rfdetr_class)
            tune_model(m, key, e.resolution, family=e.family)
        except Exception as exc:
            st.warning(f"{e.display_name}: {exc}")
        prog.progress((i + 1) / len(chosen))
    status.empty()
    prog.empty()
    st.success(t("bench.tune_done"))

# ---------------------------------------------------------------- benchmark

if run_bench:
    rows = []
    prog = st.progress(0.0)
    status = st.empty()
    half = bool(st.session_state.get("use_half", False))

    for i, key in enumerate(chosen):
        e = entries[key]
        status.caption(f"{t('bench.timing')} {e.display_name}")
        try:
            m = load_model(e.checkpoint, family=e.family, resolution=e.resolution,
                           rfdetr_class=e.rfdetr_class, half=half)
            b1 = _time_model(m, e.resolution, e.family, 1, reps, half)
            tuned_b = (cached_batch(key) or 1) if use_tuned else 1
            bt = (_time_model(m, e.resolution, e.family, tuned_b, reps, half)
                  if tuned_b > 1 else b1)
            rows.append({
                "key": key,
                t("bench.col.model"): e.display_name,
                t("bench.col.family"): e.family,
                t("bench.col.input"): e.resolution,
                t("bench.col.size"): round(e.size_mb, 1),
                t("bench.col.b1ms"): round(b1["ms"], 2),
                t("bench.col.b1fps"): round(b1["fps"], 1),
                t("bench.col.batch"): tuned_b,
                t("bench.col.bms"): round(bt["ms"], 2),
                t("bench.col.bfps"): round(bt["fps"], 1),
                t("bench.col.gain"): round(b1["ms"] / bt["ms"], 2) if bt["ms"] else 1.0,
                t("bench.col.map"): (round(e.map50_corrected * 100, 2)
                                     if e.map50_corrected is not None else None),
            })
        except Exception as exc:
            st.warning(f"{e.display_name}: {type(exc).__name__}: {exc}")
        prog.progress((i + 1) / len(chosen))

    status.empty()
    prog.empty()

    if rows:
        st.session_state["_bench_rows"] = rows

rows = st.session_state.get("_bench_rows") or []

if rows:
    import pandas as pd
    import plotly.graph_objects as go

    df = pd.DataFrame(rows).drop(columns=["key"])
    st.dataframe(df, width="stretch", hide_index=True)

    csv = df.to_csv(index=False).encode("utf-8")
    st.download_button(t("bench.download"), csv, "benchmark.csv", "text/csv")

    st.write("")

    # Accuracy against speed: the deployment trade-off this platform exists
    # to inform. A model is only interesting if nothing else is both faster
    # and more accurate, so the Pareto frontier is what matters, not either
    # axis alone.
    xs = [r[t("bench.col.bfps")] for r in rows]
    ys = [r[t("bench.col.map")] for r in rows]
    names = [r[t("bench.col.model")] for r in rows]
    pts = [(x, y, n) for x, y, n in zip(xs, ys, names) if y is not None]

    if pts:
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=[p[0] for p in pts], y=[p[1] for p in pts],
            mode="markers+text", text=[p[2] for p in pts],
            textposition="top center",
            marker=dict(size=13, color=theme.accent,
                        line=dict(width=1, color=theme.text)),
            hovertemplate="%{text}<br>%{x:.1f} FPS<br>%{y:.2f} mAP50<extra></extra>",
        ))
        # Styled through charts._layout so this page cannot drift away from
        # the rest of the app's plot styling when a theme changes.
        from ui.charts import _layout
        _layout(fig, theme, height=430)
        fig.update_xaxes(title_text=t("bench.axis.fps"))
        fig.update_yaxes(title_text=t("bench.axis.map"))
        fig.update_layout(showlegend=False)
        st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})

    st.caption(t("bench.note"))

# ---------------------------------------------------------------- tuning table

st.write("")
with st.expander(t("bench.tuned_title"), expanded=False):
    cache = load_cache()
    if not cache:
        st.caption(t("bench.no_tuning"))
    else:
        trows = []
        for key, e in entries.items():
            info = cache.get(key)
            if not isinstance(info, dict):
                continue
            timings = info.get("timings") or {}
            trows.append({
                t("bench.col.model"): e.display_name,
                t("bench.col.batch"): info.get("batch"),
                t("bench.col.gain"): info.get("gain_vs_batch1"),
                t("bench.col.reason"): info.get("reason"),
                **{f"b{b}": timings.get(str(b)) for b in CANDIDATES},
            })
        if trows:
            import pandas as pd
            st.dataframe(pd.DataFrame(trows), width="stretch", hide_index=True)
            st.caption(t("bench.tuned_note"))
        else:
            st.caption(t("bench.no_tuning"))
