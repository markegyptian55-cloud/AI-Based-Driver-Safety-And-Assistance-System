
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(UUID, public.app_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_roles() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(UUID, public.app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_roles() TO authenticated;
