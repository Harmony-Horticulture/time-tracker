-- =====================================================================
-- Adds the Technician role.
--
-- ONLY needed if you ran 01_schema.sql before November 18, 2026.
-- (Newer copies of 01_schema.sql already include it.) Safe to run twice.
-- SQL Editor > New query > paste > Run.
-- =====================================================================
alter table public.profiles    drop constraint if exists profiles_role_check;
alter table public.profiles    add  constraint profiles_role_check
  check (role in ('consultant', 'technician', 'admin'));

alter table public.invitations drop constraint if exists invitations_role_check;
alter table public.invitations add  constraint invitations_role_check
  check (role in ('consultant', 'technician', 'admin'));
