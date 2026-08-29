# Measured inference latency

**Measured:** 2026-08-22 19:24:46
**GPU:** NVIDIA RTX 2000 Ada Generation (17.18 GB)
**torch:** 2.6.0+cu124 | **CUDA:** 12.4 | **Python:** 3.11.15
**Protocol:** 10 warmup + 50 timed iterations per configuration, CUDA-synchronised, batch size 1.

Latency is forward-pass only on a synthetic tensor of each model's own input size: it excludes pre-processing, post-processing and decoding of real detections, and so is a lower bound on end-to-end pipeline cost. FPS is derived from the median, not the mean.

| Model | Family | Input | Params (M) | Size (MB) | GPU median (ms) | GPU FPS | CPU median (ms) | CPU FPS |
|---|---|---|---|---|---|---|---|---|
| YOLO26n Exp1 Baseline | yolo | 960 | 2.50 | 14.91 | 11.03 | 90.63 | 84.86 | 11.78 |
| YOLO26n Exp2 AdamW Fine-tune | yolo | 960 | 2.50 | 5.20 | 10.69 | 93.55 | 83.67 | 11.95 |
| YOLO26n Exp3 Fresh Worst-Case 640 | yolo | 640 | 2.50 | 5.14 | 21.26 | 47.04 | 169.19 | 5.91 |
| YOLO26n Exp4 Calibration cls1.5 | yolo | 960 | 2.50 | 5.20 | 21.57 | 46.35 | 401.28 | 2.49 |
| YOLO26n Exp5 cls3.0 | yolo | 960 | 2.50 | 5.20 | 10.18 | 98.20 | 88.01 | 11.36 |
| YOLO11n D16 Capacity Test | yolo | 960 | 2.59 | 20.35 | 6.98 | 143.23 | 69.44 | 14.40 |
| YOLO11m D18 Cross-Dataset Warm Start | yolo | 640 | 20.05 | 38.64 | 11.26 | 88.81 | 151.67 | 6.59 |
| YOLO26s Capacity 960 | yolo | 960 | 9.95 | 76.72 | 12.27 | 81.51 | 162.53 | 6.15 |
| YOLO26n Weak-Device 480 Worst-Case | yolo | 480 | 2.50 | 5.11 | 10.29 | 97.20 | 49.75 | 20.10 |
| [OLD] YOLO11n Baseline 384 | yolo | 384 | 2.59 | 5.22 | 7.43 | 134.64 | 30.80 | 32.47 |
| [OLD] YOLO11n Worst-Case DMS 640 | yolo | 640 | 2.59 | 5.22 | 7.18 | 139.29 | 46.59 | 21.47 |
| [OLD] YOLO11m Worst-Case 384 | yolo | 384 | 20.05 | 38.61 | 9.43 | 106.01 | 81.18 | 12.32 |
| [OLD] YOLO11m Trial2 Winner 640 | yolo | 640 | 20.05 | 115.23 | 10.50 | 95.21 | 154.85 | 6.46 |
| [OLD] YOLO11m Worst-Case (D18 source) 640 | yolo | 640 | 20.05 | 38.64 | 10.54 | 94.89 | 154.79 | 6.46 |
| [OLD] YOLO26n Nano Baseline 384 | yolo | 384 | 2.50 | 5.10 | 11.19 | 89.39 | 38.58 | 25.92 |
| [OLD] YOLO26n Nano Worst-Case 384 | yolo | 384 | 2.50 | 5.10 | 10.95 | 91.31 | 40.52 | 24.68 |
| [OLD] RF-DETR Nano Baseline 384 | rfdetr | 384 | 30.15 | 115.22 | 13.90 | 71.96 | 81.33 | 12.30 |
| [OLD] RF-DETR Nano Fine-Tuned 384 | rfdetr | 384 | 30.15 | 115.23 | 11.29 | 88.55 | 81.30 | 12.30 |
| [OLD] RF-DETR Small Baseline 640 | rfdetr | 640 | 32.02 | 122.35 | 18.73 | 53.38 | 170.97 | 5.85 |
| [OLD] RF-DETR Small Standard 640 | rfdetr | 640 | 32.02 | 122.35 | 18.70 | 53.49 | 170.53 | 5.86 |
| [OLD] RF-DETR Small Worst-Case 384 | rfdetr | 384 | 31.63 | 120.85 | 14.18 | 70.53 | 87.63 | 11.41 |
