-- Admin user management: lets the admin-users Edge Function sign a person out
-- everywhere after an admin gives them a temporary password.
--
-- Only the Edge Function (service role) can run it. Even if 05_fix_access.sql is
-- run again and grants it to signed-in users, the check below still refuses them.
-- Safe to run more than once.

create or replace function public.end_user_sessions(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Not allowed';
  end if;
  delete from auth.sessions where user_id = p_user_id;
end $$;

revoke all on function public.end_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.end_user_sessions(uuid) to service_role;
