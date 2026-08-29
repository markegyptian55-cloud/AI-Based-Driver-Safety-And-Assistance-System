DELETE FROM public.model_registry WHERE name LIKE 'yolo11%';

INSERT INTO public.model_registry (
  name, version, engine_kind, head_format, framework, file_path,
  file_size_bytes, imgsz, num_classes, labels, semantic_map,
  postprocess_config, precision_score, recall_score, map50, map50_95,
  is_active, notes
) VALUES
(
  'yolo26n480-low-device', '4.0.0', 'onnx', 'yolo-nms', 'ultralytics',
  '/__l5e/assets-v1/b4c3c77b-01e4-4621-8b07-5fb45823f8ed/yolo26n480-low-device.onnx',
  4936105, 480, 3,
  '{"0":"closed_eye","1":"open_eye","2":"yawning"}'::jsonb,
  '{"closed_eye":"eye_closed","open_eye":"eye_open","yawning":"yawn"}'::jsonb,
  jsonb_build_object(
    'confThreshold', 0.25,
    'iouThreshold', 0.5,
    'maxDetections', 300,
    'classIdOffset', 0,
    'resize', 'letterbox',
    'normalize', 'unit',
    'padValue', 114,
    'classThresholds', jsonb_build_object('0', 0.30, '1', 0.33, '2', 0.25),
    'exportPrecision', 'fp16',
    'accuracyUnverified', true,
    'bestFor', 'mobile'
  ),
  NULL, NULL, NULL, NULL,
  true,
  'Same 960-trained weights re-exported at 480 (fp16). Runs correctly, but accuracy at this input size is not independently verified.'
),
(
  'yolo26n960-high-device', '4.0.0', 'onnx', 'yolo-nms', 'ultralytics',
  '/__l5e/assets-v1/953ff9f3-a1ca-4dc9-bfdd-a0b776987c7a/yolo26n960-high-device.onnx',
  10016803, 960, 3,
  '{"0":"closed_eye","1":"open_eye","2":"yawning"}'::jsonb,
  '{"closed_eye":"eye_closed","open_eye":"eye_open","yawning":"yawn"}'::jsonb,
  jsonb_build_object(
    'confThreshold', 0.25,
    'iouThreshold', 0.5,
    'maxDetections', 300,
    'classIdOffset', 0,
    'resize', 'letterbox',
    'normalize', 'unit',
    'padValue', 114,
    'classThresholds', jsonb_build_object('0', 0.30, '1', 0.33, '2', 0.25),
    'exportPrecision', 'fp32',
    'accuracyUnverified', false,
    'bestFor', 'desktop'
  ),
  NULL, NULL, 0.8275, NULL,
  true,
  'Fully validated export: 82.75% mAP50 on a held-out test set.'
);