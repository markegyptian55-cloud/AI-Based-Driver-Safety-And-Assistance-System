# Experiment Comparison Summary

Generated from 6 run_config.json file(s) and 21 metrics.json file(s) found on disk.


## Training Runs

| Run | Weights | imgsz | epochs | mAP50 | mAP50-95 | Precision | Recall | Train Time |
|---|---|---|---|---|---|---|---|---|
| yolo11m/1-yolo11m-warmstart-pilot-640 | D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\checkpoints\Fullstack Web App Models\YOLOv11m 640 Worst-Case\2-yolo11m_640_worstcase_run\weights\best.pt | 640 | 15 | 0.9130 | 0.5932 | 0.8213 | 0.8235 | 7.3h |
| yolo11n/1-capacity-yolo11n-960-moderate-aug | yolo11n.pt | 960 | 120 | 0.8857 | 0.5241 | 0.7896 | 0.8301 | 41.0h |
| yolo26n/2-finetune-yolo26n-960-moderate-aug | checkpoints/yolo26n/1-baseline/weights/best.pt | 960 | 50 | 0.8796 | 0.5288 | 0.7862 | 0.8183 | 11.7h |
| yolo26n/3-fresh-yolo26n-640-worst-aug | yolo26n.pt | 640 | 100 | 0.8704 | 0.5130 | 0.7645 | 0.8268 | 10.7h |
| yolo26n/5-cls3-yolo26n-960-moderate-aug | checkpoints/yolo26n/2-finetune-yolo26n-960-moderate-aug/best.pt | 960 | 34 | 0.8885 | 0.5217 | 0.7972 | 0.8248 | 8.1h |
| yolo26n/6-weakdevice-480-worstcase-yolo26n | checkpoints/yolo26n/4-calibration-yolo26n-960-moderate-aug/best.pt | 480 | 25 | 0.8794 | 0.5161 | 0.7896 | 0.8269 | 1.7h |

## Evaluation Results

| Model | mAP50 | Precision | Recall | F1 |
|---|---|---|---|---|
| [OLD] RF-DETR Nano Baseline 384 | 0.7818 | 0.6137 | 0.8647 | 0.7162 |
| [OLD] RF-DETR Nano Fine-Tuned 384 | 0.7829 | 0.6234 | 0.8590 | 0.7210 |
| [OLD] RF-DETR Small Baseline 640 | 0.6529 | 0.6021 | 0.7349 | 0.6602 |
| [OLD] RF-DETR Small Standard 640 | 0.7209 | 0.6077 | 0.7957 | 0.6877 |
| [OLD] RF-DETR Small Worst-Case 384 | 0.7266 | 0.6076 | 0.8139 | 0.6948 |
| yolo11m-warmstart-pilot-640 | 0.8642 | 0.8269 | 0.7382 | 0.7797 |
| [OLD] YOLO11m Worst-Case 384 | 0.7230 | 0.7235 | 0.7119 | 0.7167 |
| [OLD] YOLO11m Trial2 Winner 640 | 0.7394 | 0.7601 | 0.6789 | 0.7153 |
| [OLD] YOLO11m Worst-Case (D18 source) 640 | 0.7563 | 0.7586 | 0.7054 | 0.7295 |
| yolo11n-capacity-960 | 0.8273 | 0.8223 | 0.7193 | 0.7661 |
| [OLD] YOLO11n Baseline 384 | 0.6964 | 0.7671 | 0.6293 | 0.6883 |
| [OLD] YOLO11n Worst-Case DMS 640 | 0.7198 | 0.7451 | 0.6710 | 0.7056 |
| YOLO26n Exp1 Baseline | 0.7955 | 0.7533 | 0.7234 | 0.7379 |
| YOLO26n Exp2 AdamW Fine-tune | 0.8233 | 0.7964 | 0.7348 | 0.7641 |
| YOLO26n Exp3 Fresh Worst-Case 640 | 0.8102 | 0.7895 | 0.6984 | 0.7401 |
| YOLO26n Exp4 Calibration cls1.5 | 0.8234 | 0.7899 | 0.7337 | 0.7606 |
| YOLO26n Exp5 cls3.0 | 0.8179 | 0.7892 | 0.7256 | 0.7559 |
| YOLO26n Weak-Device 480 Worst-Case | 0.8228 | 0.7930 | 0.7231 | 0.7561 |
| [OLD] YOLO26n Nano Baseline 384 | 0.6813 | 0.7289 | 0.6305 | 0.6746 |
| [OLD] YOLO26n Nano Worst-Case 384 | 0.6921 | 0.7059 | 0.6719 | 0.6877 |
| YOLO26s Capacity 960 | 0.8117 | 0.8185 | 0.6407 | 0.7112 |
