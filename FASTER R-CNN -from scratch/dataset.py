"""
dataset.py
----------
Object-detection dataset for the drowsiness project.

Reads YOLO-format labels (one .txt per image, lines of:
    class_id  x_center  y_center  width  height   [all normalized 0..1])
and produces, for each image:

    image  : FloatTensor [3, IMG_SIZE, IMG_SIZE]   (normalized)
    target : dict with
        "boxes"    : FloatTensor [N, 4]  in pixels, [x_min, y_min, x_max, y_max]
        "labels"   : LongTensor  [N]     model labels (background=0, so YOLO id + 1)
        "image_id" : str

Run this file directly (`python dataset.py`) to execute a self-test on
synthetic data -- no real dataset required.
"""

import os
import glob
import random

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image

import config


def random_affine(img_np, boxes, degrees, scale_range, translate, img_size):
    """
    Apply a random rotation + scale + translation to a square image and
    transform the boxes to match. Boxes stay axis-aligned (we take the
    bounding rectangle of each rotated box). Returns (img_np, boxes).
    """
    angle = random.uniform(-degrees, degrees)
    scale = random.uniform(scale_range[0], scale_range[1])
    max_t = translate * img_size
    tx = random.uniform(-max_t, max_t)
    ty = random.uniform(-max_t, max_t)

    center = (img_size / 2.0, img_size / 2.0)
    M = cv2.getRotationMatrix2D(center, angle, scale)   # 2x3
    M[0, 2] += tx
    M[1, 2] += ty

    img_out = cv2.warpAffine(img_np, M, (img_size, img_size),
                             borderValue=(128, 128, 128))

    if len(boxes) > 0:
        n = len(boxes)
        # 4 corners per box: (x1,y1) (x2,y1) (x2,y2) (x1,y2)
        xs = boxes[:, [0, 2, 2, 0]].reshape(-1)
        ys = boxes[:, [1, 1, 3, 3]].reshape(-1)
        ones = np.ones_like(xs)
        pts = np.stack([xs, ys, ones], axis=1)          # [n*4, 3]
        new = pts @ M.T                                 # [n*4, 2]
        new = new.reshape(n, 4, 2)
        x1 = new[:, :, 0].min(axis=1)
        y1 = new[:, :, 1].min(axis=1)
        x2 = new[:, :, 0].max(axis=1)
        y2 = new[:, :, 1].max(axis=1)
        boxes = np.stack([x1, y1, x2, y2], axis=1).astype(np.float32)

    return img_out, boxes


# ---------------------------------------------------------------------------
# Annotation parsing helpers
# ---------------------------------------------------------------------------
def yolo_to_xyxy(yolo_boxes, width, height):
    """
    Convert YOLO normalized (cx, cy, w, h) boxes to pixel (x1, y1, x2, y2).

    yolo_boxes : array-like [N, 4]  (values in 0..1)
    returns    : np.ndarray [N, 4]  (pixel corners)
    """
    b = np.asarray(yolo_boxes, dtype=np.float32).reshape(-1, 4)
    xc = b[:, 0] * width
    yc = b[:, 1] * height
    bw = b[:, 2] * width
    bh = b[:, 3] * height
    x1 = xc - bw / 2.0
    y1 = yc - bh / 2.0
    x2 = xc + bw / 2.0
    y2 = yc + bh / 2.0
    return np.stack([x1, y1, x2, y2], axis=1)


def read_yolo_label(label_path, width, height):
    """
    Read one YOLO .txt file.
    Returns (boxes_xyxy [N,4] float32, labels [N] int64).
    Missing file or empty file -> zero objects.
    """
    if not os.path.exists(label_path):
        return np.zeros((0, 4), np.float32), np.zeros((0,), np.int64)

    boxes, labels = [], []
    with open(label_path, "r") as f:
        for line in f:
            parts = line.split()
            if len(parts) != 5:
                continue  # skip malformed lines
            yolo_id = int(float(parts[0]))
            cx, cy, w, h = map(float, parts[1:])
            boxes.append([cx, cy, w, h])
            labels.append(config.yolo_id_to_model_label(yolo_id))

    if len(boxes) == 0:
        return np.zeros((0, 4), np.float32), np.zeros((0,), np.int64)

    boxes = yolo_to_xyxy(boxes, width, height).astype(np.float32)
    labels = np.asarray(labels, dtype=np.int64)
    return boxes, labels


# ---------------------------------------------------------------------------
# Train / val / test split  (created once, then reused forever)
# ---------------------------------------------------------------------------
def make_splits(images_dir=config.IMAGES_DIR,
                splits_dir=config.SPLITS_DIR,
                ratios=config.SPLIT_RATIOS,
                seed=config.SPLIT_SEED,
                overwrite=False):
    """
    Split image filenames into train/val/test and save them as text files.
    Deterministic (fixed seed) and leak-free (a name lands in exactly one split).
    """
    os.makedirs(splits_dir, exist_ok=True)
    out = {s: os.path.join(splits_dir, f"{s}.txt") for s in ("train", "val", "test")}
    if all(os.path.exists(p) for p in out.values()) and not overwrite:
        print("[make_splits] splits already exist, skipping (use overwrite=True to redo)")
        return out

    names = sorted(os.path.basename(p) for ext in ("*.jpg", "*.jpeg", "*.png")
                   for p in glob.glob(os.path.join(images_dir, ext)))
    if len(names) == 0:
        raise RuntimeError(f"No images found in {images_dir}")

    rng = np.random.default_rng(seed)
    idx = rng.permutation(len(names))
    n = len(names)
    n_tr = int(n * ratios[0])
    n_va = int(n * ratios[1])
    groups = {
        "train": [names[i] for i in idx[:n_tr]],
        "val":   [names[i] for i in idx[n_tr:n_tr + n_va]],
        "test":  [names[i] for i in idx[n_tr + n_va:]],
    }
    for split, path in out.items():
        with open(path, "w") as f:
            f.write("\n".join(groups[split]) + "\n")
    print(f"[make_splits] train={len(groups['train'])} "
          f"val={len(groups['val'])} test={len(groups['test'])}")
    return out


def load_split(split_file):
    """Read a split text file -> list of image filenames."""
    with open(split_file, "r") as f:
        return [ln.strip() for ln in f if ln.strip()]


# ---------------------------------------------------------------------------
# The Dataset
# ---------------------------------------------------------------------------
class DrowsinessDataset(Dataset):
    def __init__(self, image_names, images_dir=config.IMAGES_DIR,
                 labels_dir=config.LABELS_DIR, img_size=config.IMG_SIZE,
                 train=False):
        """
        image_names : list of image filenames (e.g. from load_split)
        train       : if True, apply light augmentation (random horizontal flip)
        """
        self.image_names = list(image_names)
        self.images_dir = images_dir
        self.labels_dir = labels_dir
        self.img_size = img_size
        self.train = train
        self.mean = torch.tensor(config.NORM_MEAN).view(3, 1, 1)
        self.std = torch.tensor(config.NORM_STD).view(3, 1, 1)
        # photometric augmentation (training only); does not move boxes
        self.color_jitter = transforms.ColorJitter(**config.AUG_COLOR_JITTER)

    def __len__(self):
        return len(self.image_names)

    def _label_path(self, image_name):
        stem = os.path.splitext(image_name)[0]
        return os.path.join(self.labels_dir, stem + ".txt")

    def __getitem__(self, i):
        name = self.image_names[i]
        img = Image.open(os.path.join(self.images_dir, name)).convert("RGB")
        W0, H0 = img.size  # PIL gives (width, height)

        # boxes at ORIGINAL pixel scale
        boxes, labels = read_yolo_label(self._label_path(name), W0, H0)

        # --- resize image to a square and scale boxes to match ---
        img = img.resize((self.img_size, self.img_size), Image.BILINEAR)
        if len(boxes) > 0:
            sx = self.img_size / W0
            sy = self.img_size / H0
            boxes[:, [0, 2]] *= sx
            boxes[:, [1, 3]] *= sy

        # --- training augmentation ---
        if self.train:
            # photometric: color jitter (brightness/contrast/saturation/hue) -- boxes unchanged
            img = self.color_jitter(img)

            # geometric: random horizontal flip (box-safe)
            if random.random() < config.AUG_HFLIP_PROB:
                img = img.transpose(Image.FLIP_LEFT_RIGHT)
                if len(boxes) > 0:
                    x1 = boxes[:, 0].copy()
                    x2 = boxes[:, 2].copy()
                    boxes[:, 0] = self.img_size - x2   # new x_min = W - old x_max
                    boxes[:, 2] = self.img_size - x1   # new x_max = W - old x_min

        arr = np.asarray(img, dtype=np.uint8)          # HWC RGB uint8

        # geometric: random affine (rotation + scale + translation), box-aware
        if self.train and random.random() < config.AUG_AFFINE_PROB:
            arr, boxes = random_affine(arr, boxes,
                                       config.AUG_AFFINE_DEG,
                                       config.AUG_AFFINE_SCALE,
                                       config.AUG_AFFINE_TRANS,
                                       self.img_size)

        # --- clip to image and drop degenerate boxes ---
        if len(boxes) > 0:
            boxes[:, 0::2] = boxes[:, 0::2].clip(0, self.img_size)
            boxes[:, 1::2] = boxes[:, 1::2].clip(0, self.img_size)
            keep = (boxes[:, 2] - boxes[:, 0] > 1) & (boxes[:, 3] - boxes[:, 1] > 1)
            boxes, labels = boxes[keep], labels[keep]

        # --- to tensor + normalize ---
        arr = arr.astype(np.float32) / 255.0                   # HWC in [0,1]
        img_t = torch.from_numpy(arr).permute(2, 0, 1)          # CHW
        img_t = (img_t - self.mean) / self.std

        target = {
            "boxes":  torch.as_tensor(boxes,  dtype=torch.float32).reshape(-1, 4),
            "labels": torch.as_tensor(labels, dtype=torch.int64).reshape(-1),
            "image_id": name,
        }
        return img_t, target


def collate_fn(batch):
    """
    Detection images share a size (stackable), but each has a different number
    of boxes -> targets can't be stacked, so we keep them as a list of dicts.
    Returns: images [B,3,H,W], targets (list of B dicts)
    """
    images = torch.stack([b[0] for b in batch], dim=0)
    targets = [b[1] for b in batch]
    return images, targets


# ---------------------------------------------------------------------------
# Self-test on synthetic data (no real dataset needed)
# ---------------------------------------------------------------------------
def _self_test():
    import tempfile
    tmp = tempfile.mkdtemp()
    imgs = os.path.join(tmp, "images")
    lbls = os.path.join(tmp, "labels")
    os.makedirs(imgs); os.makedirs(lbls)

    # make 6 synthetic 800x600 images, each with 1-3 random boxes
    rng = np.random.default_rng(0)
    names = []
    for k in range(6):
        name = f"img{k:03d}.jpg"
        names.append(name)
        Image.fromarray(rng.integers(0, 255, (600, 800, 3), np.uint8)).save(os.path.join(imgs, name))
        with open(os.path.join(lbls, name.replace(".jpg", ".txt")), "w") as f:
            for _ in range(rng.integers(1, 4)):
                cls = rng.integers(0, config.NUM_FG_CLASSES)
                cx, cy = rng.uniform(0.3, 0.7, 2)
                w, h = rng.uniform(0.05, 0.15, 2)
                f.write(f"{cls} {cx:.4f} {cy:.4f} {w:.4f} {h:.4f}\n")

    ds = DrowsinessDataset(names, images_dir=imgs, labels_dir=lbls, train=True)
    loader = DataLoader(ds, batch_size=3, shuffle=True, collate_fn=collate_fn)

    images, targets = next(iter(loader))
    print("images batch :", tuple(images.shape), images.dtype)
    print("images range : [%.2f, %.2f]  (normalized)" % (images.min(), images.max()))
    print("num targets  :", len(targets))
    t0 = targets[0]
    print("target[0] boxes :", tuple(t0["boxes"].shape), t0["boxes"].dtype)
    print("target[0] labels:", t0["labels"].tolist(),
          "->", [config.MODEL_LABELS[l] for l in t0["labels"].tolist()])
    print("box[0] (x1,y1,x2,y2):", [round(v, 1) for v in t0["boxes"][0].tolist()])

    assert images.shape == (3, 3, config.IMG_SIZE, config.IMG_SIZE)
    for t in targets:
        assert t["boxes"].shape[0] == t["labels"].shape[0]
        if t["boxes"].numel():
            assert (t["boxes"][:, 2] > t["boxes"][:, 0]).all()
            assert (t["boxes"][:, 3] > t["boxes"][:, 1]).all()
            assert t["labels"].min() >= 1 and t["labels"].max() <= config.NUM_FG_CLASSES
    print("\nSELF-TEST PASSED")


if __name__ == "__main__":
    _self_test()
