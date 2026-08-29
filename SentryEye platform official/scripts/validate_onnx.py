#!/usr/bin/env python3
"""
Dataset-based accuracy validation for the SentryEye ONNX exports.

Answers the question the phone cannot: when the 320 and 416 exports disagree
with the 640 reference (or with ground truth), *which conditions* cause it?
Results are sliced by blur, object distance and lighting, because those are the
three variables that actually change inside a moving vehicle.

Usage
-----
    python scripts/validate_onnx.py \
        --model models/best-320.onnx models/best-416.onnx models/best-640.onnx \
        --data datasets/drowsiness/valid \
        --out docs/accuracy

`--data` expects the standard YOLO layout:

    valid/
      images/*.jpg
      labels/*.txt       # class cx cy w h   (normalized)

Outputs `report.json` and `report.md` per model, including a confusion matrix
(with a background row/column for misses and false positives), per-class
precision/recall/F1, per-slice metrics, and the worst failure cases.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover - guidance beats a stack trace
    raise SystemExit("Install OpenCV first:  pip install opencv-python-headless")

try:
    import onnxruntime as ort
except ImportError:  # pragma: no cover
    raise SystemExit("Install ONNX Runtime first:  pip install onnxruntime")


IOU_MATCH = 0.45
CONF_THRESHOLD = 0.35
NMS_IOU = 0.45


# --------------------------------------------------------------------------- #
# Model
# --------------------------------------------------------------------------- #
@dataclass
class Model:
    path: Path
    session: ort.InferenceSession
    imgsz: int
    input_name: str

    @classmethod
    def load(cls, path: Path) -> "Model":
        session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        inp = session.get_inputs()[0]
        imgsz = int(inp.shape[2]) if isinstance(inp.shape[2], int) else 640
        return cls(path=path, session=session, imgsz=imgsz, input_name=inp.name)

    def predict(self, image: np.ndarray) -> list[tuple[int, float, np.ndarray]]:
        """Returns [(class_id, confidence, xyxy_normalized)] for one BGR image."""
        blob, ratio, pad = letterbox(image, self.imgsz)
        out = self.session.run(None, {self.input_name: blob})[0]
        return decode_ultralytics(out, ratio, pad, image.shape[1], image.shape[0], self.imgsz)


def letterbox(image: np.ndarray, size: int) -> tuple[np.ndarray, float, tuple[float, float]]:
    h, w = image.shape[:2]
    ratio = min(size / w, size / h)
    nw, nh = round(w * ratio), round(h * ratio)
    resized = cv2.resize(image, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    dx, dy = (size - nw) // 2, (size - nh) // 2
    canvas[dy : dy + nh, dx : dx + nw] = resized
    rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    blob = np.transpose(rgb, (2, 0, 1))[None]
    return blob, ratio, (dx, dy)


def decode_ultralytics(
    out: np.ndarray,
    ratio: float,
    pad: tuple[float, float],
    orig_w: int,
    orig_h: int,
    size: int,
) -> list[tuple[int, float, np.ndarray]]:
    """Decodes the [1, 4+nc, N] Ultralytics head, then class-aware NMS."""
    pred = out[0]
    if pred.shape[0] < pred.shape[1]:
        pred = pred.T  # -> [N, 4+nc]
    boxes_xywh = pred[:, :4]
    scores = pred[:, 4:]
    class_ids = scores.argmax(axis=1)
    confidences = scores.max(axis=1)
    keep = confidences >= CONF_THRESHOLD
    boxes_xywh, class_ids, confidences = boxes_xywh[keep], class_ids[keep], confidences[keep]
    if not len(boxes_xywh):
        return []

    dx, dy = pad
    cx, cy, bw, bh = boxes_xywh.T
    x1 = (cx - bw / 2 - dx) / ratio
    y1 = (cy - bh / 2 - dy) / ratio
    x2 = (cx + bw / 2 - dx) / ratio
    y2 = (cy + bh / 2 - dy) / ratio
    xyxy = np.stack([x1, y1, x2, y2], axis=1)

    detections: list[tuple[int, float, np.ndarray]] = []
    for cid in np.unique(class_ids):
        mask = class_ids == cid
        idx = nms(xyxy[mask], confidences[mask], NMS_IOU)
        for i in idx:
            box = xyxy[mask][i]
            detections.append(
                (
                    int(cid),
                    float(confidences[mask][i]),
                    np.array(
                        [box[0] / orig_w, box[1] / orig_h, box[2] / orig_w, box[3] / orig_h]
                    ).clip(0, 1),
                )
            )
    return detections


def nms(boxes: np.ndarray, scores: np.ndarray, threshold: float) -> list[int]:
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        if order.size == 1:
            break
        ious = np.array([iou_xyxy(boxes[i], boxes[j]) for j in order[1:]])
        order = order[1:][ious < threshold]
    return keep


def iou_xyxy(a: np.ndarray, b: np.ndarray) -> float:
    iw = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    ih = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = iw * ih
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


# --------------------------------------------------------------------------- #
# Slicing: the part that turns numbers into an action
# --------------------------------------------------------------------------- #
def slice_of(image: np.ndarray, labels: list[tuple[int, np.ndarray]]) -> dict[str, str]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    luma = float(gray.mean()) / 255.0
    # Object "distance" proxy: mean ground-truth box area relative to the frame.
    areas = [float(b[2] * b[3]) for _, b in labels] or [0.0]
    area = sum(areas) / len(areas)
    return {
        "blur": "sharp" if blur_var > 150 else "moderate" if blur_var > 50 else "blurry",
        "lighting": "bright" if luma > 0.55 else "normal" if luma > 0.25 else "dark",
        "distance": "near" if area > 0.05 else "medium" if area > 0.012 else "far",
    }


@dataclass
class Counter:
    tp: int = 0
    fp: int = 0
    fn: int = 0

    def f1(self) -> float:
        p = self.tp / (self.tp + self.fp) if self.tp + self.fp else 0.0
        r = self.tp / (self.tp + self.fn) if self.tp + self.fn else 0.0
        return 2 * p * r / (p + r) if p + r else 0.0

    def as_dict(self) -> dict[str, float]:
        p = self.tp / (self.tp + self.fp) if self.tp + self.fp else 0.0
        r = self.tp / (self.tp + self.fn) if self.tp + self.fn else 0.0
        return {
            "tp": self.tp,
            "fp": self.fp,
            "fn": self.fn,
            "precision": round(p, 4),
            "recall": round(r, 4),
            "f1": round(self.f1(), 4),
        }


@dataclass
class Evaluation:
    num_classes: int
    per_class: dict[int, Counter] = field(default_factory=dict)
    per_slice: dict[str, Counter] = field(default_factory=dict)
    confusion: np.ndarray | None = None
    failures: list[dict] = field(default_factory=list)

    def matrix(self) -> np.ndarray:
        if self.confusion is None:
            # +1 row/column for "background": missed objects and false alarms.
            self.confusion = np.zeros((self.num_classes + 1, self.num_classes + 1), dtype=int)
        return self.confusion


def evaluate(model: Model, images: list[Path], num_classes: int) -> Evaluation:
    ev = Evaluation(num_classes=num_classes)
    matrix = ev.matrix()

    for image_path in images:
        image = cv2.imread(str(image_path))
        if image is None:
            continue
        h, w = image.shape[:2]
        truth = read_labels(image_path, w, h)
        preds = model.predict(image)
        tags = slice_of(image, truth)

        matched_pred: set[int] = set()
        frame_errors: list[str] = []

        for cls, box in truth:
            best, best_iou = -1, IOU_MATCH
            for i, (pcls, _conf, pbox) in enumerate(preds):
                if i in matched_pred:
                    continue
                score = iou_xyxy(box, pbox)
                if score > best_iou:
                    best, best_iou = i, score
            if best >= 0:
                matched_pred.add(best)
                pred_cls = preds[best][0]
                matrix[cls][pred_cls] += 1
                if pred_cls == cls:
                    bump(ev, cls, tags, "tp")
                else:
                    bump(ev, cls, tags, "fn")
                    bump(ev, pred_cls, tags, "fp")
                    frame_errors.append(f"class {cls} predicted as {pred_cls}")
            else:
                matrix[cls][num_classes] += 1  # missed -> background
                bump(ev, cls, tags, "fn")
                frame_errors.append(f"missed class {cls}")

        for i, (pcls, _conf, _pbox) in enumerate(preds):
            if i in matched_pred:
                continue
            matrix[num_classes][pcls] += 1  # background -> false positive
            bump(ev, pcls, tags, "fp")
            frame_errors.append(f"false positive class {pcls}")

        if frame_errors:
            ev.failures.append(
                {"image": image_path.name, "slices": tags, "errors": frame_errors[:6]}
            )

    return ev


def bump(ev: Evaluation, cls: int, tags: dict[str, str], field_name: str) -> None:
    counter = ev.per_class.setdefault(cls, Counter())
    setattr(counter, field_name, getattr(counter, field_name) + 1)
    for key, value in tags.items():
        s = ev.per_slice.setdefault(f"{key}:{value}", Counter())
        setattr(s, field_name, getattr(s, field_name) + 1)


def read_labels(image_path: Path, w: int, h: int) -> list[tuple[int, np.ndarray]]:
    label_path = Path(str(image_path).replace("/images/", "/labels/")).with_suffix(".txt")
    if not label_path.exists():
        return []
    out: list[tuple[int, np.ndarray]] = []
    for line in label_path.read_text().splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        cls, cx, cy, bw, bh = int(parts[0]), *map(float, parts[1:5])
        out.append((cls, np.array([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2])))
    return out


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #
def write_report(out_dir: Path, model: Model, ev: Evaluation, names: list[str]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = model.path.stem
    matrix = ev.matrix().tolist()
    payload = {
        "model": model.path.name,
        "imgsz": model.imgsz,
        "classes": names,
        "confusion_matrix": {
            "rows": names + ["background"],
            "columns": names + ["background"],
            "values": matrix,
        },
        "per_class": {names[c] if c < len(names) else str(c): v.as_dict() for c, v in sorted(ev.per_class.items())},
        "per_slice": {k: v.as_dict() for k, v in sorted(ev.per_slice.items())},
        "failures": ev.failures[:100],
    }
    (out_dir / f"{stem}.json").write_text(json.dumps(payload, indent=2))

    lines = [f"# Accuracy report — {model.path.name} ({model.imgsz}px)", ""]
    lines += ["## Per class", "", "| class | precision | recall | F1 | TP | FP | FN |", "|---|---|---|---|---|---|---|"]
    for cid, counter in sorted(ev.per_class.items()):
        d = counter.as_dict()
        name = names[cid] if cid < len(names) else str(cid)
        lines.append(
            f"| {name} | {d['precision']:.3f} | {d['recall']:.3f} | {d['f1']:.3f} | {d['tp']} | {d['fp']} | {d['fn']} |"
        )
    lines += ["", "## By condition", "", "| slice | precision | recall | F1 |", "|---|---|---|---|"]
    for key, counter in sorted(ev.per_slice.items()):
        d = counter.as_dict()
        lines.append(f"| {key} | {d['precision']:.3f} | {d['recall']:.3f} | {d['f1']:.3f} |")
    lines += ["", "## Confusion matrix (rows = truth, columns = prediction)", ""]
    header = ["truth \\ pred"] + names + ["background"]
    lines.append("| " + " | ".join(header) + " |")
    lines.append("|" + "---|" * len(header))
    for i, row in enumerate(matrix):
        label = (names + ["background"])[i]
        lines.append("| " + " | ".join([label] + [str(v) for v in row]) + " |")
    lines += ["", "## Worst failure cases", ""]
    for failure in ev.failures[:25]:
        slices = ", ".join(f"{k}={v}" for k, v in failure["slices"].items())
        lines.append(f"- `{failure['image']}` ({slices}) — {'; '.join(failure['errors'])}")
    (out_dir / f"{stem}.md").write_text("\n".join(lines) + "\n")
    print(f"wrote {out_dir / f'{stem}.md'}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", nargs="+", required=True, type=Path)
    parser.add_argument("--data", required=True, type=Path, help="Split dir with images/ + labels/")
    parser.add_argument("--out", default=Path("docs/accuracy"), type=Path)
    parser.add_argument(
        "--names",
        nargs="+",
        default=["closed_eye", "open_eye", "yawning"],
        help="Class names in checkpoint order.",
    )
    parser.add_argument("--limit", type=int, default=0, help="Evaluate at most N images.")
    args = parser.parse_args()

    images = sorted((args.data / "images").glob("*.*"))
    if args.limit:
        images = images[: args.limit]
    if not images:
        raise SystemExit(f"No images found under {args.data / 'images'}")
    print(f"{len(images)} images, {len(args.model)} model(s)")

    for path in args.model:
        model = Model.load(path)
        ev = evaluate(model, images, num_classes=len(args.names))
        write_report(args.out, model, ev, args.names)


if __name__ == "__main__":
    main()
