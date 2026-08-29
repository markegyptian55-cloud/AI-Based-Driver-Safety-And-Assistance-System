"""
models/rpn.py
-------------
Region Proposal Network + its target assignment, losses, and proposal
generation. All the architecture here is built by hand; only NMS is a utility.

Shapes (with our config): feature map [B,256,40,40], A=9 anchors/cell,
K = 40*40*9 = 14400 anchors.
    objectness : [B, K]      (one logit per anchor)
    deltas     : [B, K, 4]   (tx,ty,tw,th per anchor)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

import config
from utils.box_utils import (box_iou, encode_boxes, decode_boxes,
                             clip_boxes, remove_small_boxes)
from utils.nms import nms


class RPN(nn.Module):
    def __init__(self, in_channels=256, num_anchors=config.NUM_ANCHORS):
        super().__init__()
        self.num_anchors = num_anchors
        # shared 3x3 conv, then two sibling 1x1 conv heads
        self.conv = nn.Conv2d(in_channels, in_channels, kernel_size=3, padding=1)
        self.cls_logits = nn.Conv2d(in_channels, num_anchors, kernel_size=1)      # objectness
        self.bbox_pred = nn.Conv2d(in_channels, num_anchors * 4, kernel_size=1)   # offsets

        for layer in (self.conv, self.cls_logits, self.bbox_pred):
            nn.init.normal_(layer.weight, std=0.01)
            nn.init.constant_(layer.bias, 0)

    def forward(self, features):
        """
        features [B,C,H,W] -> objectness [B,K], deltas [B,K,4]
        with K = H*W*num_anchors, ordered to match generate_anchors().
        """
        B = features.shape[0]
        t = F.relu(self.conv(features))
        obj = self.cls_logits(t)        # [B, A, H, W]
        box = self.bbox_pred(t)         # [B, A*4, H, W]

        # reorder to (h, w, a) so it lines up with the anchor list
        obj = obj.permute(0, 2, 3, 1).reshape(B, -1)          # [B, K]
        box = box.permute(0, 2, 3, 1).reshape(B, -1, 4)       # [B, K, 4]
        return obj, box


# ---------------------------------------------------------------------------
# Anchor target assignment (per image)
# ---------------------------------------------------------------------------
def assign_targets_to_anchors(anchors, gt_boxes):
    """
    Label each anchor: 1 = positive (object), 0 = negative, -1 = ignore.
    Returns (labels [K], matched_gt_boxes [K,4]).
    """
    K = anchors.shape[0]
    device = anchors.device
    if gt_boxes.numel() == 0:
        return torch.zeros(K, device=device), torch.zeros((K, 4), device=device)

    iou = box_iou(anchors, gt_boxes)                 # [K, G]
    max_iou, gt_idx = iou.max(dim=1)                 # best GT for each anchor
    matched = gt_boxes[gt_idx]                       # [K,4]

    labels = torch.full((K,), -1.0, device=device)   # start all "ignore"
    labels[max_iou < config.RPN_NEG_IOU] = 0.0       # clear negatives
    labels[max_iou >= config.RPN_POS_IOU] = 1.0      # clear positives

    # force the best anchor for each GT to be positive (guarantee coverage)
    best_anchor_per_gt = iou.argmax(dim=0)           # [G]
    labels[best_anchor_per_gt] = 1.0
    return labels, matched


def sample_anchors(labels, batch_size, pos_fraction):
    """
    Randomly pick a balanced subset of positives/negatives to compute the loss.
    Returns (pos_idx, neg_idx).
    """
    pos = torch.where(labels == 1)[0]
    neg = torch.where(labels == 0)[0]
    n_pos = min(int(batch_size * pos_fraction), pos.numel())
    n_neg = min(batch_size - n_pos, neg.numel())
    pos = pos[torch.randperm(pos.numel(), device=labels.device)[:n_pos]]
    neg = neg[torch.randperm(neg.numel(), device=labels.device)[:n_neg]]
    return pos, neg


def rpn_loss(objectness, deltas, anchors, targets):
    """
    objectness [B,K], deltas [B,K,4], anchors [K,4],
    targets = list of B dicts with "boxes".
    Returns (obj_loss, box_loss) averaged over the batch.
    """
    B = objectness.shape[0]
    obj_losses, box_losses = [], []

    for b in range(B):
        gt = targets[b]["boxes"].to(anchors.device)
        labels, matched = assign_targets_to_anchors(anchors, gt)
        pos, neg = sample_anchors(labels, config.RPN_BATCH, config.RPN_POS_FRAC)
        sample = torch.cat([pos, neg])

        # objectness: BCE over the sampled anchors
        obj_loss = F.binary_cross_entropy_with_logits(
            objectness[b][sample], labels[sample])
        obj_losses.append(obj_loss)

        # box regression: Smooth L1 on POSITIVE anchors only
        if pos.numel() > 0:
            reg_targets = encode_boxes(matched[pos], anchors[pos])
            box_loss = F.smooth_l1_loss(deltas[b][pos], reg_targets, reduction="sum")
            box_loss = box_loss / sample.numel()     # normalize by #sampled
        else:
            box_loss = deltas.sum() * 0.0
        box_losses.append(box_loss)

    return torch.stack(obj_losses).mean(), torch.stack(box_losses).mean()


# ---------------------------------------------------------------------------
# Proposal generation (per image)
# ---------------------------------------------------------------------------
@torch.no_grad()
def generate_proposals(objectness, deltas, anchors, img_size, training):
    """
    Turn RPN predictions into region proposals for the RoI head.
    Returns a list (length B) of proposal box tensors [P,4].
    """
    B = objectness.shape[0]
    pre_nms = config.RPN_PRE_NMS_TRAIN if training else config.RPN_PRE_NMS_TEST
    post_nms = config.RPN_POST_NMS_TRAIN if training else config.RPN_POST_NMS_TEST

    proposals_batch = []
    for b in range(B):
        scores = torch.sigmoid(objectness[b])           # [K] objectness prob
        boxes = decode_boxes(deltas[b], anchors)         # [K,4]
        boxes = clip_boxes(boxes, img_size)

        keep = remove_small_boxes(boxes, config.RPN_MIN_SIZE)
        boxes, scores = boxes[keep], scores[keep]

        # keep top-N by score BEFORE nms (cheaper)
        n = min(pre_nms, scores.numel())
        top = scores.topk(n).indices
        boxes, scores = boxes[top], scores[top]

        keep = nms(boxes, scores, config.RPN_NMS_IOU)[:post_nms]
        proposals_batch.append(boxes[keep])
    return proposals_batch


if __name__ == "__main__":
    from models.anchors import generate_anchors
    rpn = RPN()
    feat = torch.randn(2, 256, 40, 40)
    obj, box = rpn(feat)
    print("objectness:", tuple(obj.shape), " deltas:", tuple(box.shape))
    assert obj.shape == (2, 14400) and box.shape == (2, 14400, 4)

    anchors = generate_anchors(config.FEATURE_SIZE, config.BACKBONE_STRIDE,
                               config.ANCHOR_SCALES, config.ANCHOR_RATIOS)
    targets = [{"boxes": torch.tensor([[100., 100, 200, 200]])},
               {"boxes": torch.tensor([[50., 60, 90, 120], [300., 300, 360, 380]])}]
    ol, bl = rpn_loss(obj, box, anchors, targets)
    props = generate_proposals(obj, box, anchors, config.IMG_SIZE, training=True)
    print("obj_loss %.4f  box_loss %.4f" % (ol.item(), bl.item()))
    print("proposals per image:", [tuple(p.shape) for p in props])
    print("SELF-TEST PASSED")
