"""
models/faster_rcnn.py
---------------------
The complete simplified Faster R-CNN detector.

Pipeline:
    image -> backbone -> feature map
          -> RPN (+ anchors) -> proposals
          -> RoI Align + detection head -> class + box

Training mode returns a dict of the FOUR losses:
    rpn_obj_loss, rpn_box_loss, det_cls_loss, det_box_loss
Eval mode returns a list (length B) of detection dicts:
    {"boxes":[D,4], "labels":[D], "scores":[D]}
"""

import torch
import torch.nn as nn

import config
from models.backbone import BackboneCNN
from models.anchors import generate_anchors
from models.rpn import RPN, rpn_loss, generate_proposals
from models.roi_head import RoIHead


class FasterRCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.backbone = BackboneCNN()
        self.rpn = RPN(in_channels=self.backbone.out_channels)
        self.roi_head = RoIHead(in_channels=self.backbone.out_channels,
                                stride=self.backbone.stride)
        self._anchor_cache = None      # anchors depend only on feature size

    def _get_anchors(self, device):
        if self._anchor_cache is None or self._anchor_cache.device != device:
            self._anchor_cache = generate_anchors(
                config.FEATURE_SIZE, config.BACKBONE_STRIDE,
                config.ANCHOR_SCALES, config.ANCHOR_RATIOS, device=device)
        return self._anchor_cache

    def forward(self, images, targets=None):
        features = self.backbone(images)                     # [B,256,40,40]
        anchors = self._get_anchors(images.device)           # [14400,4]

        objectness, deltas = self.rpn(features)              # [B,K], [B,K,4]
        proposals = generate_proposals(objectness, deltas, anchors,
                                       config.IMG_SIZE, self.training)

        if self.training:
            rpn_obj, rpn_box = rpn_loss(objectness, deltas, anchors, targets)
            det_losses = self.roi_head(features, proposals, config.IMG_SIZE, targets)
            return {
                "rpn_obj_loss": rpn_obj,
                "rpn_box_loss": rpn_box,
                "det_cls_loss": det_losses["det_cls_loss"],
                "det_box_loss": det_losses["det_box_loss"],
            }
        else:
            return self.roi_head(features, proposals, config.IMG_SIZE)


if __name__ == "__main__":
    model = FasterRCNN()
    images = torch.randn(2, 3, 640, 640)
    targets = [{"boxes": torch.tensor([[100., 100, 200, 220]]),
                "labels": torch.tensor([2])},
               {"boxes": torch.tensor([[40., 50, 120, 160], [300., 280, 380, 400]]),
                "labels": torch.tensor([1, 3])}]

    model.train()
    losses = model(images, targets)
    print("losses:")
    for k, v in losses.items():
        print(f"  {k:16s} {v.item():.4f}")
    total = sum(losses.values())
    print("  total            %.4f" % total.item())
    total.backward()      # make sure gradients flow through everything

    model.eval()
    with torch.no_grad():
        dets = model(images)
    print("detections per image:", [tuple(d['boxes'].shape) for d in dets])
    n = sum(p.numel() for p in model.parameters())
    print(f"total parameters: {n:,}")
    print("SELF-TEST PASSED")
