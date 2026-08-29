"""
ADAS overlay renderer -- boxes + HUD burned into the video frame.

PROVENANCE
==========
Vendored 2026-08-14 from `src/demo_video.py` of the parent project
("nano big" driver drowsiness detector). Copied functions, verbatim except
where noted below:

    COLOR_MAP, COLOR_BG, COLOR_TEXT, COLOR_MUTED, COLOR_BORDER, COLOR_CYAN,
    COLOR_BLACK, COLOR_SEPARATOR, ALERT_COLORS, FONT, STATE_HISTORY_SIZE,
    CLASSES, CLASS_SHORT,
    clamp, scale, font_scale, draw_alpha_rect,
    put_text_on_panel, put_text_on_video,
    determine_driver_state, stabilize_driver_state,
    draw_navigation_bar, draw_detection_boxes, render_adas_ui

WHY VENDORED RATHER THAN IMPORTED
---------------------------------
`src/demo_video.py` computes PROJECT_ROOT from its own location and executes
`_load_model_registry()` at *import time*, reading `../configs/checkpoints.yaml`.
Importing it from this folder on another PC would raise or silently yield an
empty registry. It also pulls in `src/inference.py` (module-level `import torch`,
RF-DETR paths, a second unused renderer). This platform is standalone by
requirement, so the drawing functions are copied and the rest left behind.

DEVIATIONS FROM UPSTREAM
------------------------
1. RF-DETR code paths dropped (this platform is YOLO-only).
2. `render_adas_ui`'s unused `source_fps` parameter dropped.
3. Nothing else. Colours, geometry, fonts and layout are byte-identical so
   output frames match the parent project's `demo_video.py` exactly.
"""

from __future__ import annotations

from collections import Counter, deque

import cv2
import numpy as np

# ============================================================
# CLASSES
# ============================================================

CLASSES = ["closed_eye", "open_eye", "yawning"]
CLASS_SHORT = {0: "C", 1: "O", 2: "Y"}

# ============================================================
# SEMANTIC COLOR SYSTEM (BGR)
# ============================================================

COLOR_MAP = {
    0: (45, 55, 235),      # RED    -> closed_eye
    1: (65, 225, 95),      # GREEN  -> open_eye
    2: (0, 180, 255),      # AMBER  -> yawning
}

COLOR_BG        = (12, 15, 20)
COLOR_TEXT      = (210, 215, 220)
COLOR_MUTED     = (120, 130, 140)
COLOR_BORDER    = (55, 70, 65)
COLOR_CYAN      = (220, 200, 60)
COLOR_BLACK     = (0, 0, 0)
COLOR_SEPARATOR = (45, 52, 58)

ALERT_COLORS = {
    "SAFE":     (65, 225, 95),
    "WARNING":  (0, 180, 255),
    "CRITICAL": (45, 55, 235),
}

FONT = cv2.FONT_HERSHEY_DUPLEX   # bolder than SIMPLEX -- holds up better at small sizes under compression
STATE_HISTORY_SIZE = 10


def bgr_to_hex(bgr) -> str:
    """(b,g,r) -> '#rrggbb'. Lets the Plotly charts use the exact box colours."""
    b, g, r = bgr
    return f"#{r:02x}{g:02x}{b:02x}"


CLASS_HEX = {cid: bgr_to_hex(c) for cid, c in COLOR_MAP.items()}
ALERT_HEX = {k: bgr_to_hex(v) for k, v in ALERT_COLORS.items()}


# ============================================================
# UTILITY FUNCTIONS
# ============================================================

def clamp(val, lo, hi):
    return max(lo, min(val, hi))


def scale(base, fw, ref=640):
    return max(1, int(base * fw / ref))


def font_scale(base, fw, ref=640):
    return max(0.25, base * fw / ref)


def draw_alpha_rect(frame, x1, y1, x2, y2, color, alpha=0.82):
    h, w = frame.shape[:2]
    x1, x2 = int(clamp(x1, 0, w)), int(clamp(x2, 0, w))
    y1, y2 = int(clamp(y1, 0, h)), int(clamp(y2, 0, h))
    if x2 <= x1 or y2 <= y1:
        return
    roi = frame[y1:y2, x1:x2]
    overlay = np.full_like(roi, color, dtype=np.uint8)
    cv2.addWeighted(overlay, alpha, roi, 1.0 - alpha, 0, roi)


def put_text_on_panel(frame, text, pos, fscale, color, thickness=1):
    """Text on a solid alpha panel -- no shadow needed, single clean draw."""
    x, y = int(pos[0]), int(pos[1])
    cv2.putText(frame, text, (x, y), FONT, fscale, color, thickness, cv2.LINE_AA)


def put_text_on_video(frame, text, pos, fscale, color, thickness=1):
    """Text directly on raw video -- crisp non-AA drop shadow for legibility."""
    x, y = int(pos[0]), int(pos[1])
    cv2.putText(frame, text, (x + 2, y + 2), FONT, fscale, COLOR_BLACK, thickness + 1, cv2.LINE_8)
    cv2.putText(frame, text, (x, y), FONT, fscale, color, thickness, cv2.LINE_AA)


# ============================================================
# DRIVER STATE LOGIC
# ============================================================

def determine_driver_state(detections):
    if not detections:
        return {"label": "NO DETECTION", "color": COLOR_MUTED, "short": "UNKNOWN"}
    class_ids = [d["class_id"] for d in detections]
    if 2 in class_ids:
        return {"label": "YAWNING DETECTED", "color": COLOR_MAP[2], "short": "WARNING"}
    if 0 in class_ids:
        return {"label": "EYES CLOSED", "color": COLOR_MAP[0], "short": "DROWSY"}
    return {"label": "ATTENTIVE", "color": COLOR_MAP[1], "short": "NORMAL"}


def stabilize_driver_state(current_state, state_history):
    state_history.append(current_state["short"])
    if len(state_history) < 3:
        return current_state
    counts = Counter(state_history)
    stable, _ = counts.most_common(1)[0]
    if stable == "WARNING":
        return {"label": "YAWNING DETECTED", "color": COLOR_MAP[2], "short": "WARNING"}
    if stable == "DROWSY":
        return {"label": "EYES CLOSED", "color": COLOR_MAP[0], "short": "DROWSY"}
    if stable == "NORMAL":
        return {"label": "ATTENTIVE", "color": COLOR_MAP[1], "short": "NORMAL"}
    return current_state


def new_state_history() -> deque:
    return deque(maxlen=STATE_HISTORY_SIZE)


# ============================================================
# 1. NAVIGATION BAR  (customizable position, default top-right)
# ============================================================

def _compute_hud_position(pos: str, fw: int, fh: int, bar_w: int, bar_h: int, pad: int, detections: list[dict] | None = None) -> tuple[int, int]:
    """Computes (bar_x, bar_y) coordinates based on pos mode."""
    pos = (pos or "top-right").lower().strip()
    if pos == "auto" and detections:
        # Check where driver detections are located
        avg_cx = sum((d["x1"] + d["x2"]) / 2.0 for d in detections) / len(detections)
        avg_cy = sum((d["y1"] + d["y2"]) / 2.0 for d in detections) / len(detections)
        # Place HUD in the furthest corner opposite to driver face
        on_right = avg_cx < (fw * 0.55)
        on_top = avg_cy > (fh * 0.45)
        if on_right and on_top:
            return fw - bar_w - pad, pad
        elif on_right and not on_top:
            return fw - bar_w - pad, fh - bar_h - pad
        elif not on_right and on_top:
            return pad, pad
        else:
            return pad, fh - bar_h - pad

    if pos == "top-left":
        return pad, pad
    elif pos == "bottom-right":
        return fw - bar_w - pad, fh - bar_h - pad
    elif pos == "bottom-left":
        return pad, fh - bar_h - pad
    else:  # "top-right" default
        return fw - bar_w - pad, pad


def draw_navigation_bar(frame, driver_state, fps, frame_idx, model_name, detections,
                         fatigue_score, alert_level, hud_pos: str = "top-right"):
    """
    Compact HUD -- 4 rows:
        ADAS - <MODEL>
        (dot) ATTENTIVE
        FATIGUE 12%  SAFE
        FPS 71.0   F00240
    """
    if hud_pos == "off":
        return

    fh, fw = frame.shape[:2]

    pad   = scale(10, fw)
    bar_w = scale(230, fw)
    bar_h = scale(112, fw)
    bar_w = min(bar_w, fw // 2 - pad)
    bar_h = min(bar_h, fh // 2 - pad)

    bar_x, bar_y = _compute_hud_position(hud_pos, fw, fh, bar_w, bar_h, pad, detections)

    draw_alpha_rect(frame, bar_x, bar_y, bar_x + bar_w, bar_y + bar_h, COLOR_BG, alpha=0.82)
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h), COLOR_BORDER, 1, cv2.LINE_AA)

    lx = bar_x + scale(10, fw)
    cy = bar_y + scale(20, fw)
    line_h = scale(26, fw)

    fs_title = font_scale(0.42, fw)
    fs_label = font_scale(0.38, fw)
    fs_small = font_scale(0.34, fw)

    # Row 1: title + model name
    model_short = model_name if len(model_name) <= 18 else model_name[:16] + ".."
    put_text_on_panel(frame, f"ADAS - {model_short}", (lx, cy), fs_title, COLOR_CYAN, 1)
    cy += line_h

    # Row 2: status dot + label
    state_color = driver_state["color"]
    dot_r = max(3, scale(4, fw))
    cv2.circle(frame, (lx + dot_r, cy - scale(3, fw)), dot_r, state_color, -1, cv2.LINE_AA)
    put_text_on_panel(frame, driver_state["label"], (lx + dot_r * 2 + scale(6, fw), cy),
                       fs_label, state_color, 1)
    cy += line_h

    # Row 3: fatigue score + debounced alert
    alert_color = ALERT_COLORS.get(alert_level, COLOR_MUTED)
    put_text_on_panel(frame, f"FATIGUE {int(fatigue_score * 100):3d}%  {alert_level}",
                       (lx, cy), fs_small, alert_color, 1)
    cy += line_h

    # Row 4: FPS + frame counter
    fps_str = f"FPS {fps:04.1f}"
    frm_str = f"F{frame_idx:05d}"
    put_text_on_panel(frame, fps_str, (lx, cy), fs_small, COLOR_MUTED, 1)
    (tw, _), _ = cv2.getTextSize(frm_str, FONT, fs_small, 1)
    put_text_on_panel(frame, frm_str, (bar_x + bar_w - scale(10, fw) - tw, cy), fs_small, COLOR_MUTED, 1)


# ============================================================
# 2. DETECTION BOXES -- raw coordinates + confidence %
# ============================================================

def draw_detection_boxes(frame, detections):
    """Model's actual raw box, with a compact "O 92%" / "C 88%" / "Y 76%" label."""
    if not detections:
        return

    fh, fw = frame.shape[:2]

    for det in detections:
        x1, y1, x2, y2 = det["x1"], det["y1"], det["x2"], det["y2"]
        cls_id = det["class_id"]
        conf_pct = int(det["confidence"] * 100)
        color = COLOR_MAP.get(cls_id, (65, 225, 95))

        rx1 = int(clamp(x1, 0, fw - 1))
        ry1 = int(clamp(y1, 0, fh - 1))
        rx2 = int(clamp(x2, 0, fw - 1))
        ry2 = int(clamp(y2, 0, fh - 1))
        if rx2 <= rx1 or ry2 <= ry1:
            continue

        cv2.rectangle(frame, (rx1, ry1), (rx2, ry2), color, 1, cv2.LINE_AA)

        short = CLASS_SHORT.get(cls_id, "?")
        label = f"{short} {conf_pct}%"
        fs = font_scale(0.34, fw)
        (tw, th), _ = cv2.getTextSize(label, FONT, fs, 1)

        # Place label just above the box; flip below if it would go off-screen
        tx = rx1
        ty = ry1 - 4
        if ty - th < 0:
            ty = ry2 + th + 4

        put_text_on_video(frame, label, (tx, ty), fs, color, 1)


# ============================================================
# 3. MAIN RENDER PIPELINE
# ============================================================

def render_adas_ui(frame, model_name, frame_idx, fps, detections, state_history,
                    fatigue_score, alert_level, hud_pos: str = "top-right"):
    """
    Mutates `frame` in place. Returns the stabilized driver-state dict.

    Visual hierarchy:
      1. Video / driver (untouched)
      2. Detection boxes with class + confidence %
      3. Compact nav bar (positioned via hud_pos, default top-right)
    """
    raw_state    = determine_driver_state(detections)
    driver_state = stabilize_driver_state(raw_state, state_history)

    draw_detection_boxes(frame, detections)
    draw_navigation_bar(frame, driver_state, fps, frame_idx, model_name, detections,
                         fatigue_score, alert_level, hud_pos=hud_pos)

    return driver_state
