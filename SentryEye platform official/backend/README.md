# SentryEye Remote Inference Service (Phase 2)

FastAPI + Ultralytics YOLO service used as the **automatic fallback** for
devices that cannot sustain real-time on-device inference (typically mid-range
Android running 640px graphs in single-threaded WASM).

## Run locally

```bash
cd backend
pip install -r requirements.txt
MODEL_PATH=/path/to/best.pt IMGSZ=640 uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Docs: `http://localhost:8000/docs` (Swagger) and `/redoc`.

## Docker

```bash
docker build -t sentryeye-inference ./backend
docker run -p 8000:8000 -v /path/to/models:/srv/models \
  -e MODEL_PATH=/srv/models/best.pt -e ALLOWED_ORIGINS=https://your-app.lovable.app \
  sentryeye-inference
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `MODEL_PATH` | `./best.pt` | Any Ultralytics checkpoint or ONNX export. |
| `IMGSZ` | `640` | Default inference size; the client can override per request. |
| `MODEL_NAME` / `MODEL_VERSION` | `yolov11n-drowsiness` / `1.0.0` | Reported to the client and recorded in diagnostics. |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins. Set this in production. |
| `MAX_UPLOAD_BYTES` | `4194304` | Rejects oversized frames. |

## Endpoints

- `GET /health` — liveness, engine (`cuda`/`cpu`), model identity, class labels.
  The browser probes this before routing any frames.
- `POST /v1/warmup` — loads weights and runs one dummy frame.
- `POST /v1/detect` — raw JPEG body, thresholds via `x-conf-threshold`,
  `x-iou-threshold`, `x-max-detections`, `x-imgsz` headers. This is the hot path.
- `POST /v1/detect/upload` — multipart variant for manual testing in Swagger.

## Contract

Responses carry **class ids and normalized `[x, y, w, h]`** only. Labels and
semantic tags (`eye_closed`, `yawn`, …) are resolved on the client from the
model registry, so replacing the checkpoint never requires a client change.

## Connecting the app

In the app: **Settings → Remote inference**, paste the service URL, enable it,
and choose the `hybrid-auto` engine. The router keeps frames on-device while the
phone is healthy and switches to this service when frame rate or tracking
confidence collapses.
