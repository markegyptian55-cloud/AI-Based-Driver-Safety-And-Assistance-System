"""
Runtime theming: dark / neon, plus RTL for Arabic. (Light was removed --
low contrast against the ADAS-style dark panels, never looked right.)

WHY CSS INJECTION
=================
Streamlit's theme lives in `.streamlit/config.toml` and is read once at
startup -- there is no runtime theme API. So `config.toml` sets base="dark"
(which stops the white flash on first paint) and everything after that is one
injected <style> block per rerun.

Every colour is a CSS custom property on :root. Components reference the
variables, never literals, so a theme switch is a token swap rather than a
rules rewrite.

SELECTOR STRATEGY
    1. `[data-testid="..."]` -- Streamlit's own stable hooks.
    2. `.st-key-<key>`       -- emitted for any `st.container(key=...)`. This is
                                the preferred hook for OUR panels because it
                                cannot break when Streamlit renames an internal
                                testid.
"""

from __future__ import annotations

from dataclasses import dataclass

import streamlit as st


@dataclass(frozen=True)
class Theme:
    key: str
    label: str
    bg: str
    bg_elev: str
    surface: str
    surface_2: str
    border: str
    text: str
    text_muted: str
    accent: str
    accent_2: str
    success: str
    warning: str
    danger: str
    glow: str
    shadow: str
    plotly_template: str
    is_dark: bool


THEMES: dict[str, Theme] = {
    # Vantablack: true #000 ground with near-black panels that read as
    # depth rather than as blue. The previous "dark" theme was not
    # actually dark -- its panels were #070c18/#0b1224, navy blues light
    # enough that on an OLED or a well-calibrated display the whole UI
    # looked washed out rather than black, and its #0052cc border was
    # brighter than most of the content it framed.
    #
    # Panels here step 000 -> 060606 -> 0a0a0c -> 101014: neutral greys,
    # not blues, so the single cyan accent is the only chroma on screen
    # and carries all the emphasis. The border is a dim grey rather than
    # a saturated blue, for the same reason.
    "dark": Theme(
        key="dark", label="Vantablack",
        bg="#000000", bg_elev="#060606", surface="#0a0a0c", surface_2="#101014",
        border="#1e1e24", text="#f4f6f8", text_muted="#7d838f",
        accent="#00d4ff", accent_2="#0090ff",
        success="#00e676", warning="#ffab00", danger="#ff1744",
        glow="0 0 12px rgba(0, 212, 255, 0.40)",
        shadow="0 0 0 1px rgba(255, 255, 255, 0.05), 0 10px 34px rgba(0, 0, 0, 0.9)",
        plotly_template="plotly_dark", is_dark=True,
    ),
    "neon": Theme(
        key="neon", label="Cyber Blue",
        bg="#020308", bg_elev="#060914", surface="#090d20", surface_2="#0e1530",
        border="#0088ff", text="#f2f7ff", text_muted="#8294b8",
        accent="#00f0ff", accent_2="#2979ff",
        success="#00ff88", warning="#ffc400", danger="#ff0055",
        glow="0 0 14px rgba(0, 240, 255, 0.55)",
        shadow="0 0 0 1px rgba(0, 240, 255, 0.25), 0 8px 32px rgba(0, 100, 255, 0.3)",
        plotly_template="plotly_dark", is_dark=True,
    ),
}

DEFAULT_THEME = "neon"

# Segoe UI ships with Windows and has full Arabic coverage with correct
# shaping, so no webfont download is needed for either language.
FONT_STACK = ('"Segoe UI Variable Text","Segoe UI",-apple-system,'
              '"Noto Sans Arabic",Tahoma,Arial,sans-serif')
MONO_STACK = '"Cascadia Mono","Consolas","SF Mono",monospace'


def get_theme(key: str | None = None) -> Theme:
    return THEMES.get(key or st.session_state.get("theme", DEFAULT_THEME), THEMES[DEFAULT_THEME])


def _rtl_block() -> str:
    """Arabic layout mirroring.

    `.nb-ltr` is applied to every numeric/timestamp/model-key span. Without it
    the bidi algorithm reorders things like "82.3%" and "00:01:24" when they sit
    in an RTL paragraph, which looks like corruption rather than translation.
    """
    return """
    .stApp, [data-testid="stAppViewContainer"] { direction: rtl; }
    [data-testid="stSidebar"] { direction: rtl; }
    [data-testid="stHorizontalBlock"] { flex-direction: row-reverse; }
    [data-testid="stMarkdownContainer"],
    [data-testid="stWidgetLabel"], label, p, h1, h2, h3, h4 { text-align: right; }
    .nb-ltr, .nb-metric-value, .nb-mono, code, pre {
        direction: ltr; unicode-bidi: isolate; text-align: left;
    }
    [data-testid="stMetricValue"] { direction: ltr; unicode-bidi: isolate; }
    """


def inject_theme(theme_key: str | None = None, lang: str | None = None) -> Theme:
    """Emit the full stylesheet. Call once, first thing after set_page_config."""
    th = get_theme(theme_key)
    lang = lang or st.session_state.get("lang", "en")
    neon = th.key == "neon"

    css = f"""
    <style>
    :root {{
      --nb-bg: {th.bg};
      --nb-bg-elev: {th.bg_elev};
      --nb-surface: {th.surface};
      --nb-surface-2: {th.surface_2};
      --nb-border: {th.border};
      --nb-text: {th.text};
      --nb-muted: {th.text_muted};
      --nb-accent: {th.accent};
      --nb-accent-2: {th.accent_2};
      --nb-success: {th.success};
      --nb-warning: {th.warning};
      --nb-danger: {th.danger};
      --nb-glow: {th.glow};
      --nb-shadow: {th.shadow};
      --nb-radius: 14px;
      --nb-radius-sm: 9px;
      --nb-font: {FONT_STACK};
      --nb-mono: {MONO_STACK};
    }}

    html, body, .stApp,
    [data-testid="stAppViewContainer"] {{
      background: var(--nb-bg) !important;
      color: var(--nb-text) !important;
      font-family: var(--nb-font) !important;
    }}
    /* Animated ambient background.
       Two layers, both pointer-events:none and behind everything:
         ::before  a technical grid that drifts slowly, so the surface
                   reads as instrumentation rather than as flat paint.
         ::after   three wide, blurred accent blooms on long offset
                   cycles. The heavy blur is what keeps this ambient --
                   a sharp moving shape would compete with the data.
       Both are GPU-composited transforms/opacity only: no layout, no
       paint of page content, so scrolling and the live video preview
       are unaffected. */
    [data-testid='stAppViewContainer']::before {{
      content:''; position:fixed; inset:-40px; pointer-events:none; z-index:0;
      background-image:
        linear-gradient(color-mix(in srgb, var(--nb-accent) 4%, transparent) 1px, transparent 1px),
        linear-gradient(90deg, color-mix(in srgb, var(--nb-accent) 3%, transparent) 1px, transparent 1px);
      background-size: 38px 38px;
      animation: nb-grid-drift 24s linear infinite;
      will-change: transform;
    }}
    [data-testid='stAppViewContainer']::after {{
      content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
      background:
        radial-gradient(38vmax 38vmax at 12% 18%,
          color-mix(in srgb, var(--nb-accent) 13%, transparent) 0%, transparent 62%),
        radial-gradient(32vmax 32vmax at 88% 26%,
          color-mix(in srgb, var(--nb-accent-2) 12%, transparent) 0%, transparent 60%),
        radial-gradient(42vmax 42vmax at 62% 92%,
          color-mix(in srgb, var(--nb-accent) 9%, transparent) 0%, transparent 66%);
      filter: blur(58px) saturate(120%);
      opacity: .55;
      animation: nb-bloom 34s ease-in-out infinite alternate;
      will-change: transform, opacity;
    }}
    @keyframes nb-grid-drift {{
      from {{ transform: translate3d(0,0,0); }}
      to   {{ transform: translate3d(38px,38px,0); }}
    }}
    @keyframes nb-bloom {{
      0%   {{ transform: translate3d(0,0,0) scale(1);      opacity:.42; }}
      50%  {{ transform: translate3d(2.5%,-2%,0) scale(1.09); opacity:.62; }}
      100% {{ transform: translate3d(-2%,2.5%,0) scale(1.04); opacity:.48; }}
    }}
    /* Anything that animates forever is a liability for users who get
       motion sickness, and the OS already carries their answer. */
    @media (prefers-reduced-motion: reduce) {{
      [data-testid='stAppViewContainer']::before,
      [data-testid='stAppViewContainer']::after {{ animation: none !important; }}
    }}

    [data-testid="stHeader"], [data-testid="stToolbar"] {{
      background: transparent !important;
    }}
    [data-testid="stMainBlockContainer"] {{
      padding-top: 2.2rem; max-width: 1500px;
    }}

    /* ---------------- collapsed control & rail ---------------- */
    [data-testid="collapsedControl"] {{
      background: var(--nb-surface-2) !important;
      border: 1px solid var(--nb-accent) !important;
      border-radius: 8px !important;
      color: var(--nb-accent) !important;
      box-shadow: 0 0 12px rgba(0, 212, 255, 0.35) !important;
      transition: all .15s ease-in-out !important;
      margin: 0.5rem !important;
    }}
    [data-testid="collapsedControl"]:hover {{
      background: var(--nb-accent) !important;
      color: #000000 !important;
      box-shadow: 0 0 18px var(--nb-accent) !important;
      transform: scale(1.04);
    }}
    [data-testid="collapsedControl"] svg {{
      fill: currentColor !important;
    }}

    /* ---------------- sidebar ---------------- */
    [data-testid="stSidebar"] {{
      background: var(--nb-bg-elev) !important;
      border-inline-end: 1px solid var(--nb-border);
      box-shadow: 2px 0 16px rgba(0, 0, 0, 0.5);
    }}
    [data-testid="stSidebar"] * {{ color: var(--nb-text); }}
    [data-testid="stSidebarNav"] a {{
      border-radius: 8px !important;
      margin-bottom: 2px !important;
      transition: all .15s ease !important;
    }}
    [data-testid="stSidebarNav"] a:hover {{
      background: var(--nb-surface-2) !important;
      color: var(--nb-accent) !important;
    }}
    [data-testid="stSidebarNav"] a[aria-current="page"] {{
      background: color-mix(in srgb, var(--nb-accent) 15%, transparent) !important;
      border-inline-start: 3px solid var(--nb-accent) !important;
      color: var(--nb-accent) !important;
    }}

    /* ---------------- typography ---------------- */
    h1, h2, h3, h4 {{ color: var(--nb-text) !important; letter-spacing: -.015em; text-wrap: balance; }}
    h1 {{ font-size: 1.85rem; font-weight: 650; }}
    h2 {{ font-size: 1.28rem; font-weight: 620; }}
    h3 {{ font-size: 1.05rem; font-weight: 600; }}
    a {{ color: var(--nb-accent) !important; }}

    .nb-eyebrow {{
      font-size: .68rem; font-weight: 700; letter-spacing: .16em;
      text-transform: uppercase; color: var(--nb-muted);
      display: block; margin-bottom: .3rem;
    }}
    .nb-mono {{ font-family: var(--nb-mono); font-variant-numeric: tabular-nums; }}

    /* ---------------- panels ---------------- */
    /* Frosted panels. The translucent fill plus backdrop blur is what
       makes the animated background read as depth BEHIND the interface
       rather than as noise competing with it: the blooms are visible
       through the panels but never legible enough to distract from the
       numbers sitting on top. color-mix keeps this one rule correct for
       every theme instead of hard-coding an rgba per palette. */
    .nb-panel {{
      background: color-mix(in srgb, var(--nb-surface) 82%, transparent);
      -webkit-backdrop-filter: blur(14px) saturate(130%);
      backdrop-filter: blur(14px) saturate(130%);
      border: 1px solid var(--nb-border);
      border-radius: var(--nb-radius);
      padding: 1rem 1.15rem;
      box-shadow: var(--nb-shadow);
    }}

    /* Page content must sit above the two fixed background layers, which
       are z-index 0 on the container. Without this the blooms paint over
       the app instead of under it. */
    [data-testid="stMainBlockContainer"],
    [data-testid="stSidebar"] {{
      position: relative;
      z-index: 1;
    }}
    [data-testid="stSidebar"] {{
      background: color-mix(in srgb, var(--nb-bg-elev) 88%, transparent) !important;
      -webkit-backdrop-filter: blur(16px);
      backdrop-filter: blur(16px);
    }}

    /* Top-4 accuracy callout in the sidebar. Deliberately the brightest
       thing in the sidebar: it exists to override the user's instinct to
       judge models by the confidence number drawn on a bounding box. */
    .nb-top4 {{
      background: color-mix(in srgb, var(--nb-accent) 7%, var(--nb-surface));
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
      border: 1px solid color-mix(in srgb, var(--nb-accent) 40%, transparent);
      border-radius: var(--nb-radius-sm);
      padding: .6rem .7rem .5rem;
      margin: .35rem 0 .6rem;
      box-shadow: var(--nb-glow);
    }}
    .nb-top4-title {{
      font-family: var(--nb-mono); font-size: 10.5px; font-weight: 700;
      letter-spacing: .09em; text-transform: uppercase;
      color: var(--nb-accent); margin-bottom: .45rem;
    }}
    .nb-top4-row {{
      display: flex; align-items: center; gap: .45rem;
      padding: .16rem 0; font-size: 12px; line-height: 1.35;
    }}
    .nb-top4-rank {{
      flex: none; width: 15px; height: 15px; border-radius: 4px;
      background: color-mix(in srgb, var(--nb-accent) 22%, transparent);
      color: var(--nb-accent); font-family: var(--nb-mono);
      font-size: 9.5px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center;
    }}
    .nb-top4-name {{
      flex: 1 1 auto; color: var(--nb-text);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }}
    .nb-top4-acc {{
      flex: none; font-family: var(--nb-mono); font-size: 11.5px;
      font-weight: 700; color: var(--nb-success);
    }}
    .nb-top4-note {{
      margin-top: .45rem; padding-top: .4rem;
      border-top: 1px solid color-mix(in srgb, var(--nb-accent) 18%, transparent);
      font-size: 10px; line-height: 1.45; color: var(--nb-muted);
    }}

    /* metric tiles */
    .nb-tile {{
      background: var(--nb-surface) !important;
      border: 1px solid var(--nb-border) !important;
      border-radius: var(--nb-radius) !important;
      padding: .85rem 1.1rem !important;
      box-shadow: var(--nb-shadow) !important;
      box-sizing: border-box !important;
      min-height: 86px !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: center !important;
      overflow: hidden !important;
      transition: all .15s ease !important;
    }}
    .nb-tile:hover {{
      border-color: var(--nb-accent) !important;
      box-shadow: var(--nb-glow) !important;
    }}
    .nb-tile-label {{
      font-size: .72rem !important; font-weight: 700 !important; letter-spacing: .10em !important;
      text-transform: uppercase !important; color: var(--nb-muted) !important;
      white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
      margin: 0 !important;
    }}
    .nb-tile-value {{
      font-family: var(--nb-mono) !important; font-variant-numeric: tabular-nums !important;
      font-size: 1.65rem !important; font-weight: 700 !important; line-height: 1.2 !important;
      margin-top: .25rem !important; color: var(--nb-text) !important;
      direction: ltr !important; unicode-bidi: isolate !important;
      white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important;
    }}
    .nb-tile-sub {{ font-size: .74rem; color: var(--nb-muted); margin-top: .18rem; }}
    .nb-tile.is-success .nb-tile-value {{ color: var(--nb-success) !important; }}
    .nb-tile.is-warning .nb-tile-value {{ color: var(--nb-warning) !important; }}
    .nb-tile.is-danger  .nb-tile-value {{ color: var(--nb-danger) !important; }}
    .nb-tile.is-accent  .nb-tile-value {{ color: var(--nb-accent) !important; }}

    /* status pill */
    .nb-pill {{
      display: inline-flex; align-items: center; gap: .45rem;
      padding: .3rem .7rem; border-radius: 999px;
      font-size: .74rem; font-weight: 650; letter-spacing: .05em;
      border: 1px solid currentColor;
    }}
    .nb-pill .dot {{
      width: .5rem; height: .5rem; border-radius: 50%;
      background: currentColor; flex: none;
    }}
    .nb-pill.safe     {{ color: var(--nb-success); }}
    .nb-pill.warning  {{ color: var(--nb-warning); }}
    .nb-pill.critical {{ color: var(--nb-danger); }}
    .nb-pill.muted    {{ color: var(--nb-muted); }}

    /* alert banner */
    .nb-alert {{
      border-radius: var(--nb-radius);
      padding: .85rem 1.1rem;
      border: 1px solid currentColor;
      display: flex; align-items: center; gap: .75rem;
      font-weight: 600;
      background: color-mix(in srgb, currentColor 12%, transparent);
    }}
    .nb-alert.warning  {{ color: var(--nb-warning); }}
    .nb-alert.critical {{ color: var(--nb-danger); animation: nbpulse 1.1s ease-in-out infinite; }}
    @keyframes nbpulse {{
      0%, 100% {{ box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 45%, transparent); }}
      50%      {{ box-shadow: 0 0 0 10px transparent; }}
    }}
    @media (prefers-reduced-motion: reduce) {{
      .nb-alert.critical {{ animation: none; }}
    }}

    /* legend swatches */
    .nb-swatch {{
      display: inline-block; width: .8rem; height: .8rem;
      border-radius: 4px; vertical-align: -1px; margin-inline-end: .45rem;
    }}

    /* ---------------- streamlit widgets ---------------- */
    [data-testid="stFileUploaderDropzone"] {{
      background: var(--nb-surface-2) !important;
      border: 1.5px dashed var(--nb-border) !important;
      border-radius: var(--nb-radius) !important;
    }}
    [data-testid="stFileUploaderDropzone"]:hover {{ border-color: var(--nb-accent) !important; }}

    .stButton > button, [data-testid="stBaseButton-secondary"],
    [data-testid="stBaseButton-primary"], [data-testid="stDownloadButton"] > button {{
      border-radius: var(--nb-radius-sm) !important;
      border: 1px solid var(--nb-border) !important;
      background: var(--nb-surface-2) !important;
      color: var(--nb-text) !important;
      font-weight: 600 !important;
      transition: border-color .15s ease, transform .08s ease;
    }}
    .stButton > button:hover, [data-testid="stDownloadButton"] > button:hover {{
      border-color: var(--nb-accent) !important;
      {"box-shadow: var(--nb-glow) !important;" if neon else ""}
    }}
    .stButton > button:active {{ transform: translateY(1px); }}
    [data-testid="stBaseButton-primary"] {{
      background: var(--nb-accent) !important;
      color: {"#04121a" if th.is_dark else "#ffffff"} !important;
      border-color: var(--nb-accent) !important;
    }}

    [data-testid="stSelectbox"] div[data-baseweb="select"] > div,
    [data-testid="stTextInput"] input, [data-testid="stNumberInput"] input {{
      background: var(--nb-surface-2) !important;
      border-color: var(--nb-border) !important;
      color: var(--nb-text) !important;
      border-radius: var(--nb-radius-sm) !important;
    }}

    [data-testid="stExpander"] {{
      background: var(--nb-surface) !important;
      border: 1px solid var(--nb-border) !important;
      border-radius: var(--nb-radius) !important;
    }}
    [data-testid="stExpander"] summary {{ color: var(--nb-text) !important; font-weight: 600; }}

    [data-testid="stMetricValue"] {{
      font-family: var(--nb-mono) !important;
      font-variant-numeric: tabular-nums;
      color: var(--nb-text) !important;
    }}
    [data-testid="stMetricLabel"] {{ color: var(--nb-muted) !important; }}

    [data-testid="stProgress"] > div > div > div {{
      background: var(--nb-accent) !important;
    }}
    [data-testid="stDataFrame"] {{
      border: 1px solid var(--nb-border); border-radius: var(--nb-radius-sm);
    }}
    [data-testid="stTabs"] button[role="tab"] {{ color: var(--nb-muted) !important; }}
    [data-testid="stTabs"] button[role="tab"][aria-selected="true"] {{
      color: var(--nb-accent) !important;
    }}
    hr {{ border-color: var(--nb-border) !important; }}

    /* keyboard focus must stay visible in every theme */
    *:focus-visible {{
      outline: 2px solid var(--nb-accent) !important;
      outline-offset: 2px;
    }}

    {_rtl_block() if lang == "ar" else ""}
    </style>
    """
    st.markdown(css, unsafe_allow_html=True)
    return th
