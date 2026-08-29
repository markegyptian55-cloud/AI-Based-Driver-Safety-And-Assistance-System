CREATE OR REPLACE FUNCTION public.manager_audit_feed(_limit integer DEFAULT 50, _offset integer DEFAULT 0, _action text DEFAULT NULL::text, _from timestamp with time zone DEFAULT NULL::timestamp with time zone, _to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id bigint, created_at timestamp with time zone, action text, actor_id uuid, actor_email text, actor_role text, target_type text, target_id text, metadata jsonb, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH filtered AS (
    SELECT a.*
    FROM public.audit_log a
    WHERE public.is_reserved_manager()
      AND public.can_read_audit_row(a.actor_id)
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
$function$;

REVOKE EXECUTE ON FUNCTION public.manager_audit_feed(integer,integer,text,timestamptz,timestamptz) FROM anon;