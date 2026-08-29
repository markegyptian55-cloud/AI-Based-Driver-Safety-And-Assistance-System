"""
inference.py
------------
Run the trained detector on a single image.

Usage:
    python inference.py --image path/to/img.jpg --checkpoint checkpoints/best.pth \
                        --device cuda:0 --out result.jpg
"""

import argparse
import cv2
import numpy as np
import torch

import config
from models.faster_rcnn import FasterRCNN
from utils.gpu_utils import select_device
from utils.visualization import draw_detections


def load_model(checkpoint, device):
    model = FasterRCNN().to(device)
    ckpt = torch.load(checkpoint, map_location=device)
    model.load_state_dict(ckpt["model"])
    model.eval()
    print(f"loaded {checkpoint} (epoch {ckpt.get('epoch','?')})")
    return model


def preprocess(img_bgr):
    """BGR image -> normalized tensor [1,3,640,640] + (scale_x, scale_y) back to original."""
    H0, W0 = img_bgr.shape[:2]
    img = cv2.resize(img_bgr, (config.IMG_SIZE, config.IMG_SIZE))
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    t = torch.from_numpy(img).permute(2, 0, 1)
    mean = torch.tensor(config.NORM_MEAN).view(3, 1, 1)
    std = torch.tensor(config.NORM_STD).view(3, 1, 1)
    t = (t - mean) / std
    scale_x = W0 / config.IMG_SIZE
    scale_y = H0 / config.IMG_SIZE
    return t.unsqueeze(0), (scale_x, scale_y)


@torch.no_grad()
def detect_image(model, img_bgr, device, score_thresh=config.SCORE_THRESH):
    tensor, (sx, sy) = preprocess(img_bgr)
    det = model(tensor.to(device))[0]                 # dict for the single image

    boxes = det["boxes"].cpu().numpy()
    labels = det["labels"].cpu().numpy()
    scores = det["scores"].cpu().numpy()

    keep = scores >= score_thresh
    boxes, labels, scores = boxes[keep], labels[keep], scores[keep]

    # scale boxes from 640x640 model space back to the original image size
    boxes[:, [0, 2]] *= sx
    boxes[:, [1, 3]] *= sy
    return boxes, labels, scores


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--checkpoint", default=f"{config.CKPT_DIR}/best.pth")
    ap.add_argument("--device", default=None)
    ap.add_argument("--out", default="result.jpg")
    ap.add_argument("--score", type=float, default=config.SCORE_THRESH)
    args = ap.parse_args()

    device = select_device(args.device)
    model = load_model(args.checkpoint, device)

    img = cv2.imread(args.image)
    if img is None:
        raise FileNotFoundError(args.image)

    boxes, labels, scores = detect_image(model, img, device, args.score)
    for lab, sc in zip(labels, scores):
        print(f"  {config.MODEL_LABELS[int(lab)]}: {int(sc*100)}%")

    draw_detections(img, boxes, labels, scores)
    cv2.imwrite(args.out, img)
    print(f"saved -> {args.out}")


if __name__ == "__main__":
    main()
