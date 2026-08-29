-- 1. audit_log: forbid NULL actor forging
DROP POLICY IF EXISTS "Users insert own audit rows" ON public.audit_log;
CREATE POLICY "Users insert own audit rows"
ON public.audit_log FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid());

-- 2. SECURITY DEFINER trigger function must not be callable from the API
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;

-- 3. model_registry: narrow anonymous read to non-sensitive columns
REVOKE SELECT ON public.model_registry FROM anon;
GRANT SELECT (
  id, name, version, engine_kind, head_format, framework, file_path,
  file_size_bytes, imgsz, num_classes, labels, semantic_map,
  postprocess_config, precision_score, recall_score, map50, map50_95,
  trained_at, is_active, created_at, updated_at
) ON public.model_registry TO anon;