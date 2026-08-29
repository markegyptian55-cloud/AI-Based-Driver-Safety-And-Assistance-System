"""
models/roi_head.py
------------------
Second stage: RoI Align + fully-connected detection head.

Per proposal it predicts:
    class scores : [N, num_classes]        (0 = background)
    box deltas   : [N, num_classes*4]      (class-specific refinement)

RoI Align (torchvision.ops.roi_align) is used as a utility to crop fixed-size
features; the head itself is built by hand.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision.ops import roi_align

import config
from utils.box_utils import box_iou, encode_boxes, decode_boxes, clip_boxes
from utils.nms import nms


class RoIHead(nn.Module):
    def __init__(self, in_channels=256, roi_size=config.ROI_OUTPUT_SIZE,
                 fc_dim=config.ROI_FC_DIM, num_classes=config.NUM_CLASSES,
                 stride=config.BACKBONE_STRIDE):
        super().__init__()
        self.roi_size = roi_size
        self.spatial_scale = 1.0 / stride
        self.num_classes = num_classes

        self.fc1 = nn.Linear(in_channels * roi_size * roi_size, fc_dim)
        self.fc2 = nn.Linear(fc_dim, fc_dim)
        self.cls_score = nn.Linear(fc_dim, num_classes)
        self.bbox_pred = nn.Linear(fc_dim, num_classes * 4)

        nn.init.normal_(self.cls_score.weight, std=0.01)
        nn.init.normal_(self.bbox_pred.weight, std=0.001)
        for l in (self.cls_score, self.bbox_pred):
            nn.init.constant_(l.bias, 0)

    def _forward_head(self, features, proposals_list):
        """RoI Align + FC trunk. Returns class_logits, bbox_deltas for all
        proposals (concatenated in image order)."""
        pooled = roi_align(features, proposals_list,
                           output_size=(self.roi_size, self.roi_size),
                           spatial_scale=self.spatial_scale)        # [sumP,C,7,7]
        x = pooled.flatten(1)
        x = F.relu(self.fc1(x))
        x = F.relu(self.fc2(x))
        return self.cls_score(x), self.bbox_pred(x)

    def forward(self, features, proposals_list, img_size, targets=None):
        if self.training:
            return self._forward_train(features, proposals_list, targets)
        return self._forward_inference(features, proposals_list, img_size)

    # ---- training ----
    def _forward_train(self, features, proposals_list, targets):
        sampled_props, labels_all, reg_targets_all = [], [], []
        for b, props in enumerate(proposals_list):
            gt_boxes = targets[b]["boxes"].to(features.device)
            gt_labels = targets[b]["labels"].to(features.device)
            # add GT boxes into the proposal pool so positives always exist
            props = torch.cat([props, gt_boxes], dim=0) if gt_boxes.numel() else props

            labels, matched = assign_targets_to_proposals(props, gt_boxes, gt_labels)
            pos, neg = sample_proposals(labels, config.ROI_BATCH, config.ROI_POS_FRAC)
            idx = torch.cat([pos, neg])

            sampled_props.append(props[idx])
            labels_all.append(labels[idx])
            reg_targets_all.append(encode_boxes(matched[idx], props[idx]))

        class_logits, bbox_deltas = self._forward_head(features, sampled_props)
        labels_all = torch.cat(labels_all).long()
        reg_targets_all = torch.cat(reg_targets_all)

        cls_loss, box_loss = detection_loss(class_logits, bbox_deltas,
                                            labels_all, reg_targets_all)
        return {"det_cls_loss": cls_loss, "det_box_loss": box_loss}

    # ---- inference ----
    @torch.no_grad()
    def _forward_inference(self, features, proposals_list, img_size):
        counts = [p.shape[0] for p in proposals_list]
        class_logits, bbox_deltas = self._forward_head(features, proposals_list)
        probs = F.softmax(class_logits, dim=1)

        results = []
        cls_chunks = probs.split(counts)
        box_chunks = bbox_deltas.split(counts)
        for props, prob, deltas in zip(proposals_list, cls_chunks, box_chunks):
            results.append(postprocess_detections(props, prob, deltas, img_size))
        return results


# ---------------------------------------------------------------------------
# Proposal target assignment (per image)
# ---------------------------------------------------------------------------
def assign_targets_to_proposals(proposals, gt_boxes, gt_labels):
    """
    Label each proposal with a class (0 = background) and its matched GT box.
    Returns (labels [P], matched_boxes [P,4]).
    """
    P = proposals.shape[0]
    device = proposals.device
    if gt_boxes.numel() == 0:
        return torch.zeros(P, device=device), torch.zeros((P, 4), device=device)

    iou = box_iou(proposals, gt_boxes)               # [P, G]
    max_iou, gt_idx = iou.max(dim=1)
    matched = gt_boxes[gt_idx]
    labels = gt_labels[gt_idx].clone().float()       # tentative class

    # below the FG threshold -> background (label 0)
    bg = (max_iou < config.ROI_FG_IOU)
    labels[bg] = 0.0
    return labels, matched


def sample_proposals(labels, batch_size, pos_fraction):
    """Balanced fg/bg sampling for the detection-head loss."""
    pos = torch.where(labels >= 1)[0]
    neg = torch.where(labels == 0)[0]
    n_pos = min(int(batch_size * pos_fraction), pos.numel())
    n_neg = min(batch_size - n_pos, neg.numel())
    pos = pos[torch.randperm(pos.numel(), device=labels.device)[:n_pos]]
    neg = neg[torch.randperm(neg.numel(), device=labels.device)[:n_neg]]
    return pos, neg


def detection_loss(class_logits, bbox_deltas, labels, reg_targets):
    """
    class_logits [N, C], bbox_deltas [N, C*4], labels [N], reg_targets [N,4].
    Classification loss over ALL sampled proposals; box loss over FOREGROUND
    only, using the deltas belonging to each proposal's true class.
    """
    cls_loss = F.cross_entropy(class_logits, labels)

    fg = torch.where(labels >= 1)[0]
    if fg.numel() > 0:
        N = class_logits.shape[0]
        deltas = bbox_deltas.view(N, -1, 4)                 # [N, C, 4]
        deltas_fg = deltas[fg, labels[fg]]                  # pick true class
        box_loss = F.smooth_l1_loss(deltas_fg, reg_targets[fg], reduction="sum")
        box_loss = box_loss / labels.numel()
    else:
        box_loss = bbox_deltas.sum() * 0.0
    return cls_loss, box_loss


# ---------------------------------------------------------------------------
# Inference post-processing (per image)
# ---------------------------------------------------------------------------
def postprocess_detections(proposals, probs, deltas, img_size,
                           score_thresh=config.SCORE_THRESH,
                           nms_iou=config.DET_NMS_IOU,
                           max_det=config.DETECTIONS_PER_IMG):
    """
    Turn head outputs into final detections.
    Returns dict with boxes [D,4], labels [D], scores [D].
    """
    device = proposals.device
    deltas = deltas.view(-1, config.NUM_CLASSES, 4)
    all_boxes, all_scores, all_labels = [], [], []

    # skip class 0 (background); handle each foreground class separately
    for c in range(1, config.NUM_CLASSES):
        scores_c = probs[:, c]
        keep = scores_c > score_thresh
        if keep.sum() == 0:
            continue
        boxes_c = decode_boxes(deltas[keep, c], proposals[keep])
        boxes_c = clip_boxes(boxes_c, img_size)
        scores_c = scores_c[keep]

        k = nms(boxes_c, scores_c, nms_iou)
        all_boxes.append(boxes_c[k])
        all_scores.append(scores_c[k])
        all_labels.append(torch.full((k.numel(),), c, dtype=torch.long, device=device))

    if not all_boxes:
        return {"boxes": torch.zeros((0, 4), device=device),
                "labels": torch.zeros((0,), dtype=torch.long, device=device),
                "scores": torch.zeros((0,), device=device)}

    boxes = torch.cat(all_boxes)
    scores = torch.cat(all_scores)
    labels = torch.cat(all_labels)
    if scores.numel() > max_det:                       # keep the strongest overall
        top = scores.topk(max_det).indices
        boxes, scores, labels = boxes[top], scores[top], labels[top]
    return {"boxes": boxes, "labels": labels, "scores": scores}


if __name__ == "__main__":
    head = RoIHead()
    features = torch.randn(2, 256, 40, 40)
    proposals = [torch.tensor([[10., 10, 120, 120], [200., 200, 300, 320]]),
                 torch.tensor([[30., 40, 100, 160]])]
    targets = [{"boxes": torch.tensor([[12., 12, 118, 118]]),
                "labels": torch.tensor([2])},
               {"boxes": torch.tensor([[28., 42, 104, 158]]),
                "labels": torch.tensor([1])}]

    head.train()
    losses = head(features, proposals, config.IMG_SIZE, targets)
    print("train losses:", {k: round(v.item(), 4) for k, v in losses.items()})

    head.eval()
    dets = head(features, proposals, config.IMG_SIZE)
    print("inference detections per image:", [tuple(d["boxes"].shape) for d in dets])
    print("SELF-TEST PASSED")
