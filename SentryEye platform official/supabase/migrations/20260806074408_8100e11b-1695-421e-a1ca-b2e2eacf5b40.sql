GRANT SELECT ON public.model_registry TO anon;

DROP POLICY IF EXISTS "Authenticated read models" ON public.model_registry;
CREATE POLICY "Anyone can read models"
ON public.model_registry
FOR SELECT
TO anon, authenticated
USING (true);