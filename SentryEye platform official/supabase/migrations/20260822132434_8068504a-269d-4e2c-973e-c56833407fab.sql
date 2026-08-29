CREATE OR REPLACE FUNCTION public.tg_clamp_fleet_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text;
BEGIN
  SELECT lower(email) INTO _email FROM auth.users WHERE id = NEW.user_id;
  IF NEW.role = 'manager'::public.fleet_role
     AND (_email IS NULL OR _email <> 'markegyptian55@gmail.com') THEN
    NEW.role := 'driver'::public.fleet_role;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clamp_fleet_role ON public.org_members;
CREATE TRIGGER clamp_fleet_role
BEFORE INSERT OR UPDATE ON public.org_members
FOR EACH ROW EXECUTE FUNCTION public.tg_clamp_fleet_role();