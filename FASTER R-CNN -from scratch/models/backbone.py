"""
models/backbone.py
------------------
Custom CNN backbone (built from scratch -- no pretrained weights).

Turns an input image into a spatial feature map:

    image [B, 3, 640, 640]  ->  features [B, 256, 40, 40]

It is 4 convolutional blocks, each halving the spatial size, so the total
downsampling factor (the "stride") is 2^4 = 16. That matches
config.BACKBONE_STRIDE and gives a 40x40 feature map that the RPN and RoI
head are built around.

The module exposes two attributes the rest of the model relies on:
    out_channels : channels of the output feature map (256)
    stride       : total downsampling factor (16)
"""

import torch
import torch.nn as nn

import config


def conv_block(in_ch, out_ch):
    """
    One backbone stage: two 3x3 conv-BN-ReLU layers, then a 2x2 max-pool that
    halves the spatial resolution. Padding keeps H/W the same until the pool.
    """
    return nn.Sequential(
        nn.Conv2d(in_ch, out_ch, kernel_size=3, padding=1),
        nn.BatchNorm2d(out_ch),
        nn.ReLU(inplace=True),
        nn.Conv2d(out_ch, out_ch, kernel_size=3, padding=1),
        nn.BatchNorm2d(out_ch),
        nn.ReLU(inplace=True),
        nn.MaxPool2d(kernel_size=2, stride=2),   # <- halves H and W
    )


class BackboneCNN(nn.Module):
    def __init__(self):
        super().__init__()
        # channels: 3 -> 64 -> 128 -> 256 -> 256   (4 blocks -> stride 16)
        self.block1 = conv_block(3,   64)     # 640 -> 320
        self.block2 = conv_block(64,  128)    # 320 -> 160
        self.block3 = conv_block(128, 256)    # 160 ->  80
        self.block4 = conv_block(256, 256)    #  80 ->  40

        self.out_channels = 256
        self.stride = config.BACKBONE_STRIDE   # 16

        # sensible weight init for conv/bn layers
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
            elif isinstance(m, nn.BatchNorm2d):
                nn.init.constant_(m.weight, 1)
                nn.init.constant_(m.bias, 0)

    def forward(self, x):
        """x [B,3,H,W] -> features [B,256,H/16,W/16]."""
        x = self.block1(x)
        x = self.block2(x)
        x = self.block3(x)
        x = self.block4(x)
        return x


if __name__ == "__main__":
    net = BackboneCNN()
    dummy = torch.randn(2, 3, config.IMG_SIZE, config.IMG_SIZE)
    feats = net(dummy)
    print("input  :", tuple(dummy.shape))
    print("features:", tuple(feats.shape))
    print("out_channels:", net.out_channels, "| stride:", net.stride)

    expected = (2, 256, config.FEATURE_SIZE, config.FEATURE_SIZE)
    assert tuple(feats.shape) == expected, f"expected {expected}, got {tuple(feats.shape)}"
    n = sum(p.numel() for p in net.parameters())
    print(f"total parameters: {n:,}")
    print("SELF-TEST PASSED")
