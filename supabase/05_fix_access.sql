-- Fixes "You don't have permission to do that." right after signing in.
--
-- Newer Supabase projects don't always give signed-in users access to tables made in the
-- SQL Editor. The security rules in 01_schema.sql still decide who sees what; this only
-- lets the app reach the tables at all. Safe to run more than once.

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Make sure every login has a profile, and that there is at least one admin
-- (the first person who signed up).
insert into public.profiles (id, email, full_name, role)
select u.id, lower(u.email), coalesce(u.raw_user_meta_data ->> 'full_name', ''), 'consultant'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

update public.profiles set role = 'admin', active = true
where not exists (select 1 from public.profiles where role = 'admin' and active)
  and id = (select u.id from auth.users u order by u.created_at limit 1);
