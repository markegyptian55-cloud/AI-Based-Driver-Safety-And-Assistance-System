insert into public.model_registry (
  name, version, engine_kind, head_format, framework, file_path, file_size_bytes,
  imgsz, num_classes, labels, semantic_map, postprocess_config, notes, is_active
) values (
  'yolo26n480-cpu-fallback', '4.0.0', 'onnx', 'yolo-nms', 'ultralytics',
  '/__l5e/assets-v1/185e291a-afe5-4938-94df-fc8660b7be5d/yolo26n480-low-device-fp32.onnx',
  9734269, 480, 3,
  '{"0":"closed_eye","1":"open_eye","2":"yawning"}'::jsonb,
  '{"closed_eye":"eye_closed","open_eye":"eye_open","yawning":"yawn"}'::jsonb,
  '{"confThreshold":0.25,"iouThreshold":0.5,"maxDetections":300,"classIdOffset":0,"resize":"letterbox","normalize":"unit","padValue":114,"classThresholds":{"0":0.3,"1":0.33,"2":0.25},"exportPrecision":"fp32","cpuFileUrl":"/__l5e/assets-v1/185e291a-afe5-4938-94df-fc8660b7be5d/yolo26n480-low-device-fp32.onnx","cpuExportPrecision":"fp32","accuracyUnverified":true,"bestFor":"cpu-fallback"}'::jsonb,
  'fp32 twin of the 480 export. Runs natively on CPU/WASM where fp16 is emulated, so live detection has a path that never waits on the fp16 480 model.',
  true
);