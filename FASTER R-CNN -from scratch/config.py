"""
config.py
---------
Central constants for the whole project. Import from here everywhere so the
numbers stay consistent.
"""

import os

# ----------------------------------------------------------------------------
# Paths
# ----------------------------------------------------------------------------
DATA_DIR    = "data"
IMAGES_DIR  = os.path.join(DATA_DIR, "images")
LABELS_DIR  = os.path.join(DATA_DIR, "labels")
SPLITS_DIR  = os.path.join(DATA_DIR, "splits")
CKPT_DIR    = "checkpoints"
RESULTS_DIR = "results"

# ----------------------------------------------------------------------------
# Image / backbone geometry  (LOCKED)
# ----------------------------------------------------------------------------
IMG_SIZE        = 640
BACKBONE_STRIDE = 16
FEATURE_SIZE    = IMG_SIZE // BACKBONE_STRIDE     # 40

# ----------------------------------------------------------------------------
# Classes  (order must match your YOLO class ids)
# ----------------------------------------------------------------------------
CLASS_NAMES    = ["closed_eye", "open_eye", "yawn"]
NUM_FG_CLASSES = len(CLASS_NAMES)                 # 3
NUM_CLASSES    = NUM_FG_CLASSES + 1              # 4 (0 = background)
MODEL_LABELS   = ["background"] + CLASS_NAMES

def yolo_id_to_model_label(yolo_id: int) -> int:
    return int(yolo_id) + 1

# ----------------------------------------------------------------------------
# Normalization + split
# ----------------------------------------------------------------------------
NORM_MEAN    = (0.5, 0.5, 0.5)
NORM_STD     = (0.5, 0.5, 0.5)
SPLIT_RATIOS = (0.70, 0.15, 0.15)
SPLIT_SEED   = 42

# ----------------------------------------------------------------------------
# Anchors  (4 scales x 4 ratios = 16 anchors per feature-map cell)
# scales are box side-lengths in IMAGE pixels; ratios are height/width.
# Smaller scales (8, 16) added to catch small objects like eyes.
# ----------------------------------------------------------------------------
ANCHOR_SCALES = [8, 16, 32, 64]
ANCHOR_RATIOS = [0.5, 1.0, 2.0, 3.0]
NUM_ANCHORS   = len(ANCHOR_SCALES) * len(ANCHOR_RATIOS)     # 16

# ----------------------------------------------------------------------------
# RPN
# ----------------------------------------------------------------------------
RPN_POS_IOU   = 0.7      # anchor with IoU >= this vs any GT -> positive
RPN_NEG_IOU   = 0.3      # anchor with IoU  < this vs all GT -> negative
RPN_BATCH     = 256      # anchors sampled per image for the loss
RPN_POS_FRAC  = 0.5      # target fraction of positives in that sample
RPN_NMS_IOU   = 0.7      # NMS IoU threshold on proposals
RPN_MIN_SIZE  = 8        # drop proposals smaller than this (pixels)
RPN_PRE_NMS_TRAIN  = 2000
RPN_POST_NMS_TRAIN = 1000
RPN_PRE_NMS_TEST   = 1000
RPN_POST_NMS_TEST  = 300

# ----------------------------------------------------------------------------
# RoI detection head
# ----------------------------------------------------------------------------
ROI_OUTPUT_SIZE = 7      # RoI Align output is 7x7
ROI_FC_DIM      = 1024
ROI_FG_IOU      = 0.5    # proposal with IoU >= this -> foreground
ROI_BG_IOU_HI   = 0.5    # proposal with IoU in [LO,HI) -> background
ROI_BG_IOU_LO   = 0.0
ROI_BATCH       = 128    # proposals sampled per image for the head loss
ROI_POS_FRAC    = 0.25   # target fraction of foreground

# ----------------------------------------------------------------------------
# Inference / detection post-processing
# ----------------------------------------------------------------------------
SCORE_THRESH       = 0.5
DET_NMS_IOU        = 0.4
DETECTIONS_PER_IMG = 50

# ----------------------------------------------------------------------------
# Training
# ----------------------------------------------------------------------------
BATCH_SIZE   = 4
NUM_EPOCHS   = 50
LR           = 0.005
MOMENTUM     = 0.9
WEIGHT_DECAY = 5e-4
LR_STEP      = 20        # (StepLR only) epoch at which LR is decayed
LR_GAMMA     = 0.1       # (StepLR only) decay factor

# Learning-rate scheduler: "plateau" (ReduceLROnPlateau) or "step" (StepLR)
LR_SCHEDULER      = "plateau"
PLATEAU_FACTOR    = 0.5     # multiply LR by this when val mAP plateaus
PLATEAU_PATIENCE  = 3       # epochs with no improvement before reducing
PLATEAU_MIN_LR    = 1e-6    # never go below this LR

# Early stopping: halt if val mAP has not improved for this many epochs.
# Set to 0 to disable. Keep it > PLATEAU_PATIENCE so the LR reductions get a
# chance to help before training gives up.
EARLY_STOP_PATIENCE = 8

# ----------------------------------------------------------------------------
# Data augmentation (training split only)
# ----------------------------------------------------------------------------
AUG_HFLIP_PROB   = 0.5
# photometric (does not move boxes): brightness, contrast, saturation, hue
AUG_COLOR_JITTER = dict(brightness=0.3, contrast=0.3, saturation=0.2, hue=0.02)
# geometric affine (boxes are transformed to match)
AUG_AFFINE_PROB  = 0.5
AUG_AFFINE_DEG   = 8            # random rotation range, +/- degrees
AUG_AFFINE_SCALE = (0.8, 1.2)   # random zoom range
AUG_AFFINE_TRANS = 0.10         # max translation as a fraction of image size
