GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.audit_log_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.is_reserved_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid() AND lower(email) = 'markegyptian55@gmail.com'
  );
$$;

REVOKE ALL ON FUNCTION public.is_reserved_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_reserved_manager() TO authenticated;

DROP POLICY IF EXISTS "Reserved manager reads audit log" ON public.audit_log;
CREATE POLICY "Reserved manager reads audit log"
ON public.audit_log FOR SELECT TO authenticated
USING (public.is_reserved_manager());

CREATE OR REPLACE FUNCTION public.manager_audit_feed(
  _limit int DEFAULT 50,
  _offset int DEFAULT 0,
  _action text DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  created_at timestamptz,
  action text,
  actor_id uuid,
  actor_email text,
  actor_role text,
  target_type text,
  target_id text,
  metadata jsonb,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT a.*
    FROM public.audit_log a
    WHERE public.is_reserved_manager()
      AND (_action IS NULL OR a.action = _action)
      AND (_from IS NULL OR a.created_at >= _from)
      AND (_to IS NULL OR a.created_at <= _to)
  )
  SELECT f.id, f.created_at, f.action, f.actor_id,
         u.email::text, f.actor_role, f.target_type, f.target_id, f.metadata,
         (SELECT count(*) FROM filtered)
  FROM filtered f
  LEFT JOIN auth.users u ON u.id = f.actor_id
  ORDER BY f.created_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 200)) OFFSET GREATEST(0, _offset);
$$;

REVOKE ALL ON FUNCTION public.manager_audit_feed(int, int, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_audit_feed(int, int, text, timestamptz, timestamptz) TO authenticated;