-- =====================================================================
-- Harmony Horticulture Time Tracker: database setup
--
-- HOW TO USE: In Supabase, open SQL Editor > New query, paste this whole
-- file, and click Run. Then do the same with 02_seed.sql.
-- It is safe to run this file only once on a new, empty project.
-- =====================================================================

-- ---------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        text not null default 'consultant' check (role in ('consultant', 'technician', 'admin')),
  -- Name used inside QuickBooks product/service names, e.g. "Robbie Stephens"
  qb_name     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Admins add a row here to invite someone. Nobody else can join.
create table public.invitations (
  email       text primary key check (email = lower(email)),
  full_name   text not null default '',
  role        text not null default 'consultant' check (role in ('consultant', 'technician', 'admin')),
  invited_by  uuid references public.profiles(id) on delete set null,
  invited_at  timestamptz not null default now(),
  accepted_at timestamptz
);

-- Helper checks used by the security rules below
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active);
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

-- When a new login is created: the very first person becomes the admin.
-- After that, only invited email addresses can join (invite-only).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv        invitations%rowtype;
  first_user boolean;
begin
  select not exists (select 1 from profiles) into first_user;
  select * into inv from invitations where email = lower(new.email);
  if not found and not first_user then
    raise exception 'This app is invite-only. Ask an admin to invite %.', new.email;
  end if;
  insert into profiles (id, email, full_name, role, qb_name)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(inv.full_name, ''), new.raw_user_meta_data ->> 'full_name', ''),
    case when first_user then 'admin' else inv.role end,
    nullif(coalesce(inv.full_name, ''), '')
  );
  update invitations set accepted_at = now() where email = lower(new.email);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Lists the admin manages
-- ---------------------------------------------------------------------
create table public.clients (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  -- Customer name exactly as it appears in QuickBooks (if different)
  qb_name     text,
  properties  text[] not null default '{}',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.service_types (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  help_text   text,
  -- QuickBooks Product/Service. {consultant} is replaced with the person's QuickBooks name.
  qb_item     text not null,
  billable    boolean not null default true,
  sort_order  int not null default 0,
  active      boolean not null default true
);

create table public.materials (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  unit        text not null default 'each',
  price       numeric(10, 2),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Time entries
-- ---------------------------------------------------------------------
create table public.time_entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references public.profiles(id),
  client_id       bigint not null references public.clients(id),
  property        text,
  entry_date      date not null,
  hours           numeric(5, 2) not null
                  check (hours > 0 and hours <= 24 and mod(hours * 4, 1) = 0),
  service_type_id bigint references public.service_types(id),
  description     text not null check (char_length(btrim(description)) between 1 and 500),
  site_minimum    boolean not null default false,
  origination     boolean not null default false,
  status          text not null default 'pending' check (status in ('pending', 'approved')),
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  qb_exported_at  timestamptz,
  qb_exported_by  uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index time_entries_user_date on public.time_entries (user_id, entry_date);
create index time_entries_date on public.time_entries (entry_date);
create index time_entries_client on public.time_entries (client_id);

create table public.entry_materials (
  id          bigint generated always as identity primary key,
  entry_id    uuid not null references public.time_entries(id) on delete cascade,
  material_id bigint references public.materials(id),
  name        text not null,
  quantity    numeric(10, 2) not null check (quantity > 0),
  unit        text,
  unit_price  numeric(10, 2),
  -- true when the person typed a material that is not on the list yet
  is_new      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index entry_materials_entry on public.entry_materials (entry_id);

-- Every add, change and delete is kept here (who, when, before and after)
create table public.entry_history (
  id          bigint generated always as identity primary key,
  entry_id    uuid not null,
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  action      text not null,
  old_data    jsonb,
  new_data    jsonb
);
create index entry_history_entry on public.entry_history (entry_id);

-- Consultants cannot approve their own time, change who owns an entry,
-- or change an entry once it is approved.
create or replace function public.guard_time_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not is_admin() then
      new.user_id := auth.uid();
      new.status := 'pending';
      new.approved_by := null; new.approved_at := null;
      new.qb_exported_at := null; new.qb_exported_by := null;
    end if;
  else
    if not is_admin() then
      if old.status <> 'pending' then
        raise exception 'Locked for billing, contact an admin';
      end if;
      new.user_id := old.user_id;
      new.status := old.status;
      new.approved_by := old.approved_by; new.approved_at := old.approved_at;
      new.qb_exported_at := old.qb_exported_at; new.qb_exported_by := old.qb_exported_by;
    end if;
    new.updated_at := now();
  end if;
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.status = 'pending' then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end $$;

create trigger time_entries_guard
  before insert or update on public.time_entries
  for each row execute function public.guard_time_entry();

create or replace function public.log_time_entry() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into entry_history (entry_id, changed_by, action, old_data, new_data)
  values (
    coalesce(new.id, old.id),
    auth.uid(),
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger time_entries_history
  after insert or update or delete on public.time_entries
  for each row execute function public.log_time_entry();

-- Saves an entry and its materials together (all or nothing)
create or replace function public.save_entry(p_entry jsonb, p_materials jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
begin
  if coalesce(p_entry ->> 'id', '') = '' then
    insert into time_entries (user_id, client_id, property, entry_date, hours,
                              service_type_id, description, site_minimum, origination)
    values (
      coalesce(nullif(p_entry ->> 'user_id', '')::uuid, auth.uid()),
      (p_entry ->> 'client_id')::bigint,
      nullif(btrim(p_entry ->> 'property'), ''),
      (p_entry ->> 'entry_date')::date,
      (p_entry ->> 'hours')::numeric,
      nullif(p_entry ->> 'service_type_id', '')::bigint,
      btrim(p_entry ->> 'description'),
      coalesce((p_entry ->> 'site_minimum')::boolean, false),
      coalesce((p_entry ->> 'origination')::boolean, false)
    )
    returning id into v_id;
  else
    v_id := (p_entry ->> 'id')::uuid;
    update time_entries set
      client_id       = (p_entry ->> 'client_id')::bigint,
      property        = nullif(btrim(p_entry ->> 'property'), ''),
      entry_date      = (p_entry ->> 'entry_date')::date,
      hours           = (p_entry ->> 'hours')::numeric,
      service_type_id = nullif(p_entry ->> 'service_type_id', '')::bigint,
      description     = btrim(p_entry ->> 'description'),
      site_minimum    = coalesce((p_entry ->> 'site_minimum')::boolean, false),
      origination     = coalesce((p_entry ->> 'origination')::boolean, false)
    where id = v_id;
    if not found then
      raise exception 'Locked for billing, contact an admin';
    end if;
    delete from entry_materials where entry_id = v_id;
  end if;

  insert into entry_materials (entry_id, material_id, name, quantity, unit, unit_price, is_new)
  select v_id,
         nullif(m ->> 'material_id', '')::bigint,
         btrim(m ->> 'name'),
         (m ->> 'quantity')::numeric,
         nullif(m ->> 'unit', ''),
         nullif(m ->> 'unit_price', '')::numeric,
         coalesce((m ->> 'is_new')::boolean, false)
  from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb)) as m
  where coalesce(btrim(m ->> 'name'), '') <> '';

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Security rules (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.invitations     enable row level security;
alter table public.clients         enable row level security;
alter table public.service_types   enable row level security;
alter table public.materials       enable row level security;
alter table public.time_entries    enable row level security;
alter table public.entry_materials enable row level security;
alter table public.entry_history   enable row level security;

-- People: you see yourself; admins see and manage everyone
create policy "profiles read"   on public.profiles for select using (id = auth.uid() or is_admin());
create policy "profiles admin"  on public.profiles for update using (is_admin()) with check (is_admin());

create policy "invitations admin" on public.invitations for all using (is_admin()) with check (is_admin());

-- Lists: everyone signed in can read; only admins change
create policy "clients read"   on public.clients for select using (is_active_user());
create policy "clients admin"  on public.clients for all using (is_admin()) with check (is_admin());
create policy "services read"  on public.service_types for select using (is_active_user());
create policy "services admin" on public.service_types for all using (is_admin()) with check (is_admin());
create policy "materials read"  on public.materials for select using (is_active_user());
create policy "materials admin" on public.materials for all using (is_admin()) with check (is_admin());

-- Time: consultants see and change only their own, and only until approved
create policy "entries read" on public.time_entries for select
  using (user_id = auth.uid() or is_admin());
create policy "entries add" on public.time_entries for insert
  with check (is_active_user() and (user_id = auth.uid() or is_admin()));
create policy "entries change" on public.time_entries for update
  using (is_admin() or (user_id = auth.uid() and status = 'pending' and is_active_user()))
  with check (is_admin() or user_id = auth.uid());
create policy "entries delete" on public.time_entries for delete
  using (is_admin() or (user_id = auth.uid() and status = 'pending' and is_active_user()));

create policy "entry materials read" on public.entry_materials for select
  using (exists (select 1 from time_entries e where e.id = entry_id));
create policy "entry materials write" on public.entry_materials for all
  using (exists (select 1 from time_entries e where e.id = entry_id
                 and (is_admin() or (e.user_id = auth.uid() and e.status = 'pending'))))
  with check (exists (select 1 from time_entries e where e.id = entry_id
                 and (is_admin() or (e.user_id = auth.uid() and e.status = 'pending'))));

create policy "history read" on public.entry_history for select using (is_admin());
