# Working settings snapshot -- 2026-08-15

Known-good state. Video slow but result acceptable. Restore here if future
changes break it.

## Restore

Full file copies live in this folder (`app.py`, `core/`, `ui/`, `pages/`,
`registry.yaml`, `streamlit_config.toml`). To roll back:

    cp backups/20260815-160816/app.py app.py
    cp -r backups/20260815-160816/core core
    cp -r backups/20260815-160816/ui ui
    cp -r backups/20260815-160816/pages pages
    cp backups/20260815-160816/registry.yaml models/registry.yaml
    cp backups/20260815-160816/streamlit_config.toml .streamlit/config.toml

Or diff a single file against the backup before deciding to restore it.

## Tunable defaults (app.py `_DEFAULTS`)

| Setting | Value |
|---|---|
| lang | en |
| theme | neon |
| conf (detection confidence) | 0.35 |
| window_size | 30 |
| warning_threshold | 0.40 |
| critical_threshold | 0.65 |
| critical_hold | 1.5 |
| hud_pos | top-right |
| sound_enabled | True |
| video_player_size | medium |

## Model selection

Not a fixed setting -- `core/registry.py:best_key()` auto-picks the entry
with the highest `map50_corrected` (fallback `map50`) from
`models/registry.yaml` every run. Current registry entries:

- yolo26n-1-baseline (960)
- yolo26n-2-finetune (960)
- yolo26n-3-fresh-640 (640)
- yolo26n-4-calibration (960)
- yolo26n-5-cls3 (960)

## Known issue at this snapshot

Main video pipeline has a slight slow-down (`core/pipeline.py`) but output
quality is acceptable. `stride=1` (no frame skipping) is the default --
that's the main lever if speed needs revisiting later, at the cost of
missing sub-0.3s micro-blinks.
