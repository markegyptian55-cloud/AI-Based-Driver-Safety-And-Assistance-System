REVOKE ALL ON public.model_registry FROM anon;

GRANT SELECT (
  id, name, version, engine_kind, head_format, framework, file_path,
  file_size_bytes, imgsz, num_classes, labels, semantic_map,
  postprocess_config, precision_score, recall_score, map50, map50_95,
  trained_at, is_active
) ON public.model_registry TO anon;

GRANT SELECT ON public.model_registry TO authenticated;
GRANT ALL ON public.model_registry TO service_role;

DROP POLICY IF EXISTS "Anyone can read models" ON public.model_registry;

CREATE POLICY "Anonymous visitors read active models"
ON public.model_registry FOR SELECT TO anon
USING (is_active = true);

CREATE POLICY "Authenticated users read models"
ON public.model_registry FOR SELECT TO authenticated
USING (true);