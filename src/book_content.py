"""
book_content.py — prose content for the project book
=====================================================
Held separate from build_book.py so that wording can be revised without
touching document-assembly logic.

Every quantitative statement here traces to a project artefact:
metrics.json files under INFO/, training configs under configs/,
results.csv training logs, INFO/_benchmark/latency.json, or BOOK.md.
Numbers are not restated from memory anywhere in this file; where a figure
appears in prose it also appears in a generated table built from the
source data, so the two can be checked against each other.
"""

ABSTRACT_EN = [
    "Driver fatigue is a persistent contributor to road traffic collisions, "
    "and its early behavioural indicators - prolonged eye closure and "
    "yawning - are observable from a single in-cabin camera. This project "
    "develops a complete vision-based driver monitoring system, from dataset "
    "construction through model selection to browser-based deployment.",

    "The work began from a 57,098-image corpus assembled from several "
    "independently annotated sources. Analysis established that the corpus "
    "was a merge of separate single-task datasets - an eye-state corpus, a "
    "yawning corpus, and driver-monitoring session recordings - combined into "
    "one three-class label space without re-annotation. This produced "
    "systematic, source-correlated missing supervision rather than random "
    "label noise. A structured reconciliation process, including human "
    "verification of sampled images against spatial evidence gates, produced "
    "a source-aware supervision manifest recording which classes each source "
    "family can be trusted to supervise. Group-aware splitting was applied so "
    "that near-duplicate frames from the same recording session could not "
    "span the training and test partitions, and the resulting split was "
    "independently verified for leakage. The final dataset contains 50,654 "
    "images and 68,292 annotated instances across the classes closed_eye, "
    "open_eye and yawning.",

    "Twenty-one training runs were carried out across four detection "
    "architecture families - YOLO26, YOLOv11, the transformer-based RF-DETR, "
    "and a simplified Faster R-CNN implemented from scratch - spanning 950 "
    "epochs and 277.57 GPU-hours, at input resolutions from 384 to 960 pixels "
    "and under two augmentation intensities. All models were evaluated under "
    "a single protocol on a held-out 5,589-image test partition, reporting "
    "both standard and label-gap-corrected metrics, the latter accounting for "
    "the partial annotation identified during dataset analysis.",

    "Two YOLO26n configurations were selected for deployment, at 480 and 960 "
    "pixel input, achieving 82.72 % and 82.75 % corrected mAP@0.5 "
    "respectively. Both were exported to ONNX with non-maximum suppression "
    "compiled into the graph and converted to half precision, halving model "
    "size with no measurable loss of detection agreement. The models execute "
    "entirely on the user's own device through a browser application using "
    "WebGPU with a multi-threaded WebAssembly fallback, so that video is "
    "never transmitted to any server.",

    "Temporal interpretation is performed by rolling-window PERCLOS "
    "aggregation with a debounced state machine. Learned temporal modelling "
    "using recurrent or sequence architectures was not implemented in this "
    "work and is identified as the next stage of development.",
]

ABSTRACT_AR = [
    "يمثل إرهاق السائق أحد الأسباب المستمرة لحوادث الطرق، ويمكن ملاحظة "
    "مؤشراته السلوكية المبكرة — إغلاق العينين لفترات طويلة والتثاؤب — من خلال "
    "كاميرا واحدة داخل المركبة. يقدم هذا المشروع نظامًا متكاملًا لمراقبة "
    "السائق يعتمد على الرؤية الحاسوبية، بدءًا من بناء مجموعة البيانات ومرورًا "
    "باختيار النموذج وانتهاءً بالنشر داخل المتصفح.",

    "بدأ العمل من مجموعة بيانات تضم 57,098 صورة جُمعت من عدة مصادر مُوسمة بشكل "
    "مستقل. أظهر التحليل أن هذه المجموعة كانت دمجًا لمجموعات بيانات أحادية "
    "المهمة — مجموعة لحالة العين، ومجموعة للتثاؤب، وتسجيلات لجلسات مراقبة "
    "السائق — دُمجت في فضاء تسميات ثلاثي الفئات دون إعادة توسيم. نتج عن ذلك "
    "نقص منهجي في الإشراف مرتبط بالمصدر وليس ضوضاء عشوائية في التسميات. وقد "
    "أنتجت عملية مراجعة منظمة، شملت تحققًا بشريًا من عينات من الصور، سجلًا "
    "للإشراف يراعي المصدر. كما طُبق تقسيم واعٍ بالمجموعات لمنع تسرب الإطارات "
    "المتشابهة بين مجموعتي التدريب والاختبار. تحتوي مجموعة البيانات النهائية "
    "على 50,654 صورة و68,292 حالة مُوسمة عبر الفئات: العين المغلقة، والعين "
    "المفتوحة، والتثاؤب.",

    "أُجريت إحدى وعشرون تجربة تدريب عبر أربع عائلات معمارية للكشف عن الأجسام — "
    "YOLO26 وYOLOv11 وRF-DETR القائم على المحوّلات، بالإضافة إلى نموذج "
    "Faster R-CNN مبسّط مُنفّذ من الصفر — بإجمالي 950 حقبة تدريبية و277.57 "
    "ساعة معالجة رسومية، وبدقات إدخال تتراوح بين 384 و960 بكسل. وقد قُيّمت "
    "جميع النماذج وفق بروتوكول موحّد على مجموعة اختبار مستقلة تضم 5,589 صورة.",

    "تم اختيار نموذجين من YOLO26n للنشر، بدقة إدخال 480 و960 بكسل، وحققا "
    "82.72٪ و82.75٪ على التوالي وفق مقياس mAP@0.5 المصحّح. وقد صُدّر كلا "
    "النموذجين إلى صيغة ONNX مع دمج خطوة الكبت غير الأقصى داخل الرسم البياني، "
    "وتحويلهما إلى دقة نصفية، مما خفّض حجم النموذج إلى النصف دون خسارة تُذكر "
    "في دقة الكشف. ويجري تنفيذ النماذج بالكامل على جهاز المستخدم عبر تطبيق "
    "يعمل في المتصفح، بحيث لا يُنقل الفيديو إلى أي خادم خارجي.",

    "يتم التفسير الزمني عبر تجميع PERCLOS ضمن نافذة متحركة مع آلة حالة "
    "مُثبّتة. أما النمذجة الزمنية المُتعلّمة باستخدام المعماريات التكرارية أو "
    "التسلسلية فلم تُنفّذ في هذا العمل، وقد حُدّدت كمرحلة تطوير لاحقة.",
]

ACKNOWLEDGMENTS = [
    "We express our sincere gratitude to our supervisor, Prof. Dr. Kamel "
    "Elhadad, for his guidance and technical direction throughout this "
    "project. His supervision shaped both the engineering decisions and the "
    "standard of evidence applied to them.",

    "We thank the Military Technical College, Department of Computer "
    "Engineering and Artificial Intelligence, for providing the academic "
    "framework and the computational resources without which the "
    "experimental programme described in this document would not have been "
    "possible.",

    "We also acknowledge the Digilians (Digital Pioneers) Initiative, within "
    "which this work was conducted, for the training and the opportunity it "
    "provided.",
]

ABBREVIATIONS = [
    ("ADAS", "Advanced Driver Assistance System"),
    ("AMP", "Automatic Mixed Precision"),
    ("AP", "Average Precision"),
    ("CNN", "Convolutional Neural Network"),
    ("COCO", "Common Objects in Context"),
    ("DETR", "Detection Transformer"),
    ("DFL", "Distribution Focal Loss"),
    ("FP16", "Half-Precision Floating Point"),
    ("FP32", "Single-Precision Floating Point"),
    ("FPS", "Frames Per Second"),
    ("GPU", "Graphics Processing Unit"),
    ("IoU", "Intersection over Union"),
    ("mAP", "mean Average Precision"),
    ("NMS", "Non-Maximum Suppression"),
    ("ONNX", "Open Neural Network Exchange"),
    ("PERCLOS", "Percentage of Eye Closure"),
    ("RoI", "Region of Interest"),
    ("RPN", "Region Proposal Network"),
    ("SAOD", "Sparsely Annotated Object Detection"),
    ("VRAM", "Video Random Access Memory"),
    ("WASM", "WebAssembly"),
    ("YOLO", "You Only Look Once"),
]

# ---------------------------------------------------------------- Chapter 1

CH1 = {
    "1.1 Overview": [
        "Driver fatigue is a recognised and persistent contributor to road "
        "traffic collisions. Unlike mechanical failure, it develops gradually "
        "and is frequently unrecognised by the driver until control is "
        "already degraded. Its value as a target for automated detection "
        "comes from the fact that it is expressed physically before it "
        "becomes catastrophic: the eyes close for longer than a blink, the "
        "rate of yawning rises, and both are visible to a camera positioned "
        "inside the vehicle cabin.",

        "This project develops a driver monitoring system that observes those "
        "cues in real time using computer vision. A detection model locates "
        "and classifies three visual states - a closed eye, an open eye, and "
        "a yawning mouth - in each video frame. A temporal layer converts "
        "that per-frame evidence into a fatigue assessment, because a single "
        "frame showing closed eyes is indistinguishable from an ordinary "
        "blink; only duration separates the two.",

        "The system is designed to run entirely on the user's own device "
        "through a web browser. This is a deliberate architectural "
        "constraint rather than a convenience: a driver monitoring system "
        "processes continuous video of a person's face, and transmitting "
        "that video to a remote server introduces both a privacy exposure "
        "and a latency dependency on network conditions that a safety system "
        "should not carry.",
    ],
    "1.2 Problem Statement": [
        "Building such a system presents three coupled problems.",

        "The first is data. Publicly available driver-monitoring datasets are "
        "typically annotated for a single task - either eye state or yawning, "
        "rarely both - and are frequently derived from video, which means "
        "consecutive frames are near-duplicates of one another. Assembling a "
        "corpus large enough to train a detector therefore requires merging "
        "sources, and merging sources annotated for different tasks "
        "introduces a form of label incompleteness that is systematic rather "
        "than random.",

        "The second is model selection under deployment constraints. A model "
        "intended to run in a browser on unknown consumer hardware is "
        "constrained not only by accuracy but by download size, memory "
        "footprint, and inference latency. The most accurate model available "
        "is not necessarily the correct choice.",

        "The third is evaluation integrity. When a dataset contains "
        "systematic missing annotation, a correct detection of an unlabelled "
        "object is scored as an error. Any accuracy figure computed without "
        "accounting for this is misleading, and comparisons between models "
        "built on such figures are unreliable.",
    ],
    "1.3 Objectives": [
        "The objectives of this project are:",

        "1. To construct a leakage-free, three-class object detection dataset "
        "for driver drowsiness from heterogeneous merged sources, and to "
        "characterise and account for the annotation incompleteness that "
        "merging introduces.",

        "2. To train and comparatively evaluate detection architectures "
        "spanning single-stage convolutional, transformer-based, and "
        "two-stage designs, under a single consistent evaluation protocol.",

        "3. To quantify the accuracy cost of reduced input resolution, which "
        "is the principal lever available for deployment on constrained "
        "devices.",

        "4. To select and export models suitable for real-time in-browser "
        "inference, and to verify that the export and precision-reduction "
        "steps do not degrade detection behaviour.",

        "5. To implement a temporal interpretation layer converting per-frame "
        "detections into a fatigue state.",
    ],
    "1.4 Scope": [
        "This project covers dataset construction and auditing, model "
        "training and comparative evaluation, model export and precision "
        "conversion, latency measurement, and browser-based deployment with "
        "temporal fatigue estimation.",

        "It does not cover physiological sensing of any kind - "
        "electroencephalography, heart-rate monitoring, or steering-input "
        "analysis - all of which appear in the wider driver-monitoring "
        "literature but fall outside a camera-only approach. It does not "
        "cover in-vehicle hardware integration. Learned temporal modelling "
        "using recurrent or sequence architectures is identified as future "
        "work and was not implemented.",
    ],
    "1.5 Research Questions": [
        "The work is organised around four questions:",

        "RQ1. How can a usable detection dataset be constructed from merged "
        "single-task sources, and what is the measurable effect of the "
        "resulting annotation incompleteness on reported accuracy?",

        "RQ2. Which detection architecture family offers the best accuracy "
        "for this task, and does architectural novelty translate into "
        "measurable advantage?",

        "RQ3. What accuracy is lost by reducing input resolution, and does "
        "that loss justify the deployment benefit it is assumed to provide?",

        "RQ4. Does half-precision conversion, applied to reduce model "
        "download size, measurably change detection behaviour?",
    ],
    "1.6 Solution Approach": [
        "The approach proceeds in four stages. The corpus is first audited "
        "and reconstructed, producing a source-aware record of which classes "
        "each contributing source can be trusted to supervise, together with "
        "a group-aware partition that prevents near-duplicate frames from "
        "spanning the train and test boundary.",

        "Twenty-one training runs are then carried out across four "
        "architecture families and four input resolutions, and all are "
        "evaluated under one protocol on the same held-out partition, with "
        "both standard and annotation-corrected metrics reported.",

        "Two configurations are selected for deployment on the basis of "
        "accuracy, size and measured latency together. These are exported to "
        "ONNX with suppression compiled into the graph, converted to half "
        "precision, and verified against their full-precision counterparts "
        "on real test images before release.",

        "The exported models are executed in a browser through a dedicated "
        "worker thread, and their per-frame output is aggregated by a "
        "rolling-window fatigue estimator with debounced state transitions.",
    ],
    "1.7 Document Organisation": [
        "Chapter (2) reviews related work in vision-based driver monitoring. "
        "Chapter (3) describes the dataset, its construction, the "
        "architectures evaluated, and the training and evaluation protocols. "
        "Chapter (4) presents the experimental results, the measured "
        "performance characteristics, and the deployed system. Chapter (5) "
        "states the conclusions and identifies future work.",
    ],
}

# ---------------------------------------------------------------- Chapter 5

CH5 = {
    "5.1 Conclusions": [
        "This project set out to build a camera-only driver drowsiness "
        "detection system capable of running on a user's own device, and to "
        "do so on evidence that could be independently checked. Both the "
        "system and the evidence base were delivered.",

        "On dataset construction, the central finding was that the working "
        "corpus was not one dataset but several single-task datasets merged "
        "into a shared label space without re-annotation. This produced "
        "missing supervision that is systematic and correlated with the "
        "source of each image, not random noise. Recognising this changed "
        "both training and evaluation: compositing augmentations were "
        "structurally excluded because they destroy source identity, and a "
        "corrected evaluation metric was introduced that ignores predictions "
        "of classes a source family never annotated. The final dataset "
        "comprises 50,654 images and 68,292 instances, partitioned "
        "group-aware and independently verified against leakage.",

        "On architecture selection, twenty-one runs across four families "
        "showed that architectural novelty did not automatically produce "
        "advantage on this task. The transformer-based RF-DETR models, "
        "despite being an order of magnitude larger in parameter count than "
        "the YOLO26n models, did not outperform them. The strongest single "
        "accuracy result came from a warm-started YOLO11m run that reached "
        "the highest mAP@0.5 in the study in only 15 epochs, demonstrating "
        "that initialisation strategy mattered more than training duration.",

        "On the resolution question, the finding was more consequential than "
        "expected. Reducing input resolution from 960 to 480 pixels cost "
        "essentially nothing in aggregate accuracy - 82.75 % against 82.72 % "
        "corrected mAP@0.5 - but the assumption that this would translate "
        "into a proportional latency saving proved false when measured. On "
        "GPU at batch size one, inference is dominated by fixed overhead "
        "rather than by pixel count, and the two resolutions perform "
        "comparably. The measurable advantage of the smaller input appears "
        "on CPU, where computation genuinely dominates. This is a case where "
        "a plausible inference from first principles was contradicted by "
        "direct measurement, and it is recorded as such.",

        "The aggregate figures also concealed a per-class trade that matters "
        "for the application: the 960-pixel model is meaningfully stronger on "
        "closed_eye, the class from which microsleep evidence is derived, "
        "while the 480-pixel model is stronger on yawning. Both models were "
        "therefore deployed as an explicit two-tier choice rather than one "
        "being declared a replacement for the other.",

        "On deployment, half-precision conversion halved model size with no "
        "meaningful behavioural change, verified by matching detections "
        "between precisions on real test images rather than assumed from the "
        "numerical properties of the format.",

        "Finally, the project treated evidence integrity as a technical "
        "requirement. Inherited evaluation records from an earlier phase were "
        "found to contain chart images duplicated across models that could "
        "not possibly share them, and all results were consequently "
        "re-measured under a single protocol and verified distinct. Where an "
        "artefact could not be honestly reconstructed, its absence was "
        "recorded rather than substituted.",
    ],
    "5.2 Limitations": [
        "The dataset is assembled from heterogeneous sources rather than "
        "collected under controlled conditions, and its images are "
        "predominantly still photography rather than continuous in-vehicle "
        "video. Performance on sustained real driving footage is therefore "
        "not established by the results presented here.",

        "Training histories for six of the twenty-one runs were not "
        "preserved and could not be reconstructed, so loss curves are absent "
        "for those runs. The models themselves were re-evaluated directly "
        "from their checkpoints and are unaffected.",

        "The from-scratch Faster R-CNN was evaluated on a test partition of "
        "5,705 images rather than the 5,589-image partition used for all "
        "other models. Its results are reported separately and are not "
        "directly comparable.",

        "Latency was measured on desktop hardware using PyTorch and ONNX "
        "Runtime. Browser WebGPU performance, which is what the deployed "
        "system actually experiences, was not measured within the scope of "
        "this document.",

        "Training duration figures for ten of the runs are self-reported "
        "from run summaries rather than machine-logged, and are labelled as "
        "such wherever they appear.",
    ],
    "5.3 Future Work": [
        "The most direct extension is learned temporal modelling. The "
        "present system aggregates per-frame detections using a "
        "rolling-window PERCLOS estimate with debounced transitions, which "
        "is effective but hand-designed. Recurrent or sequence architectures "
        "trained directly on temporal sequences would allow the fatigue "
        "signal itself to be learned rather than specified.",

        "Second, in-browser latency measurement on real target devices, "
        "particularly low-end mobile hardware, would replace the desktop "
        "proxy figures reported here with measurements from the deployment "
        "environment.",

        "Third, integer quantisation was deliberately deferred in this work "
        "pending finalisation of the model selection. With deployment "
        "candidates now fixed, calibrated INT8 quantisation is a realistic "
        "next step for further reducing model size, subject to per-class "
        "accuracy verification.",

        "Fourth, evaluation against an independently collected in-vehicle "
        "video dataset would test generalisation beyond the merged corpus "
        "used here.",
    ],
}
