"""
train.py -- YOLO26n / YOLO11n Training Runner (Driver Drowsiness Detector)
============================================================================
Project : nano big -- driver drowsiness detection (closed_eye/open_eye/yawning)

Rewritten per INFO/BOOK.md Chapter 2 (Full Project Plan), sections 2.3
(Training Strategy), 2.4 (Augmentation Strategy), 2.5 (Hyperparameter
Strategy), 2.9 (Experiment Plan), 2.10 (Src/ Refactor Plan).

What changed from the original, and why
----------------------------------------
- --data now defaults to data/Dataset-Main/data.yaml (the actual dataset;
  the old default pointed at a root dataset.yaml that has never existed
  in this project).
- amp defaults to True, not False -- the RTX 2000 Ada supports mixed
  precision natively; disabling it only cost training speed/memory
  headroom for no accuracy benefit (Ch.2 SS2.3/2.5).
- imgsz defaults to 960, not 384 -- justified by this dataset's own
  box-size statistics (Ch.2 SS2.3 SS1, BOOK.md Chapter II): open_eye is
  the binding small-object class and 960 captures the large majority of
  the achievable recall improvement over 640.
- epochs defaults to 150 with patience=30, not epochs=40/patience=10 --
  40 epochs is too low a budget for a from-pretrained nano model on
  ~39.6k training images to be a trustworthy baseline (Ch.2 SS2.9,
  Experiment 0).
- lr0 defaults to 0.01 (Ultralytics' own nano default), not 0.002 --
  the old value was never validated against the default, only assumed
  (Ch.2 SS2.5).
- The augmentation defaults are no longer "worst-case everything"
  (mosaic=1.0, hsv_v=0.5, erasing=0.4, degrees=20, mixup=0.1). They are
  now the realism-gated policy from Ch.2 SS2.4: mosaic and mixup off by
  default (physically-implausible composite scenes for a close-up
  face/eye/mouth task and specifically harmful to the small open_eye
  class), rotation reduced (this dataset already has 40.5% baked-in real
  rotation, Chapter V), erasing reduced sharply (risks erasing the
  already-small open_eye region by chance). Every value stays a CLI flag
  so Experiment 2's augmentation A/B (Ch.2 SS2.9) needs no code edits.
- Default weights are now the official pretrained nano checkpoints
  (yolo26n.pt / yolo11n.pt) fetched by Ultralytics itself, not a
  hardcoded path into a checkpoints/ tree that does not exist in this
  project (that tree belonged to a prior, different project copy).
- Output goes to checkpoints/<family>/<N>-<name>/ (best.pt, last.pt,
  run_config.json, plus Ultralytics' own results.csv/plots), NOT runs/ and
  NOT info/. <family> is inferred from --weights (e.g. "yolo26n" from
  "yolo26n.pt") or set explicitly with --family. <N> auto-increments per
  family by scanning existing checkpoints/<family>/ subfolders, so
  re-running the same family with a different augmentation policy lands in
  a new numbered experiment under the SAME family folder, and a different
  family gets its own top-level folder. This is the project's one
  "favorite structure" convention -- see AGENTS.md and BOOK.md Ch.2 SS2.10.
  (Earlier draft used info/ as an output root -- that is the SAME
  directory as INFO/ on this case-insensitive Windows filesystem, which
  holds BOOK.md; checkpoints/ was chosen specifically to not collide.)
- Every experiment's fully-resolved configuration (every hyperparameter
  actually used, not just what was passed on the CLI) is now written to
  <run_dir>/run_config.json, so any run is independently reproducible
  from that file alone, and progress reports can be generated from it
  without re-deriving values from memory (Ch.2 SS2.9/2.10).
- --config accepts a YAML file (see configs/*.yaml) whose keys pre-fill
  these same CLI arguments; explicit CLI flags still override it. This
  is what lets configs/yolo26n_baseline.yaml and
  configs/yolo11n_baseline.yaml be run with no other flags.

Usage
-----
  python src/train.py --config configs/yolo26n_baseline.yaml
  python src/train.py --weights yolo11n.pt --name baseline --imgsz 640   # ad hoc override
"""

import os
import re
import shutil
import sys

os.environ["TQDM_DISABLE"] = "1"

import argparse
import json
import logging
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

os.system("")
os.environ["COLUMNS"] = "250"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
os.chdir(PROJECT_ROOT)
sys.path.insert(0, str(PROJECT_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

DEFAULT_DATA_YAML = PROJECT_ROOT / "data" / "Dataset-Main" / "data.yaml"
CHECKPOINTS_ROOT = PROJECT_ROOT / "checkpoints"

_FAMILY_RE = re.compile(r"(yolo\d+[nsmlx])", re.IGNORECASE)


def infer_family(weights: str) -> str:
    """
    Extract a model-family folder name (e.g. "yolo26n", "yolo11n") from a
    weights string, whether it's a bare pretrained name ("yolo26n.pt") or a
    path to a prior run's checkpoint (".../checkpoints/yolo26n/2-.../best.pt").
    Falls back to the file stem if no yoloNN[nsmlx] pattern is found.
    """
    m = _FAMILY_RE.search(str(weights))
    if m:
        return m.group(1).lower()
    return Path(weights).stem


def next_experiment_dir(family: str, slug: str) -> Path:
    """
    checkpoints/<family>/<N>-<slug>, where N auto-increments per family by
    scanning existing "<N>-*" subfolders (BOOK.md Ch.2 SS2.10 folder
    convention). Two different augmentation policies for the same family
    land in the same family folder as separate numbered experiments; a
    different family gets its own top-level folder.
    """
    family_dir = CHECKPOINTS_ROOT / family
    family_dir.mkdir(parents=True, exist_ok=True)
    existing = []
    for d in family_dir.iterdir():
        if d.is_dir():
            m = re.match(r"(\d+)-", d.name)
            if m:
                existing.append(int(m.group(1)))
    next_num = max(existing, default=0) + 1
    return family_dir / f"{next_num}-{slug}"


def parse_args():
    parser = argparse.ArgumentParser(
        description="YOLO26n/YOLO11n Training Runner -- Driver Drowsiness Detector",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    parser.add_argument("--config", type=str, default=None,
                         help="YAML file whose keys pre-fill these CLI args "
                              "(e.g. configs/yolo26n_baseline.yaml). "
                              "Explicit CLI flags override values from this file.")

    parser.add_argument("--weights", type=str, default="yolo26n.pt",
                         help="Initial weights: yolo26n.pt or yolo11n.pt "
                              "(official Ultralytics pretrained, auto-downloaded), "
                              "or a path to a prior run's best.pt to resume/fine-tune from")
    parser.add_argument("--data", type=str, default=str(DEFAULT_DATA_YAML),
                         help="Path to data.yaml")
    parser.add_argument("--family", type=str, default=None,
                         help="Model family folder under checkpoints/ (e.g. yolo26n). "
                              "Default: inferred from --weights.")
    parser.add_argument("--name", type=str, default="baseline",
                         help="Short experiment slug (e.g. 'baseline', 'worst-case-augmentation'). "
                              "Gets an auto-incremented '<N>-' prefix per family -- see "
                              "checkpoints/<family>/<N>-<name>/ in BOOK.md Ch.2 SS2.10.")
    parser.add_argument("--project", type=str, default=None,
                         help="Advanced/power-user override: exact output directory, bypassing the "
                              "checkpoints/<family>/<N>-<name> auto-numbering entirely.")
    parser.add_argument("--epochs", type=int, default=150, help="Total training epochs")
    parser.add_argument("--imgsz", type=int, default=960,
                         help="Input resolution -- see BOOK.md Ch.2 SS2.3 for why 960, not 640 or 1200")
    parser.add_argument("--batch", type=int, default=32, help="Batch size")
    parser.add_argument("--lr0", type=float, default=0.01, help="Initial learning rate")
    parser.add_argument("--lrf", type=float, default=0.01, help="Final LR as a fraction of lr0")
    parser.add_argument("--patience", type=int, default=30, help="Early stopping patience (epochs)")
    parser.add_argument("--device", default=0, help="CUDA device index (0) or 'cpu'")
    parser.add_argument("--workers", type=int, default=2, help="Dataloader worker threads")
    parser.add_argument("--amp", type=lambda s: s.lower() != "false", default=True,
                         help="Automatic mixed precision (True/False) -- default True, RTX 2000 Ada supports it natively")
    parser.add_argument("--optimizer", type=str, default="auto",
                         help="Ultralytics optimizer selection. 'auto' picks by iteration count "
                              "(ceil(train_imgs/batch)*epochs) -- at this dataset's scale that resolves "
                              "to MuSGD, not AdamW (verified from Ultralytics source + Experiment 1's "
                              "results.csv, BOOK.md Ch.3 SS3.1). IMPORTANT: 'auto' ALSO ignores --lr0/"
                              "--momentum entirely and hardcodes lr=0.01, momentum=0.9 -- pass an explicit "
                              "optimizer name (e.g. 'MuSGD') if --lr0/--momentum need to actually take effect.")
    parser.add_argument("--cos_lr", type=lambda s: s.lower() != "false", default=True, help="Cosine LR schedule")
    parser.add_argument("--momentum", type=float, default=0.9,
                         help="Optimizer momentum -- default 0.9 matches what Experiment 1's 'auto' actually "
                              "resolved to (not the 0.937 that was configured but silently ignored, "
                              "BOOK.md Ch.3 SS3.1). Only takes effect with an explicit (non-'auto') optimizer.")
    parser.add_argument("--warmup_epochs", type=float, default=3.0,
                         help="LR warmup duration -- Ultralytics default (3.0) is sized for training from "
                              "random/COCO-pretrained init. A short fine-tune from an already-converged "
                              "checkpoint (e.g. --weights .../best.pt) doesn't need a full from-scratch "
                              "warmup ramp eating into a small epoch budget; lower this explicitly for that case.")

    parser.add_argument("--box", type=float, default=7.5, help="Box loss weight (Ultralytics default, not tuned)")
    parser.add_argument("--cls", type=float, default=0.5, help="Classification loss weight (Ultralytics default, not tuned)")
    parser.add_argument("--dfl", type=float, default=1.5, help="DFL loss weight (Ultralytics default, not tuned)")

    # Augmentation -- realism-gated policy, BOOK.md Ch.2 SS2.4. Every value is a
    # flag on purpose: Experiment 2 (Ch.2 SS2.9) A/B-tests exactly these.
    parser.add_argument("--hsv_h", type=float, default=0.015, help="Hue jitter")
    parser.add_argument("--hsv_s", type=float, default=0.5, help="Saturation jitter")
    parser.add_argument("--hsv_v", type=float, default=0.4, help="Brightness/value jitter (real lighting variation)")
    parser.add_argument("--degrees", type=float, default=10.0,
                         help="Rotation degrees -- reduced from the old 20 default; "
                              "40.5%% of this dataset already has real baked-in rotation (BOOK.md Chapter V)")
    parser.add_argument("--translate", type=float, default=0.1, help="Translation fraction")
    parser.add_argument("--scale", type=float, default=0.4, help="Scale jitter")
    parser.add_argument("--shear", type=float, default=2.0,
                         help="Shear degrees -- reduced from the old 5.0; a driver-facing camera has near-fixed geometry")
    parser.add_argument("--perspective", type=float, default=0.0,
                         help="Perspective warp -- off by default, no realistic driver-camera analogue at nonzero strength")
    parser.add_argument("--fliplr", type=float, default=0.5, help="Horizontal flip probability")
    parser.add_argument("--flipud", type=float, default=0.0,
                         help="Vertical flip probability -- OFF by default and expected to stay off: "
                              "a driver-facing camera is never upside-down in production, so training "
                              "on flipped-vertical frames teaches a physically impossible case")
    parser.add_argument("--cutmix", type=float, default=0.0,
                         help="CutMix probability -- OFF by default (Ch.2 SS2.4: image-combining "
                              "augmentation, same source-aware-label conflict as mosaic/mixup)")
    parser.add_argument("--mosaic", type=float, default=0.0,
                         help="Mosaic probability -- OFF by default (Ch.2 SS2.4: manufactures physically implausible "
                              "multi-face composites and hurts small open_eye boundaries). "
                              "Experiment 2 tests a low nonzero value as the alternative.")
    parser.add_argument("--close_mosaic", type=int, default=10,
                         help="Disable mosaic for the final N epochs, if mosaic>0 (standard practice)")
    parser.add_argument("--mixup", type=float, default=0.0,
                         help="Mixup probability -- OFF by default (Ch.2 SS2.4: no realistic analogue, blurs sharp small-object edges)")
    parser.add_argument("--copy_paste", type=float, default=0.0,
                         help="Copy-paste probability -- OFF by default (Ch.2 SS2.4: compositing artifacts, not needed at this box count)")
    parser.add_argument("--erasing", type=float, default=0.0,
                         help="Random erasing probability -- OFF by default (Ch.2 SS2.4: risks erasing the small "
                              "open_eye region by chance; was 0.4 in the old 'worst-case' policy)")
    parser.add_argument("--auto_augment", type=str, default="randaugment",
                         help="Ultralytics classification-style auto-augment policy (randaugment/autoaugment/"
                              "augmix/None) -- closest available lever for contrast/blur-adjacent single-image "
                              "variation; Ultralytics has no standalone --blur or --contrast argument")

    parser.add_argument("--resume", action="store_true", help="Resume training from last.pt checkpoint")
    args = parser.parse_args()

    explicit = {a.dest for a in parser._actions
                if any(o in sys.argv for o in a.option_strings)}

    if args.config:
        import yaml
        cfg_path = Path(args.config)
        if not cfg_path.is_absolute():
            cfg_path = PROJECT_ROOT / cfg_path
        if not cfg_path.exists():
            raise FileNotFoundError(f"--config file not found: {cfg_path}")
        with open(cfg_path, "r", encoding="utf-8") as fh:
            cfg = yaml.safe_load(fh) or {}
        for k, v in cfg.items():
            if hasattr(args, k) and k not in explicit:
                setattr(args, k, v)
        # A value written in a --config file is as deliberate as one typed on the
        # CLI; both must survive the resume filter below.
        explicit |= {k for k in cfg if hasattr(args, k)}

    args.family = args.family or infer_family(args.weights)
    args.explicit = explicit

    if "last.pt" in Path(args.weights).name.lower():
        args.resume = True

    if args.project is not None:
        pass  # --project given explicitly, used as-is (power-user escape hatch).
    elif args.resume:
        # Resuming must land back in the checkpoint's OWN run folder. Auto-numbering
        # here instead would mint a new empty <N>-<name>/ every resume, sending
        # training.log there while Ultralytics writes results.csv and the weights to
        # the original folder (it restores save_dir from the checkpoint) -- which is
        # how a crashed resume ends up leaving no traceback anywhere anyone looks.
        ckpt = Path(args.weights).resolve()
        run_dir = ckpt.parent.parent if ckpt.parent.name == "weights" else ckpt.parent
        args.project = str(run_dir.parent)
        args.name = run_dir.name
    else:
        # Standard path: checkpoints/<family>/<N>-<name>/, auto-numbered.
        exp_dir = next_experiment_dir(args.family, args.name)
        args.project = str(exp_dir.parent)
        args.name = exp_dir.name

    return args


def train():
    args = parse_args()

    # Persist the full run to disk, not just the terminal -- previously nothing
    # but results.csv (epoch-level numbers) survived after the terminal scrolled
    # or the window closed; all per-run text (header, hyperparams, per-epoch
    # summaries) is now captured here too.
    save_dir_preview = Path(args.project) / args.name
    save_dir_preview.mkdir(parents=True, exist_ok=True)
    file_handler = logging.FileHandler(save_dir_preview / "training.log", encoding="utf-8")
    file_handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
    logging.getLogger().addHandler(file_handler)

    try:
        import ultralytics.utils.tqdm
        _orig_tqdm_init = ultralytics.utils.tqdm.TQDM.__init__

        def silent_tqdm_init(self, *a, **kw):
            kw["disable"] = True
            _orig_tqdm_init(self, *a, **kw)

        ultralytics.utils.tqdm.TQDM.__init__ = silent_tqdm_init
        from ultralytics import YOLO
    except ImportError as exc:
        raise ImportError("ultralytics not installed. Run: pip install ultralytics") from exc

    if not Path(args.data).exists():
        raise FileNotFoundError(
            f"--data file not found: {args.data}\n"
            f"  Expected the dataset at: {DEFAULT_DATA_YAML}"
        )

    log.info("=" * 80)
    log.info(" YOLO TRAINING RUNNER -- DRIVER DROWSINESS DETECTOR")
    log.info("=" * 80)
    log.info("  Weights            : %s", args.weights)
    log.info("  Dataset            : %s", args.data)
    log.info("  Output             : %s/%s", args.project, args.name)
    log.info("  Resolution / Epochs: %dx%d | %d epochs | batch %d | patience %d",
              args.imgsz, args.imgsz, args.epochs, args.batch, args.patience)
    log.info("  Optimizer / LR     : %s | lr0=%.4f lrf=%.4f cos_lr=%s | AMP=%s",
              args.optimizer, args.lr0, args.lrf, args.cos_lr, args.amp)
    log.info("  Augmentation       : mosaic=%.2f mixup=%.2f copy_paste=%.2f erasing=%.2f degrees=%.1f",
              args.mosaic, args.mixup, args.copy_paste, args.erasing, args.degrees)
    log.info("=" * 80)

    model = YOLO(args.weights)

    def on_train_start(trainer):
        # Exp1 post-mortem gap: args.yaml only ever records the literal string
        # "auto", never what Ultralytics actually resolved it to -- optimizer
        # choice ended up NOT VERIFIED / NOT RECOVERABLE after the fact. The
        # real object exists by this callback (_setup_train runs before
        # on_train_start), so log its concrete class + resolved LR/momentum
        # once here, to a file, instead of re-guessing after the run ends.
        opt = getattr(trainer, "optimizer", None)
        if opt is not None:
            pg0 = opt.param_groups[0]
            log.info(
                "Resolved optimizer: %s | lr=%.6f momentum/beta1=%s weight_decay=%s",
                type(opt).__name__, pg0.get("lr", float("nan")),
                pg0.get("momentum", pg0.get("betas")), pg0.get("weight_decay"),
            )

    batch_counter = 0

    def on_train_epoch_start(trainer):
        nonlocal batch_counter
        batch_counter = 0

    def on_train_batch_end(trainer):
        nonlocal batch_counter
        batch_counter += 1
        epoch = trainer.epoch + 1
        epochs = trainer.epochs
        total_batches = len(trainer.train_loader)
        loss_items = getattr(trainer, "loss_items", [0.0, 0.0, 0.0])
        if hasattr(loss_items, "tolist"):
            loss_items = loss_items.tolist()
        box = loss_items[0] if len(loss_items) > 0 else 0.0
        cls = loss_items[1] if len(loss_items) > 1 else 0.0
        dfl = loss_items[2] if len(loss_items) > 2 else 0.0
        progress_str = f"Epoch [{epoch}/{epochs}] Batch [{batch_counter}/{total_batches}] | Box: {box:.3f} | Cls: {cls:.3f} | DFL: {dfl:.3f}"
        # Real terminal width, re-checked every batch. os.environ["COLUMNS"]
        # above does NOT resize the actual console -- it only affects argparse's
        # help formatter. If the real window is narrower than progress_str, the
        # line wraps to 2 rows and `\r` only rewinds to the wrapped row, leaving
        # the first row's text stuck forever (the "thousands of permanent
        # lines" bug). Clamping our own output to the real width prevents wrap.
        width = shutil.get_terminal_size(fallback=(120, 20)).columns
        progress_str = progress_str[:max(width - 1, 10)]
        sys.stdout.write(f"\r\033[K{progress_str}")
        sys.stdout.flush()

    def on_fit_epoch_end(trainer):
        # Fires after validation (unlike on_train_epoch_end, which only sees
        # train loss) -- this is the one place both train loss and val metrics
        # are available together, so the whole epoch fits in a single clean
        # block instead of two separate prints (our old summary + Ultralytics'
        # own "all <n> <n> P R mAP50 mAP50-95" line).
        epoch = trainer.epoch + 1
        epochs = trainer.epochs
        tloss = getattr(trainer, "tloss", None)
        loss_names = getattr(trainer, "loss_names", ["box_loss", "cls_loss", "dfl_loss"])
        if hasattr(tloss, "tolist"):
            tloss = tloss.tolist()
        elif tloss is None:
            tloss = [0.0] * len(loss_names)
        loss_str = " ".join(f"{n.replace('_loss', '').title()}={v:.4f}" for n, v in zip(loss_names, tloss))

        m = getattr(trainer, "metrics", {}) or {}
        p = m.get("metrics/precision(B)", float("nan"))
        r = m.get("metrics/recall(B)", float("nan"))
        map50 = m.get("metrics/mAP50(B)", float("nan"))
        map5095 = m.get("metrics/mAP50-95(B)", float("nan"))
        best_fitness = getattr(trainer, "best_fitness", None)
        best_str = f"{float(best_fitness):.4f}" if best_fitness is not None else "n/a"

        # Clear any stale progress-line remnant before printing the summary block.
        sys.stdout.write("\r\033[K")
        sys.stdout.flush()
        log.info(
            "Epoch %d/%d done\n"
            "  Train: %s\n"
            "  Val:   P=%.4f R=%.4f mAP50=%.4f mAP50-95=%.4f\n"
            "  Best fitness so far: %s",
            epoch, epochs, loss_str, p, r, map50, map5095, best_str,
        )

    model.add_callback("on_train_start", on_train_start)
    model.add_callback("on_train_epoch_start", on_train_epoch_start)
    model.add_callback("on_train_batch_end", on_train_batch_end)
    model.add_callback("on_fit_epoch_end", on_fit_epoch_end)

    start_time = time.time()

    train_kwargs = dict(
        data=args.data,
        project=args.project,
        name=args.name,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        patience=args.patience,
        optimizer=args.optimizer,
        lr0=args.lr0,
        lrf=args.lrf,
        cos_lr=args.cos_lr,
        momentum=args.momentum,
        weight_decay=0.0005,
        warmup_epochs=args.warmup_epochs,
        box=args.box,
        cls=args.cls,
        dfl=args.dfl,
        amp=args.amp,
        hsv_h=args.hsv_h,
        hsv_s=args.hsv_s,
        hsv_v=args.hsv_v,
        degrees=args.degrees,
        translate=args.translate,
        scale=args.scale,
        shear=args.shear,
        perspective=args.perspective,
        fliplr=args.fliplr,
        flipud=args.flipud,
        mosaic=args.mosaic,
        close_mosaic=args.close_mosaic,
        mixup=args.mixup,
        cutmix=args.cutmix,
        copy_paste=args.copy_paste,
        erasing=args.erasing,
        auto_augment=args.auto_augment,
        device=args.device,
        workers=args.workers,
        verbose=False,
        resume=args.resume,
        exist_ok=True,
    )

    if args.resume:
        # Ultralytics' resume path (engine/trainer.py:886-904) reloads the whole arg
        # namespace from the checkpoint, then lets a 13-key allow-list be overridden
        # by whatever the caller passed. Since every value above is passed
        # unconditionally, an argparse DEFAULT nobody typed silently wins over the
        # checkpoint: this is how the yolo26s run resumed at batch 32 instead of the
        # batch 12 it trained at, tripling VRAM on a 16GB card (BOOK.md D15).
        # Forward only what was actually asked for; let the checkpoint supply the rest.
        for k in ("imgsz", "batch", "device", "close_mosaic", "workers", "patience"):
            if k not in args.explicit:
                train_kwargs.pop(k, None)
        log.info("Resuming -- forwarding only explicit overrides: %s",
                 sorted(args.explicit & {"imgsz", "batch", "device", "close_mosaic",
                                         "workers", "patience"}) or "none")

    results = model.train(**train_kwargs)
    end_time = time.time()

    save_dir = Path(args.project) / args.name

    # Ultralytics writes weights to <save_dir>/weights/{best,last}.pt. Flatten
    # them up to <save_dir>/best.pt directly, matching the project's
    # checkpoints/<family>/<N>-<name>/best.pt convention (BOOK.md Ch.2
    # SS2.10) so export.py/evaluate.py/demo_video.py all find the checkpoint
    # at a single predictable path with no "weights/" subfolder to know about.
    weights_dir = save_dir / "weights"
    for fname in ("best.pt", "last.pt"):
        src = weights_dir / fname
        if src.exists():
            shutil.move(str(src), str(save_dir / fname))
    try:
        if weights_dir.exists() and not any(weights_dir.iterdir()):
            weights_dir.rmdir()
    except OSError:
        pass

    # Full resolved config, for independent reproducibility of this exact run.
    run_config = {k: (sorted(v) if isinstance(v, set) else str(v) if isinstance(v, Path) else v)
                  for k, v in vars(args).items()}
    run_config["total_train_seconds"] = round(end_time - start_time, 1)
    metrics_dict = getattr(results, "results_dict", {})
    run_config["final_metrics"] = {
        "mAP50": metrics_dict.get("metrics/mAP50(B)", 0.0),
        "mAP50-95": metrics_dict.get("metrics/mAP50-95(B)", 0.0),
        "precision": metrics_dict.get("metrics/precision(B)", 0.0),
        "recall": metrics_dict.get("metrics/recall(B)", 0.0),
    }
    try:
        with open(save_dir / "run_config.json", "w", encoding="utf-8") as f:
            json.dump(run_config, f, indent=2)
        log.info("Saved run_config.json -> %s", save_dir / "run_config.json")
    except Exception as exc:
        log.warning("Could not write run_config.json: %s", exc)

    # Human-readable sibling to run_config.json -- run_config.json has every
    # value but isn't meant to be opened and read by a person. This is the
    # automatic version of what was hand-written for Exp1
    # (experiment_1_summary.txt): a short, at-a-glance record of what this
    # run actually was and how it did, without needing to cross-reference
    # args.yaml/results.csv/a checkpoint's embedded metadata after the fact.
    try:
        fm = run_config["final_metrics"]
        # Epochs actually completed can be < args.epochs (early stop via
        # patience) -- read it back from results.csv rather than assuming
        # the planned count, so the per-epoch average is real, not inflated.
        epochs_completed = args.epochs
        try:
            csv_path = save_dir / "results.csv"
            if csv_path.exists():
                rows = csv_path.read_text(encoding="utf-8").strip().splitlines()
                if len(rows) > 1:
                    epochs_completed = int(float(rows[-1].split(",")[0]))
        except Exception:
            pass
        avg_epoch_seconds = run_config["total_train_seconds"] / max(epochs_completed, 1)
        summary_lines = [
            f"{args.family} -- {args.name}",
            "=" * 60,
            "",
            f"Weights (start)     : {args.weights}",
            f"Data                : {args.data}",
            f"Epochs completed    : {epochs_completed} (planned: {args.epochs})   Patience: {args.patience}",
            f"Image size          : {args.imgsz}",
            f"Batch               : {args.batch}",
            f"Total train time    : {run_config['total_train_seconds']:.1f}s "
            f"({run_config['total_train_seconds']/3600:.2f}h)",
            f"Avg time / epoch    : {avg_epoch_seconds:.1f}s ({avg_epoch_seconds/60:.2f}min)",
            "",
            "-- Optimizer / LR --",
            f"Optimizer           : {args.optimizer}",
            f"lr0 / lrf           : {args.lr0} / {args.lrf}",
            f"momentum            : {args.momentum}",
            f"warmup_epochs       : {args.warmup_epochs}",
            f"cos_lr              : {args.cos_lr}",
            "",
            "-- Loss weights --",
            f"box / cls / dfl     : {args.box} / {args.cls} / {args.dfl}",
            "",
            "-- Augmentation --",
            f"hsv_h / hsv_s / hsv_v : {args.hsv_h} / {args.hsv_s} / {args.hsv_v}",
            f"degrees             : {args.degrees}",
            f"translate           : {args.translate}",
            f"scale               : {args.scale}",
            f"shear               : {args.shear}",
            f"perspective         : {args.perspective}",
            f"fliplr / flipud     : {args.fliplr} / {args.flipud}",
            f"erasing             : {args.erasing}",
            f"auto_augment        : {args.auto_augment}",
            f"mosaic / mixup      : {args.mosaic} / {args.mixup}",
            f"cutmix / copy_paste : {args.cutmix} / {args.copy_paste}",
            "",
            "-- Final metrics --",
            f"mAP50               : {fm['mAP50']:.4f}",
            f"mAP50-95            : {fm['mAP50-95']:.4f}",
            f"Precision           : {fm['precision']:.4f}",
            f"Recall              : {fm['recall']:.4f}",
        ]
        with open(save_dir / "summary.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(summary_lines) + "\n")
        log.info("Saved summary.txt -> %s", save_dir / "summary.txt")
    except Exception as exc:
        log.warning("Could not write summary.txt: %s", exc)

    log.info("\n" + "=" * 80)
    log.info("TRAINING COMPLETE")
    log.info("   Results: %s", save_dir)
    log.info("   mAP50=%.4f  mAP50-95=%.4f  P=%.4f  R=%.4f",
              run_config["final_metrics"]["mAP50"], run_config["final_metrics"]["mAP50-95"],
              run_config["final_metrics"]["precision"], run_config["final_metrics"]["recall"])
    log.info("=" * 80 + "\n")

    return results


if __name__ == "__main__":
    train()
