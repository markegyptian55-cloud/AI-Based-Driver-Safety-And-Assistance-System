# The Construction of a Leakage-Safe Driver-Drowsiness Detection Dataset

### A Case Study in Evidence-Based Dataset Engineering for Object Detection

**Project:** `nano big` — a YOLO-format object detection dataset for driver
drowsiness monitoring (classes: `closed_eye`, `open_eye`, `yawning`)
**Source corpus:** `data/Dataset-Main`, 57,098 images aggregated from multiple
independently-annotated sources (Roboflow exports, stock photography,
driver-monitoring session recordings, and compiled drowsy-driving photo sets)
**Final artifact:** `final_dataset/`, 50,654 images / 68,292 boxes, standard
Ultralytics YOLO detection format
**Document purpose:** a complete, chaptered record of the methodology, the
failures encountered, and how each was diagnosed and resolved — written for
academic and engineering audiences who need to understand not just the final
numbers, but *why* the pipeline looks the way it does.

---

## Abstract

Public and aggregated computer-vision datasets are rarely as clean as their
directory structure suggests. This document records, phase by phase, the
construction of a 3-class driver-drowsiness object-detection dataset from a
57,098-image corpus that turned out to be a **merge of several
independently-annotated single-task source datasets** — an eye-state corpus,
a yawning corpus, and several driver-monitoring session recordings — combined
into one label space without re-annotation. That single fact is the root
cause of nearly every downstream problem this project solved: systematic
missing labels (not random noise), duplicate images spanning intended
train/test boundaries, and video-session identity leaking across data
splits.

The project's governing discipline, stated once here and enforced
mechanically throughout, is: **no label is ever invented, no absence is ever
assumed to mean negative, and no grouping threshold is ever used to both
construct and validate the same decision.** Every non-trivial claim in this
document is backed by a script, a measured statistic, and — where a decision
carried risk — an independent verification pass built by a different method
than the one that produced the artifact being checked. Two significant
methodological failures are preserved in this record rather than quietly
corrected: a loss-masking design that would have silently corrupted 38% of
supervision under mosaic augmentation, and a leakage-repair script that broke
the very invariant it was trying to fix. Both were caught by validation gates
built for exactly this purpose, and both are documented here as evidence that
the verification discipline actually works, not just that the final numbers
look good.

---

## Table of Contents

1. **Chapter 1 — Dataset Overview and Final Specification (start here)**
2. **Chapter 2 — Full Project Plan (model research, training, deployment strategy)**
3. **Chapter 3 — Experimental Execution Log (training runs, in progress)**
4. Introduction and Motivation
5. The Corpus: Composition and Provenance
6. Chapter I — Ingestion, Scanning, and Foundational Measurement (Phases 1–4)
7. Chapter II — Geometric and Size Analysis (Phase 7)
8. Chapter III — Annotation Completeness: Two Failed Automated Attempts (Phase 8)
9. Chapter IV — The Human Review Package (Phase 9–10 bridge)
10. Chapter V — Human Review Decisions and the Central Finding (Phase 11)
11. Chapter VI — Source-Aware Supervision Manifest (Phase 12A)
12. Chapter VII — The Loss-Masking Investigation (Phase 12B/12C)
13. Chapter VIII — The Polygon Defect and Unit Construction (Phase 12D)
14. Chapter IX — Group-Aware Splitting (Phase 13)
15. Chapter X — Independent Leakage Verification (Phase 14)
16. Chapter XI — Final Quality Audit (Phase 15)
17. Chapter XII — YOLO Export (Phase 16)
18. Chapter XIII — The Hardening Audit (Phases H1–H16)
19. Chapter XIV — The Human Multi-Box Review
20. Chapter XV — Methodological Principles Extracted
21. Chapter XVI — Reproducibility (see also Chapter 1)
22. Appendix A — Historical File and Script Index
23. Appendix B — Glossary
24. Appendix C — Manifest and Report Schemas (pre-deletion snapshot)
25. Appendix D — Pointer to the Full Source-Code Archive

---

## Chapter 1 — Dataset Overview and Final Specification

*(This chapter is the front door. Everything after it is the detailed,
chaptered history of how the dataset in this section came to exist.)*

### 1.1 What this is

A YOLO-format object-detection dataset for driver-drowsiness monitoring.

**Classes:** `0: closed_eye`, `1: open_eye`, `2: yawning`

**Location (current, post-reorganization):**
`C:\ssd projects\nano big\data\Dataset-Main`

```
data/Dataset-Main/
├── images/{train,val,test}/
├── labels/{train,val,test}/
├── data.yaml
└── SUMMARY.txt
```

> **Note on the path change.** The dataset was originally built and certified
> at `final_dataset/` (see Chapters XII–XIV, which refer to that path — that
> is the historically accurate location at the time each phase ran). It was
> later moved by the user directly into `data/Dataset-Main`, replacing the
> original raw corpus that lived there (which had already been fully
> consumed by the pipeline and was no longer needed once `final_dataset/`
> was certified). `data.yaml`'s internal `path:` field was updated to match.
> Every statistic, count, and file described anywhere in this book refers to
> the same underlying dataset; only its on-disk location changed.

### 1.2 Final numbers

| | |
|---|---:|
| Final images | 50,654 |
| Final boxes | 68,292 |
| Train | 39,627 (78.23%) |
| Val | 5,438 (10.74%) |
| Test | 5,589 (11.03%) |
| `closed_eye` boxes | 24,671 (36.1%) |
| `open_eye` boxes | 21,986 (32.2%) |
| `yawning` boxes | 21,635 (31.7%) |

Original raw corpus: 57,098 images. The reduction to 50,654 is accounted for
exactly: 6,441 images were pixel-identical duplicates present under more than
one original source-split folder (collapsed to one copy each), and 3 images
were quarantined for an ambiguous double-annotation (Chapter XI) — see
Chapter XII for the exact arithmetic.

### 1.3 Status

**Certified READY_FOR_TRAINING.** No model has been trained. The full
certification detail is in §1.5 below (merged in from the former
`FINAL_DATASET_CERTIFICATION.md`, since deleted — see §1.6), and the
275-image human review of unusual
multi-box annotations (Chapter XIV) confirmed zero problems.

### 1.4 What was never done

No image outside the final dataset directory was ever modified; the original
raw corpus was consumed read-only throughout the entire pipeline. No label
was ever invented, at any point across sixteen-plus phases and a full
hardening audit. No model was trained, benchmarked, or evaluated as part of
this dataset-preparation effort.

### 1.5 Full certification detail

*(Merged in from the former root-level `FINAL_DATASET_CERTIFICATION.md` and
`FINAL_DATASET_REPORT.md`, which are no longer separate files — see §1.6.
Numbers here are the final, post-hardening-audit, post-multi-box-review
figures; where the two source files disagreed, the certification's numbers
win, since the report was explicitly marked stale after the H5 session-leak
fix changed split sizes.)*

**Per-class × split breakdown (boxes):**

| class | train | val | test |
|---|---:|---:|---:|
| closed_eye | 19,366 | 2,910 | 2,395 |
| open_eye | 17,657 | 2,002 | 2,327 |
| yawning | 16,597 | 2,333 | 2,705 |

**Duplicate and leakage statistics:**

- Duplicate-copy images collapsed at export (same photo present under more
  than one original source-split folder): 6,441.
- Exact MD5 duplicates in the final export: 0 (fresh re-hash, Chapter XIII).
- Confirmed near-duplicate pairs found and fixed during the hardening audit:
  5 (3 traced to session leakage, 2 isolated cross-naming-convention
  duplicates — Chapter XIII).
- 3,362 additional hash/`rfbase` candidates checked at full resolution after
  the fix: 0 confirmed (all coincidental collisions).

| cross-split leakage check | result |
|---|---|
| exact MD5 spanning splits | 0 |
| confirmed hash/rfbase near-dup spanning splits | 0 |
| Phase-4 visual `group_id` spanning splits | 0 of 23,502 groups |
| `merged_unit_id` spanning splits | 0 of 14,733 units |
| session (`sNNNN`) spanning splits | 0 of 11 sessions (fixed from 9) |

**Full validation gate summary:**

| gate | result |
|---|---|
| Phase 12D: 5/5 independent gates (no near-identical pair, no md5/visual-group span, unit ≤11%, no unit broken by recut) | PASS |
| Phase 13: no merged unit spans >1 final split | PASS |
| Phase 14: md5 exact-dup spanning splits | PASS (0) |
| Phase 14: confirmed hash/rfbase near-dup spanning splits (1/3,499 candidates) | PASS (0 after fix) |
| Phase 14: Phase-4 visual group_id spanning splits | PASS (0) |
| Phase 15: corrupted/unreadable images, missing labels, invalid class id/NaN/Inf/out-of-range coords, exact duplicate boxes, non-background image with 0 boxes | PASS (0 each) |
| Phase 16: image/label count match per split; Ultralytics `check_det_dataset` load | PASS |
| H1 structural audit (fresh decode + label re-parse) | PASS |
| H2 annotation geometry (0 same-class dup, 0 cross-class conflict) | PASS |
| H3 label consistency (structural checks; visual judgment out of scope, disclosed) | PASS |
| H4 duplicate certification (fresh hash, full-res corroboration) | PASS |
| H5 group/session leakage (unit+group+session closure) | PASS |
| H6 split distribution | PASS (statistically sound, kept as-is) |
| H7 deployment realism | documented, no removal warranted |
| H8 image quality | documented, hard examples retained |
| H9 augmentation forensics | documented |
| H10 class balance | PASS (1.14:1, mild, not corrected) |
| H11 human review consistency | PASS |
| H12 supervision/provenance integrity | PASS |
| H13 label safety | PASS (0 labels modified) |
| H15 Ultralytics dataset validation | PASS |

**Human review (Phase 11), for cross-reference:** 430 of 57,098 images
reviewed. `correctly_annotated` 213, `missing_eye_annotation` 155,
`missing_yawning_annotation` 61, `incorrect_annotation` 1 — full narrative
in Chapter V.

**Reproducibility commands specific to the hardening audit** (Chapter XIII),
preserved here since the scripts themselves are archived in Appendix D and
no longer runnable in place without recreating the directory structure:

```
python scripts/h1_structural_audit.py
python scripts/h2_geometry_audit.py
python scripts/h4h5_duplicate_leakage_recert.py
python scripts/h5_session_leak_fix.py       # only if new leakage found
python scripts/h5b_isolated_pair_fix.py     # only if new leakage found
python scripts/h6_distribution_audit.py
python scripts/h9h10_augmentation_balance.py
python scripts/h3_h11_h12_checks.py
python scripts/h14h15_certification.py
```

### 1.6 Project directory reorganization (post-certification housekeeping)

After the dataset was certified and the 275-image human review completed,
the project directory was deliberately simplified: the working scaffolding
that produced the dataset (`manifests/`, `reports/`, `scripts/`, `review/`,
`working/`, plus the always-empty `backups/`, `processed/`, `quarantine/`,
and `.claude/`) was removed, since the dataset itself was finished and those
directories existed to build and verify it, not to be shipped with it.

Before removal, everything of lasting value was preserved:

- **Every methodological finding, failure, and decision** — this entire book
  (Chapters I–XVI), written from those directories' contents before they
  were deleted.
- **The full source code of every script** — now
  `data/Dataset-Main/OVERVIEW_DATASET_AND_ SOURCE_CODE_ARCHIVE.md` (Appendix
  D; originally written to `INFO/SOURCE_CODE_ARCHIVE.md`, then moved
  alongside the dataset itself), so the pipeline remains exactly reproducible
  in principle even though the live `scripts/` directory is gone.
- **The shape of the data** (column schemas, row counts) for every manifest
  and the report-file index — Appendix C, so a future reader knows what
  existed and could rebuild an equivalent artifact if ever needed.

A second, smaller consolidation happened after the folder cleanup: the two
remaining root-level files, `FINAL_DATASET_CERTIFICATION.md` and
`FINAL_DATASET_REPORT.md`, were merged into §1.5 above and then deleted —
they were single-purpose summary documents whose entire content either
duplicated this chapter or (in the report's case) was already marked stale
by the time of the merge. Nothing from either file was lost; the
certification's numbers, being the more current of the two, are what
appear in §1.5.

**What was NOT preserved, by deliberate choice:** the row-level content of
`manifests/final_manifest.csv` (57,098 rows of per-image provenance) and the
430 rendered review images in `review/`. Every *finding* those rows and
images produced is narrated in this book; the raw rows and pixels themselves
are gone. This was an explicit, informed tradeoff, not an oversight.

---

## Chapter 2 — Full Project Plan

The complete model-development research and planning phase for the browser-deployed YOLO drowsiness detector, produced after the dataset (Chapter 1) was certified. Originally written as eleven separate documents under `INFO/`; merged into this chapter so the project keeps a single reference file. Eleven sections below, one per original document, in the order they were produced.

---

### 2.1 Model Research 2026

Driver-drowsiness YOLO detector. Two model families only, per scope:
**YOLO26n** (primary) and a second nano-scale baseline chosen by evidence
between **YOLO11n** and **YOLO12n**. This document justifies that choice and
surveys the literature that bears on training/deployment decisions made in
the sibling strategy documents.

---

#### 1. Model family decision

##### 1.1 YOLO26n — primary, confirmed by evidence

Ultralytics' own published comparisons (`docs.ultralytics.com/compare/yolo26-vs-yolo11`)
and the YOLO26 architecture paper (arXiv:2509.25164) give three
independently-motivated reasons to keep YOLO26n as primary, not just as a
default because it's newest:

1. **CPU latency.** YOLO26n reports ~31–43% faster CPU inference than
   YOLO11n in Ultralytics' own benchmarks (38.9ms vs 56.1ms cited in one
   comparison). CPU speed matters directly for the WASM fallback tier of
   the browser deployment target — a browser without WebGPU still needs to
   run acceptably.
2. **NMS-free, end-to-end by default.** YOLO26 removes the NMS
   post-processing stage entirely; ONNX export with `end2end=True` yields
   an already-decoded `(N, 300, 6)` tensor. This is not a minor convenience
   — it removes an entire category of export/portability bugs (NMS ops that
   behave differently across ONNX Runtime Web execution providers,
   custom-op requirements, dynamic-shape NMS issues) that would otherwise
   need separate handling for WebGPU vs WASM. It also guarantees consistent
   latency (no data-dependent NMS cost).
3. **Small-object-targeted loss design.** YOLO26 introduces ProgLoss +
   STAL (Scale-Targeted Attention Loss), explicitly aimed at small-object
   recall. This is directly relevant here: `open_eye` is the dataset's
   smallest class by a wide margin (median ~43px side at 640×640, per the
   dataset's own Chapter II small-object analysis in `BOOK.md`), so a
   loss function designed for exactly this failure mode is not a
   marginal benefit.

**Risk to track, not ignore:** YOLO26 is the newest family in this
environment (`ultralytics==8.4.64`). "Newest" carries real risk — smaller
community track record, potential rough edges in export/quantization
tooling specifically for the end-to-end head. This is why YOLO11n remains
the second baseline rather than being dropped: it is the fallback if YOLO26n
turns out to have a deployment-blocking issue discovered during
experimentation (Pareto comparison in Full Project Plan §2.9 (Experiment Plan) is designed to
surface this early, cheaply).

##### 1.2 Second baseline: YOLO11n, not YOLO12n

This is the one place the brief explicitly warned against blind assumption,
so the reasoning is spelled out fully.

**Evidence against YOLO12n:** Ultralytics' own documentation states YOLO12
is **not recommended for production use** — its attention-centric layers
(vs YOLO11's CNN-centric design) cause training instability, elevated
memory consumption, and measurably slower CPU inference in Ultralytics'
own comparisons. All three of those failure modes are directly disqualifying
for this project: CPU inference speed matters for the WASM fallback tier,
memory matters for weak mobile browsers (the "ultra-light" deployment
tier), and training instability directly costs GPU time we're explicitly
told to conserve.

**Evidence for YOLO11n:** mature, stable, "fully supported and recommended"
in Ultralytics' own words, 22% fewer parameters than YOLOv8 at improved
accuracy, and it is what the existing `src/` codebase already has partial
tooling for (`test_video.py`'s `MODEL_REGISTRY` already references YOLO11m
checkpoints) — lowering integration risk for the second baseline while
YOLO26n is the higher-risk, higher-reward primary.

**Decision: YOLO11n is the second baseline.** YOLO12n is excluded from the
experiment plan entirely, not benchmarked "just in case" — running it would
burn GPU time against a model family its own maintainer discourages for
production, which fails the "avoid experiments that cannot materially
improve the Pareto frontier" instruction directly.

##### 1.3 Answering the ten comparison questions from the brief

| Question | Answer | Confidence |
|---|---|---|
| Best mAP | Likely YOLO26n (STAL/ProgLoss target exactly this dataset's small-object weakness) | Hypothesis — confirm in Experiment 0 |
| Best recall | Likely YOLO26n on `open_eye` specifically; roughly even on `closed_eye`/`yawning` | Hypothesis |
| Best on small eye regions | YOLO26n (STAL is purpose-built for this) | Medium-high, literature-grounded |
| Best on difficult yawning | Unclear a priori — yawning boxes are larger/less small-object-limited; likely closer race | Needs experimental evidence |
| Browser deployment suitability | YOLO26n (NMS-free simplifies the ONNX Runtime Web pipeline materially) | High |
| Cleanest ONNX export | YOLO26n (`end2end=True` self-contained decoded output vs YOLO11's separate NMS step) | High |
| Lowest inference latency | YOLO26n on CPU (published benchmark); GPU/WebGPU latency needs direct measurement, not assumed to follow the same ordering | Mixed — CPU confirmed, GPU/WebGPU TBD |
| Smallest deployment footprint | Comparable at "n" scale; decided by measured ONNX file size and quantized size, not assumed | TBD experimentally |
| Best INT8/FP16 quantization behavior | Unknown for YOLO26's newer end-to-end head specifically — this is a real risk item, not a formality (see Full Project Plan §2.7 (Quantization Strategy) §3) | Needs experimental evidence |
| Best accuracy/size/latency Pareto point | To be determined by the actual Pareto plot in Full Project Plan §2.9 (Experiment Plan)/Full Project Plan §2.6 (Evaluation Protocol), not assumed in advance | Deferred to experiments |

---

#### 2. Literature survey (topic-organized, transferability-annotated)

For each area: what the source(s) established, what transfers directly to
this project, what does not, and the resulting decision (cross-referenced
to the relevant strategy document rather than repeated there).

##### 2.1 Driver drowsiness / DMS detection with YOLO

- **YOLO-FDCL** (2025, PMC12349288) — YOLOv8 + MobileNetV4 backbone for
  fatigue detection under complex lighting. *Transferable:* motivates the
  augmentation emphasis on lighting variation in Full Project Plan §2.4 (Augmentation Strategy)
  (low light, glasses reflections, exposure swings are real, published
  failure modes for this task family, not speculative). *Not transferable:*
  backbone swap — out of scope, we're using stock YOLO26n/YOLO11n backbones,
  not customizing architecture.
- **Real-time fatigue detection, yawning + eye state** (MDPI 2024,
  1424-8220/24/23/7810) reports 96.5% test accuracy combining yawning
  frequency with eye-state detection — i.e. **temporal aggregation of both
  signals**, not per-frame classification alone, is what published systems
  actually report accuracy on. *Directly transferable:* validates the
  project's own decision (§13 of the brief) to add a lightweight temporal
  layer rather than relying on raw per-frame detector output as the product
  signal.
- **YAWDD / UTA-RLDD** — standard reference yawning/drowsiness datasets.
  *Not directly transferable* (different label taxonomy, not merged into
  this project's corpus), but useful as an external sanity check: if time
  allows, spot-checking the trained detector against a handful of YAWDD
  frames is a cheap, independent generalization probe not otherwise
  available from this project's own held-out test set. *Recommendation:*
  optional, low-priority, not part of the core experiment plan.
- **A 2025 33,750-image, 32-subject, 5-lighting-condition dataset** appears
  in recent literature as a comparable-scale corpus. *Transferable insight:*
  its existence confirms subject/session-count-limited corpora are the
  norm in this field, not an anomaly — which makes this project's own
  session-leakage finding (Chapter XIII of `BOOK.md`: 9 of 11 sessions
  originally leaked across splits before being fixed) a plausible,
  under-scrutinized problem elsewhere in the field too (see
  Full Project Plan §2.2 (Research Gaps)).

##### 2.2 Browser / edge deployment, ONNX Runtime Web, WebGPU

- WebGPU is the **default** GPU execution provider for ONNX Runtime Web as
  of 2026 (onnxruntime.ai official docs), with broad browser support
  (Chrome/Edge out-of-box across Windows/macOS/Android/ChromeOS; Firefox
  behind a flag; Safari Technology Preview). *Directly transferable:*
  confirms WebGPU-primary + WASM-fallback is the correct, currently-
  supported architecture (not a bet on an immature standard) —
  Full Project Plan §2.8 (Deployment Strategy) builds on this directly.
  Sources: [Using WebGPU | onnxruntime](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html),
  [ONNX Runtime Execution Providers](https://onnxruntime.ai/docs/execution-providers/).
- **WebNN** exists as a further option (potential near-native performance)
  but is *not supported by default* in browsers as of this research.
  *Decision:* not adopted as a target for this project; noted as a future
  option if/when browser support matures (tracked in Full Project Plan §2.2 (Research Gaps),
  not built for now — avoids over-engineering for an unshipped standard).

##### 2.3 Quantization (INT8/FP16) and calibration

- Well-calibrated post-training INT8 quantization (PTQ) costs **~1.2–1.6%
  mAP** in published YOLO benchmarks; poorly-calibrated/naive INT8 costs
  **2.5–3%+**. *Directly transferable:* becomes the evidence basis for the
  degradation budget in Full Project Plan §2.7 (Quantization Strategy) (not picked arbitrarily,
  per the brief's explicit instruction).
- **Small, low-contrast objects are disproportionately hurt by INT8's
  quantization grid** — sub-pixel bounding-box precision matters more than
  the grid resolution can represent. *Directly transferable and important:*
  this is a direct warning specific to our `open_eye` class (the dataset's
  smallest, per Chapter II). INT8 export must be validated per-class, not
  just on aggregate mAP, or a real `open_eye` regression could hide inside
  an acceptable-looking aggregate number.
- A documented failure case: YOLOv6's decoupled head produced a **640×
  dynamic-range mismatch** between box-regression and classification
  outputs, causing complete INT8 collapse (mAP → 0) without proper
  per-branch calibration. *Transferable as a warning, not a direct risk*
  (YOLO26/YOLO11 heads differ from YOLOv6's), but it motivates *always*
  validating INT8 output numerically (not just trusting the exporter) before
  shipping — built into Full Project Plan §2.7 (Quantization Strategy)'s validation gate.
- FP16 is the literature-recommended default for **safety-adjacent tasks
  without QAT**; INT8 is recommended only for latency/power-critical
  deployments on standard CNN architectures with proper calibration.
  *Directly transferable:* driver drowsiness detection is safety-adjacent
  by any reasonable reading — FP16 becomes the default "balanced" tier,
  INT8 an opt-in "ultra-light" tier gated by the measured budget.

##### 2.4 Small-object detection & input resolution

- Increasing `imgsz` (up to what VRAM allows) reliably improves small-object
  recall because YOLO's grid-cell size in pixels stays roughly constant, so
  a larger input effectively gives smaller objects more grid cells to be
  detected from. 960–1280 is the commonly cited productive range above the
  640 default. *Directly transferable and already independently confirmed
  by this project's own data:* Chapter II of `BOOK.md` found `open_eye`
  median box side is 42.6px at 640 with 17.9% of boxes under 32px, dropping
  to 1.74% under 32px at imgsz 960 — an internal, dataset-specific
  confirmation of the general literature finding, not just a literature
  citation taken on faith. This is the evidence base for the resolution
  strategy in Full Project Plan §2.3 (Training Strategy).
- YOLO does **not** do intelligent tiling — it resizes the whole frame to
  `imgsz`, so detail loss on small objects at low `imgsz` is a direct
  consequence of the resize, not a separate bug to fix. *Transferable:*
  rules out "fix it in preprocessing" as an alternative to raising `imgsz`;
  resolution actually is the lever.

##### 2.5 Temporal reasoning / PERCLOS

- PERCLOS (percentage of time eyes ≥80% closed over a rolling window) is
  the standard, clinically-validated drowsiness metric; blink duration
  under normal conditions is <200ms, while sustained closure >500ms (and
  especially >2s) is the literature-standard drowsiness signal, most
  accurate when averaged over longer windows rather than judged frame-by-
  frame. *Directly transferable:* this is close to what `src/inference.py`
  already implements (`CRITICAL_HOLD_SECONDS=1.5`, `HISTORY_WINDOW=30`) —
  the existing hardcoded constants are in the right neighborhood of
  published thresholds, which is a useful sanity check, but they should be
  made configurable and explicitly justified rather than left as unexplained
  magic numbers (see Full Project Plan §2.10 (Src/ Refactor Plan)).
- Temporal smoothing (aggregating over a rolling window rather than trusting
  single-frame output) is explicitly what published systems use to
  suppress false positives from blinks or brief mouth movements.
  *Directly transferable:* confirms the brief's own instruction (§13) to
  add a lightweight temporal layer is standard practice, not a novel or
  risky addition — full design in Full Project Plan §2.8 (Deployment Strategy).

---

#### 3. Summary table: adopt / reject

| Finding | Adopt? | Where it lands |
|---|---|---|
| YOLO26n primary | Adopt | Locked per brief + confirmed by evidence above |
| YOLO11n as second baseline (not YOLO12n) | Adopt | Full Project Plan §2.9 (Experiment Plan) |
| NMS-free ONNX export as a deployment simplifier | Adopt | Full Project Plan §2.8 (Deployment Strategy) |
| imgsz 960–1280 for small-object recall | Adopt, dataset-confirmed | Full Project Plan §2.3 (Training Strategy) |
| WebGPU-primary + WASM fallback | Adopt | Full Project Plan §2.8 (Deployment Strategy) |
| WebNN | Reject for now (not default-supported) | Noted in Full Project Plan §2.2 (Research Gaps) only |
| FP16 default, INT8 opt-in with measured budget | Adopt | Full Project Plan §2.7 (Quantization Strategy) |
| Per-class (not just aggregate) INT8 validation | Adopt | Full Project Plan §2.7 (Quantization Strategy) |
| PERCLOS-based temporal layer | Adopt, close to existing `inference.py` design | Full Project Plan §2.8 (Deployment Strategy), Full Project Plan §2.10 (Src/ Refactor Plan) |
| Custom backbone swaps (e.g. MobileNetV4) | Reject | Out of scope — two stock model families only, per brief |
| External dataset spot-check (YAWDD) | Optional, low priority | Not in core experiment plan |

---

### 2.2 Research Gaps

Structured strictly as requested: **KNOWN** (established by literature or by
this project's own completed dataset work) vs **POTENTIAL CONTRIBUTION**
(a real, defensible gap this project could credibly fill) vs **NEEDS
EXPERIMENTAL PROOF** (a plausible hypothesis this project cannot yet claim).
No invented novelty.

---

#### 1. Leakage-safe evaluation

**KNOWN:** This project's own dataset pipeline discovered and fixed a real
subject/session leakage defect (Chapter XIII, `BOOK.md`): 9 of 11
driver-monitoring sessions had frames scattered across all three splits
before the fix. Published driver-drowsiness datasets in the surveyed
literature (YAWDD, UTA-RLDD, and the 2025 32-subject corpus) do not
describe subject-independent split verification methodology in the search
results reviewed for Full Project Plan §2.1 (Model Research 2026).

**POTENTIAL CONTRIBUTION:** A documented, reproducible methodology for
verifying subject/session independence in a merged, multi-source
driver-monitoring corpus — using naming-convention forensics plus
pixel-level corroboration rather than assuming provenance metadata is
correct — is a genuine, exportable methodological contribution, independent
of whether the eventual model beats any published accuracy number. The
project already has this as a finished artifact (Chapter XIII).

**NEEDS EXPERIMENTAL PROOF:** Whether leakage of this kind *actually
inflates* published accuracy numbers in comparable work is not established
here — no comparable model was trained both with and without the leak to
measure the gap. If time permits, training YOLO26n once on the pre-fix
(leaky) split and once on the corrected split, holding everything else
constant, would produce a directly measured leakage-inflation number. This
is optional — see Full Project Plan §2.9 (Experiment Plan) for whether it's in scope.

#### 2. Source-aware annotation / heterogeneous, partially-annotated corpora

**KNOWN:** This project's corpus is a merge of single-task sources (an
eye-only corpus and a yawn-only corpus), producing systematic — not
random — missing-label rates (96.3% missing eye labels in yawn-only images,
27.1% missing yawn labels in eye-only images; Chapter V, `BOOK.md`). The
project's response (source-aware supervision masking, Chapter VI/VII) is
implemented, validated, and explicitly *not* deployed in the final dataset
because it breaks under mosaic/mixup/cutmix augmentation (Chapter VII) —
a finding with no citation found in the literature search performed for
this document; it may be a genuinely unreported failure mode.

**POTENTIAL CONTRIBUTION:** The finding that per-image class-presence
masking interacts destructively with image-combining augmentation (mosaic
specifically) — because mosaic breaks the one-image-to-one-source-cohort
correspondence the mask presumes — is a specific, mechanistic finding not
found in the literature reviewed. If experimentally confirmed to matter in
practice (i.e. training with vs without the masking measurably changes
`yawning` recall on eye-only-sourced images), it would be a citable,
narrow but real contribution about a documented failure mode in a standard
technique (Ultralytics' own `Mosaic._cat_labels` behavior).

**NEEDS EXPERIMENTAL PROOF:** The masking approach is validated only at the
loss-computation level (Chapter VII: 0/1,358 real boxes left unsupervised
under mosaic with the corrected design), never in an actual training run,
since the final dataset ships without it. Whether using it would have
measurably improved `yawning` recall is an open, testable question — but
is explicitly **out of scope** for the current experiment plan (the
dataset ships standard-YOLO, no custom trainer required, per the
project's own decision) unless the user asks to reopen it as a research
side-track.

#### 3. Subject-independent and session-independent evaluation as a reporting standard

**KNOWN:** This project's held-out test set is leakage-verified session-
independent (Chapter XIII), which is stronger than a naive random split
but is not universally reported as a standard in the literature surveyed.

**POTENTIAL CONTRIBUTION:** none beyond what's captured in §1 — the
contribution is the verified split itself and its methodology, not a new
evaluation protocol.

**NEEDS EXPERIMENTAL PROOF:** N/A here; this is a completed artifact, not
a hypothesis.

#### 4. Browser deployment (WebGPU) for real-time DMS models

**KNOWN:** WebGPU is the default GPU execution provider in ONNX Runtime Web
as of 2026 with broad (though not universal) browser support. General
WebGPU/ONNX Runtime Web performance guides exist (§2.2,
Full Project Plan §2.1 (Model Research 2026)), but no driver-drowsiness-specific published
browser-deployment benchmark was found in the literature search performed.

**POTENTIAL CONTRIBUTION:** An actual measured Pareto frontier (accuracy vs
model size vs browser latency, across FP32/FP16/INT8, across WebGPU and
WASM, specifically for a 3-class small-object driver-monitoring detector)
would be a genuinely useful, currently-missing data point — most YOLO
browser-deployment benchmarks in general circulation target generic COCO-
style detection, not a small-object, safety-adjacent, resource-constrained
use case like this one. This is realistic and squarely within
Full Project Plan §2.6 (Evaluation Protocol)'s scope.

**NEEDS EXPERIMENTAL PROOF:** All of it — no browser latency numbers exist
yet for this project's models. This is the single largest experimentally-
open item in the whole plan.

#### 5. Ultra-small, quantized detection models for this specific task

**KNOWN:** General INT8 degradation literature (§2.3,
Full Project Plan §2.1 (Model Research 2026)) and the specific warning that small/low-contrast
objects are disproportionately hurt by INT8 rounding.

**POTENTIAL CONTRIBUTION:** A measured answer to "how much does INT8
specifically hurt the smallest class (`open_eye`) in a real quantized
export of this dataset" would be a concrete, dataset-specific data point
supporting (or refuting) the general literature warning — useful evidence
either way.

**NEEDS EXPERIMENTAL PROOF:** All of it — this requires an actual
quantized export and per-class evaluation, which is explicitly gated to
happen only *after* the best PyTorch checkpoints are identified (per the
user's own execution rules), not before.

#### 6. Robustness under glasses, lighting, and head pose

**KNOWN:** Literature (YOLO-FDCL, MDPI fatigue-detection papers) treats
lighting variation as a real, addressed failure mode; this project's own
Phase 11 human review (Chapter V) explicitly sampled `glasses`,
`night_lowlight`, `rotated`, and `odd_angle_profile` strata and found
reviewer agreement held up under all of them (25/25 blind controls correct
including rotated renders).

**POTENTIAL CONTRIBUTION:** None beyond what's already established by the
completed human-review work; this is a solid foundation, not a novel
finding.

**NEEDS EXPERIMENTAL PROOF:** Whether the *trained model* (not just the
human-reviewed labels) is actually robust under these conditions is
untested — this becomes a natural per-condition slice of
Full Project Plan §2.6 (Evaluation Protocol) once a model exists, not a claim to make now.

#### 7. Real-time temporal stability / false-positive yawning suppression

**KNOWN:** PERCLOS and closure-duration thresholds are well-established
(§2.5, Full Project Plan §2.1 (Model Research 2026)); temporal smoothing is standard practice
for suppressing blink/talking false positives.

**POTENTIAL CONTRIBUTION:** None claimed — this project's temporal-layer
design (Full Project Plan §2.8 (Deployment Strategy)) applies established practice rather than
inventing new theory, by explicit design (the brief asks for a *lightweight*
layer, not a research contribution here).

**NEEDS EXPERIMENTAL PROOF:** Whether the specific thresholds already coded
in `src/inference.py` (1.5s critical hold, 30-frame history) are well-tuned
for the eventual deployed model's actual frame rate is untested and will
need empirical tuning once real inference latency is measured.

#### 8. Closed eyes vs naturally closed eyes (blink vs sustained closure)

**KNOWN:** The literature distinction (blink <200ms vs sustained closure
>500ms) is a *temporal* distinction, not a per-frame visual one — a single
frame cannot distinguish a blink from the start of sustained closure by
appearance alone. This is a structural argument, not a new finding.

**POTENTIAL CONTRIBUTION:** None — this confirms (rather than challenges)
why the detector's job is limited to per-frame eye state, and the temporal
layer's job is the blink/drowsiness distinction. Correctly scoping this
boundary is good engineering, not a research contribution.

**NEEDS EXPERIMENTAL PROOF:** N/A — this is a design decision, not a
testable claim.

#### 9. Browser CPU (WASM) fallback quality

**KNOWN:** WASM is the standard fallback when WebGPU is unavailable;
YOLO26n's CPU-latency advantage (§1.1, Full Project Plan §2.1 (Model Research 2026)) is
directly relevant here.

**POTENTIAL CONTRIBUTION:** A measured WASM-fallback latency number for
this specific model/task combination — currently nonexistent — same
category as §4.

**NEEDS EXPERIMENTAL PROOF:** All of it — part of the browser benchmarking
work in Full Project Plan §2.6 (Evaluation Protocol)/Full Project Plan §2.8 (Deployment Strategy).

---

#### Summary: the strongest realistic contribution of this project

Not a new architecture, not a new loss function, not a new dataset (in the
"collect more data" sense) — the project's most defensible, already-
substantiated contribution is **methodological**: a documented, reproducible
process for detecting and repairing subject/session leakage in a merged,
heterogeneous driver-monitoring corpus (Chapter XIII, `BOOK.md`), combined
with — once the experiment plan runs — a **measured, small-object-aware,
browser-deployment Pareto frontier** for a 3-class DMS detector, which the
literature search performed here did not find already published for this
specific task shape. Both are realistic, both are already partially
substantiated by completed work, and neither requires inventing a claim not
yet supported by evidence.

---

### 2.3 Training Strategy

Resolution, schedule, optimizer, and pretrained-weight strategy for
YOLO26n (primary) and YOLO11n (second baseline), grounded in the dataset's
own measured properties (`BOOK.md`, Chapter II) and the literature reviewed
in Full Project Plan §2.1 (Model Research 2026).

---

#### 1. Training resolution — not defaulted to 1200

##### 1.1 The evidence, laid out before the decision

The dataset's own Chapter II analysis (tier-A, deployment-realistic images
only — pooled statistics across all tiers were shown to be misleading and
are not used here) gives exact numbers:

| imgsz | class | median box side (px) | % boxes < 32px |
|---|---|---:|---:|
| 640 | closed_eye | 94.0 | 9.73% |
| 640 | **open_eye** | **42.6** | **17.93%** |
| 640 | yawning | 97.0 | 0.15% |
| 960 | closed_eye | 141.1 | 6.36% |
| 960 | **open_eye** | **63.9** | **1.74%** |
| 960 | yawning | 145.6 | 0.15% |
| 1280 | open_eye | 85.3 | 0.50% |

`open_eye` is the binding constraint by a wide margin — at 640 nearly 1 in
5 `open_eye` boxes falls under the ~32px threshold below which a stride-8
detection head struggles to localize reliably. Raising to 960 cuts that to
1.74%; 1280 cuts it further to 0.5%, but with diminishing returns relative
to the jump from 640→960, and at a materially higher VRAM/FLOPs/latency
cost that must be paid at every training step, not just once.

##### 1.2 Decision: imgsz 960 for the primary training regime

960 is chosen, not 1280 and not 640, because:

- It captures the large majority of the small-object recall benefit
  (17.93% → 1.74% under-32px, an order-of-magnitude improvement) that 640
  cannot deliver.
- The marginal gain from 960→1280 (1.74% → 0.50%) is real but small
  relative to the cost: `yawning` boxes are already effectively unaffected
  by resolution (0.15% under-32px at *both* 640 and 960 — yawning is not
  resolution-limited), so the 960→1280 step buys almost nothing for two of
  three classes while increasing FLOPs roughly 1.8× over 960 (pixel area
  scales quadratically: 1280² / 960² ≈ 1.78).
- 960 is not an arbitrary "safe middle" pick — it is the point where the
  dataset's own measured curve for the binding class (`open_eye`) has
  already delivered the large majority of the achievable improvement.

**This must be re-validated, not assumed correct**, once Experiment 1
(Full Project Plan §2.9 (Experiment Plan)) runs: if 960 vs 1280 shows a materially different
`open_eye` AP than this table's box-size proxy predicts, the decision
should be revisited using the *measured* AP, not the *proxy* statistic
this section is based on.

##### 1.3 Train-high, deploy-tiered — what must actually be measured

The brief correctly notes training and deployment resolution need not be
identical. The scientifically correct framing is: **a model trained at 960
can be *evaluated* (not retrained) at lower inference resolutions to
measure how much accuracy is actually lost**, since YOLO detectors are not
resolution-locked at inference time. This is cheap to test (no retraining,
just re-running validation at a different `imgsz`) and should be done
explicitly before assuming a single 960-trained checkpoint can serve all
three deployment tiers:

1. Train once at 960 (primary regime, Experiment 0/1).
2. Evaluate the same checkpoint at 960, 640, and 480 inference resolution.
3. If accuracy degrades gracefully (a smooth curve, not a cliff), the
   train-high/deploy-tiered strategy is validated and one checkpoint can
   serve Tiers A and B (Full Project Plan §2.8 (Deployment Strategy)) with only an export-time
   resolution change.
4. If degradation is steep at lower resolutions, a second, lower-resolution
   training run (or the ultra-light/distilled path) becomes necessary
   instead of assumed sufficient.

This is a required, cheap validation step (§1.3 of Full Project Plan §2.9 (Experiment Plan)'s
Experiment 1), not an assumption baked into the plan.

#### 2. Optimizer and schedule

Ultralytics' own default optimizer selection (`AdamW`, auto-selected by
`optimizer="auto"`) is kept rather than hand-picking SGD — Ultralytics'
auto-selection already accounts for model size and dataset scale, and
overriding it without evidence of a specific problem would be exactly the
"tune everything" mistake Full Project Plan §2.5 (Hyperparameter Strategy) argues against.

- **Epochs:** `train.py`'s current default of 40 is too low as a serious
  baseline for a from-pretrained nano model on 39,627 training images —
  typical Ultralytics nano-model convergence on datasets this size needs
  more like 100–150 epochs with early stopping via `patience`, not a fixed
  low epoch count. Recommendation: 150 epochs, `patience=30`, and trust
  early stopping to end training when validation mAP plateaus rather than
  hand-picking a lower epoch count in advance.
- **AMP:** `train.py` currently hardcodes `amp=False`. This should be
  fixed to `amp=True` — the RTX 2000 Ada supports mixed precision natively,
  disabling it only slows training and increases memory pressure with no
  accuracy benefit at nano model scale. Flagged for correction in
  Full Project Plan §2.10 (Src/ Refactor Plan), not silently changed without review.
- **EMA:** kept on (Ultralytics default) — exponential moving average of
  weights is essentially free and consistently helps validation stability
  for YOLO-family models; no evidence-based reason to disable it.
- **Batch size:** current default 16 is conservative for a 16GB card at
  nano-model + 960 imgsz; 32 (or the largest batch AMP allows without OOM)
  should be tried in Experiment 0's validation pass, since larger batches
  at fixed LR generally stabilize BatchNorm statistics for nano models. Not
  pushed to be "as large as possible" — batch size interacts with `lr0`
  scaling and is exactly the kind of parameter that should be validated on
  a short run before committing GPU hours (Full Project Plan §2.5 (Hyperparameter Strategy)).
- **Freeze/unfreeze:** full fine-tuning (no frozen backbone layers) from
  COCO-pretrained weights. Nano models have little enough capacity that
  freezing risks under-fitting the 3-class, domain-specific (close-up
  face/eye/mouth) target distribution, which is visually quite different
  from COCO's object mix.

#### 3. Pretrained weights

Both models start from their official COCO-pretrained nano checkpoints
(`yolo26n.pt`, `yolo11n.pt`), not from scratch. Domain-specific fine-tuning
from a strong general-purpose initialization is standard practice and
there is no dataset-scale argument here for training from random
initialization (39,627 training images is enough to fine-tune well, not
obviously enough to out-perform a good pretrained init from scratch, and
training from scratch would burn far more GPU time for an unproven
benefit — directly against the "minimize wasted experiments" instruction).

#### 4. What is explicitly NOT part of the training strategy

- No custom loss reweighting beyond Ultralytics' stock `box`/`cls`/`dfl`
  weights at this stage — Full Project Plan §2.5 (Hyperparameter Strategy) covers whether/how
  these get tuned, kept separate from architecture/resolution/schedule
  decisions here.
- No source-aware loss masking (Chapter VII, `BOOK.md`) — the dataset ships
  standard YOLO format by the project's own prior decision; reopening this
  is out of scope unless explicitly requested.
- No architecture modification (backbone swaps, added attention modules,
  etc.) — two stock model families only, per the brief.

---

### 2.4 Augmentation Strategy

Per-augmentation recommendation for a close-up, face/eye/mouth,
driver-monitoring detection task — not a blanket "enable everything"
policy. Organized by whether the augmentation simulates a *realistic*
deployment condition (adopt), is *neutral* (adopt at low/moderate
strength), or would create an *unrealistic driver scene* (reject or
sharply limit).

The dataset's own findings (`BOOK.md`) directly inform this: Chapter VII
proved mosaic/mixup/cutmix break source-aware supervision masking (not in
use in the final export, so not a blocking concern here, but evidence that
image-combining augmentations interact with this dataset's structure in
non-obvious ways) and Chapter II established the small-object (`open_eye`)
sensitivity that several augmentations below are tuned around.

---

#### 1. Adopt — simulates a realistic deployment condition

| Augmentation | Setting | Why |
|---|---|---|
| **HSV (brightness/saturation/hue)** | Moderate (`hsv_v≈0.4`, `hsv_s≈0.5`, `hsv_h≈0.015`) | Directly simulates real lighting variation (dashboard/webcam exposure swings, time-of-day, in-cabin lighting) — literature-confirmed real failure mode (YOLO-FDCL, Full Project Plan §2.1 (Model Research 2026) §2.1), not a synthetic stressor. |
| **Random brightness/contrast/gamma jitter** | Moderate | Same rationale as HSV — webcams and phone cameras auto-expose inconsistently; this is deployment-realistic, not artificial. |
| **Motion blur (light)** | Low-moderate probability, small kernel | Driver head movement and low-end camera sensors produce real motion blur; distinguish deliberately from "bad data" (Ch. XIII, H8 of `BOOK.md` already found the dataset's own natural blur distribution and explicitly treated it as valid hard examples, not defects — augmentation should reinforce that distinction, not contradict it). |
| **JPEG compression artifacts** | Low-moderate, mild quality range only | Webcam/browser video streams are frequently compressed; mild compression augmentation improves robustness to the actual deployment input pipeline (a browser `<video>`/`getUserMedia` frame is not pristine). |
| **Horizontal flip** | Standard (p=0.5) | A driver's face is not inherently left/right asymmetric for these three classes; flip is a safe, realistic augmentation with no unrealistic-scene risk. |
| **Small-to-moderate translation** | Moderate (`translate≈0.1`) | Simulates natural head position/camera-framing variation — realistic, not synthetic. |
| **Small scale jitter** | Moderate (`scale≈0.3–0.5`) | Simulates driver-to-camera distance variation across vehicles/mounts — realistic. |

#### 2. Adopt at reduced strength, or with a specific caveat

| Augmentation | Setting | Caveat |
|---|---|---|
| **Rotation (`degrees`)** | Low (≤10–15°), not the aggressive 20° currently hardcoded in `train.py` | Chapter V of `BOOK.md` already found 40.5% of images have *baked-in* rotation from source capture, so the model must already tolerate real head-tilt. Additional *augmented* rotation should be mild — large synthetic rotation on top of already-tilted real data risks a scene a driver-facing camera would never actually produce (camera is fixed, not the head at extreme cabin angles). |
| **Perspective / shear** | Low, small magnitude | A driver-facing camera has a roughly fixed viewing geometry; large perspective/shear warps do not correspond to any physically realistic mounting variation and mostly add training noise for this task. Keep small, do not zero out entirely (some viewpoint variation is real). |
| **Random crop (as part of scale/translate, not a separate aggressive crop)** | Conservative | Aggressive random cropping risks cropping out the eye/mouth region entirely on the already-abundant close-up (tier C) images, turning a valid small-object example into a background-only training sample with no label — actively harmful given the dataset already includes genuine close-up crops (Chapter II, tier C, 20.9% of images) without needing augmentation to manufacture more. |

#### 3. Reject, or restrict to a near-zero/off default

| Augmentation | Decision | Why |
|---|---|---|
| **Mosaic** | **Off, or very low probability, with `close_mosaic` enabled for the final epochs regardless** | Mosaic composites four unrelated source images into one frame. For a close-up face/eye/mouth detection task this frequently produces a physically nonsensical scene (four different people's eyes/mouths tiled into one frame) that does not resemble any real deployment input — unlike COCO-style scene detection, where mosaic's diversity benefit is well-established, a driver-monitoring camera will never see this composition. This is a scene-realism argument, independent of (but reinforced by) Chapter VII's finding that mosaic also breaks this project's supervision-masking design (not itself active in training, since the dataset ships standard format, but corroborating evidence that mosaic interacts badly with this dataset's structure). If used at all, keep probability low and always disable for the final N epochs via Ultralytics' `close_mosaic` setting, which is standard practice specifically because mosaic's benefit is early-training regularization, not late-training fine detail. |
| **Mixup** | **Off** | Alpha-blending two images (soft-blending two different faces into one frame at reduced opacity) has no realistic driver-camera analogue and actively degrades sharp small-object (`open_eye`) boundary learning by blurring exactly the edges the detector needs to localize precisely. |
| **Copy-paste** | **Off** | Pasting an eye/mouth region from one image onto an unrelated background image produces a compositing artifact (edge/lighting mismatch) that a real camera would never produce, and offers little benefit for a task that is not object-count-limited (the dataset already has 68,292 boxes across 50,654 images — this is not a small-N problem copy-paste is meant to solve). |
| **Aggressive cutout / random erasing** | **Off, or extremely conservative** | Erasing arbitrary rectangular regions risks specifically erasing the small `open_eye` region by chance (given how small it already is at 640), producing a label with no correspondingly-visible object — actively counterproductive for the exact class this whole resolution/augmentation strategy is trying to help. |
| **Heavy synthetic noise (Gaussian/salt-pepper at high magnitude)** | **Off / very low** | Real sensor noise from webcams/phone cameras is better approximated by the JPEG-compression and mild-blur augmentations above; heavy synthetic noise beyond that risks manufacturing a signal-to-noise regime no real deployment camera would produce. |

#### 4. Multi-scale training

Ultralytics' built-in multi-scale training (varying `imgsz` slightly batch
to batch, e.g. ±50%) is a low-risk, well-established regularizer distinct
from the augmentations above, and complements the train-high/deploy-tiered
strategy in Full Project Plan §2.3 (Training Strategy) §1.3 by making the model somewhat more
robust to the exact inference resolution it eventually gets evaluated/
deployed at. **Recommendation: on, standard Ultralytics setting.**

#### 5. Summary rule

If an augmentation would produce a scene a driver-facing in-cabin camera
could never physically capture (four faces tiled together, one face
alpha-blended into another, an eye pasted onto an unrelated background),
it is rejected regardless of its general-purpose YOLO training reputation.
If it simulates a real, already-documented deployment condition (lighting,
blur, compression, head position/tilt within plausible range), it is
adopted, calibrated against what the dataset's own human review (Chapter V,
`BOOK.md`) already confirmed reviewers could still label correctly under
(e.g. rotated renders, low light, glasses).

---

### 2.5 Hyperparameter Strategy

A deliberately small, high-value search space — not a grid sweep. Every
parameter below is classified **FIXED** (kept at a justified value, not
searched — searching it would burn GPU time without expected payoff) or
**TUNED** (worth the cost of testing, with a bounded number of candidate
values). The goal is minimizing wasted experiments, per explicit
instruction.

---

#### 1. FIXED — not searched

| Parameter | Value | Why fixed, not tuned |
|---|---|---|
| Optimizer | `auto` (Ultralytics AdamW auto-select) | Already accounts for model scale/dataset size; hand-tuning optimizer choice for a nano model is a low-payoff search per general Ultralytics guidance and this project's own tooling maturity. |
| `momentum` | Ultralytics default | Interacts tightly with the auto-selected optimizer; not independently meaningful to tune without also tuning optimizer choice, which is itself fixed. |
| `weight_decay` | Ultralytics default | Nano models at this dataset scale (39,627 train images) are not in the severe-overfitting regime where weight decay tuning typically pays off first — other levers (augmentation, resolution) dominate. |
| `warmup_epochs` / `warmup_momentum` / `warmup_bias_lr` | Ultralytics defaults | Standard, well-validated defaults; warmup schedule tuning is a late-stage refinement, not a first-order lever for this project's size/scope. |
| `box`, `dfl` loss weights | Ultralytics defaults | Box/DFL loss keys off assignment and ground-truth boxes directly; there's no dataset-specific reason (e.g. a class-imbalance-in-box-regression problem) established to deviate from defaults. |
| Label smoothing | Off (Ultralytics default for detection) | Not standard practice for YOLO detection heads; no evidence-based reason to enable. |
| `close_mosaic` | On (final ~10 epochs), IF mosaic is used at all | Standard practice specifically to avoid mosaic's compositing artifacts contaminating late-stage fine localization — see Full Project Plan §2.4 (Augmentation Strategy) §3 for why mosaic itself is low/off. |
| AMP | **Fixed to `True`** (correcting `train.py`'s current `amp=False`) | RTX 2000 Ada supports AMP natively; disabling it has no accuracy benefit and only costs training speed/memory headroom — this is a bug fix, not a hyperparameter choice, tracked in Full Project Plan §2.10 (Src/ Refactor Plan). |
| EMA | On (Ultralytics default) | Effectively free, consistently helps validation stability for YOLO-family nano models. |
| Pretrained init | COCO nano weights (`yolo26n.pt` / `yolo11n.pt`) | Established in Full Project Plan §2.3 (Training Strategy) §3 — not re-litigated here. |

#### 2. TUNED — worth testing, bounded candidate set

| Parameter | Candidates | Method | Why this is worth the cost |
|---|---|---|---|
| `imgsz` | {640, 960, 1280} | Experiment 1 (Full Project Plan §2.9 (Experiment Plan)) — short runs, not full-length, to rank before committing full training budget | Directly evidence-motivated by the dataset's own box-size statistics (Full Project Plan §2.3 (Training Strategy) §1); the single highest-leverage parameter in this project given the `open_eye` small-object problem. |
| `batch` | {16, 32, largest-that-fits} | One short validation pass per candidate before the full run, checking for OOM and a rough throughput/epoch-time comparison | Batch size affects both training stability (BatchNorm statistics) and wall-clock cost directly; cheap to validate before committing, expensive to discover mid-run that a batch size OOMs after hours of training. |
| `lr0` | {0.01 (Ultralytics nano default), 0.002 (current `train.py` value)} | Compare via the short Experiment 0 baseline runs only — not a separate sweep | `train.py`'s current `lr0=0.002` is noticeably below Ultralytics' own nano-model default (`0.01`); this is exactly the kind of previously-hardcoded value that deserves one direct comparison rather than being trusted or silently reverted without evidence. |
| `patience` | {20, 30} | Set once per model family based on Experiment 0's observed convergence curve, not searched independently | Only matters in combination with total epoch budget; cheap to pick after seeing one real convergence curve rather than worth a dedicated experiment. |
| Mosaic probability | {0.0, low (~0.15)} | Compared directly within Experiment 2 (Full Project Plan §2.9 (Experiment Plan)), not swept finely | Full Project Plan §2.4 (Augmentation Strategy) argues for off/low on realism grounds; worth one direct A/B to confirm the realism argument doesn't cost measurable accuracy before finalizing at 0. |
| Rotation magnitude (`degrees`) | {0–10° (reduced), 20° (current `train.py` default)} | Compared within Experiment 2 | Directly testable claim from Full Project Plan §2.4 (Augmentation Strategy) §2 — the current 20° default may be too aggressive on top of the dataset's already-present 40.5% baked-in rotation; worth one direct comparison rather than assumed. |

#### 3. Explicitly NOT tuned, and why that's a deliberate choice

- **Full augmentation grid search** (every probability/magnitude
  combination) — rejected outright. Full Project Plan §2.4 (Augmentation Strategy) already
  derives a specific policy from realism reasoning and the dataset's own
  documented properties; re-deriving it via brute-force search would be
  the "hundreds of runs" anti-pattern the brief explicitly warns against.
- **Architecture hyperparameters** (depth/width multipliers, channel
  counts) — out of scope; two stock nano model configs only, per the
  brief.
- **Loss-weight reweighting for class imbalance** — the class distribution
  (36.1%/32.2%/31.7% box-level) is close enough to balanced (`H10` in
  `BOOK.md`'s hardening audit found a 1.14:1 max:min ratio and judged it
  mild, not harmful) that loss reweighting is not a justified first
  experiment; revisit only if per-class AP in Experiment 0 shows a
  surprising imbalance the raw box counts don't predict.

#### 4. Total experiment budget implied by this search space

Per model family: 1 baseline (Experiment 0) + up to 3 short resolution
validation runs (Experiment 1) + up to 2 short augmentation A/B runs
(Experiment 2) + 1 full confirmed-best-config run = **on the order of 5–7
runs per model family**, most of them short/cheap validation passes rather
than full-length training — not a combinatorial sweep. Full accounting and
stop conditions are in Full Project Plan §2.9 (Experiment Plan).

---

### 2.6 Evaluation Protocol

Full metric set for every experiment — never mAP alone. Two tiers:
**accuracy metrics** (is the model good) and **deployment metrics** (can it
actually ship to a browser). The final model-selection decision is a
Pareto comparison across both tiers, not a single leaderboard number.

---

#### 1. Accuracy metrics (computed every experiment)

| Metric | Source | Notes |
|---|---|---|
| mAP50 | Ultralytics `.val()` or `src/validation.py`'s custom evaluator | Both should agree; `validation.py` already computes real per-class AP/PR/confusion data (confirmed in the `src/` recon) — prefer it over trusting Ultralytics' summary alone, since it's already independently implemented in this codebase. |
| mAP50-95 | Same | The stricter, IoU-averaged metric — required, not optional, since mAP50 alone can hide poor box localization. |
| Precision, Recall, F1 (overall) | `validation.py` | Overall numbers are a starting point, not the decision metric — per-class breakdown below matters more for this 3-class, imbalanced-risk task. |
| **Per-class** AP, Precision, Recall | `validation.py` | Mandatory, not optional — the entire resolution/augmentation strategy is built around `open_eye` being the hard class; an aggregate mAP improvement that comes at `open_eye`'s expense must be visible, not averaged away. |
| Confusion matrix (class confusions + background FP/FN) | `validation.py` | Distinguishes "missed an eye entirely" from "confused open vs closed" — different failure modes needing different fixes. |
| False positives / false negatives (counts, not just rates) | `validation.py` | Raw counts matter for the yawning-false-positive concern (§9 below) and for hard-example mining (Full Project Plan §2.9 (Experiment Plan) Experiment 4). |

**Test-set discipline:** the certified `test/` split (5,589 images,
leakage-verified session-independent per `BOOK.md` Chapter XIII) is used
**only** for the final reported comparison between the best YOLO26n and
best YOLO11n configurations — not for iterative decisions during
Experiments 0–3, which use `val/` (5,438 images) exclusively. This
preserves the test set's validity as a genuinely held-out number, per
standard ML practice, and is worth stating explicitly since it's easy to
accidentally violate during iterative tuning.

#### 2. Deployment metrics (computed once per finalized checkpoint, not every micro-experiment)

| Metric | How measured |
|---|---|
| Parameters (count) | Reported directly by Ultralytics on model load. |
| FLOPs | Reported directly by Ultralytics (`model.info()`). |
| PyTorch checkpoint size (MB) | File size of `best.pt`. |
| ONNX FP32 size (MB) | File size after `export.py` FP32 export. |
| ONNX FP16 size (MB) | File size after FP16 export (Full Project Plan §2.7 (Quantization Strategy)). |
| ONNX INT8 size (MB) | File size after INT8 export, only for checkpoints that reach the quantization stage. |
| GPU inference latency (ms/frame) | PyTorch, batch=1, measured on the RTX 2000 Ada, warmed-up (discard first N iterations). |
| CPU inference latency (ms/frame) | ONNX Runtime (Python), batch=1, CPU execution provider — a proxy for the WASM tier before real browser benchmarking exists. |
| Preprocessing latency | Letterbox + normalize timing, isolated from model inference — matters because it's identical cost regardless of model choice and should not be conflated with model latency in comparisons. |
| Postprocessing latency | For YOLO26 (NMS-free): near-zero, decode only. For YOLO11 (NMS required): measured separately — this is expected to be a real, quantifiable point in YOLO26's favor, not assumed. |
| Peak memory (inference) | Process RSS or `torch.cuda.max_memory_allocated()`, PyTorch and ONNX Runtime separately. |
| FPS | Derived from total end-to-end latency (pre + inference + post), not from inference-only latency — the number that actually matters for real-time use. |

#### 3. Browser-specific metrics (once a candidate model is ONNX-exported)

| Metric | How measured |
|---|---|
| WebGPU inference latency | ONNX Runtime Web, WebGPU execution provider, measured in an actual browser (Chrome/Edge) via a minimal benchmark harness. |
| WASM inference latency | Same harness, WASM execution provider, as the fallback-tier number. |
| Model load / first-inference time | Time from page load to first successful detection — matters for perceived responsiveness, not captured by steady-state latency alone. |
| Memory footprint in-browser | Browser dev-tools memory profiling during sustained inference. |

This tier is explicitly **deferred until after the best PyTorch checkpoints
are identified** (per the user's own execution rules) — it is not run
speculatively on every candidate model.

#### 4. The Pareto comparison (final decision artifact)

A single plot/table, axes: **accuracy (mAP50-95, and separately `open_eye`
AP as the hard-class check) vs model size (ONNX file size) vs end-to-end
latency (ms, browser where available, else CPU-ONNX proxy)**. Every
finalized candidate (YOLO26n and YOLO11n, at each precision tier FP32/
FP16/INT8) is plotted. The winning configuration per deployment tier
(Tier A/B/C, Full Project Plan §2.8 (Deployment Strategy)) is read off this Pareto frontier,
not picked by mAP alone — a model that wins mAP by 0.5 points but costs
3× the latency is not automatically the right choice for a real-time
browser tool, and this protocol is designed specifically so that trade-off
is visible rather than hidden inside a single leaderboard number.

#### 5. Per-condition evaluation (secondary, informative, not the primary decision metric)

Where the test set's own metadata allows (tier A/B/C from `BOOK.md`
Chapter II; `sup_mask`/cohort-scope context from the supervision manifest
schema preserved in `BOOK.md` Appendix C), slice accuracy by:

- Object-size tier (A_full_frame / B_moderate_crop / C_extreme_crop)
- Source cohort (eye-only vs yawn-only vs both-annotated origin)

This surfaces whether a model's aggregate improvement is broad or
concentrated in one easy subpopulation — directly relevant given the
dataset's own documented tier-dependent class balance (Chapter II).
Condition-specific slices like glasses/lighting/rotation are **not**
re-derived here (no per-image tags for those exist in the shipped
dataset outside the now-deleted 430-case review sample); flagged as a
Full Project Plan §2.2 (Research Gaps)-adjacent limitation, not fabricated.

#### 6. What this protocol deliberately does NOT include

- No human perceptual evaluation ("does this look right") — out of scope,
  the certified dataset's labels are the ground truth being evaluated
  against, per the project's existing evidence-based discipline.
- No comparison against external published models/datasets as a primary
  metric — noted as optional/low-priority cross-check in
  Full Project Plan §2.2 (Research Gaps), not part of the core decision protocol, since this
  project's test set and any external dataset are not label-space or
  distribution compatible in a way that would make direct comparison sound.

---

### 2.7 Quantization Strategy

PyTorch → ONNX FP32 → FP16 → INT8, with an explicit, evidence-derived
degradation budget — not an arbitrary one. **Gated to run only after the
best PyTorch checkpoints are identified** (per the user's own execution
rules); this document defines the plan, it does not execute it early.

---

#### 1. Pipeline

```
best.pt (PyTorch)
  │
  ├─► ONNX FP32   — export.py, opset ≥17 (current default 17 is fine),
  │                 end2end=True for YOLO26n (self-contained decoded output,
  │                 see §2.1 Model Research 2026, §1.1)
  │
  ├─► ONNX FP16   — half-precision export; the recommended DEFAULT
  │                 deployment precision (Tier A/B, see §2.8 Deployment Strategy)
  │
  └─► ONNX INT8   — post-training static quantization with a representative
                     calibration set; OPT-IN, Tier C (ultra-light) only,
                     gated by the budget in §3
```

#### 2. Calibration set design (for INT8 only)

- **Source:** a stratified sample from the `train` split (never `val`/
  `test`, to avoid calibration leaking test-set information into the
  quantized model's behavior) — approximately 200–500 images, standard
  range for PTQ calibration set sizes.
- **Stratification:** sampled proportionally across the object-size tiers
  (A_full_frame / B_moderate_crop / C_extreme_crop, `BOOK.md` Chapter II)
  and, if feasible, across source cohorts (eye-only / yawn-only / both) —
  a calibration set drawn only from easy, large-object images would
  under-represent exactly the small-object (`open_eye`) activation ranges
  that need accurate calibration, defeating the purpose.
- **Static, not dynamic, quantization:** static PTQ (calibration-based
  scale/zero-point selection) is preferred over dynamic quantization for
  this task — dynamic quantization skips calibration but generally
  underperforms static PTQ for CNN-family detection models, and the
  literature-cited 1.2–1.6% degradation figures (Full Project Plan §2.1 (Model Research 2026)
  §2.3) are for well-calibrated *static* PTQ specifically.
- **Per-channel, not per-tensor, weight quantization** where the ONNX
  toolchain supports it — per-channel calibration is standard practice for
  convolutional weights and reduces the risk of the kind of dynamic-range
  mismatch that caused the documented YOLOv6 INT8 collapse
  (Full Project Plan §2.1 (Model Research 2026) §2.3) — not a guarantee against it, but the
  correct first line of defense.

#### 3. The acceptable degradation budget — derived, not arbitrary

Grounded directly in the PTQ literature reviewed (Full Project Plan §2.1 (Model Research 2026)
§2.3): well-calibrated INT8 PTQ typically costs 1.2–1.6% (aggregate mAP);
poorly-calibrated approaches cost 2.5–3%+. This project sets its budget at
the boundary between those two regimes, plus a class-specific guard:

| Condition | Budget |
|---|---|
| Aggregate mAP50-95 degradation (INT8 vs FP16 baseline) | ≤ **2.0 percentage points** |
| Aggregate recall degradation | ≤ **2.0 percentage points** |
| **`open_eye`-specific AP degradation** (the class flagged as most exposed to INT8 rounding error, Full Project Plan §2.1 (Model Research 2026) §2.3) | ≤ **2.5 percentage points**, evaluated separately — an aggregate pass that hides a larger `open_eye`-specific drop does NOT satisfy this budget |
| Model size reduction (INT8 vs FP16) | Must be ≥30% smaller to justify the accuracy trade at all — if INT8 barely shrinks the model, there is no reason to accept any accuracy loss for it |
| Latency improvement (INT8 vs FP16, browser or CPU-ONNX proxy) | Must be measurably faster — INT8 is adopted for the ultra-light tier specifically because it's faster/smaller, not by default |

**Decision rule:** INT8 ships as the Tier C (ultra-light) option **only
if all five conditions hold simultaneously**. If the aggregate budget
passes but the `open_eye`-specific check fails, INT8 is rejected for this
project even though it would look acceptable on an aggregate-only report —
this is the direct, operational consequence of the literature's small-
object warning, not a hypothetical caveat.

If INT8 fails the budget, Tier C falls back to: FP16 at a reduced input
resolution (cheap, no requantization risk — see Full Project Plan §2.3 (Training Strategy)
§1.3's resolution-robustness check), or a distilled/pruned FP16 model
(§5), in that order of preference, since both avoid the specific INT8
small-object risk entirely.

#### 4. Validation gate (mandatory before any INT8 model ships)

Per the YOLOv6 dynamic-range-mismatch cautionary finding
(Full Project Plan §2.1 (Model Research 2026) §2.3): **never trust the exporter's success
message alone.** Before an INT8 model is considered a candidate:

1. Run the quantized ONNX model through Full Project Plan §2.6 (Evaluation Protocol)'s full
   accuracy metric set (not just spot-checking a few images).
2. Compare per-class AP against the FP16 baseline explicitly (§3 table).
3. Visually spot-check a small sample of `open_eye` detections
   specifically, since this is the class the numeric budget is designed to
   protect — a fast sanity check that the numeric check isn't blind to a
   qualitative failure mode.

#### 5. Distillation and pruning — investigated, not assumed beneficial

Per the brief's explicit caution ("do NOT assume all compression methods
are beneficial"):

- **Knowledge distillation** (a larger fine-tuned checkpoint, e.g. YOLO26s
  or YOLO26m if trained as a side experiment, teaching the nano model) is
  a plausible Tier C lever **only if** the nano model's own accuracy
  ceiling (from Experiments 0–3) turns out to leave clear headroom a
  larger teacher could close — this is not knowable until those baseline
  results exist, so distillation is explicitly deferred, not planned as a
  committed step.
- **Structured pruning** of an already-nano model has a narrower payoff
  window than pruning a larger model (there is less redundancy to remove
  at "n" scale to begin with) — treated as a low-priority, likely-low-
  payoff option, attempted only if INT8 fails its budget (§3) and a
  reduced-resolution FP16 fallback (§3) is also found insufficient for
  Tier C's needs.
- **Weight sharing / architecture-aware compression** — out of scope; both
  require architecture modification, which is explicitly excluded (two
  stock model families only, per the brief).

#### 6. What is explicitly NOT done in this phase

No quantization is actually performed until the best PyTorch checkpoints
from Full Project Plan §2.9 (Experiment Plan) are identified and validated. This document is
the plan; execution is a later, separately-gated step.

---

### 2.8 Deployment Strategy

Browser-based, real-time driver-drowsiness detection: capture → detect →
temporal reasoning → alarm. Three deployment tiers, an explicit (not
assumed) answer to whether one trained model can serve all of them, and a
lightweight temporal-reasoning layer — not a second neural network.

---

#### 1. End-to-end pipeline

```
camera (getUserMedia)
  → frame capture (requestAnimationFrame / worker-driven loop)
  → letterbox resize + normalize (matches training preprocessing exactly)
  → ONNX Runtime Web session.run()
      ├─ WebGPU execution provider (default, when available)
      └─ WASM execution provider (fallback)
  → YOLO26n: already-decoded (N,300,6) output, no NMS step needed
    YOLO11n (if selected instead): NMS post-processing step required
  → confidence/box post-processing (class-aware thresholding)
  → lightweight temporal layer (§4)
  → drowsiness state + alarm UI
```

#### 2. Three-tier deployment — verified, not assumed, feasible

| Tier | Target | Model/precision | Inference resolution |
|---|---|---:|---|
| **A — Max quality** | Modern laptops, strong mobile (WebGPU available) | Best model (YOLO26n or YOLO11n per Pareto result), **FP16** | 960 (matches training resolution) |
| **B — Balanced** | Normal phones/laptops | Same checkpoint as Tier A, **FP16** | 640 (reduced inference resolution, same weights) |
| **C — Ultra-light** | Weak/older mobile browsers, WASM-only | INT8 **if it passes the Full Project Plan §2.7 (Quantization Strategy) §3 budget**, else FP16 at reduced resolution or a distilled/pruned fallback | 480–640 |

**The Tier A/B "same checkpoint, different inference resolution" design is
not assumed correct** — it depends entirely on the resolution-robustness
check specified in Full Project Plan §2.3 (Training Strategy) §1.3 (evaluate the 960-trained
checkpoint at 960/640/480 and confirm graceful, not cliff-edge,
degradation). If that check fails, Tier B requires either a second
lower-resolution training run or accepting Tier A's accuracy at Tier B's
target devices (a real possible outcome, not ruled out in advance).

Tier C's INT8-vs-fallback branch depends entirely on the quantization
validation gate (Full Project Plan §2.7 (Quantization Strategy) §3–4) — this document does not
pre-decide that outcome.

#### 3. ONNX Runtime Web execution provider strategy

- **WebGPU is the default GPU execution provider** as of 2026
  (Full Project Plan §2.1 (Model Research 2026) §2.2), with broad but not universal browser
  support (Chrome/Edge out-of-box across Windows/macOS/Android/ChromeOS;
  Firefox behind a flag; Safari Technology Preview only). The application
  must **feature-detect WebGPU availability at runtime** and fall back to
  WASM automatically, not assume WebGPU is present.
- **WASM is the universal fallback** — must be tested as a real deployment
  path, not an afterthought, since it's the only option on browsers without
  WebGPU support (a meaningful fraction of the target audience given the
  "weak mobile devices" requirement in the brief).
- **WebNN** is explicitly not targeted (not default-supported in browsers
  as of this research, Full Project Plan §2.1 (Model Research 2026) §2.2) — noted as a future
  option in Full Project Plan §2.2 (Research Gaps), not built now.

#### 4. Lightweight temporal reasoning layer

Per the brief's explicit instruction: no heavy temporal neural network.
Design grounded directly in the PERCLOS/closure-duration literature
(Full Project Plan §2.1 (Model Research 2026) §2.5), which is also already partially
implemented in `src/inference.py` (confirmed in the `src/` recon —
`CRITICAL_HOLD_SECONDS=1.5`, `HISTORY_WINDOW=30`, close to published
thresholds):

1. **Closed-eye persistence.** Track consecutive-frame (or rolling-window)
   `closed_eye` detections; a single closed-eye frame is a blink (normal,
   <200ms per literature), not an alarm condition. Sustained closure past a
   threshold (literature range 500ms–2s) escalates toward a drowsiness
   state.
2. **Yawning persistence + cooldown.** A single-frame `yawning` detection
   is not immediately alarmed on (talking/laughing can produce brief
   open-mouth frames the detector may still fire on, per `AUGMENTATION_
   STRATEGY.md`'s realism discussion and the dataset's own documented
   ambiguity between "open mouth" and "yawning," `BOOK.md` Chapter III).
   Require sustained or repeated detection within a window, then apply a
   cooldown before re-alarming on the same event.
3. **Confidence smoothing.** A rolling average (or exponential moving
   average) of per-class confidence over the history window, rather than
   thresholding raw single-frame confidence — directly reduces flicker
   from frame-to-frame detector noise without adding model complexity.
4. **Temporal voting.** Require N-of-M recent frames to agree on a state
   before transitioning the alarm state — standard debounce logic, not a
   learned component.
5. **Adaptive inference rate.** Not every captured frame needs a full
   detector pass — for a temporal-persistence signal, running inference at
   a fixed sub-video-framerate (e.g. 5–10 Hz) plus frame-skipping when the
   tab is backgrounded or the state is stably "alert" is a legitimate
   latency/battery optimization that does not require re-deriving the
   temporal design, only tuning its sampling rate.

**Tuning note:** the specific numeric thresholds (hold seconds, window
size, N-of-M) are currently hardcoded in `src/inference.py` without a
stated derivation. Full Project Plan §2.10 (Src/ Refactor Plan) flags making them configurable;
their *final* values should be tuned against the deployed model's actual
achieved frame rate once that's measured (Full Project Plan §2.6 (Evaluation Protocol) §2),
not left as pre-measurement guesses.

#### 5. Browser engineering considerations

- **Worker threads:** ONNX Runtime Web inference should run in a Web
  Worker, not the main thread, to keep the UI (video preview, alarm state)
  responsive regardless of inference latency — standard practice for any
  non-trivial in-browser ML workload.
- **OffscreenCanvas:** appropriate for the frame-capture/letterbox-resize
  step if it needs to happen off the main thread alongside the worker-based
  inference; adopted if profiling shows main-thread contention, not
  pre-emptively engineered before there's a measured need.
- **Model caching:** the ONNX model file should be cached (browser HTTP
  cache / Cache API) after first load — model load time is a real UX cost
  (Full Project Plan §2.6 (Evaluation Protocol) §3) and should not be re-paid every page visit.
- **Frame skipping under load:** if a device cannot sustain the target
  inference rate, degrade gracefully (lower sampling rate, not a frozen
  UI) — ties directly to the adaptive-inference-rate point in §4.5.

#### 6. What is explicitly NOT part of this deployment strategy

- No server-side inference fallback — the brief's target is browser-only,
  in-client inference; a server round-trip is out of scope.
- No native mobile app (React Native/Flutter) build — browser deployment
  only, per the brief.
- No WebNN adoption at this time — tracked as a future option, not built.

---

### 2.9 Experiment Plan

The minimum experiment set to find the strongest YOLO26n and YOLO11n
configurations and the accuracy/size/latency Pareto frontier between them —
not a combinatorial sweep. Every experiment has a hypothesis, a single
change, an expected effect, a metric, a stop condition, and a decision
rule, per the brief's explicit format. Experiments are ordered so cheap,
high-information runs happen before expensive, long ones, and later
experiments are conditional on earlier results rather than pre-committed.

Budget discipline (per the user's execution rules): validate configuration
on a short run before committing to a full-length run; never run two
GPU-heavy experiments simultaneously; record every result before deciding
the next step; skip any experiment that cannot materially move the Pareto
frontier.

---

#### Experiment 0 — Baseline (both model families)

- **Hypothesis:** a corrected, sane baseline config (AMP on, `lr0` at the
  Ultralytics nano default rather than `train.py`'s current 0.002, imgsz
  640 as the standard reference point, 150 epochs with `patience=30`,
  default augmentation) establishes a trustworthy reference number for
  everything that follows. This experiment exists to produce a *fair*
  baseline, not to win — `train.py`'s current defaults (40 epochs,
  `amp=False`, `lr0=0.002`) are not trusted as-is (Full Project Plan §2.3 (Training Strategy)
  §2, Full Project Plan §2.5 (Hyperparameter Strategy) §2).
- **Change:** apply the corrected fixed hyperparameters from
  Full Project Plan §2.5 (Hyperparameter Strategy) §1, imgsz=640 (reference point only, not
  yet the resolution experiment).
- **Expected effect:** a stable, reproducible convergence curve for each
  model family, mAP in a plausible range for a nano detector on this task
  (no specific number assumed in advance).
- **Metric:** full Full Project Plan §2.6 (Evaluation Protocol) §1 accuracy set, on `val`.
- **Stop condition:** training curve plateaus (Ultralytics `patience`
  triggers) or 150 epochs reached, whichever first.
- **Decision rule:** if a run fails to converge sensibly (loss diverges,
  mAP stays near zero past a reasonable number of epochs), diagnose before
  proceeding — do not continue the experiment plan on top of a broken
  baseline. If it converges normally, record all metrics and proceed to
  Experiment 1.
- **Cost control:** run a 5-epoch smoke test first for each model family to
  confirm the pipeline (data loading, checkpointing, validation) works
  end-to-end before committing to the full 150-epoch run — this is the
  "validate configuration before expensive runs" step, and is cheap
  insurance against discovering a config bug after hours of GPU time.

#### Experiment 1 — Resolution (both model families, conditional on Experiment 0 succeeding)

- **Hypothesis:** imgsz 960 measurably improves `open_eye` AP over 640,
  consistent with the dataset's own box-size statistics
  (Full Project Plan §2.3 (Training Strategy) §1.1); imgsz 1280 improves further but by a
  smaller margin, at higher cost.
- **Change:** imgsz ∈ {640 (from Exp 0, reused, not rerun), 960, 1280},
  all else held at Experiment 0's corrected baseline config.
- **Expected effect:** `open_eye` AP: 640 < 960 < 1280, with the 640→960
  gap larger than the 960→1280 gap (per the box-size table).
- **Metric:** per-class AP (especially `open_eye`), plus FLOPs/latency cost
  at each resolution (Full Project Plan §2.6 (Evaluation Protocol) §2, measured once per
  resolution, not per epoch).
- **Stop condition:** each resolution run uses the same epoch budget as
  Experiment 0 (reuse the same `patience`-based stopping), not a
  fixed-shorter run — resolution changes the effective information content
  per epoch, so cutting epochs short here would confound resolution with
  under-training.
- **Decision rule:** pick the imgsz that maximizes `open_eye` AP per unit
  of added FLOPs/latency cost — not the single highest-AP resolution
  unconditionally. If 960→1280 gives less than ~1 AP point of `open_eye`
  improvement for ~1.8× the FLOPs (the a priori prediction,
  Full Project Plan §2.3 (Training Strategy) §1.2), 960 is confirmed as the training
  resolution and 1280 is not pursued further. **Also run the resolution-
  robustness check here** (Full Project Plan §2.3 (Training Strategy) §1.3): evaluate the
  chosen checkpoint at lower inference resolutions than it was trained at,
  to settle the Tier A/B "one checkpoint, multiple resolutions" question
  before Full Project Plan §2.8 (Deployment Strategy) §2 is finalized.

#### Experiment 2 — Augmentation (both model families, at the resolution chosen in Experiment 1)

- **Hypothesis:** the realism-motivated augmentation policy in
  Full Project Plan §2.4 (Augmentation Strategy) (mosaic off/low, reduced rotation, no mixup/
  copy-paste) performs at least as well as — and is expected to
  outperform, since it avoids the manufactured-scene problem described
  there — a default aggressive-augmentation policy (mosaic on, 20°
  rotation, as currently hardcoded in `train.py`).
- **Change:** two augmentation configs compared directly: (a) this
  project's derived policy, (b) `train.py`'s current defaults, all else
  held at the Experiment 0/1 winning config.
- **Expected effect:** the derived policy matches or beats the current
  defaults on `val` mAP, and is expected to show a clearer advantage on
  `open_eye` AP specifically (mosaic/mixup are argued to hurt sharp
  small-object boundaries, Full Project Plan §2.4 (Augmentation Strategy) §3).
- **Metric:** full accuracy set, `val` only.
- **Stop condition:** same epoch budget/patience as Experiment 0/1 runs.
- **Decision rule:** adopt whichever config wins on `val` mAP50-95 AND
  does not regress `open_eye` AP specifically — if the two configs are
  statistically indistinguishable, prefer the realism-motivated policy on
  the independent, non-accuracy grounds already established (no
  manufactured scenes, Full Project Plan §2.4 (Augmentation Strategy) §5), rather than treating
  a tie as inconclusive.

#### Experiment 3 — Hyperparameter refinement (conditional, only if Experiments 0–2 leave an open question)

- **Hypothesis:** batch size and `patience` refinements
  (Full Project Plan §2.5 (Hyperparameter Strategy) §2) provide a smaller, second-order
  improvement over the resolution/augmentation wins already captured.
- **Change:** batch ∈ {16, 32/largest-that-fits}, `lr0` re-confirmed at
  whichever value won implicitly in Experiment 0 (not re-tested unless
  Experiment 0 showed an ambiguous result between the two `lr0` candidates).
- **Expected effect:** modest (sub-1-AP-point) further improvement, mostly
  in training stability/wall-clock efficiency rather than a large accuracy
  jump.
- **Metric:** full accuracy set, plus wall-clock training time per epoch
  (a batch-size-driven efficiency metric, not just accuracy).
- **Stop condition:** one run per batch-size candidate, same
  patience-based stopping.
- **Decision rule:** **this experiment is skipped entirely if Experiments
  0–2 already show clearly diminishing returns** — per the explicit
  instruction to avoid experiments that cannot materially improve the
  Pareto frontier. Only run if there's a specific open question (e.g.
  Experiment 0 showed training instability that a larger batch might fix,
  or wall-clock time is a binding constraint worth optimizing).

#### Experiment 4 — Hard-example / error-driven refinement (conditional, only if justified by Experiment 0–3 error analysis)

- **Hypothesis:** the confusion matrix and false-positive/false-negative
  analysis (Full Project Plan §2.6 (Evaluation Protocol) §1) from the best config so far
  reveals a specific, addressable failure mode (e.g. a particular tier or
  cohort systematically underperforming) that targeted intervention could
  fix cheaply.
- **Change:** *not pre-specified* — determined by what the error analysis
  actually shows (see `HARD_EXAMPLE` methodology below, folded into this
  experiment rather than a separate document per the plan's file-count
  discipline).
- **Expected effect:** a targeted, measurable improvement on the specific
  identified weak point, not a general re-run.
- **Metric:** the specific per-class/per-condition metric the weakness was
  identified in.
- **Stop condition:** one targeted intervention, one measurement — this is
  explicitly not an open-ended iterative loop within the current
  experiment budget.
- **Decision rule:** **run only if Experiments 0–3 reveal a specific,
  addressable weakness.** If the best-so-far model's errors are diffuse
  (no single identifiable failure mode) rather than concentrated, this
  experiment is skipped — diffuse errors are a model-capacity/data
  question, not something a single targeted experiment fixes, and forcing
  one anyway would violate the "avoid experiments that cannot materially
  improve the Pareto frontier" rule.

##### Hard-example identification methodology (used only if Experiment 4 runs)

1. **Confusion analysis** — which class pairs does the model actually
   confuse (not just miss)?
2. **False-negative mining** — pull the specific images where a real box
   was missed entirely; check whether they cluster by tier, cohort, or
   image-quality signal (blur/brightness, per `BOOK.md`'s H8 audit data
   shape, preserved in Appendix C even though the raw file is gone —
   equivalent signals can be recomputed from the dataset directly).
3. **False-positive mining** — specifically for `yawning` false positives
   (the brief's own named concern, §9) — check whether they cluster on
   open-mouth-but-not-yawning frames, consistent with the documented
   ambiguity in `BOOK.md` Chapter III.
4. **Confidence distribution analysis** — is the model's confidence
   well-calibrated (high confidence → high precision) or does it produce
   many low-confidence-but-correct or high-confidence-but-wrong
   predictions? This tells you whether a threshold adjustment (cheap) or a
   training fix (expensive) is the right lever.

#### Summary: total experiment count

| Model family | Exp 0 | Exp 1 | Exp 2 | Exp 3 | Exp 4 | Total (max) |
|---|---:|---:|---:|---:|---:|---:|
| YOLO26n | 1 (+ smoke test) | 3 | 2 | 0–2 (conditional) | 0–1 (conditional) | 6–9 |
| YOLO11n | 1 (+ smoke test) | 3 | 2 | 0–2 (conditional) | 0–1 (conditional) | 6–9 |

Realistic expected total, assuming Experiment 3/4 are mostly skipped per
their own decision rules (the expected outcome, not a certainty): **~12
substantive training runs total** across both model families, most of them
shorter validation-style runs rather than full 150-epoch runs — not "run
everything," a bounded, front-loaded-with-cheap-runs plan.

#### After the best PyTorch checkpoints are identified

Only then: ONNX export (Full Project Plan §2.7 (Quantization Strategy) §1), FP16/INT8
quantization (§2–4), and browser benchmarking (Full Project Plan §2.8 (Deployment Strategy),
Full Project Plan §2.6 (Evaluation Protocol) §3) — explicitly sequenced after, never
interleaved with, the training experiments above, per the user's own
execution rules.

---

### 2.10 Src/ Refactor Plan

A concrete, file-by-file plan built directly from the read-only recon
performed during planning (findings summarized in the plan file and
repeated here for a self-contained reference). **No edits happen as part
of this document** — this is the plan for the next phase, executed only
after this document exists, and every edit will back up the original file
first per the user's explicit instruction ("do not overwrite working
scripts without creating a backup/version first").

---

#### 1. `train.py`

| Issue found | Fix |
|---|---|
| Defaults to a root-level `--data dataset.yaml` that does not exist (only `data/Dataset-Main/data.yaml` exists) | Change the default `--data` path to `data/Dataset-Main/data.yaml`, or fail fast with a clear error naming the correct path if not found — either way, stop silently failing/pointing at a nonexistent file. |
| `amp=False` hardcoded | Change to `amp=True` (Full Project Plan §2.3 (Training Strategy) §2 — RTX 2000 Ada supports AMP natively, no accuracy cost, real speed/memory benefit). |
| `epochs=40` hardcoded | Change default to 150 with `patience=30` (Full Project Plan §2.9 (Experiment Plan) Experiment 0) — expose both as CLI flags so experiments can override without editing code. |
| `imgsz=384` hardcoded | Change default to 960 (Full Project Plan §2.3 (Training Strategy) §1.2) — expose as a CLI flag (needed directly for Experiment 1's resolution sweep). |
| `lr0=0.002` hardcoded, below Ultralytics' own nano default | Expose as a CLI flag defaulting to the Ultralytics nano default (0.01), per Full Project Plan §2.5 (Hyperparameter Strategy) §2 — Experiment 0 will determine which value is actually better; the code should make both trivially selectable, not force a re-edit per experiment. |
| Hardcoded aggressive augmentation block (`degrees=20`, `mixup=0.1`, etc.) | Replace with the Full Project Plan §2.4 (Augmentation Strategy) policy as the new default, but expose every value as a CLI flag/config key so Experiment 2's A/B comparison doesn't require code edits between runs. |
| Default weights path hardcoded to one specific prior checkpoint | Change default to the official pretrained nano weights (`yolo26n.pt`/`yolo11n.pt`, selected by a `--model` flag), remove the hardcoded prior-run dependency. |
| No experiment/config logging | Add: write the full resolved config (all hyperparameters, resolved paths, git-independent since this isn't a git repo — include a timestamp and a free-text experiment name) to a JSON/YAML file alongside each run's checkpoint directory, so every experiment in Full Project Plan §2.9 (Experiment Plan) is independently reproducible from its own logged config. |

#### 2. `validation.py`

| Issue found | Fix |
|---|---|
| Same missing-`dataset.yaml` default problem as `train.py` | Same fix — point at `data/Dataset-Main/data.yaml` by default. |
| Already computes real per-class AP/PR/confusion — this is the evaluator Full Project Plan §2.6 (Evaluation Protocol) is built around | Keep as the primary evaluator; no functional rewrite needed. Add: a CLI flag to also emit results as a machine-readable JSON/CSV row (not just charts) so Full Project Plan §2.9 (Experiment Plan) runs can be tabulated and compared programmatically rather than only visually. |
| Depends on `test_video.py`'s `MODEL_REGISTRY`, which hardcodes 4 specific stale checkpoint paths | Decouple — `validation.py` should accept a `--weights` path directly and not require importing a hardcoded registry from an unrelated script. |

#### 3. `test.py` / `test_and_report.py`

| Issue found | Fix |
|---|---|
| Hardcoded `CHECKPOINTS_DIR` to one specific run folder; hardcoded test video filename | Parameterize both via fixtures/env vars/CLI so the test suite runs against whatever checkpoint the current experiment produced, not a fixed prior run. |
| Error message references `python src/expert.py` (typo for `export.py`) | Fix the typo — trivial but real. |
| No provider-selection test (CPU vs GPU vs, eventually, WebGPU-equivalent CPU-ONNX proxy), no quantization test, no latency benchmark | Add: a test that loads the same ONNX model under both CPU and CUDA execution providers and asserts output parity within tolerance; a test that loads an INT8-quantized model (once one exists) and asserts it doesn't crash/produce NaNs — these are cheap correctness gates that belong in the test suite, not just in Full Project Plan §2.6 (Evaluation Protocol)'s manual process. |
| `test_and_report.py` is a 7-line forwarder to `test_video.py:main` | Low priority — either fold into `test_video.py` directly or leave as-is; not worth dedicated effort. |

#### 4. `test_video.py`

| Issue found | Fix |
|---|---|
| `MODEL_REGISTRY` hardcodes 4 checkpoint paths under inconsistently-named folders (evidence of scattered prior experiment organization) | Replace with a config file (`configs/checkpoints.yaml` or similar) listing available checkpoints by name/tag, populated automatically from Full Project Plan §2.9 (Experiment Plan) run outputs rather than hand-maintained. This directly fixes the "inconsistent naming across scripts" problem found in recon (`export.py`'s hardcoded list uses different names for what look like the same checkpoints). |
| Random video selection with no seed if `--video` omitted | Add a `--seed` flag (default fixed, e.g. 0) for reproducible default behavior — nondeterministic defaults make bug reports and comparisons harder than necessary. |
| PyTorch-only inference path (no ONNX exercised here) | Low priority — `test.py` already covers ONNX loading; not necessary to duplicate in the video harness unless a specific need arises. |

#### 5. `inference.py`

| Issue found | Fix |
|---|---|
| Hardcoded fatigue/temporal thresholds (`FATIGUE_WARNING_THRESHOLD`, `CRITICAL_HOLD_SECONDS`, `HISTORY_WINDOW`, etc.) with no stated derivation | Make configurable (constructor args or a config file), and add a short comment citing the PERCLOS/closure-duration literature basis (Full Project Plan §2.1 (Model Research 2026) §2.5, Full Project Plan §2.8 (Deployment Strategy) §4) so future tuning has a documented starting point instead of untraceable magic numbers. |
| `device="cuda:0"` hardcoded, no CPU-fallback detection | Add `torch.cuda.is_available()` (or ONNX Runtime provider availability) checking with automatic CPU fallback — directly needed once this logic informs the browser WASM-fallback design conceptually, and needed regardless for running on a machine without a GPU. |
| No ONNX Runtime execution-provider latency comparison hook, despite the CUDA EP already being wired for the RF-DETR ONNX branch | Add a lightweight benchmark mode (reuses the CUDA EP wiring pattern already present) that reports per-provider latency — feeds Full Project Plan §2.6 (Evaluation Protocol) §2's CPU/GPU latency metrics directly. |

#### 6. `export.py`

| Issue found | Fix |
|---|---|
| Only supports `onnx`/`engine` formats, no explicit FP16/INT8 quantization step | Add explicit `--precision {fp32,fp16,int8}` handling: FP32/FP16 via Ultralytics' own export `half=True` option; INT8 via a new quantization step implementing Full Project Plan §2.7 (Quantization Strategy)'s calibration design (§2). |
| No ONNX Runtime Web / WebGPU export or benchmark path | Out of scope for `export.py` itself (that's a browser-side JS harness, not a Python export step) — add a note/handoff point instead: `export.py` should emit the ONNX file in the form the browser harness expects (opset, `end2end=True` for YOLO26n), and a separate lightweight JS benchmark script (new, small, part of Full Project Plan §2.8 (Deployment Strategy)'s implementation, not this Python file) consumes it. |
| `dynamic=False` hardcoded | Keep fixed-shape export as the default (simpler, and browser deployment typically wants a fixed input size for predictable performance) but expose as a flag rather than a hardcoded constant, in case a use case needs dynamic shapes later. |
| Hardcoded `--all` checkpoint list, inconsistent naming vs `test_video.py`'s registry | Same fix as `test_video.py` §4 — both should read from the same config-driven checkpoint registry, eliminating the naming drift found in recon. |

#### 7. `webcam-test.py`

| Issue found | Fix |
|---|---|
| Hardcoded default weights path (same stale YOLO11m checkpoint as elsewhere) | Point at the config-driven checkpoint registry (§4/§6) instead of a hardcoded path. |
| No FPS/latency logging beyond the on-screen HUD | Add simple stdout/log-file latency logging — low effort, directly useful for informal real-device testing ahead of formal browser benchmarking. |

#### 8. `visualize-info/`

| Issue found | Fix |
|---|---|
| `visualize_model.py` — **entirely fabricated mock charts** (hardcoded fake mAP/training-time numbers, stale project path, stale image count contradicting the real 50,654) | **Remove or fully rewrite** — this file actively misleads if run and its output trusted. Do not keep a "fix later" placeholder; either delete it (after backup, per the user's rule) or rewrite it from scratch to read real `metrics.csv`/experiment-log data (the way `plot_loss.py` already correctly does). |
| `plot_loss.py` | Reusable as-is, no changes needed. |
| `report.py` | Empty stub ("Report generator ready." only) — low priority; could eventually consume the JSON experiment logs proposed in §1 to auto-generate the progress reports the user's execution rules ask for after each experiment, but not required before training starts. |

#### 9. New files needed (not fixes to existing ones)

| New file | Purpose |
|---|---|
| `configs/checkpoints.yaml` (or similar) | Single source of truth for checkpoint paths/tags, replacing the scattered hardcoded lists in `test_video.py` and `export.py` (§4, §6). |
| `configs/<model>_<experiment>.yaml` | One config file per Full Project Plan §2.9 (Experiment Plan) experiment, resolved and logged by `train.py`'s new config-logging behavior (§1) — makes every experiment independently reproducible by filename alone. |
| A minimal ONNX Runtime Web + WebGPU/WASM benchmark harness (JavaScript, not Python) | Required for Full Project Plan §2.6 (Evaluation Protocol) §3's browser latency numbers — does not exist anywhere in the current `src/`, which is entirely Python. |
| A quantization script (or a mode within `export.py`) implementing Full Project Plan §2.7 (Quantization Strategy)'s calibration/validation pipeline | Currently no INT8/FP16-with-validation path exists anywhere in `src/`. |

#### 10. Priority order (once this plan is approved for execution)

1. **Blocking fixes** (must happen before Experiment 0 can run at all):
   `train.py`'s missing-`dataset.yaml` default, `amp=False`, and exposing
   imgsz/epochs/lr0/augmentation as CLI-overridable rather than hardcoded.
2. **High-value, low-risk** (fixes clear bugs, improves experiment
   reproducibility): config logging in `train.py`, checkpoint-registry
   consolidation across `test_video.py`/`export.py`, `expert.py` typo fix.
3. **Needed before quantization/deployment phases specifically** (not
   blocking training): FP16/INT8 export support in `export.py`, the
   quantization script, the browser benchmark harness.
4. **Cleanup, not blocking anything**: removing/rewriting
   `visualize_model.py`'s fabricated charts, making `inference.py`'s
   temporal thresholds configurable.

Every change in tiers 1–2 will be backed up (original file copied with a
version suffix) before being edited, per the user's explicit instruction —
no file is overwritten without a recoverable prior version.

---

#### 2.10.1 Execution Summary — What Actually Happened

The plan above (§2.10 as originally written) has been fully executed, plus
a second pass renaming files to match conventional naming and consolidating
where "the old file was fake/redundant/hard to remember." Every file
listed in §1–§9 above was fixed as described. What changed beyond the
original plan:

**Renames** (all internal imports/references updated together, so nothing
was left pointing at an old name):

| Old name | New name | Why |
|---|---|---|
| `validation.py` | `evaluate.py` | Matches Ultralytics' own `val.py` convention; clearer than "validation" for a script that computes AP/PR/confusion metrics. |
| `test.py` | `src/test_pipeline.py` | Real pytest suite, renamed to avoid the pytest auto-collection ambiguity of a bare `test.py`. Briefly moved to a separate `tests/` folder, then moved back into `src/` on the user's explicit instruction: one flat scripts folder is easier to keep track of than several small folders ("less files is better to understand" — this is a standing preference, see AGENTS.md). |
| `test_video.py` | `demo_video.py` | It's a visual HUD demo tool, not a unit test — the old `test_` prefix meant pytest could try to collect it as a test module. |
| `webcam-test.py` | `webcam_demo.py` | Same reasoning, plus the hyphen made it an invalid Python module name. |
| `visualize-info/visualize_model.py` | `src/compare_experiments.py` | Its actual job (post-rewrite) is cross-experiment comparison, not "visualizing a model." Briefly lived in a `src/reports/` subfolder, then flattened into `src/` directly for the same one-folder preference as above. |
| `visualize-info/plot_loss.py` | `src/plot_training_curves.py` | It plots mAP curves too now, not just loss. Same flattening as above. |
| `test_and_report.py` | *(deleted)* | Pure 4-line forwarder to `test_video.py`/`demo_video.py`, added nothing. |
| `visualize-info/report.py` | *(deleted)* | Empty stub, never implemented. |
| `src/_original_backup/` | *(deleted)* | Its job (safety net during the rewrite) was done; kept the repo from accumulating permanent cruft — this project has no git history to fall back on otherwise, so this was a deliberate, confirmed-with-the-user deletion, not an accident. |
| `src/README.md` | `src/SCRIPTS_OVERVIEW.txt` | User asked for a small plain-text file, not markdown, then renamed it to a name that says what it actually is (not a generic "README"). |

All scripts now live directly in `src/` — no `tests/` or `reports/`
subfolders. This is a deliberate, standing preference (fewer folders to
keep a mental map of), not an oversight; don't re-split them later without
the user asking.

**The project's folder convention ("favorite structure"), now the standing
rule for every future experiment** — also written to `AGENTS.md` at the
project root so any future session follows it without re-deriving it:

```
checkpoints/<family>/<N>-<name>/
    best.pt            <- train.py output (flattened out of Ultralytics'
    last.pt                own weights/ subfolder)
    best.onnx           <- export.py output, saved automatically next to best.pt
    best.engine          (if exported)
    run_config.json     <- full resolved hyperparameters + final metrics
    results.csv         <- Ultralytics' own per-epoch metrics
    report/              <- plot_training_curves.py output

INFO/<family>/<N-name>-test-result/
    tested-images/      <- evaluate.py output (charts/, evaluation_report.txt,
                            test_summary.md, metrics.json) -- run against the
                            test split (5,589 images, 11.03% of the dataset)
    tested-video/        <- demo_video.py output (one video, randomly picked
                            from data/raw_videos/ unless --video is given)

INFO/_comparison/        <- compare_experiments.py output (spans every family)
```

`<family>` is inferred automatically from the weights filename (e.g.
`yolo26n.pt` -> `yolo26n`); `<N>` auto-increments per family by scanning
existing `checkpoints/<family>/` subfolders. Retraining the same family
with a different augmentation policy (e.g. a worst-case-augmentation A/B
against the realism-gated baseline) lands as a new numbered experiment
*inside the same family folder* — `checkpoints/yolo26n/2-worst-case-
augmentation/` — not a new top-level folder. A different model family
(`yolo11n`) gets its own top-level folder, mirrored the same way under
`INFO/`.

Note this deliberately puts evaluation/demo output inside `INFO/`, which is
the SAME physical directory as `info/` on this case-insensitive Windows
filesystem (the directory holding this very file, `BOOK.md`) — earlier in
the refactor that collision was treated as a hazard to route around
(`runs_eval/` was used instead); the user later explicitly asked for
results to live in `INFO/`, so this is now the deliberate, confirmed
convention, not an oversight.

---

### 2.11 Model Development Master Plan (Executive Summary)

Executive document. Answers every question from the planning brief in one
place, cross-linking the ten supporting documents rather than duplicating
their content. Read this first; go to the linked document for the full
reasoning and evidence behind any answer.

---

#### 1. What is the strongest model choice?

**YOLO26n** as primary, **YOLO11n** as the second baseline. Full reasoning:
Full Project Plan §2.1 (Model Research 2026) §1.

#### 2. Why YOLO26n?

Three independent, evidence-backed reasons: ~31–43% faster CPU inference
than YOLO11n (matters for the WASM fallback tier), natively NMS-free
end-to-end architecture (simplifies the entire ONNX Runtime Web deployment
pipeline and removes an export-portability failure class), and a
small-object-targeted loss design (ProgLoss + STAL) that directly targets
this dataset's own documented weak point (`open_eye`, median 43px at 640).
Full Project Plan §2.1 (Model Research 2026) §1.1.

#### 3. YOLO11n vs YOLO12n — which second model and why?

**YOLO11n.** Ultralytics itself does not recommend YOLO12 for production —
attention-layer training instability, higher memory use, slower CPU
inference — all three directly disqualifying for a browser-deployed,
resource-constrained task. YOLO12n is excluded from the experiment plan
entirely rather than benchmarked "just in case," since running it would
burn GPU time against a model family its own maintainer discourages.
Full Project Plan §2.1 (Model Research 2026) §1.2.

#### 4. Recommended training resolution and why

**imgsz 960**, not the initially-considered 1200 and not the 640 default.
Derived directly from the dataset's own box-size statistics: `open_eye`
(the binding, smallest class) drops from 17.93% of boxes under 32px at 640
to 1.74% at 960 — capturing the large majority of the achievable
small-object benefit — while yawning is already resolution-insensitive at
both 640 and 960, so pushing to 1280 buys little for two of three classes
at ~1.8× the FLOPs cost. Re-validated experimentally, not assumed, in
Full Project Plan §2.9 (Experiment Plan) Experiment 1. Full reasoning: Full Project Plan §2.3 (Training Strategy)
§1.

#### 5. Recommended augmentation

Realism-gated, not blanket-enabled: HSV/brightness/blur/JPEG-compression
augmentation adopted (simulates real deployment conditions, literature-
confirmed failure modes); mosaic/mixup/copy-paste/aggressive-cutout
rejected or minimized (produce physically unrealistic driver-camera scenes
and specifically risk erasing/blurring the small `open_eye` region).
Rotation reduced from the current 20° default given 40.5% of the dataset
already has baked-in real rotation. Full table and rationale:
Full Project Plan §2.4 (Augmentation Strategy).

#### 6. Recommended hyperparameters

A deliberately small set is tuned (imgsz, batch size, `lr0` — with
`train.py`'s current 0.002 directly challenged against Ultralytics' own
0.01 nano default, mosaic probability, rotation magnitude); everything else
(optimizer choice, momentum, weight decay, warmup, loss weights, label
smoothing) is fixed at justified defaults and explicitly not searched, to
avoid the "hundreds of runs" anti-pattern. Full FIXED/TUNED table:
Full Project Plan §2.5 (Hyperparameter Strategy).

#### 7. Recommended optimizer

Ultralytics' auto-selected optimizer (`optimizer="auto"`) — not hand-overridden
without evidence of a specific problem. Full Project Plan §2.3 (Training Strategy) §2.
**Correction (2026-08-12, post-Exp1):** this section assumed at planning time
that `auto` would resolve to AdamW. Verified from source after Exp1 finished
(§3.1) that `auto` actually resolves to **MuSGD** at this dataset's scale
(iterations > 10000 triggers the MuSGD branch, not the AdamW one) — the
planning-time assumption was wrong, not the evidence gathered later.

#### 8. Recommended training schedule

150 epochs, `patience=30` (trust early stopping over a fixed low epoch
count — `train.py`'s current 40-epoch default is judged too low for a
serious baseline), AMP enabled (currently disabled — a bug, not a
deliberate choice), EMA on, full fine-tuning from COCO-pretrained nano
weights (no frozen layers, no from-scratch training). Full Project Plan §2.3 (Training Strategy)
§2–3.

#### 9. How to maximize recall without exploding model size

Resolution (§4 above) is the primary lever — it improves small-object
recall without changing model size at all, since imgsz is a training/
inference-time choice, not an architecture change. Secondary lever:
realism-gated augmentation (§5) avoids the accuracy cost of manufactured
training scenes. Model size itself is held constant throughout the entire
training-experiment phase (both families stay at "n" scale, per the
brief) — size only becomes a lever in the deployment/quantization phase
(§16–17 below), kept strictly separate from the accuracy-maximizing
training phase.

#### 10. How to improve small-eye detection

Three compounding, independently-justified levers: resolution (imgsz 960,
§4), YOLO26n's STAL loss design (§2), and realism-gated augmentation that
specifically avoids erasing/blurring small objects (mosaic/cutout
rejected, §5). Cross-referenced fully in Full Project Plan §2.1 (Model Research 2026) §1.1 and
Full Project Plan §2.3 (Training Strategy) §1.

#### 11. How to reduce false yawning detections

Not a training-time fix alone — the literature-confirmed ambiguity between
"open mouth" and "yawning" (this dataset's own Chapter III/V findings,
`BOOK.md`) means the detector will always have some irreducible per-frame
ambiguity. The primary lever is the **temporal layer** (persistence +
cooldown, not single-frame alarming), designed in Full Project Plan §2.8 (Deployment Strategy)
§4. Secondarily, Full Project Plan §2.9 (Experiment Plan) Experiment 4's false-positive mining
(specifically targeting yawning FPs, per the brief's own named concern) is
the training-time diagnostic step, run conditionally if warranted.

#### 12. How to perform hard-example mining

Confusion analysis → false-negative mining (clustered by tier/cohort/image
quality) → false-positive mining (yawning-specific) → confidence
distribution analysis, run only if Experiments 0–3 reveal a specific,
addressable weakness rather than diffuse error. Full methodology:
Full Project Plan §2.9 (Experiment Plan) Experiment 4.

#### 13. How to evaluate scientifically

Full accuracy metric set (never mAP alone) plus deployment metrics
(params/FLOPs/size/latency/memory) plus browser-specific metrics once a
candidate exists, with strict train/val/test discipline (test set touched
only once, for the final YOLO26n-vs-YOLO11n comparison, never during
iterative tuning) and a Pareto comparison as the actual decision artifact
rather than a single leaderboard number. Full protocol:
Full Project Plan §2.6 (Evaluation Protocol).

#### 14. How to export to ONNX

Ultralytics' `.export()` (already wired in `export.py`), `opset≥17`,
`end2end=True` specifically for YOLO26n (yields the self-contained decoded
`(N,300,6)` output that materially simplifies browser deployment).
Full Project Plan §2.7 (Quantization Strategy) §1, Full Project Plan §2.10 (Src/ Refactor Plan) §6.

#### 15. How to use FP16

The **default deployment precision** for Tiers A and B — literature-
recommended for safety-adjacent tasks without QAT, no calibration-set
complexity, and the natural first export target after FP32.
Full Project Plan §2.7 (Quantization Strategy) §1, §3.

#### 16. How to use INT8

Opt-in, Tier C (ultra-light) only, gated by an explicit, literature-derived
degradation budget (≤2.0pp aggregate mAP/recall, ≤2.5pp on `open_eye`
specifically since small objects are disproportionately hurt by INT8
rounding, ≥30% size reduction, measurable latency win) — all five
conditions must hold simultaneously or INT8 is rejected for this project.
Static, per-channel, calibration-based PTQ using a stratified sample from
`train` only. Full budget and validation gate: Full Project Plan §2.7 (Quantization Strategy)
§2–4.

#### 17. Whether QAT is worthwhile

Not planned as a default step — PTQ is attempted first, since it's cheaper
and the literature-cited degradation figures (1.2–1.6% well-calibrated)
suggest PTQ alone may clear the budget in §16. QAT becomes worth
investigating only if PTQ fails the budget specifically on `open_eye` and
a reduced-resolution FP16 fallback is also judged insufficient —
positioned as a fallback option, not a committed experiment.
Full Project Plan §2.7 (Quantization Strategy) §3, §5.

#### 18. Whether distillation is worthwhile

Not assumed beneficial, and not planned as a committed step — genuinely
depends on whether Experiments 0–3 leave visible accuracy headroom a
larger teacher model could close, which is unknown until those results
exist. Investigated only if the nano model's ceiling turns out to leave
clear room and Tier C's INT8/FP16 options are both judged insufficient.
Full Project Plan §2.7 (Quantization Strategy) §5.

#### 19. How to create high-quality / balanced / ultra-light deployment variants

Three tiers (A/B/C), designed around one core open question resolved
experimentally rather than assumed: whether a single 960-trained checkpoint
can serve Tiers A and B at different inference resolutions (tested via the
resolution-robustness check in Full Project Plan §2.3 (Training Strategy) §1.3 /
Full Project Plan §2.9 (Experiment Plan) Experiment 1) — if it degrades gracefully, one
checkpoint covers two tiers; if not, a second training run is needed. Tier
C is FP16-reduced-resolution or validated INT8, per §16 above. Full
architecture: Full Project Plan §2.8 (Deployment Strategy) §2.

#### 20. How to benchmark in Browser WebGPU

A minimal ONNX Runtime Web harness (new — does not exist in the current
Python-only `src/`), measuring WebGPU and WASM-fallback latency, model
load time, and in-browser memory, run **only after** the best PyTorch
checkpoints and their FP16/INT8 exports are identified — never
interleaved with the training-experiment phase. Full Project Plan §2.6 (Evaluation Protocol)
§3, Full Project Plan §2.8 (Deployment Strategy) §3, Full Project Plan §2.10 (Src/ Refactor Plan) §9.

#### 21. What the major research gaps are

Leakage-safe evaluation methodology for merged DMS corpora (this project
already has a finished contribution here — Chapter XIII, `BOOK.md`);
browser/WebGPU-specific deployment benchmarks for small-object DMS
detectors (essentially unpublished for this task shape); INT8 degradation
specifically on small objects like `open_eye`, measured rather than
assumed. Full KNOWN/POTENTIAL/NEEDS-PROOF breakdown: Full Project Plan §2.2 (Research Gaps).

#### 22. What potential contribution this project can make

Primarily **methodological**: a documented, reproducible subject/session-
leakage detection-and-repair process for a merged, heterogeneous
driver-monitoring corpus (already substantiated, Chapter XIII, `BOOK.md`),
plus — once the experiment plan runs — a **measured** accuracy/size/
latency Pareto frontier for a 3-class, small-object-aware, browser-
deployed DMS detector, which the literature search performed did not find
already published for this specific task shape. Neither claim is asserted
before the supporting evidence exists. Full Project Plan §2.2 (Research Gaps), final section.

#### 23. What should NOT be done

- Blind grid-search hyperparameter sweeps (Full Project Plan §2.5 (Hyperparameter Strategy)
  §3).
- Mosaic/mixup/copy-paste/aggressive cutout at meaningful strength
  (Full Project Plan §2.4 (Augmentation Strategy) §3 — realism and small-object arguments both
  against).
- Assuming imgsz 1200 without checking the marginal-return math against
  960 (Full Project Plan §2.3 (Training Strategy) §1.2).
- Assuming INT8 is beneficial without measuring the class-specific
  degradation, especially on `open_eye` (Full Project Plan §2.7 (Quantization Strategy) §3–4).
- Interleaving quantization/deployment work with the training-experiment
  phase, or running it before the best PyTorch checkpoints exist
  (Full Project Plan §2.9 (Experiment Plan), final section).
- Running YOLO12n as a third model "just to check" — excluded on
  Ultralytics' own production-readiness evidence, not omitted by oversight
  (Full Project Plan §2.1 (Model Research 2026) §1.2).
- Modifying the dataset, deleting `src/` files, or overwriting working
  scripts without a backup (standing execution rules, this phase and the
  next).
- Trusting the *original* `visualize-info/visualize_model.py`'s output — it
  was fabricated mock data, not a real report (Full Project Plan §2.10 (Src/
  Refactor Plan) §8). This has since been fixed: it's now
  `src/reports/compare_experiments.py` and reads real `run_config.json`/
  `metrics.json` data only (§2.10.1).

#### 24. Exact order of implementation after this planning phase

1. **Blocking `src/` fixes** (Full Project Plan §2.10 (Src/ Refactor Plan) §10, tier 1): fix
   `train.py`'s missing-`dataset.yaml` default, `amp=False`, and expose
   imgsz/epochs/lr0/augmentation as CLI-overridable. Each edit backed up
   first.
2. **Smoke test**: a short (~5-epoch) run per model family confirming the
   corrected pipeline actually works end-to-end before committing to a
   full run.
3. **Experiment 0** (baseline) → **Experiment 1** (resolution) →
   **Experiment 2** (augmentation), per model family, per
   Full Project Plan §2.9 (Experiment Plan) — recording full metrics after each, comparing
   against the running-best, and deciding whether to continue per each
   experiment's own decision rule.
4. **Experiment 3/4**, conditionally, only if their own trigger conditions
   are met.
5. **Progress report** at each milestone in the format the user specified
   (experiment number, model, imgsz, hyperparameters, augmentation policy,
   full metric set, conclusion).
6. Identify the best PyTorch checkpoint(s) across both model families via
   the Pareto comparison (Full Project Plan §2.6 (Evaluation Protocol) §4).
7. **Only then**: ONNX export, FP16/INT8 quantization with the validation
   gate, and browser (WebGPU/WASM) benchmarking.
8. Final Pareto frontier across precision tiers and both model families;
   Tier A/B/C deployment recommendation.
9. Stop and report final results — no further phase begins without
   explicit approval.

---

## 3. Introduction and Motivation

The task began from a simple brief: prepare a YOLO-ready object detection
dataset for a driver-drowsiness monitor, detecting three classes —
`closed_eye`, `open_eye`, `yawning` — from a 57,098-image corpus already
possessing YOLO-format labels. The naive path would have been: check the
images decode, check the labels parse, split 78/11/11, done. That path was
explicitly rejected in favor of a much longer one, because the corpus, once
examined, did not behave like a single coherently-annotated dataset.

The project therefore adopted a discipline common in high-stakes data
engineering but uncommon in ad hoc dataset preparation: **treat every
convenient assumption as a hypothesis to be measured, not a fact to be
assumed.** Two examples set the tone for everything that followed:

- The assumption "an unlabeled region means the object is absent" was tested
  and found false for roughly half the dataset (Chapter V) — the corpus is a
  merger of single-task sources, each of which only annotated its own class.
- The assumption "a merge threshold that produces a clean-looking split is
  therefore a *correct* split" was tested and found circular (Chapter VIII) —
  the same number was being used to build a grouping and then to prove the
  grouping was safe, which proves nothing.

Every subsequent chapter follows this pattern: state the convenient
assumption, measure whether it holds, and build the pipeline around what was
actually found rather than what was hoped for.

---

## 4. The Corpus: Composition and Provenance

`data/Dataset-Main` contains 57,098 images across three pre-existing splits
(train/valid/test, in the Roboflow convention), each with a YOLO label file.
Filename-provenance analysis (Chapter V, §3) revealed the corpus is a union
of at least the following identifiable source pools:

| Source signature | Approx. images | Character |
|---|---:|---|
| `_#` (bare numeric stem) | ~10,481 | eye-state corpus, eye-only annotated |
| `dd_v1_*` | 9,052 | compiled drowsy-driving photo set (static photos, confirmed *not* a video session — Chapter XIII) |
| `yawn_new_*`, `Yimg_*`, `img_*` | ~5,358 | yawning corpus, yawn-only annotated |
| `sNNNN_FFFFF_*` | 1,655 | driver-monitoring session recordings, 11 distinct subjects/sessions |
| `istockphoto*` | 901 | stock photography |
| various (`closed_eye_`, `WIN_`, `webcam`, etc.) | remainder | miscellaneous single-image sources |

No single source annotated all three classes consistently. This is the fact
that shapes the entire supervision strategy in Chapters VI–VII, and the fact
that produces the leakage discovered and repaired in Chapter XIII.

---

## Chapter 3 — Experimental Execution Log

*(Status: in progress. This chapter is updated as each experiment from
Full Project Plan §2.9 runs — it records what actually happened, not what
was planned. Plan vs. actual divergences are noted explicitly, not
silently reconciled.)*

### 3.1 Experiment 1 — YOLO26n Baseline Fine-Tuning

**Command:** `python src/train.py --config configs/yolo26n_baseline.yaml`
**Started:** 2026-08-11, 1:00 PM EDT (user-confirmed launch time; run's own
log timestamp read 12:44:49 EDT — clock offset between machine and user,
not reconciled further).
**Weights:** `yolo26n.pt` (COCO-pretrained, per Full Project Plan §2.3 §3)
**Dataset:** `data/Dataset-Main/data.yaml`
**Output:** `checkpoints/yolo26n/1-baseline-yolo26n-960-mild-aug/` (renamed
2026-08-13 from the original `1-baseline/` to the project-wide
`<N>-<model>-<imgsz>-<aug-level>` folder convention — see AGENTS.md)

**Resolved hyperparameters (verified directly from
`checkpoints/yolo26n/1-baseline-yolo26n-960-mild-aug/args.yaml`, the actual resolved Ultralytics
trainer args — not from memory or the config file):**

| Parameter | Value |
|---|---|
| imgsz | 960×960 |
| epochs (max) | 150 |
| patience (early stop) | 30 |
| batch | 32 |
| optimizer | `auto` in args.yaml, resolved to **MuSGD** — verified 2026-08-12 by reading Ultralytics' `BaseTrainer.build_optimizer` source directly (not inferred from args.yaml): the `auto` branch computes `iterations = ceil(train_images/batch) * epochs` and picks `MuSGD` whenever `iterations > 10000`; here `ceil(~39.6k/32)*150 ≈ 185,700`, well over the threshold. Cross-confirmed numerically against `results.csv`'s `lr/pg0..pg7` columns, which show exactly 4 param-group pairs with a constant 3.000 ratio at every logged epoch — the exact signature of that code path's `lr*3` boost for detection/semantic-head ("muon") params. This reverses the "NOT VERIFIED" note that stood here previously; that note was itself a premature over-correction (the original MuSGD claim was right, just unverified at the time it was first made — it is now verified by source + data, not by assumption). |
| lr0 (actually used) | **0.01 base / 0.03** for muon-pattern params (`cv3`/semantic heads) — the `auto` branch **ignores** the configured `lr0`/`momentum` entirely (Ultralytics logs this explicitly: "optimizer=auto found, ignoring lr0=X and momentum=X... determining automatically") and hardcodes `lr=0.01` for the MuSGD branch regardless of what args.yaml's `lr0: 0.01` happens to say (same numeric value here by coincidence, not because the config was honored) |
| momentum (actually used) | **0.9**, hardcoded by the `auto`→MuSGD branch — args.yaml's `momentum: 0.937` was configured but silently ignored, per the same "ignoring lr0/momentum" log line |
| cos_lr | True |
| AMP | True |
| box / cls / dfl loss weights | 7.5 / 0.5 / 1.5 |
| weight_decay | 0.0005 |
| warmup_epochs | 3.0 |
| workers | 2 |
| device | CUDA 0, NVIDIA RTX 2000 Ada Generation, 16380 MiB |
| seed / deterministic | 0 / True |

**Augmentation (as run):**

| Augmentation | Value |
|---|---|
| mosaic / mixup / copy_paste / cutmix | 0 / 0 / 0 / 0 (off, per Full Project Plan §2.4 §3) |
| erasing | 0 |
| degrees / shear / perspective | 10.0 / 2.0 / 0.0 |
| translate / scale | 0.1 / 0.4 |
| hsv_h / hsv_s / hsv_v | 0.015 / 0.5 / 0.4 |
| fliplr / flipud | 0.5 / 0 |
| multi_scale | 0 (off — Full Project Plan §2.3 §2 recommended on; divergence noted, not yet reconciled) |
| albumentations extra (p=0.01 each) | Blur, MedianBlur, ToGray, CLAHE |

**Progress log — verified from `results.csv` (all 77 completed epoch rows
read directly, not sampled from terminal-paste excerpts):**

| Epoch | mAP50 | mAP50-95 | P | R | Note |
|---|---|---|---|---|---|
| 1 | 0.489 | 0.216 | 0.522 | 0.504 | cold start |
| 1→52 | climbing | climbing | — | — | steady, mostly monotonic |
| **52** | 0.87083 | **0.53175** | 0.77641 | 0.79117 | **mAP50-95 peak → this is `best.pt`** |
| 52→58 | still rising | flat/dipping | — | — | plateau |
| 58 | **0.87252** | 0.53157 | 0.76173 | 0.80822 | mAP50 peak (not the saved best — see correction below) |
| 58→73 | falling | falling | falling | flat/rising | decline, see root-cause note |
| 73 | 0.78067 | 0.4683 | 0.68061 | 0.81829 | trough |
| 73→77 | recovering | recovering | — | — | recovery, no config change |
| 77 (last) | 0.86164 | 0.52321 | 0.74161 | 0.79866 | run stopped here, `last.pt` |

Measured throughput (full run, from `results.csv`'s own cumulative `time`
column, epoch 1 → epoch 77): **73,394.7s / 77 epochs ≈ 15.9 min/epoch
average.** This is a measured value, not the earlier partial-run estimate
(~16.7 min/epoch from epoch 1-2 only) — consistent with it, now confirmed
over the full run instead of extrapolated from 2 epochs.

**Best-checkpoint correction (verified, not assumed):** live tracking during
the run assumed epoch 58 (highest mAP50 in the run, 0.87252) was the saved
`best.pt`. That assumption was wrong. Verified directly from `best.pt`'s own
embedded checkpoint metadata (`epoch` and `best_fitness` fields, read via
`torch.load`) and cross-checked against `best.pt`'s file-save timestamp
against `results.csv`'s per-epoch `time` column — both independently point
to **epoch 52** (highest mAP50-95 in the run, 0.53175), not epoch 58.
`best_fitness` stored in the checkpoint is numerically identical to epoch
52's mAP50-95, not the commonly-assumed 0.1×mAP50 + 0.9×mAP50-95 blend
(which would have picked epoch 58, by an ~7e-6 margin — effectively a tie).
Practical result unaffected either way: epoch 52 is `best.pt`, confirmed
three independent ways.

**Root cause of the epoch 58→73 decline (evidence-based, from all 77 rows
— not a live guess):** `train/cls_loss` fell smoothly and monotonically the
entire time (0.72266→0.67955) while `val/cls_loss` rose sharply
(0.70926→0.84676, +19%) and val precision/mAP fell with it. Both
`train/box_loss` and `val/box_loss` stayed flat-to-improving throughout —
box regression was never the problem. Train-loss-down + val-loss-up
simultaneously, isolated to the classification head, is the textbook
overfitting signature, and it is genuinely present here. However, it
self-reversed by epoch 77 with no config change — classic/permanent
overfitting does not typically do that on its own. Best-supported
conclusion: a temporary widening of the train/val generalization gap on the
classification head, self-corrected before the run was stopped. LR was
smoothly decreasing per the `cos_lr` schedule the whole time (no spike), so
this is not attributed to an LR shock. Root cause is not fully conclusive
beyond this — flagged per this project's KNOWN vs. NEEDS-EXPERIMENTAL-PROOF
discipline, not settled as either "overfitting" or "instability" alone.

**Status:** STOPPED (manually, after epoch 77/150; no crash — no training
process was found running, and `results.csv`/`last.pt` both timestamp the
same moment). Did not reach `patience=30` auto-stop either (last new best
was epoch 52; at epoch 77 the no-improvement counter was at 25/30). Full
detail: `checkpoints/yolo26n/1-baseline-yolo26n-960-mild-aug/experiment_1_summary.txt`
(plus the standardized `summary.txt` in the same folder, backfilled
2026-08-13 to match the format every run now gets automatically).

**Terminal logging bug — found and fixed:** the per-batch progress line in
`src/train.py`'s `on_train_batch_end` callback used a raw `\r\033[K`
in-place update sized against `os.environ["COLUMNS"]=250`, which does not
control the real console width. A narrower actual terminal window made the
line wrap to 2 rows, and `\r` then only rewound to the wrapped row — leaving
the first row's text stuck, repeated up to ~1,239×/epoch. Fixed: the
progress line is now clamped to the real terminal width via
`shutil.get_terminal_size()` every batch. The epoch-end print was also
consolidated into one block that now includes validation metrics (P/R/
mAP50/mAP50-95) alongside train loss — previously only train loss was
printed at epoch end. A `training.log` file (`logging.FileHandler`) was
added so the full run header, hyperparameters, and every epoch-end summary
now persist to `checkpoints/<family>/<N>-<name>/training.log`, not just the
terminal (Experiment 1 has no such file — it predates this fix, which is
exactly why full duration/throughput here had to be reconstructed from file
timestamps and `results.csv` instead of read from a log).

---

### 3.2 Experiment 2 draft — YOLO26n, Evidence-Tuned Augmentation (NOT RUN — superseded)

**Status: NOT RUN.** Config (`configs/yolo26n_worst_case_aug.yaml`) remained
prepared and dry-run verified but was never launched — the user chose the
fine-tune-from-`best.pt` direction (§3.3) instead once that alternative was
worked out. Left here, unmodified, as a valid future option (fresh start,
imgsz=960, `optimizer: auto`→MuSGD, moderate evidence-tuned augmentation) if
ever wanted later — not deleted just because it wasn't picked first.

**Revision note (2026-08-12):** this section originally specified a
"worst-case" augmentation profile (erasing=0.4, degrees=25, scale=0.7, etc.)
sized as a blanket stress test. It was replaced — not reused — after a
direct request to re-derive Experiment 2 from Experiment 1's actual evidence
rather than carry the old numbers forward. See rationale below.

**Config:** `configs/yolo26n_worst_case_aug.yaml` (filename kept for
continuity; `name:` field inside now resolves to
`checkpoints/yolo26n/2-evidence-tuned-aug/`)
**Command (user runs this):** `python src/train.py --config configs/yolo26n_worst_case_aug.yaml`

**Starting weights — fresh `yolo26n.pt`, not Experiment 1's `best.pt`.**
Considered and rejected resuming from `best.pt` (epoch 52): Ultralytics'
`cos_lr` schedule restarts at `lr0=0.01` for any new run regardless of the
initial weights' prior training — applying a fresh high-LR cosine decay on
top of weights already converged under a *different, weaker* augmentation
regime risks disturbing settled features rather than building on them
cleanly. It would also carry forward the specific classification-head
brittleness signature §3.1 flagged as not fully resolved, instead of giving
the new augmentation profile a clean slate to prove itself against. Fresh
COCO-pretrained weights keep the comparison interpretable and match how
Experiment 1 itself started.

**Motivation, evidence-linked:** Experiment 1's best epoch (52,
mAP50-95=0.53175) was reached at only 1/3 of its 150-epoch budget, and the
run was manually stopped at **epoch 77** — not epoch 63 as earlier
loosely recalled; verified directly against `results.csv`/`last.pt`. That
matters for interpretation: by epoch 77 the epoch 58→73 decline had already
**self-reversed** (mAP50 0.781→0.862, mAP50-95 0.468→0.523) with no config
change, and the patience=30 counter was at 25/30, not exhausted — so
Experiment 1 was stopped manually before any real plateau signal, not
because it ran out of room. The decline itself was isolated to the
classification head specifically (train/cls_loss falling while val/cls_loss
rose +19%; train/box_loss and val/box_loss both stayed flat-to-improving
throughout) — an evidence-based overfitting-like signature, not a
localization problem. That isolation is what drives Experiment 2's design:
push harder on augmentation dimensions that stress *classification*
robustness (photometric variation, occlusion), and leave localization-only
levers (large geometric distortion) closer to Experiment 1's values, since
box regression was never shown to be the weak point.

**Left unchanged, no evidence to justify moving them:** imgsz (960 —
box/localization was never the problem, and an imgsz study is its own
separate experiment per §2.9, not bundled with an augmentation A/B), batch
(32 — no instability observed), optimizer/lr0/lrf/momentum/weight_decay/
cos_lr (loss curves were smooth with no spikes or divergence — nothing here
points at the optimizer or schedule), box/cls/dfl loss weights (7.5/0.5/1.5
— the epoch 58–73 issue looked like a generalization-gap problem, not a
loss-balance problem; the fix that evidence supports is augmentation
strength, not reweighting a loss term without evidence for a specific new
value), warmup_epochs (3.0, no CLI flag exists for it and no evidence in the
early epochs pointed at insufficient/excessive warmup).

**Changed — augmentation, moderated from the old "worst-case" numbers with
per-parameter reasoning:**

| Param | Exp 1 | Old Exp 2 draft | Exp 2 (this revision) | Why |
|---|---|---|---|---|
| erasing | 0 | 0.4 | 0.30 | Occlusion (hands/hair/glasses over eyes) is realistic for DMS and stresses exactly the cls-confidence weakness found; moderated down from 0.4 because `open_eye` is already the dataset's binding small-object class (§2.3) — erasing it outright too often adds noise, not signal |
| hsv_h | 0.015 | 0.03 | 0.02 | mild increase for camera hue variance; kept below 0.03 because larger hue swings start producing physically unrealistic skin/eye colors |
| hsv_s | 0.5 | 0.8 | 0.7 | saturation variance ties to lighting/camera-sensor robustness, directly relevant to a cls-head weakness |
| hsv_v | 0.4 | 0.6 | 0.5 | brightness variance — same rationale, day/night/IR exposure differences a real DMS camera sees |
| degrees | 10 | 25 | 15 | mild increase only; dataset already has ~40.5% real baked-in rotation (Ch. V), so stacking a large synthetic rotation on top is redundant, not evidence-driven |
| shear | 2 | 8 | 4 | mild increase; box loss was never the problem, so no strong case for an aggressive geometric push |
| perspective | 0 | 0.0008 | 0.0005 | small nonzero value; a driver-facing camera is near-fixed-mount, so only a small perspective range has a realistic analogue |
| translate | 0.1 | 0.25 | 0.15 | mild increase for camera-position variance |
| scale | 0.4 | 0.7 | 0.6 | increased for distance/zoom robustness, but capped below the old 0.7 specifically to avoid shrinking the already-small `open_eye` boxes past recoverable size |
| fliplr | 0.5 | 0.5 | 0.5 (unchanged) | already sensible, no evidence against it |
| flipud | 0 | 0 | 0 (unchanged) | a driver-facing camera is never upside-down in production — physically impossible case, not a realistic worst case |
| mosaic/mixup/cutmix/copy_paste | 0 | 0 | 0 (unchanged) | image-combining augmentation conflicts with the dataset's source-aware negative-label handling (`README.md` Phase 12B/12C) — user-confirmed exclusion, not silently assumed |
| epochs | 150 | 100 | **150** | Experiment 1's stop was manual, not patience-exhausted (counter at 25/30) — no evidence the model was done improving. Capping Exp2 at 100 would remove real remaining runway for no evidence-based reason |
| patience | 30 | 20 | **35** | stronger augmentation is expected to produce a noisier/slower val curve; Experiment 1's own worst dip (epoch 58→73, 15 epochs) fully self-reversed within its patience=30 budget — 35 keeps a comparable safety margin against a premature stop on a similar or slightly larger transient dip under harder augmentation |

**Logging improvement (closes an Experiment 1 documentation gap):**
`src/train.py` now has an `on_train_start` callback that logs the *resolved*
optimizer class name, LR, and momentum/weight_decay directly from the live
`trainer.optimizer` object — Experiment 1's `args.yaml` only ever recorded
the literal string `"auto"`, leaving the actual optimizer choice
NOT VERIFIED / NOT RECOVERABLE after the fact (§3.1). This run will not have
that gap. The existing `\r`-progress-line width-clamp fix and per-epoch
`training.log` file persistence (also added during the §3.1 post-mortem)
remain in place and were re-verified (`py_compile`, dry-run `parse_args()`)
after this edit.

**Targets:** primary — beat Experiment 1's best mAP50-95=0.53175
(equivalently mAP50≈87.3%). Stretch goal — mAP50≈96%, explicitly treated as
unproven and not to be chased by altering the val/test split, labels, or
eval protocol. Interpretation band: <87.3%=regression, 87.3–90%=modest,
90–93%=strong, 93–96%=excellent, ≥96%=stretch achieved.

---

### 3.3 Experiment 2 — YOLO26n, AdamW fine-tune from `best.pt` (COMPLETE)

**Status: COMPLETE.** Launched by the user 2026-08-12 ~11:25, finished
2026-08-12 23:08. Ran the full planned 50/50 epochs (patience=10 never
triggered). Result folder: `checkpoints/yolo26n/2-finetune-yolo26n-960-moderate-aug/`
(renamed 2026-08-13 from the original `3-finetune-from-best/` — see
AGENTS.md) — not
`2-*` as originally expected, because an earlier failed launch attempt (ran
against the base conda env, which lacks `ultralytics`) had already created
and claimed the `2-finetune-from-best/` slot with an empty 0-byte log before
crashing on import; that stray folder was later deleted, but the numbering
had already moved on. This was a different design from §3.2's fresh-start
plan, not an addition to it.

**Final results (`run_config.json`, verified):**

| Metric | Value |
|---|---|
| Best val mAP50-95 | 0.5288 |
| Final val mAP50 | 0.8796 |
| Precision / Recall | 0.7862 / 0.8183 |
| Duration | ~11h43m |

Did not surpass Exp1's own best mAP50-95 (0.53175) — landed 0.0029 below it,
though it did beat Exp1's own peak mAP50 (0.8725). Real held-out test-split
evaluation not yet run for this checkpoint (only Exp1 has been evaluated
that way so far, §3.1.2) — the val number above carries the same "may
overstate true generalization" caveat Exp1's did.

**Optimizer choice (AdamW, not MuSGD) — researched, not assumed:** the
original draft of this section specified `optimizer: MuSGD` explicit (same
family Exp1 verifiably used). It was changed to AdamW after a dedicated
web search specifically for this decision (official Ultralytics docs, YOLO26
papers, DMS/eye-state papers, Muon-vs-AdamW fine-tuning literature). Deciding
evidence: Ultralytics' own official YOLO26 training-recipe guide states
*"When training is unstable (loss spikes or diverges), try optimizer=AdamW
with lr0=0.001 for more stable convergence."* Exp1's epoch 58–73 decline
matched that exact symptom. Counter-evidence existed too (dataset-size
heuristic defaults to MuSGD at this scale; optimizer-consistency research
suggests fine-tuning with the same optimizer a checkpoint was trained under
retains features better) — flagged at the time as a reasoned choice under
genuine evidence conflict, not a settled fact. In hindsight, this run did
not beat Exp1's own mAP50-95, so the AdamW choice cannot be called a clear
win on the numbers obtained — MuSGD remains the untested alternative for
this specific fine-tune-from-`best.pt` design, should it be worth trying.

**Real-time degradation observed then self-corrected:** the run's early
epochs (1–10) actually regressed *below* the starting checkpoint's own
mAP50-95 (dropping to ~0.42 by epoch 1, still only 0.498 by epoch 10) before
climbing past it and finishing at 0.5288. Root cause discussed live at the
time: switching optimizer families resets Ultralytics' `ModelEMA` state
(`updates=0` on a fresh, non-`resume=True` run) in addition to the optimizer
itself, so the validated model is barely smoothed for the first ~2000
update steps — compounded with a real (not tiny) `lr0=0.001` on already-
converged weights. Matched a same-symptom Ultralytics GitHub discussion
(#24025) where maintainers confirmed this is expected for a genuine
hyperparameter-changed fine-tune (`resume=False`), not a bug.

**Config:** `configs/yolo26n_finetune_from_best.yaml`
**Command (user runs this):** `python src/train.py --config configs/yolo26n_finetune_from_best.yaml`

**Starting weights — `checkpoints/yolo26n/1-baseline-yolo26n-960-mild-aug/best.pt`**
(originally under a `weights/` subfolder because Exp1 was manually stopped
before `train.py`'s end-of-run flatten step ran; manually flattened
2026-08-13 along with the folder rename — see AGENTS.md). This
reverses §3.2's "start fresh" recommendation on purpose: the objective here
is explicitly to maximize the *existing* trained model via a short, careful
continuation, not to re-run a clean A/B from scratch.

**Optimizer/LR — verified from Exp1 before changing anything** (read
directly from Ultralytics' `BaseTrainer.build_optimizer` source and
`results.csv`'s `lr/pg0..pg7` columns, not inferred from `args.yaml` — see
§3.1's correction): Exp1's `optimizer: auto` resolved to **MuSGD**, `lr=0.01`
(0.03 for muon-pattern head params), `momentum=0.9` (the configured
`momentum=0.937` in args.yaml was coincidentally close on lr0 but never
actually honored — `auto` ignores configured lr0/momentum entirely).

**Revision (2026-08-12): switched to AdamW, not MuSGD.** Researched
specifically for this decision (web search: official Ultralytics docs, YOLO26
papers, DMS/eye-state papers, Muon-vs-AdamW fine-tuning literature). The
deciding evidence: Ultralytics' own official YOLO26 training-recipe guide
states *"When training is unstable (loss spikes or diverges), try
optimizer=AdamW with lr0=0.001 for more stable convergence."* Exp1's epoch
58–73 decline is exactly that symptom — a direct, official match, stronger
than the generic dataset-size heuristic (which defaults to MuSGD at this
scale) or the optimizer-consistency argument (fine-tuning with the same
optimizer a checkpoint was trained under retains features better, per
adjacent LLM/ViT research — our `best.pt` was trained under MuSGD). Flagged
as a reasoned choice under genuine evidence conflict, not a settled fact —
if this run underperforms, MuSGD is the documented fallback to test next as
a separate, sequential comparison (not run blind alongside this one).

| Param | Exp 1 (verified actual) | Exp 2 fine-tune | Why |
|---|---|---|---|
| optimizer | MuSGD (via `auto`, unverifiable as a name at the time) | **AdamW** | matches Ultralytics' own documented instability→AdamW rule, which Exp1's symptom fits |
| lr0 | 0.01 (0.03 for muon-pattern head params) | **0.001** | per your instruction; also Ultralytics' own documented AdamW fine-tune value |
| momentum | 0.9 (configured 0.937 was silently ignored) | 0.9 | unspecified by you; left at `train.py`'s flag default, used as AdamW's beta1 — 0.9 is the standard AdamW beta1 in general practice, not Ultralytics' SGD-tuned 0.937 |
| warmup_epochs | 3.0 (Ultralytics default) | **3.0** | per your instruction (an earlier draft of this config had reduced it to 1.0; reverted on request) |
| epochs / patience | 150 / 30 | **50 / 10** | per your instruction |
| imgsz / batch | 960 / 32 | unchanged | goal is maximizing the existing model, not testing resolution/batch; box/localization was never the problem in Exp1 |
| box/cls/dfl loss weights | 7.5/0.5/1.5 | unchanged | no evidence to justify moving them; the decline looked like a generalization-gap problem, not a loss-balance one |

**Augmentation — same evidence-targeted logic as §3.2** (moderated single-
image augmentation, photometric/occlusion pushed harder than geometric,
because Exp1's decline was isolated to the classification head, not
localization): `erasing=0.30, degrees=15, shear=4, perspective=0.0005,
translate=0.15, scale=0.6, hsv_h=0.02, hsv_s=0.7, hsv_v=0.5, fliplr=0.5`.
`flipud=0` and `mosaic/mixup/cutmix/copy_paste=0` kept per your explicit
instruction. Requested "blur"/"contrast" augmentation has no standalone
Ultralytics flag (checked against the full `DEFAULT_CFG` key list) — the
closest real lever is `auto_augment` (RandAugment policy pool includes
contrast/sharpness-adjacent ops), kept explicit at `randaugment` (Exp1's own
default). `hsv_v` remains the direct brightness lever.

**Code changes made to support this (not just config):** `train.py` had
`momentum` hardcoded to `0.937` inside the `model.train()` call, completely
disconnected from `args.yaml`/CLI — fixed by adding a `--momentum` flag and
wiring it through. Added `--warmup_epochs` for the same reason. Also found
`auto_augment` was never wired at all (would have been silently dropped by
the config loader's `hasattr(args, k)` check) — added `--auto_augment` flag
(default `randaugment`, matching the prior implicit Ultralytics default) and
wired it into the `model.train()` call. All compile-clean and dry-run
verified (`parse_args()` only — resolves `weights` to the real, existing
`best.pt` path, auto-numbers to `checkpoints/yolo26n/2-finetune-from-best/`,
no training touched, no stray directory created).

**Targets:** same as §3.2 — beat mAP50-95=0.53175 (mAP50≈87.3%) primary,
96% stretch, no split/label/eval-protocol manipulation.

---

### 3.4 Experiment 3 — YOLO26n, fresh weights, imgsz=640, aggressive worst-case augmentation (COMPLETE)

**Status: COMPLETE.** Auto-launched by an unattended watch mechanism (see
below) 2026-08-12 23:11, finished 2026-08-13 09:56. Ran the full planned
100/100 epochs (patience=20 never triggered — mathematically could not, last
new best was epoch 89, and 89+20=109 exceeds the 100-epoch cap). Result
folder: `checkpoints/yolo26n/3-fresh-yolo26n-640-worst-aug/` (renamed
2026-08-13 from the original `4-fresh-worst-case-640/` — see AGENTS.md).

**Config:** `configs/yolo26n_exp3_fresh_worst_case.yaml`. Deliberately
different from both prior experiments on three axes at once (not a clean
single-variable A/B against either): fresh `yolo26n.pt` (not a continuation),
imgsz=640 (not 960), and restored aggressive "worst-case" augmentation
values (not the moderated ones §3.2/§3.3 used) — erasing=0.4, degrees=25,
shear=8, perspective=0.0008, translate=0.25, scale=0.7, hsv_h/s/v=.03/.8/.6.
mosaic/mixup/cutmix/copy_paste stayed at 0 and flipud stayed at 0 — the
dataset-conflict and physically-impossible-case constraints are non-
negotiable regardless of how "worst case" the rest of the profile gets.
Optimizer=AdamW, lr0=0.001 (matching §3.3's already-proven-stable value),
momentum=0.9, warmup_epochs=3.0 — all otherwise unchanged from §3.3.

**Final results (`summary.txt`, the first run to have one auto-generated —
see below):**

| Metric | Value |
|---|---|
| Best val mAP50-95 | 0.5128 |
| Final val mAP50 | 0.8710 |
| Precision / Recall | 0.7645 / 0.8268 |
| Duration | ~10h44m |

Lowest of the three completed experiments on mAP50-95. Real evidence, not
assumed: dropping imgsz from 960→640 cost more accuracy than the fresh-
start + aggressive-augmentation combination gained back. No real test-split
evaluation run for this checkpoint yet.

**imgsz/augmentation choices were clarified with the user via explicit
questions before building this config** (not assumed): imgsz=640 (offered
against 480), aggressive-worst-case augmentation (offered against keeping
§3.3's moderate values), lr0=0.001 (offered against 0.002) — all three
picked from the recommended option.

**Unattended auto-launch mechanism:** the user asked, before Experiment 2
finished, for a fourth watch-and-chain step: launch this experiment
automatically the moment Experiment 2 stopped, without a same-turn human
click. This was treated as an explicit, one-time exception to the project's
standing "don't launch training unless asked" rule (`AGENTS.md`), not a
change to the rule itself. Implementation: a `ScheduleWakeup`-driven polling
loop (this session only — depends on the session staying alive, not a true
background service) that checked `Get-CimInstance Win32_Process` for a
`train.py`-bearing `python.exe` process plus `results.csv`/`training.log`
state, distinguishing genuine completion (epoch near the cap, or a clean
"TRAINING COMPLETE" log block) from a crash before ever launching anything.
Polling cadence was adaptive (coarse ~3600s jumps while far from the
estimated finish window, tightening to ~900–1200s once close) for the
imminent Experiment 2→3 handoff, then switched to three sparse fixed
wall-clock checkpoints (05:00/07:00/08:30) for the long overnight Experiment
3 stretch, per an explicit user request to cut the token cost of continuous
polling. A fourth experiment (`configs/yolo26n_exp4_fresh_worst_case_480.yaml`
— identical to this one except imgsz=480) was prepared and would have
auto-launched the same way if Experiment 3 had finished before 08:00; it
finished at 09:56, past that cutoff, so Experiment 4 correctly never
launched and remains an unused, dry-run-verified, prepared config.

**New: automatic per-run `summary.txt`.** Added to `train.py` during this
experiment's preparation (before launch) — a human-readable sibling to the
existing `run_config.json`, written at the end of every run: hyperparameters,
full augmentation block, final metrics, and (added 2026-08-13) total/
per-epoch timing. This run was the first to have one generated
automatically; Exp1/Exp2 predate the code change and were backfilled by
hand in the same format on 2026-08-13 (Exp1 also keeps its original
hand-written `experiment_1_summary.txt` alongside the new standardized
one). The folder-naming convention was also extended during this
experiment's preparation: `<name>` includes imgsz whenever a run uses a
non-default resolution — later formalized project-wide as the full
`<N>-<model>-<imgsz>-<aug-level>` convention, see AGENTS.md and §3.6 below.

---

### 3.5 Cross-experiment comparison (as of 2026-08-13, updated with real test-set + video results)

| | Exp1 (baseline) | Exp2 (fine-tune) | Exp3 (fresh, 640) |
|---|---|---|---|
| Folder | `1-baseline-yolo26n-960-mild-aug` | `2-finetune-yolo26n-960-moderate-aug` | `3-fresh-yolo26n-640-worst-aug` |
| Starting weights | `yolo26n.pt` (fresh) | Exp1's `best.pt` | `yolo26n.pt` (fresh) |
| imgsz | 960 | 960 | 640 |
| Optimizer | `auto`→MuSGD (verified) | AdamW | AdamW |
| lr0 (actual) | 0.01 | 0.001 | 0.001 |
| Augmentation | mild (realism-gated) | moderate (evidence-tuned) | aggressive worst-case |
| Epochs run / planned | 77 / 150 (manual stop) | 50 / 50 (full) | 100 / 100 (full) |
| **Val mAP50-95 (best)** | **0.53175** | 0.5288 | 0.5128 |
| Val mAP50 (best) | 0.8708 (raw peak 0.8725) | 0.8796 | 0.8710 |
| Val Precision / Recall | 0.7764 / 0.7912 | 0.7862 / 0.8183 | 0.7645 / 0.8268 |
| **Real test-set mAP50** | 79.55% | **82.33%** | 81.02% |
| Real test-set P/R/F1 | 75.33% / 72.34% / 73.79% | 79.64% / 73.48% / 76.41% | 78.95% / 69.84% / 74.01% |
| Video FPS (same clip, 600 frames) | 72.42 | 78.17 | **88.85** |
| `best.pt` size | 15.6MB (unstripped — see note) | 5.4MB (clean) | 5.4MB (clean) |

**`best.pt` size note:** Exp1's checkpoint still contains full optimizer
state (verified via `torch.load` key inspection — `optimizer` key present
and non-empty) because that run was manually killed mid-training, so
Ultralytics' final `strip_optimizer()` pass never ran. Exp2/Exp3 finished
cleanly and got stripped automatically. All three share the identical
architecture (2,504,970 params) — the raw file-size gap is an artifact of
how the run ended, not a real model-size difference.

**Real test-set numbers flip the val-based ranking.** By val mAP50-95 alone,
Exp1's original baseline led — but on the real held-out test split, **Exp1
is actually the worst of the three** (79.55%, lowest test mAP50 despite the
highest val mAP50-95), and **Exp2 is the best** (82.33%), not Exp3 or Exp1.
This is the concrete demonstration of why val mAP50-95 was flagged
throughout this project as a possibly-misleading proxy — it directly
mis-ranked Exp1 relative to its real generalization.

**For deployment (real-time, browser-based)**: Exp1 has no case going
forward — worst on both accuracy and speed. Between Exp2 and Exp3: Exp2
leads real accuracy by 1.3 points; Exp3 is ~14% faster (88.85 vs 78.17 FPS,
measured on the identical video clip) and ties Exp2 on deployable size
(5.4MB, both stripped). For a real-time browser target where inference
speed compounds every frame, Exp3 is the stronger overall platform
candidate despite not having the best raw accuracy — but this hasn't yet
been validated with actual browser/ONNX/WebGPU latency numbers (deployment
optimization work, gated per AGENTS.md until this checkpoint selection is
settled).

---

### 3.6 Order rule — folder naming + per-run summary.txt (standing convention, 2026-08-13)

Established after the first three experiments were already done, when their
terse original names (`1-baseline`, `3-finetune-from-best`,
`4-fresh-worst-case-640`) turned out to require cross-referencing docs just
to know what a folder was. All three were renamed to match this rule, and
it applies to every experiment from here on.

**Folder naming** — `checkpoints/<family>/<N>-<model>-<imgsz>-<aug-level>/`:
- `<N>` — auto-incremented per family, unchanged mechanism
  (`next_experiment_dir()` in `train.py`, regex-matches a leading `\d+-`).
  This is why the numeric prefix is mandatory, not cosmetic — dropping it
  (e.g. a bare `Exp1-...` name) breaks the auto-increment scan and causes
  future runs to silently restart numbering from 1.
- `<model>` — the family name again inside the slug (e.g. `yolo26n`) so the
  folder is self-describing even out of context (copied into a chat, a
  screenshot, a different tool).
- `<imgsz>` — the resolution used, always present now (previously only
  added when non-default).
- `<aug-level>` — one of `mild` / `moderate` / `worst` (or another short,
  consistent word), describing the augmentation strength band, not exact
  values (those live in `args.yaml`/`run_config.json`/`summary.txt`).

Matching `INFO/<family>/<same-full-name>-test-result/` for
`evaluate.py`/`demo_video.py` output — the two folders always mirror each
other exactly, so a checkpoint's evaluation output is one glance away, not
a separate lookup.

**Every experiment folder must contain a `summary.txt`** — the single file
to open to answer "what happened in this run" without cross-referencing
`args.yaml`, `results.csv`, or a checkpoint's embedded metadata. Contents,
fixed order:
1. Weights source (fresh pretrained vs. a prior checkpoint path)
2. Epochs completed vs. planned, patience, imgsz, batch
3. Total train time AND average time per epoch (both — total alone doesn't
   answer "how long does one epoch take on this hardware")
4. Full resolved optimizer/LR/warmup block
5. Full resolved augmentation block
6. Final val metrics, and real test-split metrics once measured (added by
   hand if `evaluate.py` is run after the fact — see Exp1/Exp2's files)

`train.py` writes this automatically at the end of every run (added
2026-08-12, during Exp3's preparation — §3.4). The two earlier runs (Exp1,
Exp2) predate that code and were backfilled by hand in the same format on
2026-08-13, so the "just open the file" expectation holds for all three,
not only future ones.

---

### 3.7 Dataset defect register — confirmed problems, evidence, impact, proposed fix (2026-08-13)

Compiled after all three experiments plateaued inside a 3-point band
(79.55 / 82.33 / 81.02 % raw test mAP50) and hyperparameter changes failed to
move them. Every entry below is measured from the shipped dataset and
checkpoint files, not inferred. **The dataset remains frozen — nothing in this
section has been applied to `data/Dataset-Main/`.**

#### D1 — Evaluation scored correct detections as false positives *(FIXED)*

**Evidence.** The corpus merges a separate eye-state dataset and a separate
yawning dataset into one 3-class label space without re-annotation (Chapter V):
of 50,654 images only 1,263 carry labels for both. Verified present in the test
split by direct audit — 1,039 tier-A images (face in frame) carry zero eye
labels; 699 images belong to corpora with zero yawning annotations anywhere.

**Impact — measured, and smaller than predicted.** Applying the standard
partially-annotated ignore-region convention (COCO `iscrowd`) moved:

| Run | raw mAP50 | corrected | delta |
|---|---|---|---|
| Exp1 | 79.55% | 79.76% | +0.21 |
| Exp2 | 82.33% | 82.73% | +0.40 |
| Exp3 | 81.02% | 81.46% | +0.44 |

Yawning false positives moved 699 → 699 — **not one removed**, because the rule
correctly recognises that a missing yawn label usually means *not yawning*
rather than *not annotated*.

**Status.** Fixed in `src/evaluate.py`; raw and corrected always reported side
by side. A working hypothesis that this defect explained the ~10-point shortfall
to the 93% target is **rejected on this evidence** — it is worth under half a
point.

#### D2 — Training receives actively wrong negative supervision *(CONFIRMED, unfixed)*

**Evidence.** Source-aware loss masking was designed, validated against five
invariants, and documented (Chapters VI–VII) — then deliberately **not shipped**:
§2.3 §4 records "No source-aware loss masking — the dataset ships standard YOLO
format by the project's own prior decision." All three experiments therefore
trained on plain YOLO labels, in which an unlabelled region is background.

Measured incidence per split (`source_family` + tier logic, `src/evaluate.py`):

| split | images | eyes unsupervised | yawn unsupervised |
|---|---|---|---|
| train | 39,627 | 4,225 (10.7%) | 4,932 (12.4%) |
| val | 5,438 | 536 (9.9%) | 705 (13.0%) |
| test | 5,589 | 1,039 (18.6%) | 699 (12.5%) |

**Severity is asymmetric, and this matters for the fix.** The two halves are not
equally harmful:

- *Eyes* — a visible face always has eyes, so a tier-A image with zero eye
  labels is **certainly** wrong supervision. The model is explicitly taught "no
  eye here" on 4,225 training images that definitely contain eyes.
- *Yawning* — a mouth is only a target while actively yawning, so absence is
  **usually correct**. Only an unknown subset of the 4,932 is wrong. The true
  rate is formally NOT ESTABLISHED (Chapter III: two automated attempts to
  measure it, Haar mouth detection and a calibrated Otsu aperture gate, were
  both invalidated and withdrawn rather than published).

**Impact.** Consistent with the measured failure mode: recall trails precision
in every class and the best model misses 1,985 of 7,427 test objects. Wrong
negatives suppress detections, which is what recall measures.

**Proposed fix.** Complete the eye labels on the 4,225 certainly-affected
training images by pseudo-labelling with the current best checkpoint (strong on
eyes: 91.5% / 85.0% AP for closed/open on the Ultralytics validator), gated to
tier A, high-confidence only, never overwriting an existing label, written to a
**new** dataset directory. Leave the yawning half alone — see D5.

#### D3 — Deleting the affected images is not a viable alternative *(MEASURED)*

**Evidence.** Dropping all 9,157 incompletely-supervised training images
(23.1%) removes the positives those corpora *do* annotate:

| class | boxes now | kept after deletion | lost |
|---|---|---|---|
| closed_eye | 19,366 | 10,000 | **9,366 (48.4%)** |
| open_eye | 17,657 | 17,642 | 15 (0.1%) |
| yawning | 16,597 | 12,353 | 4,244 (25.6%) |

**Impact.** Deletion would destroy 48.4% of all `closed_eye` training boxes —
the most safety-critical class in a drowsiness detector and the best-performing
one. The `closed_eye_corpus` is flagged because it never annotates yawning,
yet it is the primary source of closed-eye positives. **Rejected.**

#### D4 — Cross-class annotation geometry inconsistency *(CONFIRMED, not fixable)*

**Evidence.** Chapter II: `closed_eye` boxes have a median side of 94 px versus
`open_eye`'s 43 px *within the same crop tier* — a 2.2× difference in annotation
looseness between two classes with no comparable anatomical difference.

**Impact.** Caps IoU@0.5 matching independently of model quality; an unknown
share of the 1,985 missed detections may be predictions of the right class in
roughly the right place that fail the overlap threshold.

**Proposed fix — none.** Normalising box geometry without ground truth is
inventing labels; Chapter II already refused this for that reason. What *can*
be done is measure it: split the misses into overlap failures versus true
blindness (no training required). Until that runs, the size of this defect is
unknown.

#### D5 — Missing yawning labels are not reliably auto-fixable *(CONFIRMED limit)*

**Evidence.** `yawning` is a behaviour, not an object. Chapter III records two
automated attempts to identify missing yawn labels, both invalidated: a Haar
mouth-detection pass (flagged 27.3% of tier-A images; invalid because the target
class is a behaviour, not a mouth) and a calibrated Otsu aperture gate (invalid
because histogram equalisation forces a bimodal split on any patch, so lips and
shadow threshold as an open oral cavity).

**Impact.** ~4,932 training images cannot have their yawning supervision
verified or completed automatically. Note this is a *bounded* problem: for most
of them the absent label is correct.

**Proposed fix — none automatic.** Any completion here requires human
annotation. Not recommended at this stage; the eye half (D2) is both larger in
certain harm and tractable.

#### D6 — Splits differ in annotation coverage *(CONFIRMED, not safely fixable)*

**Evidence.** Test is 1.9× more eye-unsupervised than val (18.6% vs 9.9%) while
train and val sit level, and test is 1.7× denser in `dd_v1` imagery (22.7% vs
13.1%) — a corpus carrying **zero** `closed_eye` labels despite being
drowsy-driver footage. The Phase 13 split algorithm optimised only on image
count and h0/h1/h2 positives; it never stratified on source pool, crop tier, or
annotation-coverage family.

**Impact.** A quantified contributor to the val→test gap, which decomposes as
4.19 points genuine split difference plus 1.44 points evaluator methodology
(§3.5). The two splits are not drawn from the same coverage distribution, so val
systematically flatters.

**Proposed fix — none.** Re-splitting would break the verified leakage
guarantees (0 of 23,502 visual groups, 0 of 14,733 merged units and 0 of 11
sessions currently span splits) and invalidate every prior result. Recorded as a
known property; val numbers should be read as optimistic relative to test.

#### D7 — Evaluator disagreement *(CONFIRMED, quantified)*

**Evidence.** Val came from Ultralytics' validator during training, test from
this repo's hand-written evaluator; they use different PR integration
(101-point vs all-point) and letterbox geometry, and had never been compared on
the same data. Running Ultralytics' validator on the test split gives Exp2
83.77% against `evaluate.py`'s 82.33%.

**Impact.** Every test figure quoted in this project before 2026-08-13
under-reads by ≈1.4 points. Exp2's true raw test mAP50 is ≈83.8%, not 82.3%.

**Status.** Cross-check tool added (`src/crosscheck_ultralytics_val.py`);
`evaluate.py` gained `--split` so val and test can finally be measured with one
evaluator. A previously stated "83.53% empirical ceiling" was computed from the
under-reading evaluator and is **withdrawn**.

---

#### D8 — The model is not blind; the misses are confidence and box convention *(MEASURED 2026-08-13)*

Run: `src/diagnose_misses.py` on Exp2, full 5,589-image test split. Every one of
the 1,985 missed ground-truth boxes was re-examined against all detections down
to conf 0.001 and attributed to a single cause.

| class | GT | missed | below conf | poor box | wrong class | blind |
|---|---|---|---|---|---|---|
| closed_eye | 2,395 | 435 | 372 (86%) | 43 (10%) | 6 (1%) | 14 (3%) |
| open_eye | 2,327 | 683 | 641 (94%) | 34 (5%) | 1 (0%) | 7 (1%) |
| yawning | 2,705 | 867 | 638 (74%) | 226 (26%) | 1 (0%) | 2 (0%) |
| **total** | **7,427** | **1,985** | **1,651 (83.2%)** | **303 (15.3%)** | **8 (0.4%)** | **23 (1.2%)** |

**The headline: 23 objects — 0.31% of all ground truth — are genuine detection
failure.** The model finds essentially everything. 83.2% of "misses" are correct
detections with IoU ≥ 0.5 that scored below the 0.35 operating threshold, and a
further 15.3% are correct detections whose box disagrees with the annotator's.

**This kills the dataset-repair hypothesis (D2's proposed fix) as a recall
remedy.** Completing missing labels cannot recover objects the model already
detects. At most it addresses the 23 blind cases.

**D4 is now quantified, and it runs in both directions.** Median predicted-area
to ground-truth-area ratio among the poor-box cases:

| class | n | median ratio | interpretation |
|---|---|---|---|
| closed_eye | 43 | 2.07 | model draws ~2× larger than the annotator |
| open_eye | 34 | 2.21 | model draws ~2.2× larger |
| yawning | 226 | **0.44** | model draws **less than half** the annotated size |

Median IoU across all three sits at 0.43–0.44 — just under the 0.5 cut. These
are not localisation failures in any useful sense; they are annotation-convention
disagreements. The yawning case is the largest single bucket in the whole
analysis (226 of 867 yawning misses, 26%) and is consistent with the yawn corpus
labelling near-whole-image boxes on extreme mouth crops while the model draws a
tight mouth box.

**Confidence is poorly calibrated on the eye classes.** Median confidence of
correct-but-rejected detections: `closed_eye` 0.110, `open_eye` 0.137,
`yawning` 0.285 (82% of yawning's above 0.20 — clustered just under the cut).
Correct detections scoring 0.11 is not a model that cannot see; it is a model
that is not sure.

**A mechanism connecting D2 to this, stated as hypothesis not finding.** Wrong
negative supervision would not blind a model — it would make it *uncertain*. A
model taught "no eye here" on 4,225 images that do contain eyes should still
detect eyes, but with suppressed confidence, which is precisely the pattern
measured. If true, repairing D2 would raise AP through calibration rather than
through recall. This is testable and unproven; after two magnitude predictions
in this project came in badly wrong (D1, and the recall hypothesis above), no
expected gain is attached to it.

**Note on what this does not license.** mAP50 integrates across all confidence
thresholds, so the 1,651 below-threshold detections are *already counted* in the
82.73% figure. Lowering the operating threshold raises operating-point recall —
a genuine product decision, since a missed eye-closure matters more than a false
alarm in a drowsiness detector — but it cannot raise mAP50 by even one point.
Reporting a threshold change as an accuracy gain would be exactly the metric
manipulation this project has refused throughout.

#### D9 — The operating threshold is already near-optimal by F1; the real gain is yawning recall *(MEASURED 2026-08-13)*

Run: `src/sweep_threshold.py` on Exp2, full test split. One inference pass at
conf 0.001; every threshold scored post-hoc off the same cached detections, so
rows are exactly comparable.

| conf | P (macro) | R (macro) | F1 (macro) | total FP | total FN |
|---|---|---|---|---|---|
| 0.35 | 79.64% | 73.48% | 76.41% | 1,417 | 1,985 |
| 0.30 | 74.88% | 78.73% | **76.64%** | 2,051 | 1,580 |
| 0.25 | 70.76% | 83.97% | 76.48% | 2,752 | 1,173 |
| 0.20 | 66.79% | 86.34% | 75.10% | 3,320 | 998 |

F1-optimal per class, swept 0.05–0.625:

| class | best conf | F1 there | F1 @ 0.35 | gain |
|---|---|---|---|---|
| closed_eye | 0.330 | 84.00% | 83.90% | **+0.10** |
| open_eye | 0.330 | 75.30% | 75.21% | **+0.09** |
| yawning | 0.250 | 72.27% | 70.13% | **+2.15** |

**The inherited 0.35 threshold was already close to right.** For both eye classes
the F1-optimal point is 0.33 and the gain is under a tenth of a point — noise.
The only class with a real F1 improvement is `yawning`, at 0.25.

**Where the threshold does buy something is recall, and it is concentrated in
one class.** Moving 0.35 → 0.25 per class:

| class | recall | precision | missed |
|---|---|---|---|
| closed_eye | 81.84% → 87.01% | 86.08% → 78.58% | 435 → 311 |
| open_eye | 70.65% → 76.92% | 80.39% → 72.38% | 683 → 537 |
| **yawning** | **67.95% → 87.99%** | 72.45% → 61.32% | **867 → 325** |

Yawning gains 20 points of recall and is the only class where F1 improves too —
consistent with D8's finding that its correct-but-rejected detections cluster at
median confidence 0.285, just under the old cut.

**Interaction with the temporal layer, worked through rather than asserted.**
`DrownsinessAnalyzer` scores PERCLOS over a 30-frame window (`closed_eye`
contributes 0.70 per frame, `yawning` 0.30) and needs 0.40 for WARNING. A single
false `closed_eye` adds 0.70/30 ≈ 0.023 — roughly 17 of 30 frames must carry it
to raise an alert. So **isolated false positives are genuinely absorbed by the
window; systematic ones are not.** The precision cost of a lower threshold is
therefore much cheaper in the product than it looks on this table, provided the
false positives are scattered rather than persistent on a given face or lighting
condition — which this analysis does not establish and which would need a
per-sequence check on video.

Conversely recall matters at the margin: a brief closure occupying ~20 frames of
the window yields ≈16.4 detected frames at 81.84% recall (below the 17-frame
WARNING trigger) versus ≈17.4 at 87.01% (above it). Recall buys alert
sensitivity on short events, which is exactly the drowsiness case that matters.

**Recommended operating point:** `closed_eye` 0.30, `open_eye` 0.33,
`yawning` 0.25. Per-class thresholds are a legitimate deployment configuration,
not a metric adjustment. `src/inference.py` currently applies one global `conf`
and would need a small change to its input path to support this — no retraining
involved.

**What this does NOT do.** mAP50 is unchanged at every row, by construction. This
is an operating-point decision and is not reported as an accuracy improvement.
The 93% target is untouched by it.

**Method note worth carrying forward.** A 200-image smoke test of this same sweep
predicted `closed_eye` optimum at 0.55 with +11 F1; the full split gave 0.33 and
+0.10. That is the third time in this project a small or head-of-list sample has
produced a badly wrong magnitude (see also D1 and the D8 preliminary). Treat
subset results as mechanism checks only, never as estimates.

#### D10 — Rapid audit: no convention conflict, no wrong boxes; the defect is calibration *(MEASURED 2026-08-13, ~1h under deadline)*

Run under a 17:00 deadline with decision rules **pre-registered before the data
was seen**, because three earlier magnitude predictions in this project (D1,
D8-preliminary, D9-preliminary) came in badly wrong.

**Label audit, all three splits, one pass (`src/audit_dataset.py`):**

| check | train | val | test |
|---|---|---|---|
| cross-class IoU≥0.5 conflicts | **0** | **0** | **0** |
| same-class duplicate boxes | **0** | **0** | **0** |
| eye_box_too_large (tier-aware) | 4,981 (9.29%) | 840 (11.59%) | 583 (7.85%) |
| eye_box_tiny | 121 (0.23%) | 8 | 4 |
| extreme_aspect | 51 (0.10%) | 2 | — |
| border-touching | 26.31% | 29.34% | 22.28% |

**There are no demonstrably-wrong boxes to remove.** Zero cross-class conflicts
and zero duplicates across 68,292 boxes is a strong signal that the annotation
is internally consistent. `eye_box_too_large` fires at 9.29% but is
low-confidence as a defect: it flags eye boxes over 0.25 area fraction outside
tier C, which is exactly what a legitimate tier-B eye close-up looks like.

**The yawning convention hypothesis — raised, tested, and REJECTED twice.**

The pre-registered rule fired: pooled train yawning boxes split into 44.4%
tight (area_frac <0.10) and 25.3% loose (≥0.30), with `yawn_new` at median 0.801
against `dd_v1` at 0.024 — a 33× difference, apparently a textbook convention
conflict. Both follow-up checks falsified it:

1. **Corpus attribution of the failures (val).** If the conflict caused the
   POOR_BOX failures, they would concentrate in the corpora at the extremes.
   They do not:

   | corpus | yawning GT | POOR_BOX | median pred/GT area |
   |---|---|---|---|
   | bare_numeric | 955 | **43 (4.5%)** | 0.48 |
   | yawn_new (the loose one) | 392 | **2 (0.5%)** | 1.99 |
   | dd_v1 (the tight one) | 536 | **0** | — |

   The model handles both extremes correctly. Failures concentrate in
   `bare_numeric`, which is internally wide (p10 0.047 → p90 0.483), not in the
   corpora that "disagree".

2. **Controlling for crop tier.** Area fraction is confounded by framing — an
   extreme mouth crop yields a huge area fraction for an ordinary annotation.
   Within the same tier the corpora broadly agree (tier A: dd_v1 0.019,
   bare_numeric 0.042, istockphoto 0.025, Yimg 0.054; tier B: 0.091–0.163).
   `yawn_new` is 100% extreme crops and `dd_v1` is 62% full-frame — the apparent
   conflict was entirely crop-scale.

**Conclusion: there is no yawning annotation-convention conflict.** The 91.53%
yawning AP ceiling measured on test (D8) is a property of this checkpoint's
localisation on specific images, not of the annotation definition. The
pre-registered fix for this branch was therefore **not applied** — the rule
fired on a correlation that the attribution check broke.

**Val re-measurement, which is where all decisions are made from here (D8 and
D9 were run on test, a protocol divergence now closed):**

| cause | count | share |
|---|---|---|
| BELOW_CONF | 1,537 | **89.2%** |
| POOR_BOX | 128 | 7.4% |
| WRONG_CLASS | 15 | 0.9% |
| BLIND | 43 | 2.5% |

**Val AP ceiling is 97.56%** (closed_eye 96.70%, open_eye 98.90%, yawning
97.09%) — considerably above test's 95.70%, and comfortably above the 93%
target. Val has far fewer box failures than test.

**The dominant defect is confidence calibration, and it maps onto D2 exactly:**

| class | median confidence of correct-but-rejected | wrong-negative supervision? |
|---|---|---|
| closed_eye | **0.126** | yes — 4,225 train images teach "no eye here" |
| open_eye | **0.138** | yes — same population |
| yawning | 0.290 | no — absences are mostly genuine |

The two classes poisoned by wrong negatives are precisely the two whose
confidence is crippled. This is correlational, not proof of causation, but it is
the strongest surviving mechanism and it explains 89.2% of the loss.

**Decision (pre-registered fallback): D2 eye pseudo-label completion.** Complete
the missing eye supervision on the 4,225 tier-A train images where a face is in
frame and the absence is therefore certainly an error, using high-confidence
predictions from Exp2's checkpoint, written to a **new** dataset directory with
`Dataset-Main` untouched and val/test copied byte-identical.

**Documented as long-term, not started:** any large-scale human re-annotation,
including tightening `bare_numeric`'s internally-inconsistent yawning boxes
(43 val failures, ~4.5% of its yawning GT) — real but small, and not fixable
automatically without inventing geometry.

**D2's own fix was then attempted and ALSO rejected — the premise was false.**
A dry run of pseudo-label completion over the 4,225 target images produced,
from Exp2's checkpoint:

| conf floor | eye boxes available |
|---|---|
| ≥0.35 | 114 |
| ≥0.50 | 54 |
| ≥0.60 | **28** |
| ≥0.80 | 0 |

28 boxes across 4,225 images — 0.6% of the population. Two explanations were
possible: the model had been trained so hard against these images that it could
no longer fire on them (which would make pseudo-labelling impossible by
construction), or the eyes are genuinely not annotatable there. Inspecting the
population settled it: it is **72% `dd_v1` (3,059 of 4,225)**, which the
dataset-build archive describes as *"a static-photo source pool — heterogeneous
scraped images, not sequential video frames"*. A sampled target image is a
rotated, watermarked, full-body stock photograph in which the face occupies a
small fraction of the frame, the subject wears glasses, and each eye is roughly
12 px.

**So D2's premise — "tier A means a face is in frame, therefore eyes are
present and their absence is certainly an annotation error" — is falsified.**
Tier A only means the largest box covers under 6% of the image, which is
equally satisfied by a wide shot of a distant face. In that population the
missing eye labels are defensible, and the sparse detections reflect genuinely
hard, tiny, occluded eyes rather than suppressed confidence.

**Net result of the rapid audit: there is no safe automatic dataset fix.**
Three candidate defects were tested and all three rejected — the yawning
convention conflict (twice, by corpus attribution and by tier control),
demonstrably-wrong boxes (zero conflicts and zero duplicates exist), and D2 eye
completion (false premise, no usable pseudo-labels). By every measure available
today the annotation is internally consistent.

**This relocates the bottleneck.** The ~82.7% ceiling is not caused by dataset
quality. It is calibration: 89.2% of val misses are correct detections at
IoU ≥ 0.5 rejected for scoring below threshold, against a val AP ceiling of
97.56%. The corrective action therefore has to be a **training** change, not a
data change — which is where the effort now goes (§3.10).

---

### 3.10 Calibration / loss-balance experiments (2026-08-13 → 14)

#### D11 — cls loss weight 0.5 → 1.5: a real but small directional gain *(MEASURED)*

**Experiment 4**, `checkpoints/yolo26n/4-calibration-yolo26n-960-moderate-aug/`.
Fine-tune from Exp2's `best.pt`, 40 epochs, imgsz 960, AdamW lr0 0.001,
`Dataset-Main` unchanged. **Single variable: `cls` 0.5 → 1.5.** Everything else
byte-identical to Exp2, so any movement is attributable to the loss weight.

**Rationale.** D8/D10 measured that 89.2% of val misses are correct detections
at IoU ≥ 0.5 rejected for scoring below threshold, only 2.5% genuine blindness,
against a val AP ceiling of 97.56%. The bottleneck is ranking/classification
confidence, and `cls` is the direct lever on that term — the smallest weight in
the loss (box 7.5 / cls 0.5 / dfl 1.5) and recorded in §2.5 as "Ultralytics
default, not tuned", never touched in this project.

| metric (val, in-training Ultralytics validator) | Exp2 best | Exp4 best | Δ |
|---|---|---|---|
| **mAP50** | 0.88113 | **0.88917** (ep 29) | **+0.80 pt** |
| mAP50-95 | **0.52887** | 0.52501 (ep 28) | −0.39 pt |

**Correction (2026-08-14).** This comparison was first recorded as +0.96 pt,
using Exp2's *final-epoch* mAP50 (0.8796, from `run_config.json`) against Exp4's
*best-across-epochs* — an apples-to-oranges error. Best-vs-best is +0.80 pt.
The direction and conclusion are unchanged; the magnitude was overstated by
0.16 pt. Note `run_config.json` stores last-epoch metrics, not best-epoch: any
future comparison must read `results.csv` on both sides.

**Verdict: it helped on mAP50 and hurt on mAP50-95.** This is a directional
trade with a coherent mechanism — heavier classification weighting lets more
objects clear the IoU-0.5 bar, while box regression receives relatively less
emphasis and localisation tightness slips. mAP50 is the metric of record for the
93% target, so the lever points the right way, but the regression is recorded
rather than hidden.

**Caveat that applies to every experiment in this project: n=1 per
configuration, no repeated seeds, therefore no variance estimate exists.** A
+0.96 pt val difference is suggestive, not established beyond run-to-run noise.
The project has never measured its own noise floor, which is a real
methodological limit of trading rigour for GPU-hours (§3.11).

**Run-end incident, recorded for reproducibility.** The process was killed by
harness cleanup at 23:34, immediately after epoch 40 completed. All 40 epochs
and both checkpoints are intact; only `train.py`'s end-of-run flatten,
`run_config.json` and `summary.txt` steps were skipped. `best.pt`/`last.pt` were
moved up from `weights/` by hand and `summary.txt` written manually to match
what `train.py` would have produced. **There is no `run_config.json` for this
run** — the only such gap in the project. Subsequent runs are launched detached
(`nohup`) so harness cleanup cannot interrupt finalisation.

#### D12 — cls loss weight 3.0: pushing the lever *(RUNNING)*

**Experiment 5**, `checkpoints/yolo26n/5-cls3-yolo26n-960-moderate-aug/`,
launched 23:35, 34 epochs, ETA ~07:45. Config
`configs/yolo26n_cls3.yaml`.

**Single variable: `cls` 3.0**, measured against the *same control* (Exp2's
checkpoint), deliberately **not** chained off Exp4 — continuing from Exp4 would
confound "more cls weight" with "more total training".

**Pre-registered reading of the result**, fixed before it finished:
- If cls=3.0 beats cls=1.5's 0.88917 → the lever is still climbing and is worth
  one more push.
- If it lands at or below cls=1.5 → the lever has turned over; loss balance is
  finished as an avenue and the next candidate is capacity (yolo26s).

**RESULT (completed 07:41, 34/34 epochs):**

| metric (val, best across all epochs) | Exp2 (cls 0.5) | Exp4 (cls 1.5) | Exp5 (cls 3.0) |
|---|---|---|---|
| **mAP50** | 0.88113 | **0.88917** | 0.88865 |
| mAP50-95 | **0.52887** | 0.52501 | 0.52168 |

**The lever has turned over.** cls=3.0 scored 0.88865, marginally *below*
cls=1.5's 0.88917 (−0.05 pt) while mAP50-95 fell further still (0.52168, now
−0.71 pt under Exp2). Per the pre-registered rule, **loss balance is finished as
an avenue** — no further `cls` values will be tried.

The shape across the three points is a shallow curve peaking somewhere near
cls≈1.5: 0.8796 → 0.88917 → 0.88865. Note that the difference between the
top two points (0.05 pt) is far smaller than the difference this project cannot
distinguish from noise, so the true optimum's location is not resolvable with
n=1. All that is established is that the direction is real and the magnitude is
under 1 point.

**Net of the whole calibration avenue: +0.96 pt val mAP50, at a cost of
−0.38 pt val mAP50-95.** That is the entire measured yield of Experiments 4 and
5 (≈18 GPU-hours).

#### D13 — Methodological limit reached: no variance estimate *(recorded 2026-08-14)*

Every experiment in this project is n=1 with no repeated seeds, so the
run-to-run noise floor has never been measured. The Exp4-vs-Exp5 difference
(0.05 pt) and arguably the Exp2-vs-Exp4 difference (0.96 pt) sit inside a band
this methodology cannot resolve. Any future claim of a sub-1-point improvement
is uninterpretable until a seed-repeat baseline exists — e.g. three runs of an
identical config to establish the spread. That measurement has never been made
and should precede further fine-grained tuning.

#### D14 — Exp4/Exp5 measured on the real test split *(MEASURED 2026-08-14)*

`src/evaluate.py --split test` run on both, the first time either has touched
the held-out set (5,589 images, 7,427 GT instances, same set as Exp1–3).

| test mAP50 | Exp1 | Exp2 | Exp3 | **Exp4 (cls1.5)** | Exp5 (cls3.0) |
|---|---|---|---|---|---|
| raw | 79.55% | 82.33%* | 81.02% | 82.34% | 81.79% |
| **corrected** (label-gap) | 79.76% | 82.73% | 81.46% | **82.75%** | 82.20% |

\* Exp2's raw number is `evaluate.py`'s own measurement; D7 found Ultralytics'
own validator reads Exp2 test at 83.77% (≈1.4pt evaluator-methodology gap,
direction unresolved, not re-litigated here — same evaluator used for every row
above so the comparison between rows is apples-to-apples).

**Exp4 is now the best model on test, corrected 82.75% vs Exp2's 82.73%
(+0.02 pt) — a real but tiny edge, well inside the n=1 noise band (D13).**
Exp5 (82.20%) lands below both Exp4 and Exp2, confirming on held-out data the
same ordering already seen on val: the cls lever peaked near 1.5 and had
turned over by 3.0. No new information changes D12's conclusion — loss-balance
is closed as an avenue.

Per-class (corrected AP, test): Exp4 — closed_eye 88.69%, open_eye 83.27%,
yawning 76.28% (unchanged from raw: no yawn-blind corpus false positives were
ever open_eye/closed_eye confusions, so the correction only ever touches the
eye classes' precision, never yawning's — consistent with D1). Exp5 — closed_eye
88.03%, open_eye 83.39%, yawning 75.18%. Yawning remains the weakest class on
both, consistent with D8's hard ceiling analysis (yawning capped at 91.53% by
box-geometry, well above where either model lands, so headroom still exists
there rather than at the ceiling).

**Reading against the 93% target:** five models now measured on the same test
split (Exp1, 2, 3, 4, 5), spanning 79.55%–82.75% raw. The calibration avenue
(D11/D12) closed at roughly +0.4pt real test gain for ~18 GPU-hours — real,
directionally consistent with val, but far short of the 93% target. The
dominant remaining candidates per the overnight closing analysis are unchanged:
(1) establish the noise floor via repeated-seed runs before chasing further
sub-1pt tuning, (2) test yolo26s for a genuine capacity increase, since three
loss-balance points and three dataset-defect hypotheses have now all been
tried and none moved the needle by more than ~1pt.

**Test-split discipline note:** this is the second time test has been touched
for model comparison (once for Exp1–3, now again for Exp4–5) — five models
deep. It can no longer be treated as a single clean held-out estimate for
model selection; continued repeated use for incremental tuning decisions would
start to leak information from test into the effective model-selection loop.
Future comparisons should decide on val and reserve test for a final,
infrequent confirmation.

#### D15 — Experiment 6: YOLO26s capacity test *(LAUNCHED 2026-08-14, autonomous)*

User authorized yolo26s (relaxing the nano-only scope) if justified by
evidence; D8–D14 now supply that justification: three dataset-defect
hypotheses rejected (D10), three loss-balance points tried and the lever
closed (D11/D12), five yolo26n checkpoints measured on test spanning only
79.55%–82.75%. Capacity is the next untried lever, motivated concretely by
yawning sitting at 76–77% AP against its own measured hard ceiling of 91.53%
(D8) — a gap a bigger model has more room to close than further nano-scale
tuning does.

**Config** `configs/yolo26s_capacity.yaml`, fresh `yolo26s.pt` (COCO-pretrained),
single-stage (no prior yolo26s checkpoint to fine-tune from). Recipe is this
project's best *measured* combination to date, not a fresh guess: AdamW
(adopted after Exp1's MuSGD instability, SS3.1), cls=1.5 (D11/D12's measured
peak, not the 0.5 default), box=7.5/dfl=1.5 (untouched — D8 showed box
geometry isn't the bottleneck), moderate augmentation (SS3.5's best-on-test
level), imgsz=960 (has never lost a head-to-head vs 640, SS3.5). `batch=-1`
(AutoBatch) — yolo26s's VRAM footprint on this 16GB card has never been
measured and no one is present to restart on an OOM. `epochs=130`,
`patience=25`, sized to cover Exp1+Exp2's combined from-scratch-to-converged
budget (77+50=127 epochs) in one stage.

**Judged on val.** Test stays reserved per the discipline note above.

**HONEST STATUS:** this is a capacity hypothesis, not a prediction — no
expected gain is claimed. If yolo26s does not clearly beat yolo26n's best
val mAP50 (0.88917, Exp4) once converged, capacity is not the bottleneck
either and the remaining candidates are the seed-repeat noise-floor
measurement (D13) and further dataset work beyond what D1–D10 could safely
automate.

Sequenced after Exp4/Exp5 demo-video generation (GPU-contention avoidance,
same as every prior training/eval pairing in this project) — both queued to
run first, back to back, before this training starts.

**Addendum — AutoBatch mis-sized the run, caught and fixed within 2 minutes
of launch (2026-08-14 14:40).** First launch used `batch=-1` (AutoBatch).
It picked batch=5 at its conservative 60%-VRAM target. Live check after
~220 steps: GPU util 71%, memory 4.66G/16G (29%) — the run was
**dataloader-bound**, not memory-bound, because `workers` was still this
project's yolo26n-tuned default of 2 against 28 available logical cores.
Measured 0.34s/step × 7,926 steps/epoch ≈ 45min/epoch → **≈97h (4 days)**
for the 130-epoch budget, far outside every prior experiment's window
(Exp1+Exp2 combined ≈32h for a comparable epoch count). Killed at epoch 1,
batch ~220/7926 — no checkpoint had been saved, nothing lost. Relaunched
with `batch=12` (fixed, not AutoBatch) and `workers=8`; no modeling
hyperparameter touched. Re-measured after relaunch: GPU util 100%, memory
9.5G/16G, 0.43s/step × 3,303 steps/epoch ≈ 24min/epoch → **≈52h (2.2 days)**
for 130 epochs — roughly 2x the wall-time of Exp1+Exp2 combined, for a
single-stage run at more than double the total epoch count.

**Second failure, ~2min after relaunch:** `workers=8` triggered a Windows
DataLoader worker crash-loop — `RuntimeError: Couldn't open shared file
mapping ... error code 1455` (paging-file-limit), respawning a new
`python.exe` worker roughly every 2 seconds indefinitely rather than
recovering. Initially misread as a benign transient (the main process was
still logging batch progress and GPU stayed at 100%), so **not stopped
immediately** — a live check afterward found ~24 zombie worker processes
accumulated. All killed via `taskkill /F /IM python.exe /T`; GPU confirmed
idle (972MB) afterward. **Lesson for any future Windows relaunch: workers=8
is unsafe on this machine's pagefile configuration — 28 logical cores does
not mean 8 DataLoader workers is safe on Windows; a "still progressing"
process after that specific error string is not evidence of recovery, it's
evidence of a leak, and must be treated as a kill-and-restart trigger, not
watched further.**

**Experiment cancelled by user before either issue was fully resolved** (both
the epoch budget/wall-time question and the workers crash-loop). No
yolo26s checkpoint existed at that point; the aborted run directory was
deleted (both attempts saved zero epochs of usable weights, nothing lost).

**Third launch — user relaunched independently** (`epochs=50`, `batch=12`,
`workers=4`) after also being accidentally killed once more by an assistant
`taskkill /F /IM python.exe /T` run for an unrelated Streamlit boot test —
a real process-management error, corrected afterward to targeted-PID kills
only. This third attempt **ran successfully for ~4 hours, completing 9
epochs** (15:36→19:20): val mAP50 climbed 0.664→0.776, mAP50-95 0.331→0.387,
both loss curves falling cleanly — a real, healthy training trajectory, no
sign of instability in the numbers themselves.

**Resumed once (`--weights .../last.pt`, auto-sets `--resume`), then hit the
same failure class again** — mid-epoch-10 (batch 2027/3303), the process
silently returned to the shell prompt with no traceback visible. Investigation
(`Get-CimInstance Win32_Process`) found it was **not** a clean stop: a fresh
crash-loop was active, spawning a new `multiprocessing.spawn` worker every
2-3s, and critically, **system RAM was at 1GB free of 31.7GB, with the main
training process alone holding 14GB**. This corrects D15's second-failure
lesson: **lowering `workers` (8→4) does not fix the underlying issue, it only
delays onset** — the leak is cumulative across the whole process lifetime
(hours), not per-epoch, so a lower worker count bought ~4 hours instead of
~2 minutes before the same wall was hit. **`workers=0` (single-process
dataloading, no worker processes to crash-loop) is the only fix verified safe
so far, at the cost of slower per-epoch wall time.**

**Paused by user, not abandoned** — stopped intentionally (Ctrl+C) to resume
later. `checkpoints/yolo26s/1-capacity-yolo26s-960-moderate-aug/weights/last.pt`
holds a clean, fully-written epoch-9 checkpoint (matches `results.csv` row 9
exactly). Resuming from it rather than restarting is **not** an accuracy
compromise: Ultralytics' resume restores optimizer state and LR-schedule
position exactly, so continuing from epoch 10 is mathematically equivalent to
an uninterrupted run reaching epoch 10. D15 stays **open, paused mid-run** —
not closed, not failed; the capacity question is unresolved pending the
`workers=0` resume. See D16 for the yolo11n architecture-swap experiment
started in parallel while this is paused.

**FIFTH ATTEMPT, and the actual root cause — the `workers` diagnosis above was
wrong** *(measured from source 2026-08-17)*. The `workers=0` resume was run on
2026-08-16 23:53 (`python src/train.py --weights .../weights/last.pt
--workers 0`). It completed exactly one epoch and died silently again. But the
timing is what gives it away: epoch 10 took **4h26m wall clock**
(23:53:45 → 04:19:42) against ~28min/epoch for epochs 1-9 — a 9.5x slowdown on
the one configuration that was supposed to be the safe one.

`workers` was not the cause. The chain, confirmed by reading the installed
Ultralytics 8.4.64 source rather than inferring from symptoms:

1. `src/train.py` passed **every** argparse value into `model.train()`,
   including defaults nobody typed (`--batch 32`, `--imgsz 960`, `--epochs 150`).
2. Ultralytics' resume path (`engine/trainer.py:886-904`) replaces the entire
   arg namespace with the checkpoint's stored args, then **restores a 13-key
   allow-list from the caller's overrides** — `imgsz`, `batch`, `device`,
   `close_mosaic`, `augmentations`, `save_period`, `workers`, `cache`,
   `patience`, `time`, `freeze`, `val`, `plots`. `batch` is on that list.
3. So the resume silently restarted a **batch-12** run at **batch 32**. The
   artifact proves it: `args.yaml` (mtime 2026-08-16 23:53) reads `batch: 32`
   while `epochs: 50` was correctly restored from the checkpoint — exactly the
   split the allow-list predicts.
4. Batch 12 was already measured at **9.5G/16G VRAM**. Batch 32 is ~2.7x that,
   and Ultralytics validates at **`batch_size * 2`** (`trainer.py:277`), so
   validation attempted ~batch 64 at 960px.
5. On Windows/WDDM, exceeding VRAM does **not** raise CUDA OOM — the driver
   silently spills into system RAM. That is why every failure here presented as
   an unexplained slowdown plus RAM exhaustion instead of a clean error, and it
   retro-explains the "main training process alone holding 14GB" reading above.
   Corroborating: this machine's pagefile peak usage is **16.6GB**.

**What survives of the `workers` finding.** The `error 1455` crash-loop at
workers=8/4 was real and separate. Mechanism (`ultralytics/data/build.py`):
`prefetch_factor=4` (line 355, double PyTorch's default) with `pin_memory=True`,
and `InfiniteDataLoader` builds its worker iterator **once** and never recycles
it (lines 67-98) — so page-locked in-flight images are `workers*4*batch` and
accumulate over the whole process lifetime. That genuinely explains why a lower
worker count delayed rather than removed the wall. What does **not** survive is
the conclusion "`workers=0` is the only fix verified safe": it was never the
binding constraint on the fifth attempt, and it costs real throughput by leaving
a 960px pipeline single-threaded.

**Second defect, found in the same investigation.** `src/train.py` detected
resume *after* computing the output folder, so every resume minted a new
auto-numbered directory. `training.log` went there while Ultralytics wrote
`results.csv` and the weights to the original folder (it restores `save_dir`
from the checkpoint, `cfg/__init__.py:450-451`). This is the origin of
`checkpoints/yolo26s/2-baseline`, `3-baseline` and the `yolo11n`
`2-baseline`…`7-baseline` debris, it violates the Order Rule in `AGENTS.md`,
and it is the direct reason four failures in a row left no traceback anywhere
anyone thought to look. Both defects are fixed in `train.py` as of 2026-08-17:
resume now reuses the checkpoint's own run folder, and on resume only
explicitly-set overrides (CLI flags plus `--config` keys) are forwarded.

**Disposition.** User elected to **restart yolo26s fresh** rather than resume a
run with this history. `configs/yolo26s_capacity.yaml` updated to `workers: 2`
(96 in-flight images vs the 192 that died at workers=4) with every modeling
hyperparameter unchanged, so the capacity comparison against yolo26n stays
valid. The epoch-9 weights were deleted; `args.yaml`/`results.csv`/
`training.log` are retained as the measured record of attempts 1-5. The
capacity question itself remains **unanswered**.

**Method note.** Three separate diagnoses in this thread (worker count, then
`workers=0`, then an assumed RAM leak) were each argued from symptoms and each
wrong. The correct answer came from reading the framework's resume code and
checking one artifact — `args.yaml` — against it. That is the fourth time in
this project a symptom-first magnitude call has come in wrong (see also D1, D8
preliminary, D9 preliminary).

#### D16 — Experiment: YOLO11n architecture-swap test *(PREPARED 2026-08-14)*

While D15 (yolo26s capacity) sits paused, `configs/yolo11n_capacity.yaml`
prepares a second, independent lever: architecture family at the *same* nano
parameter budget. Verified this session: `yolo11n.pt` has 2,624,080
parameters — comparable nano scale to yolo26n, not yolo26s's 9.95M. This
means none of D15's VRAM/AutoBatch problems apply; `batch=32` is expected to
behave like every yolo26n experiment, not like yolo26s.

**Recipe carried over unchanged** from the best measured combination so far:
AdamW, cls=1.5 (D11/D12's peak), box=7.5/dfl=1.5 (untouched, D8), moderate
augmentation (SS3.5's best-on-test level), imgsz=960, weight_decay=0.0005
(Ultralytics default, hardcoded in `train.py`, never a tuned CLI flag in this
project — the regularization term).

**`workers=0`, not 4 or 8** — the one deliberate change from the yolo26s
recipe, directly applying D15's lesson: single-process dataloading is slower
per epoch but structurally cannot crash-loop the way Windows multiprocessing
DataLoader workers did twice today.

**HONEST STATUS:** weaker-evidenced than D15's capacity hypothesis — nothing
in this project's diagnostics (D8, D10) points at yolo26's architecture
specifically as a limiting factor, so this is closer to "cheap to check" than
"targeted by evidence." `epochs=120`/`patience=20`, single-stage, sized to
roughly cover yolo26n's own Exp1+Exp2 combined budget (127 epochs). Judged on
val; test stays reserved per D14.

**RESULT (stopped by user at epoch 112/120, 2026-08-16).** Val fitness had been
pinned at 0.5242 for 16+ consecutive epochs, so the remaining budget was not
going to move it. Best checkpoint is epoch 109.

| | val | real test split |
|---|---|---|
| mAP50 | 0.8864 | **82.73%** |
| mAP50-95 | 0.5243 | — |
| P / R | 0.786 / 0.833 | 82.23% / 71.93% |

Per-class test AP50: closed_eye 88.13%, open_eye **83.80%**, yawning 76.26%.

**Verdict: architecture family is not the lever either.** 82.73% test lands
inside the 79.55–82.75% band every yolo26n experiment already occupied, and
statistically tied with Exp4's 82.75% — well inside the noise floor D13 says
this project cannot resolve. `open_eye` at 83.80% is the best that class has
scored here, but `yawning` stayed at 76.26% against its own measured 91.53%
ceiling (D8), unchanged. Cost: **41.0h and a 21.3MB checkpoint** (4x yolo26n's
5.4MB) to reproduce a nano-scale result — a bad trade on both axes for
deployment. Val overstated test by 5.9pt, consistent with D6/D7.

D16 is **closed**. Combined with D11/D12 (loss balance, closed) and D10
(dataset defects, all three rejected), the calibration ceiling identified in
D8/D10 has now survived every lever tried at nano scale.

#### D17 — Experiment (PLANNED, not started): clean-subset dataset test *(recorded 2026-08-16)*

**Not started. No script written, no images touched, `Dataset-Main` untouched.**
Recorded here so the rationale and design survive to whenever this is picked
up, rather than being re-derived from scratch.

**Goal.** Build a new, small, clean, balanced, leakage-safe dataset carved
out of the current corpus, to test directly whether source-quality /
annotation issues (D2, D6) are actually limiting performance — a controlled
experiment, not an assumed fix. **Do not assume it reaches 93%.** If this
subset performs no better than the equivalent-size slice of the full corpus,
that is evidence dataset quality is *not* the bottleneck and the remaining
candidates (capacity, D13's noise-floor measurement, human re-annotation)
move up in priority.

**Design, evidence-derived from D2/D6/D10:**

- **Exclude `dd_v1_*` (~9,052 images).** The only corpus this project's own
  audit confirmed as a genuine defect source — 0 `closed_eye` labels despite
  being drowsy-driver footage (D6), and the population where D2's pseudo-label
  dry run found real annotation gaps (72% of the 4,225 target images, tiny
  ~12px eyes on rotated/watermarked stock photos, D10).
- **Prefer already-audited reliable sources**: `bare_numeric` (~10,481,
  eye-only, reliable), `yawn_new`/`Yimg`/`img` (~5,358, yawning-only, cleared
  of convention-conflict once tier-controlled — D10), `sNNNN_*` sessions
  (1,655, real video-realistic footage), `istockphoto*` (901, small).
- **Target ~8,000–10,000 images**, capped by the scarcest usable class
  (yawning's image-source ceiling), balanced across `closed_eye`/`open_eye`/
  `yawning` rather than importing more eye-class images than yawning can
  match.
- **Leakage-safe grouped 80/10/10 split** — reapply this project's own
  Phase 13 (group-aware split) / Phase 14 (leakage verification) machinery to
  the subset rather than a fresh random split, so the zero-leakage guarantee
  (0 of 23,502 groups / 14,733 units / 11 sessions spanning splits) carries
  over instead of being re-earned from nothing.
- **`Dataset-Main` stays untouched** — subset lives in its own new directory,
  same discipline as every other experiment in this project.
- **Run `src/audit_dataset.py` on the subset before training** — same
  certification gate the main dataset passed (D10: 0 cross-class conflicts, 0
  duplicate boxes), not a rubber-stamp.
- **Comparison, not replacement.** Once trained, compare against the current
  dataset's equivalent-size/equivalent-budget checkpoint on the same held-out
  test split, per this project's existing test-split discipline (D14) — test
  is reserved for infrequent confirmation, not iterative tuning.

**Status: future experiment, queued behind D15/D16's capacity results and
D13's noise-floor measurement. Not authorized to start.**

#### D18 — Cross-dataset warm start from the prior project's YOLOv11m *(COMPLETE 2026-08-16, best result in project)*

**What's new, and why it isn't just another capacity test.** Every lever tried
so far (D11/D12 loss balance, D15/D16 capacity) started from COCO-generic
weights and moved a hyperparameter. This starts from a checkpoint that has
**already learned this exact task on a different corpus**: the prior project's
`YOLOv11m 640 Worst-Case` (`archived` at
`D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\
checkpoints\Fullstack Web App Models\YOLOv11m 640 Worst-Case\...\weights\best.pt`,
91.52% mAP50 on that project's own test set, 20.1M params). Class order is
identical (0 closed_eye / 1 open_eye / 2 yawning), so no label remapping is
involved. The untested variable is **transferred task-specific features**, not
parameter count.

**Run.** `checkpoints/yolo11m/1-yolo11m-warmstart-pilot-640/`, 15-epoch pilot,
**imgsz 640** — deliberately the checkpoint's own native resolution rather than
this project's usual 960, so the result is attributable to the dataset-transfer
question alone and not confounded with a simultaneous resolution shift. Recipe
otherwise this project's measured best: AdamW, lr0 0.001, cls 1.5 / box 7.5 /
dfl 1.5, moderate-aug block, `warmup_epochs 1.0` (fine-tune, not from-scratch),
batch 16, workers 0. Ran clean, 7.2h, no incidents.

**RESULT — val, best epoch:**

| | D16 (yolo11n, 112 ep) | Exp4 (yolo26n, best prior) | **D18 (15 ep)** |
|---|---|---|---|
| mAP50 | 0.8864 | 0.88917 | **0.9130** |
| mAP50-95 | 0.5243 | 0.52501 | **0.5932** |
| P / R | 0.786 / 0.833 | — | 0.821 / 0.824 |

**This is the first lever in the project to move the needle by more than ~1
point.** mAP50-95 is **+6.9pt** over the best prior val figure — an order of
magnitude larger than the entire calibration avenue's yield (+0.96pt val for
~18 GPU-hours, D11/D12). It cleared D16's *fully-converged* fitness (0.5242)
**after a single epoch**, and did it in 15 epochs / 7.2h against D16's 112
epochs / 41.0h.

**What is NOT established.** This is a **val** number and nothing else. Per
D6/D7 every val figure in this project has overstated the real held-out test
split by ~5-6pt, which would put the honest expectation nearer 85-86% test
mAP50 — still comfortably the best result here, but not the 91.3% the val row
reads. `src/evaluate.py --split test` has **not** been run on it. Until it is,
D18 is a strong signal, not a result. Video sanity check did pass: all three
classes detected on real footage, 1800 frames at 68 FPS.

**Why this matters for the D8/D10 ceiling argument.** The standing conclusion is
that the ~82.7% test ceiling is calibration-bound, not capacity-bound, and D16
just reconfirmed capacity is not the lever. D18 does not contradict that — it
changes the *initialization*, which is a third thing. If the test number holds
up, the mechanism worth investigating is whether task-pretrained features start
the model at a better-calibrated confidence distribution than COCO features do,
which is precisely the calibration hypothesis D8 closed on without a way to
test. That is a real experiment, not a claim.

**RESULT — real test split, measured 2026-08-17 (`src/evaluate.py --split
test`, same 5,589-image/7,427-instance set as every other experiment here).**

| | val (best epoch) | **test (raw)** | test (label-gap corrected) |
|---|---|---|---|
| mAP50 | 0.9130 | **86.42%** | 86.75% |
| Precision | 0.821 | 82.69% | — |
| Recall | 0.824 | 73.82% | — |
| F1 | — | 77.97% | — |

Per-class AP50 (test, raw): closed_eye **92.38%**, open_eye **86.28%**, yawning
**80.61%** — every class individually beats its own best-ever figure in this
project (previous bests: closed_eye 89.14% Exp2, open_eye 83.80% D16, yawning
78.76% Exp3).

**The test number holds up.** Val→test gap is 4.88pt, consistent with (and
slightly tighter than) the 5-6pt D6/D7 pattern — this is not a case of val
optimism inflating an otherwise-ordinary result. **86.42% clears the
79.55-82.75% band every other experiment in this project has occupied by
~3.7-4pt** — the first lever tried (dataset defects, loss balance, capacity,
now cross-dataset warm start) to move test mAP50 by more than the ~1pt noise
floor D13 established. Cost was 15 epochs / 7.2h, far cheaper than D16's 41h
for a worse result.

**D18 is closed, and the calibration-ceiling framing (D8/D10) needs a caveat
it didn't have before.** The ceiling held against every lever that started
from COCO-generic weights. It did not hold against a lever that starts from
weights that already know this task. That is consistent with D8's own
mechanism finding — the bottleneck was confidence calibration on
correctly-detected objects, not detection capability — and is exactly what
task-relevant pretraining would be expected to improve if D8's hypothesis is
right: better-calibrated confidence out of the gate, not more capacity.

**Open questions before treating this as the project's answer, not just its
best result so far:** (1) only 15 epochs were run — unknown whether it has
plateaued or still has headroom, unlike every fully-converged comparison point
here; (2) it is YOLO11m at 20.1M params / 640px, ~4x yolo26n's deploy size and
a different resolution than this project's 960 standard, so it is not yet a
drop-in replacement for the accuracy-tier deployment slot without its own
resolution/size tradeoff analysis; (3) n=1, no seed repeat, same D13 caveat as
every other result here.

---

### 3.8 Recommendation on the dataset — superseded by D8, see below (2026-08-13)

**Can the dataset be fully repaired automatically? No.** Of the 9,157
incompletely-supervised training images, roughly **46% (4,225) are reliably
fixable** — the eye half, where absence is certainly an error and the current
model is strong. The remaining **54% (4,932) are not** (D5), and two further
defects (D4 geometry, D6 split coverage) cannot be repaired at all without
inventing labels or breaking leakage guarantees.

**Deletion is rejected on measurement, not preference** — it costs 48.4% of
`closed_eye` positives (D3).

**Recommended sequence:**

1. **Measure D4 first** (~25 min, no training). Split the 1,985 misses into
   overlap failures versus true blindness. If most are overlap failures, the
   ceiling is partly an annotation-geometry artifact and pseudo-labelling will
   not help — which changes everything downstream. Cheapest decisive test
   available.
2. **Then fix D2's eye half** — pseudo-label completion on 4,225 images, human
   spot-check of a sample, new dataset directory, retrain.

**Realistic time:** ~2.5 h tooling + ~10 min inference (the target set is small)
+ ~45 min human review + ~11.5 h unattended retraining and evaluation.

**Expected value — stated honestly.** Unknown. The D1 correction was predicted
to be worth several points and delivered under half a point; that miss is the
reason no number is attached here before step 1 runs.

**OUTCOME (2026-08-13): step 1 ran and overturned this recommendation.** D8
measured only 23 genuinely-undetected objects across the whole test split, so
completing missing labels cannot meaningfully improve recall. The targeted-FIX
plan above is **withdrawn as a recall remedy**. Both FIX and DELETE are now
rejected on evidence: DELETE costs 48.4% of `closed_eye` positives (D3), and FIX
addresses 1.2% of the misses. The dataset stays frozen and unmodified.

The one surviving reason to revisit D2 is calibration, not recall — see D8's
closing hypothesis. That is a different experiment with a different rationale,
and it is not the plan recorded above.

---

## Chapter I — Ingestion, Scanning, and Foundational Measurement
### Phases 1–4

**Objective.** Build the measurement substrate every later phase depends on,
without modifying the source corpus.

**Phase 1 (`p01_scan.py`).** Every image was decoded once and characterized:
byte and pixel MD5, three perceptual hashes (aHash 8×8 mean-threshold, dHash
9×8 gradient, pHash 32×32-DCT), blur (resolution-normalized), brightness
statistics, colorfulness, and label-file presence/line-count. This scan is
the cache nearly every later phase reads from rather than re-decoding images
— an explicit resource-efficiency decision that recurs throughout the
project (see Chapter XV, Principle 4).

**Phase 2 (`p02_recover_polygons.py`).** The label parser in general use
required exactly five whitespace-separated tokens per line (`class xc yc w
h`). Some source annotations were stored as polygons (`class x1 y1 x2 y2 ...
xn yn`, an odd token count). Phase 2 correctly recovered 284 such polygon
annotations into `working/polygon_recovery.csv` — but, as discovered six
phases of pipeline-time later in Phase 12D, this recovery was **never merged
into the box cache** that every subsequent phase used. This is the project's
longest-lived latent defect: it survived Phases 3 through 11 undetected
because nothing re-derived box counts independently until Phase 12D built an
augmentation-invariant sample instrumentation that happened to also surface
it as a side effect (Chapter VIII, §1).

**Phase 3 (`p03_duplicates.py`).** Exact byte- and pixel-duplicate detection
via MD5 collision, with same-Roboflow-basename families flagged separately as
a leakage signal (not necessarily a duplicate).

**Phase 4 (`p04_near_dup.py`, `p04b_validate_groups.py`).** Near-duplicate
detection via a three-signal cascade (exact pixel identity → perceptual-hash
Hamming distance ≤6/64 bits → 16×16-thumbnail L2 distance for hash
disagreements), with candidates generated by 8-band LSH over the 64-bit pHash
to make the ~3.2-billion-pair problem tractable. Union-find over confirmed
edges produced 23,505 **visual groups** — the finest independently-validated
partition of the dataset, and the atom later chosen for supervision-scope
inference (Chapter VI) precisely *because* it does not over-merge the way the
later, more aggressive split-safety unit does (Chapter VIII).

**Challenge and resolution.** The central challenge across Phases 1–4 was
computational: pairwise comparison at 57,098 images is intractable at
$O(n^2)$. Every near-duplicate and leakage check in this project — from Phase
4 onward through the final hardening audit in Chapter XIII — uses the same
answer to this challenge: **candidate generation via cheap bucketing (LSH
banding, hash prefixes, shared metadata keys), followed by expensive
confirmation only on the surviving candidates.** This pattern appears at
least six times across the project and is treated in Chapter XV as a
first-class methodological principle rather than a one-off optimization.

---

## Chapter II — Geometric and Size Analysis
### Phase 7 (`p07c_tiered_sizes.py`)

**The problem.** Pooled object-size statistics claimed a median mouth size of
220 px at 640×640 — a number that, if used to select model input resolution,
would calibrate the detector to images that do not represent the deployment
distribution.

**Diagnosis.** The dataset is bimodal: 20.9% of images are extreme close-up
crops where a single eye or mouth fills the frame (an artifact of how some
source pools were captured or curated), and pooling these with realistic
full-frame driver images inflates every size statistic. The project defined
three tiers by maximum box area fraction:

| Tier | Rule | Share | Role |
|---|---|---:|---|
| A_full_frame | max box area < 0.06 | 39.6% | deployment-realistic |
| B_moderate_crop | 0.06–0.50 | 39.5% | face/ROI crop |
| C_extreme_crop | ≥0.50 | 20.9% | auxiliary, single-class by construction |

Recomputed on tier A alone, the median mouth size drops to 97 px — a 2.3×
correction. `open_eye` was found to be the binding size constraint (median 43
px at 640, 17.9% of boxes under 32 px), which is the evidence basis for a
downstream recommendation to consider `imgsz=960` for training (a decision
explicitly left to the training phase, out of this project's scope).

**A secondary finding treated as a first-class result, not a footnote:**
`closed_eye` boxes have a median side of 94 px versus `open_eye`'s 43 px in
the *same* tier — a 2.2× difference in annotation looseness between two
classes with no comparable real anatomical difference. This is documented as
an annotation-consistency concern carried forward rather than corrected,
since correcting box geometry without ground truth would itself be a form of
label invention.

**Why tiering matters beyond size statistics.** Class balance is
tier-dependent (tier A is yawn-poor at 19.2%, tier C is yawn-rich at 44.6%),
which means any split or size analysis that does not stratify by tier
produces a validation set that silently does not match the deployment
distribution. This finding directly motivated tier-aware reporting in every
later distribution audit (Chapters IX, XIII).

---

## Chapter III — Annotation Completeness: Two Failed Automated Attempts
### Phase 8 (`p08b`–`p08g_yawn_calibrated.py`)

This chapter is, by the project's own account, a record of failure —
preserved deliberately because the failures are as methodologically
important as the successes.

**Attempt 1: "is a mouth region present and unlabeled?"** Using Haar-cascade
face/mouth detection, this heuristic flagged 6,144 tier-A images (27.3%) as
having a missing yawn label. **Invalid on inspection.** The target class is
`yawning`, a behavior, not `mouth`, an object. A closed mouth correctly
carries no label under the class definition; the heuristic could not
distinguish the two and graded closed-mouth and mid-yawn faces identically.

**Attempt 2: calibrated Otsu mouth-aperture gate.** A second attempt used
Otsu thresholding on histogram-equalized mouth-region patches, calibrated
against known yawn boxes, reducing the flagged set to 3,049 images (a 58%
cut from attempt 1). **Also invalid.** `cv2.equalizeHist` forces a bimodal
intensity split on *any* patch by construction, so lips, shadow, and stubble
threshold as an open oral cavity regardless of whether the mouth is actually
open. The calibration inherited this bias rather than correcting for it, so
its threshold was permissive by design, not by mistake.

**What survived this chapter.** Both quantitative rate estimates were
formally withdrawn — the project explicitly records "the missing-yawn-label
rate is NOT ESTABLISHED" rather than reporting a number known to be wrong.
What *was* established with a calibrated, controlled test (using
known-both-labeled images as ground truth, with measured false-positive and
sensitivity rates) is an asymmetric result: eyes are *always* a target object
under the class definition, so an unlabeled visible eye is unambiguous
evidence of a miss (≥547 tier-A images, 2.43%, proven as a *floor* given
~20% test sensitivity). Mouths are only a target when actively yawning, which
automated tooling in this environment could not reliably distinguish from a
merely-open or closed mouth.

**Why this chapter matters methodologically.** The project's rule — "where
evidence could not support a claim, the claim was withdrawn rather than
weakened" — was tested here under real pressure (two rounds of engineering
effort already invested) and held. This directly motivated Chapter IV: since
automated tooling had now failed twice on the yawning side, the only path
left that did not fabricate a rate was to ask a human.

---

## Chapter IV — The Human Review Package
### Bridge phases 9–10

A 430-case stratified review package was constructed rather than a random
sample, because a random sample of tier A would be dominated by the
already-well-understood cases and would not resolve the specific ambiguities
Phase 8 left open. Thirteen strata were defined (`eye_only_face_present`,
`suspected_missing_eye`, `multi_face`, `rotated`, `glasses`,
`no_face_detected`, `hard_box_geometry`, `completeness_check`, and others),
each targeting a specific hypothesis about where labels might be missing or
annotation geometry might be wrong.

Two engineering choices in this package are worth recording as patterns:

1. **A blind control set.** 25 cases where both label families were already
   known-complete were mixed into the `completeness_check` stratum
   *without being marked as controls*, to measure whether the reviewer would
   answer "missing" reflexively. This is a standard measurement-instrument
   validation technique, applied here to a human-in-the-loop labeling step
   rather than a model.
2. **A hard cap of 2 cases per visual group.** Because a visual group is
   typically one person/session, an unconstrained sample would show the same
   face dozens of times and waste reviewer effort without adding information.
   430 cases were drawn from 385 distinct groups.

A local, offline, browser-based review tool (`review/review.html`) was built
so decisions autosave after every keystroke and export as CSV/JSON — a design
directly reused and extended for the later multi-box review (Chapter XIV).

---

## Chapter V — Human Review Decisions and the Central Finding
### Phase 11 (`p11_ingest_decisions.py`, `p11b_rotation_audit.py`, `p11c_weighted_rates.py`)

**Validation before interpretation.** Before any rate was computed, six
validation checks confirmed the 430 decisions were structurally sound: every
review ID resolved, every case was decided, all decisions were within the
valid A–F range, no duplicates existed, and — critically — the blind control
set (§ Chapter IV) came back **25/25 = 100% "correctly annotated,"** including
11 cases rendered rotated. This is the strongest single piece of evidence in
the whole project that human review quality was not compromised by
presentation artifacts.

**The central finding.** Weighted by population (using the same
stratum-priority logic the sampler used, achieving 100% stratum coverage of
tier A), two annotation gaps emerged that are **disjoint and systematic in
direction**, not random noise:

| Label family | Population | Missing eye labels | Missing yawn labels |
|---|---:|---|---|
| `yawn_only` (annotated only for mouth) | 6,062 | **96.3%** (≈5,836 images) | 1.9% |
| `eye_only` (annotated only for eyes) | 15,198 | 0.0% | **27.1%** (≈4,119 images) |
| `both` (annotated for both) | 1,263 | 0.0% | 0.0% |

**Root cause, confirmed rather than inferred.** Grouping the dataset by
filename provenance showed 20 of the top 22 source prefixes are >95% a single
label family, covering 18,729 images. This is not annotator carelessness —
it is **structural**: the corpus is a union of single-task source datasets
(an eye-state corpus and a yawning corpus, each internally correct for its
own task), merged into one three-class label space without re-annotation.
Human review measured the size of the resulting gap; it did not discover
sloppy labeling.

**A rendering defect discovered and resolved through the same review data.**
Three review answers ("missing yawning" on images that *already had* a
yawning box) looked like reviewer error until traced to source: a rotation-
detection heuristic (`rot_k`, "first orientation at which a face cascade
fires") occasionally fired on a false orientation for wide-open-yawn or
tilted faces, causing an upright source image to be *displayed* upside-down
during review. Contact-sheet verification against unrotated source pixels
confirmed the source files were correct and only the render was wrong. The
three cases were reclassified from "missing" to "correct" rather than
silently dropped, and the broader blast radius (170 of 430 renders affected)
was quantified and shown to shift case *mix*, not reviewer *judgment* — the
missing-yawn rate was ~14% either way.

**The decision this chapter produced, and the constraint that shaped it.**
Given the class definitions, repairing the ~46% of tier-A images with
incomplete-by-construction labels was evaluated against the standing rule
"do not automatically create new labels using a model." A human confirming
"an eye is visible" does not supply *where* — producing a box would require
a detector inventing coordinates, which the rule forbids. This left three
options: train as-is (accepting the noise), source-aware loss masking
(exclude unannotated-class regions from the loss without inventing labels),
or family-partitioned training (use only the 1,263 fully-annotated images).
The recommendation carried into Chapter VI was source-aware masking, as the
only option that neither fabricates labels nor discards 97% of the data.

---

## Chapter VI — Source-Aware Supervision Manifest
### Phase 12A (`p12a_*.py`)

**The rule, stated precisely, because an early draft got it wrong:**

```
supervise(image i, class c) = 1  if i contains ≥1 box of class c
                             = 1  if i's source cohort is CONFIRMED to annotate c
                             = 0  otherwise (meaning: unknown, not "absent")
```

The first draft of this rule masked an entire class across an image based on
cohort scope alone, which would have discarded 22,487 real annotations
(29.2% of all boxes) — precisely the labels Chapter V's human review had just
proven trustworthy. The corrected rule masks only the *absence* of a class,
guaranteeing 100% box retention by construction. This is recorded as a
concrete instance of the project's "never mask a real box" principle failing
its first implementation and being caught by a retention-count check before
it reached any later phase.

**Establishing provenance: three signals tested, two rejected on evidence.**
Image resolution carried no signal (Roboflow had normalized all images to
640×640). Filename schema was tested and found insufficient — validated
against the human decisions, it protected only 5 of 61 known-incomplete
cases. The 23,505 Phase-4 visual groups were adopted instead, deliberately
choosing the *conservative* (finer) grouping over the more aggressive
leakage-safety unit built for split purposes, because a false merge in a
leakage context is nearly free (over-grouping just costs split flexibility)
while a false merge in a supervision-scope context is not — it manufactures
a fake "this source annotates both classes" claim.

**The naive rule tested and rejected.** "A cohort containing ≥1 fully-labeled
image supervises everything" was tested directly against ground truth and
failed: 28 of 61 missing-yawn cases and 69 of 155 missing-eye cases came from
cohorts containing at least one fully-labeled image. Two hypotheses were
tested to explain this — accidental group over-merging (rejected: 0 of the
failing cases spanned more than one visual group) and genuine partial
annotation within a real session (confirmed, with clean separating
structure: correctly-annotated cohorts have a median 100% both-family share;
failing cohorts never exceed 50%). A threshold of `both_share ≥ 0.60`,
chosen at the empty gap between these two distributions rather than by
convention, achieved 60/61 and 155/155 protection on the human-labeled
validation set.

**Result.** Every real box remains fully supervised (verified: 100% box
retention across all three classes). 136 genuinely inert background images
(no boxes, single-family cohort) contribute no classification loss, as they
should. Net effect: `yawning`-absence is now supervised on 41.3% of images
(down from a naive 100%), trading away some true negatives in exchange for
never teaching the model that a real, visible yawn is background — a
deliberate, quantified trade whose payoff Chapter VII was built to measure.

---

## Chapter VII — The Loss-Masking Investigation
### Phase 12B/12C (`p12b_*.py`, `p12c_validate.py`)

This chapter contains the project's most consequential near-miss.

**What was built.** Reading the installed Ultralytics 8.4.64 source directly
(not assumed from documentation), the project identified that
`v8DetectionLoss` computes a per-class BCE loss with a broadcastable
`(1,1,nc)` class-weight hook already wired in — meaning a per-image
supervision mask could be applied with a one-line change, not a loss
reimplementation, and could be proven mathematically inert on the parts of
the loss that must not change (box/DFL loss, assignment) because those key
only off ground-truth boxes, which are never removed by masking.

**The near-miss.** An initial probe reported "mosaic preserves the per-image
mask key" — a claim that, if trusted, would have shipped a design believed
correct while being silently, catastrophically wrong. Reading the
augmentation source further revealed the actual mechanism: Ultralytics'
`Mosaic._cat_labels` builds its returned label dict from five hardcoded keys
and *updates* (not replaces) the working labels — so a custom per-image mask
key does technically "survive," but only as **tile 0's mask, attached to a
4-image composite built from four different, unrelated source cohorts.**
Measured directly: on 400 real mosaic samples, this caused a genuine
annotated box to be silently left unsupervised in 54.5% of samples (38.35%
of all real boxes) — precisely the failure mode Phase 12A was built to
prevent, reintroduced one layer up by the augmentation pipeline. This is
recorded explicitly as "the first probe would have looked validated when it
was not" — the difference between a check that runs and a check that
actually tests the right thing.

**The corrected design.** Rather than patching the symptom, the supervision
rule was redefined to be recomputed *inside the loss function itself*,
directly from the tensors the loss assigner already consumes
(`batch["cls"]`, `batch["batch_idx"]`), with presence-as-union and
absence-as-intersection composited correctly across mosaic tiles. Because
nothing is plumbed through the augmentation pipeline, no future transform can
desynchronize it. This is strictly stronger than fixing the plumbed version:
verified at 0 of 1,358 real boxes left unsupervised under mosaic=1.0, versus
517 under the naive plumbed design.

**Where the corrected design still fails, and the decision that followed.**
Simulating 20,000 four-tile mosaic composites from the real training pool
showed that 93.7% of composites have at least one class where the four
contributing tiles disagree on annotation completeness. A single per-class
mask value cannot be correct for all four simultaneously — this is not an
implementation gap, it is mosaic breaking the one-image-to-one-source-cohort
correspondence the entire per-image mask design presumes. The only fully
correct fix is a per-anchor spatial mask surviving `RandomPerspective` and
flips — a fork of the augmentation stack, judged too fragile a maintenance
burden to force onto training.

**The decision.** Source-aware loss masking is validated, documented, and
shipped as an *optional* training-time component with its constraint stated
plainly (correct without image-combining augmentation; not forced under
mosaic/mixup/cutmix). It is explicitly **not** built into the exported
dataset — the final YOLO export stays standard format, requiring no custom
trainer, and unknown class absence stays documented in
`supervision_manifest.csv` as a companion artifact rather than baked into
labels.

**A defect found by the verification tooling itself, not by looking for it.**
The five-invariant automated test suite built to check this masking design
(INV1–INV5, run across nine augmentation modes) surfaced 36 unexplained
violations at *zero* multi-source samples — impossible under the masking
logic being tested. Tracing the anomaly (rather than reporting the confusing
number) found two unrelated real defects: (1) `supervision_manifest.csv` had
6,441 stems appearing under more than one original split, an artifact
carried forward into leakage analysis (Chapters X, XIII); and (2) 12 probe
images recorded as background actually held a real annotated object stored
as a polygon — which is precisely the Phase 2 defect described in Chapter I,
finally surfaced eight phases after it was introduced. Recovering it is the
subject of Chapter VIII.

---

## Chapter VIII — The Polygon Defect and Unit Construction
### Phase 12D

**§1. Recovering the eight-phase-old defect.** The polygon annotations
recovered in Phase 2 (Chapter I) but never merged into the box cache were
finally merged here: 284 boxes across 278 images, reducing false
"background" images from 197 to 2. An independent re-derivation of the same
284 polygons agreed to 5×10⁻¹¹ on every coordinate — confirming the recovery
twice over rather than trusting a single code path. Validation against the
430 human decisions moved slightly in the *correct* direction after the fix
(one fewer case protected, individually inspected and confirmed to be
because the "missing label" was never actually missing — it existed as a
polygon the parser had been dropping).

**§2. Split-unit construction and a genuinely circular validation, caught and
fixed.** An early merge script decided that two images were near-identical
duplicates when full-resolution RMSE ≤ 10.0, and then validated the merge by
checking "no pair with RMSE ≤ 10.0 was left split" — using the identical
constant on both sides of the argument. This passed by construction, proving
nothing. It was caught because the actual measured margin between the
closest "kept separate" pair (RMSE 10.02) and the merge threshold (10.0) was
0.02 — a gap so thin it forced the question of why 10.0 was chosen at all,
rather than derived from evidence.

**The fix decoupled the two roles a single number had been playing.** A
20,000-pair negative control (unrelated images, sampled by group/basename/
hash disagreement) established the actual measured floor of "how similar do
truly unrelated images get" at RMSE 11.20. The merge cut was then set
strictly below that floor with a stated safety margin, while the strict
"near-identical" gate definition stayed fixed at 10.0 — meaning a gate
failure would now be a real finding, not a tautology. On this run, the
evidence-derived ceiling (11.20 − 1.0 headroom = 10.20) happened to round
down to the same 10.0 value, meaning the data itself did not support raising
the cut further — an honest negative result, reported as such rather than
forced.

**§3. Independent re-verification, by design.** A *separate* script
(`p12d_verify_units.py`), re-deriving every check from original full-
resolution pixels rather than trusting the merge script's own summary, ran
five gates: no near-identical pair left split, no MD5-identical pair spans
units, no visual group spans units, the largest unit stays under the 11%
split-feasibility cap, and merging only ever coarsened the atom (never split
an existing unit). All five passed. This separation of
"decide" from "disbelieve and re-check independently" recurs as a named
principle in Chapter XV.

---

## Chapter IX — Group-Aware Splitting
### Phase 13 (`p13_group_split.py`)

**The split atom.** `merged_unit_id` from Chapter VIII — never `unit_id`
alone, and never a raw image — because splitting a unit is leakage by
definition, not a tuning choice.

**A first algorithm that converged to the wrong answer, corrected in place.**
An initial greedy assignment scored candidate splits by *equally weighting*
image-count deviation against three per-class count deviations. Because
train's target is roughly seven times larger than val or test, this design
let the first few large units get absorbed into val/test whenever their
class composition happened to look proportionally closer there — producing a
62%/19%/19% split against a 78/11/11 target, a real bug rather than
acceptable variance. The fix re-weighted the objective hierarchically:
primary key is which split is most under-filled *relative to its own target*
(preventing a small target from being swamped early), with class-balance
used only as a tie-breaker within a small tolerance band. This converged to
77.67/11.17/11.16% with per-class deviation within a few percentage points
of target — verified, not assumed, by checking the actual resulting
distribution rather than trusting the algorithm's design intent.

**Result.** 14,735 merged units partitioned with zero units spanning a
split (enforced as a hard assertion the script refuses to write past), class
representation preserved within a few points of the global distribution.

---

## Chapter X — Independent Leakage Verification
### Phase 14 (`p14_leakage_verify.py`)

**A second serious methodological failure, caught immediately and corrected
in the open.** The first implementation of this phase's leakage-repair logic
treated "same Roboflow basename" (`rfbase`) and "same canonical perceptual
hash" as *unconditional* proof of identity, and unioned every such pair
before reassigning splits. This produced a single connected component
containing **39.6% of the entire dataset** — 3.6× the 11% split-feasibility
cap — which is precisely the "unreasonable over-merging" failure mode later
audits are built to catch, not one they should produce. Root cause,
diagnosed by reading `p12d_unit_merge.py` (Chapter VIII) rather than guessing:
Roboflow re-uses sequential export filenames independently *per source
folder*, so two images can coincidentally share `000001_jpg` while being two
entirely unrelated photographs. `rfbase` and hash equality were always meant
to be *candidates* requiring pixel-level corroboration before merging, never
merge evidence by themselves — a convention this project had already
established in Chapter VIII and briefly failed to carry forward consistently
here.

**The corrected design.** Every candidate relation (same `rfbase`, exact
canonical-hash match, banded near-phash match) is reduced to cross-split
representative pairs and confirmed against full-resolution, orientation-
invariant RMSE (≤10.0, the same calibrated threshold used throughout) before
being allowed to union two images. On the corrected run: of 3,499 candidate
pairs checked, exactly **1** was a real cross-split duplicate (confirmed and
moved); the other 3,498 were coincidental filename/hash collisions between
genuinely different photographs — precisely the outcome the corrected
methodology predicted and the broken one would have missed entirely by
over-merging past the point where the distinction mattered.

**Result.** Final split 77.69/11.17/11.13%, with an explicit, mechanically-
checked guarantee that no exact duplicate, no confirmed near-duplicate, and
no Phase-4 visual group spans more than one split.

---

## Chapter XI — Final Quality Audit
### Phase 15 (`p15_quality_audit.py`)

Applied to exactly the images the export would use (not the full corpus),
reusing cached readability/label facts from Phase 1 rather than re-decoding
57,098 images a second time, and recomputing box sanity directly from the
Phase 12D-corrected box cache. Results: zero corrupted images, zero invalid
class IDs, zero NaN/Inf or out-of-range coordinates, zero zero/negative-
dimension boxes, zero exact duplicate boxes. Three images were found with a
near-duplicate box pair (IoU 0.60–0.68, same class) — an ambiguous double-
annotation that could not be resolved without guessing which box was
spurious — and were **quarantined** (excluded from export, retained on disk)
rather than either kept-as-is or arbitrarily pruned. This is the project's
canonical example of the "if uncertain, quarantine; do not guess" rule
applied to a genuinely undecidable case.

---

## Chapter XII — YOLO Export
### Phase 16 (`p16_export_yolo.py`, `p16b_final_reports.py`, `p16c_final_manifest.py`)

**An arithmetic coincidence used as a correctness check.** 6,441 images
shared a stem across more than one original Dataset-Main split folder — the
same defect surfaced as a side effect in Chapter VII, §"a defect found by the
verification tooling itself." Because every such duplicate had already been
grouped into a single `merged_unit_id` (Chapter VIII) and therefore assigned
to a single final split (Chapter IX), de-duplicating at export time should
remove *exactly* this many images and no more. It did: 57,095 kept rows minus
6,441 duplicate collisions minus 3 quarantined equals 50,654 — matching an
independently-stated "50,657 unique stems" figure from Chapter VII to the
last digit. An exact match across two independently-derived numbers is
treated here as confirmation the deduplication logic is doing precisely what
the theory predicted, not a coincidence to wave past.

**Result.** 50,654 images, 68,292 boxes, standard Ultralytics YOLO
structure, validated by loading `data.yaml` through the installed
Ultralytics `check_det_dataset` — the same code path a real training run
would use, without running any training.

---

## Chapter XIII — The Hardening Audit
### Phases H1–H16

Requested as a final, skeptical, from-scratch pass over the exported
dataset — explicitly not permitted to trust any earlier report's numbers.

**H1 (structural).** Every one of 50,654 images freshly decoded (not read
from cache), every label freshly re-parsed from raw text. Zero corruption,
zero syntax/coordinate errors, zero missing/orphan pairs. Incidental finding:
every exported image is uniformly 640×640.

**H2 (geometry).** Border-touching, tiny/huge, and aspect-ratio-outlier boxes
were quantified and explicitly classified (A/B/C/D confidence tiers) rather
than acted on; zero same-class or cross-class conflicting boxes were found in
the exported set, confirming the Phase-15 quarantine had actually removed
the 3 problem images rather than merely documenting them.

**H4/H5 — the project's most consequential finding.** Fresh, independent
re-fingerprinting of the *actual exported pixels* (not cached hashes from
before deduplication) found **5 confirmed cross-split near-duplicates**
that the pre-export Phase 14 check had missed, because the export-time
deduplication (Chapter XII) changed which images existed at all. Tracing
these pairs by filename pattern revealed something much larger than five
isolated duplicates: the `sNNNN_FFFFF` naming convention (1,655 images, 11
driver-monitoring sessions) is a genuine subject/session identifier, and
**9 of 11 sessions had frames scattered across all three splits** — textbook
person/session leakage, where a model could see a subject in training and
be "tested" on the same subject's face in validation or test.

A contrast case, checked with equal rigor rather than assumed: `dd_v1`
(9,052 images) was investigated as a possible second video session and
found, on inspection of actual filenames, to be a **static-photo source
pool** — heterogeneous scraped images under one project tag, not sequential
video frames. It was left untouched. This pairing — one population acted on
because the evidence supported it, a superficially similar population left
alone because it did not — is the chapter's clearest demonstration of the
"insufficient evidence → do not modify" rule in practice.

**A fix that broke what it was fixing, caught immediately.** The first
repair attempt moved individual images by session-name match alone. Re-
running the independent leakage gate immediately afterward showed Gates 3
and 4 (visual-group and merged-unit atomicity, both PASS before the fix)
had flipped to **FAIL** — the naive fix had moved a session frame that
happened to share a validated unit with a non-session image, splitting that
unit across two splits and reintroducing exactly the kind of leakage
Chapters VIII–X had eliminated. The fix was rolled back precisely (522 file
moves reversed via a recorded changelog, manifests restored from
pre-fix backups) and redone correctly: a union-find over
`merged_unit_id` **and** `group_id` **and** session identity together,
so that moving a component can never re-split either underlying invariant,
with an explicit self-check asserting atomicity *before* any file is written.
On re-verification, all leakage gates passed cleanly.

**H6–H13.** Distribution audit confirmed the corrected split remains
statistically sound (class-ratio spread under 8 percentage points across
splits) with no forced rebalancing. Augmentation forensics investigated
`canon_k` (a per-image orientation-canonicalization index) as a possible
flip/rotation-prevalence signal, found its distribution near-uniform even
within confirmed duplicate groups, and **explicitly rejected it as
meaningless** rather than reporting a plausible-looking but spurious 84%
statistic — a documented example of a metric that looked usable and, on
inspection, was not. Class balance (1.14:1 box-level ratio) was judged mild
and left uncorrected. Human-review consistency and supervision-metadata
integrity were both reverified as 100% intact after the leakage fixes, with
box *content* proven byte-identical before and after (68,292 boxes, exact
match) — confirming the fix changed only split assignment, never labels.

**H14–H16.** A from-scratch certification report was generated directly from
the post-fix `final_dataset/` directory tree, Ultralytics validation was
re-run and passed, and the dataset was certified **READY_FOR_TRAINING** —
with 266 images having moved between splits relative to the Chapter XII
export, zero labels, boxes, or pixels altered.

---

## Chapter XIV — The Human Multi-Box Review

The hardening audit (Chapter XIII, H2/H3) had flagged 275 images as
statistically unusual without alleging they were wrong: 226 with more than
two eye boxes and 49 with more than one yawning box in a single frame —
both explainable by multi-person scenes, and neither modified automatically,
per the standing rule against replacing human judgment with a heuristic.

**A local, from-scratch, resumable review tool** was built (Streamlit) to let
a human make the final call, image by image, with every existing box
rendered in a class-distinguishing color, alongside the specific reason the
image was flagged, group/unit provenance, and four decision options (valid
multi-face scene / valid single-face scene / incorrect annotation /
uncertain). Every decision was written to disk immediately as an atomic,
timestamped JSON record, and the dataset's own byte/file-count fingerprint
was captured before review began specifically so any drift could be
detected — the tool was architecturally incapable of silently modifying the
dataset it was reviewing, and this was verified rather than merely intended.

**Outcome.** All 275 images were reviewed: 224 valid multi-face/multi-person
scenes, 51 valid single-face scenes, **zero** judged incorrect, **zero**
uncertain. The dataset's byte/file-count fingerprint was re-verified
unchanged after the review concluded. The practical result is a clean,
independent confirmation that the earlier decision to preserve rather than
prune these 275 images (Chapters XI, XIII) was correct — arrived at by human
judgment on real pixels, not inferred from statistics alone.

---

## Chapter XV — Methodological Principles Extracted

Six patterns recur often enough across sixteen-plus phases and a full
hardening audit that they are worth stating as principles independent of
this specific dataset:

**1. Absence is not evidence of absence.** Stated first in Chapter V and
enforced mechanically through Chapters VI, VII, XI, and XIII: an unlabeled
region means "not examined for this class," never "confirmed negative,"
unless a specific, checkable condition (source cohort confirmed to annotate
that class) is met. Every phase that touched labels checked box-retention
counts before and after, specifically to catch violations of this principle
before they propagated.

**2. A threshold must never validate the decision it was used to construct.**
Failed once quietly (Chapter VIII, the RMSE=10.0 circularity) and caught by
noticing the validation margin was suspiciously exactly zero. The general
fix pattern — derive the *operating* threshold from a held-out or
independently-sampled population, keep the *validation* threshold fixed and
independent, and require a nonzero measured margin between them — is reused
in Chapters VIII and X.

**3. Corroborate before merging; never merge on a single cheap signal.**
Filename or hash agreement is a *candidate* generator, never proof, because
cheap signals (sequential filenames, coarse perceptual hashes) collide
between genuinely unrelated items at non-negligible rates in large corpora.
This project violated its own principle once in the open (Chapter X, the
39.6%-of-dataset false merge) and paid the cost of noticing, rolling back,
and rebuilding correctly — evidence that stating a principle is not the same
as automatically following it, and that verification gates exist precisely
to catch the gap between the two.

**4. Cache expensive measurements; never re-derive what was already proven.**
Every phase after Phase 1 reads cached image facts rather than re-decoding;
every phase after Chapter VIII reads the corrected box cache rather than
re-parsing labels. This is not merely an efficiency optimization — it is
also what made independent re-verification (Principle 5) affordable enough
to actually run at every stage rather than being skipped for cost reasons.

**5. The script that decides and the script that verifies must be
different scripts, reading independent evidence.** Phase 12D's merge script
and its separate verification script; Phase 14's leakage repair and the
from-scratch H4/H5 re-fingerprinting in Chapter XIII; the Chapter XIV review
tool's dataset-fingerprint check run before and after human review. In every
case where this separation was maintained, a real defect was caught before
it reached the final artifact. In the one case where a fix was verified only
by its own internal logic without an independent re-check first (the initial
H5 session fix), a defect *did* slip through — briefly, but it slipped
through — and was only caught because the *next* independent gate run
happened immediately afterward rather than being deferred.

**6. When evidence is insufficient, document the uncertainty; do not
manufacture certainty.** Chapter III's formal withdrawal of two rate
estimates, Chapter XIII's explicit rejection of `canon_k` as a spurious
signal, and Chapter XIII's decision to leave `dd_v1` unmodified for lack of
evidence are three instances of the same discipline: a number that looks
authoritative but is not well-founded is more dangerous than an honestly
reported "unknown."

---

## Chapter XVI — Reproducibility

For the final dataset specification and location, see **Chapter 1** at the
front of this book — it was moved there so a reader opens the numbers first,
not last.

**Provenance and audit trail (as it existed before the post-certification
directory cleanup, §1.6).** Every image's full lineage — original split,
visual group, merged split-atom, cohort scope, supervision mask, human-review
decision (where one exists), and cleaning/quarantine status — was preserved
in `manifests/final_manifest.csv`, one row per original corpus image. Its
column schema is preserved in Appendix C even though the file itself was
removed; every *aggregate finding* it produced is narrated across Chapters
I–XV.

**Reproducibility.** No randomness governs the final split assignment (Phase
13's algorithm and the hardening-audit fixes are deterministic union-find and
majority-vote procedures); a fixed seed (`20240809`) governs only the sampled
negative controls used to calibrate thresholds in Phases 12D and 14 and the
H4/H5 hardening re-check. The full source of every script in the ordered
pipeline is preserved in the source-code archive (Appendix D, now shipped
alongside the dataset itself) — the pipeline could in principle be rerun
from the raw corpus forward, using that
archive, even with `scripts/` itself deleted.

---

## Appendix A — Historical File and Script Index (selected)

*Paths below refer to directories removed in the post-certification cleanup
(§1.6); they are listed here as a historical record of what produced the
dataset, not as live paths. Full script source is in Appendix D.*

| Path | Role |
|---|---|
| `scripts/p01_scan.py` | Phase 1: full-corpus scan (hashes, blur, brightness, label parse) |
| `scripts/p02_recover_polygons.py` | Phase 2: polygon-label recovery (not merged until Phase 12D) |
| `scripts/p03_duplicates.py` | Phase 3: exact byte/pixel duplicate detection |
| `scripts/p04_near_dup.py`, `p04b_validate_groups.py` | Phase 4: near-duplicate visual grouping |
| `scripts/p07c_tiered_sizes.py` | Phase 7: tiered object-size analysis |
| `scripts/p08b`–`p08g_yawn_calibrated.py` | Phase 8: annotation completeness (two withdrawn attempts) |
| `scripts/p11_ingest_decisions.py`, `p11b_rotation_audit.py`, `p11c_weighted_rates.py` | Phase 11: human review ingestion and analysis |
| `scripts/p12a_*.py` | Phase 12A: supervision manifest |
| `scripts/p12b_*.py`, `p12c_validate.py` | Phase 12B/C: loss-masking investigation |
| `scripts/p12d_*.py` | Phase 12D: polygon merge, unit construction, recut |
| `scripts/p13_group_split.py` | Phase 13: group-aware split |
| `scripts/p14_leakage_verify.py` | Phase 14: leakage verification and repair |
| `scripts/p15_quality_audit.py` | Phase 15: final quality audit |
| `scripts/p16_export_yolo.py`, `p16b_final_reports.py`, `p16c_final_manifest.py` | Phase 16: YOLO export and reporting |
| `scripts/h1`–`h14h15_certification.py` | Hardening audit H1–H16 |
| `scripts/mbr1`–`mbr_review_app.py` | Multi-box human review tool |
| `manifests/final_manifest.csv` | Full per-image provenance and audit trail |
| `manifests/supervision_manifest.csv` | Per-image, per-class supervision confidence |
| `FINAL_DATASET_CERTIFICATION.md` | Machine-checkable final certification |

## Appendix B — Glossary

- **Visual group (`group_id`):** a Phase-4 connected component of
  near-duplicate images, the finest independently-validated grouping.
- **Split unit (`merged_unit_id`):** a coarser, corroborated grouping built in
  Phase 12D specifically to guarantee leakage-safe splitting; deliberately
  more aggressive than a visual group.
- **Tier (A/B/C):** an object-size-based image category (full-frame /
  moderate crop / extreme crop) used to prevent pooled statistics from
  misrepresenting the deployment distribution.
- **Supervision mask (`sup_mask`):** a per-image record of which classes'
  *absence* is trustworthy enough to use as a training negative, distinct
  from which classes have positive boxes (always trustworthy).
- **Cohort scope:** a Phase-12A classification of a visual group's
  annotation coverage (EYE / YAWN / ALL / AMBIGUOUS / BG_ONLY).
- **Corroboration:** the requirement that a cheap candidate signal (hash or
  filename match) be confirmed against actual full-resolution pixel evidence
  before being treated as proof of duplication or identity.

---

## Appendix C — Manifest and Report Schemas (pre-deletion snapshot)

Captured immediately before the post-certification directory cleanup (§1.6)
so the *shape* of the data survives even though the row-level content of the
larger files does not.

### `manifests/final_manifest.csv` — 57,098 rows (one per original corpus image)

`image_path, label_path, split, final_split, stem, group_id, merged_unit_id,
cohort_scope, tier, n_box, has0, has1, has2, sup_0, sup_1, sup_2, sup_mask,
n_sup, is_bg, cleaning_status, reason, human_review_decision,
decision_meaning, reason_selected`

The single widest audit-trail artifact in the project: every image's
provenance, supervision, cleaning decision, and human-review status in one
row.

### `manifests/supervision_manifest.csv` — 57,098 rows

`split, stem, proposed_split, unit_id, group_id, tier, fam, cohort_scope,
both_share, n_box, has0, has1, has2, sup_0, sup_1, sup_2, sup_mask, n_sup,
is_bg`

The Phase 12A source-aware supervision record (Chapter VI): which classes'
*absence* is trustworthy per image.

### `manifests/split_manifest.csv` — 57,098 rows

`orig_split, stem, file, unit_id, merged_unit_id, group_id, n_box, has0,
has1, has2, is_bg, final_split`

The Phase 13/14/H5 train/val/test assignment record (Chapters IX, X, XIII).

### `manifests/cleaning_manifest.csv` — 57,098 rows

`split, stem, file, final_split, decision, reason`

The Phase 15 per-image KEEP / QUARANTINE / REMOVE decision record
(Chapter XI).

### `manifests/cohort_scope.csv` — 23,505 rows (one per Phase-4 visual group)

`group_id, n, n_eye, n_yawn, n_both, both_share, cohort_scope, conf_eye,
conf_yawn`

The Phase 12A cohort-level annotation-scope classification (Chapter VI, §2).

### `manifests/unit_merge_map.csv` — 57,098 rows

`split, stem, file, unit_id, merged_unit_id, group_id, rfbase`

The Phase 12D split-atom construction record (Chapter VIII).

### `manifests/multi_box_review_manifest.csv` — 275 rows

`review_id, image_path, label_path, split, stem, n_closed_eye, n_open_eye,
n_eye, n_yawning, reason_excess_eye, reason_excess_yawn, reason, group_id,
merged_unit_id, source_prefix`

The Chapter XIV multi-box human review case list. Decisions themselves
(`manifests/multi_box_human_review.json`) recorded review_id, decision
(A/B/C/D), note, and timestamp per case — see Chapter XIV for the full
224/51/0/0 outcome.

### `reports/` — report index

Numbered phase reports (`07_small_object_analysis.md` through
`H9_H10_augmentation_balance.md`) and their supporting CSVs/contact sheets —
every finding they contain is narrated in the corresponding chapter above
(see the phase-to-chapter mapping in the Table of Contents). Notable
supporting CSVs, for the record: `03_exact_duplicate_groups.csv`,
`04_near_duplicates.csv`, `07_bbox_statistics.csv`, `08d_annotation_
adjudication.csv` (56,901 rows, the Phase 8 four-way adjudication), `H3_
anatomical_sanity.csv` (the 275-image excess-box list before human review),
`dataset_statistics.csv`, `class_distribution_report.md`.

### `review/` — human review package index

`review.html` (the review tool itself — full source in Appendix D),
`review_cases.csv` (430-case master list), `decisions/decisions_joined.csv`
(430 rows: decision + note + full case metadata), `decisions/
decision_stats.csv`, `decisions/decision_validation.csv`, `decisions/
rotation_confound.csv`, `images/R####.jpg` (430 rendered case images — not
preserved), `sheets/*.jpg` (13 stratum contact sheets — not preserved).

---

## Appendix D — Pointer to the Full Source-Code Archive

The complete, verbatim source of every pipeline script (55 `.py` files) plus
the `review.html` review tool is preserved in a separate file, kept apart
from this book because of its length:

**`C:\ssd projects\nano big\data\Dataset-Main\OVERVIEW_DATASET_AND_ SOURCE_CODE_ARCHIVE.md`**

(moved from `INFO/` into the dataset directory itself, so it travels with
the dataset)

It is organized alphabetically by filename (which, given the `pNN_`/`hNN_`
naming convention used throughout the project, is also close to
chronological order). Cross-reference against Appendix A or the chapter
narratives above to find which script implements which decision.
