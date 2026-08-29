"""
train.py
--------
Train the simplified Faster R-CNN.

Usage:
    python train.py --device cuda:0 --epochs 30 --batch-size 4

Workflow:
    build splits -> train loader + val loader
    for each epoch:
        train one epoch (log the 4 losses + total)
        validate (mAP@0.5)  [from evaluate.py]
        save 'last' checkpoint, and 'best' when val mAP improves
"""

import os
import csv
import argparse
import torch
from torch.utils.data import DataLoader

import config
from dataset import make_splits, load_split, DrowsinessDataset, collate_fn
from models.faster_rcnn import FasterRCNN
from utils.gpu_utils import select_device, print_gpu_memory, clear_cache
from evaluate import evaluate            # returns dict incl. "mAP@0.5"


def move_targets(targets, device):
    return [{"boxes": t["boxes"].to(device),
             "labels": t["labels"].to(device),
             "image_id": t["image_id"]} for t in targets]


def train_one_epoch(model, loader, optimizer, device, epoch):
    model.train()
    running = {"rpn_obj_loss": 0, "rpn_box_loss": 0,
               "det_cls_loss": 0, "det_box_loss": 0, "total": 0}

    for i, (images, targets) in enumerate(loader):
        images = images.to(device)
        targets = move_targets(targets, device)

        losses = model(images, targets)
        total = sum(losses.values())

        optimizer.zero_grad()
        total.backward()
        optimizer.step()

        for k in losses:
            running[k] += losses[k].item()
        running["total"] += total.item()

        if i % 20 == 0:
            msg = " | ".join(f"{k}:{v.item():.3f}" for k, v in losses.items())
            print(f"  epoch {epoch} [{i}/{len(loader)}] {msg} | total:{total.item():.3f}")

    n = len(loader)
    return {k: v / n for k, v in running.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default=None, help="cuda:0, cuda:1, cpu, or auto")
    ap.add_argument("--epochs", type=int, default=config.NUM_EPOCHS)
    ap.add_argument("--batch-size", type=int, default=config.BATCH_SIZE)
    ap.add_argument("--lr", type=float, default=config.LR)
    ap.add_argument("--run-name", default="baseline",
                    help="tag for this run; checkpoints -> checkpoints/<run-name>/, "
                         "log -> results/train_log_<run-name>.csv")
    ap.add_argument("--vram-fraction", type=float, default=None,
                    help="cap GPU memory this process may use, e.g. 0.7 for 70%%")
    ap.add_argument("--resume", nargs="?", const="__AUTO__", default=None,
                    help="resume training; optionally a checkpoint path "
                         "(default: this run's checkpoints/<run-name>/last.pth)")
    args = ap.parse_args()

    device = select_device(args.device)

    # per-run output locations (each experiment saved separately for graphing)
    ckpt_dir = os.path.join(config.CKPT_DIR, args.run_name)
    os.makedirs(ckpt_dir, exist_ok=True)
    os.makedirs(config.RESULTS_DIR, exist_ok=True)
    log_path = os.path.join(config.RESULTS_DIR, f"train_log_{args.run_name}.csv")
    print(f"[run] '{args.run_name}' | checkpoints -> {ckpt_dir} | log -> {log_path}")

    # optional: limit how much VRAM this process is allowed to grab
    if args.vram_fraction is not None and device.type == "cuda":
        torch.cuda.set_per_process_memory_fraction(args.vram_fraction, device.index or 0)
        print(f"[gpu] VRAM limited to {args.vram_fraction:.0%} of device memory")

    # data
    make_splits()
    train_ds = DrowsinessDataset(load_split(f"{config.SPLITS_DIR}/train.txt"), train=True)
    val_ds = DrowsinessDataset(load_split(f"{config.SPLITS_DIR}/val.txt"), train=False)
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,
                              collate_fn=collate_fn, num_workers=4)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False,
                            collate_fn=collate_fn, num_workers=4)
    print(f"train images: {len(train_ds)} | val images: {len(val_ds)}")

    # model + optimizer
    model = FasterRCNN().to(device)
    optimizer = torch.optim.SGD(model.parameters(), lr=args.lr,
                                momentum=config.MOMENTUM,
                                weight_decay=config.WEIGHT_DECAY)
    # learning-rate scheduler (selected in config.LR_SCHEDULER)
    is_plateau = config.LR_SCHEDULER == "plateau"
    if is_plateau:
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer, mode="max", factor=config.PLATEAU_FACTOR,
            patience=config.PLATEAU_PATIENCE, min_lr=config.PLATEAU_MIN_LR)
        print(f"[sched] ReduceLROnPlateau(mode=max, factor={config.PLATEAU_FACTOR}, "
              f"patience={config.PLATEAU_PATIENCE}, min_lr={config.PLATEAU_MIN_LR})")
    else:
        scheduler = torch.optim.lr_scheduler.StepLR(
            optimizer, step_size=config.LR_STEP, gamma=config.LR_GAMMA)
        print(f"[sched] StepLR(step={config.LR_STEP}, gamma={config.LR_GAMMA})")

    # ---- resume from a checkpoint (continue where a previous run stopped) ----
    best_map = -1.0
    start_epoch = 0
    resume_path = args.resume
    if resume_path == "__AUTO__":
        resume_path = os.path.join(ckpt_dir, "last.pth")
    if resume_path is not None:
        if not os.path.exists(resume_path):
            raise FileNotFoundError(f"--resume checkpoint not found: {resume_path}")
        ckpt = torch.load(resume_path, map_location=device)
        model.load_state_dict(ckpt["model"])
        start_epoch = ckpt.get("epoch", 0)
        best_map = ckpt.get("mAP", -1.0)
        # never let a resumed run overwrite an already-better best.pth
        best_path = os.path.join(ckpt_dir, "best.pth")
        if os.path.exists(best_path):
            try:
                best_map = max(best_map, torch.load(best_path, map_location="cpu").get("mAP", -1.0))
            except Exception:
                pass
        if "optimizer" in ckpt:
            optimizer.load_state_dict(ckpt["optimizer"])
        if "scheduler" in ckpt:
            try:
                scheduler.load_state_dict(ckpt["scheduler"])
            except Exception:
                pass   # e.g. scheduler type changed between runs
        print(f"[resume] loaded {resume_path} -> continuing from epoch {start_epoch + 1} "
              f"(best mAP so far {best_map:.4f})")

    epochs_no_improve = 0
    for epoch in range(start_epoch + 1, args.epochs + 1):
        print(f"\n=== Epoch {epoch}/{args.epochs} ===")
        losses = train_one_epoch(model, train_loader, optimizer, device, epoch)
        print("  avg:", " | ".join(f"{k}:{v:.3f}" for k, v in losses.items()))
        print_gpu_memory(device)

        # validation
        metrics = evaluate(model, val_loader, device)
        val_map = metrics["mAP@0.5"]
        print(f"  [val] mAP@0.5 = {val_map:.4f}")

        # step the LR scheduler AFTER validation
        # (ReduceLROnPlateau watches val mAP; StepLR is time-based)
        if is_plateau:
            scheduler.step(val_map)
        else:
            scheduler.step()
        cur_lr = optimizer.param_groups[0]["lr"]
        print(f"  [lr]  {cur_lr:.2e}")

        # --- append this epoch's losses + val mAP + lr to a CSV (for plotting) ---
        write_header = not os.path.exists(log_path)
        with open(log_path, "a", newline="") as f:
            w = csv.writer(f)
            if write_header:
                w.writerow(["epoch", "rpn_obj_loss", "rpn_box_loss",
                            "det_cls_loss", "det_box_loss", "total", "val_map", "lr"])
            w.writerow([epoch,
                        f"{losses['rpn_obj_loss']:.6f}", f"{losses['rpn_box_loss']:.6f}",
                        f"{losses['det_cls_loss']:.6f}", f"{losses['det_box_loss']:.6f}",
                        f"{losses['total']:.6f}", f"{val_map:.6f}", f"{cur_lr:.8f}"])

        # checkpoints (include optimizer + scheduler so training can resume exactly)
        torch.save({"model": model.state_dict(), "epoch": epoch, "mAP": val_map,
                    "optimizer": optimizer.state_dict(),
                    "scheduler": scheduler.state_dict()},
                   os.path.join(ckpt_dir, "last.pth"))
        if val_map > best_map:
            best_map = val_map
            epochs_no_improve = 0
            torch.save({"model": model.state_dict(), "epoch": epoch, "mAP": best_map,
                        "optimizer": optimizer.state_dict(),
                        "scheduler": scheduler.state_dict()},
                       os.path.join(ckpt_dir, "best.pth"))
            print(f"  saved new best (mAP@0.5 = {best_map:.4f})")
        else:
            epochs_no_improve += 1
            print(f"  no improvement for {epochs_no_improve} epoch(s) "
                  f"(best {best_map:.4f})")

        clear_cache(device)     # once per epoch, not per batch

        # early stopping
        if config.EARLY_STOP_PATIENCE and epochs_no_improve >= config.EARLY_STOP_PATIENCE:
            print(f"\n[early-stop] val mAP has not improved for "
                  f"{epochs_no_improve} epochs (patience={config.EARLY_STOP_PATIENCE}). "
                  f"Stopping at epoch {epoch}.")
            break

    print(f"\nTraining done. Best val mAP@0.5 = {best_map:.4f}")
    print(f"  best model: {os.path.join(ckpt_dir, 'best.pth')}")
    print(f"  log:        {log_path}")


if __name__ == "__main__":
    main()
