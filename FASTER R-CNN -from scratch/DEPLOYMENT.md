# Deploying the Streamlit dashboard

The dashboard (`app.py`) runs the trained Faster R-CNN on an uploaded image,
a camera snapshot, or a short video, and shows the driver state.

## Run locally

```bash
pip install streamlit
streamlit run app.py
```

Then open the URL it prints (usually http://localhost:8501).

## Publish on GitHub + Streamlit Community Cloud

### 1. What gets committed
The `.gitignore` is already set up so you commit **only** what the app needs:
- `app.py`, `config.py`, `inference.py`, `models/`, `utils/`
- `checkpoints/tuned/best.pth`  ← the trained weights (≈67 MB, under GitHub's 100 MB limit)
- `requirements.txt`

It **excludes** the dataset (`data/`), the virtual environments, and other checkpoints.

> The model must be trained first so `checkpoints/tuned/best.pth` exists.

### 2. Push to GitHub

```bash
git init
git add .
git commit -m "Driver drowsiness detection — Streamlit app"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

If `best.pth` is rejected for size, use Git LFS:
```bash
git lfs install
git lfs track "*.pth"
git add .gitattributes && git commit -m "track weights with LFS"
```

### 3. Deploy on Streamlit Cloud
1. Go to https://share.streamlit.io → **New app**.
2. Pick your repo/branch, set **Main file path** = `app.py`.
3. Deploy. First build takes a few minutes (installs CPU PyTorch).

## Notes / gotchas
- **CPU only:** Streamlit Cloud has no GPU. `requirements.txt` pulls CPU torch wheels; video runs slowly, so keep clips short.
- **No live webcam:** the server can't open a local camera. The app uses `st.camera_input` (single photo) and file upload instead.
- **OpenCV:** the repo uses `opencv-python-headless` (required on the cloud). For the local GUI scripts (`webcam.py --show`), install regular `opencv-python`.
- **Anchor config:** the app expects `checkpoints/tuned/best.pth` (16 anchors, matching the current `config.py`). The 9-anchor baseline won't load unless the anchor config is reverted.
- If the torch install fails or is too large on the cloud, pin a specific CPU version, e.g. `torch==2.4.1` and `torchvision==0.19.1`.
