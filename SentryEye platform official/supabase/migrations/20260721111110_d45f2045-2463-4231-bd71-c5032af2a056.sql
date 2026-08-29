ALTER TABLE public.user_settings DROP CONSTRAINT IF EXISTS user_settings_inference_provider_check;
UPDATE public.user_settings SET inference_provider = 'browser-onnx' WHERE inference_provider IN ('browser','browser-onnx') OR inference_provider IS NULL;
UPDATE public.user_settings SET inference_provider = 'remote-fastapi' WHERE inference_provider = 'remote';
ALTER TABLE public.user_settings ALTER COLUMN inference_provider SET DEFAULT 'browser-onnx';
ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_inference_provider_check CHECK (inference_provider IN ('browser-onnx','remote-fastapi'));