"""
approve_labels.py
-----------------
Semi-automatic auto-labeling, STEP 2 of 2  (the ONLY script that writes to real
YOLO label files, and only after approval).

Reads results/auto_label/candidate_labels.txt produced by auto_label_candidates.py.
Each row has a DECISION column: pending | approve | reject | committed.

Three ways to use it
--------------------
1. Interactive review (default):
        python approve_labels.py
   For every 'pending' candidate it opens the review photo, prints the details,
   and asks:  [a]pprove  [r]eject  [s]kip  [o]pen photo again  [q]uit .
   Your choices are saved back into candidate_labels.txt. At the end it offers
   to commit the approved ones.

2. File-driven: open candidate_labels.txt, hand-edit DECISION to approve/reject
   while looking at results/auto_label/review/, then commit:
        python approve_labels.py --commit

3. Inspect only:
        python approve_labels.py --list
        python approve_labels.py --commit --dry-run   (show, write nothing)

Committing appends one YOLO line ( "<yolo_id> <cx> <cy> <w> <h>" ) to
data/labels/<stem>.txt for each approved candidate. Before a file is touched it
is backed up once to data/labels_autolabel_backup/. Duplicate lines (same class
and near-identical box) are skipped, so committing twice is safe. Committed rows
are marked 'committed' so they are never added again.
"""

import os
import sys
import csv
import shutil
import argparse
import subprocess

import config

OUT_DIR    = os.path.join(config.RESULTS_DIR, "auto_label")
REVIEW_DIR = os.path.join(OUT_DIR, "review")
CAND_FILE  = os.path.join(OUT_DIR, "candidate_labels.txt")
BACKUP_DIR = "data/labels_autolabel_backup"

COLUMNS = ["id", "decision", "image_id", "label_file",
           "class", "yolo_id", "conf", "cx", "cy", "w", "h"]
DUP_TOL = 0.01          # boxes within this (normalized) are considered the same


# --------------------------------------------------------------------------
# candidate_labels.txt read / write (preserves the comment header)
# --------------------------------------------------------------------------
def load_candidates(path):
    if not os.path.exists(path):
        sys.exit(f"no candidate file at {path} -- run auto_label_candidates.py first")
    header, rows = [], []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            s = line.rstrip("\n")
            if s.startswith("#") or not s.strip():
                header.append(s)
                continue
            parts = [p.strip() for p in s.split("|")]
            if len(parts) != len(COLUMNS):
                header.append(s)  # keep anything unexpected verbatim
                continue
            rows.append(dict(zip(COLUMNS, parts)))
    return header, rows


def save_candidates(path, header, rows):
    with open(path, "w", encoding="utf-8") as f:
        for h in header:
            f.write(h + "\n")
        for r in rows:
            f.write(" | ".join(str(r[c]) for c in COLUMNS) + "\n")


# --------------------------------------------------------------------------
def open_photo(image_id):
    p = os.path.join(REVIEW_DIR, image_id if image_id.lower().endswith(
        (".jpg", ".jpeg", ".png")) else image_id + ".jpg")
    if not os.path.exists(p):
        print(f"   (review photo not found: {p})")
        return
    try:
        if os.name == "nt":
            os.startfile(p)                                   # noqa: S606 (user machine)
        elif sys.platform == "darwin":
            subprocess.run(["open", p], check=False)
        else:
            subprocess.run(["xdg-open", p], check=False)
    except Exception:
        print(f"   open this file to review: {p}")


def summarize(rows):
    from collections import Counter
    c = Counter(r["decision"] for r in rows)
    print(f"candidates: {len(rows)}  |  " +
          "  ".join(f"{k}={c.get(k,0)}" for k in
                    ("pending", "approve", "reject", "committed")))
    return c


# --------------------------------------------------------------------------
def interactive(header, rows, cand_path):
    pending = [r for r in rows if r["decision"] == "pending"]
    if not pending:
        print("no pending candidates. (edit DECISION to 'pending' to re-review, "
              "or use --commit.)")
        return
    print(f"{len(pending)} pending candidate(s). "
          "Keys: [a]pprove  [r]eject  [s]kip  [o]pen photo  [q]uit & save\n")
    last_photo = None
    for i, r in enumerate(pending, 1):
        if r["image_id"] != last_photo:
            open_photo(r["image_id"])
            last_photo = r["image_id"]
        print(f"[{i}/{len(pending)}] {r['id']}  {r['class']} "
              f"conf={r['conf']}  image={r['image_id']}")
        print(f"      would add to {r['label_file']}:  "
              f"{r['yolo_id']} {r['cx']} {r['cy']} {r['w']} {r['h']}")
        while True:
            ans = input("      [a/r/s/o/q] > ").strip().lower()
            if ans in ("a", "approve"):
                r["decision"] = "approve"; break
            if ans in ("r", "reject"):
                r["decision"] = "reject"; break
            if ans in ("s", "skip", ""):
                break
            if ans in ("o", "open"):
                open_photo(r["image_id"]); continue
            if ans in ("q", "quit"):
                save_candidates(cand_path, header, rows)
                print("saved. bye.")
                return
            print("      please type a, r, s, o, or q")
    save_candidates(cand_path, header, rows)
    print("\nsaved decisions.")
    n_appr = sum(r["decision"] == "approve" for r in rows)
    if n_appr and input(f"commit {n_appr} approved label(s) now? [y/N] "
                        ).strip().lower() == "y":
        commit(header, rows, labels_dir=config.LABELS_DIR, dry_run=False,
               cand_path=cand_path)


# --------------------------------------------------------------------------
def _is_dup(existing_lines, yolo_id, box):
    for ln in existing_lines:
        p = ln.split()
        if len(p) != 5 or int(float(p[0])) != yolo_id:
            continue
        if all(abs(float(a) - b) <= DUP_TOL for a, b in zip(p[1:], box)):
            return True
    return False


def commit(header, rows, labels_dir, dry_run, cand_path=CAND_FILE):
    approved = [r for r in rows if r["decision"] == "approve"]
    if not approved:
        print("nothing to commit (no rows marked 'approve').")
        return
    if not dry_run:
        os.makedirs(BACKUP_DIR, exist_ok=True)

    # group by target label file
    by_file = {}
    for r in approved:
        by_file.setdefault(r["label_file"], []).append(r)

    added = skipped = 0
    for label_file, items in sorted(by_file.items()):
        path = os.path.join(labels_dir, label_file)
        existing = []
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                existing = [ln.strip() for ln in f if ln.strip()]

        # one-time backup before first modification of this file
        if not dry_run and os.path.exists(path):
            bak = os.path.join(BACKUP_DIR, label_file)
            if not os.path.exists(bak):
                shutil.copy2(path, bak)

        new_lines = []
        for r in items:
            box = (float(r["cx"]), float(r["cy"]), float(r["w"]), float(r["h"]))
            yid = int(r["yolo_id"])
            if _is_dup(existing + new_lines, yid, box):
                r["decision"] = "committed"    # already present -> nothing to do
                skipped += 1
                continue
            line = f"{yid} {box[0]:.6f} {box[1]:.6f} {box[2]:.6f} {box[3]:.6f}"
            new_lines.append(line)
            r["decision"] = "committed"
            added += 1
            print(f"  {'[dry] ' if dry_run else ''}+ {label_file}: {line}  "
                  f"({r['class']} {r['conf']})")

        if new_lines and not dry_run:
            with open(path, "a", encoding="utf-8") as f:
                if existing:                    # keep file newline-clean
                    f.write("\n")
                f.write("\n".join(new_lines) + "\n")

    if not dry_run:
        save_candidates(cand_path, header, rows)
    print(f"\n{'DRY-RUN: would add' if dry_run else 'added'} {added} label(s), "
          f"skipped {skipped} duplicate(s).")
    if not dry_run:
        print(f"backups of modified files -> {BACKUP_DIR}/")


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true",
                    help="non-interactive: append every row marked 'approve'")
    ap.add_argument("--dry-run", action="store_true",
                    help="with --commit, show what would be written but write nothing")
    ap.add_argument("--list", action="store_true", help="print a status summary and exit")
    ap.add_argument("--approve-all", action="store_true",
                    help="mark every 'pending' row as approve (review the photos first!)")
    ap.add_argument("--labels-dir", default=config.LABELS_DIR,
                    help="target YOLO label directory (default: config.LABELS_DIR)")
    ap.add_argument("--file", default=CAND_FILE, help="candidate_labels.txt path")
    args = ap.parse_args()

    header, rows = load_candidates(args.file)

    if args.list:
        summarize(rows); return

    if args.approve_all:
        n = 0
        for r in rows:
            if r["decision"] == "pending":
                r["decision"] = "approve"; n += 1
        save_candidates(args.file, header, rows)
        print(f"marked {n} pending candidate(s) as approve.")
        summarize(rows)
        if not args.commit:
            return

    if args.commit:
        summarize(rows)
        commit(header, rows, labels_dir=args.labels_dir, dry_run=args.dry_run,
               cand_path=args.file)
    else:
        interactive(header, rows, cand_path=args.file)


if __name__ == "__main__":
    main()
