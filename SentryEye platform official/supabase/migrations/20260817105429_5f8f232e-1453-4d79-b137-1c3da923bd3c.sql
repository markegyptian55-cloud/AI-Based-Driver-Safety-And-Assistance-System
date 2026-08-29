REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.model_registry FROM authenticated;
GRANT SELECT ON public.model_registry TO anon;
GRANT ALL ON public.model_registry TO service_role;