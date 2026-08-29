"""
Reusable HTML fragments built on the theme tokens from ui/theme.py.

These replace raw `st.metric` everywhere — `st.metric` has no themable color
per tile (a fatigue score should read green/amber/red, `st.metric`'s delta
arrow can't express that), so every KPI in the app renders through
`metric_tile()` instead.
"""

from __future__ import annotations

import html as _html

import streamlit as st

from .i18n import t

Variant = str  # "accent" | "success" | "warning" | "danger" | "muted"


def _esc(s: object) -> str:
    return _html.escape(str(s))


def metric_tile(label: str, value: str, *, sub: str | None = None,
                 variant: Variant = "accent", mono: bool = True) -> None:
    """One KPI tile. `value` should already be formatted (e.g. "82.3%")."""
    cls = f"nb-tile is-{variant}" if variant != "muted" else "nb-tile"
    value_cls = "nb-tile-value nb-ltr" if mono else "nb-tile-value"
    sub_html = f'<div class="nb-tile-sub">{_esc(sub)}</div>' if sub else ""
    st.markdown(
        f"""<div class="{cls}">
              <div class="nb-tile-label">{_esc(label)}</div>
              <div class="{value_cls}">{_esc(value)}</div>
              {sub_html}
            </div>""",
        unsafe_allow_html=True,
    )


def metric_row(tiles: list[dict]) -> None:
    """tiles: [{"label","value","sub"?,"variant"?}, ...] — laid out in columns."""
    cols = st.columns(len(tiles))
    for col, spec in zip(cols, tiles):
        with col:
            metric_tile(
                spec["label"], spec["value"],
                sub=spec.get("sub"), variant=spec.get("variant", "accent"),
            )


_LEVEL_VARIANT = {"SAFE": "safe", "WARNING": "warning", "CRITICAL": "critical"}


def status_pill(level: str) -> str:
    """Returns HTML (caller embeds it — used both standalone and inside tiles)."""
    variant = _LEVEL_VARIANT.get(level, "muted")
    label = t(f"level.{level}") if level in _LEVEL_VARIANT else level
    return (f'<span class="nb-pill {variant}"><span class="dot"></span>'
            f'{_esc(label)}</span>')


def render_status_pill(level: str) -> None:
    st.markdown(status_pill(level), unsafe_allow_html=True)


def alert_banner(level: str) -> None:
    """Full-width banner for WARNING/CRITICAL. Renders nothing for SAFE —
    the sidebar/tile pill already communicates that state; a banner for
    every-frame-is-fine would just be noise."""
    if level not in ("WARNING", "CRITICAL"):
        return
    variant = "warning" if level == "WARNING" else "critical"
    icon = "⚠" if level == "WARNING" else "✖"
    msg = t("alert.warning.msg" if level == "WARNING" else "alert.critical.msg")
    st.markdown(
        f"""<div class="nb-alert {variant}">
              <span style="font-size:1.2rem;line-height:1">{icon}</span>
              <span>{_esc(msg)}</span>
            </div>""",
        unsafe_allow_html=True,
    )


def section_header(title: str, eyebrow: str | None = None) -> None:
    eyebrow_html = f'<span class="nb-eyebrow">{_esc(eyebrow)}</span>' if eyebrow else ""
    st.markdown(f'{eyebrow_html}<h2 style="margin-top:.1rem">{_esc(title)}</h2>',
                unsafe_allow_html=True)


def panel_start(extra_style: str = "") -> None:
    st.markdown(f'<div class="nb-panel" style="{extra_style}">', unsafe_allow_html=True)


def panel_end() -> None:
    st.markdown("</div>", unsafe_allow_html=True)


def class_legend(class_hex: dict[int, str], class_keys: dict[int, str]) -> None:
    """Legend row using the exact colours burned into the video overlay."""
    parts = []
    for cid, hexcolor in class_hex.items():
        label = t(class_keys.get(cid, ""))
        parts.append(
            f'<span style="margin-inline-end:1.1rem;white-space:nowrap">'
            f'<span class="nb-swatch" style="background:{hexcolor}"></span>{_esc(label)}</span>'
        )
    st.markdown(f'<div style="line-height:2">{"".join(parts)}</div>', unsafe_allow_html=True)


def device_badge(info: dict) -> str:
    if info.get("cuda"):
        return f'CUDA · {info.get("name", "GPU")}'
    return "CPU"


def fmt_seconds(s: float) -> str:
    s = max(0.0, s)
    m, sec = divmod(s, 60)
    h, m = divmod(int(m), 60)
    if h:
        return f"{h:d}:{m:02d}:{sec:05.2f}"
    return f"{int(m):d}:{sec:05.2f}"


def fmt_pct(x: float | None, digits: int = 1) -> str:
    if x is None:
        return "—"
    return f"{x * 100:.{digits}f}%"
