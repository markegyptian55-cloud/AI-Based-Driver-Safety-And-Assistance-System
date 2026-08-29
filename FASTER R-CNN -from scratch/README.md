# Driver Drowsiness Detection — Simplified Faster R-CNN (from scratch)

An educational, from-scratch **object detector** (not a classifier) that finds and
labels drowsiness cues in an image:

- `open_eye`, `closed_eye`, `yawn` (plus an implicit `background` class)

It follows a simplified **Faster R-CNN** design: custom CNN backbone → Region
Proposal Network (RPN) → RoI Align → fully-connected detection head. The driver
*state* (NORMAL / DROWSY / YAWNING) is decided by a **separate** temporal module,
not by the detector itself.

## Pipeline & shapes

```
image [B,3,640,640]
  -> backbone (4 conv blocks, stride 16)      -> feature map [B,256,40,40]
  -> RPN + 14400 anchors                      -> objectness [B,14400], offsets [B,14400,4]
  -> decode + NMS                             -> ~1000 proposals
  -> RoI Align                                -> [N,256,7,7]
  -> detection head (FC)                      -> class [N,4], box refine [N,16]
  -> final detections                         -> boxes + labels + scores
```

Two stages, four losses: `rpn_obj`, `rpn_box`, `det_cls`, `det_box`.

## Project structure

```
driver_drowsiness_detection/
├── data/
│   ├── images/            # imgNNN.jpg
│   ├── labels/            # imgNNN.txt (YOLO format)
│   └── splits/            # train.txt / val.txt / test.txt (auto-generated)
├── models/
│   ├── backbone.py        # custom CNN
│   ├── anchors.py         # anchor generation
│   ├── rpn.py             # RPN + assignment + proposals
│   ├── roi_head.py        # RoI Align + detection head
│   └── faster_rcnn.py     # full detector (ties it together)
├── utils/
│   ├── box_utils.py       # IoU, encode/decode, clip
│   ├── nms.py             # NMS (scratch + torchvision)
│   ├── metrics.py         # AP, mAP, precision/recall/F1, confusion matrix
│   ├── visualization.py   # draw boxes
│   ├── gpu_utils.py       # device selection + memory
│   └── driver_state.py    # temporal NORMAL/DROWSY/YAWNING logic
├── dataset.py             # YOLO dataset + DataLoader + split maker
├── train.py               # training loop (logs 4 losses, saves best.pth)
├── evaluate.py            # validation metrics
├── test.py                # FINAL held-out test metrics -> results/
├── inference.py           # single-image detection
├── webcam.py              # real-time detection
├── config.py              # all constants
├── requirements.txt
└── results/               # test_metrics.json + example images
```

## Setup

```bash
pip install -r requirements.txt
```

## Data

Put images in `data/images/` and YOLO labels in `data/labels/` (one `.txt` per image,
lines: `class_id x_center y_center width height`, all normalized 0–1).
**Check that the class order in `config.CLASS_NAMES` matches your `data.yaml`.**

## Workflow

```
Dataset → 70/15/15 split → train → validate each epoch → save best.pth
        → load best.pth → test.py on unseen test set → metrics + results/
```

```bash
# 1. list GPUs (optional)
python -c "from utils.gpu_utils import list_gpus; list_gpus()"

# 2. train (creates data/splits/*.txt on first run, saves checkpoints/best.pth)
python train.py --device cuda:0 --epochs 30 --batch-size 4

# 3. FINAL test on the held-out split (run once, after training)
python test.py --checkpoint checkpoints/best.pth --device cuda:0

# 4. single image
python inference.py --image data/images/some.jpg --checkpoint checkpoints/best.pth --out result.jpg

# 5. webcam
python webcam.py --checkpoint checkpoints/best.pth --device cuda:0
```

Every module has a `__main__` self-test: e.g. `python models/backbone.py`,
`python models/rpn.py`, `python dataset.py` — run these to verify shapes before training.

## Metrics: why mAP, not accuracy

Classification accuracy assumes one label per image and no location. Detection
must match many predicted boxes to many ground-truth objects and score both the
*label* and the *localization* (IoU) across all confidence levels. **mAP** (mean
Average Precision — area under the precision–recall curve, averaged over classes)
is therefore the standard metric. `test.py` also reports a custom
"detection accuracy" = TP / (TP + FP + FN) for convenience, but mAP is the headline number.

> Note: for a textbook mAP that sweeps all confidences, lower `config.SCORE_THRESH`
> (e.g. to 0.05) before running `test.py`; the default 0.5 is tuned for clean visual demos.
```
