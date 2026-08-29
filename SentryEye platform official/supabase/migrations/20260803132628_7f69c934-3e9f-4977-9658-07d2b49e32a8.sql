-- Replace legacy 640 model row with the two production models.
DELETE FROM public.model_registry WHERE name = 'yolo11m-drowsiness';

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS selected_model_id UUID REFERENCES public.model_registry(id) ON DELETE SET NULL;

INSERT INTO public.model_registry (
  name, version, engine_kind, head_format, framework, file_path, file_size_bytes,
  imgsz, num_classes, labels, semantic_map, postprocess_config,
  precision_score, recall_score, map50, map50_95, trained_at, notes, is_active
) VALUES
(
  'rfdetr-nano-384', '1.0.0', 'onnxruntime-web', 'rf-detr', 'onnx',
  '/__l5e/assets-v1/effab46f-a653-4791-a81a-35f2f7aaa916/rfdetr-nano.onnx', 113383423,
  384, 3,
  '{"0":"closed_eye","1":"open_eye","2":"yawning"}'::jsonb,
  '{"closed_eye":"eye_closed","open_eye":"eye_open","yawning":"yawn"}'::jsonb,
  '{"confThreshold":0.35,"iouThreshold":0.5,"maxDetections":100,"classIdOffset":1,"normalize":"imagenet","resize":"stretch","boxFormat":"cxcywh-normalized","numQueries":300}'::jsonb,
  0.8407, 0.8895, 0.9195, 0.6688, '2026-07-29T00:04:29Z',
  'RF-DETR Nano (~10M params), worst-case augmentation, 15 epochs / 11h50m on i7-14700 + RTX 2000 Ada 16GB, ~120+ FPS. Per-class AP: closed_eye 68.22%, open_eye 57.18%, yawning 75.46%.',
  TRUE
),
(
  'yolo11m-worstcase-384', '2.0.0', 'onnxruntime-web', 'ultralytics-v8', 'onnx',
  '/__l5e/assets-v1/ee370044-9c2c-4b67-863f-cea4d16817d7/yolo11m-worstcase-384.onnx', 80326952,
  384, 3,
  '{"0":"closed_eye","1":"open_eye","2":"yawning"}'::jsonb,
  '{"closed_eye":"eye_closed","open_eye":"eye_open","yawning":"yawn"}'::jsonb,
  '{"confThreshold":0.35,"iouThreshold":0.5,"maxDetections":100,"classIdOffset":0,"normalize":"unit","resize":"letterbox","boxFormat":"cxcywh-pixels"}'::jsonb,
  0.8140, 0.8260, 0.8894, 0.6180, '2026-07-28T00:00:00Z',
  'YOLOv11m (~20.1M params), stage-2 worst-case fine-tune, extreme cabin glare/HSV jitter, ~110 FPS.',
  TRUE
);