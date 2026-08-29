REVOKE ALL ON FUNCTION public.current_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_fleet_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_org_manager(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_driver_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_shift(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_diagnostics_shares() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_fleet_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_driver_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_shift(uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_any_role(uuid, public.app_role[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_roles() TO authenticated;