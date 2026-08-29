"""
Model picker: st.radio with always-visible captions, plus a progressive-
enhancement hover tooltip.

The captions are the reliable info layer -- mAP50 / size / resolution shown
under every option regardless of what Streamlit version this runs on. The
hover tooltip is strictly additive: it reaches into the parent document via
`window.parent.document`, which is the single most version-fragile thing in
this codebase, so it is wrapped defensively and never required for the picker
to be usable.
"""

from __future__ import annotations

import json
from string import Template

import streamlit as st

from .charts import per_class_bar
from .i18n import current_lang, t
from .theme import Theme, get_theme

_HOVER_JS = Template("""
<script>
(function () {
  try {
    const cards = $cards;
    const doc = window.parent.document;
    const labels = doc.querySelectorAll('div[data-testid="stRadio"] label');
    if (!labels || labels.length === 0) return;

    let tip = doc.getElementById('nb-model-tip');
    if (!tip) {
      tip = doc.createElement('div');
      tip.id = 'nb-model-tip';
      tip.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;'
        + 'max-width:280px;padding:10px 12px;border-radius:10px;font-size:12.5px;'
        + 'line-height:1.5;font-family:Segoe UI,sans-serif;display:none;'
        + 'background:$panel;color:$text;border:1px solid $border;'
        + 'box-shadow:0 8px 24px rgba(0,0,0,.35);';
      doc.body.appendChild(tip);
    }

    labels.forEach(function (label, i) {
      if (i >= cards.length || label.dataset.nbHooked) return;
      label.dataset.nbHooked = '1';
      label.addEventListener('mouseenter', function (e) {
        const c = cards[i];
        tip.innerHTML = '<div style="font-weight:700;margin-bottom:4px">' + c.name + '</div>'
          + '<div style="opacity:.85">' + c.note + '</div>'
          + '<div style="margin-top:6px;font-family:Consolas,monospace;opacity:.9">' + c.stats + '</div>';
        tip.style.display = 'block';
      });
      label.addEventListener('mousemove', function (e) {
        tip.style.left = (e.clientX + 16) + 'px';
        tip.style.top = (e.clientY + 12) + 'px';
      });
      label.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
    });
  } catch (err) { /* progressive enhancement only -- never break the page */ }
})();
</script>
""")


def render_model_picker(entries: dict, *, key: str = "model_key", theme: Theme | None = None) -> str | None:
    """Renders the picker, returns the selected key (also stored in session_state)."""
    if not entries:
        st.warning(t("models.missing"))
        return None

    keys = list(entries.keys())
    lang = current_lang()

    st.markdown(f'<span class="nb-eyebrow">{t("side.model")}</span>', unsafe_allow_html=True)
    selected = st.radio(
        t("side.model"),
        options=keys,
        format_func=lambda k: entries[k].display_name,
        captions=[entries[k].short_caption() for k in keys],
        key=key,
        label_visibility="collapsed",
    )

    cards = [
        {
            "name": entries[k].display_name,
            "note": entries[k].note(lang)[:220],
            "stats": entries[k].short_caption(),
        }
        for k in keys
    ]
    th = theme or get_theme()
    import streamlit.components.v1 as components
    components.html(
        _HOVER_JS.safe_substitute(
            cards=json.dumps(cards),
            panel=th.surface, text=th.text, border=th.border,
        ),
        height=1,
    )
    return selected


def render_model_card(entry, theme: Theme) -> None:
    """Full detail panel for the Models page."""
    lang = current_lang()
    st.markdown(f"### {entry.display_name}")
    st.caption(entry.note(lang))

    m = entry.metrics
    cols = st.columns(4)
    cols[0].metric(t("models.map50"), f"{m['map50']*100:.2f}%" if m.get("map50") is not None else "—")
    cols[1].metric(t("models.map50c"), f"{m['map50_corrected']*100:.2f}%" if m.get("map50_corrected") is not None else "—")
    cols[2].metric(t("models.precision"), f"{m['precision']*100:.1f}%" if m.get("precision") is not None else "—")
    cols[3].metric(t("models.recall"), f"{m['recall']*100:.1f}%" if m.get("recall") is not None else "—")

    ap = m.get("ap_per_class_corrected") or m.get("ap_per_class")
    if ap:
        from core.adas_render import CLASS_HEX, CLASSES
        class_hex_by_name = {name: CLASS_HEX[i] for i, name in enumerate(CLASSES)}
        st.plotly_chart(per_class_bar(ap, class_hex_by_name, theme), width='stretch',
                         config={"displayModeBar": False})

    tr = entry.training
    with st.expander(t("models.epochs") + " / " + t("models.optimizer")):
        tcols = st.columns(4)
        tcols[0].markdown(f"**{t('models.epochs')}**  \n{tr.get('epochs') or '—'}")
        tcols[1].markdown(f"**{t('models.res')}**  \n{entry.resolution}px")
        tcols[2].markdown(f"**{t('models.optimizer')}**  \n{tr.get('optimizer') or '—'}")
        hours = tr.get("hours")
        tcols[3].markdown(f"**{t('models.train_time')}**  \n" + (f"{hours:.1f}h" if hours else "—"))
        st.markdown(f"**{t('models.size')}**  \n{entry.size_mb:.1f} MB")
