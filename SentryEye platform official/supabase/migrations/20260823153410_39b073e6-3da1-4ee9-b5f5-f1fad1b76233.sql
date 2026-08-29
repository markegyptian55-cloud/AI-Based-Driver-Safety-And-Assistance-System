-- Manager check becomes role-based instead of a hardcoded email
CREATE OR REPLACE FUNCTION public.is_reserved_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.user_id = auth.uid()
      AND m.role::text IN ('manager', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_reserved_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_reserved_manager() TO authenticated;

REVOKE ALL ON FUNCTION public.manager_audit_feed(int, int, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_audit_feed(int, int, text, timestamptz, timestamptz) TO authenticated;

-- Diagnostics shares: explicit owner-scoped create rule
DROP POLICY IF EXISTS "Owners can create their own shares" ON public.diagnostics_shares;
CREATE POLICY "Owners can create their own shares"
ON public.diagnostics_shares FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid());