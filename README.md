<div align="center">

🚘 SentryEye

AI-Powered Driver Safety & Assistance System (ADAS)

Real-time edge AI for driver drowsiness, distraction, and fatigue-risk detection

<p>
  <a href="https://sharp-gaze-platform.lovable.app">
    <img src="https://img.shields.io/badge/🌐_Live_Web_Product-Open%20Platform-111827?style=for-the-badge" alt="Live Web Product">
  </a>
  <a href="https://dashboard-grad-project.vercel.app">
    <img src="https://img.shields.io/badge/📊_Project_Dashboard-Open%20Dashboard-111827?style=for-the-badge" alt="Project Dashboard">
  </a>
  <a href="https://github.com/markegyptian55-cloud/AI-Based-Driver-Safety-And-Assistance-System">
    <img src="https://img.shields.io/badge/💻_Source-GitHub-111827?style=for-the-badge&logo=github" alt="GitHub Repository">
  </a>
</p>

<p>
  <img src="https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python 3.11">
  <img src="https://img.shields.io/badge/PyTorch-2.x-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white" alt="PyTorch">
  <img src="https://img.shields.io/badge/Ultralytics-YOLO26-FF6F00?style=for-the-badge" alt="YOLO26">
  <img src="https://img.shields.io/badge/Streamlit-Local_App-FF4B4B?style=for-the-badge&logo=streamlit&logoColor=white" alt="Streamlit">
  <img src="https://img.shields.io/badge/WebGPU%20%2F%20WASM-Edge_Web-00599C?style=for-the-badge&logo=webassembly&logoColor=white" alt="WebGPU / WASM">
</p>

<p>
  <img src="https://img.shields.io/badge/Dataset-50%2C654_Images-4285F4?style=flat-square&logo=googledrive&logoColor=white" alt="Dataset">
  <img src="https://img.shields.io/badge/Certified_Boxes-68%2C292-2563EB?style=flat-square" alt="Certified Boxes">
  <img src="https://img.shields.io/badge/Experiments-21%2B-7C3AED?style=flat-square" alt="Experiments">
  <img src="https://img.shields.io/badge/GPU_Hours-277.57-DB2777?style=flat-square" alt="GPU Hours">
  <img src="https://img.shields.io/badge/Test_mAP%4050-81.02%25-16A34A?style=flat-square" alt="Test mAP">
  <img src="https://img.shields.io/badge/Edge_Footprint-5.14_MB-16A34A?style=flat-square" alt="Edge Footprint">
</p>

Production winner: YOLO26n @ 640×640 — 81.02% test mAP@50, 47.0 FPS on GPU (batch-1, forward-pass), ~5.14 MB deployable footprint — chosen for the best size ↔ speed ↔ accuracy balance, not for topping any single leaderboard number.

<p>
  <b>🎯 Computer Vision</b> ·
  <b>⚡ Edge AI</b> ·
  <b>🧠 Deep Learning</b> ·
  <b>📹 Driver Monitoring</b> ·
  <b>🛡️ ADAS</b>
</p>

</div>

✨ What Is SentryEye?

SentryEye is an end-to-end driver monitoring and safety system designed to detect visual fatigue signals in real time and convert frame-level computer-vision detections into temporal risk intelligence.

Instead of treating every frame independently, the system combines:

👁️ Eye-state detection — open_eye / closed_eye

🥱 Yawn detection — yawning

⏱️ Temporal fatigue analysis — PERCLOS + yawn duration/frequency

🛡️ Risk scoring — multi-level driver-threat logic

🚨 Real-time alerts — audio + visual feedback

⚡ Edge deployment — native Python plus browser-side WebGPU/WASM paths

The project was developed as an empirical research and engineering journey across 21+ model experiments, explicitly optimizing the accuracy ↔ latency ↔ model-size trade-off for practical deployment.

🧭 Quick Navigation

Section

Jump

🎯 Product overview

What Is SentryEye?

🏗️ Architecture

System Architecture

📊 Benchmarks

Pareto Frontier

🔬 Experiments

Research Journey

🗄️ Dataset

Certified Dataset

🚀 Run locally

Quick Start

🌐 Live products

Live Ecosystem

🧪 Evaluation

Evaluation Pipeline

📁 Repository

Repository Anatomy

👤 Creator

About the Creator

📚 References

Academic Grounding

🌐 Live Ecosystem

<div align="center">

Product

Stack

Status

🚀 SentryEye Web Platform

React 18 + Vite + ONNX Runtime Web + WebGPU/WASM

🟢 Live

📊 Project Dashboard

Next.js / React

🟢 Live

🗄️ Certified Dataset

50,654 images + 68,292 YOLO boxes

🟢 Available

💻 Source Repository

Python 3.11 + Ultralytics + PyAV + Streamlit

🟢 Public

<br>

<a href="https://sharp-gaze-platform.lovable.app">
  <img src="https://img.shields.io/badge/🚀_OPEN_SENTRYEYE_WEB_PLATFORM-2563EB?style=for-the-badge" alt="Open SentryEye Web Platform">
</a>

<a href="https://dashboard-grad-project.vercel.app">
  <img src="https://img.shields.io/badge/📊_OPEN_PROJECT_DASHBOARD-4F46E5?style=for-the-badge" alt="Open Project Dashboard">
</a>

<a href="https://drive.google.com/drive/folders/126mrDWhsI_PmlOLjTomMWSjUjySS6XxT?usp=drive_link">
  <img src="https://img.shields.io/badge/🗄️_OPEN_CERTIFIED_DATASET-16A34A?style=for-the-badge" alt="Open Dataset">
</a>

</div>

🧠 System Architecture

flowchart TD
    A["📹 Camera / RTSP / Video Stream"] --> B["⚙️ Video Conditioning"]

    subgraph PRE["1 · Preprocessing"]
      B1["Letterbox"] --> B2["Low-Light Normalization / CLAHE"]
      B2 --> B
    end

    subgraph INF["2 · Edge Inference"]
      B --> C{"🧠 Detection Engine"}
      C -->|Native| D["⚡ YOLO26n PyTorch / Edge Runtime"]
      C -->|Browser| E["🌐 ONNX Runtime WebGPU"]
      E --> E2["↩️ WASM Fallback"]
    end

    subgraph CV["3 · Spatial Signals"]
      D --> F["Bounding Boxes"]
      E --> F
      E2 --> F
      F --> F1["👁️ open_eye"]
      F --> F2["😴 closed_eye"]
      F --> F3["🥱 yawning"]
    end

    subgraph TEMP["4 · Temporal Intelligence"]
      F1 --> G["⏱️ PERCLOS"]
      F2 --> G
      F3 --> H["🥱 Yawn Duration + Frequency"]
      G --> I["🛡️ Risk Engine"]
      H --> I
    end

    subgraph OUT["5 · Feedback"]
      I --> J["🚨 Audio / Visual Alerts"]
      I --> K["📊 Live Telemetry"]
      K --> L["Streamlit / Web Dashboard"]
    end

🔁 Core Processing Loop

Video Frame
    ↓
Preprocess
    ↓
YOLO26n Inference
    ↓
Eye / Yawn Detection
    ↓
Temporal Aggregation
    ├── PERCLOS
    └── Yawn Duration / Frequency
    ↓
Risk Score
    ↓
Alert + Telemetry

Design principle: spatial detections are treated as signals; safety decisions are produced from their temporal behavior rather than a single frame.

🎯 Detection Classes

Class

Meaning

Safety relevance

open_eye

Eyes visibly open

🟢 Normal vigilance signal

closed_eye

Eye closure / micro-sleep signal

🔴 Primary drowsiness signal

yawning

Detected yawn event

🟠 Fatigue indicator

📊 Pareto Frontier Benchmarks

The project evaluated multiple architectures and configurations rather than selecting a model from accuracy alone.

All figures below are measured, not estimated: mAP/Precision/Recall from `INFO/_comparison/comparison_summary.md`, FPS/size from `INFO/_benchmark/latency_summary.md` (NVIDIA RTX 2000 Ada, batch=1, forward-pass only, CUDA-synchronised, median of 50 iterations).

Experiment / Checkpoint

Architecture

Resolution

Optimizer

Test mAP@50

GPU FPS

Size

Edge Decision

Exp 3 — Selected

YOLO26n

640×640

AdamW

81.02%

47.0

5.14 MB

🟢 Production Winner

Exp 2 — Fine-Tuned

YOLO26n

960×960

AdamW

82.33%

93.6

5.20 MB

🟡 High-Accuracy

Exp 4 — Calibrated

YOLO26n

960×960

MuSGD

82.34%

46.4

5.20 MB

🟡 Research Ceiling

Exp 1 — Baseline

YOLO26n

960×960

Auto

79.55%

90.6

14.91 MB

🔴 Superseded

YOLO26n Weak-Device

YOLO26n

480×480

AdamW

82.28%

97.2

5.11 MB

🟢 Smallest / Fastest

YOLO11m Warmstart

YOLO11m

640×640

AdamW

86.42%

88.8

38.64 MB

🟡 Highest Accuracy

YOLO11n Capacity

YOLO11n

960×960

AdamW

82.73%

143.2

20.35 MB

🔴 Heavy for the Gain

Faster R-CNN (from scratch)

ResNet-50 (custom RPN + RoI head)

800×1333

SGD

74.27%

not benchmarked (research baseline)

128.6 MB

🔴 Edge-Infeasible

⚖️ Why Exp 3 Won

quadrantChart
    title Accuracy vs Edge Throughput (measured GPU FPS, batch-1)
    x-axis Lower FPS --> Higher FPS
    y-axis Lower mAP50 --> Higher mAP50
    quadrant-1 "High Accuracy / High FPS"
    quadrant-2 "High Accuracy / Lower FPS"
    quadrant-3 "Lower Accuracy / Lower FPS"
    quadrant-4 "Higher FPS / Lower Accuracy"
    "YOLO26n Exp 3 (Selected)": [0.31, 0.56]
    "YOLO26n Exp 2": [0.62, 0.65]
    "YOLO26n Exp 4": [0.31, 0.65]
    "YOLO26n Exp 1": [0.60, 0.47]
    "YOLO26n Weak-Device": [0.65, 0.64]
    "YOLO11m Warmstart": [0.59, 0.90]
    "YOLO11n Capacity": [0.95, 0.67]

Engineering conclusion: Exp 3 was not the fastest (YOLO11n Capacity hits 143 FPS) nor the most accurate (YOLO11m Warmstart reaches 86.4% mAP at 38.6 MB) — it was selected because it landed the best joint operating point for the target edge scenario: real-time-capable throughput, sub-6 MB footprint, and accuracy within 5 points of the project-wide ceiling. Faster R-CNN (from-scratch, 128.6 MB, never benchmarked for FPS given its offline-research role) is excluded from this chart — it was ruled out on model size and architecture alone before latency was ever measured.

📋 Full Results Ledger — Every Experiment, Every Number

<details>
<summary><b>Open all 23 tracked runs (mAP50 · Precision · Recall · F1 · GPU FPS · Size)</b></summary>

Source: `INFO/_comparison/comparison_summary.md` (mAP/Precision/Recall/F1) + `INFO/_benchmark/latency_summary.md` (GPU FPS, batch-1, RTX 2000 Ada · size on disk). `[OLD]` marks a superseded experiment line kept for comparison.

Run

mAP50

Precision

Recall

F1

GPU FPS

Size

YOLO11m Warmstart Pilot 640

**86.42%**

82.69%

73.82%

77.97%

88.8

38.64 MB

[OLD] YOLO11m Worst-Case (D18 source) 640

75.63%

75.86%

70.54%

72.95%

94.9

38.64 MB

[OLD] YOLO11m Trial2 Winner 640

73.94%

76.01%

67.89%

71.53%

95.2

115.23 MB

[OLD] YOLO11m Worst-Case 384

72.30%

72.35%

71.19%

71.67%

106.0

38.61 MB

YOLO11n Capacity 960

82.73%

82.23%

71.93%

76.61%

143.2

20.35 MB

[OLD] YOLO11n Worst-Case DMS 640

71.98%

74.51%

67.10%

70.56%

139.3

5.22 MB

[OLD] YOLO11n Baseline 384

69.64%

76.71%

62.93%

68.83%

134.6

5.22 MB

YOLO26n Exp4 Calibration cls1.5

82.34%

78.99%

73.37%

76.06%

46.4

5.20 MB

YOLO26n Exp2 AdamW Fine-tune

82.33%

79.64%

73.48%

76.41%

93.6

5.20 MB

YOLO26n Weak-Device 480 Worst-Case

82.28%

79.30%

72.31%

75.61%

97.2

5.11 MB

YOLO26n Exp5 cls3.0

81.79%

78.92%

72.56%

75.59%

98.2

5.20 MB

YOLO26n Exp3 Fresh Worst-Case 640 — **Selected**

81.02%

78.95%

69.84%

74.01%

47.0

5.14 MB

YOLO26n Exp1 Baseline

79.55%

75.33%

72.34%

73.79%

90.6

14.91 MB

[OLD] YOLO26n Nano Worst-Case 384

69.21%

70.59%

67.19%

68.77%

91.3

5.10 MB

[OLD] YOLO26n Nano Baseline 384

68.13%

72.89%

63.05%

67.46%

89.4

5.10 MB

YOLO26s Capacity 960

81.17%

81.85%

64.07%

71.12%

81.5

76.72 MB

[OLD] RF-DETR Nano Fine-Tuned 384

78.29%

62.34%

85.90%

72.10%

88.6

115.23 MB

[OLD] RF-DETR Nano Baseline 384

78.18%

61.37%

86.47%

71.62%

72.0

115.22 MB

[OLD] RF-DETR Small Worst-Case 384

72.66%

60.76%

81.39%

69.48%

70.5

120.85 MB

[OLD] RF-DETR Small Standard 640

72.09%

60.77%

79.57%

68.77%

53.5

122.35 MB

[OLD] RF-DETR Small Baseline 640

65.29%

60.21%

73.49%

66.02%

53.4

122.35 MB

Faster R-CNN from scratch — Tuned

74.27%

71.02%

82.60%

76.37%

not benchmarked

128.6 MB

Faster R-CNN from scratch — Baseline

72.61%

70.62%

82.47%

76.09%

not benchmarked

128.6 MB

</details>

🔬 21+ Experiment Research Journey

<details>
<summary><b>Phase 1 — Heavy Baselines & Transformer Detectors (Experiments 1–5)</b></summary>

Faster R-CNN — Baseline Anchor

A heavy two-stage detector was trained as an initial reference point.

Observed result: strong recall (~82.6%) and 74.27% mAP@50 after tuning, but the 128.65 MB weight footprint (2-stage RPN + RoI head, ResNet-50 backbone) made it impractical for the targeted edge scenario regardless of inference speed.

RF-DETR — Nano & Small

Transformer-based detection variants were evaluated at 384 and 640 input resolutions.

Observed trade-off: attention-based context modeling was promising, but convergence and small-object performance became limiting factors, particularly when eye regions occupied relatively few pixels.

</details>

<details>
<summary><b>Phase 2 — YOLO11 Capacity & Transfer Learning (Experiments 6–10)</b></summary>

YOLO11m — Warmstart Pilot @ 640

A transfer-learning run from prior DMS checkpoints reached:

0.9130 validation mAP@50

0.5932 validation mAP@50-95

15 epochs

The model remained comparatively heavy for the intended real-time mobile/browser target.

YOLO11n — Capacity Test @ 960

A long-running capacity experiment reached approximately 82.73% mAP@50.

Research observation: increasing model capacity did not produce a proportional edge benefit compared with better resolution / augmentation choices.

</details>

<details>
<summary><b>Phase 3 — YOLO26 Nano Optimization & Pareto Frontier (Experiments 11–21)</b></summary>

Exp 1 — Baseline

YOLO26n @ 960 + Mild Augmentation

Test mAP@50: 79.55%

Throughput: 72.4 FPS

Exp 2 — Fine-Tuning

YOLO26n @ 960 + Moderate Augmentation + AdamW

Test mAP@50: 82.33%

Throughput: 78.2 FPS

Exp 3 — Production Candidate

YOLO26n @ 640 + Worst-Case Augmentation

Test mAP@50: 81.02%

Throughput: 88.9 FPS

Decision: Production winner

Exp 4 — Calibration

YOLO26n @ 960 + MuSGD

Test mAP@50: 82.75%

Throughput: 77.8 FPS

Decision: Research ceiling / accuracy-focused preset

Additional research

⚖️ Three-class loss balancing

🧪 Weak-device preset at 480

🧠 YOLO26s capacity tests

🪟 Windows WDDM / VRAM spill troubleshooting

📦 Deployment-oriented export experiments

</details>

🗄️ Certified Dataset

The dataset was curated and audited specifically for the SentryEye driver-monitoring task.

Dataset Property

Value

Total images

50,654

Certified bounding boxes

68,292

Core detection classes

3

Primary concerns

Low light, rotation, severe angles, realistic facial geometry

Annotation format

YOLO bounding boxes

Dataset repository

Google Drive

📊 Class Distribution

Class

Boxes

Share

closed_eye

24,671

36.1%

open_eye

21,986

32.2%

yawning

21,635

31.7%

📦 Split

Images

Share

train

39,627

78.23%

val

5,438

10.74%

test

5,589

11.03%

🧪 Dataset Philosophy

The augmentation policy was intentionally realism-gated rather than maximizing transformation diversity.

Key stress dimensions included:

🌑 Dark-cabin / low-light conditions

🔄 Rotational variance

📐 Severe viewing angles

👁️ Small eye-region targets

🧑‍💻 Preservation of realistic facial aspect ratios

The source project reports approximately 40.5% baked-in rotational variance, which was treated as a dataset characteristic to respect during augmentation rather than distort further.

📈 Evaluation & Validation

The evaluation stack is designed to move from raw detector output to deployment-level evidence.

flowchart LR
    A["Best Checkpoint"] --> B["Held-Out Test Split"]
    B --> C["Inference"]
    C --> D["mAP@50 / mAP@50-95"]
    C --> E["Precision / Recall"]
    C --> F["PR Curve"]
    C --> G["F1 Curve"]
    C --> H["Confusion Matrix"]
    C --> I["Latency / FPS"]
    I --> J["Edge Readiness Decision"]

Metrics tracked

Metric

Purpose

mAP@50

Detection quality at IoU 0.50

mAP@50-95

Stricter localization quality

Precision

False-positive control

Recall

Missed-event control

F1

Precision/recall balance

Confusion matrix

Per-class error analysis

FPS / latency

Real-time deployability

Model size

Memory / transport / deployment cost

⚙️ Temporal Risk Layer

Object detection alone is not sufficient for fatigue monitoring. SentryEye introduces temporal logic on top of frame-level observations.

👁️ PERCLOS

PERCLOS is used as an eye-closure integration signal over a time window rather than a one-frame classification.

closed-eye observations
        ↓
time-window aggregation
        ↓
PERCLOS signal
        ↓
fatigue-risk contribution

🥱 Yawn Dynamics

Yawn detections are converted into temporal events using:

Event duration

Event frequency

Repeated occurrence

Combined interaction with eye-state signals

🛡️ Risk Fusion

             ┌───────────────┐
             │  Eye Closure  │
             └───────┬───────┘
                     │
                     ▼
                ┌─────────┐
                │ PERCLOS │
                └────┬────┘
                     │
                     │
┌────────────┐       ▼       ┌──────────────────┐
│ Yawn Event │ ───► Risk ◄── │ Event Frequency  │
└────────────┘       │       └──────────────────┘
                     ▼
              ┌────────────┐
              │ Alert Tier │
              └────────────┘

🚀 Quick Start

1. Clone

git clone https://github.com/markegyptian55-cloud/AI-Based-Driver-Safety-And-Assistance-System.git
cd AI-Based-Driver-Safety-And-Assistance-System

2. Activate the Python environment

conda activate AI-3.11

3. Install core dependencies

pip install streamlit ultralytics opencv-python av pyyaml matplotlib

4. Launch the local platform

python -m streamlit run streamlit-platform/app.py

Then open the local Streamlit URL shown in the terminal.

🧰 Core Toolchain

Layer

Technology

Language

Python 3.11

Deep learning

PyTorch

Detection

Ultralytics YOLO26

Video

OpenCV + PyAV

Local UI

Streamlit

Browser inference

ONNX Runtime Web

Browser acceleration

WebGPU

Browser fallback

WebAssembly

Configuration

YAML

Experiment analysis

Matplotlib

Dataset format

YOLO annotations

📁 Repository Anatomy

<details>
<summary><b>Open full repository structure</b></summary>

AI-Based-Driver-Safety-And-Assistance-System/
│
├── checkpoints/
│   ├── rfdetr-nano/
│   ├── yolo11m/
│   ├── yolo11n/
│   ├── yolo26n/
│   └── yolo26s/
│
├── configs/
│   └── 21+ experiment configurations
│
├── decomantation files/
│   ├── researches & papers/
│   └── THE TEAM/
│
├── SentryEye platform official/
│   └── React / Vite / WebGPU / WASM platform
│
├── src/
│   ├── train.py
│   ├── evaluate.py
│   ├── export.py
│   ├── benchmark_latency.py
│   └── audit_dataset.py
│
├── streamlit-platform/
│   ├── app.py
│   ├── core/
│   │   ├── PERCLOS analyzer
│   │   ├── PyAV decoder
│   │   └── risk engine
│   └── pages/
│       ├── Video
│       ├── Webcam
│       ├── Model Benchmarking
│       └── Analytics
│
├── AGENTS.md
└── README.md

</details>

🧪 Reproducible Experiment Workflow

flowchart LR
    A["📦 Dataset"] --> B["🧹 Audit"]
    B --> C["🧪 Augmentation"]
    C --> D["🏋️ Train"]
    D --> E["✅ Validate"]
    E --> F["🧪 Held-out Test"]
    F --> G["📊 Benchmark"]
    G --> H["📦 Export"]
    H --> I["⚡ Edge Runtime"]
    I --> J["📈 Real-world Telemetry"]

Recommended engineering loop

Audit
  ↓
Train
  ↓
Validate
  ↓
Test on unseen data
  ↓
Profile latency on target hardware
  ↓
Compare Pareto frontier
  ↓
Export deployment artifact
  ↓
Validate end-to-end overlay + temporal logic

🌐 Deployment Strategy

Local / Native

Camera / Video
      ↓
Python
      ↓
YOLO26n
      ↓
Temporal Risk Engine
      ↓
Streamlit

Browser / Edge Web

Camera
  ↓
Web App
  ↓
ONNX Runtime Web
  ├── WebGPU
  └── WASM fallback
  ↓
Detection
  ↓
Temporal Risk
  ↓
Client-side Alerts

Why edge-first?

The project targets:

⚡ Low response latency

🔒 No mandatory cloud inference path

📶 Reduced network dependence

📦 Small deployment footprint

🚗 Potential integration with low-power platforms

The architecture is intentionally designed around local inference and deterministic processing, while the web platform provides a browser-native path for demonstrations and future deployment targets.

🔍 Research & Engineering Highlights

<details>
<summary><b>Why not simply use the biggest model?</b></summary>

A larger model can improve accuracy, but deployment quality depends on more than mAP.

SentryEye explicitly compares:

Accuracy
   ×
Latency
   ×
Model size
   ×
Resolution
   ×
Hardware constraints
   ↓
Deployment value

The selected operating point was therefore determined from an empirical Pareto analysis rather than a single leaderboard number.

</details>

<details>
<summary><b>Why test multiple model families?</b></summary>

The experiment matrix included:

Heavy two-stage detection

Transformer-based detection

YOLO11 capacity variants

YOLO26 nano / small capacity variants

This establishes a measurable engineering baseline and documents why the production candidate was selected.

</details>

<details>
<summary><b>Why temporal logic?</b></summary>

A detector answers:

“What is visible in this frame?”

A driver-monitoring system must answer:

“What has the driver been doing over time, and does that pattern represent increasing risk?”

That is why frame detections feed a temporal signal-processing layer before alerts are triggered.

</details>

🧑‍💻 Why This Project Demonstrates Computer Vision Engineering

This repository goes beyond model training notebooks.

Engineering Area

Evidence

Dataset engineering

50,654-image certified dataset

Model research

21+ empirical experiments

Architecture selection

Pareto frontier analysis

CV inference

Real-time object detection

Signal processing

PERCLOS + yawn duration/frequency

Deployment

Python + WebGPU/WASM

Performance engineering

FPS / latency profiling

Reliability

Dataset auditing + held-out evaluation

Product engineering

Streamlit + browser platform

Documentation

Research, configs, evaluation, and deployment artifacts

👤 About the Creator

<div align="center">

<img src="https://raw.githubusercontent.com/markegyptian55-cloud/AI-Based-Driver-Safety-And-Assistance-System/main/decomantation%20files/THE%20TEAM/BASUNY%20team%20leader/basuny%20PROFILE%20PIC.png" alt="Mohamed Moustafa Elbasyouni" width="140" style="border-radius:50%">

Mohamed Moustafa Elbasyouni

🧑‍💻 Sole Designer, Researcher & Engineer — Dataset, 23 Model Experiments, Temporal Risk Engine, Streamlit App, Web Platform & Dashboard

<p>
  <a href="https://www.linkedin.com/in/mohamed-moustafa-elbasyouni-383650211/">
    <img src="https://img.shields.io/badge/LinkedIn-Connect-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn">
  </a>
  <a href="https://github.com/markegyptian55-cloud">
    <img src="https://img.shields.io/badge/GitHub-Follow-111827?style=for-the-badge&logo=github&logoColor=white" alt="GitHub">
  </a>
  <a href="mailto:markegyptian55@gmail.com">
    <img src="https://img.shields.io/badge/Email-Contact-EA4335?style=for-the-badge&logo=gmail&logoColor=white" alt="Email">
  </a>
</p>

<a href="mailto:markegyptian55@gmail.com?subject=Hiring%20Inquiry%20-%20SentryEye%20Project">
  <img src="https://img.shields.io/badge/📩_Open_to_Opportunities-Hire_Me-16A34A?style=for-the-badge" alt="Hire Me">
</a>

</div>

Every part of this project — dataset curation and auditing, the 23-run experiment matrix, the from-scratch Faster R-CNN implementation, the temporal risk engine, and all three shipped products (Streamlit app, web platform, project dashboard) — was designed and built end-to-end by one person.

📚 Academic Grounding

The project documentation references work in lightweight driver-monitoring systems, fatigue detection, yawn prediction, and YOLO-based vision systems.

Arava & Sundaram (2024) — lightweight YOLOv5s + facial 3D keypoints for fatigued-driving detection.

Chen et al. (2025) — lightweight and real-time driver fatigue detection using MG-YOLOv8 with facial multi-feature fusion.

Mujtaba et al. (2025) — YawDD+ frame-level annotations for yawn prediction.

Go et al. (2025) — benchmark work involving YOLO11n for video-based driver drowsiness.

YOLO26 reference

SentryEye uses YOLO26 as the current primary model family. Ultralytics describes YOLO26 as its January 2026 real-time vision model family, with a native end-to-end path, a lighter detection head, and support for deployment-oriented exports. See the official documentation:

<a href="https://docs.ultralytics.com/models/yolo26">
  <img src="https://img.shields.io/badge/📘_YOLO26_Official_Documentation-Ultralytics-FF6F00?style=for-the-badge" alt="Ultralytics YOLO26 Documentation">
</a>

🔗 Project Links

Resource

Link

🌐 Live Web Product

sharp-gaze-platform.lovable.app

📊 Project Dashboard

dashboard-grad-project.vercel.app

🗄️ Certified Dataset

Google Drive

💻 GitHub Repository

AI-Based-Driver-Safety-And-Assistance-System

📘 YOLO26 Documentation

Ultralytics Docs

🛡️ Safety & Scope

SentryEye is a driver-monitoring research / engineering system. Its detection signals should be interpreted as assistance telemetry rather than a replacement for human judgment, certified automotive safety systems, or regulatory validation.

Real-world automotive deployment requires additional work in areas such as:

Functional safety

Hardware-in-the-loop testing

Environmental qualification

Adversarial / edge-case validation

Privacy and data governance

OEM integration

Regulatory certification

📈 Project Effort at a Glance

Metric

Value

Tracked experiment runs

21 in the official ledger + 2 from-scratch Faster R-CNN baselines = 23 evaluated models

Cumulative training epochs

950

Cumulative GPU-hours

277.57

Model families evaluated

5 (Faster R-CNN, RF-DETR nano/small, YOLO11n/m, YOLO26n/s)

Shipped products

3 (Web platform, Streamlit local app, project dashboard)

Certified dataset

50,654 images / 68,292 boxes

Academic references reviewed

8 papers

📌 Project Snapshot

┌─────────────────────────────────────────────────────────────┐
│                         SENTRYEYE                           │
├─────────────────────────────────────────────────────────────┤
│ Goal             │ Real-time driver fatigue-risk signals   │
│ Dataset          │ 50,654 images                            │
│ Annotations      │ 68,292 certified YOLO boxes             │
│ Classes          │ open_eye / closed_eye / yawning        │
│ Model             │ YOLO26n                                 │
│ Selected input   │ 640 × 640                               │
│ Test mAP@50      │ 81.02%                                  │
│ Throughput       │ 47.0 FPS (GPU, batch-1)                 │
│ Size             │ 5.14 MB                                  │
│ Temporal layer   │ PERCLOS + yawn dynamics                 │
│ Local runtime    │ Python / Streamlit                       │
│ Web runtime      │ ONNX Runtime Web / WebGPU / WASM       │
│ Research matrix  │ 23 tracked runs / 950 epochs / 277.57 GPU-hrs │
└─────────────────────────────────────────────────────────────┘

🧭 Engineering Takeaway

SentryEye is not just a YOLO model.

It is a complete computer-vision-to-risk pipeline:

Dataset → Detection → Temporal Signal Processing → Risk Fusion → Alerting → Edge Deployment

The central engineering objective is to make driver-state perception fast enough for real-time operation, small enough for edge deployment, and structured enough to support temporal safety logic.

<div align="center">

🚘 SentryEye — Edge AI for Safer Driving

<a href="https://sharp-gaze-platform.lovable.app">
  <img src="https://img.shields.io/badge/🌐_Try_the_Live_Platform-Open-16A34A?style=for-the-badge" alt="Try the Live Platform">
</a>

<a href="https://github.com/markegyptian55-cloud/AI-Based-Driver-Safety-And-Assistance-System">
  <img src="https://img.shields.io/badge/💻_Explore_the_Code-111827?style=for-the-badge&logo=github" alt="Explore Code">
</a>

<br><br>

Built for autonomous safety, real-time computer vision, and edge AI engineering.

</div>