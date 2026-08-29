"""
English / Arabic translation layer.

Flat dotted keys, one dict per language. `t()` falls back EN -> raw key, so a
missing Arabic string degrades to readable English rather than a KeyError in
the middle of a render.

KNOWN LIMIT, SURFACED IN THE UI RATHER THAN HIDDEN
==================================================
The HUD burned into the video frames stays English in both languages.
`cv2.putText` renders ASCII glyphs only -- it has no Arabic shaping or bidi
support, so Arabic text would come out as disconnected, reversed boxes. Doing
it properly needs PIL + arabic_reshaper + python-bidi, none of which are in the
offline wheelhouse. The About page says this plainly.
"""

from __future__ import annotations

import streamlit as st

DEFAULT_LANG = "en"
LANGUAGES = {"en": "English", "ar": "العربية"}

EN: dict[str, str] = {
    # chrome
    "app.title": "Drowsiness Detection Platform",
    "app.subtitle": "Real-time driver fatigue analysis",
    "nav.video": "Video Analysis",
    "nav.webcam": "Live Camera",
    "nav.models": "Models",
    "nav.about": "About",

    # sidebar
    "side.language": "Language",
    "side.theme": "Theme",
    "side.theme.dark": "Dark",
    "side.theme.neon": "Neon",
    "side.theme.light": "Light",
    "side.model": "Detection model",
    "side.sort_accuracy": "Sort by accuracy (best first)",
    "side.settings": "Detection settings",
    "bench.title": "Benchmark",
    "bench.subtitle": "Inference speed measured on this machine, not estimated.",
    "bench.device": "Device",
    "bench.backend": "Backend",
    "bench.models": "Models",
    "bench.select": "Models to benchmark",
    "bench.reps": "Timed runs",
    "bench.reps.help": "More runs give a steadier median but take longer.",
    "bench.use_tuned": "Use tuned batch",
    "bench.use_tuned.help": (
        "Also time each model at its auto-tuned batch size, so the gain from "
        "batching is visible next to the single-frame baseline."
    ),
    "bench.run": "Run benchmark",
    "bench.tune_all": "Auto-tune selected",
    "bench.tuning": "Tuning",
    "bench.timing": "Timing",
    "bench.tune_done": "Auto-tuning complete.",
    "bench.download": "Download CSV",
    "bench.col.model": "Model",
    "bench.col.family": "Family",
    "bench.col.input": "Input",
    "bench.col.size": "Size (MB)",
    "bench.col.b1ms": "1-frame ms",
    "bench.col.b1fps": "1-frame FPS",
    "bench.col.batch": "Batch",
    "bench.col.bms": "Batched ms",
    "bench.col.bfps": "Batched FPS",
    "bench.col.gain": "Gain",
    "bench.col.map": "mAP50 (%)",
    "bench.col.reason": "Basis",
    "bench.axis.fps": "Frames per second (higher is better)",
    "bench.axis.map": "mAP@50 corrected (%)",
    "bench.note": (
        "Timing covers the model forward pass only, on a synthetic frame at "
        "each model's own input size. It excludes video decoding and overlay "
        "rendering, so it is not directly comparable with the throughput "
        "shown on the Video page. CUDA is synchronised around every "
        "measurement."
    ),
    "bench.tuned_title": "Stored batch tuning",
    "bench.tuned_note": (
        "Per-model batch sizes measured on this device. Batching helps models "
        "that do not saturate the GPU at one frame at a time and slightly "
        "hurts larger ones, so a model whose sweep found no gain stays at 1."
    ),
    "bench.no_tuning": "No models tuned yet.",
    "side.top4": "Top 4 - real accuracy",
    "side.top4.note": (
        "Ranked by measured mAP@50 on the held-out test set. The % drawn on "
        "a bounding box is the model's confidence, not its accuracy - the two "
        "rank differently."
    ),
    "side.performance": "Performance",
    "side.batch": "Batched inference",
    "side.batch.help": (
        "Group frames into one inference call. Measured per model: it is a "
        "large win for small/low-resolution models that do not saturate the "
        "GPU at one frame at a time, and slightly slower for larger ones, so "
        "each model uses its own measured batch size and untuned models stay "
        "at 1."
    ),
    "side.batch.tuned": "Tuned batch",
    "side.batch.untuned": "Not tuned yet - using batch 1",
    "side.autotune": "Auto-tune this model",
    "side.autotune.help": (
        "Time a short batch-size sweep on this machine and remember the "
        "fastest setting for the selected model."
    ),
    "side.autotune.running": "Measuring batch sizes...",
    "side.autotune.failed": "Auto-tune failed",
    "side.autotune.nomodel": "Select a model first.",
    "side.half": "FP16 inference",
    "side.half.help": (
        "Run inference in half precision. On the GPU measured here it gave no "
        "speed-up (these models are launch-overhead-bound, not compute-bound), "
        "but it reduces GPU memory and can help on compute-bound hardware."
    ),
    "side.half.cpu": "No CUDA device - FP16 is ignored on CPU.",
    "side.alerts": "Alerts",
    "side.conf": "Confidence threshold",
    "side.conf.help": "Minimum score for a detection to count. Lower finds more, with more false positives.",
    "side.window": "PERCLOS window (frames)",
    "side.window.help": "How many recent frames the fatigue score averages over.",
    "side.warn_thr": "Warning threshold",
    "side.crit_thr": "Critical threshold",
    "side.hold": "Critical hold (seconds)",
    "side.hold.help": "Fatigue must stay above the critical threshold this long before escalating.",
    "side.hud_pos": "HUD Overlay Position",
    "side.hud_pos.top-right": "Top Right (Default)",
    "side.hud_pos.top-left": "Top Left",
    "side.hud_pos.bottom-right": "Bottom Right",
    "side.hud_pos.bottom-left": "Bottom Left",
    "side.hud_pos.auto": "Auto (Smart Avoid)",
    "side.hud_pos.off": "Off / Hidden",
    "side.sound": "Alert sounds",
    "side.test_sound": "Test alert sound",
    "side.test_sound.help": "Plays a cue now. Also primes the browser so later alerts are not blocked.",
    "side.device": "Compute device",
    "side.reset": "Reset to defaults",

    # video page
    "video.title": "Video Analysis",
    "video.upload": "Upload a video",
    "video.upload.help": "mp4, avi, mov, mkv, webm, wmv, flv and more.",
    "video.or_path": "Or analyse a file already on this computer",
    "video.path_ph": "C:\\path\\to\\video.mp4",
    "video.source": "Source",
    "video.resolution": "Resolution",
    "video.duration": "Duration",
    "video.fps": "Frame rate",
    "video.codec": "Codec",
    "video.frames": "Frames",
    "video.limit": "Analyse first N seconds",
    "video.limit.help": "Processing runs at roughly real-time on GPU and far slower on CPU. Keep this short for a quick look.",
    "video.run": "Run detection",
    "video.cancel": "Cancel",
    "video.stop": "Stop Analysis",
    "video.restart": "Restart / Clear",
    "video.processing": "Analysing",
    "video.eta": "Estimated time remaining",
    "video.done": "Analysis complete",
    "video.cancelled": "Cancelled — partial results below.",
    "video.no_file": "Upload a video or enter a file path to begin.",
    "video.player": "Result",
    "video.view_mode": "Display mode",
    "video.view.annotated": "Annotated (ADAS)",
    "video.view.raw": "Original Raw",
    "video.view.split": "Side-by-Side Split",
    "video.engine": "Player type",
    "video.engine.custom": "ADAS Player",
    "video.engine.native": "Native Player",
    "video.jump_event": "Jump to Critical Event",
    "video.jump_peak": "Jump to Peak Fatigue",
    "video.size": "Player size",
    "video.size.small": "Small",
    "video.size.medium": "Medium",
    "video.size.large": "Large",
    "video.download_video": "Download video",
    "video.download_csv": "Download event log (CSV)",
    "video.download_json": "Download telemetry (JSON)",
    "video.download_report": "Download Driver Report (HTML)",
    "video.download_report.help": (
        "Full safety report: grade, fatigue summary, every micro-event with "
        "its duration and severity, and the recommendations. Opens in any "
        "browser and prints cleanly."
    ),
    "video.filter_events": "Filter events",
    "video.filter.all": "All",
    "video.filter.warn_crit": "Warnings & Critical",
    "video.filter.crit": "Critical only",
    "video.jump_select": "Jump to event timestamp",
    "video.events": "Event log",
    "video.timeline": "Fatigue timeline",
    "video.no_events": "No drowsiness events detected.",

    # metrics
    "m.peak_fatigue": "Peak fatigue",
    "m.mean_fatigue": "Average fatigue",
    "m.time_warning": "Time in warning",
    "m.time_critical": "Time in critical",
    "m.micro_blinks": "Micro-blinks",
    "m.micro_sleeps": "Micro-sleeps",
    "m.full_closures": "Full closures",
    "m.yawns": "Yawns",
    "m.longest_closure": "Longest closure",
    "m.detections": "Total detections",
    "m.speed": "Processing speed",
    "m.frames": "Frames analysed",
    "m.fatigue": "Fatigue",
    "m.status": "Status",
    "m.frame": "Frame",

    # events
    "event.micro_blink": "Micro-blink",
    "event.micro_sleep": "Micro-sleep",
    "event.full_closure": "Full eye closure",
    "event.yawn": "Yawn",
    "event.kind": "Event",
    "event.start": "Start",
    "event.end": "End",
    "event.duration": "Duration",
    "event.severity": "Severity",
    "sev.info": "Info",
    "sev.warning": "Warning",
    "sev.critical": "Critical",

    # alert levels
    "level.SAFE": "Safe",
    "level.WARNING": "Warning",
    "level.CRITICAL": "Critical",
    "alert.warning.msg": "Drowsiness detected — driver attention declining.",
    "alert.critical.msg": "CRITICAL — sustained drowsiness. Driver should stop.",

    # webcam
    "cam.title": "Live Camera",
    "cam.select": "Camera",
    "cam.start": "Start camera",
    "cam.stop": "Stop",
    "cam.starting": "Starting camera…",
    "cam.none": "No camera found. Check that one is connected and not in use by another app.",
    "cam.idle": "Camera stopped. Press start to begin live analysis.",
    "cam.recent": "Recent events",
    "cam.snapshot": "Save snapshot",

    # models
    "models.title": "Models",
    "models.subtitle": "All detection models available in this platform",
    "models.compare": "Per-class accuracy comparison",
    "models.missing": "Registered but not installed",
    "models.map50": "mAP@50",
    "models.map50c": "mAP@50 (corrected)",
    "models.precision": "Precision",
    "models.recall": "Recall",
    "models.f1": "F1",
    "models.size": "File size",
    "models.res": "Input resolution",
    "models.epochs": "Epochs",
    "models.optimizer": "Optimizer",
    "models.train_time": "Training time",
    "models.not_measured": "Not measured",
    "models.best": "Best on test",

    # classes
    "class.closed_eye": "Closed eye",
    "class.open_eye": "Open eye",
    "class.yawning": "Yawning",

    # about
    "about.title": "About this platform",
    "about.how": "How it works",
    "about.how.body": (
        "Each video frame is passed through a YOLO detector trained on three classes: "
        "closed eye, open eye, and yawning. Detections feed a PERCLOS-style rolling "
        "window that estimates fatigue over the last N frames."
    ),
    "about.scoring": "Fatigue scoring",
    "about.scoring.body": (
        "Every frame containing a closed eye contributes 0.70; a frame with a yawn but "
        "no closed eye contributes 0.30; open eyes contribute nothing. The score is the "
        "average across the window. Warning triggers at 0.40, critical at 0.65 sustained "
        "for 1.5 seconds."
    ),
    "about.events": "Event definitions",
    "about.events.body": (
        "Consecutive closed-eye frames are grouped into events and classified by duration, "
        "measured from true video timestamps: under 0.30 s is a micro-blink (normal), "
        "0.30–2.0 s is a micro-sleep (dangerous), over 2.0 s is a full closure (critical). "
        "A run must last at least 2 frames to count, which suppresses single-frame noise."
    ),
    "about.classes": "Detection classes",
    "about.limits": "Known limitations",
    "about.limits.hud": (
        "The overlay burned into the video stays in English in both languages. The drawing "
        "library renders ASCII only and cannot shape Arabic script correctly."
    ),
    "about.limits.acc": (
        "Accuracy figures come from the project's held-out test split and are reproduced "
        "here as measured. They are not recomputed by this application."
    ),
    "about.env": "Environment",
    "about.provenance": "Code provenance",
    "about.provenance.body": (
        "The detection renderer and PERCLOS scoring are vendored from the parent research "
        "project so this folder runs standalone. The scoring maths is unchanged, so numbers "
        "match the project's own experiments."
    ),

    # misc
    "common.seconds": "seconds",
    "common.frames": "frames",
    "common.of": "of",
    "common.yes": "Yes",
    "common.no": "No",
    "common.none": "None",
}

AR: dict[str, str] = {
    "app.title": "منصة كشف النعاس",
    "app.subtitle": "تحليل إرهاق السائق في الوقت الفعلي",
    "nav.video": "تحليل الفيديو",
    "nav.webcam": "الكاميرا المباشرة",
    "nav.models": "النماذج",
    "nav.about": "حول",

    "side.language": "اللغة",
    "side.theme": "المظهر",
    "side.theme.dark": "داكن",
    "side.theme.neon": "نيون",
    "side.theme.light": "فاتح",
    "side.model": "نموذج الكشف",
    "side.sort_accuracy": "الترتيب حسب الدقة (الأفضل أولاً)",
    "side.settings": "إعدادات الكشف",
    "bench.title": "قياس الأداء",
    "bench.subtitle": "سرعة الاستدلال مقاسة على هذا الجهاز، وليست تقديرية.",
    "bench.device": "الجهاز",
    "bench.backend": "الواجهة الخلفية",
    "bench.models": "النماذج",
    "bench.select": "النماذج المراد قياسها",
    "bench.reps": "عدد القياسات",
    "bench.reps.help": "عدد أكبر يعطي وسيطًا أكثر ثباتًا لكنه يستغرق وقتًا أطول.",
    "bench.use_tuned": "استخدام الدفعة المعايرة",
    "bench.use_tuned.help": (
        "قياس كل نموذج أيضًا عند حجم الدفعة المعاير تلقائيًا، لإظهار المكسب "
        "الناتج عن التجميع بجانب قياس الإطار الواحد."
    ),
    "bench.run": "تشغيل القياس",
    "bench.tune_all": "معايرة المحدد تلقائيًا",
    "bench.tuning": "جارٍ المعايرة",
    "bench.timing": "جارٍ القياس",
    "bench.tune_done": "اكتملت المعايرة التلقائية.",
    "bench.download": "تنزيل CSV",
    "bench.col.model": "النموذج",
    "bench.col.family": "العائلة",
    "bench.col.input": "الدقة",
    "bench.col.size": "الحجم (ميجابايت)",
    "bench.col.b1ms": "إطار واحد (مللي ثانية)",
    "bench.col.b1fps": "إطار واحد (إطار/ث)",
    "bench.col.batch": "الدفعة",
    "bench.col.bms": "مجمَّع (مللي ثانية)",
    "bench.col.bfps": "مجمَّع (إطار/ث)",
    "bench.col.gain": "المكسب",
    "bench.col.map": "mAP50 (٪)",
    "bench.col.reason": "الأساس",
    "bench.axis.fps": "إطار في الثانية (الأعلى أفضل)",
    "bench.axis.map": "mAP@50 المصحح (٪)",
    "bench.note": (
        "يشمل القياس تمرير النموذج الأمامي فقط، على إطار اصطناعي بدقة كل نموذج. "
        "ولا يشمل فك ترميز الفيديو ولا رسم الطبقة العلوية، لذا فهو غير قابل "
        "للمقارنة مباشرةً بالإنتاجية المعروضة في صفحة الفيديو. تتم مزامنة CUDA "
        "حول كل قياس."
    ),
    "bench.tuned_title": "معايرة الدفعات المحفوظة",
    "bench.tuned_note": (
        "أحجام الدفعات لكل نموذج مقاسة على هذا الجهاز. التجميع يفيد النماذج التي "
        "لا تُشبع المعالج الرسومي عند إطار واحد ويضر قليلًا بالنماذج الأكبر، لذا "
        "يبقى أي نموذج لم يُظهر مكسبًا عند 1."
    ),
    "bench.no_tuning": "لم تتم معايرة أي نموذج بعد.",
    "side.top4": "أفضل 4 - الدقة الحقيقية",
    "side.top4.note": (
        "مرتبة حسب mAP@50 المقاس على مجموعة الاختبار المستقلة. النسبة المرسومة "
        "على المربع المحيط هي ثقة النموذج وليست دقته - والترتيب يختلف بينهما."
    ),
    "side.performance": "الأداء",
    "side.batch": "الاستدلال المجمَّع",
    "side.batch.help": (
        "تجميع الإطارات في استدعاء استدلال واحد. تم قياسه لكل نموذج: مكسب كبير "
        "للنماذج الصغيرة ومنخفضة الدقة التي لا تُشبع المعالج الرسومي عند إطار "
        "واحد، وأبطأ قليلًا للنماذج الأكبر، لذا يستخدم كل نموذج حجم الدفعة "
        "المقاس الخاص به وتبقى النماذج غير المعايرة عند 1."
    ),
    "side.batch.tuned": "حجم الدفعة المعاير",
    "side.batch.untuned": "لم تتم المعايرة بعد - يُستخدم حجم 1",
    "side.autotune": "معايرة هذا النموذج تلقائيًا",
    "side.autotune.help": (
        "قياس سريع لأحجام الدفعات على هذا الجهاز وحفظ الأسرع للنموذج المحدد."
    ),
    "side.autotune.running": "جارٍ قياس أحجام الدفعات...",
    "side.autotune.failed": "فشلت المعايرة التلقائية",
    "side.autotune.nomodel": "اختر نموذجًا أولًا.",
    "side.half": "استدلال بدقة نصفية FP16",
    "side.half.help": (
        "تشغيل الاستدلال بدقة نصفية. على المعالج الرسومي المُختبَر هنا لم يقدّم "
        "أي تسريع (هذه النماذج مقيّدة بزمن إطلاق النواة لا بالحوسبة)، لكنه "
        "يقلّل استهلاك ذاكرة المعالج الرسومي وقد يفيد على العتاد المقيّد حوسبيًا."
    ),
    "side.half.cpu": "لا يوجد جهاز CUDA - يتم تجاهل FP16 على المعالج المركزي.",
    "side.alerts": "التنبيهات",
    "side.conf": "عتبة الثقة",
    "side.conf.help": "أقل درجة تُحتسب للكشف. القيمة الأقل تجد المزيد مع زيادة الإنذارات الخاطئة.",
    "side.window": "نافذة PERCLOS (إطارات)",
    "side.window.help": "عدد الإطارات الأخيرة التي يُحسب عليها متوسط الإرهاق.",
    "side.warn_thr": "عتبة التحذير",
    "side.crit_thr": "العتبة الحرجة",
    "side.hold": "مدة الثبات الحرجة (ثوانٍ)",
    "side.hold.help": "يجب أن يبقى الإرهاق فوق العتبة الحرجة هذه المدة قبل التصعيد.",
    "side.hud_pos": "موضع صندوق الـ HUD",
    "side.hud_pos.top-right": "أعلى اليمين (افتراضي)",
    "side.hud_pos.top-left": "أعلى اليسار",
    "side.hud_pos.bottom-right": "أسفل اليمين",
    "side.hud_pos.bottom-left": "أسفل اليسار",
    "side.hud_pos.auto": "تلقائي (تجنب السائق)",
    "side.hud_pos.off": "إخفاء الـ HUD",
    "side.sound": "أصوات التنبيه",
    "side.test_sound": "تجربة صوت التنبيه",
    "side.test_sound.help": "يشغّل نغمة الآن، ويهيّئ المتصفح حتى لا تُحجب التنبيهات لاحقًا.",
    "side.device": "جهاز المعالجة",
    "side.reset": "إعادة الضبط",

    "video.title": "تحليل الفيديو",
    "video.upload": "ارفع مقطع فيديو",
    "video.upload.help": "mp4 و avi و mov و mkv و webm و wmv و flv وغيرها.",
    "video.or_path": "أو حلّل ملفًا موجودًا على هذا الجهاز",
    "video.path_ph": "C:\\المسار\\إلى\\الفيديو.mp4",
    "video.source": "المصدر",
    "video.resolution": "الدقة",
    "video.duration": "المدة",
    "video.fps": "معدل الإطارات",
    "video.codec": "الترميز",
    "video.frames": "الإطارات",
    "video.limit": "حلّل أول عدد من الثواني",
    "video.limit.help": "المعالجة قريبة من الزمن الحقيقي على كرت الرسوميات وأبطأ بكثير على المعالج. أبقِ المدة قصيرة للمعاينة السريعة.",
    "video.run": "بدء التحليل",
    "video.cancel": "إلغاء",
    "video.stop": "إيقاف التحليل",
    "video.restart": "إعادة تعيين / جديد",
    "video.processing": "جارٍ التحليل",
    "video.eta": "الوقت المتبقي المقدّر",
    "video.done": "اكتمل التحليل",
    "video.cancelled": "تم الإلغاء — النتائج الجزئية أدناه.",
    "video.no_file": "ارفع فيديو أو أدخل مسار ملف للبدء.",
    "video.player": "النتيجة",
    "video.view_mode": "نمط العرض",
    "video.view.annotated": "معالج (ADAS)",
    "video.view.raw": "الأصل بدون تعديل",
    "video.view.split": "عرض مزدوج جنبًا إلى جنب",
    "video.engine": "نوع المشغّل",
    "video.engine.custom": "مشغّل ADAS",
    "video.engine.native": "المشغّل الافتراضي",
    "video.jump_event": "الانتقال للحدث الحرج",
    "video.jump_peak": "الانتقال لذروة الإرهاق",
    "video.size": "حجم المشغّل",
    "video.size.small": "صغير",
    "video.size.medium": "متوسط",
    "video.size.large": "كبير",
    "video.download_video": "تنزيل الفيديو",
    "video.download_csv": "تنزيل سجل الأحداث (CSV)",
    "video.download_json": "تنزيل القياسات الكاملة (JSON)",
    "video.download_report": "تنزيل تقرير سلامة السائق (HTML)",
    "video.download_report.help": (
        "تقرير السلامة الكامل: التقدير، وملخص الإرهاق، وكل حدث دقيق "
        "مع مدته وخطورته، والتوصيات. يُفتح في أي متصفح ويُطبع بوضوح."
    ),
    "video.filter_events": "تصفية الأحداث",
    "video.filter.all": "الكل",
    "video.filter.warn_crit": "تحذير وحرج",
    "video.filter.crit": "حرج فقط",
    "video.jump_select": "الانتقال لتوقيت الحدث",
    "video.events": "سجل الأحداث",
    "video.timeline": "الخط الزمني للإرهاق",
    "video.no_events": "لم يتم رصد أي أحداث نعاس.",

    "m.peak_fatigue": "ذروة الإرهاق",
    "m.mean_fatigue": "متوسط الإرهاق",
    "m.time_warning": "مدة التحذير",
    "m.time_critical": "المدة الحرجة",
    "m.micro_blinks": "رمشات دقيقة",
    "m.micro_sleeps": "نوم دقيق",
    "m.full_closures": "إغلاق كامل",
    "m.yawns": "تثاؤب",
    "m.longest_closure": "أطول إغلاق",
    "m.detections": "إجمالي الاكتشافات",
    "m.speed": "سرعة المعالجة",
    "m.frames": "الإطارات المحللة",
    "m.fatigue": "الإرهاق",
    "m.status": "الحالة",
    "m.frame": "الإطار",

    "event.micro_blink": "رمشة دقيقة",
    "event.micro_sleep": "نوم دقيق",
    "event.full_closure": "إغلاق كامل للعين",
    "event.yawn": "تثاؤب",
    "event.kind": "الحدث",
    "event.start": "البداية",
    "event.end": "النهاية",
    "event.duration": "المدة",
    "event.severity": "الخطورة",
    "sev.info": "معلومة",
    "sev.warning": "تحذير",
    "sev.critical": "حرج",

    "level.SAFE": "آمن",
    "level.WARNING": "تحذير",
    "level.CRITICAL": "حرج",
    "alert.warning.msg": "تم رصد نعاس — انتباه السائق في انخفاض.",
    "alert.critical.msg": "حرج — نعاس مستمر. يجب على السائق التوقف.",

    "cam.title": "الكاميرا المباشرة",
    "cam.select": "الكاميرا",
    "cam.start": "تشغيل الكاميرا",
    "cam.stop": "إيقاف",
    "cam.starting": "جارٍ تشغيل الكاميرا…",
    "cam.none": "لم يتم العثور على كاميرا. تأكد من توصيلها وعدم استخدامها من تطبيق آخر.",
    "cam.idle": "الكاميرا متوقفة. اضغط تشغيل لبدء التحليل المباشر.",
    "cam.recent": "الأحداث الأخيرة",
    "cam.snapshot": "حفظ لقطة",

    "models.title": "النماذج",
    "models.subtitle": "جميع نماذج الكشف المتاحة في هذه المنصة",
    "models.compare": "مقارنة الدقة لكل فئة",
    "models.missing": "مسجّلة لكنها غير مثبتة",
    "models.map50": "mAP@50",
    "models.map50c": "mAP@50 (مصحّحة)",
    "models.precision": "الدقة",
    "models.recall": "الاستدعاء",
    "models.f1": "F1",
    "models.size": "حجم الملف",
    "models.res": "دقة الإدخال",
    "models.epochs": "الحقب",
    "models.optimizer": "المُحسِّن",
    "models.train_time": "زمن التدريب",
    "models.not_measured": "غير مقاسة",
    "models.best": "الأفضل على الاختبار",

    "class.closed_eye": "عين مغلقة",
    "class.open_eye": "عين مفتوحة",
    "class.yawning": "تثاؤب",

    "about.title": "حول هذه المنصة",
    "about.how": "كيف تعمل",
    "about.how.body": (
        "يمر كل إطار من الفيديو عبر نموذج YOLO مدرَّب على ثلاث فئات: "
        "عين مغلقة، وعين مفتوحة، وتثاؤب. تُغذّي الاكتشافات نافذة متحركة "
        "بأسلوب PERCLOS تقدّر الإرهاق خلال آخر عدد من الإطارات."
    ),
    "about.scoring": "حساب الإرهاق",
    "about.scoring.body": (
        "كل إطار يحتوي على عين مغلقة يضيف 0.70، والإطار الذي يحتوي على تثاؤب "
        "دون عين مغلقة يضيف 0.30، والعيون المفتوحة لا تضيف شيئًا. النتيجة هي "
        "المتوسط عبر النافذة. يبدأ التحذير عند 0.40، والحالة الحرجة عند 0.65 "
        "مستمرة لمدة 1.5 ثانية."
    ),
    "about.events": "تعريفات الأحداث",
    "about.events.body": (
        "تُجمّع الإطارات المتتالية لعين مغلقة في أحداث وتُصنَّف حسب المدة، "
        "مقاسة من الطوابع الزمنية الحقيقية للفيديو: أقل من 0.30 ثانية رمشة دقيقة (طبيعية)، "
        "ومن 0.30 إلى 2.0 ثانية نوم دقيق (خطير)، وأكثر من 2.0 ثانية إغلاق كامل (حرج). "
        "يجب أن يستمر الحدث إطارين على الأقل، مما يمنع ضوضاء الإطار الواحد."
    ),
    "about.classes": "فئات الكشف",
    "about.limits": "قيود معروفة",
    "about.limits.hud": (
        "تبقى الطبقة المدمجة في الفيديو بالإنجليزية في كلتا اللغتين، لأن مكتبة "
        "الرسم تدعم المحارف اللاتينية فقط ولا تستطيع تشكيل النص العربي بشكل صحيح."
    ),
    "about.limits.acc": (
        "أرقام الدقة مأخوذة من مجموعة الاختبار المعزولة للمشروع ومُعاد عرضها كما قيست. "
        "لا يُعيد هذا التطبيق حسابها."
    ),
    "about.env": "البيئة",
    "about.provenance": "مصدر الشيفرة",
    "about.provenance.body": (
        "تم نسخ محرك الرسم وحساب PERCLOS من المشروع البحثي الأصلي حتى يعمل هذا "
        "المجلد بشكل مستقل. لم تتغير المعادلات، لذا تطابق الأرقام تجارب المشروع."
    ),

    "common.seconds": "ثانية",
    "common.frames": "إطار",
    "common.of": "من",
    "common.yes": "نعم",
    "common.no": "لا",
    "common.none": "لا شيء",
}

TRANSLATIONS: dict[str, dict[str, str]] = {"en": EN, "ar": AR}


def current_lang() -> str:
    return st.session_state.get("lang", DEFAULT_LANG)


def is_rtl() -> bool:
    return current_lang() == "ar"


def t(key: str, **kwargs) -> str:
    """Translate. Falls back to English, then to the key itself."""
    lang = current_lang()
    table = TRANSLATIONS.get(lang, EN)
    text = table.get(key) or EN.get(key) or key
    if kwargs:
        try:
            text = text.format(**kwargs)
        except (KeyError, IndexError, ValueError):
            pass
    return text


def missing_keys() -> list[str]:
    """Keys present in English but absent from Arabic. Used by the About page
    in dev, and by nothing at runtime."""
    return sorted(set(EN) - set(AR))
