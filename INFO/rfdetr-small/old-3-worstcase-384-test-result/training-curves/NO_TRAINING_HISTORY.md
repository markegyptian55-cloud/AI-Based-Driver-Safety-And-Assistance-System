# Training history not preserved

No per-epoch training record exists for this run, so no loss or mAP curve
can be plotted for it.

**What was checked**

- No `results.csv` (or `metrics.csv`) in this run's checkpoint directory.
- No `results.csv` recoverable from the originating project archive.
- For the RF-DETR runs, the checkpoint itself was opened directly: it
  stores `epoch`, `global_step`, `args`, `model_config` and weights, but
  no per-epoch loss series.

**Why no chart is supplied instead**

Chart images in the originating archive that appear to show this run's
training history are not trustworthy: hashing them showed one
byte-identical `07_training_loss_curves.png` shared across four runs
spanning two different architectures, and a single identical
`08_confusion_matrix.png` shared across all eleven archived runs. Those
images cannot represent this model and are not reproduced here.

Test-time evaluation for this model is unaffected and is present in
`tested-images/` -- it was measured directly from the checkpoint on the
held-out test split.
