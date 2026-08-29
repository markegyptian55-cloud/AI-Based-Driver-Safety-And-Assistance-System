"""
Plotly charts, themed from ui/theme.py tokens rather than Plotly's defaults —
otherwise a chart on the neon theme looks pasted from a different app.
"""

from __future__ import annotations

import plotly.graph_objects as go

from .i18n import t
from .theme import Theme

_EVENT_COLOR = {
    "micro_blink": None,     # not plotted — informational, not an alert
    "micro_sleep": "warning",
    "full_closure": "danger",
    "yawn": "warning",
}


def _layout(fig: go.Figure, theme: Theme, *, height: int = 320, title: str | None = None) -> go.Figure:
    fig.update_layout(
        template=theme.plotly_template,
        paper_bgcolor=theme.surface,
        plot_bgcolor=theme.surface,
        font=dict(color=theme.text, family="Segoe UI, sans-serif", size=12),
        margin=dict(l=48, r=24, t=44 if title else 16, b=36),
        height=height,
        title=dict(text=title, font=dict(size=13, color=theme.text_muted)) if title else None,
        legend=dict(bgcolor="rgba(0,0,0,0)", orientation="h", y=1.08, x=0),
        hoverlabel=dict(bgcolor=theme.surface_2, font_color=theme.text, bordercolor=theme.border),
    )
    fig.update_xaxes(gridcolor=theme.border, zerolinecolor=theme.border)
    fig.update_yaxes(gridcolor=theme.border, zerolinecolor=theme.border)
    return fig


def fatigue_timeline(telemetry: list[dict], events: list, theme: Theme) -> go.Figure:
    ts = [row["t"] for row in telemetry]
    scores = [row["fatigue"] for row in telemetry]

    fig = go.Figure()

    for ev in events:
        variant = _EVENT_COLOR.get(ev.kind)
        if variant is None:
            continue
        color = getattr(theme, variant)
        fig.add_vrect(x0=ev.t_start, x1=max(ev.t_end, ev.t_start + 0.05),
                       fillcolor=color, opacity=0.22, line_width=0)

    fig.add_trace(go.Scatter(
        x=ts, y=scores, mode="lines", name=t("m.fatigue"),
        line=dict(color=theme.accent, width=2),
        fill="tozeroy", fillcolor=_alpha(theme.accent, 0.12),
    ))

    fig.add_hline(y=0.40, line=dict(color=theme.warning, width=1, dash="dot"))
    fig.add_hline(y=0.65, line=dict(color=theme.danger, width=1, dash="dot"))

    fig.update_yaxes(range=[0, 1], tickformat=".0%", title=None)
    fig.update_xaxes(title=t("common.seconds"))
    fig.update_layout(hovermode="x unified")
    return _layout(fig, theme, height=300)


def event_gantt(events: list, theme: Theme) -> go.Figure:
    kinds = ["yawn", "full_closure", "micro_sleep", "micro_blink"]
    color_key = {"micro_blink": "accent", "micro_sleep": "warning",
                 "full_closure": "danger", "yawn": "warning"}
    label_key = {"micro_blink": "event.micro_blink", "micro_sleep": "event.micro_sleep",
                 "full_closure": "event.full_closure", "yawn": "event.yawn"}

    fig = go.Figure()
    for kind in kinds:
        rows = [e for e in events if e.kind == kind]
        if not rows:
            continue
        fig.add_trace(go.Bar(
            x=[e.duration for e in rows],
            y=[t(label_key[kind])] * len(rows),
            base=[e.t_start for e in rows],
            orientation="h",
            marker_color=getattr(theme, color_key[kind]),
            name=t(label_key[kind]),
            hovertemplate="%{base:.2f}s + %{x:.2f}s<extra></extra>",
            showlegend=False,
        ))
    fig.update_xaxes(title=t("common.seconds"))
    fig.update_layout(barmode="stack")
    return _layout(fig, theme, height=220)


def class_timeline(telemetry: list[dict], class_hex: dict[int, str], theme: Theme) -> go.Figure:
    from core.adas_render import CLASSES

    ts = [row["t"] for row in telemetry]
    fig = go.Figure()
    for cid, name in enumerate(CLASSES):
        present = [1 if name in row["classes"] else 0 for row in telemetry]
        fig.add_trace(go.Scatter(
            x=ts, y=present, mode="lines", name=t(f"class.{name}"),
            line=dict(width=0), stackgroup="one",
            fillcolor=_alpha(class_hex.get(cid, theme.accent), 0.55),
        ))
    fig.update_yaxes(visible=False)
    fig.update_xaxes(title=t("common.seconds"))
    return _layout(fig, theme, height=160)


def perclos_gauge(score: float, level: str, theme: Theme) -> go.Figure:
    color = {"SAFE": theme.success, "WARNING": theme.warning, "CRITICAL": theme.danger}.get(level, theme.accent)
    fig = go.Figure(go.Indicator(
        mode="gauge+number",
        value=score * 100,
        number={"suffix": "%", "font": {"color": theme.text, "size": 34}},
        gauge={
            "axis": {"range": [0, 100], "tickcolor": theme.text_muted},
            "bar": {"color": color},
            "bgcolor": theme.surface_2,
            "borderwidth": 1,
            "bordercolor": theme.border,
            "steps": [
                {"range": [0, 40], "color": _alpha(theme.success, 0.18)},
                {"range": [40, 65], "color": _alpha(theme.warning, 0.18)},
                {"range": [65, 100], "color": _alpha(theme.danger, 0.18)},
            ],
        },
    ))
    return _layout(fig, theme, height=200)


def per_class_bar(ap_per_class: dict[str, float], class_hex: dict[str, str], theme: Theme) -> go.Figure:
    names = list(ap_per_class.keys())
    fig = go.Figure(go.Bar(
        x=[t(f"class.{n}") for n in names],
        y=[ap_per_class[n] * 100 for n in names],
        marker_color=[class_hex.get(n, theme.accent) for n in names],
        text=[f"{ap_per_class[n]*100:.1f}%" for n in names],
        textposition="outside",
    ))
    fig.update_yaxes(range=[0, 100], ticksuffix="%", title="AP@50")
    return _layout(fig, theme, height=280)


def model_compare_bar(models: list[dict], theme: Theme) -> go.Figure:
    """models: [{"name": str, "map50": float}], sorted by caller."""
    fig = go.Figure(go.Bar(
        x=[m["map50"] * 100 if m["map50"] is not None else 0 for m in models],
        y=[m["name"] for m in models],
        orientation="h",
        marker_color=theme.accent,
        text=[f"{m['map50']*100:.2f}%" if m["map50"] is not None else "—" for m in models],
        textposition="outside",
    ))
    fig.update_xaxes(range=[0, 100], ticksuffix="%", title="mAP@50")
    return _layout(fig, theme, height=max(180, 46 * len(models)))


def _alpha(hex_color: str, a: float) -> str:
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return hex_color
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"rgba({r},{g},{b},{a})"
