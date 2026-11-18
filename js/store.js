// =====================================================================
// Data layer. The rest of the app only talks to `Store`, which is either
// the live Supabase database or a demo copy kept in this browser.
// =====================================================================
(function () {
  const cfg = window.HH_CONFIG || {};
  const LIVE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  const ENTRY_SELECT =
    "*, client:clients(name,qb_name,one_off), " +
    "person:profiles!time_entries_user_id_fkey(full_name,qb_name,email), " +
    "service:service_types(name,qb_item,billable), materials:entry_materials(*)";

  function normalizeEntry(e) {
    return {
      id: e.id,
      user_id: e.user_id,
      person_name: e.person ? e.person.full_name || e.person.email : "",
      person_qb_name: e.person ? e.person.qb_name : null,
      person_email: e.person ? e.person.email : "",
      client_id: e.client_id,
      client_name: e.client ? e.client.name : "",
      client_qb_name: e.client ? e.client.qb_name : null,
      client_one_off: !!(e.client && e.client.one_off),
      property: e.property || "",
      entry_date: e.entry_date,
      hours: Number(e.hours),
      service_type_id: e.service_type_id,
      service_name: e.service ? e.service.name : "",
      service_qb_item: e.service ? e.service.qb_item : "",
      service_billable: e.service ? e.service.billable !== false : true,
      description: e.description,
      site_minimum: !!e.site_minimum,
      site_minimum_amount: e.site_minimum_amount == null ? (e.site_minimum ? 0 : null) : Number(e.site_minimum_amount),
      origination: !!e.origination,
      status: e.status,
      approved_at: e.approved_at,
      qb_exported_at: e.qb_exported_at,
      created_at: e.created_at,
      updated_at: e.updated_at,
      materials: (e.materials || [])
        .slice()
        .sort((a, b) => (a.id > b.id ? 1 : -1))
        .map((m) => ({
          id: m.id,
          material_id: m.material_id,
          name: m.name,
          quantity: Number(m.quantity),
          unit: m.unit || "",
          unit_price: m.unit_price == null ? null : Number(m.unit_price),
          is_new: !!m.is_new,
        })),
    };
  }

  function friendlyError(err) {
    if (!err) return "Something went wrong.";
    const msg = err.message || String(err);
    if (/hours_check/.test(msg)) return "Hours must be more than 0, at most 24, in 0.25 steps.";
    if (/description_check/.test(msg)) return "Please add a description (up to 500 characters).";
    if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
    if (/Invalid login credentials/i.test(msg)) return "That email and password don't match.";
    if (/duplicate key/i.test(msg)) return "That name is already on the list.";
    if (/does not exist|schema cache|PGRST20/i.test(msg)) return "The database isn't set up yet. Run supabase/01_schema.sql and 02_seed.sql in the Supabase SQL Editor (see docs/SETUP.md).";
    if (/Failed to fetch|NetworkError/i.test(msg)) return "Can't reach the database. Check your internet connection and try again.";
    return msg;
  }

  const numOrNull = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
  function materialRow(m) {
    return {
      name: m.name, unit: m.unit || "each", price: numOrNull(m.price), cost: numOrNull(m.cost),
      store: m.store || null, unit_size: m.unit_size || null, client_charge: m.client_charge || null, active: m.active !== false,
    };
  }
  function serviceRow(s) {
    return {
      name: s.name, help_text: s.help_text || null, qb_item: s.qb_item, category: s.category || null,
      for_person: s.for_person || null, rate: numOrNull(s.rate), billable: s.billable !== false,
      sort_order: Number(s.sort_order) || 0, active: s.active !== false,
    };
  }

  // -------------------------------------------------------------------
  // Live (Supabase)
  // -------------------------------------------------------------------
  function makeLiveStore() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    let recovery = false;

    async function check(res) {
      if (res.error) throw new Error(friendlyError(res.error));
      return res.data;
    }

    async function fetchAll(buildQuery) {
      const size = 1000;
      let from = 0;
      let out = [];
      for (;;) {
        const data = await check(await buildQuery().range(from, from + size - 1));
        out = out.concat(data);
        if (data.length < size) return out;
        from += size;
      }
    }

    const redirectTo = () => window.location.origin + window.location.pathname;

    return {
      mode: "live",
      onAuthChange(cb) {
        sb.auth.onAuthStateChange((event) => {
          if (event === "PASSWORD_RECOVERY") recovery = true;
          // Run outside the auth callback (Supabase recommends not awaiting inside it)
          setTimeout(() => cb(event), 0);
        });
      },
      async getCurrentProfile() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return null;
        const user = data.session.user;
        const profile = await check(
          await sb.from("profiles").select("*").eq("id", user.id).maybeSingle()
        );
        if (!profile) return null;
        profile.needs_password = recovery || !(user.user_metadata && user.user_metadata.password_set);
        return profile;
      },
      async signIn(email, password) {
        await check(await sb.auth.signInWithPassword({ email: email.trim(), password }));
      },
      async signOut() {
        await sb.auth.signOut();
      },
      async sendPasswordReset(email) {
        await check(await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo() }));
      },
      async setPassword(password) {
        await check(await sb.auth.updateUser({ password, data: { password_set: true } }));
        recovery = false;
      },
      async loadLists() {
        const [clients, materials, serviceTypes] = await Promise.all([
          fetchAll(() => sb.from("clients").select("*").order("name")),
          fetchAll(() => sb.from("materials").select("*").order("name")),
          check(await sb.from("service_types").select("*").order("sort_order").order("name")),
        ]);
        return { clients, materials, serviceTypes };
      },
      async listProfiles() {
        return check(await sb.from("profiles").select("*").order("full_name"));
      },
      async listInvitations() {
        return check(await sb.from("invitations").select("*").is("accepted_at", null).order("invited_at"));
      },
      async listEntries(f = {}) {
        const rows = await fetchAll(() => {
          let q = sb.from("time_entries").select(ENTRY_SELECT);
          if (f.userId) q = q.eq("user_id", f.userId);
          if (f.userIds && f.userIds.length) q = q.in("user_id", f.userIds);
          if (f.clientId) q = q.eq("client_id", f.clientId);
          if (f.from) q = q.gte("entry_date", f.from);
          if (f.to) q = q.lte("entry_date", f.to);
          if (f.status) q = q.eq("status", f.status);
          if (f.notExported) q = q.is("qb_exported_at", null);
          if (f.exported) q = q.not("qb_exported_at", "is", null);
          if (f.since) q = q.gte("entry_date", f.since);
          return q.order("entry_date", { ascending: false }).order("created_at", { ascending: false });
        });
        return rows.map(normalizeEntry);
      },
      async saveEntry(entry, materials) {
        return check(await sb.rpc("save_entry", { p_entry: entry, p_materials: materials }));
      },
      async deleteEntry(id) {
        const data = await check(await sb.from("time_entries").delete().eq("id", id).select("id"));
        if (!data.length) throw new Error("Locked for billing, contact an admin");
      },
      // Lets people change entries again and puts them back in the next QuickBooks file
      async unlock(ids) {
        await check(await sb.from("time_entries").update({ status: "pending", qb_exported_at: null, qb_exported_by: null }).in("id", ids));
      },
      async markExported(ids) {
        const { data } = await sb.auth.getUser();
        await check(
          await sb
            .from("time_entries")
            .update({ qb_exported_at: new Date().toISOString(), qb_exported_by: data.user.id, status: "approved" }) // locked once billed
            .in("id", ids)
        );
      },
      async invite({ email, full_name, role }) {
        email = email.trim().toLowerCase();
        const { data } = await sb.auth.getUser();
        await check(
          await sb
            .from("invitations")
            .upsert({ email, full_name, role, invited_by: data.user.id, invited_at: new Date().toISOString() })
        );
        // Sends the invitation email with a sign-in link
        await check(
          await sb.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: true, emailRedirectTo: redirectTo(), data: { full_name } },
          })
        );
      },
      async updateProfile(id, patch) {
        await check(await sb.from("profiles").update(patch).eq("id", id));
      },
      async saveClient(c) {
        const row = { name: c.name, qb_name: c.qb_name || null, properties: c.properties || [], one_off: !!c.one_off, active: c.active !== false };
        if (c.id) await check(await sb.from("clients").update(row).eq("id", c.id));
        else await check(await sb.from("clients").insert(row));
      },
      async saveMaterial(m) {
        const row = materialRow(m);
        if (m.id) {
          await check(await sb.from("materials").update(row).eq("id", m.id));
          return m.id;
        }
        const data = await check(await sb.from("materials").insert(row).select("id").single());
        return data.id;
      },
      async saveServiceType(s) {
        const row = serviceRow(s);
        if (s.id) await check(await sb.from("service_types").update(row).eq("id", s.id));
        else await check(await sb.from("service_types").insert(row));
      },
      async importClients(rows, turnOff) {
        return check(await sb.rpc("import_clients", { p_rows: rows, p_turn_off_missing: !!turnOff }));
      },
      async importMaterials(rows, turnOff) {
        return check(await sb.rpc("import_materials", { p_rows: rows, p_turn_off_missing: !!turnOff }));
      },
      async importServices(rows, turnOff) {
        return check(await sb.rpc("import_services", { p_rows: rows, p_turn_off_missing: !!turnOff }));
      },
      async listNewMaterials() {
        const rows = await check(
          await sb
            .from("entry_materials")
            .select("*, entry:time_entries(entry_date, client:clients(name), person:profiles!time_entries_user_id_fkey(full_name))")
            .eq("is_new", true)
            .order("created_at", { ascending: false })
        );
        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          quantity: Number(r.quantity),
          unit: r.unit,
          entry_date: r.entry && r.entry.entry_date,
          client_name: r.entry && r.entry.client ? r.entry.client.name : "",
          person_name: r.entry && r.entry.person ? r.entry.person.full_name : "",
        }));
      },
      async resolveNewMaterial(entryMaterialId, materialId) {
        await check(
          await sb.from("entry_materials").update({ is_new: false, material_id: materialId || null }).eq("id", entryMaterialId)
        );
      },
      async entryHistory(id) {
        const rows = await check(
          await sb.from("entry_history").select("*").eq("entry_id", id).order("changed_at")
        );
        return rows;
      },
    };
  }

  // -------------------------------------------------------------------
  // Demo (this browser only)
  // -------------------------------------------------------------------
  function makeDemoStore() {
    const KEY = "hh_time_demo_v3";
    const SESSION = "hh_time_demo_session";
    const listeners = [];
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
    const pad = (n) => String(n).padStart(2, "0");
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    function seed() {
      const base = window.HH_DEMO_DATA || { clients: [], materials: [] };
      const people = [
        { id: "u-krista", email: "krista@example.com", full_name: "Krista", role: "admin", qb_name: "Krista", active: true },
        { id: "u-kasey", email: "kasey@example.com", full_name: "Kasey Harman", role: "admin", qb_name: "Kasey Harman", active: true },
        { id: "u-robbie", email: "robbie@example.com", full_name: "Robbie Stephens", role: "consultant", qb_name: "Robbie Stephens", active: true },
        { id: "u-kristen", email: "kristen@example.com", full_name: "Kristen Battafarano", role: "consultant", qb_name: "Kristen Battafarano", active: true },
        { id: "u-stephanie", email: "stephanie@example.com", full_name: "Stephanie Lara", role: "technician", qb_name: "Stephanie Lara", active: true },
      ];
      const serviceTypes = (base.serviceTypes || []).map((x) => ({ ...x }));
      const svc = (name) => { const f = serviceTypes.find((x) => x.name === name); return f ? f.id : null; };
      const samples = [
        ["u-robbie", 1, 1.5, svc("Horticultural Consulting; Site Inspection Robbie Stephens"), "Inspection and report"],
        ["u-robbie", 3, 3, svc("Horticultural Consulting; Robbie Stephens ORG"), "Rose pruning"],
        ["u-robbie", 8, 1, svc("Horticultural Consulting Robbie Stephens"), "Meeting with crew on site"],
        ["u-kristen", 12, 2, svc("Horticultural Consulting; Site Inspection Kristen Battafarano"), "Irrigation check and report"],
        ["u-stephanie", 20, 1.25, svc("Horticultural Technician"), "Fertilization and tank fill"],
        ["u-robbie", 25, 0.5, svc("Horticultural Consulting; Robbie Stephens ORG"), "Controller set"],
      ];
      const today = new Date();
      const entries = samples.map(([user, client, hours, svc, desc], i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (i % 4) - 1);
        return {
          id: uid(), user_id: user, client_id: base.clients[client] ? base.clients[client].id : 1,
          property: "", entry_date: iso(d), hours, service_type_id: svc, description: desc,
          site_minimum: false, origination: false, status: i < 2 ? "approved" : "pending",
          approved_at: i < 2 ? new Date().toISOString() : null, qb_exported_at: i < 2 ? new Date().toISOString() : null,
          created_at: new Date(Date.now() - i * 1000).toISOString(),
          materials: i === 1 && base.materials[3] ? [{ id: 1, material_id: base.materials[3].id, name: base.materials[3].name, quantity: 2, unit: base.materials[3].unit, unit_price: base.materials[3].price, is_new: false }] : [],
        };
      });
      return { people, invitations: [], clients: JSON.parse(JSON.stringify(base.clients)), materials: JSON.parse(JSON.stringify(base.materials)), serviceTypes, entries, history: [], nextId: 1000 };
    }

    let db;
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db) db = seed();
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignore */ } };
    save();
    const nextId = () => ++db.nextId;
    let currentId = null;
    try { currentId = localStorage.getItem(SESSION); } catch (e) { /* ignore */ }
    const me = () => db.people.find((p) => p.id === currentId) || null;
    const isAdmin = () => !!(me() && me().role === "admin");
    const notify = (ev) => listeners.forEach((cb) => setTimeout(() => cb(ev), 0));

    function hydrate(e) {
      const c = db.clients.find((x) => x.id === e.client_id) || {};
      const p = db.people.find((x) => x.id === e.user_id) || {};
      const s = db.serviceTypes.find((x) => x.id === e.service_type_id);
      return normalizeEntry({ ...e, client: c, person: p, service: s || null });
    }
    function validate(entry) {
      const h = Number(entry.hours);
      if (!(h > 0 && h <= 24) || Math.round(h * 4) !== h * 4) throw new Error(friendlyError({ message: "hours_check" }));
      const d = (entry.description || "").trim();
      if (!d || d.length > 500) throw new Error(friendlyError({ message: "description_check" }));
      if (!entry.client_id) throw new Error("Please choose a client.");
    }
    function log(id, action, oldData, newData) {
      db.history.push({ id: nextId(), entry_id: id, changed_by: currentId, changed_at: new Date().toISOString(), action, old_data: oldData, new_data: newData });
    }

    return {
      mode: "demo",
      demoPeople: () => db.people.filter((p) => p.active),
      onAuthChange(cb) { listeners.push(cb); },
      async getCurrentProfile() {
        const p = me();
        return p && p.active ? { ...p, needs_password: false } : null;
      },
      async signInAs(id) {
        currentId = id;
        try { localStorage.setItem(SESSION, id); } catch (e) { /* ignore */ }
        notify("SIGNED_IN");
      },
      async signIn(email) {
        const p = db.people.find((x) => x.email.toLowerCase() === String(email).trim().toLowerCase());
        if (!p) throw new Error(friendlyError({ message: "Invalid login credentials" }));
        return this.signInAs(p.id);
      },
      async signOut() {
        currentId = null;
        try { localStorage.removeItem(SESSION); } catch (e) { /* ignore */ }
        notify("SIGNED_OUT");
      },
      async sendPasswordReset() {},
      async setPassword() {},
      async resetDemo() {
        db = seed(); save();
      },
      async loadLists() {
        return {
          clients: db.clients.slice().sort((a, b) => a.name.localeCompare(b.name)),
          materials: db.materials.slice().sort((a, b) => a.name.localeCompare(b.name)),
          serviceTypes: db.serviceTypes.slice().sort((a, b) => a.sort_order - b.sort_order),
        };
      },
      async listProfiles() {
        return db.people.slice().sort((a, b) => a.full_name.localeCompare(b.full_name));
      },
      async listInvitations() { return db.invitations.slice(); },
      async listEntries(f = {}) {
        let rows = db.entries.filter((e) => isAdmin() || e.user_id === currentId);
        if (f.userId) rows = rows.filter((e) => e.user_id === f.userId);
        if (f.userIds && f.userIds.length) rows = rows.filter((e) => f.userIds.includes(e.user_id));
        if (f.clientId) rows = rows.filter((e) => e.client_id === Number(f.clientId));
        if (f.from) rows = rows.filter((e) => e.entry_date >= f.from);
        if (f.to) rows = rows.filter((e) => e.entry_date <= f.to);
        if (f.since) rows = rows.filter((e) => e.entry_date >= f.since);
        if (f.status) rows = rows.filter((e) => e.status === f.status);
        if (f.notExported) rows = rows.filter((e) => !e.qb_exported_at);
        if (f.exported) rows = rows.filter((e) => e.qb_exported_at);
        rows.sort((a, b) => (b.entry_date + b.created_at).localeCompare(a.entry_date + a.created_at));
        return rows.map(hydrate);
      },
      async saveEntry(entry, materials) {
        validate(entry);
        const mats = (materials || []).filter((m) => (m.name || "").trim()).map((m) => ({
          id: nextId(), material_id: m.material_id || null, name: m.name.trim(), quantity: Number(m.quantity),
          unit: m.unit || "", unit_price: m.unit_price === "" || m.unit_price == null ? null : Number(m.unit_price), is_new: !!m.is_new,
        }));
        const fields = {
          client_id: Number(entry.client_id), property: (entry.property || "").trim(), entry_date: entry.entry_date,
          hours: Number(entry.hours), service_type_id: entry.service_type_id ? Number(entry.service_type_id) : null,
          site_minimum_amount: numOrNull(entry.site_minimum_amount), site_minimum: numOrNull(entry.site_minimum_amount) > 0,
          description: entry.description.trim(), origination: !!entry.origination,
        };
        if (entry.id) {
          const e = db.entries.find((x) => x.id === entry.id);
          if (!e || (!isAdmin() && (e.user_id !== currentId || e.status !== "pending"))) throw new Error("Locked for billing, contact an admin");
          const old = JSON.parse(JSON.stringify(e));
          Object.assign(e, fields, { materials: mats, updated_at: new Date().toISOString() });
          log(e.id, "update", old, JSON.parse(JSON.stringify(e)));
          save();
          return e.id;
        }
        const e = {
          id: uid(), user_id: isAdmin() && entry.user_id ? entry.user_id : currentId, ...fields,
          status: "pending", approved_at: null, qb_exported_at: null, created_at: new Date().toISOString(), materials: mats,
        };
        db.entries.push(e);
        log(e.id, "insert", null, JSON.parse(JSON.stringify(e)));
        save();
        return e.id;
      },
      async deleteEntry(id) {
        const e = db.entries.find((x) => x.id === id);
        if (!e || (!isAdmin() && (e.user_id !== currentId || e.status !== "pending"))) throw new Error("Locked for billing, contact an admin");
        db.entries = db.entries.filter((x) => x.id !== id);
        log(id, "delete", e, null);
        save();
      },
      async unlock(ids) {
        const status = "pending";
        if (!isAdmin()) throw new Error(friendlyError({ message: "permission denied" }));
        db.entries.forEach((e) => {
          if (!ids.includes(e.id)) return;
          const old = JSON.parse(JSON.stringify(e));
          e.status = status;
          e.approved_at = null; e.qb_exported_at = null;
          log(e.id, "update", old, JSON.parse(JSON.stringify(e)));
        });
        save();
      },
      async markExported(ids) {
        db.entries.forEach((e) => { if (ids.includes(e.id)) { e.qb_exported_at = new Date().toISOString(); e.status = "approved"; } });
        save();
      },
      async invite({ email, full_name, role }) {
        email = email.trim().toLowerCase();
        if (db.people.some((p) => p.email === email)) throw new Error("That person already has an account.");
        // In demo mode the invite is accepted right away so you can try signing in as them.
        db.people.push({ id: uid(), email, full_name, role, qb_name: full_name, active: true });
        save();
      },
      async updateProfile(id, patch) {
        const p = db.people.find((x) => x.id === id);
        Object.assign(p, patch);
        save();
      },
      async saveClient(c) {
        if (db.clients.some((x) => x.name.toLowerCase() === c.name.toLowerCase() && x.id !== c.id)) throw new Error(friendlyError({ message: "duplicate key" }));
        const row = { name: c.name, qb_name: c.qb_name || null, properties: c.properties || [], one_off: !!c.one_off, active: c.active !== false };
        if (c.id) Object.assign(db.clients.find((x) => x.id === c.id), row);
        else db.clients.push({ id: nextId(), ...row });
        save();
      },
      async saveMaterial(m) {
        if (db.materials.some((x) => x.name.toLowerCase() === m.name.toLowerCase() && x.id !== m.id)) throw new Error(friendlyError({ message: "duplicate key" }));
        const row = materialRow(m);
        if (m.id) { Object.assign(db.materials.find((x) => x.id === m.id), row); save(); return m.id; }
        const id = nextId();
        db.materials.push({ id, ...row });
        save();
        return id;
      },
      async saveServiceType(s) {
        const row = serviceRow(s);
        if (s.id) Object.assign(db.serviceTypes.find((x) => x.id === s.id), row);
        else db.serviceTypes.push({ id: nextId(), ...row });
        save();
      },
      async importClients(rows, turnOff) {
        const ids = new Set(); let added = 0, updated = 0, off = 0;
        rows.forEach((r) => {
          const n = (r.full_name || "").trim(); if (!n) return;
          let c = db.clients.find((x) => (x.qb_name || "").toLowerCase() === n.toLowerCase()) || db.clients.find((x) => x.name.toLowerCase() === n.toLowerCase());
          if (c) { c.qb_name = n; c.active = true; updated++; } else { c = { id: nextId(), name: n, qb_name: n, properties: [], one_off: false, active: true }; db.clients.push(c); added++; }
          ids.add(c.id);
        });
        if (turnOff) db.clients.forEach((c) => { if (c.active && !ids.has(c.id)) { c.active = false; off++; } });
        save();
        return { added, updated, turned_off: off };
      },
      async importMaterials(rows, turnOff) {
        const ids = new Set(); let added = 0, updated = 0, off = 0;
        rows.forEach((r) => {
          if (!(r.name || "").trim()) return;
          let m = db.materials.find((x) => x.name.toLowerCase() === r.name.trim().toLowerCase());
          if (m) { Object.assign(m, materialRow(r)); updated++; } else { m = { id: nextId(), ...materialRow(r) }; db.materials.push(m); added++; }
          ids.add(m.id);
        });
        if (turnOff) db.materials.forEach((m) => { if (m.active && !ids.has(m.id)) { m.active = false; off++; } });
        save();
        return { added, updated, turned_off: off };
      },
      async importServices(rows, turnOff) {
        const ids = new Set(); let added = 0, updated = 0, off = 0;
        rows.forEach((r) => {
          if (!(r.name || "").trim()) return;
          let s = db.serviceTypes.find((x) => x.name.toLowerCase() === r.name.trim().toLowerCase());
          if (s) { const keep = s.active; Object.assign(s, serviceRow(r), { active: keep, sort_order: s.sort_order }); updated++; }
          else { s = { id: nextId(), ...serviceRow(r) }; db.serviceTypes.push(s); added++; }
          ids.add(s.id);
        });
        if (turnOff) db.serviceTypes.forEach((x) => { if (x.active && !ids.has(x.id)) { x.active = false; off++; } });
        save();
        return { added, updated, turned_off: off };
      },
      async listNewMaterials() {
        const out = [];
        db.entries.forEach((e) => e.materials.forEach((m) => {
          if (!m.is_new) return;
          const h = hydrate(e);
          out.push({ id: m.id, name: m.name, quantity: m.quantity, unit: m.unit, entry_date: e.entry_date, client_name: h.client_name, person_name: h.person_name });
        }));
        return out;
      },
      async resolveNewMaterial(entryMaterialId, materialId) {
        db.entries.forEach((e) => e.materials.forEach((m) => {
          if (m.id === entryMaterialId) { m.is_new = false; m.material_id = materialId || null; }
        }));
        save();
      },
      async entryHistory(id) {
        return db.history.filter((h) => h.entry_id === id);
      },
    };
  }

  window.Store = LIVE ? makeLiveStore() : makeDemoStore();
  window.Store.friendlyError = friendlyError;
})();
