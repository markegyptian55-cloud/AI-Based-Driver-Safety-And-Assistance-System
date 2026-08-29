"""
utils/nms.py
------------
Non-Maximum Suppression.

`nms_from_scratch` is the educational version (easy to read, slow).
`nms` wraps torchvision.ops.nms (fast, used in training). Both take the same
arguments and return indices of the boxes to KEEP, sorted by score.

NMS is a post-processing utility, not part of the detector architecture --
the architecture (backbone, anchors, RPN, RoI head) is all built by hand.
"""

import torch
from torchvision.ops import nms as tv_nms

from .box_utils import box_iou


def nms_from_scratch(boxes, scores, iou_threshold):
    """
    boxes [N,4], scores [N] -> LongTensor of kept indices.
    Greedy: repeatedly take the highest-scoring box, drop everything that
    overlaps it by more than iou_threshold.
    """
    if boxes.numel() == 0:
        return torch.empty((0,), dtype=torch.long, device=boxes.device)

    order = scores.argsort(descending=True)     # indices, best first
    keep = []
    while order.numel() > 0:
        i = order[0].item()                      # current best
        keep.append(i)
        if order.numel() == 1:
            break
        # IoU of the best box against all the rest
        ious = box_iou(boxes[i].unsqueeze(0), boxes[order[1:]])[0]   # [rest]
        # keep only those that do NOT overlap the best box too much
        order = order[1:][ious <= iou_threshold]
    return torch.tensor(keep, dtype=torch.long, device=boxes.device)


def nms(boxes, scores, iou_threshold):
    """Fast NMS via torchvision. Same signature as nms_from_scratch."""
    if boxes.numel() == 0:
        return torch.empty((0,), dtype=torch.long, device=boxes.device)
    return tv_nms(boxes, scores, iou_threshold)


if __name__ == "__main__":
    # three boxes: two nearly identical (should collapse to one) + one separate
    boxes = torch.tensor([[10, 10, 50, 50],
                          [12, 11, 51, 49],     # overlaps box 0 heavily
                          [100, 100, 140, 140]], dtype=torch.float32)
    scores = torch.tensor([0.9, 0.8, 0.7])

    k1 = nms_from_scratch(boxes, scores, 0.5).tolist()
    k2 = nms(boxes, scores, 0.5).tolist()
    print("scratch keep:", k1)
    print("torchvision keep:", k2)
    assert sorted(k1) == [0, 2]        # box 1 suppressed by box 0
    assert sorted(k2) == [0, 2]
    print("SELF-TEST PASSED")
