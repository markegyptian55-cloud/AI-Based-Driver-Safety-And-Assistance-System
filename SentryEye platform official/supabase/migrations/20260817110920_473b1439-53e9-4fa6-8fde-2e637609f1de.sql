UPDATE public.model_registry
SET postprocess_config = COALESCE(postprocess_config, '{}'::jsonb) || jsonb_build_object(
  'cpuFileUrl', '/__l5e/assets-v1/185e291a-afe5-4938-94df-fc8660b7be5d/yolo26n480-low-device-fp32.onnx',
  'cpuExportPrecision', 'fp32'
)
WHERE name = 'yolo26n480-low-device';