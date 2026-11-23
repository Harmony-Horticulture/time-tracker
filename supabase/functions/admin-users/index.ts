// =====================================================================
// admin-users: lets admins see who has access and reset a password.
// Runs on Supabase as an Edge Function (shared by the Time Tracker and
// the Report Builder, since both use the same sign-in).
//
// Actions (POST JSON):
//   { action: "list" }
//       Everyone with a login: name, email, role, active, last sign-in,
//       and whether they still have to choose their own password.
//   { action: "reset_password", user_id }
//       Gives that person a new temporary password and returns it ONCE.
//       It isn't stored anywhere. Their old sessions are ended, and the
//       apps ask them to choose their own password when they next sign in.
//
// Only active admins can use it. The caller is checked from their sign-in
// token; the service role key never leaves Supabase. No secrets to set:
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
// provided automatically.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// 12 random characters in three groups, e.g. "k7Rp-m2Xq-9tWz".
// Leaves out look-alikes (0/O, 1/l/I) so it's easy to read out or text.
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGIT = "23456789";
const ALL = LOWER + UPPER + DIGIT;
function pick(set: string): string {
  const max = 256 - (256 % set.length); // avoid bias
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < max) return set[buf[0] % set.length];
  }
}
function tempPassword(): string {
  for (;;) {
    const chars = Array.from({ length: 12 }, () => pick(ALL)).join("");
    if (/[a-z]/.test(chars) && /[A-Z]/.test(chars) && /[0-9]/.test(chars)) {
      return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("Authorization") ?? "";

    // Who is calling? (checked against their own sign-in token)
    const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: who } = await asCaller.auth.getUser();
    const caller = who?.user;
    if (!caller) return json({ error: "Please sign in again." }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: me } = await admin.from("profiles").select("id, role, active").eq("id", caller.id).maybeSingle();
    if (!me || me.role !== "admin" || !me.active) return json({ error: "Only admins can manage people's access." }, 403);

    const body = await req.json().catch(() => ({}));

    if (body.action === "list") {
      const { data: profiles, error } = await admin
        .from("profiles")
        .select("id, email, full_name, role, active, qb_name")
        .order("full_name");
      if (error) throw error;
      const users = new Map<string, any>();
      for (let page = 1; ; page++) {
        const { data, error: e } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (e) throw e;
        data.users.forEach((u) => users.set(u.id, u));
        if (data.users.length < 1000) break;
      }
      const people = (profiles || []).map((p) => {
        const u = users.get(p.id);
        return {
          ...p,
          last_sign_in_at: u?.last_sign_in_at ?? null,
          created_at: u?.created_at ?? null,
          email_confirmed: !!u?.email_confirmed_at,
          needs_password: !(u?.user_metadata && u.user_metadata.password_set),
          temp_password_set_at: u?.user_metadata?.temp_password_set_at ?? null,
        };
      });
      return json({ people });
    }

    if (body.action === "reset_password") {
      const id = String(body.user_id || "");
      if (!id) return json({ error: "Choose a person." }, 400);
      if (id === caller.id) return json({ error: "To change your own password, sign out and use Forgot your password." }, 400);
      const { data: target } = await admin.from("profiles").select("id, email, full_name").eq("id", id).maybeSingle();
      if (!target) return json({ error: "That person doesn't have a login." }, 404);

      const password = tempPassword();
      const { error } = await admin.auth.admin.updateUserById(id, {
        password,
        email_confirm: true, // lets someone stuck on an unopened invite sign in too
        user_metadata: {
          password_set: false, // the apps ask them to choose their own on next sign-in
          temp_password_set_at: new Date().toISOString(),
          temp_password_set_by: caller.id,
        },
      });
      if (error) throw error;

      // Sign them out everywhere so the temporary password is the only way in.
      // Best-effort: needs supabase/06_admin_users.sql.
      const { error: endErr } = await admin.rpc("end_user_sessions", { p_user_id: id });

      return json({
        temp_password: password,
        email: target.email,
        full_name: target.full_name,
        signed_out: !endErr,
      });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error)?.message || "Something went wrong." }, 500);
  }
});
