"""
book_ch3.py — Chapter 3 (Methodology) as structured content
============================================================
Held as a section map rather than flat prose so the builder can apply the
template's real heading levels and insert generated tables and figures at
the correct points, instead of a Markdown-to-Word conversion that would
flatten the hierarchy the auto Table of Contents depends on.

Block forms:
    str                      -> body paragraph
    ("TABLE", key)           -> table from TABLES[key]
    ("FIG", path, n, title)  -> figure with caption
"""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
INFO = PROJECT_ROOT / "INFO"

_CHARTS_480 = (INFO / "yolo26n" /
               "6-weakdevice-480-worstcase-yolo26n-test-result" /
               "tested-images" / "charts")

TABLES = {
    "aug": {
        "n": "3.1",
        "title": "Augmentation parameters by intensity level",
        "headers": ["Parameter", "Moderate", "Worst-case"],
        "rows": [
            ["fliplr", "0.5", "0.5"],
            ["flipud", "0.0", "0.0"],
            ["degrees", "15.0", "25.0"],
            ["shear", "4.0", "8.0"],
            ["perspective", "0.0005", "0.0008"],
            ["translate", "0.15", "0.25"],
            ["scale", "0.6", "0.7"],
            ["hsv_h", "0.02", "0.03"],
            ["hsv_s", "0.7", "0.8"],
            ["hsv_v", "0.5", "0.6"],
            ["erasing", "0.3", "0.40"],
            ["auto_augment", "randaugment", "randaugment"],
            ["mosaic / mixup / cutmix / copy_paste", "0.0 (disabled)", "0.0 (disabled)"],
        ],
    },
    "dataset": {
        "n": "3.2",
        "title": "Final dataset composition",
        "headers": ["Split", "Images", "Instances", "closed_eye", "open_eye", "yawning"],
        "rows": [
            ["Train", "39,627", "53,620", "19,366", "17,657", "16,597"],
            ["Validation", "5,438", "7,245", "2,910", "2,002", "2,333"],
            ["Test", "5,589", "7,427", "2,395", "2,327", "2,705"],
            ["Total", "50,654", "68,292", "24,671 (36.1 %)", "21,986 (32.2 %)", "21,635 (31.7 %)"],
        ],
    },
    "hyper": {
        "n": "3.4",
        "title": "Training hyperparameters (deployed 960-pixel configuration)",
        "headers": ["Parameter", "Value"],
        "rows": [
            ["Optimiser", "AdamW"],
            ["Initial learning rate (lr0)", "0.001"],
            ["Final learning-rate factor (lrf)", "0.01"],
            ["Schedule", "Cosine"],
            ["Momentum", "0.9"],
            ["Weight decay", "0.0005"],
            ["Warm-up epochs", "3.0"],
            ["Mixed precision", "Enabled"],
            ["Box / class / DFL loss weights", "7.5 / 1.5 / 1.5"],
            ["Batch size", "32"],
            ["Early-stopping patience", "12"],
        ],
    },
    "arch": {
        "n": "3.3",
        "title": "Detection architectures evaluated",
        "headers": ["Family", "Capacity", "Parameters (M)", "Paradigm"],
        "rows": [
            ["YOLO26", "n / s", "2.50 / 9.95", "Single-stage convolutional"],
            ["YOLOv11", "n / m", "2.59 / 20.05", "Single-stage convolutional"],
            ["RF-DETR", "Nano / Small", "30.15 / 32.02", "Transformer set prediction"],
            ["Faster R-CNN", "From scratch", "-", "Two-stage proposal and refine"],
        ],
    },
}

SECTIONS = {
    "3.1 Data Collection": [
        "This chapter describes the data, the preparation pipeline, the "
        "detection architectures evaluated, and the evaluation protocol. "
        "Every quantitative statement is drawn from the project's own "
        "artefacts, and the provenance of each is stated where it is not "
        "self-evident.",
    ],
    "3.1.1 Task Formulation": [
        "Driver drowsiness is expressed through observable facial behaviour: "
        "the eyes close for abnormally long intervals, and the mouth opens in "
        "yawns. A system intended to run inside a vehicle must recognise "
        "these cues from a single camera view, in real time, under "
        "uncontrolled illumination.",

        "The task was framed as object detection over three classes - "
        "closed_eye, open_eye and yawning - rather than as whole-image "
        "classification. This choice has consequences throughout the "
        "project. A classifier assigns one label to an entire frame and "
        "cannot express that one eye is closed while the other is open, nor "
        "localise which region of the face produced the evidence. A detector "
        "returns localised, independently scored instances, which is what a "
        "temporal fatigue estimator requires: the proportion of time the "
        "eyes are closed cannot be computed from a frame-level label alone.",
    ],
    "3.1.2 Corpus Composition": [
        "The working corpus was assembled from 57,098 images drawn from "
        "several independently annotated sources: public dataset exports, "
        "stock photography, compiled drowsy-driving photograph sets, and "
        "driver-monitoring session recordings.",

        "The decisive property of this corpus, and the origin of most of the "
        "methodological work in this chapter, is that it is not a single "
        "dataset. It is a merge of separate single-task datasets - an "
        "eye-state corpus annotated only for eye classes, a yawning corpus "
        "annotated only for mouth state, and several session recordings - "
        "combined into one three-class label space without re-annotation.",

        "The consequence is that many images contain objects that are "
        "genuinely present but were never labelled, because the source that "
        "contributed the image was never concerned with that class. An image "
        "from the eye-state corpus may show a yawning driver but carry no "
        "yawning box. This is not random annotation noise. It is systematic, "
        "source-correlated missing supervision, and it invalidates the "
        "standard assumption that an unlabelled region is background. In the "
        "detection literature this setting is termed sparsely annotated "
        "object detection, and it is known to degrade training by supplying "
        "false-negative supervision: unlabelled true objects are scored as "
        "background, teaching the detector to suppress exactly the evidence "
        "it should learn.",

        "After the cleaning and de-duplication pipeline described in Section "
        "3.2.1, the corpus was reduced to a final set of 50,654 images "
        "containing 68,292 annotated instances.",
    ],
    "3.1.3 Annotation Protocol": [
        "Annotations use the standard YOLO detection format: one text file "
        "per image, one line per instance, giving the class index and the "
        "normalised centre coordinates, width and height of the bounding box.",

        "Because the corpus was inherited rather than annotated from "
        "scratch, the annotation work in this project was verification and "
        "reconciliation rather than initial labelling. Two automated attempts "
        "to infer annotation completeness were made and both were rejected "
        "as unreliable. The problem was resolved through structured human "
        "review, in which sampled images were examined against a set of "
        "spatial evidence gates before any conclusion about missing labels "
        "was accepted. The decisive gate required that labelled geometry be "
        "cross-validated against an independent facial-geometry prediction: "
        "an eye-only image was accepted as genuinely eye-only supervision "
        "only if its labelled boxes fell inside the predicted eye region of "
        "the detected face.",

        "The outcome is a source-aware supervision manifest recording, for "
        "each source family, which classes it can be trusted to supervise. "
        "This manifest is what makes the corrected evaluation in Section "
        "3.6.2 possible, and it is the project's principal methodological "
        "contribution.",
    ],
    "3.2 Data Preparation": [],
    "3.2.1 Corpus Construction and Quality Control": [
        "The path from the 57,098-image raw corpus to the final 50,654-image "
        "dataset consisted of eight stages, each independently verified: "
        "ingestion and integrity scanning; geometric and bounding-box scale "
        "analysis to detect malformed annotations; the annotation "
        "completeness investigation described above; construction of the "
        "source-aware supervision manifest; repair of malformed annotation "
        "geometry; group-aware splitting; independent leakage verification "
        "run against the finished splits rather than against the splitting "
        "code; and final audit and export to Ultralytics YOLO format.",

        "The raw corpus was treated as read-only throughout. No stage "
        "modified a source file in place.",
    ],
    "3.2.2 Data Augmentation": [
        "Augmentation was applied online during training. Two intensity "
        "levels were used across the experimental programme, both recorded "
        "in each run's own configuration file.",
        ("TABLE", "aug"),
        "The HSV, rotation and erasing settings simulate real in-cabin "
        "failure modes: exposure swings between daylight and dashboard "
        "lighting, head rotation, and partial occlusion of the face by "
        "hands, spectacles or seat-belt hardware.",

        "The compositing augmentations - mosaic, mixup, cutmix and "
        "copy_paste - were disabled in every run at both intensity levels. "
        "This is a structural decision rather than a tuning choice. Each of "
        "these operations builds a training image by combining regions from "
        "several source images. In a corpus where supervision "
        "trustworthiness is a property of the source family, compositing "
        "destroys exactly that property: a mosaic tile assembled from an "
        "eye-only image and a yawn-only image produces a composite whose "
        "correct supervision mask is undefined. Compositing and source-aware "
        "label handling are therefore mutually exclusive, and source "
        "awareness was the more valuable of the two.",
    ],
    "3.2.3 Splitting and Class Distribution": [
        "Splitting was group-aware. Because the corpus includes "
        "video-derived session recordings, adjacent frames from one session "
        "are near-duplicates. A naive random split would place near-identical "
        "frames on both sides of the train and test boundary, producing a "
        "test score that measures memorisation rather than generalisation. "
        "Frames belonging to the same session were therefore constrained to "
        "the same split, and the resulting partition was verified for "
        "leakage by a separate, independent procedure.",
        ("TABLE", "dataset"),
        "The class distribution is close to uniform: the largest class "
        "accounts for 36.1 % of instances and the smallest for 31.7 %. No "
        "class-rebalancing procedure was therefore required or applied, "
        "since a spread of 4.4 percentage points does not constitute the "
        "imbalance that would justify resampling or loss reweighting.",
        ("FIG", _CHARTS_480 / "09_test_set_class_distribution.png", "3.1",
         "Class distribution of the held-out test partition"),
    ],
    "3.3 Temporal Fatigue Estimation": [
        "Per-frame detection alone does not constitute drowsiness detection. "
        "A single frame in which the eyes are closed is indistinguishable "
        "from an ordinary blink; what separates a blink from a microsleep is "
        "duration. The detector's per-frame output is therefore aggregated "
        "over time before any driver-state decision is made.",
    ],
    "3.3.1 PERCLOS": [
        "The aggregation measure is PERCLOS - the proportion of a time "
        "window during which the eyes are closed. PERCLOS was established as "
        "the fraction of a one-minute interval in which the eyelid covers "
        "more than 80 % of the pupil, and has been repeatedly validated as "
        "among the most reliable behavioural indicators of alertness.",

        "In this project PERCLOS is computed over a rolling window of recent "
        "frames from the ratio of closed_eye to open_eye detections, rather "
        "than from eyelid-aperture measurement, because the detector's output "
        "is discrete class evidence rather than a continuous aperture value.",
    ],
    "3.3.2 Driver-State Decision": [
        "A debounced state machine converts the rolling PERCLOS value and "
        "yawn frequency into a discrete driver state with escalating alert "
        "levels. Debouncing is required because raw per-frame detection is "
        "noisy: a single misdetection must not be able to trigger an alarm, "
        "and a genuine microsleep must not be cancelled by a single "
        "recovered frame.",

        "The temporal reasoning implemented in this project is rolling-window "
        "aggregation with debounced state transitions. Learned temporal "
        "modelling - recurrent or sequence architectures trained on temporal "
        "data - was not implemented and is identified as future work in "
        "Chapter (5). This distinction is maintained deliberately throughout "
        "this document.",
    ],
    "3.4 Detection Architectures": [
        "Four architecture families were evaluated, spanning the meaningful "
        "axes of the design space: single-stage convolutional, "
        "transformer-based set prediction, and two-stage proposal and "
        "refinement. Within the single-stage families two capacities each "
        "were trained, so that the accuracy contribution of model size could "
        "be separated from that of architecture generation.",
        ("TABLE", "arch"),
    ],
    "3.4.1 YOLO26": [
        "YOLO26 is the most recent single-stage family evaluated and "
        "provided both models selected for deployment. Two capacities were "
        "trained: YOLO26n at 2.50 M parameters and YOLO26s at 9.95 M.",

        "The property that made this family decisive for deployment is that "
        "its export path produces an ONNX graph with non-maximum suppression "
        "compiled into the graph itself. The exported model emits a fixed "
        "tensor of 300 already-suppressed detections, each row giving box "
        "coordinates, confidence and class index. For browser deployment "
        "this removes an entire post-processing stage from the client, which "
        "would otherwise run suppression in JavaScript on every frame.",
    ],
    "3.4.2 YOLOv11": [
        "Two YOLOv11 capacities were trained as comparison points: YOLO11n "
        "at 2.59 M parameters and YOLO11m at 20.05 M. The YOLOv11 family is "
        "well represented in the driver-monitoring literature, which makes it "
        "a meaningful reference against which a newer architecture can be "
        "judged.",
    ],
    "3.4.3 RF-DETR": [
        "RF-DETR is a real-time detection transformer built on a "
        "vision-transformer backbone, representing the DETR architectural "
        "family rather than the single-stage convolutional lineage. Two "
        "capacities were evaluated: RF-DETR-Nano at 30.15 M parameters and "
        "RF-DETR-Small at 32.02 M.",

        "Transformer detectors dispense with hand-designed anchors and with "
        "non-maximum suppression, instead predicting a fixed set of object "
        "queries matched to ground truth during training. Their inclusion "
        "tests whether that architectural difference translates into "
        "measurable advantage on this task.",
    ],
    "3.4.4 Simplified Faster R-CNN Implemented From Scratch": [
        "A two-stage detector was additionally implemented from first "
        "principles, without a detection framework, as an educational and "
        "comparative exercise. Its design follows the Faster R-CNN pattern: "
        "a custom convolutional backbone of four blocks at stride 16 "
        "produces a feature map from a 640-pixel input; a region proposal "
        "network over 14,400 anchors predicts objectness and box offsets; "
        "decoding and suppression yield approximately 1,000 proposals; RoI "
        "alignment extracts fixed-size features per proposal; and a "
        "fully-connected head produces class scores and box refinements.",

        "The model is trained against four simultaneous losses - region "
        "proposal objectness, region proposal box regression, detection "
        "classification, and detection box regression - over 50 epochs, and "
        "classifies three foreground classes plus an explicit background "
        "class.",

        "This model was developed on a separate track and evaluated on a "
        "test partition of 5,705 images, whereas all other architectures in "
        "this study were evaluated on the 5,589-image partition defined in "
        "Section 3.2.3. Its results are therefore reported separately in "
        "Chapter (4) and are not entered into the comparative ranking, "
        "because the two figures are not measured on the same data.",
    ],
    "3.5 Training Protocol": [
        "All training and evaluation was performed on a single NVIDIA RTX "
        "2000 Ada Generation GPU with 17.18 GB of VRAM, under Windows, using "
        "Python 3.11.15, PyTorch 2.6.0 with CUDA 12.4, and Ultralytics "
        "8.4.64.",
        ("TABLE", "hyper"),
        "Input resolutions of 384, 480, 640 and 960 pixels were used across "
        "the programme, allowing the accuracy cost of reduced input size - "
        "the principal lever available for deployment on constrained "
        "hardware - to be measured directly rather than assumed.",

        "One implementation constraint applied throughout. The number of "
        "data-loading worker processes was held at two for most runs; higher "
        "counts caused repeated data-loader failures on the training "
        "platform, and two was the only value verified stable across every "
        "batch size used.",
    ],
    "3.6 Evaluation Protocol": [],
    "3.6.1 Metrics": [
        "All models were evaluated on the held-out test split of 5,589 "
        "images containing 7,427 ground-truth instances, at an IoU threshold "
        "of 0.5 and an operating confidence of 0.35.",

        "The primary metric is mAP@0.5, the mean over classes of average "
        "precision at IoU 0.5. Average precision integrates over the full "
        "precision-recall curve and is therefore independent of the "
        "operating confidence threshold. Precision, recall, F1 and the "
        "confusion matrix are threshold-dependent and are reported at the "
        "0.35 operating point.",

        "Per-class average precision is reported alongside the mean "
        "throughout, because the three classes are not equally important to "
        "the application: closed_eye is the class from which microsleep "
        "evidence is derived, and a mean that concealed a regression on that "
        "class would be misleading.",
    ],
    "3.6.2 Label-Gap-Corrected Evaluation": [
        "The systematic missing supervision described in Section 3.1.2 "
        "distorts evaluation as well as training. When a model correctly "
        "detects a yawning driver in an image drawn from a source family "
        "that never annotated yawns, the standard protocol scores that "
        "correct detection as a false positive, because no matching "
        "ground-truth box exists. Precision is therefore understated by an "
        "amount that depends on which source families are present in the "
        "test set.",

        "A corrected metric is reported alongside the raw one. Under the "
        "correction, a prediction of a class that was never annotated "
        "anywhere in the source family that contributed the image is "
        "ignored - counted as neither a true nor a false positive. This is "
        "the standard convention for partially annotated data, equivalent to "
        "the iscrowd mechanism in the COCO protocol.",

        "Two properties of this correction matter. First, ground truth is "
        "never modified, so recall and false-negative counts are identical "
        "between the raw and corrected figures by construction; only "
        "precision, and the average precision derived from it, can differ. "
        "Second, the correction is scoped to the source family rather than "
        "to the individual image: a class is ignored on an image only if the "
        "entire family contributing that image contains no annotation of "
        "that class anywhere, and a minimum family size is required before "
        "the rule is applied at all, so that a small family cannot be "
        "misclassified as blind to a class by chance.",

        "On the test split this affects eye predictions on 1,039 images and "
        "yawn predictions on 699 images. The resulting difference is small - "
        "typically under half a percentage point of mAP@0.5 - but it is "
        "reported explicitly rather than silently, and both figures appear "
        "in Chapter (4).",
    ],
    "3.6.3 Evidence Integrity": [
        "Every evaluation reported in this document was produced by a single "
        "evaluation implementation, run over the same test partition, for "
        "every model. This uniformity was adopted deliberately after "
        "inherited evaluation records from an earlier phase of work were "
        "found to be unreliable: several chart images distributed across "
        "different models' result folders were byte-identical to one "
        "another, including a single confusion-matrix image shared across "
        "eleven runs spanning five different architectures with reported "
        "accuracies ranging from 66 % to 92 %. Such an image cannot "
        "represent all of those models.",

        "All results were therefore re-measured from the model checkpoints "
        "themselves, and the regenerated chart set was verified by content "
        "hashing to confirm that every model's figures are distinct. Where a "
        "required artefact genuinely could not be reconstructed - training "
        "histories for six runs whose per-epoch logs were not preserved - "
        "the absence is recorded explicitly in the results archive rather "
        "than filled with a substitute.",
    ],
    "3.7 Deployment Pipeline": [
        "The trained detector is deployed as an in-browser application, so "
        "that video never leaves the user's device. The pipeline exports the "
        "trained checkpoint to ONNX at the model's own training resolution "
        "with suppression compiled into the graph and the graph simplified; "
        "optionally converts to half precision, halving download size; "
        "serves the model as a static same-origin asset; and executes it in "
        "a dedicated worker thread through ONNX Runtime Web, using the "
        "WebGPU execution provider where available and multi-threaded "
        "WebAssembly as a fallback.",

        "Cross-origin isolation headers are required on every response, "
        "because multi-threaded WebAssembly depends on SharedArrayBuffer, "
        "which is unavailable to a page that is not cross-origin isolated.",

        "Two models were selected for deployment - YOLO26n at 480 pixels and "
        "YOLO26n at 960 pixels - forming a two-tier system in which the "
        "lighter model is the default and the heavier one an explicit "
        "higher-quality option. The measurements supporting that selection "
        "are presented in Chapter (4).",
    ],
}
