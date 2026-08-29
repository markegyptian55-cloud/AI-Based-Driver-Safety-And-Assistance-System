"""
book_content2.py — Chapters 2 and 4
====================================
Chapter 2 is written strictly against the eight papers supplied by the
authors and read in full. Where the project makes a claim those eight
papers do not cover, the text says so plainly instead of attaching an
unrelated citation to it - see the "coverage" note at the end of 2.4.

Chapter 4's narrative lives here; its tables and figures are generated in
build_book.py directly from metrics.json, latency.json and the training
records, so no result number is transcribed by hand into prose without
the generated table beside it.
"""

# ---------------------------------------------------------------- Chapter 2

CH2 = {
    "2.1 Vision-Based Driver Monitoring": [
        "Vision-based driver monitoring rests on the premise that fatigue "
        "produces observable facial behaviour before it produces loss of "
        "vehicle control. George and Rochit [8] survey the field and identify "
        "the recurring obstacles: variation in illumination, occlusion by "
        "spectacles and hands, differences in head pose, and the difficulty "
        "of obtaining data that represents genuine rather than simulated "
        "drowsiness.",

        "Two broad strategies appear in the literature. The first extracts "
        "geometric measurements from detected facial landmarks and applies "
        "thresholds to them. Arava and Sundaram [2] follow this approach, "
        "combining a lightweight YOLOv5s detector with 3D facial keypoints "
        "and computing eye and mouth aspect ratios against threshold values "
        "indicative of closure and yawning. The second treats the visual "
        "states themselves as detection targets, so that the network learns "
        "the appearance of a closed eye directly rather than inferring it "
        "from landmark geometry.",

        "The present project follows the second strategy. Landmark-based "
        "geometric ratios depend on reliable landmark localisation, which "
        "degrades precisely under the conditions - poor illumination, "
        "occlusion, extreme pose - where a fatigue detector is most needed. "
        "Treating eye and mouth state as detection classes removes that "
        "dependency.",
    ],
    "2.2 Detection Architectures for Driver Monitoring": [
        "The YOLO family dominates the applied driver-monitoring literature, "
        "and successive generations have been compared directly. Herath et "
        "al. [5] fine-tune seven YOLO variants spanning v5 through v11 on the "
        "UTA-RLDD dataset and report that while YOLOv9c achieved the highest "
        "accuracy in their study, YOLOv11n offered the best balance between "
        "precision and inference efficiency, which they identify as making it "
        "the more suitable choice for embedded deployment.",

        "That distinction - highest accuracy versus best deployable balance - "
        "is the same one that governs model selection in this project, and it "
        "recurs throughout the applied literature. Chen et al. [3] pursue it "
        "explicitly, proposing MG-YOLOv8 as a deliberately lightweight "
        "real-time fatigue detector combining multiple facial features, on "
        "the premise that a model which cannot meet a latency budget on "
        "target hardware is not useful regardless of its accuracy.",

        "Go et al. [4] address a component that most drowsiness pipelines "
        "treat as solved. They benchmark seven face detectors, including "
        "YOLOv11n, SSD MobileNet, YuNet and classical Haar cascades, and "
        "make a methodological observation directly relevant here: many "
        "prior studies use detector-generated outputs as ground truth, which "
        "introduces bias and can inflate reported performance. Their concern "
        "is that supervision quality itself is frequently taken for granted.",

        "Beyond single-frame detection, Yusuf et al. [7] fuse multi-level "
        "features with a long short-term recurrent network, treating "
        "drowsiness as a temporal pattern rather than a per-frame property. "
        "This is the direction identified as future work in Chapter (5) of "
        "the present document.",
    ],
    "2.3 Data Quality and Annotation": [
        "The most directly relevant prior work concerns annotation quality "
        "rather than architecture. Mujtaba et al. [1] observe that existing "
        "yawning datasets carry systematic noise arising from coarse temporal "
        "annotation: labels are applied at the video-segment level, so frames "
        "within a segment labelled as containing a yawn may not themselves "
        "show one. They address this by developing a semi-automated labelling "
        "pipeline with human-in-the-loop verification, producing frame-level "
        "annotations for the YawDD videos, and demonstrate that training on "
        "the refined labels improves model quality on edge platforms.",

        "Their finding - that a substantial performance limitation originated "
        "in the labels rather than in the model - directly parallels the "
        "central finding of the present project. The mechanism differs: "
        "Mujtaba et al. address temporal coarseness within a single dataset, "
        "whereas the corpus used here suffers from class-wise incompleteness "
        "caused by merging datasets annotated for different tasks. The "
        "methodological response is comparable in both cases: human "
        "verification of a sampled subset, used to establish a systematic "
        "rule rather than to correct individual images by hand.",

        "Alzami et al. [6] approach data limitation from the opposite "
        "direction, treating it as an image-quality problem. They apply "
        "Bayesian optimisation to select contrast-enhancement parameters "
        "adaptively for low-light frames, using a perceptual image-quality "
        "measure as the optimisation objective, and report significant "
        "improvement over both unprocessed frames and fixed-parameter "
        "enhancement on the NITYMED dataset. Their approach is not adopted "
        "here - the present system relies on photometric augmentation during "
        "training rather than on inference-time preprocessing - but it "
        "illustrates an alternative response to the same underlying "
        "difficulty.",
    ],
    "2.4 Research Gap": [
        "Three observations follow from the reviewed work.",

        "First, comparative studies of detection architectures for driver "
        "monitoring are typically conducted within a single architectural "
        "lineage. Herath et al. [5] compare seven YOLO variants; Go et al. "
        "[4] compare face detectors. Comparison across genuinely different "
        "detection paradigms - single-stage convolutional, transformer-based "
        "set prediction, and two-stage proposal-and-refine - on one dataset "
        "under one protocol is less common.",

        "Second, dataset quality is recognised as a limitation [1], [4], but "
        "the specific problem of merging datasets annotated for different "
        "tasks into a shared label space, and the systematic class-wise "
        "missing supervision this produces, is not addressed in the reviewed "
        "set. Nor is its effect on evaluation, as distinct from its effect on "
        "training.",

        "Third, deployment is consistently framed in terms of embedded and "
        "edge hardware [1], [3], [5]. In-browser inference, where the model "
        "must be downloaded over a network and executed inside a sandboxed "
        "runtime on unknown consumer hardware, imposes a different constraint "
        "set - download size becomes a primary cost - and is not represented "
        "in the reviewed work.",

        "This project addresses all three: it compares four architecture "
        "families under a single protocol, it characterises and corrects for "
        "merge-induced annotation incompleteness in both training and "
        "evaluation, and it targets browser deployment directly.",

        "Coverage note. The reviewed set comprises the eight works available "
        "to this study. It does not include primary references for several "
        "components the project uses: the RF-DETR architecture, the original "
        "definition and validation of PERCLOS, the sparsely-annotated object "
        "detection literature, or the Faster R-CNN design on which the "
        "from-scratch implementation is based. These components are described "
        "from their own technical documentation and source implementations in "
        "Chapter (3) rather than attributed to unrelated citations.",
    ],
}

# ---------------------------------------------------------------- Chapter 4

CH4_INTRO = [
    "This chapter presents the experimental programme and its results: the "
    "environment in which the work was carried out, the training runs "
    "performed, the comparative accuracy of the architectures evaluated, the "
    "measured performance characteristics of the candidate models, and the "
    "deployed system.",
]

CH4_ENV = [
    "All training, evaluation and benchmarking was performed on a single "
    "workstation with an NVIDIA RTX 2000 Ada Generation GPU providing 17.18 "
    "GB of VRAM, running Windows. The software environment was Python "
    "3.11.15, PyTorch 2.6.0 with CUDA 12.4, and Ultralytics 8.4.64. Browser "
    "deployment uses ONNX Runtime Web 1.27.0.",

    "One platform constraint shaped the training configuration. Data-loader "
    "worker counts above two produced repeated process failures on this "
    "system, and two workers was the only value verified stable across every "
    "batch size used. This limited data-loading throughput and therefore "
    "influenced achievable batch sizes, but did not affect model quality.",
]

CH4_TRAINING = [
    "Twenty-one training runs were completed across six model configurations "
    "in four architecture families, totalling 950 epochs and 277.57 GPU-hours. "
    "Runs varied in architecture, capacity, input resolution, augmentation "
    "intensity, and initialisation strategy.",

    "Two properties of the training record require explicit statement. "
    "First, wall-clock duration for ten of the runs is self-reported from run "
    "summaries rather than machine-logged; these are marked in the results "
    "table, and the two categories are not aggregated into a single "
    "unqualified total. Second, per-epoch training histories were preserved "
    "for fifteen of the twenty-one runs. For the remaining six - the five "
    "RF-DETR runs and one YOLO11m run - no training log survives in any form, "
    "and the checkpoints themselves store only a final epoch counter rather "
    "than a loss series. Loss curves are therefore presented for fifteen runs "
    "and the absence is recorded for the other six, rather than filled with a "
    "substitute.",
]

CH4_ACCURACY = [
    "All models were evaluated on the same held-out partition of 5,589 "
    "images containing 7,427 instances, at IoU 0.5 and operating confidence "
    "0.35. Both raw and label-gap-corrected mAP@0.5 are reported; the "
    "correction, described in Section 3.6.2, ignores predictions of a class "
    "that the contributing source family never annotates, and by construction "
    "leaves recall unchanged.",
]

CH4_ACCURACY_DISCUSS = [
    "Three results merit specific comment.",

    "The highest accuracy in the study was obtained by a warm-started "
    "YOLO11m run in 15 epochs and 7.23 GPU-hours. Several runs trained for "
    "far longer reached lower accuracy - one YOLO11m configuration consumed "
    "40.43 GPU-hours across 40 epochs to reach a markedly lower score. "
    "Initialisation strategy, not training duration, was the dominant factor.",

    "The transformer-based RF-DETR models did not outperform the "
    "single-stage convolutional models on this task, despite substantially "
    "greater capacity: RF-DETR-Nano carries 30.15 M parameters against "
    "YOLO26n's 2.50 M, an order of magnitude more, for lower accuracy. "
    "Architectural novelty did not translate into advantage here.",

    "The three highest-scoring YOLO26n configurations are separated by 0.03 "
    "percentage points of corrected mAP@0.5. That difference is not "
    "meaningful, and no ranking claim is made between them on the basis of "
    "it. Their selection for deployment rests on the size and latency "
    "measurements presented below, not on their ordering in this table.",
]

CH4_PERCLASS = [
    "Aggregate mAP conceals a trade between the two deployed configurations "
    "that is directly relevant to the application. The 960-pixel model is "
    "stronger on closed_eye, the class from which microsleep evidence is "
    "derived; the 480-pixel model is stronger on yawning. Because these "
    "classes carry different safety weight - a missed microsleep is a more "
    "serious failure than a missed yawn - the two models were deployed as an "
    "explicit two-tier choice rather than treating either as a replacement "
    "for the other.",
]

CH4_LATENCY = [
    "Inference latency was measured directly rather than inferred from input "
    "dimensions. Each configuration was timed over 50 iterations at batch "
    "size 1 after 10 discarded warm-up iterations, with CUDA synchronisation "
    "on both sides of every timed region. Synchronisation is essential: CUDA "
    "kernel launches are asynchronous, and timing them without it measures "
    "the speed of instruction dispatch rather than of computation. Reported "
    "throughput is derived from the median rather than the mean, so that a "
    "single outlier cannot distort it. The measurement covers the forward "
    "pass on a synthetic input of each model's own size and excludes "
    "pre-processing and post-processing, and is therefore a lower bound on "
    "end-to-end cost.",
]

CH4_LATENCY_DISCUSS = [
    "The measurements contradicted an assumption carried through the earlier "
    "part of this work. Reducing input resolution from 960 to 480 pixels "
    "reduces the number of input pixels by a factor of four, and the "
    "computational cost of convolution scales with that count. It was "
    "expected that latency would fall correspondingly. It did not. Across "
    "the YOLO26n configurations, GPU latency is approximately constant at "
    "384, 480, 640 and 960 pixel inputs.",

    "The explanation is that at batch size 1 with a 2.50 M-parameter model, "
    "GPU execution is dominated by fixed per-launch overhead rather than by "
    "arithmetic. The GPU is not saturated, so reducing the work does not "
    "reduce the elapsed time. The advantage of the smaller input appears on "
    "CPU, where computation genuinely dominates and the relationship holds.",

    "This has a direct consequence for deployment reasoning: on capable GPU "
    "hardware, the smaller model's benefit is download size rather than "
    "speed, while on CPU-bound devices the latency benefit is real. It also "
    "illustrates why the measurement was necessary - the expectation derived "
    "from first principles was reasonable and was wrong.",

    "A second measured result concerns model size rather than speed. "
    "RF-DETR-Nano requires 115 MB on disk against YOLO26n's 5.11 MB, a "
    "factor of twenty-two, while being only marginally slower on GPU. For a "
    "model that must be downloaded to a browser before the first inference "
    "can run, size rather than latency is the binding constraint, and it is "
    "on that basis that the transformer models were excluded from "
    "deployment.",
]

CH4_EXPORT = [
    "The two selected configurations were exported to ONNX at their own "
    "training resolutions, with non-maximum suppression compiled into the "
    "graph and the graph structurally simplified. The exported models emit a "
    "fixed tensor of 300 candidate detections, each carrying box "
    "coordinates, a confidence score and a class index, already suppressed. "
    "This removes an entire post-processing stage from the browser client.",

    "Both were additionally converted to half precision to reduce download "
    "size. Because reduced numerical precision can in principle alter "
    "detection behaviour, the converted models were verified against their "
    "full-precision counterparts on real test images rather than assumed "
    "equivalent. Detections were matched between precisions by spatial "
    "overlap and compared. The 960-pixel model produced identical detection "
    "counts with no class disagreements and a maximum box displacement of "
    "0.64 pixels; the 480-pixel model matched on all common detections with a "
    "maximum displacement of 0.36 pixels, differing by one additional "
    "detection near the confidence threshold. Half-precision conversion is "
    "therefore behaviourally lossless at this scale while halving model size.",
]

CH4_DEPLOY = [
    "The deployed system executes the exported models entirely within the "
    "user's browser. Inference runs in a dedicated worker thread so that the "
    "user interface is not blocked during processing, using the WebGPU "
    "execution provider where the device supports it and falling back to "
    "multi-threaded WebAssembly otherwise. Multi-threaded WebAssembly "
    "requires SharedArrayBuffer, which is available only to a "
    "cross-origin-isolated page, so the application sets the required "
    "isolation headers on every response; without them the runtime silently "
    "degrades to single-threaded execution.",

    "Per-frame detections are aggregated by the temporal layer described in "
    "Section 3.3 into a rolling PERCLOS estimate and a debounced driver "
    "state. No video frame is transmitted from the device at any point.",

    "The two models are presented to the user as a two-tier choice. The "
    "480-pixel configuration is the default, on the basis that it matches "
    "the larger model's aggregate accuracy while being cheaper on "
    "CPU-bound hardware; the 960-pixel configuration is offered as a "
    "higher-quality option where its stronger closed_eye performance is "
    "preferred and the hardware permits it.",
]

CH4_SCRATCH = [
    "A simplified Faster R-CNN was implemented from first principles, "
    "without a detection framework, as described in Section 3.4.4. Its "
    "results are presented separately here because it was evaluated on a "
    "test partition of 5,705 images rather than the 5,589-image partition "
    "used for every other model in this study. The two sets of figures are "
    "therefore not directly comparable, and no ranking between them is "
    "implied.",

    "Two variants were evaluated: a baseline configuration and a tuned "
    "configuration. Tuning improved mAP@0.5 from 72.61 % to 74.27 % and "
    "mAP@0.5:0.95 from 32.76 % to 34.60 %. The per-class pattern is "
    "informative: yawning improved by 3.62 percentage points and open_eye by "
    "2.87, while closed_eye declined by 1.49.",

    "The value of this implementation is primarily educational. Constructing "
    "a region proposal network, anchor generation, RoI alignment and a "
    "two-stage training loop with four simultaneous loss terms from scratch "
    "establishes an understanding of detection mechanics that using a "
    "framework does not. Its accuracy is below that of the framework-based "
    "single-stage models evaluated in this study, which is the expected "
    "outcome and not the purpose of the exercise.",
]
