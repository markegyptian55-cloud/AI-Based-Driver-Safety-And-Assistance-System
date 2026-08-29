"""
models/anchors.py
-----------------
Generate anchor boxes over the feature map, in IMAGE pixel coordinates.

feature map is FEATURE_SIZE x FEATURE_SIZE (40x40), stride 16.
At each cell we place len(scales)*len(ratios) = 9 anchors.
Total anchors = 40 * 40 * 9 = 14400, returned as [14400, 4] (x1,y1,x2,y2).
"""

import torch


def generate_base_anchors(scales, ratios):
    """
    Build the 9 anchor shapes centered at (0,0).
    scales : box side length in pixels (e.g. [32,64,128])
    ratios : height/width (e.g. [0.5,1.0,2.0])
    returns: [A,4] boxes as [x1,y1,x2,y2] around the origin
    """
    anchors = []
    for scale in scales:
        area = scale * scale
        for ratio in ratios:
            # w*h = area  and  h/w = ratio  ->  w = sqrt(area/ratio)
            w = (area / ratio) ** 0.5
            h = w * ratio
            anchors.append([-w / 2, -h / 2, w / 2, h / 2])
    return torch.tensor(anchors, dtype=torch.float32)      # [A,4]


def generate_anchors(feature_size, stride, scales, ratios, device="cpu"):
    """
    Tile the base anchors across every feature-map cell.
    returns: [feature_size*feature_size*A, 4] in image pixels.
    """
    base = generate_base_anchors(scales, ratios).to(device)          # [A,4]
    A = base.shape[0]

    # center coordinate of each feature-map cell, in image pixels
    shifts = (torch.arange(feature_size, device=device) + 0.5) * stride   # [F]
    cy, cx = torch.meshgrid(shifts, shifts, indexing="ij")          # [F,F] each
    centers = torch.stack([cx.reshape(-1), cy.reshape(-1),
                           cx.reshape(-1), cy.reshape(-1)], dim=1)  # [F*F,4]

    # add each base anchor (centered at 0) to every cell center
    anchors = centers[:, None, :] + base[None, :, :]               # [F*F, A, 4]
    return anchors.reshape(-1, 4)                                   # [F*F*A, 4]


if __name__ == "__main__":
    import config
    anchors = generate_anchors(config.FEATURE_SIZE, config.BACKBONE_STRIDE,
                               config.ANCHOR_SCALES, config.ANCHOR_RATIOS)
    print("total anchors:", anchors.shape)          # [14400, 4]
    print("first 3 anchors:\n", anchors[:3])
    assert anchors.shape == (config.FEATURE_SIZE**2 * config.NUM_ANCHORS, 4)
    print("SELF-TEST PASSED")
