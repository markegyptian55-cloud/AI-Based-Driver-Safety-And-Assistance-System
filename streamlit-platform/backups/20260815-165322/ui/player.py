"""
Custom video player: one components.v1.html iframe, all controls client-side.

WHY NOT st.video()
==================
st.video() can't seek by a fixed offset, can't show event markers on the scrub
bar, and re-mounts (restarting playback) on almost any Streamlit rerun. Every
control here (play/pause, +-5s, frame-step, speed, scrub, fullscreen) is JS
inside the iframe, so none of it round-trips through Python -- no rerun, no
lost playback position.

SERVING THE VIDEO
==================
The file is served from Streamlit's static file server
(`server.enableStaticServing = true` in .streamlit/config.toml), referenced by
URL, never base64-embedded. A 20-60s clip is 5-20 MB; base64 would inflate that
by ~33% and stuff it into the iframe srcdoc, which is a poor way to move that
much data and risks stalling the websocket.
"""

from __future__ import annotations

import json
from pathlib import Path
from string import Template

import streamlit as st

from .i18n import current_lang, t
from .theme import Theme

TEMPLATES_DIR = Path(__file__).resolve().parent / "static_js"

SIZE_PRESETS = {"small": 560, "medium": 840, "large": 1120}


def _static_url(path: Path) -> str:
    """Path under streamlit-platform/static/ -> the URL Streamlit serves it at.
    If the file is outside static/, safely copies/caches it inside static/out/."""
    platform_root = Path(__file__).resolve().parent.parent
    static_root = (platform_root / "static").resolve()
    resolved = Path(path).resolve()
    try:
        rel = resolved.relative_to(static_root)
        return f"/app/static/{rel.as_posix()}"
    except ValueError:
        cache_dir = static_root / "out"
        cache_dir.mkdir(parents=True, exist_ok=True)
        dest = cache_dir / f"view_{resolved.name}"
        if not dest.exists() or dest.stat().st_size != resolved.stat().st_size:
            import shutil
            try:
                shutil.copy2(resolved, dest)
            except Exception:
                pass
        return f"/app/static/out/{dest.name}"


def _events_json(events: list) -> str:
    return json.dumps([
        {"kind": e.kind, "t_start": round(e.t_start, 3), "t_end": round(e.t_end, 3),
         "duration": round(e.duration, 3), "severity": e.severity}
        for e in events
    ])


def _cues_json() -> str:
    from core.audio import cue_data_uri
    return json.dumps({
        "warning": cue_data_uri("warning"),
        "critical": cue_data_uri("critical"),
        "microsleep": cue_data_uri("microsleep"),
        "full_closure": cue_data_uri("full_closure"),
    })


def _labels_json() -> str:
    return json.dumps({
        "micro_sleep": t("event.micro_sleep"),
        "full_closure": t("event.full_closure"),
        "yawn": t("event.yawn"),
        "warning": t("level.WARNING"),
        "critical": t("level.CRITICAL"),
    })


_ICON_BACK5 = '<span style="font-size:10px;font-weight:700">-5</span>'
_ICON_FWD5 = '<span style="font-size:10px;font-weight:700">+5</span>'
_ICON_FRAME_BACK = "&#9664;&#124;"
_ICON_FRAME_FWD = "&#124;&#9654;"
_ICON_FULLSCREEN = "&#9974;"
_ICON_PLAY = ('<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:currentColor">'
              '<path d="M8 5v14l11-7z"/></svg>')


def build_player_html(
    video_path: Path,
    *,
    events: list,
    theme: Theme,
    size: str = "medium",
    start_at: float = 0.0,
) -> tuple[str, int]:
    """Returns (html, iframe_height)."""
    css_tpl = Template((TEMPLATES_DIR / "player.css.tpl").read_text(encoding="utf-8"))
    js_tpl = Template((TEMPLATES_DIR / "player.js.tpl").read_text(encoding="utf-8"))

    css = css_tpl.safe_substitute(
        bg=theme.bg, accent=theme.accent, warning=theme.warning, danger=theme.danger,
        border=theme.border, panel=theme.surface_2, panel2=theme.bg_elev,
        track=theme.border, bufferred=theme.border, text=theme.text, muted=theme.text_muted,
        font="Segoe UI, sans-serif", mono='"Cascadia Mono","Consolas",monospace',
    )
    video_url = _static_url(video_path)
    js = js_tpl.safe_substitute(
        events=_events_json(events),
        cues=_cues_json(),
        labels=_labels_json(),
        video_url=video_url,
        start_at=f"{start_at:.3f}",
        accent=theme.accent, warning=theme.warning, danger=theme.danger,
    )

    dir_attr = 'dir="rtl"' if current_lang() == "ar" else 'dir="ltr"'

    html = f"""<!doctype html>
<html {dir_attr}>
<head><meta charset="utf-8"><style>{css}</style></head>
<body>
  <div class="nbp-wrap">
    <div class="nbp-video-box">
      <video id="nbp-video" class="nbp-video" src="{video_url}" preload="metadata" playsinline></video>
      <div id="nbp-alert" class="nbp-alert"></div>
    </div>
    <div class="nbp-controls">
      <div class="nbp-scrub" id="nbp-scrub">
        <div class="nbp-scrub-track">
          <div class="nbp-scrub-buffered" id="nbp-scrub-buffered"></div>
          <div class="nbp-scrub-played" id="nbp-scrub-played"></div>
        </div>
        <div class="nbp-scrub-handle" id="nbp-scrub-handle"></div>
        <div class="nbp-scrub-tip" id="nbp-scrub-tip"></div>
      </div>
      <div class="nbp-row between">
        <div class="nbp-row">
          <button class="nbp-btn" id="nbp-frameback" title="Previous frame">{_ICON_FRAME_BACK}</button>
          <button class="nbp-btn" id="nbp-back5" title="Back 5s">{_ICON_BACK5}</button>
          <button class="nbp-btn big" id="nbp-play" title="Play / pause">{_ICON_PLAY}</button>
          <button class="nbp-btn" id="nbp-fwd5" title="Forward 5s">{_ICON_FWD5}</button>
          <button class="nbp-btn" id="nbp-frameforward" title="Next frame">{_ICON_FRAME_FWD}</button>
          <span class="nbp-time" id="nbp-time">0:00 / 0:00</span>
        </div>
        <div class="nbp-row">
          <select class="nbp-speed" id="nbp-speed">
            <option value="0.5">0.5x</option>
            <option value="1" selected>1x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
          <button class="nbp-btn" id="nbp-fullscreen" title="Fullscreen">{_ICON_FULLSCREEN}</button>
        </div>
      </div>
      <div class="nbp-hint">Space play/pause &middot; &larr;/&rarr; &plusmn;5s &middot; J/L &plusmn;10s &middot; F fullscreen</div>
    </div>
  </div>
  <script>{js}</script>
</body>
</html>"""

    height = SIZE_PRESETS.get(size, 720) * 9 // 16 + 118  # video area + control bar
    return html, height


def render_player(video_path: Path, *, events: list, theme: Theme,
                   size_key: str = "video_player_size", start_at_key: str = "video_player_t",
                   size: str | None = None, start_at: float | None = None) -> None:
    """Renders the player using custom HTML5 controls."""
    chosen_size = size or st.session_state.get(size_key, "medium")
    chosen_start_at = start_at if start_at is not None else st.session_state.get(start_at_key, 0.0)

    html, height = build_player_html(Path(video_path), events=events, theme=theme,
                                      size=chosen_size, start_at=chosen_start_at)
    import streamlit.components.v1 as components
    components.html(html, height=height, scrolling=False)

