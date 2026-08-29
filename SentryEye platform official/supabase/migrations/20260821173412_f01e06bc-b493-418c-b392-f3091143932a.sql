-- Replace the detection model registry with the new YOLO26n package.
--
-- ROLLBACK NOTE: the three removed rows are reproduced verbatim in the commented
-- restore block at the bottom of this migration. Their CDN files are NOT deleted,
-- so re-running that block fully restores the previous state.

-- 1. Clear saved references to the models being removed.
UPDATE public.user_settings
SET selected_model_id = NULL
WHERE selected_model_id IN (
  SELECT id FROM public.model_registry
  WHERE name IN ('yolo26n960-high-device', 'yolo26n480-low-device', 'yolo26n480-cpu-fallback')
);

-- 2. Remove the old rows (sessions keep model_id historically; it is not an FK).
DELETE FROM public.model_registry
WHERE name IN ('yolo26n960-high-device', 'yolo26n480-low-device', 'yolo26n480-cpu-fallback');

-- 3. Insert the two new models. Each row carries both precisions:
--    file_path        = fp16 (used when WebGPU resolves)
--    postprocess_config.cpuFileUrl = fp32 (used when the WASM EP resolves)
INSERT INTO public.model_registry (
  name, version, engine_kind, head_format, framework,
  file_path, file_size_bytes, imgsz, num_classes,
  labels, semantic_map, postprocess_config,
  precision_score, recall_score, map50, map50_95, notes, is_active
) VALUES
(
  'yolo26n-480-fast', '5.0.0', 'onnx', 'yolo-nms', 'ultralytics',
  '/__l5e/assets-v1/e6b48f6a-466b-452b-a34d-d0ecad94efa0/yolo26n-480-fast-fp16.onnx',
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
    'cpuExportPrecision', 'fp32',
    'cpuFileUrl', '/__l5e/assets-v1/db28d414-0266-46cc-bb89-b49cb14d4d48/yolo26n-480-fast-fp32.onnx',
    'cpuFileSizeBytes', 9733196,
    'accuracyUnverified', false,
    'bestFor', 'default',
    'relativeCompute', 1,
    'map50Corrected', 0.8272,
    'f1', 0.7561,
    'apPerClass', jsonb_build_object('closed_eye', 0.8613, 'open_eye', 0.8196, 'yawning', 0.7875),
    'apPerClassCorrected', jsonb_build_object('closed_eye', 0.8639, 'open_eye', 0.8300, 'yawning', 0.7877),
    'recallPerClass', jsonb_build_object('closed_eye', 0.7812, 'open_eye', 0.6872, 'yawning', 0.7009),
    'metricsNote', 'map50 is the raw figure (standard convention). map50Corrected applies the label-gap / partial-annotation (COCO iscrowd) correction described in the model package; recall and FN are identical between the two.',
    'evaluatedOn', 'held-out test split, 5589 images, 7427 GT instances, IoU 0.5, operating confidence 0.35'
  ),
  0.7930, 0.7231, 0.8228, NULL,
  'Trained natively at 480 (6-weakdevice-480-worstcase) — not a re-export. ~4x less compute than the 960 model, higher yawning AP, but 2.3 points lower closed_eye AP.',
  true
),
(
  'yolo26n-960-high', '5.0.0', 'onnx', 'yolo-nms', 'ultralytics',
  '/__l5e/assets-v1/6d1dfa47-cc86-43d9-b51b-c21cf7f979d9/yolo26n-960-high-fp16.onnx',
  5077965, 960, 3,
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
    'cpuExportPrecision', 'fp32',
    'cpuFileUrl', '/__l5e/assets-v1/34896ee9-1b74-4ca5-981a-df2e1df2fdf7/yolo26n-960-high-fp32.onnx',
    'cpuFileSizeBytes', 10016803,
    'accuracyUnverified', false,
    'bestFor', 'high-quality',
    'relativeCompute', 4,
    'map50Corrected', 0.8275,
    'f1', 0.7606,
    'apPerClass', jsonb_build_object('closed_eye', 0.8843, 'open_eye', 0.8223, 'yawning', 0.7636),
    'apPerClassCorrected', jsonb_build_object('closed_eye', 0.8869, 'open_eye', 0.8327, 'yawning', 0.7628),
    'recallPerClass', jsonb_build_object('closed_eye', 0.8129, 'open_eye', 0.6959, 'yawning', 0.6935),
    'metricsNote', 'map50 is the raw figure (standard convention). map50Corrected applies the label-gap / partial-annotation (COCO iscrowd) correction described in the model package; recall and FN are identical between the two.',
    'evaluatedOn', 'held-out test split, 5589 images, 7427 GT instances, IoU 0.5, operating confidence 0.35'
  ),
  0.7899, 0.7337, 0.8234, NULL,
  'Highest closed-eye (microsleep) accuracy: 88.69% AP corrected. ~4x the compute of the 480 model — desktop / discrete GPU.',
  true
);

-- =====================================================================
-- ROLLBACK BLOCK (uncomment and run to restore the previous registry)
-- =====================================================================
-- DELETE FROM public.model_registry WHERE name IN ('yolo26n-480-fast','yolo26n-960-high');
-- INSERT INTO public.model_registry (name, version, engine_kind, head_format, framework, file_path, file_size_bytes, imgsz, num_classes, labels, semantic_map, postprocess_config, map50, notes, is_active) VALUES
-- ('yolo26n960-high-device','4.0.0','onnx','yolo-nms','ultralytics','/__l5e/assets-v1/953ff9f3-a1ca-4dc9-bfdd-a0b776987c7a/yolo26n960-high-device.onnx',10016803,960,3,'{"0":"closed_eye","1":"open_eye","2":"yawning"}'::jsonb,'{"closed_eye":"eye_closed","open_eye":"eye_open","yawning":"yawn"}'::jsonb,'{"accuracyUnverified":false,"bestFor":"desktop","classIdOffset":0,"classThresholds":{"0":0.3,"1":0.33,"2":0.25},"confThreshold":0.25,"exportPrecision":"fp32","iouThreshold":0.5,"maxDetections":300,"normalize":"unit","padValue":114,"resize":"letterbox"}'::jsonb,0.8275,'Fully validated export: 82.75% mAP50 on a held-out test set.',true),
-- ('yolo26n480-low-device','4.0.0','onnx','yolo-nms','ultralytics','/__l5e/assets-v1/b4c3c77b-01e4-4621-8b07-5fb45823f8ed/yolo26n480-low-device.onnx',4936105,480,3,'{"0":"closed_eye","1":"open_eye","2":"yawning"}'::jsonb,'{"closed_eye":"eye_closed","open_eye":"eye_open","yawning":"yawn"}'::jsonb,'{"accuracyUnverified":true,"bestFor":"mobile","classIdOffset":0,"classThresholds":{"0":0.3,"1":0.33,"2":0.25},"confThreshold":0.25,"cpuExportPrecision":"fp32","cpuFileUrl":"/__l5e/assets-v1/185e291a-afe5-4938-94df-fc8660b7be5d/yolo26n480-low-device-fp32.onnx","exportPrecision":"fp16","iouThreshold":0.5,"maxDetections":300,"normalize":"unit","padValue":114,"resize":"letterbox"}'::jsonb,NULL,'Same 960-trained weights re-exported at 480 (fp16).',true),
-- ('yolo26n480-cpu-fallback','4.0.0','onnx','yolo-nms','ultralytics','/__l5e/assets-v1/185e291a-afe5-4938-94df-fc8660b7be5d/yolo26n480-low-device-fp32.onnx',9734269,480,3,'{"0":"closed_eye","1":"open_eye","2":"yawning"}'::jsonb,'{"closed_eye":"eye_closed","open_eye":"eye_open","yawning":"yawn"}'::jsonb,'{"accuracyUnverified":true,"bestFor":"cpu-fallback","classIdOffset":0,"classThresholds":{"0":0.3,"1":0.33,"2":0.25},"confThreshold":0.25,"cpuExportPrecision":"fp32","cpuFileUrl":"/__l5e/assets-v1/185e291a-afe5-4938-94df-fc8660b7be5d/yolo26n480-low-device-fp32.onnx","exportPrecision":"fp32","iouThreshold":0.5,"maxDetections":300,"normalize":"unit","padValue":114,"resize":"letterbox"}'::jsonb,NULL,'fp32 twin of the 480 export.',true);
