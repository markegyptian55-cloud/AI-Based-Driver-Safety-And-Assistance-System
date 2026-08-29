"""
utils/visualization.py
----------------------
Draw detections (boxes + class name + confidence) on an image with OpenCV.
Also draws ground-truth boxes (used by test.py for comparison images).
"""

import cv2
import config

# one BGR color per model label (index 0 = background, unused for drawing)
# label ids follow config.MODEL_LABELS: 1=closed_eye, 2=open_eye, 3=yawn
COLORS = {
    1: (0, 0, 230),      # closed_eye -> red
    2: (0, 200, 0),      # open_eye   -> green
    3: (0, 180, 255),    # yawn       -> orange
}


def draw_detections(img, boxes, labels, scores=None, gt=False):
    """
    img    : BGR numpy image (H,W,3), drawn on in place and returned
    boxes  : [N,4] x1,y1,x2,y2 in this image's pixel space
    labels : [N] model labels (1..3)
    scores : [N] or None (GT boxes have no score)
    gt     : if True, draw dashed-looking thin white boxes for ground truth
    """
    for i in range(len(boxes)):
        x1, y1, x2, y2 = [int(v) for v in boxes[i]]
        lab = int(labels[i])
        name = config.MODEL_LABELS[lab]

        if gt:
            color = (255, 255, 255)
            cv2.rectangle(img, (x1, y1), (x2, y2), color, 1)
            cv2.putText(img, f"GT:{name}", (x1, y2 + 14),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
        else:
            color = COLORS.get(lab, (200, 200, 200))
            cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
            text = name if scores is None else f"{name}: {int(scores[i] * 100)}%"
            (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(img, (x1, y1 - th - 6), (x1 + tw + 2, y1), color, -1)
            cv2.putText(img, text, (x1 + 1, y1 - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    return img
