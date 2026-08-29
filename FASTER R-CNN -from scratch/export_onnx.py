"""Export the tuned PyTorch checkpoint to the backend's ONNX contract.

Run from the repository root:

    Backend/.venv/Scripts/python.exe ML/export_onnx.py
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch
import torch.nn.functional as F
from torchvision.ops import roi_align

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PROJECT_ROOT / "Backend"
sys.path.insert(0, str(BACKEND_ROOT))

from app.domain.models.custom_frcnn._geometry import IMG_SIZE
from app.domain.models.custom_frcnn.rpn import generate_proposals
from app.domain.models.faster_rcnn import _build_model


class OnnxDetectionWrapper(torch.nn.Module):
    """Export the learned graph and leave final filtering/NMS to the runtime."""

    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(
        self, images: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        features = self.model.backbone(images)
        anchors = self.model._get_anchors(images.device)
        objectness, rpn_deltas = self.model.rpn(features)
        proposals = generate_proposals(objectness, rpn_deltas, anchors, IMG_SIZE)[0]

        head = self.model.roi_head
        pooled = roi_align(
            features,
            [proposals],
            output_size=(head.roi_size, head.roi_size),
            spatial_scale=head.spatial_scale,
        )
        x = pooled.flatten(1)
        x = F.relu(head.fc1(x))
        x = F.relu(head.fc2(x))
        class_probs = F.softmax(head.cls_score(x), dim=1)
        bbox_deltas = head.bbox_pred(x).view(-1, head.num_classes, 4)
        return proposals, class_probs, bbox_deltas


def load_model(checkpoint_path: Path, score_threshold: float) -> torch.nn.Module:
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    state_dict = checkpoint
    if isinstance(checkpoint, dict):
        for key in ("model", "state_dict", "model_state_dict"):
            if key in checkpoint:
                state_dict = checkpoint[key]
                break
    model = _build_model(score_threshold)
    model.load_state_dict(state_dict)
    model.eval()
    return model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        type=Path,
        default=PROJECT_ROOT / "ML/checkpoints/tuned/best.pth",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "ML/checkpoints/tuned/best.onnx",
    )
    parser.add_argument("--score-threshold", type=float, default=0.5)
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"Checkpoint not found: {args.input}")
    args.output.parent.mkdir(parents=True, exist_ok=True)

    wrapper = OnnxDetectionWrapper(load_model(args.input, args.score_threshold))
    sample = torch.zeros((1, 3, 640, 640), dtype=torch.float32)
    with torch.inference_mode():
        torch.onnx.export(
            wrapper,
            (sample,),
            args.output,
            input_names=["images"],
            output_names=["proposals", "class_probs", "bbox_deltas"],
            dynamic_axes={
                "proposals": {0: "num_proposals"},
                "class_probs": {0: "num_proposals"},
                "bbox_deltas": {0: "num_proposals"},
            },
            opset_version=17,
            dynamo=False,
        )

    import onnx

    exported = onnx.load(str(args.output))
    onnx.checker.check_model(exported)
    print(
        f"Exported and validated: {args.output} ({args.output.stat().st_size:,} bytes)"
    )


if __name__ == "__main__":
    main()
