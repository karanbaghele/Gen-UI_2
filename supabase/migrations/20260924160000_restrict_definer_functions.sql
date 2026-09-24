-- Supabase grants function EXECUTE to API roles by default. Keep the
-- trigger private, and let only signed-in users call the RLS helper.
revoke all on function public.bootstrap_user() from anon, authenticated, service_role;
revoke all on function public.workspace_role(uuid) from anon, service_role;
