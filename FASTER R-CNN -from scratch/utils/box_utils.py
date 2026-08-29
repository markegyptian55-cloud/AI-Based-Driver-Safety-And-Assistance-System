"""
utils/box_utils.py
------------------
Core box math, implemented from scratch (IoU, encode/decode).
All boxes are [..., 4] in pixel corner format [x_min, y_min, x_max, y_max].
"""

import torch


def box_area(boxes):
    """Area of each box. boxes [N,4] -> [N]."""
    return (boxes[:, 2] - boxes[:, 0]).clamp(min=0) * (boxes[:, 3] - boxes[:, 1]).clamp(min=0)


def box_iou(boxes1, boxes2):
    """
    IoU between every box in boxes1 and every box in boxes2.
        boxes1 [N,4], boxes2 [M,4]  ->  iou [N,M]

    IoU = intersection_area / (area1 + area2 - intersection_area)
    """
    area1 = box_area(boxes1)                     # [N]
    area2 = box_area(boxes2)                     # [M]

    # intersection rectangle: max of the top-left corners, min of bottom-right
    lt = torch.max(boxes1[:, None, :2], boxes2[None, :, :2])   # [N,M,2]
    rb = torch.min(boxes1[:, None, 2:], boxes2[None, :, 2:])   # [N,M,2]
    wh = (rb - lt).clamp(min=0)                                # [N,M,2] (0 if no overlap)
    inter = wh[:, :, 0] * wh[:, :, 1]                          # [N,M]

    union = area1[:, None] + area2[None, :] - inter
    return inter / union.clamp(min=1e-6)


def encode_boxes(gt_boxes, anchors, weights=(1.0, 1.0, 1.0, 1.0)):
    """
    Turn ground-truth boxes into regression targets (tx, ty, tw, th)
    relative to their matched anchors.
        gt_boxes [K,4], anchors [K,4]  ->  deltas [K,4]
    """
    wx, wy, ww, wh = weights
    # convert corner -> center/size
    a_w = anchors[:, 2] - anchors[:, 0]
    a_h = anchors[:, 3] - anchors[:, 1]
    a_cx = anchors[:, 0] + 0.5 * a_w
    a_cy = anchors[:, 1] + 0.5 * a_h

    g_w = gt_boxes[:, 2] - gt_boxes[:, 0]
    g_h = gt_boxes[:, 3] - gt_boxes[:, 1]
    g_cx = gt_boxes[:, 0] + 0.5 * g_w
    g_cy = gt_boxes[:, 1] + 0.5 * g_h

    tx = wx * (g_cx - a_cx) / a_w
    ty = wy * (g_cy - a_cy) / a_h
    tw = ww * torch.log(g_w / a_w)
    th = wh * torch.log(g_h / a_h)
    return torch.stack([tx, ty, tw, th], dim=1)


def decode_boxes(deltas, anchors, weights=(1.0, 1.0, 1.0, 1.0)):
    """
    Apply predicted offsets to anchors to get boxes (inverse of encode_boxes).
        deltas [K,4], anchors [K,4]  ->  boxes [K,4]
    """
    wx, wy, ww, wh = weights
    a_w = anchors[:, 2] - anchors[:, 0]
    a_h = anchors[:, 3] - anchors[:, 1]
    a_cx = anchors[:, 0] + 0.5 * a_w
    a_cy = anchors[:, 1] + 0.5 * a_h

    tx = deltas[:, 0] / wx
    ty = deltas[:, 1] / wy
    tw = deltas[:, 2] / ww
    th = deltas[:, 3] / wh

    # clamp tw,th so exp() can't explode on an untrained network
    tw = torch.clamp(tw, max=4.0)
    th = torch.clamp(th, max=4.0)

    cx = tx * a_w + a_cx
    cy = ty * a_h + a_cy
    w = torch.exp(tw) * a_w
    h = torch.exp(th) * a_h

    x1 = cx - 0.5 * w
    y1 = cy - 0.5 * h
    x2 = cx + 0.5 * w
    y2 = cy + 0.5 * h
    return torch.stack([x1, y1, x2, y2], dim=1)


def clip_boxes(boxes, img_size):
    """Clamp box coordinates to lie inside a square image of side img_size."""
    boxes = boxes.clone()
    boxes[:, 0::2] = boxes[:, 0::2].clamp(0, img_size)
    boxes[:, 1::2] = boxes[:, 1::2].clamp(0, img_size)
    return boxes


def remove_small_boxes(boxes, min_size):
    """Return a boolean keep-mask for boxes with both sides >= min_size."""
    w = boxes[:, 2] - boxes[:, 0]
    h = boxes[:, 3] - boxes[:, 1]
    return (w >= min_size) & (h >= min_size)
