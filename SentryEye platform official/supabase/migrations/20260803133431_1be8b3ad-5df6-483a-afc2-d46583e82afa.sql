-- 1. Role-check helpers: only answer for the calling user; no cross-user probing.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR _user_id IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR _user_id IS DISTINCT FROM auth.uid() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles)
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_any_role(uuid, app_role[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_roles() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_roles() TO authenticated;

-- 2. Profiles: no blanket read access for every signed-in user.
DROP POLICY IF EXISTS "Profiles readable by authenticated" ON public.profiles;

CREATE POLICY "Users read own profile"
ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid());

CREATE POLICY "Admins and researchers read profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin'::public.app_role, 'researcher'::public.app_role]));

-- 3. Notifications: users may only create ordinary self-addressed alerts,
--    never system/security-looking ones.
DROP POLICY IF EXISTS "Users insert own notifications" ON public.notifications;

CREATE POLICY "Users insert own limited notifications"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND kind IN ('session.risk', 'session.alert', 'user.note')
  AND severity IN ('info', 'warning')
);