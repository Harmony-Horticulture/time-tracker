-- =====================================================================
-- November 18, 2026 update. Run this once (SQL Editor > New query >
-- paste > Run), after 01, 02 and 03. Safe to run again.
--
-- Adds:
--  - services from the QuickBooks Products and Services list; items with a
--    person's name are only offered to that person
--  - materials from the Materials Price List Google Sheet (store, unit, price)
--  - customers matched on their QuickBooks full name, with a one-off marker
--  - site minimum as a dollar amount instead of yes/no
--  - import tools the app uses to refresh these lists from files
-- =====================================================================

-- ---------- new columns ----------
alter table public.clients       add column if not exists one_off boolean not null default false;
alter table public.service_types add column if not exists category   text;
alter table public.service_types add column if not exists for_person text;   -- null = everyone
alter table public.service_types add column if not exists rate       numeric(10, 2);
alter table public.materials     add column if not exists store         text;
alter table public.materials     add column if not exists cost          numeric(10, 2);
alter table public.materials     add column if not exists unit_size     text;
alter table public.materials     add column if not exists client_charge text;
alter table public.time_entries  add column if not exists site_minimum_amount numeric(10, 2)
  check (site_minimum_amount is null or site_minimum_amount >= 0);

-- ---------- save_entry now takes the site minimum amount ----------
create or replace function public.save_entry(p_entry jsonb, p_materials jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_min numeric := nullif(p_entry ->> 'site_minimum_amount', '')::numeric;
begin
  if coalesce(p_entry ->> 'id', '') = '' then
    insert into time_entries (user_id, client_id, property, entry_date, hours, service_type_id,
                              description, site_minimum, site_minimum_amount, origination)
    values (
      coalesce(nullif(p_entry ->> 'user_id', '')::uuid, auth.uid()),
      (p_entry ->> 'client_id')::bigint,
      nullif(btrim(p_entry ->> 'property'), ''),
      (p_entry ->> 'entry_date')::date,
      (p_entry ->> 'hours')::numeric,
      nullif(p_entry ->> 'service_type_id', '')::bigint,
      btrim(p_entry ->> 'description'),
      coalesce(v_min, 0) > 0,
      v_min,
      coalesce((p_entry ->> 'origination')::boolean, false)
    )
    returning id into v_id;
  else
    v_id := (p_entry ->> 'id')::uuid;
    update time_entries set
      client_id           = (p_entry ->> 'client_id')::bigint,
      property            = nullif(btrim(p_entry ->> 'property'), ''),
      entry_date          = (p_entry ->> 'entry_date')::date,
      hours               = (p_entry ->> 'hours')::numeric,
      service_type_id     = nullif(p_entry ->> 'service_type_id', '')::bigint,
      description         = btrim(p_entry ->> 'description'),
      site_minimum        = coalesce(v_min, 0) > 0,
      site_minimum_amount = v_min,
      origination         = coalesce((p_entry ->> 'origination')::boolean, false)
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

-- ---------- import tools (admins only, through the security rules) ----------
-- Customers: matched on QuickBooks full name. Returns counts.
create or replace function public.import_clients(p_rows jsonb, p_turn_off_missing boolean default false)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  r jsonb; v_name text; v_id bigint; ids bigint[] := '{}'; added int := 0; updated int := 0; off int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    v_name := btrim(r ->> 'full_name');
    continue when coalesce(v_name, '') = '';
    select id into v_id from clients
      where lower(coalesce(qb_name, '')) = lower(v_name) or lower(name) = lower(v_name)
      order by (lower(coalesce(qb_name, '')) = lower(v_name)) desc limit 1;
    if found then
      update clients set qb_name = v_name, active = true where id = v_id;
      updated := updated + 1;
    else
      insert into clients (name, qb_name, properties) values (v_name, v_name, '{}') returning id into v_id;
      added := added + 1;
    end if;
    ids := ids || v_id;
  end loop;
  if p_turn_off_missing then
    update clients set active = false where active and not (id = any (ids));
    get diagnostics off = row_count;
  end if;
  return jsonb_build_object('added', added, 'updated', updated, 'turned_off', off);
end $$;

-- Materials: matched on name (not case sensitive)
create or replace function public.import_materials(p_rows jsonb, p_turn_off_missing boolean default false)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  r jsonb; v_id bigint; ids bigint[] := '{}'; added int := 0; updated int := 0; off int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    continue when coalesce(btrim(r ->> 'name'), '') = '';
    select id into v_id from materials where lower(name) = lower(btrim(r ->> 'name')) limit 1;
    if found then
      update materials set
        name = btrim(r ->> 'name'), store = nullif(r ->> 'store', ''), unit = coalesce(nullif(r ->> 'unit', ''), 'each'),
        price = nullif(r ->> 'price', '')::numeric, cost = nullif(r ->> 'cost', '')::numeric,
        unit_size = nullif(r ->> 'unit_size', ''), client_charge = nullif(r ->> 'client_charge', ''), active = true
      where id = v_id;
      updated := updated + 1;
    else
      insert into materials (name, store, unit, price, cost, unit_size, client_charge)
      values (btrim(r ->> 'name'), nullif(r ->> 'store', ''), coalesce(nullif(r ->> 'unit', ''), 'each'),
              nullif(r ->> 'price', '')::numeric, nullif(r ->> 'cost', '')::numeric,
              nullif(r ->> 'unit_size', ''), nullif(r ->> 'client_charge', ''))
      returning id into v_id;
      added := added + 1;
    end if;
    ids := ids || v_id;
  end loop;
  if p_turn_off_missing then
    update materials set active = false where active and not (id = any (ids));
    get diagnostics off = row_count;
  end if;
  return jsonb_build_object('added', added, 'updated', updated, 'turned_off', off);
end $$;

-- Services: matched on name. New items take their on/off setting from the file;
-- existing items keep whatever an admin set.
create or replace function public.import_services(p_rows jsonb, p_turn_off_missing boolean default false)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  r jsonb; v_id bigint; ids bigint[] := '{}'; added int := 0; updated int := 0; off int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    continue when coalesce(btrim(r ->> 'name'), '') = '';
    select id into v_id from service_types where lower(name) = lower(btrim(r ->> 'name')) limit 1;
    if found then
      update service_types set
        category = nullif(r ->> 'category', ''), qb_item = r ->> 'qb_item', for_person = nullif(r ->> 'for_person', ''),
        rate = nullif(r ->> 'rate', '')::numeric, billable = coalesce((r ->> 'billable')::boolean, true),
        help_text = nullif(r ->> 'help_text', '')
      where id = v_id;
      updated := updated + 1;
    else
      insert into service_types (name, category, qb_item, for_person, rate, billable, active, help_text, sort_order)
      values (btrim(r ->> 'name'), nullif(r ->> 'category', ''), r ->> 'qb_item', nullif(r ->> 'for_person', ''),
              nullif(r ->> 'rate', '')::numeric, coalesce((r ->> 'billable')::boolean, true),
              coalesce((r ->> 'active')::boolean, true), nullif(r ->> 'help_text', ''),
              coalesce((r ->> 'sort_order')::int, 100))
      returning id into v_id;
      added := added + 1;
    end if;
    ids := ids || v_id;
  end loop;
  if p_turn_off_missing then
    update service_types set active = false where active and not (id = any (ids));
    get diagnostics off = row_count;
  end if;
  return jsonb_build_object('added', added, 'updated', updated, 'turned_off', off);
end $$;

-- ---------- load the lists ----------
-- Services from QuickBooks (the three starter service types are turned off)
select public.import_services('[{"name": "ADMIN- Robbie", "category": "Labor", "qb_item": "Labor:ADMIN- Robbie", "for_person": "Robbie Stephens", "rate": null, "billable": false, "active": true, "help_text": "", "sort_order": 1}, {"name": "Educational Service", "category": "Consulting Time", "qb_item": "Consulting Time:Educational Service", "for_person": null, "rate": null, "billable": true, "active": true, "help_text": "Educational and training services provided.", "sort_order": 2}, {"name": "Fall Rose Service", "category": "Labor + Materials", "qb_item": "Labor + Materials:Fall Rose Service", "for_person": null, "rate": 25, "billable": true, "active": true, "help_text": "Fall Rose Service: Pruning, Soil Amending, Fertilizing Small: $15, Med $25, Lg $35", "sort_order": 3}, {"name": "Horticultural Consulting Kasey Harman", "category": "Consulting Time", "qb_item": "Consulting Time:Horticultural Consulting Kasey Harman", "for_person": "Kasey Harman", "rate": 200, "billable": true, "active": true, "help_text": "Landscape Oversight, diagnostics, recommendations", "sort_order": 4}, {"name": "Horticultural Consulting Kristen Battafarano", "category": "Consulting Time", "qb_item": "Consulting Time:Horticultural Consulting Kristen Battafarano", "for_person": "Kristen Battafarano", "rate": 150, "billable": true, "active": true, "help_text": "Landscape Oversight, diagnostics, recommendations", "sort_order": 5}, {"name": "Horticultural Consulting Robbie Stephens", "category": "Consulting Time", "qb_item": "Consulting Time:Horticultural Consulting Robbie Stephens", "for_person": "Robbie Stephens", "rate": 150, "billable": true, "active": true, "help_text": "Landscape Oversight, diagnostics, recommendations", "sort_order": 6}, {"name": "Horticultural Consulting; Kristen Battafarano ORG", "category": "Consulting Time", "qb_item": "Consulting Time:Horticultural Consulting; Kristen Battafarano ORG", "for_person": "Kristen Battafarano", "rate": 150, "billable": true, "active": true, "help_text": "Landscape Oversight, plant health diagnosis, water management, recommendations", "sort_order": 7}, {"name": "Horticultural Consulting; Robbie Stephens ORG", "category": "Consulting Time", "qb_item": "Consulting Time:Horticultural Consulting; Robbie Stephens ORG", "for_person": "Robbie Stephens", "rate": 150, "billable": true, "active": true, "help_text": "Landscape Oversight, plant health diagnosis, water management, recommendations", "sort_order": 8}, {"name": "Horticultural Consulting; Site Inspection Kasey Harman", "category": "Consulting Time", "qb_item": "Consulting Time:Horticultural Consulting; Site Inspection Kasey Harman", "for_person": "Kasey Harman", "rate": 400, "billable": true, "active": true, "help_text": "On-site consulting and plant diagnosis.", "sort_order": 9}, {"name": "Horticultural Consulting; Site Inspection Kristen Battafarano", "category": "Consulting Time", "qb_item": "Consulting Time:Horticultural Consulting; Site Inspection Kristen Battafarano", "for_person": "Kristen Battafarano", "rate": 350, "billable": true, "active": true, "help_text": "On-site consulting and plant diagnosis.", "sort_order": 10}, {"name": "Horticultural Consulting; Site Inspection Robbie Stephens", "category": "Consulting Time", "qb_item": "Consulting Time:Horticultural Consulting; Site Inspection Robbie Stephens", "for_person": "Robbie Stephens", "rate": 350, "billable": true, "active": true, "help_text": "On-site consulting and plant diagnosis.", "sort_order": 11}, {"name": "Horticultural Technician", "category": "Consulting Time", "qb_item": "Consulting Time:Horticultural Technician", "for_person": "Stephanie Lara", "rate": 85, "billable": true, "active": true, "help_text": "Horticultural Technician: Stephanie Lara", "sort_order": 12}, {"name": "Hours", "category": "", "qb_item": "Hours", "for_person": null, "rate": null, "billable": true, "active": false, "help_text": "", "sort_order": 13}, {"name": "Labor", "category": "Labor", "qb_item": "Labor:Labor", "for_person": null, "rate": 55, "billable": true, "active": true, "help_text": "Labor, Installation", "sort_order": 14}, {"name": "Laboratory Fees", "category": "Laboratory Fees", "qb_item": "Laboratory Fees:Laboratory Fees", "for_person": null, "rate": 80, "billable": true, "active": false, "help_text": "Laboratory testing and analysis fees.", "sort_order": 15}, {"name": "Other - Miscellaneous", "category": "", "qb_item": "Other - Miscellaneous", "for_person": null, "rate": null, "billable": true, "active": false, "help_text": "Miscellaneous services or fees.", "sort_order": 16}, {"name": "Services", "category": "", "qb_item": "Services", "for_person": null, "rate": null, "billable": true, "active": false, "help_text": "", "sort_order": 17}, {"name": "Tips", "category": "", "qb_item": "Tips", "for_person": null, "rate": null, "billable": true, "active": false, "help_text": "", "sort_order": 18}, {"name": "Travel Fee", "category": "Consulting Time", "qb_item": "Consulting Time:Travel Fee", "for_person": null, "rate": null, "billable": true, "active": true, "help_text": "", "sort_order": 19}, {"name": "Vendor Irrigation Services", "category": "Subcontracted Services", "qb_item": "Subcontracted Services:Vendor Irrigation Services", "for_person": null, "rate": 100, "billable": true, "active": false, "help_text": "Irrigation Services; Troubleshooting, Repairs, Installations", "sort_order": 20}, {"name": "Vendor Pest Treatment- Adaptive", "category": "Subcontrated Treatments", "qb_item": "Subcontrated Treatments:Vendor Pest Treatment- Adaptive", "for_person": null, "rate": null, "billable": true, "active": false, "help_text": "Adaptive Plant Health and Weed Solutions Lic # 10512", "sort_order": 21}, {"name": "Vendor Pest Treatment- American", "category": "Subcontrated Treatments", "qb_item": "Subcontrated Treatments:Vendor Pest Treatment- American", "for_person": null, "rate": 100, "billable": true, "active": false, "help_text": "American Tree and Plant Solutions Lic # 10154", "sort_order": 22}, {"name": "Vendor Plant Health Care- Adaptive", "category": "Subcontrated Treatments", "qb_item": "Subcontrated Treatments:Vendor Plant Health Care- Adaptive", "for_person": null, "rate": null, "billable": true, "active": false, "help_text": "Adaptive Plant Health and Weed Solutions Lic # 10512", "sort_order": 23}, {"name": "Vendor Plant Health Care- American", "category": "Subcontrated Treatments", "qb_item": "Subcontrated Treatments:Vendor Plant Health Care- American", "for_person": null, "rate": null, "billable": true, "active": false, "help_text": "American Tree and Plant Solutions Lic # 10154", "sort_order": 24}, {"name": "Vendor Services Handyman", "category": "Subcontracted Services", "qb_item": "Subcontracted Services:Vendor Services Handyman", "for_person": null, "rate": 100, "billable": true, "active": false, "help_text": "Handman Repairs", "sort_order": 25}, {"name": "Vendor Tree Service", "category": "Subcontracted Services", "qb_item": "Subcontracted Services:Vendor Tree Service", "for_person": null, "rate": 500, "billable": true, "active": false, "help_text": "Tree Service: Tree Pruning", "sort_order": 26}, {"name": "Water Management", "category": "Consulting Time", "qb_item": "Consulting Time:Water Management", "for_person": null, "rate": 75, "billable": true, "active": true, "help_text": "Irrigation adjustments", "sort_order": 27}]'::jsonb, true);

-- Materials from the Materials Price List sheet (older starter names are turned off)
select public.import_materials('[{"name": "Twist Ties", "store": "Amazon", "unit": "ft", "price": 0.08, "cost": 9.15, "unit_size": "100 m = 328 ft", "client_charge": "$ .08 cents / ft"}, {"name": "Anchors", "store": "Amazon", "unit": "each", "price": 0.19, "cost": 10.46, "unit_size": "80 ct", "client_charge": "$ .19 cents / each"}, {"name": "Liquid Nails", "store": "Ace Hardware", "unit": "2.5 oz", "price": 10.88, "cost": 7.62, "unit_size": "2.5 oz", "client_charge": "$10.88 / 2.5 oz"}, {"name": "Miracle-Gro (green box)", "store": "Amazon", "unit": "tbsp", "price": 0.2, "cost": 26.17, "unit_size": "12.5 lbs = 200 oz", "client_charge": "$.20 / tbsp"}, {"name": "Rose Miracle Gro (pink)", "store": "Amazon", "unit": "tbsp", "price": 0.3, "cost": 51.52, "unit_size": "9 lbs = 144 oz", "client_charge": "$.30 / tbsp"}, {"name": "AZ Best Citrus Fert", "store": "Home Depot", "unit": "tbsp", "price": 0.4, "cost": 11.96, "unit_size": "5 lbs = 80 oz", "client_charge": "$.40 / tbsp"}, {"name": "Jobes Rose", "store": "Amazon", "unit": "cup", "price": 2.4, "cost": 38.5, "unit_size": "16 lbs = 256 oz", "client_charge": "$2.40 / cup"}, {"name": "Scotts Rose", "store": "Amazon", "unit": "tbsp", "price": 0.16, "cost": 10.72, "unit_size": "3 lbs = 48 oz", "client_charge": "$.16 / tbsp"}, {"name": "BioAdvanced 3 in 1", "store": "Amazon", "unit": "lid", "price": 2.6, "cost": 23.72, "unit_size": "4 lbs = 64 oz", "client_charge": "$. 2.60 / lid"}, {"name": "Langneinte", "store": "Amazon", "unit": "tbsp", "price": 0.1, "cost": 32.68, "unit_size": "5 lbs = 80 oz", "client_charge": "$.10 cents / tbsp"}, {"name": "Essential Plus (fish)", "store": "Target Specialty Products", "unit": "8 oz", "price": 12, "cost": 75.63, "unit_size": "1 gal = 128 fl oz", "client_charge": "$12.00 / 8 oz"}, {"name": "MitoGro", "store": "Direct (Chris)", "unit": "tbsp", "price": 4.5, "cost": 55, "unit_size": "1 lb = 16 oz", "client_charge": "$4.50 / tbsp"}, {"name": "EcoMaxx 3-2-2", "store": "Sprinkler World (2026)", "unit": "gallon", "price": 68.55, "cost": 102.83, "unit_size": "2.5 gal = 320 oz", "client_charge": "$68.55 / gallon"}, {"name": "Shade Cloth 50% white per yard", "store": "AZ Bag", "unit": "ft", "price": 4.96, "cost": 10.42, "unit_size": "1 yard = 3 ft", "client_charge": "$4.96 / ft"}, {"name": "Mirimichi Green CarbonizPN Soil Enhancer", "store": "Ewing", "unit": "cup", "price": 0.42, "cost": 42.58, "unit_size": "40 lb = 640 oz", "client_charge": "$.42 / cup = $ .11 cents / oz"}, {"name": "Mirimichi Granular", "store": "Ewing", "unit": "cup", "price": 0.75, "cost": 41.59, "unit_size": "40 lb = 640 oz", "client_charge": "$.75 / cup = $0.09 cents / oz"}, {"name": "Aqueduct Flex Granular", "store": "", "unit": "each", "price": null, "cost": null, "unit_size": "44 lb = 704", "client_charge": ""}, {"name": "Greening Pins", "store": "Walmart", "unit": "each", "price": 0.06, "cost": 1.6, "unit_size": "50 ct", "client_charge": "$.06 cents / each"}, {"name": "Push Pins", "store": "Walmart", "unit": "each", "price": 0.04, "cost": 4.88, "unit_size": "200 ct", "client_charge": "$.04 cents / each"}, {"name": "Bonide Sulfur Organic Concentrated Dust Fungicide", "store": "Ace Hardware", "unit": "tbsp", "price": 0.58, "cost": 10.9, "unit_size": "1 lb = 16 oz", "client_charge": "$.58 / tbsp = $.19 cents / tsp"}, {"name": "AZ Best Soil Sulfer", "store": "Berridge Nurseries", "unit": "tbsp", "price": 0.13, "cost": 12, "unit_size": "5 lbs = 80 oz", "client_charge": "$. 13 cents / tbsp"}, {"name": "AZ Best KeRex Super Iron Chelate", "store": "Berridge Nurseries", "unit": "tbsp", "price": 0.63, "cost": 20.73, "unit_size": "1 lb 12 oz = 28 oz", "client_charge": "$.63 cents / tbsp"}, {"name": "Dr. Earth Acid Lovers Fertilizer", "store": "Home Depot", "unit": "tbsp", "price": 1.02, "cost": 19.44, "unit_size": "4 lbs = 16 oz", "client_charge": "$1.02 cents / tbsp"}, {"name": "Miracle-Gro Azalea Camellia Rhododendron Fert", "store": "Home Depot", "unit": "tbsp", "price": 0.44, "cost": 12.51, "unit_size": "1.5 lbs = 24 oz", "client_charge": "$.44 cents / tbsp"}, {"name": "Moisture Aid (rainbow)", "store": "", "unit": "each", "price": null, "cost": null, "unit_size": "", "client_charge": ""}, {"name": "Hydretain ES +", "store": "Target Specialty Products", "unit": "each", "price": 0.46, "cost": 114, "unit_size": "2.5 gal=320 oz", "client_charge": "$0.46"}, {"name": "Hydretain granular", "store": "Target Specialty Products", "unit": "each", "price": null, "cost": null, "unit_size": "", "client_charge": ""}, {"name": "Worm Castings", "store": "AZ Worm Farm", "unit": "cup", "price": 1.9, "cost": 229.11, "unit_size": "40 gal ~ 150 cups", "client_charge": "$1.90 / cup"}, {"name": "Epsom Salt", "store": "Amazonn", "unit": "each", "price": null, "cost": 39.22, "unit_size": "18 lb", "client_charge": ""}, {"name": "Rainbird Tech line 1/2\" .9gph soaker line", "store": "", "unit": "foot", "price": 1.5, "cost": 9.58, "unit_size": "foot", "client_charge": "1.50/ foot"}, {"name": "AZ Worm Farm Compost", "store": "", "unit": "each", "price": null, "cost": null, "unit_size": "", "client_charge": ""}, {"name": "Bonide Captain Jack''s Neem Oil", "store": "Amazon", "unit": "oz", "price": 0.65, "cost": 12.51, "unit_size": "32 oz", "client_charge": "$0.65 / oz"}, {"name": "Epsoak Ag Epsom Salt /MgSO", "store": "Amazon", "unit": "tbsp", "price": 0.2, "cost": 39.22, "unit_size": "18 lbs / 288 oz/ 326 tbsp", "client_charge": "$.20 / tbsp"}, {"name": "Ewing Irrigation soaker line", "store": "", "unit": "100 ft", "price": 44.33, "cost": 29.56, "unit_size": "/100 ft", "client_charge": "$44.33 / 100 ft"}]'::jsonb, true);
