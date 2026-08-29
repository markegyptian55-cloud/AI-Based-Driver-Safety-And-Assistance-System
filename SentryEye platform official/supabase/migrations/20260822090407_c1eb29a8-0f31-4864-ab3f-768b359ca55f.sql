-- 1) Hide internal integrity/checksum metadata from ordinary logged-in users
REVOKE SELECT ON public.model_registry FROM authenticated;
GRANT SELECT (
  id, name, version, engine_kind, head_format, framework, file_path,
  file_size_bytes, imgsz, num_classes, labels, semantic_map, postprocess_config,
  precision_score, recall_score, map50, map50_95, trained_at, notes,
  is_active, created_at, updated_at
) ON public.model_registry TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.model_registry TO authenticated;
GRANT ALL ON public.model_registry TO service_role;

-- Only expose active models to non-admin logged-in users
DROP POLICY IF EXISTS "Authenticated users read models" ON public.model_registry;
CREATE POLICY "Authenticated users read active models"
ON public.model_registry FOR SELECT TO authenticated
USING (is_active = true OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- 2) Explicit admin-only write/delete controls on the models bucket
DROP POLICY IF EXISTS "models: admins manage" ON storage.objects;
CREATE POLICY "models: admins insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'models' AND public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "models: admins update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'models' AND public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (bucket_id = 'models' AND public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "models: admins delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'models' AND public.has_role(auth.uid(), 'admin'::public.app_role));