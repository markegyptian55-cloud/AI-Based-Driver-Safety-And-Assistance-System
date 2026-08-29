INSERT INTO public.model_registry (name, version, framework, engine_kind, head_format, file_path, file_size_bytes, imgsz, num_classes, labels, semantic_map, postprocess_config, precision_score, recall_score, map50, map50_95, is_active, notes, trained_at)
VALUES
('yolo11n-320-mobile', '3.1.0', 'onnx', 'onnxruntime-web', 'ultralytics-v8',
 '/__l5e/assets-v1/7622e5ce-623c-4ad6-9b94-22e3f492fbec/yolo11n-320-mobile.onnx', 10479645, 320, 3,
 '{"0":"closed_eye","1":"open_eye","2":"yawning"}'::jsonb,
 '{"closed_eye":"eye_closed","open_eye":"eye_open","yawning":"yawn"}'::jsonb,
 '{"boxFormat":"cxcywh-pixels","classIdOffset":0,"confThreshold":0.35,"iouThreshold":0.5,"maxDetections":100,"normalize":"unit","resize":"letterbox"}'::jsonb,
 0.76298, 0.86155, 0.89995, 0.56629, true,
 'Mobile export of the same YOLOv11 Nano checkpoint at 320x320. ~4x fewer pixels than 640 so low-end Android phones sustain a real-time frame rate.',
 now()),
('yolo11n-416-mobile', '3.1.0', 'onnx', 'onnxruntime-web', 'ultralytics-v8',
 '/__l5e/assets-v1/5d31640c-ee08-4e1a-a4a0-5d5af6ac29df/yolo11n-416-mobile.onnx', 10508657, 416, 3,
 '{"0":"closed_eye","1":"open_eye","2":"yawning"}'::jsonb,
 '{"closed_eye":"eye_closed","open_eye":"eye_open","yawning":"yawn"}'::jsonb,
 '{"boxFormat":"cxcywh-pixels","classIdOffset":0,"confThreshold":0.35,"iouThreshold":0.5,"maxDetections":100,"normalize":"unit","resize":"letterbox"}'::jsonb,
 0.76298, 0.86155, 0.89995, 0.56629, true,
 'Mobile export of the same YOLOv11 Nano checkpoint at 416x416. Balance between 320 speed and 640 accuracy for mid-tier phones.',
 now());