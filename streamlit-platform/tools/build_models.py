"""
PACKAGING TOOL -- dev-only, run from the parent project. NOT shipped behavior.

Copies trained checkpoints into `streamlit-platform/models/` and builds a
`card.json` per model by merging the two places the parent project already
stores authoritative numbers:

    INFO/<family>/<exp>-test-result/tested-images/metrics.json  -> accuracy
    checkpoints/<family>/<exp>/run_config.json                  -> training config

Neither is recomputed. This tool never runs inference and never touches the
dataset -- it only reads what the experiments already produced, so the cards
cannot drift from the recorded results.

Two layout quirks it has to absorb:
  * Exp1 has no `run_config.json` (it predates that feature) -- falls back to
    Ultralytics' own `args.yaml`.
  * yolo26s writes `<exp>/weights/best.pt` (Ultralytics' native layout) while
    yolo26n runs were flattened to `<exp>/best.pt`. Both are normalized into
    one shape inside `models/`.

Usage (from the parent project root):
    python streamlit-platform/tools/build_models.py
    python streamlit-platform/tools/build_models.py --include-yolo26s
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PLATFORM_ROOT = Path(__file__).resolve().parent.parent
MODELS_OUT = PLATFORM_ROOT / "models"

# key -> (checkpoint dir relative to checkpoints/, platform subdir, resolution,
#         english note, arabic note)
SPECS = [
    ("yolo26n-1-baseline", "yolo26n/1-baseline-yolo26n-960-mild-aug", "yolo26n/1-baseline", 960,
     "First training run. Fresh COCO weights, mild augmentation, MuSGD optimizer. "
     "Ranked best on validation but worst on the real test split -- the finding that "
     "started this project's evaluation discipline.",
     "أول تدريب. أوزان COCO جديدة، تعزيز خفيف. "
     "الأفضل على التحقق ولكن الأسوأ على الاختبار الحقيقي."),

    ("yolo26n-2-finetune", "yolo26n/2-finetune-yolo26n-960-moderate-aug", "yolo26n/2-finetune", 960,
     "Fine-tuned from Exp1 with AdamW and moderate augmentation. Was the best "
     "real-test model for most of the project's life.",
     "ضبط دقيق من التجربة الأولى باستخدام AdamW وتعزيز متوسط. "
     "كان أفضل نموذج لمعظم فترة المشروع."),

    ("yolo26n-3-fresh-640", "yolo26n/3-fresh-yolo26n-640-worst-aug", "yolo26n/3-fresh-640", 640,
     "Fresh run at 640px with worst-case augmentation, testing robustness limits. "
     "Scored lowest of the 960px models -- evidence that 960 is the right resolution.",
     "تدريب جديد بدقة 640 مع أقصى تعزيز. "
     "سجّل أدنى نتيجة — دليل على أن 960 هي الدقة الصحيحة."),

    ("yolo26n-4-calibration", "yolo26n/4-calibration-yolo26n-960-moderate-aug", "yolo26n/4-calibration", 960,
     "Classification loss weight raised 0.5 -> 1.5, targeting the finding that 89% of "
     "missed detections were correct boxes scored below threshold. Best model on the "
     "real test split.",
     "رفع وزن خسارة التصنيف من 0.5 إلى 1.5، لمعالجة أن 89٪ من الإخفاقات "
     "كانت صناديق صحيحة تحت العتبة. أفضل نموذج على الاختبار الحقيقي."),

    ("yolo26n-5-cls3", "yolo26n/5-cls3-yolo26n-960-moderate-aug", "yolo26n/5-cls3", 960,
     "Classification loss pushed further to 3.0. Scored below cls=1.5 -- the lever "
     "turned over, closing loss balance as an avenue.",
     "دفع خسارة التصنيف إلى 3.0. سجّل أقل من 1.5 — "
     "انعكس الاتجاه، مما أغلق هذا المسار."),

    ("yolo26s-1-capacity", "yolo26s/1-capacity-yolo26s-960-moderate-aug", "yolo26s/1-capacity", 960,
     "Larger yolo26s backbone, testing whether model capacity is the bottleneck. "
     "Uses the best recipe found on yolo26n (AdamW, cls=1.5, 960px, moderate aug).",
     "نموذج yolo26s الأكبر، لاختبار ما إذا كانت سعة النموذج هي العائق. "
     "يستخدم أفضل وصفة وجدت على yolo26n."),

    ("yolo11n-1-capacity", "yolo11n/1-capacity-yolo11n-960-moderate-aug", "yolo11n/1-capacity", 960,
     "YOLO11n architecture trained with AdamW and moderate augmentation at 960px.",
     "معمارية YOLO11n مدربة باستخدام AdamW وتعزيز متوسط بدقة 960 بكسل."),

    ("yolo11m-1-warmstart", "yolo11m/1-yolo11m-warmstart-pilot-640", "yolo11m/1-warmstart", 640,
     "Cross-dataset warm start: fine-tuned from the OLD project's own best YOLO11m "
     "checkpoint onto THIS project's dataset. Best real test result in this project.",
     "بدء دافئ عبر مجموعات بيانات مختلفة: ضبط دقيق من أفضل نقطة تفتيش YOLO11m "
     "للمشروع القديم على بيانات هذا المشروع. أفضل نتيجة اختبار حقيقية."),
    ("yolo26n-6-weakdevice-480", "yolo26n/6-weakdevice-480-worstcase-yolo26n", "yolo26n/6-weakdevice", 480,
     "4th-generation fine-tune (fresh -> Exp1 -> Exp2 -> Exp4 -> this), imgsz dropped to "
     "480 with worst-case augmentation for weak-device deployment. Matched the 960px "
     "parent's accuracy at half the resolution and the fastest measured FPS in the project.",
     "الجيل الرابع من الضبط الدقيق، بدقة 480 مع أقصى تعزيز لأجهزة الويب الضعيفة. "
     "طابق دقة النموذج الأصلي بنصف الدقة وأسرع معدل إطارات في المشروع."),

    # --- Old-project models, merged into checkpoints/<family>/old-*/ this session.
    # Freshly evaluated on THIS project's own test split (never done before) --
    # numbers below are real, not the old project's own (often unverifiable or
    # confirmed-fabricated) self-reported figures. See each folder's info.md for
    # the full old-project provenance/lineage.
    ("old-yolo11n-1-baseline-384", "yolo11n/old-1-baseline-384", "old/yolo11n-1-baseline-384", 384,
     "[Old project] Fresh-COCO YOLO11n baseline, trained on the old project's own "
     "dataset. Real accuracy shown here is measured on THIS project's test split.",
     "[مشروع قديم] نموذج YOLO11n أساسي، مدرب على بيانات المشروع القديم. "
     "الدقة المعروضة قُيست على مجموعة اختبار هذا المشروع."),
    ("old-yolo11n-2-worstcase-dms-640", "yolo11n/old-2-worstcase-dms-640", "old/yolo11n-2-worstcase-dms-640", 640,
     "[Old project] The DMS-purpose checkpoint this project's own D18 experiment "
     "was warm-started from. Real accuracy measured on THIS project's test split.",
     "[مشروع قديم] نقطة التفتيش التي بدأ منها تجربة D18 لهذا المشروع. "
     "الدقة قُيست على مجموعة اختبار هذا المشروع."),
    ("old-yolo11m-1-worstcase-384", "yolo11m/old-1-worstcase-384", "old/yolo11m-1-worstcase-384", 384,
     "[Old project] YOLO11m worst-case-augmentation fine-tune, old project's dataset. "
     "Real accuracy measured on THIS project's test split.",
     "[مشروع قديم] YOLO11m بأقصى تعزيز، بيانات المشروع القديم. "
     "الدقة قُيست على مجموعة اختبار هذا المشروع."),
    ("old-yolo11m-2-trial2winner-640", "yolo11m/old-2-trial2winner-640", "old/yolo11m-2-trial2winner-640", 640,
     "[Old project] Old project's self-declared best overall model (SGD, the only "
     "SGD run in either project). Real accuracy measured on THIS project's test split.",
     "[مشروع قديم] أفضل نموذج في المشروع القديم حسب تقييمه الذاتي. "
     "الدقة قُيست على مجموعة اختبار هذا المشروع."),
    ("old-yolo11m-3-worstcase-d18source-640", "yolo11m/old-3-worstcase-d18source-640", "old/yolo11m-3-worstcase-d18source-640", 640,
     "[Old project] The exact checkpoint this project's D18 was fine-tuned from, "
     "evaluated here BEFORE that fine-tuning -- shows the +10pt gain fine-tuning "
     "on this project's own dataset provided.",
     "[مشروع قديم] نقطة التفتيش التي أُخذت منها D18 قبل الضبط الدقيق -- "
     "تُظهر مقدار التحسن من الضبط على بيانات هذا المشروع."),
    ("old-yolo26n-1-nanobaseline-384", "yolo26n/old-1-nanobaseline-384", "old/yolo26n-1-nanobaseline-384", 384,
     "[Old project] YOLO26n nano baseline, old project's dataset. Real accuracy "
     "measured on THIS project's test split.",
     "[مشروع قديم] YOLO26n أساسي، بيانات المشروع القديم. "
     "الدقة قُيست على مجموعة اختبار هذا المشروع."),
    ("old-yolo26n-2-nanoworstcase-384", "yolo26n/old-2-nanoworstcase-384", "old/yolo26n-2-nanoworstcase-384", 384,
     "[Old project] YOLO26n nano worst-case fine-tune, old project's dataset. Real "
     "accuracy measured on THIS project's test split.",
     "[مشروع قديم] YOLO26n بأقصى تعزيز، بيانات المشروع القديم. "
     "الدقة قُيست على مجموعة اختبار هذا المشروع."),
]

# RF-DETR entries -- separate list (extra `rfdetr_class` field, different
# checkpoint filename convention: `checkpoint_best_ema.pth`, not `best.pt`).
# key -> (checkpoint dir relative to checkpoints/, platform subdir, resolution,
#         rfdetr_class, english note, arabic note)
RFDETR_SPECS = [
    ("old-rfdetr-nano-1-baseline-384", "rfdetr-nano/old-1-baseline-384", "old/rfdetr-nano-1-baseline-384", 384, "nano",
     "[Old project] RF-DETR Nano baseline (transformer detector, not YOLO). Real "
     "accuracy measured on THIS project's test split.",
     "[مشروع قديم] RF-DETR Nano أساسي (كاشف محول، ليس YOLO). "
     "الدقة قُيست على مجموعة اختبار هذا المشروع."),
    ("old-rfdetr-nano-2-finetune-384", "rfdetr-nano/old-2-finetune-384", "old/rfdetr-nano-2-finetune-384", 384, "nano",
     "[Old project] RF-DETR Nano fine-tuned -- highest self-reported accuracy of any "
     "model in the old project (92.36% on ITS OWN dataset). Real accuracy shown here "
     "is measured on THIS project's test split instead -- do not confuse the two.",
     "[مشروع قديم] RF-DETR Nano المضبوط -- أعلى دقة ذاتية في المشروع القديم. "
     "الدقة المعروضة هنا قُيست على بيانات هذا المشروع -- لا تخلط بين الرقمين."),
    ("old-rfdetr-small-1-baseline-640", "rfdetr-small/old-1-baseline-640", "old/rfdetr-small-1-baseline-640", 640, "small",
     "[Old project] RF-DETR Small baseline. Real accuracy measured on THIS "
     "project's test split.",
     "[مشروع قديم] RF-DETR Small أساسي. الدقة قُيست على مجموعة اختبار هذا المشروع."),
    ("old-rfdetr-small-2-standard-640", "rfdetr-small/old-2-standard-640", "old/rfdetr-small-2-standard-640", 640, "small",
     "[Old project] RF-DETR Small standard fine-tune. Real accuracy measured on "
     "THIS project's test split.",
     "[مشروع قديم] RF-DETR Small قياسي. الدقة قُيست على مجموعة اختبار هذا المشروع."),
    ("old-rfdetr-small-3-worstcase-384", "rfdetr-small/old-3-worstcase-384", "old/rfdetr-small-3-worstcase-384", 384, "small",
     "[Old project] RF-DETR Small worst-case fine-tune. Real accuracy measured on "
     "THIS project's test split.",
     "[مشروع قديم] RF-DETR Small بأقصى تعزيز. الدقة قُيست على مجموعة اختبار هذا المشروع."),
]

DISPLAY = {
    "yolo26n-1-baseline": "YOLO26n - Exp1 Baseline",
    "yolo26n-2-finetune": "YOLO26n - Exp2 AdamW Fine-tune",
    "yolo26n-3-fresh-640": "YOLO26n - Exp3 Fresh 640",
    "yolo26n-4-calibration": "YOLO26n - Exp4 Calibration cls1.5",
    "yolo26n-5-cls3": "YOLO26n - Exp5 cls3.0",
    "yolo26s-1-capacity": "YOLO26s - Exp6 Capacity",
    "yolo11n-1-capacity": "YOLO11n - Capacity 960",
    "yolo11m-1-warmstart": "YOLO11m - D18 Cross-Dataset Warm Start",
    "yolo26n-6-weakdevice-480": "YOLO26n - Exp6 Weak-Device 480",
    "old-yolo11n-1-baseline-384": "[Old] YOLO11n Baseline 384",
    "old-yolo11n-2-worstcase-dms-640": "[Old] YOLO11n Worst-Case DMS 640",
    "old-yolo11m-1-worstcase-384": "[Old] YOLO11m Worst-Case 384",
    "old-yolo11m-2-trial2winner-640": "[Old] YOLO11m Trial2 Winner 640",
    "old-yolo11m-3-worstcase-d18source-640": "[Old] YOLO11m Worst-Case (D18 source) 640",
    "old-yolo26n-1-nanobaseline-384": "[Old] YOLO26n Nano Baseline 384",
    "old-yolo26n-2-nanoworstcase-384": "[Old] YOLO26n Nano Worst-Case 384",
    "old-rfdetr-nano-1-baseline-384": "[Old] RF-DETR Nano Baseline 384",
    "old-rfdetr-nano-2-finetune-384": "[Old] RF-DETR Nano Fine-Tuned 384",
    "old-rfdetr-small-1-baseline-640": "[Old] RF-DETR Small Baseline 640",
    "old-rfdetr-small-2-standard-640": "[Old] RF-DETR Small Standard 640",
    "old-rfdetr-small-3-worstcase-384": "[Old] RF-DETR Small Worst-Case 384",
}


def find_checkpoint(exp_dir: Path) -> Path | None:
    """Handles all layouts seen so far: <exp>/best.pt, <exp>/weights/best.pt,
    and RF-DETR's `checkpoint_best_ema.pth`."""
    for cand in (exp_dir / "best.pt", exp_dir / "weights" / "best.pt",
                 exp_dir / "checkpoint_best_ema.pth"):
        if cand.exists():
            return cand
    return None


def read_metrics(family: str, exp_name: str, exp_dir: Path | None = None) -> dict:
    p = (PROJECT_ROOT / "INFO" / family / f"{exp_name}-test-result"
         / "tested-images" / "metrics.json")
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass

    # Fallback to reading best validation metrics from results.csv if present
    if exp_dir:
        csv_p = exp_dir / "results.csv"
        if csv_p.exists():
            try:
                lines = [l.strip() for l in csv_p.read_text(encoding="utf-8").splitlines() if l.strip()]
                if len(lines) > 1:
                    header = [h.strip() for h in lines[0].split(",")]
                    m50_idx = header.index("metrics/mAP50(B)") if "metrics/mAP50(B)" in header else -1
                    p_idx = header.index("metrics/precision(B)") if "metrics/precision(B)" in header else -1
                    r_idx = header.index("metrics/recall(B)") if "metrics/recall(B)" in header else -1
                    best_row = None
                    best_m50 = -1.0
                    for line in lines[1:]:
                        parts = [x.strip() for x in line.split(",")]
                        if len(parts) == len(header) and m50_idx != -1:
                            try:
                                v = float(parts[m50_idx])
                                if v > best_m50:
                                    best_m50 = v
                                    best_row = parts
                            except ValueError:
                                pass
                    if best_row:
                        prec = float(best_row[p_idx]) if p_idx != -1 else None
                        rec = float(best_row[r_idx]) if r_idx != -1 else None
                        f1_val = (2 * prec * rec / (prec + rec)) if (prec and rec and (prec + rec) > 0) else None
                        # NOT a test-set measurement. This is the single best
                        # epoch's VALIDATION mAP, selected as a maximum over
                        # the training run -- optimistically biased by that
                        # selection, computed on the val split the run was
                        # tuned against, and never label-gap corrected.
                        #
                        # An earlier version returned this with
                        # map50_corrected = best_m50 and measured = True, which
                        # made it indistinguishable from a real test result:
                        # yolo11n-1-capacity consequently advertised 88.65 %
                        # (its val peak) instead of its true 83.11 %, and
                        # ranked first in the picker on a number that was never
                        # measured on the test split. map50_corrected is
                        # deliberately left absent -- no correction was applied,
                        # so claiming one would be false.
                        return {
                            "map50": best_m50,
                            "map50_corrected": None,
                            "precision": prec,
                            "recall": rec,
                            "f1": f1_val,
                            "measured": False,
                            "metrics_source": "validation-peak",
                        }
            except Exception:
                pass
    return {}


def read_train_config(exp_dir: Path) -> dict:
    """run_config.json if present; else Ultralytics' args.yaml (Exp1)."""
    rc = exp_dir / "run_config.json"
    if rc.exists():
        try:
            return json.loads(rc.read_text(encoding="utf-8"))
        except Exception:
            pass
    ay = exp_dir / "args.yaml"
    if ay.exists():
        try:
            return yaml.safe_load(ay.read_text(encoding="utf-8")) or {}
        except Exception:
            pass
    return {}


def build_card(key: str, ckpt: Path, resolution: int, metrics: dict,
               cfg: dict, note_en: str, note_ar: str, family: str = "yolo",
               rfdetr_class: str | None = None) -> dict:
    ap = metrics.get("ap_per_class") or {}
    ap_corr = metrics.get("ap_per_class_corrected") or {}
    train_s = cfg.get("total_train_seconds")

    card = {
        "key": key,
        "display_name": DISPLAY.get(key, key),
        "family": family,
        "resolution": resolution,
        "size_mb": round(ckpt.stat().st_size / (1024 * 1024), 2),
        "metrics": {
            "map50": metrics.get("map50"),
            "map50_corrected": metrics.get("map50_corrected"),
            "precision": metrics.get("precision"),
            "recall": metrics.get("recall"),
            "f1": metrics.get("f1"),
            "ap_per_class": ap,
            "ap_per_class_corrected": ap_corr,
            # True only for a real held-out test evaluation. read_metrics()
            # sets this False for its validation-peak fallback, and that
            # False must survive here -- `bool(metrics)` would overwrite it
            # with True simply because the dict is non-empty.
            "measured": bool(metrics) and metrics.get("measured", True),
            "metrics_source": metrics.get(
                "metrics_source", "test-split" if metrics else "none"),
        },
        "training": {
            "epochs": cfg.get("epochs"),
            "imgsz": cfg.get("imgsz", resolution),
            "batch": cfg.get("batch"),
            "optimizer": cfg.get("optimizer"),
            "lr0": cfg.get("lr0"),
            "cls": cfg.get("cls"),
            "box": cfg.get("box"),
            "dfl": cfg.get("dfl"),
            "hours": round(train_s / 3600.0, 2) if train_s else None,
        },
        "notes": {"en": note_en, "ar": note_ar},
    }
    if rfdetr_class:
        card["rfdetr_class"] = rfdetr_class
    return card


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--include-yolo26s", action="store_true",
                    help="include the yolo26s capacity run even if still training")
    args = ap.parse_args()

    MODELS_OUT.mkdir(parents=True, exist_ok=True)
    registry: dict[str, dict] = {}
    skipped: list[str] = []

    for key, rel, out_rel, resolution, note_en, note_ar in SPECS:
        if key.startswith("yolo26s") and not args.include_yolo26s:
            skipped.append(f"{key} (use --include-yolo26s)")
            continue

        exp_dir = PROJECT_ROOT / "checkpoints" / rel
        ckpt = find_checkpoint(exp_dir)
        if ckpt is None:
            skipped.append(f"{key} (no best.pt at {exp_dir})")
            continue

        family, exp_name = rel.split("/", 1)
        metrics = read_metrics(family, exp_name, exp_dir)
        cfg = read_train_config(exp_dir)

        dest_dir = MODELS_OUT / out_rel
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_ckpt = dest_dir / "best.pt"

        if not dest_ckpt.exists() or dest_ckpt.stat().st_size != ckpt.stat().st_size:
            print(f"  copying {ckpt.stat().st_size / 1e6:6.1f} MB -> {out_rel}/best.pt")
            shutil.copy2(ckpt, dest_ckpt)
        else:
            print(f"  up to date: {out_rel}/best.pt")

        card = build_card(key, dest_ckpt, resolution, metrics, cfg, note_en, note_ar)
        (dest_dir / "card.json").write_text(
            json.dumps(card, indent=2, ensure_ascii=False), encoding="utf-8")

        registry[key] = {
            "family": "yolo",
            "display_name": card["display_name"],
            "checkpoint": f"{out_rel}/best.pt",
            "card": f"{out_rel}/card.json",
            "resolution": resolution,
        }
        m = card["metrics"]
        mm = f"mAP50 {m['map50']:.4f}" if m["map50"] is not None else "no metrics"
        print(f"    {card['display_name']}  {mm}  {card['size_mb']} MB")

    # --- RF-DETR entries -- same mechanism, different checkpoint filename
    # convention (kept as `checkpoint_best_ema.pth`, not renamed to `best.pt`,
    # so the file's own name still tells you it isn't a YOLO checkpoint).
    for key, rel, out_rel, resolution, rfdetr_class, note_en, note_ar in RFDETR_SPECS:
        exp_dir = PROJECT_ROOT / "checkpoints" / rel
        ckpt = find_checkpoint(exp_dir)
        if ckpt is None:
            skipped.append(f"{key} (no checkpoint at {exp_dir})")
            continue

        family, exp_name = rel.split("/", 1)
        metrics = read_metrics(family, exp_name, exp_dir)
        cfg = read_train_config(exp_dir)

        dest_dir = MODELS_OUT / out_rel
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_ckpt = dest_dir / ckpt.name

        if not dest_ckpt.exists() or dest_ckpt.stat().st_size != ckpt.stat().st_size:
            print(f"  copying {ckpt.stat().st_size / 1e6:6.1f} MB -> {out_rel}/{ckpt.name}")
            shutil.copy2(ckpt, dest_ckpt)
        else:
            print(f"  up to date: {out_rel}/{ckpt.name}")

        card = build_card(key, dest_ckpt, resolution, metrics, cfg, note_en, note_ar,
                           family="rfdetr", rfdetr_class=rfdetr_class)
        (dest_dir / "card.json").write_text(
            json.dumps(card, indent=2, ensure_ascii=False), encoding="utf-8")

        registry[key] = {
            "family": "rfdetr",
            "rfdetr_class": rfdetr_class,
            "display_name": card["display_name"],
            "checkpoint": f"{out_rel}/{ckpt.name}",
            "card": f"{out_rel}/card.json",
            "resolution": resolution,
        }
        m = card["metrics"]
        mm = f"mAP50 {m['map50']:.4f}" if m["map50"] is not None else "no metrics"
        print(f"    {card['display_name']}  {mm}  {card['size_mb']} MB")

    (MODELS_OUT / "registry.yaml").write_text(
        "# Generated by tools/build_models.py -- do not hand-edit.\n"
        "# Paths are relative to streamlit-platform/models/.\n\n"
        + yaml.safe_dump({"models": registry}, sort_keys=False, allow_unicode=True),
        encoding="utf-8")

    print(f"\nWrote registry with {len(registry)} model(s).")
    for s in skipped:
        print(f"  SKIPPED {s}")


if __name__ == "__main__":
    main()
