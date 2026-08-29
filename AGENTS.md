# AGENTS.md — Instructions for AI Agents Working in This Repo

This file is the standing contract for any AI coding agent (Claude Code or
otherwise) working in this project. Read it before making changes. Its job
is to keep every future session aligned with the plan that's already been
researched and approved — not to re-litigate decisions or wander into
adjacent work that wasn't asked for.

## Current Status (update this section whenever the state changes)

**As of 2026-08-17: eight runs complete. Best real test-split mAP50 is a
three-way statistical tie at ~82.7% (Exp4 82.75%, Exp2 82.73%, D16 82.73%) —
inside the noise floor this project cannot resolve (BOOK.md D13). Every
nano-scale lever is now closed: loss balance (D11/D12), dataset defects
(D10, all three rejected), capacity (D16, yolo11n ties yolo26n at 4x the
size and 41h). The one open lead is D18 — a cross-dataset warm start from
the prior project's YOLOv11m — which reached val mAP50 0.9130 / mAP50-95
0.5932 in 15 epochs, far above anything else here, but its real test-split
number has NOT been measured yet and val has historically overstated test by
5-6pt. yolo26s (D15) is unresolved: five failed attempts, root cause finally
identified (see below), restarting fresh. GPU idle, nothing running.**

- **`src/train.py` resume was silently corrupting runs (fixed 2026-08-17).**
  It forwarded every argparse default into `model.train()`, and Ultralytics'
  resume path lets a 13-key allow-list — `batch` included — override the
  checkpoint (`engine/trainer.py:886-904`). A resume without `--config`/
  `--batch` therefore restarted yolo26s's batch-12 run at batch 32, which on
  a 16GB card spills into system RAM under Windows/WDDM instead of raising
  OOM (validation runs at `batch*2`, `trainer.py:277`) — a 4h26m epoch
  against a 28min baseline. It also minted a new numbered folder on every
  resume, splitting `training.log` away from `results.csv`, which is why four
  consecutive failures left no traceback. Both fixed; resume now reuses the
  checkpoint's folder and forwards only explicitly-set overrides.
  **When resuming, always pass `--config` (or the explicit flags).**

- All `src/` scripts are rewritten, renamed, and flattened into one folder
  (no `tests/`/`reports/` subfolders — user's explicit "less files/folders
  is better" preference). See `src/SCRIPTS_OVERVIEW.txt` for what each one
  does.
- The `checkpoints/<family>/<N>-<model>-<imgsz>-<aug-level>/` + matching
  `INFO/<family>/<same-name>-test-result/` folder convention — the "Order
  Rule" (see below) — is fully wired into `train.py`, `export.py`,
  `evaluate.py`, `demo_video.py`.
- `src/train.py` had a real bug (found during the Experiment 1 post-mortem,
  now fixed): its per-batch progress line used a raw `\r` update sized
  against an env var that doesn't control the actual terminal width,
  causing thousands of stuck lines on a narrow window. Fixed with
  `shutil.get_terminal_size()`; epoch-end output now also includes
  validation metrics (previously train-loss-only) and persists to
  `<run_dir>/training.log`, not just the terminal. New CLI flags added
  along the way: `--flipud`, `--cutmix`, `--momentum`, `--warmup_epochs`,
  `--auto_augment` (the last three previously hardcoded or entirely
  unwired). Every run now also gets an automatic `<run_dir>/summary.txt`
  (hyperparameters, augmentation, total + per-epoch timing, final
  metrics) — see the Order Rule below.

**Three experiments complete — real test-split + video results, full
detail in BOOK.md Ch.3 §3.5:**

| | Exp1 | Exp2 | Exp3 |
|---|---|---|---|
| Folder | `1-baseline-yolo26n-960-mild-aug` | `2-finetune-yolo26n-960-moderate-aug` | `3-fresh-yolo26n-640-worst-aug` |
| Weights | fresh | Exp1's `best.pt` | fresh |
| imgsz | 960 | 960 | 640 |
| Optimizer | `auto`→MuSGD | AdamW | AdamW |
| Val mAP50-95 | 0.53175 (best val, misleading) | 0.5288 | 0.5128 |
| **Real test mAP50** | 79.55% (worst) | **82.33% (best)** | 81.02% |
| Video FPS (same clip) | 72.4 (slowest) | 78.2 | **88.9 (fastest)** |

All three registered in `configs/checkpoints.yaml`
(`yolo26n-1-baseline`/`yolo26n-2-finetune`/`yolo26n-3-fresh-640`) so
`evaluate.py --model all` / `demo_video.py --model all` work by key.

- `configs/yolo26n_worst_case_aug.yaml` — prepared, dry-run verified,
  **never run** (superseded by the fine-tune direction that became Exp2).
  BOOK.md Ch.3 §3.2.
- `configs/yolo26n_exp4_fresh_worst_case_480.yaml` — prepared, dry-run
  verified, **never run** (Exp3 finished at 09:56, past the user's 08:00
  auto-launch cutoff). Same design as Exp3 except imgsz=480.
- **For deployment**: Exp1 has no case going forward (worst on both
  accuracy and speed). Exp3 is the current recommended platform pick —
  ~14% faster than Exp2 for 1.3 points less real accuracy, same deployable
  size — but this isn't validated against real browser/ONNX/WebGPU
  latency yet (deployment optimization is gated per the Scope section
  below until a checkpoint is formally chosen).
- **Do not launch training on the user's behalf unless they explicitly ask
  you to** — the one exception (Exp3/Exp4 auto-launch chain, now finished)
  was a one-time, explicitly authorized exception, not a standing change to
  this rule.

## Project

**nano big** — a real-time, browser-deployable driver drowsiness detector.
Three classes: `closed_eye`, `open_eye`, `yawning`. Dataset is finished
(`data/Dataset-Main/`, 50,654 images / 68,292 boxes, certified
READY_FOR_TRAINING) and served via ONNX Runtime Web + WebGPU (WASM
fallback) once a model exists. Full research and planning lives in
`INFO/BOOK.md` — read it (especially Chapter 2) before making any
training/architecture/deployment decision. This file is the *behavioral*
contract; `BOOK.md` is the *technical* one.

## Scope — stay inside these lines

- **Models**: YOLO26n (primary) and YOLO11n (secondary baseline) only.
  YOLO12n is explicitly excluded on evidence (Ultralytics' own
  production-readiness guidance — attention-layer instability, memory,
  CPU speed), not by oversight. Do not add a third architecture, switch
  frameworks, or "just try" something outside this pair without the user
  asking for it by name.
- **Dataset**: `data/Dataset-Main/` and its labels are FROZEN. Never edit,
  regenerate, re-augment, or re-split it. Augmentation happens at
  train-time via `train.py`'s CLI flags, never by writing new files into
  `data/`.
- **Augmentation policy**: realism-gated (BOOK.md Ch.2 §2.4), not "standard
  Ultralytics defaults" and not the old "worst-case everything" policy.
  Mosaic/mixup/copy_paste off by default; erasing near-zero; rotation/shear
  reduced (this dataset already has ~40.5% real baked-in rotation). If a
  future session wants to test a more aggressive augmentation policy for
  comparison, that's a new *numbered experiment*, not a change to the
  baseline default.
- **Deployment optimization is gated**: do not move to ONNX/FP16/INT8
  export tuning, quantization calibration, or browser-benchmark work until
  the best PyTorch checkpoints across both model families have been
  identified through the experiment plan (BOOK.md Ch.2 §2.9). `export.py
  --precision int8` intentionally refuses to run for this reason — don't
  "fix" that by implementing INT8 early; ask the user first if they want to
  change that gate.

## Folder convention — the ORDER RULE (standing, 2026-08-13, BOOK.md Ch.3 §3.6)

Every experiment must be identifiable and understandable **from its folder
name and one file alone**, with no cross-referencing docs or other files
required. This replaced the original terse `<N>-<name>` scheme (e.g.
`1-baseline`) after real experience showed it wasn't enough to tell
folders apart at a glance once several experiments existed side by side.

```
checkpoints/<family>/<N>-<model>-<imgsz>-<aug-level>/
    best.pt, last.pt        <- train.py output (always flattened here,
                                never left under a weights/ subfolder)
    best.onnx, best.engine  <- export.py output (saved automatically here)
    run_config.json         <- full resolved hyperparameters + final metrics
    summary.txt              <- THE file to open for "what happened here":
                                 weights source, epochs completed/planned,
                                 total AND per-epoch time, full optimizer/LR/
                                 augmentation block, final metrics (val, and
                                 real test-split once measured). Written
                                 automatically by train.py at the end of
                                 every run.
    results.csv              <- Ultralytics' per-epoch metrics
    report/                   <- plot_training_curves.py output

INFO/<family>/<N>-<model>-<imgsz>-<aug-level>-test-result/
    tested-images/    <- evaluate.py output (test-split metrics + charts)
    tested-video/      <- demo_video.py output (one demo video)

INFO/_comparison/       <- compare_experiments.py output (cross-family)
```

Naming pieces:
- `<family>` = model family folder, e.g. `yolo26n`, `yolo11n` — inferred
  automatically from the weights filename.
- `<N>` auto-increments **per family**, starting at 1, via
  `next_experiment_dir()` in `train.py` (scans for a leading `\d+-` on
  existing folder names). This is why the numeric prefix is **mandatory**,
  not decorative — a folder name without it (e.g. a bare `Exp1-...`) is
  invisible to that scan and the next real run would silently restart
  numbering from 1, duplicating the concept of "run 1." Never hand-pick a
  number or drop the prefix.
- `<model>` — repeats the family name inside the slug (e.g. `yolo26n`) so
  the folder is self-describing even copied out of context.
- `<imgsz>` — always present now (e.g. `960`, `640`), not just when
  non-default.
- `<aug-level>` — a short, consistent word for the augmentation strength
  band actually used: `mild` / `moderate` / `worst` so far. Exact values
  live in `args.yaml`/`run_config.json`/`summary.txt`, not the folder name.

Example, current real folders: `1-baseline-yolo26n-960-mild-aug`,
`2-finetune-yolo26n-960-moderate-aug`, `3-fresh-yolo26n-640-worst-aug`.

Other rules:
- `INFO/<family>/<...>-test-result/` always mirrors the checkpoint folder's
  full name exactly — the two are meant to be found by matching, not by
  separate lookup.
- `INFO/` and `info/` are the SAME directory on this Windows filesystem
  (case-insensitive NTFS) — the one holding `BOOK.md`. Writing eval/demo
  output there is deliberate (the user asked for it), not a bug — just
  never name a new file/folder there that could collide with an existing
  planning doc filename (`BOOK.md`, `AUGMENTATION_STRATEGY.md`, etc.).
- Every `configs/*.yaml` training config's `name:` field must already
  follow this convention (minus the `<N>-` prefix, which `train.py` adds
  automatically) — so any future run of an existing prepared config
  produces a correctly-named folder without manual renaming afterward.
- Full script-by-script purpose reference: `src/SCRIPTS_OVERVIEW.txt`.

## Standing execution rules (apply to all training/experimentation work)

- Do not modify the final dataset or its labels.
- Do not delete existing source files without explicit confirmation from
  the user in the current conversation.
- Do not overwrite working scripts without a backup/version first — unless
  the repo state makes the backup redundant (e.g. the user has already
  confirmed the new version is good and the old one can go).
- Do not start expensive long-running training without first validating
  the configuration (dry-run the argument parsing / path logic, confirm
  CUDA is available, confirm disk space) — but do not launch training
  itself unless the user has explicitly asked you to; by default this
  project's owner starts training runs manually, in their own terminal.
- Never launch multiple GPU-heavy experiments simultaneously. Keep RAM
  usage controlled — never consume 100% of system RAM.
- Don't stop after the first successful run — the goal is the best
  accuracy/recall/latency/size tradeoff across both model families,
  found with the smallest number of experiments that can reliably
  identify it (BOOK.md Ch.2 §2.9, Experiment Plan). Don't run an
  experiment that can't move the Pareto frontier.
- After each experiment: validate, evaluate, record metrics, compare
  against prior experiments, and only run the next one if it's justified.
- If a planned experiment or an existing assumption turns out to be
  technically wrong, stop and say so before making a large change —
  don't silently route around it.
- Don't ask unnecessary questions during routine, already-approved
  execution — but do stop and ask when a decision is genuinely the user's
  to make (a real ambiguity, a destructive action, a scope change).

## Code quality expectations

- No fabricated data, ever. If a script can't compute a real number (no
  checkpoint trained yet, no eval run yet), it should say so explicitly
  and exit — never print/plot a placeholder that looks real.
- No comments explaining *what* code does (names should do that) — only
  *why*, when it's a non-obvious constraint, a workaround, or a decision
  someone would otherwise second-guess and redo.
- Prefer editing existing files over creating new ones. Don't add
  abstractions, config options, or "just in case" flexibility beyond what
  the current task needs.
- Every new script-level convention (a new output path, a new naming
  scheme) gets written down in this file or `src/SCRIPTS_OVERVIEW.txt` — not left
  implicit for the next session to rediscover.

## What NOT to do without being asked

- Don't start an unrelated task, redesign the dataset, or begin a
  different project.
- Don't add a new model family, a new deployment target, or a new
  optimization tier that wasn't part of the approved plan.
- Don't rename or restructure things again "for consistency" once a
  convention is established here — ask first if something seems wrong.
