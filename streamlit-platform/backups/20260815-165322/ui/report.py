"""
Driver Safety Scorecard & Clinical Report Generator.
Computes driver safety grades (A+ / A / B / C / F), attention scores,
clinical fatigue risk factors, and exports formatted printable HTML reports.
"""

from __future__ import annotations

import datetime
from typing import Any

import streamlit as st

from ui.i18n import t
from ui.theme import Theme

__all__ = [
    "calculate_driver_score",
    "generate_html_report",
    "get_live_driver_hud_html",
    "render_driver_scorecard_ui",
]


def get_live_driver_hud_html(
    fatigue_score: float,
    alert_level: str,
    remaining_s: float,
    pct: float,
    frame_idx: int,
    event_counts: dict[str, int] | None = None,
    recent_events: list | None = None,
) -> str:
    """Generates the real-time Live Driver Scorecard, Telemetry & Micro-Events HUD."""
    counts = event_counts or {"micro_blink": 0, "micro_sleep": 0, "full_closure": 0, "yawn": 0}
    micro_sleeps = counts.get("micro_sleep", 0)
    full_closures = counts.get("full_closure", 0)
    micro_blinks = counts.get("micro_blink", 0)
    yawns = counts.get("yawn", 0)

    # Dynamic grading based on both current fatigue and cumulative micro-events
    if alert_level == "CRITICAL" or full_closures > 0:
        grade = "F"
        grade_label = "CRITICAL DANGER"
        status_color = "#ff1744"
        rec = "🚨 PULL OVER IMMEDIATELY! Severe drowsiness detected."
        alert_var = "danger"
    elif alert_level == "WARNING" or micro_sleeps > 0:
        grade = "C"
        grade_label = "FATIGUE WARNING"
        status_color = "#ffab00"
        rec = "⚠️ Elevated drowsiness: Take a rest stop soon."
        alert_var = "warning"
    elif fatigue_score > 0.20 or yawns > 0:
        grade = "B"
        grade_label = "MILD FATIGUE"
        status_color = "#00d4ff"
        rec = "☕ Driver vigilance stable. Maintain cabin airflow."
        alert_var = "accent"
    else:
        grade = "A+"
        grade_label = "EXEMPLARY ATTENTION"
        status_color = "#00e676"
        rec = "✅ Driver attention optimal. Road vigilance high."
        alert_var = "success"

    attention_index = max(0, min(100, int(round((1.0 - fatigue_score) * 100 - (micro_sleeps * 8) - (full_closures * 20)))))
    rem_min = int(max(remaining_s, 0) // 60)
    rem_sec = int(max(remaining_s, 0) % 60)
    fatigue_pct = f"{fatigue_score*100:.0f}%"
    status_text = t(f"level.{alert_level}")
    eta_label = t("video.eta")
    fatigue_label = t("m.fatigue")
    status_label = t("m.status")
    frame_label = t("m.frame")

    events_feed_html = ""
    if recent_events:
        items = []
        for ev in recent_events[-3:]:
            kind_label = t(f"event.{ev.kind}")
            sev = ev.severity
            badge_color = "#ff1744" if sev == "critical" else ("#ffab00" if sev == "warning" else "#00d4ff")
            items.append(
                f'<div style="display:flex;justify-content:space-between;align-items:center;padding:0.25rem 0.45rem;background:#151a21;border-radius:4px;font-size:0.75rem;margin-bottom:0.2rem;border-inline-start:3px solid {badge_color};">'
                f'<span style="font-weight:700;color:#ffffff;">⚡ {kind_label}</span>'
                f'<span style="color:var(--nb-muted);font-family:var(--nb-mono);">{ev.duration:.2f}s @ {ev.t_start:.1f}s</span>'
                f'</div>'
            )
        events_feed_html = (
            f'<div style="margin-top:0.4rem;padding:0.5rem;background:#0d1117;border:1px solid var(--nb-border);border-radius:6px;">'
            f'<div style="font-size:0.68rem;font-weight:700;color:var(--nb-accent);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.04em;">⚡ LIVE EVENT STREAM</div>'
            f'{"".join(items)}'
            f'</div>'
        )

    return (
        f'<div style="display:flex;flex-direction:column;gap:0.6rem;">'
        f'<div class="nb-panel" style="padding:0.85rem;border-color:{status_color};box-shadow:0 0 14px {status_color}33;">'
        f'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">'
        f'<div style="display:flex;align-items:center;gap:0.7rem;">'
        f'<div style="font-size:2.2rem;font-weight:900;font-family:var(--nb-mono);color:{status_color};line-height:1;border:2px solid {status_color};border-radius:8px;padding:0.25rem 0.65rem;background:#000;">{grade}</div>'
        f'<div><span class="nb-eyebrow" style="font-size:0.65rem;">LIVE DRIVER RATING</span>'
        f'<div style="font-size:1.02rem;font-weight:800;color:#ffffff;line-height:1.2;">{grade_label}</div></div></div>'
        f'<div style="text-align:right;"><span class="nb-eyebrow" style="font-size:0.65rem;">ATTENTION</span>'
        f'<div style="font-size:1.5rem;font-weight:800;font-family:var(--nb-mono);color:var(--nb-accent);">{attention_index}<span style="font-size:0.85rem;color:var(--nb-muted);">/100</span></div></div></div>'
        f'<div style="font-size:0.76rem;font-weight:600;color:{status_color};background:{status_color}18;border-radius:6px;padding:0.3rem 0.55rem;border:1px solid {status_color}44;">{rec}</div></div>'
        
        # 4-Grid Micro-Events Counters
        f'<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:0.4rem;">'
        f'<div class="nb-tile" style="padding:0.4rem;text-align:center;min-height:55px;"><div style="font-size:0.65rem;color:var(--nb-muted);font-weight:700;">BLINKS</div><div style="font-size:1.1rem;font-weight:800;color:#00e676;">{micro_blinks}</div></div>'
        f'<div class="nb-tile is-{"warning" if micro_sleeps > 0 else "accent"}" style="padding:0.4rem;text-align:center;min-height:55px;"><div style="font-size:0.65rem;font-weight:700;">MICROSLEEP</div><div style="font-size:1.1rem;font-weight:800;color:{"#ffab00" if micro_sleeps > 0 else "var(--nb-text)"};">{micro_sleeps}</div></div>'
        f'<div class="nb-tile is-{"danger" if full_closures > 0 else "accent"}" style="padding:0.4rem;text-align:center;min-height:55px;"><div style="font-size:0.65rem;font-weight:700;">CLOSURE</div><div style="font-size:1.1rem;font-weight:800;color:{"#ff1744" if full_closures > 0 else "var(--nb-text)"};">{full_closures}</div></div>'
        f'<div class="nb-tile" style="padding:0.4rem;text-align:center;min-height:55px;"><div style="font-size:0.65rem;color:var(--nb-muted);font-weight:700;">YAWNS</div><div style="font-size:1.1rem;font-weight:800;color:#ffab00;">{yawns}</div></div>'
        f'</div>'

        # Main Tiles
        f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">'
        f'<div class="nb-tile is-{alert_var}" style="min-height:68px;padding:0.55rem 0.75rem;"><div class="nb-tile-label">{fatigue_label}</div><div class="nb-tile-value" style="font-size:1.3rem;">{fatigue_pct}</div></div>'
        f'<div class="nb-tile is-{alert_var}" style="min-height:68px;padding:0.55rem 0.75rem;"><div class="nb-tile-label">{status_label}</div><div class="nb-tile-value" style="font-size:1.1rem;">{status_text}</div></div></div>'
        f'<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">'
        f'<div class="nb-tile is-accent" style="min-height:68px;padding:0.55rem 0.75rem;"><div class="nb-tile-label">{eta_label}</div><div class="nb-tile-value" style="font-size:1.1rem;">{rem_min}:{rem_sec:02d}</div></div>'
        f'<div class="nb-tile is-accent" style="min-height:68px;padding:0.55rem 0.75rem;"><div class="nb-tile-label">{frame_label}</div><div class="nb-tile-value" style="font-size:1.1rem;">#{frame_idx}</div></div></div>'
        f'{events_feed_html}'
        f'</div>'
    )


def calculate_driver_score(summary: dict, events: list, telemetry: list) -> dict[str, Any]:
    """Computes clinical safety grading and driver scorecard."""
    peak = summary.get("peak_fatigue", 0.0) or 0.0
    mean = summary.get("mean_fatigue", 0.0) or 0.0
    micro_sleeps = summary.get("micro_sleeps", 0)
    full_closures = summary.get("full_closures", 0)
    micro_blinks = summary.get("micro_blinks", 0)
    longest_closure = summary.get("longest_closure_s", 0.0)
    time_crit = summary.get("time_critical_s", 0.0)
    time_warn = summary.get("time_warning_s", 0.0)

    # Calculate 0-100 Driver Attention Index
    penalty = (mean * 50.0) + (micro_sleeps * 8.0) + (full_closures * 20.0) + (time_crit * 3.0)
    attention_score = max(0, min(100, int(round(100.0 - penalty))))

    # Grading matrix
    if full_closures > 0 or time_crit >= 4.0 or peak >= 0.75:
        grade = "F"
        grade_label = "CRITICAL RISK"
        variant = "danger"
        status_color = "#ff1744"
    elif micro_sleeps >= 2 or time_crit > 0 or peak >= 0.60:
        grade = "C"
        grade_label = "MODERATE FATIGUE"
        variant = "warning"
        status_color = "#ffab00"
    elif micro_sleeps == 1 or time_warn >= 3.0 or peak >= 0.40:
        grade = "B"
        grade_label = "MILD FATIGUE"
        variant = "accent"
        status_color = "#00d4ff"
    elif mean <= 0.18 and peak < 0.35:
        grade = "A+"
        grade_label = "EXEMPLARY ATTENTION"
        variant = "success"
        status_color = "#00e676"
    else:
        grade = "A"
        grade_label = "GOOD ATTENTION"
        variant = "success"
        status_color = "#00e676"

    # Action recommendations
    recommendations = []
    if grade in ("F", "C"):
        recommendations.append("🚨 PULL OVER: Immediate 20-minute rest stop required before resuming driving.")
        recommendations.append("❄️ Cabin Environment: Increase air ventilation and lower AC temperature to 20°C.")
    if full_closures > 0 or longest_closure > 1.5:
        recommendations.append(f"⚠️ Prolonged Eye Closures ({longest_closure:.1f}s): High risk of asleep-at-the-wheel collision.")
    if micro_sleeps > 0:
        recommendations.append(f"⏱️ Micro-sleep Episodes ({micro_sleeps} detected): Involuntary lapses in road awareness.")
    if not recommendations:
        recommendations.append("✅ Driver Attention Optimal: Maintained continuous road vigilance throughout test period.")
        recommendations.append("☕ Proactive Hydration: Recommended break every 2 hours of continuous highway driving.")

    return {
        "grade": grade,
        "grade_label": grade_label,
        "variant": variant,
        "status_color": status_color,
        "attention_score": attention_score,
        "peak_fatigue": peak,
        "mean_fatigue": mean,
        "micro_sleeps": micro_sleeps,
        "full_closures": full_closures,
        "micro_blinks": micro_blinks,
        "longest_closure": longest_closure,
        "time_critical": time_crit,
        "time_warning": time_warn,
        "recommendations": recommendations,
    }


def render_driver_scorecard_ui(score: dict, theme: Theme):
    """Renders visual Driver Scorecard HUD card in Streamlit."""
    recs_list = "".join([f"<li style='margin-bottom:0.35rem;'>{r}</li>" for r in score["recommendations"]])
    st.markdown(
        f"""<div class="nb-panel" style="margin-bottom:1.2rem;">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-bottom:1.2rem;border-bottom:1px solid var(--nb-border);padding-bottom:1rem;">
                <div style="display:flex;align-items:center;gap:1.2rem">
                    <div style="font-size:3.2rem;font-weight:900;font-family:var(--nb-mono);color:{score['status_color']};
                                line-height:1;border:2px solid {score['status_color']};border-radius:12px;padding:0.4rem 1.1rem;
                                box-shadow:0 0 16px {score['status_color']}44;background:#000000">
                        {score['grade']}
                    </div>
                    <div>
                        <span class="nb-eyebrow">DRIVER SAFETY SCORECARD</span>
                        <div style="font-size:1.4rem;font-weight:750;color:#ffffff">{score['grade_label']}</div>
                        <div style="font-size:0.85rem;color:var(--nb-muted)">ADAS Driver Vigilance & PERCLOS Evaluation</div>
                    </div>
                </div>
                <div style="text-align:right">
                    <span class="nb-eyebrow">ATTENTION INDEX</span>
                    <div style="font-size:2.4rem;font-weight:800;font-family:var(--nb-mono);color:var(--nb-accent)">
                        {score['attention_score']}<span style="font-size:1.1rem;color:var(--nb-muted)">/100</span>
                    </div>
                </div>
            </div>
            <div style="font-size:0.95rem;font-weight:700;margin-bottom:0.5rem;color:var(--nb-accent)">📋 Clinical Safety Recommendations & Action Plan:</div>
            <ul style="margin:0;padding-inline-start:1.4rem;line-height:1.5;color:var(--nb-text);">
                {recs_list}
            </ul>
        </div>""",
        unsafe_allow_html=True,
    )


def generate_html_report(
    score: dict,
    summary: dict,
    events: list,
    video_name: str,
    model_name: str,
) -> str:
    """Generates a standalone, styled, printable HTML Driver Safety Report."""
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    events_html = ""
    if events:
        rows = "".join([
            f"<tr><td>{e.kind.replace('_', ' ').title()}</td><td>{e.t_start:.2f}s</td><td>{e.t_end:.2f}s</td><td>{e.duration:.2f}s</td><td style='color:{'#ff1744' if e.severity=='critical' else '#ffab00'}'>{e.severity.upper()}</td></tr>"
            for e in events
        ])
        events_html = f"""
        <table class="report-table">
            <thead>
                <tr><th>Event Type</th><th>Start</th><th>End</th><th>Duration</th><th>Severity</th></tr>
            </thead>
            <tbody>{rows}</tbody>
        </table>"""
    else:
        events_html = "<p style='color:#00e676;'>No adverse fatigue events recorded during this session.</p>"

    recs_html = "".join([f"<li>{r}</li>" for r in score["recommendations"]])

    html = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Driver Safety Report - {video_name}</title>
<style>
    body {{
        background: #060913;
        color: #e0e8f5;
        font-family: 'Segoe UI', Arial, sans-serif;
        margin: 0;
        padding: 2rem;
    }}
    .report-card {{
        max-width: 900px;
        margin: 0 auto;
        background: #0b1122;
        border: 1px solid #0066ff;
        border-radius: 12px;
        padding: 2rem;
        box-shadow: 0 0 24px rgba(0, 102, 255, 0.25);
    }}
    .header {{
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #1a2a4d;
        padding-bottom: 1.5rem;
        margin-bottom: 1.5rem;
    }}
    .grade-box {{
        font-size: 3.5rem;
        font-weight: bold;
        color: {score['status_color']};
        border: 3px solid {score['status_color']};
        border-radius: 12px;
        padding: 0.5rem 1.5rem;
        background: #000;
        display: inline-block;
    }}
    .stat-grid {{
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1rem;
        margin: 1.5rem 0;
    }}
    .stat-item {{
        background: #060a17;
        border: 1px solid #1a2a4d;
        border-radius: 8px;
        padding: 1rem;
        text-align: center;
    }}
    .stat-val {{
        font-size: 1.8rem;
        font-weight: bold;
        color: #00d4ff;
        font-family: monospace;
    }}
    .stat-lbl {{
        font-size: 0.75rem;
        text-transform: uppercase;
        color: #889bb5;
        margin-top: 0.25rem;
    }}
    .report-table {{
        width: 100%;
        border-collapse: collapse;
        margin-top: 1rem;
    }}
    .report-table th, .report-table td {{
        padding: 0.6rem;
        border: 1px solid #1a2a4d;
        text-align: left;
    }}
    .report-table th {{
        background: #060a17;
        color: #00d4ff;
    }}
    .btn-print {{
        background: #00d4ff;
        color: #000;
        border: none;
        padding: 0.6rem 1.2rem;
        font-weight: bold;
        border-radius: 6px;
        cursor: pointer;
    }}
    @media print {{
        .btn-print {{ display: none; }}
        body {{ background: #fff; color: #000; }}
        .report-card {{ border: 1px solid #000; background: #fff; box-shadow: none; }}
        .stat-item {{ background: #f0f0f0; border: 1px solid #ccc; }}
        .stat-val {{ color: #000; }}
        .report-table th {{ background: #eee; color: #000; }}
    }}
</style>
</head>
<body>
<div class="report-card">
    <div class="header">
        <div>
            <h1 style="margin:0;color:#00d4ff;font-size:1.6rem;">🚗 ADAS DRIVER SAFETY ASSESSMENT</h1>
            <p style="margin:0.25rem 0 0;color:#889bb5;font-size:0.85rem;">Clinical Fatigue & Vigilance Evaluation Report</p>
            <p style="margin:0.25rem 0 0;color:#889bb5;font-size:0.8rem;">Session Date: {now_str} | Source: {video_name} | AI Model: {model_name}</p>
        </div>
        <button class="btn-print" onclick="window.print()">🖨️ Print / Save PDF</button>
    </div>

    <div style="display:flex;align-items:center;gap:2rem;">
        <div class="grade-box">{score['grade']}</div>
        <div>
            <h2 style="margin:0;color:{score['status_color']};">{score['grade_label']}</h2>
            <p style="margin:0.4rem 0 0;font-size:1.1rem;">Driver Attention Index: <strong>{score['attention_score']}/100</strong></p>
        </div>
    </div>

    <div class="stat-grid">
        <div class="stat-item">
            <div class="stat-val">{score['peak_fatigue']*100:.0f}%</div>
            <div class="stat-lbl">Peak Fatigue</div>
        </div>
        <div class="stat-item">
            <div class="stat-val">{score['mean_fatigue']*100:.0f}%</div>
            <div class="stat-lbl">Average Fatigue</div>
        </div>
        <div class="stat-item">
            <div class="stat-val">{score['micro_sleeps']}</div>
            <div class="stat-lbl">Micro-Sleeps</div>
        </div>
        <div class="stat-item">
            <div class="stat-val">{score['full_closures']}</div>
            <div class="stat-lbl">Full Closures</div>
        </div>
    </div>

    <h3 style="color:#00d4ff;margin-top:1.5rem;">📋 Clinical Directives & Driver Safety Advisory</h3>
    <ul style="line-height:1.6;">
        {recs_html}
    </ul>

    <h3 style="color:#00d4ff;margin-top:1.5rem;">⏱️ Timestamped Clinical Events Log</h3>
    {events_html}

    <div style="margin-top:2rem;border-top:1px solid #1a2a4d;padding-top:1rem;font-size:0.75rem;color:#889bb5;text-align:center;">
        Generated by Antigravity ADAS Safety Analytics Engine &middot; Real-Time PERCLOS & AI Drowsiness Detection
    </div>
</div>
</body>
</html>"""
    return html
