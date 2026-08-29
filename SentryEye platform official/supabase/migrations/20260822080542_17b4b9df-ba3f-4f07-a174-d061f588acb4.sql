-- Backfill org membership + driver rows for accounts created before Fleet mode.
DO $$
DECLARE
  org_id uuid;
  u RECORD;
  assigned public.fleet_role;
BEGIN
  SELECT id INTO org_id FROM public.organizations ORDER BY created_at LIMIT 1;
  IF org_id IS NULL THEN
    INSERT INTO public.organizations (name) VALUES ('SentryEye Fleet') RETURNING id INTO org_id;
  END IF;

  FOR u IN SELECT id, email, raw_user_meta_data FROM auth.users LOOP
    assigned := CASE WHEN lower(u.email) = 'markegyptian55@gmail.com'
                     THEN 'manager'::public.fleet_role
                     ELSE 'driver'::public.fleet_role END;

    INSERT INTO public.org_members (organization_id, user_id, role)
    VALUES (org_id, u.id, assigned)
    ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role;

    INSERT INTO public.drivers (user_id, organization_id, full_name, driver_code)
    VALUES (
      u.id,
      org_id,
      COALESCE(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1)),
      'DRV-' || substr(replace(u.id::text, '-', ''), 1, 8)
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- New signups: keep the reserved manager email as a manager.
CREATE OR REPLACE FUNCTION public.fleet_role_for_email(_email text)
RETURNS public.fleet_role
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN lower(_email) = 'markegyptian55@gmail.com'
              THEN 'manager'::public.fleet_role
              ELSE 'driver'::public.fleet_role END;
$$;

REVOKE EXECUTE ON FUNCTION public.fleet_role_for_email(text) FROM anon;