"""
Output retention for `static/out`.

Every video run writes two MP4s (annotated + raw) named by a fresh run id,
and nothing ever removed them. Left alone this grows without bound -- the
folder had reached 599 MB across 142 files before this was added, all but
the most recent of which were unreachable, because the page only keeps a
reference to the current run.

Unbounded growth is a stability problem, not just an untidy one: the
pipeline writes video while it runs, so the failure mode when the disk
finally fills is a half-written output part-way through a run rather than
a clean error up front.

Retention is by RUN, not by file. Each run's two files share a run-id
prefix and must be kept or dropped together -- deleting one of a pair
would leave a result whose before/after toggle is half broken, which is
worse than deleting both.
"""

from __future__ import annotations

from pathlib import Path

# Runs to keep, newest first. Enough to flick back through a few recent
# results; small enough that the folder stays bounded at a few hundred MB.
DEFAULT_KEEP_RUNS = 6


def _run_id(path: Path) -> str:
    """`<runid>_annotated.mp4` / `<runid>_raw.mp4` -> `<runid>`."""
    return path.name.split("_", 1)[0]


def prune_outputs(out_dir: Path, keep_runs: int = DEFAULT_KEEP_RUNS,
                  protect: set[str] | None = None) -> tuple[int, int]:
    """Delete all but the newest `keep_runs` runs. Returns (runs, bytes) freed.

    `protect` holds run ids that must survive regardless of age -- the run
    currently displayed on the page is passed here, so a result the user is
    still looking at can never be deleted out from under them by a later
    run's cleanup.

    Never raises: cleanup failing (a file locked by the player, say) must
    not take down the run that triggered it.
    """
    protect = protect or set()
    try:
        if not out_dir.is_dir():
            return (0, 0)

        runs: dict[str, list[Path]] = {}
        for f in out_dir.glob("*.mp4"):
            runs.setdefault(_run_id(f), []).append(f)

        if not runs:
            return (0, 0)

        # Newest first by the most recent mtime within each run.
        ordered = sorted(
            runs.items(),
            key=lambda kv: max((p.stat().st_mtime for p in kv[1]), default=0.0),
            reverse=True,
        )

        freed_runs = freed_bytes = 0
        for idx, (run_id, files) in enumerate(ordered):
            if idx < keep_runs or run_id in protect:
                continue
            for f in files:
                try:
                    size = f.stat().st_size
                    f.unlink()
                    freed_bytes += size
                except OSError:
                    # Locked or already gone -- skip it, try again next run.
                    continue
            freed_runs += 1
        return (freed_runs, freed_bytes)
    except Exception:
        return (0, 0)
