<div align="center">

# 🚘 SentryEye
### AI-Powered Driver Safety & Assistance System (ADAS)
**Real-time edge AI for driver drowsiness, distraction, and fatigue-risk detection**

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

> **Production Winner:** **YOLO26n @ 640×640** — **81.02% test mAP@50**, **47.0 FPS on GPU** (batch-1, forward-pass), and **~5.14 MB deployable footprint**. Selected for the optimal size ↔ speed ↔ accuracy balance rather than chasing isolated leaderboard scores.

<p>
  <b>🎯 Computer Vision</b> ·
  <b>⚡ Edge AI</b> ·
  <b>🧠 Deep Learning</b> ·
  <b>📹 Driver Monitoring</b> ·
  <b>🛡️ ADAS</b>
</p>

</div>

---

## ✨ What Is SentryEye?

**SentryEye** is an end-to-end driver monitoring and safety system designed to detect visual fatigue signals in real time and convert frame-level computer-vision detections into temporal risk intelligence.

Instead of treating every frame in isolation, the system combines:

* 👁️ **Eye-state detection:** High-frequency classification of `open_eye` vs. `closed_eye`.
* 🥱 **Yawn detection:** Precise localization of active `yawning` episodes.
* ⏱️ **Temporal fatigue analysis:** Algorithmic PERCLOS integration and yawn duration/frequency evaluation.
* 🛡️ **Risk scoring:** Multi-tiered driver-threat decision engine.
* 🚨 **Real-time alerts:** Sub-millisecond acoustic and visual feedback loop.
* ⚡ **Edge deployment:** Native accelerated Python execution alongside browser-side WebGPU/WASM pipelines.

Developed through an empirical research trajectory across 21+ model experiments, SentryEye optimizes the multidimensional **accuracy ↔ latency ↔ footprint** trade-off for resource-constrained automotive edge hardware.

---

## 🧭 Quick Navigation

| Section | Description |
| :--- | :--- |
| [🎯 Product Overview](#-what-is-sentryeye) | Motivation, core capabilities, and scope |
| [🌐 Live Ecosystem](#-live-ecosystem) | Direct links to shipped applications and datasets |
| [🏗️ System Architecture](#-system-architecture) | End-to-end perception and temporal analysis pipeline |
| [📊 Pareto Frontier Benchmarks](#-pareto-frontier-benchmarks) | Measured tradeoffs, charts, and hardware benchmarks |
| [📋 Full Results Ledger](#-full-results-ledger) | Complete 23-run benchmark across all architectures |
| [🔬 Research Journey](#-21-experiment-research-journey) | Three-phase experimental progression |
| [🗄️ Certified Dataset](#-certified-dataset) | Distribution, audit metrics, and splits |
| [📈 Evaluation Pipeline](#-evaluation--validation) | Validation methodology and metric definitions |
| [⚙️ Temporal Risk Layer](#️-temporal-risk-layer) | PERCLOS formulas and risk fusion logic |
| [🚀 Quick Start](#-quick-start) | Local setup, installation, and environment guide |
| [🧰 Core Toolchain](#-core-toolchain) | Software stack and framework specifications |
| [📁 Repository Anatomy](#-repository-anatomy) | Directory structure and module organization |
| [👤 About the Creator](#-about-the-creator) | Engineering background and contact channels |
| [📚 Academic Grounding](#-academic-grounding) | Literature review and foundational citations |

---

## 🌐 Live Ecosystem

<div align="center">

| Product | Stack | Status | Access |
| :--- | :--- | :---: | :--- |
| **🚀 SentryEye Web Platform** | React 18 + Vite + ONNX Runtime Web (WebGPU / WASM) | 🟢 Live | [Open Platform](https://sharp-gaze-platform.lovable.app) |
| **📊 Project Dashboard** | Next.js / React Analytics Suite | 🟢 Live | [Open Dashboard](https://dashboard-grad-project.vercel.app) |
| **🗄️ Certified Dataset** | 50,654 images + 68,292 certified YOLO bounding boxes | 🟢 Available | [Open Google Drive](https://drive.google.com/drive/folders/126mrDWhsI_PmlOLjTomMWSjUjySS6XxT?usp=drive_link) |
| **💻 Source Repository** | Python 3.11 + Ultralytics + PyAV + Streamlit | 🟢 Public | [GitHub Repo](https://github.com/markegyptian55-cloud/AI-Based-Driver-Safety-And-Assistance-System) |

<br>

[![Open SentryEye Web Platform](https://img.shields.io/badge/🚀_OPEN_SENTRYEYE_WEB_PLATFORM-2563EB?style=for-the-badge)](https://sharp-gaze-platform.lovable.app)
[![Open Project Dashboard](https://img.shields.io/badge/📊_OPEN_PROJECT_DASHBOARD-4F46E5?style=for-the-badge)](https://dashboard-grad-project.vercel.app)
[![Open Dataset](https://img.shields.io/badge/🗄️_OPEN_CERTIFIED_DATASET-16A34A?style=for-the-badge)](https://drive.google.com/drive/folders/126mrDWhsI_PmlOLjTomMWSjUjySS6XxT?usp=drive_link)

</div>

---

## 🧠 System Architecture

```mermaid
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
      F1 --> G["⏱️ PERCLOS Integration"]
      F2 --> G
      F3 --> H["🥱 Yawn Duration & Frequency"]
      G --> I["🛡️ Multi-Tier Risk Engine"]
      H --> I
    end

    subgraph OUT["5 · Feedback & Telemetry"]
      I --> J["🚨 Audio / Visual Alerts"]
      I --> K["📊 Live Telemetry"]
      K --> L["Streamlit / Web Dashboard"]
    end
