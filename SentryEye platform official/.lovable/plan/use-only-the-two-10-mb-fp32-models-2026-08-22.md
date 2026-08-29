# Use only the two 10 MB fp32 models

## What's there now

The registry holds exactly two models, but each one ships **two** files:

| Model | Used on GPU | Used on CPU/WASM |
|---|---|---|
| yolo26n-480-fast | fp16, 4.9 MB | fp32, 9.7 MB |
| yolo26n-960-high | fp16, 5.1 MB | fp32, 10.0 MB |

So on a WebGPU device the app runs the half-precision 5 MB export, not the 10 MB one you uploaded. The two files you just uploaded are byte-identical to the fp32 files already on the CDN, so nothing new needs uploading.

## What changes

Both models use the 10 MB fp32 export on **every** execution path — WebGPU, WebGL and WASM/CPU. The fp16 variants stop being served, and the selector keeps showing exactly two options: 480 fast and 960 high.

1. Migration on `model_registry`: set each row's primary file to its fp32 asset URL and size, set `exportPrecision` to `fp32`, and remove the `cpuFileUrl` / `cpuFileSizeBytes` CPU-twin fields so there is one file per model.
2. Model metadata (`labels.ts`) and the runtime asset picker (`engine-preference.ts`) drop the fp16/fp32 twin branch — one URL per model, one cache entry per model. The GPU/CPU split stays for the execution provider, just not for the file.
3. UI copy that says "fp16 (GPU)" or shows separate "GPU file saved / CPU file saved" badges (`model-choice-list.tsx`, `model-selector.tsx`, model manager) collapses to a single "downloaded" state and a single `fp32` precision label.
4. Stale fp16 files already cached on devices are cleared on first load so nobody keeps running the old export; the two `*-fp16.onnx.asset.json` pointers are deleted from `public/models/`, along with the older `yolo26n480-low-device` / `yolo26n960-high-device` pointers that are no longer referenced.
5. Unit tests with fp16/fp32 twin fixtures are updated to the single-file shape.

## Trade-off to expect

fp32 is roughly double the download (10 MB vs 5 MB) and is typically slower than fp16 on WebGPU — the previously recorded rule was fp16 for GPU, fp32 for CPU. This plan overrides that in favour of the accuracy of the exports you supplied; the recorded preference is updated so it isn't reverted later. If the 960 model gets noticeably slower on your GPU after this, the fix is the scheduler/resolution, not going back to fp16.
