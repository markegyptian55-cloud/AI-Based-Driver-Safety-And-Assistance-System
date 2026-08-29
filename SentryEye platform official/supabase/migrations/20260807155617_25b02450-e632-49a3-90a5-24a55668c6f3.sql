ALTER TABLE public.detection_events ALTER COLUMN bbox DROP NOT NULL;

ALTER TABLE public.audit_log ALTER COLUMN actor_id SET NOT NULL;

REVOKE SELECT (checksum, notes) ON public.model_registry FROM anon;