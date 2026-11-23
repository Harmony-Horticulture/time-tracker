// =====================================================================
// Harmony Horticulture Time Tracker: screens
// =====================================================================
(function () {
  const S = window.Store;
  const cfg = window.HH_CONFIG || {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    me: null,
    lists: { clients: [], materials: [], serviceTypes: [] },
    profiles: [],
    view: "log",
    form: null, // the time entry being written or edited
    returnView: null,
    weekStart: null,
    review: null,
    listsTab: "clients",
  };

  // ---------- small helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local date, not UTC
  const today = () => isoDate(new Date());
  const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d); };
  const mondayOf = (s) => { const d = parseISO(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return isoDate(d); };
  const niceDate = (s, opts) => parseISO(s).toLocaleDateString(undefined, opts || { weekday: "short", month: "short", day: "numeric" });
  const fmtH = (n) => (Math.round(n * 100) / 100).toFixed(2);
  const sumH = (list) => list.reduce((s, e) => s + e.hours, 0);
  const isAdmin = () => state.me && state.me.role === "admin";
  const ROLES = [["consultant", "Consultant"], ["technician", "Technician"], ["admin", "Admin"]];
  const roleLabel = (r) => (ROLES.find((x) => x[0] === r) || [r, r])[1];
  const roleOptions = (sel) => ROLES.map(([v, l]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${l}</option>`).join("");
  const monthStart = () => today().slice(0, 8) + "01";
  const clientById = (id) => state.lists.clients.find((c) => c.id === Number(id));
  const personName = (id) => { const p = state.profiles.find((x) => x.id === id); return p ? p.full_name || p.email : id === (state.me && state.me.id) ? state.me.full_name : "Someone"; };

  let toastTimer;
  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), isError ? 6000 : 3000);
  }
  const fail = (err) => toast(S.friendlyError(err), true);

  function modal(html, onMount) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const close = () => { root.innerHTML = ""; };
    $(".modal-back", root).addEventListener("click", (e) => { if (e.target.classList.contains("modal-back")) close(); });
    if (onMount) onMount($(".modal", root), close);
    return close;
  }
  function confirmBox(title, text, okLabel = "OK", cancelLabel = "Cancel") {
    return new Promise((resolve) => {
      modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="btn-row" style="justify-content:flex-end"><button class="secondary" data-no>${esc(cancelLabel)}</button><button data-yes>${esc(okLabel)}</button></div>`, (m, close) => {
        $("[data-yes]", m).onclick = () => { close(); resolve(true); };
        $("[data-no]", m).onclick = () => { close(); resolve(false); };
      });
    });
  }

  // =====================================================================
  // Sign in (TT-01)
  // =====================================================================
  const LOCK_KEY = "hh_failed_signins";
  function failedCount(email) {
    try { return (JSON.parse(localStorage.getItem(LOCK_KEY)) || {})[email.toLowerCase()] || 0; } catch (e) { return 0; }
  }
  function setFailed(email, n) {
    try {
      const all = JSON.parse(localStorage.getItem(LOCK_KEY)) || {};
      if (n) all[email.toLowerCase()] = n; else delete all[email.toLowerCase()];
      localStorage.setItem(LOCK_KEY, JSON.stringify(all));
    } catch (e) { /* ignore */ }
  }

  function showAuth(html) {
    $("#loading").classList.add("hidden");
    $("#appView").classList.add("hidden");
    $("#authView").classList.remove("hidden");
    $("#authContent").innerHTML = html;
    addPasswordToggles($("#authContent"));
  }

  // Eye button on password boxes so people can check what they typed
  const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  function addPasswordToggles(root) {
    $$('input[type="password"]', root).forEach((input) => {
      const wrap = document.createElement("div");
      wrap.className = "pw-wrap";
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "pw-toggle"; btn.innerHTML = EYE;
      btn.setAttribute("aria-label", "Show password");
      btn.onclick = () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.innerHTML = show ? EYE_OFF : EYE;
        btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
        input.focus();
      };
      wrap.appendChild(btn);
    });
  }

  function renderSignIn(message) {
    if (S.mode === "demo") {
      const people = S.demoPeople();
      showAuth(`
        <h1>Welcome</h1>
        <p class="muted small" style="text-align:center">Demo mode. Pick someone to try the app as. Nothing here is saved online.</p>
        ${people.map((p) => `<button class="primary ${p.role === "admin" ? "" : "secondary"}" data-as="${esc(p.id)}" style="margin-bottom:8px">Sign in as ${esc(p.full_name)} · ${roleLabel(p.role)}</button>`).join("")}
      `);
      $$("[data-as]").forEach((b) => (b.onclick = () => S.signInAs(b.dataset.as)));
      return;
    }
    showAuth(`
      <h1>Sign in</h1>
      ${message ? `<p class="small" style="color:var(--green);text-align:center">${esc(message)}</p>` : ""}
      <form id="signinForm" novalidate>
        <div class="field"><label for="siEmail">Email</label><input id="siEmail" type="email" autocomplete="username" required></div>
        <div class="field"><label for="siPass">Password</label><input id="siPass" type="password" autocomplete="current-password" required></div>
        <div id="siError" class="error-text"></div>
        <button class="primary" type="submit">Sign in</button>
      </form>
      <p class="small" style="text-align:center;margin-top:16px"><a href="#" id="forgotLink">Forgot your password?</a></p>
      <p class="hint" style="text-align:center">This app is invite-only. Ask an admin for an invitation.</p>
    `);
    $("#signinForm").onsubmit = async (ev) => {
      ev.preventDefault();
      const email = $("#siEmail").value.trim();
      const pass = $("#siPass").value;
      const err = $("#siError");
      if (!email || !pass) { err.textContent = "Enter your email and password."; return; }
      if (failedCount(email) >= 5) {
        err.innerHTML = 'Too many tries. Please <a href="#" id="resetNow">reset your password</a>.';
        $("#resetNow").onclick = (e) => { e.preventDefault(); renderForgot(email); };
        return;
      }
      try {
        await S.signIn(email, pass);
        setFailed(email, 0);
      } catch (e) {
        const msg = S.friendlyError(e);
        if (!/don't match/.test(msg)) { err.textContent = msg; return; } // only wrong passwords count toward the limit
        const n = failedCount(email) + 1;
        setFailed(email, n);
        err.textContent = msg + (n >= 5 ? " You've tried 5 times, so please reset your password." : "");
        if (n >= 5) renderForgot(email);
      }
    };
    $("#forgotLink").onclick = (e) => { e.preventDefault(); renderForgot($("#siEmail").value); };
  }

  function renderForgot(email) {
    showAuth(`
      <h1>Reset password</h1>
      <p class="small muted">We'll email you a link to choose a new password.</p>
      <div class="field"><label for="fpEmail">Email</label><input id="fpEmail" type="email" value="${esc(email || "")}"></div>
      <button class="primary" id="fpSend">Email me a reset link</button>
      <p class="small" style="text-align:center;margin-top:16px"><a href="#" id="backSignIn">Back to sign in</a></p>
    `);
    $("#fpSend").onclick = async () => {
      const e = $("#fpEmail").value.trim();
      if (!e) return;
      try {
        await S.sendPasswordReset(e);
        setFailed(e, 0);
        renderSignIn("Check your email for a reset link.");
      } catch (err) { fail(err); }
    };
    $("#backSignIn").onclick = (ev) => { ev.preventDefault(); renderSignIn(); };
  }

  function renderSetPassword() {
    showAuth(`
      <h1>Choose your password</h1>
      <p class="small muted">Welcome, ${esc(state.me.full_name || state.me.email)}. Pick a password you'll use to sign in from now on (at least 8 characters).</p>
      <div class="field"><label for="np1">New password</label><input id="np1" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="np2">Type it again</label><input id="np2" type="password" autocomplete="new-password"></div>
      <div id="npErr" class="error-text"></div>
      <button class="primary" id="npSave">Save password</button>
    `);
    $("#npSave").onclick = async () => {
      const a = $("#np1").value, b = $("#np2").value;
      if (a.length < 8) { $("#npErr").textContent = "Use at least 8 characters."; return; }
      if (a !== b) { $("#npErr").textContent = "The two passwords don't match."; return; }
      try { await S.setPassword(a); state.me.needs_password = false; startApp(); } catch (e) { fail(e); }
    };
  }

  // =====================================================================
  // App shell and navigation
  // =====================================================================
  const svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    log: svg('<path d="M12 5v14M5 12h14"/>'),
    mytime: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    review: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    people: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2.1.7 3.5 2.8 3.5 5.7"/>'),
    lists: svg('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
    report: svg('<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  };
  // "Build a report" opens the separate report-building app, for every role
  const reportUrl = () => (window.HH_CONFIG && window.HH_CONFIG.REPORT_BUILDER_URL) || "https://harmony-horticulture.github.io/report-builder/";
  const reportLink = (cls, inner) => `<a class="${cls}" href="${esc(reportUrl())}" target="_blank" rel="noopener">${inner}</a>`;
  function navItems() {
    const items = [
      { id: "log", label: "Log time" },
      { id: "mytime", label: "My time" },
    ];
    if (isAdmin()) items.push({ id: "review", label: "Time reports", admin: true }, { id: "people", label: "People", admin: true }, { id: "lists", label: "Lists", admin: true });
    return items;
  }
  function renderNav() {
    const items = navItems();
    let side = "";
    let shownAdmin = false;
    items.forEach((i) => {
      if (i.admin && !shownAdmin) { side += reportLink("nav-link", `${ICONS.report}<span>Build a report</span>`); }
      if (i.admin && !shownAdmin) { side += `<div class="nav-label">Admin</div>`; shownAdmin = true; }
      side += `<button type="button" data-view="${i.id}" class="${state.view === i.id ? "active" : ""}">${ICONS[i.id]}<span>${esc(i.label)}</span></button>`;
    });
    if (!shownAdmin) side += reportLink("nav-link", `${ICONS.report}<span>Build a report</span>`);
    $("#sideNav").innerHTML = side;
    const bottom = items.map((i) => `<button type="button" data-view="${i.id}" class="${state.view === i.id ? "active" : ""}">${esc(i.label)}</button>`);
    bottom.splice(2, 0, reportLink("nav-link", "Report"));
    $("#bottomNav").innerHTML = bottom.join("");
    $$("[data-view]").forEach((b) => (b.onclick = () => go(b.dataset.view)));
  }
  function go(view) {
    if (!navItems().some((i) => i.id === view)) view = "log";
    state.view = view;
    $$(".view").forEach((v) => v.classList.toggle("hidden", v.id !== "view-" + view));
    renderNav();
    ({ log: renderLog, mytime: renderMyTime, review: renderReview, people: renderPeople, lists: renderLists })[view]();
    window.scrollTo(0, 0);
  }

  async function startApp() {
    try {
      state.me = await S.getCurrentProfile();
    } catch (e) { fail(e); state.me = null; }
    if (!state.me) return renderSignIn();
    if (!state.me.active) { await S.signOut(); return renderSignIn("Your account is turned off. Contact an admin."); }
    if (state.me.needs_password) return renderSetPassword();
    try {
      state.lists = await S.loadLists();
      state.profiles = isAdmin() ? await S.listProfiles() : [state.me];
    } catch (e) { fail(e); }
    $("#loading").classList.add("hidden");
    $("#authView").classList.add("hidden");
    $("#appView").classList.remove("hidden");
    $("#demoBanner").classList.toggle("hidden", S.mode !== "demo");
    $("#whoName").textContent = state.me.email || state.me.full_name;
    $("#whoRole").textContent = roleLabel(state.me.role);
    state.form = null;
    go(state.view);
  }

  // =====================================================================
  // Log time (TT-03 to TT-08, TT-13 to TT-15)
  // =====================================================================
  function blankForm() {
    return {
      id: null, user_id: state.me.id, client_id: null, property: "", entry_date: today(), hours: 0,
      service_type_id: "", description: "", site_minimum_amount: "", origination: false, materials: [],
    };
  }
  const activeServices = () => state.lists.serviceTypes.filter((s) => s.active);
  // Services naming a person go only to that person; the rest go to everyone
  function servicesFor(userId) {
    const p = state.profiles.find((x) => x.id === userId) || state.me;
    const names = [p.full_name, p.qb_name].filter(Boolean).map((n) => n.toLowerCase().trim());
    const first = (n) => n.split(/\s+/)[0];
    const isMine = (s) => { const f = s.for_person.toLowerCase().trim(); return names.some((n) => n === f || first(n) === first(f)); };
    const list = activeServices();
    return { mine: list.filter((s) => s.for_person && isMine(s)), everyone: list.filter((s) => !s.for_person) };
  }
  const activeMaterials = () => state.lists.materials.filter((m) => m.active);

  async function renderLog() {
    const el = $("#view-log");
    if (!state.form) state.form = blankForm();
    const f = state.form;
    const editing = !!f.id;
    const client = clientById(f.client_id);
    const { mine, everyone } = servicesFor(f.user_id);
    const services = mine.concat(everyone);
    if (!f.id && !f.service_type_id && mine.length === 1) f.service_type_id = mine[0].id; // their only service is picked for them
    const svcOpt = (s) => `<option value="${s.id}" ${String(s.id) === String(f.service_type_id) ? "selected" : ""}>${esc(s.name)}${s.billable ? "" : " (non-billable)"}</option>`;
    const forOther = isAdmin() && f.user_id !== state.me.id;
    const hasMic = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

    el.innerHTML = `
      <div class="page-head">
        <div><p class="eyebrow">${editing ? "Edit entry" : "New entry"}</p><h1>${editing ? "Edit time" : "Log time"}</h1></div>
      </div>
      <div class="card">
        ${editing && forOther ? `<p class="small muted">Editing ${esc(personName(f.user_id))}'s entry. Your change is saved in the entry's history.</p>` : ""}
        ${isAdmin() && !editing ? `
          <div class="field"><label for="fUser">Logging time for</label>
            <select id="fUser">${state.profiles.filter((p) => p.active).map((p) => `<option value="${esc(p.id)}" ${p.id === f.user_id ? "selected" : ""}>${esc(p.full_name || p.email)}${p.id === state.me.id ? " (me)" : ""}</option>`).join("")}</select>
          </div>` : ""}
        <div class="field" id="clientField">
          <label for="fClient">Client <span class="req">*</span></label>
          ${client ? `<div class="chosen"><span>${esc(client.name)}${client.one_off ? ' <span class="badge oneoff">One-off</span>' : ""}</span><button type="button" class="ghost small" id="changeClient">Change</button></div>` :
            `<input id="fClient" type="search" placeholder="Type 2 or more letters" autocomplete="off" aria-autocomplete="list">
             <div id="clientResults" class="results hidden" role="listbox"></div>`}
        </div>
        <div class="grid2">
          <div class="field"><label for="fProperty">Property</label>
            <input id="fProperty" list="propertyList" value="${esc(f.property)}" placeholder="Optional">
            <datalist id="propertyList">${(client ? client.properties : []).map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
          </div>
          <div class="field"><label for="fDate">Date <span class="req">*</span></label><input id="fDate" type="date" value="${esc(f.entry_date)}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="fHours">Hours <span class="req">*</span></label>
            <div class="stepper">
              <button type="button" id="hMinus" aria-label="Less time">−</button>
              <input id="fHours" inputmode="decimal" value="${fmtH(f.hours)}" aria-describedby="hoursHint">
              <button type="button" id="hPlus" aria-label="More time">+</button>
            </div>
            <div id="hoursHint" class="hint">Quarter hours: .25, .50, .75</div>
            <div id="hoursErr" class="error-text"></div>
          </div>
          ${services.length ? `
          <div class="field"><label for="fService">Service <span class="req">*</span></label>
            <select id="fService"><option value="">Choose…</option>${mine.length ? `<optgroup label="${esc(personName(f.user_id) === "Someone" ? "Yours" : "For " + personName(f.user_id))}">${mine.map(svcOpt).join("")}</optgroup><optgroup label="Everyone">${everyone.map(svcOpt).join("")}</optgroup>` : everyone.map(svcOpt).join("")}</select>
            <div class="hint" id="serviceHint"></div>
          </div>` : ""}
        </div>
        <div class="field"><label for="fDesc">Description <span class="req">*</span></label>
          <div class="with-mic">
            <textarea id="fDesc" maxlength="500" placeholder="What work was done?">${esc(f.description)}</textarea>
            ${hasMic ? `<button type="button" class="mic" id="micBtn" title="Dictate" aria-label="Dictate description">🎤</button>` : ""}
          </div>
          <div class="hint"><span id="descCount">${f.description.length}</span>/500</div>
        </div>
        <div class="field">
          <div class="grid2" style="margin-bottom:10px"><div><label for="fSiteMinAmt">Site minimum ($)</label>
            <input id="fSiteMinAmt" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Leave blank if none" value="${esc(f.site_minimum_amount)}"></div></div>
          <label class="check"><input type="checkbox" id="fOrig" ${f.origination ? "checked" : ""}> Origination (new work I brought in)</label>
        </div>
        <div class="field">
          <label>Materials <span class="muted small" style="font-weight:400">(optional)</span></label>
          <div id="matRows"></div>
          <datalist id="materialList">${activeMaterials().map((m) => `<option value="${esc(m.name)}">`).join("")}</datalist>
          <button type="button" class="secondary small" id="addMat">+ Add material</button>
        </div>
        <div id="formErr" class="error-text" style="margin-bottom:10px"></div>
        <div class="btn-row">
          <button type="button" id="saveEntry">${editing ? "Save changes" : "Save entry"}</button>
          ${editing ? `<button type="button" class="secondary" id="cancelEdit">Cancel</button>` : `<button type="button" class="secondary" id="clearForm">Clear</button>`}
        </div>
      </div>
      ${editing ? "" : `<div class="card"><h2>Today</h2><div id="todayList" class="muted">Loading…</div></div>`}
    `;

    // Who (admin)
    const fUser = $("#fUser");
    if (fUser) fUser.onchange = () => { readForm(); f.user_id = fUser.value; f.service_type_id = ""; renderLog(); }; // their own services

    // Client search
    if (client) {
      $("#changeClient").onclick = () => { readForm(); f.client_id = null; renderLog().then(() => $("#fClient").focus()); };
    } else {
      setupClientSearch();
    }

    // Hours
    const hoursInput = $("#fHours");
    const step = (d) => {
      let v = parseFloat(hoursInput.value);
      if (isNaN(v)) v = 0;
      v = Math.round(v * 4) / 4 + d;
      v = Math.min(24, Math.max(0, v));
      hoursInput.value = fmtH(v);
      $("#hoursErr").textContent = "";
    };
    $("#hMinus").onclick = () => step(-0.25);
    $("#hPlus").onclick = () => step(0.25);
    // Starts at 0, so only complain on leaving the box once something other than 0 is typed
    hoursInput.onblur = () => { if (parseFloat(hoursInput.value) !== 0) validateHours(true); };

    // Service hint
    const svc = $("#fService");
    const showHint = () => { const s = services.find((x) => String(x.id) === svc.value); $("#serviceHint").textContent = s && s.help_text ? s.help_text : ""; };
    if (svc) { svc.onchange = showHint; showHint(); }

    // Description
    const desc = $("#fDesc");
    desc.oninput = () => { $("#descCount").textContent = desc.value.length; };
    if (hasMic) setupDictation($("#micBtn"), desc);

    // Materials
    renderMaterialRows();
    $("#addMat").onclick = () => { readForm(); f.materials.push({ name: "", quantity: 1, unit: "", material_id: null }); renderMaterialRows(); const rows = $$(".mat-row input.mat-name"); rows[rows.length - 1].focus(); };

    $("#saveEntry").onclick = saveEntry;
    if (editing) $("#cancelEdit").onclick = () => { state.form = null; go(state.returnView || "mytime"); };
    else $("#clearForm").onclick = () => { state.form = blankForm(); renderLog(); };

    if (!editing) renderTodayList();
  }

  function validateHours(show) {
    const raw = $("#fHours").value.trim();
    const v = parseFloat(raw);
    let msg = "";
    if (raw === "" || isNaN(v)) msg = "Enter the hours worked.";
    else if (v <= 0) msg = "Enter the hours worked. An entry can't be 0 hours.";
    else if (v > 24) msg = "Hours can't be more than 24.";
    else if (Math.round(v * 4) !== v * 4) msg = "Please use quarter hours: .25, .50 or .75.";
    if (show) $("#hoursErr").textContent = msg;
    return msg ? null : v;
  }

  function setupClientSearch() {
    const input = $("#fClient");
    const box = $("#clientResults");
    let focusIdx = -1;
    let recent = [];
    const since = addDays(today(), -14);
    S.listEntries({ userId: state.form.user_id, since }).then((rows) => {
      const seen = new Set();
      rows.forEach((e) => { if (!seen.has(e.client_id) && seen.size < 5) seen.add(e.client_id); });
      recent = Array.from(seen).map(clientById).filter((c) => c && c.active);
      if (document.activeElement === input && input.value.trim().length < 2) draw();
    }).catch(() => {});

    function pick(id) {
      readForm();
      state.form.client_id = Number(id);
      const c = clientById(id);
      if (c && c.properties && c.properties.length === 1 && !state.form.property) state.form.property = c.properties[0];
      input.blur();
      setTimeout(renderLog, 0); // redraw after the browser finishes the click
    }
    function draw() {
      const q = input.value.trim().toLowerCase();
      let html = "";
      if (q.length < 2) {
        if (recent.length) html = `<div class="group">Recent clients</div>` + recent.map((c) => `<button type="button" role="option" data-id="${c.id}">${esc(c.name)}${c.one_off ? ' <span class="badge oneoff">One-off</span>' : ""}</button>`).join("");
        else html = `<div class="none">Type 2 or more letters to search.</div>`;
      } else {
        const matches = state.lists.clients.filter((c) => c.active && (c.name.toLowerCase().includes(q) || (c.properties || []).some((p) => p.toLowerCase().includes(q)) || (c.qb_name || "").toLowerCase().includes(q)));
        html = matches.length
          ? matches.slice(0, 40).map((c) => `<button type="button" role="option" data-id="${c.id}">${esc(c.name)}${c.one_off ? ' <span class="badge oneoff">One-off</span>' : ""}${c.properties && c.properties.length && c.properties[0] !== c.name ? ` <span class="muted small">· ${esc(c.properties.join(", "))}</span>` : ""}</button>`).join("")
          : `<div class="none">No client found</div>`;
      }
      box.innerHTML = html;
      box.classList.remove("hidden");
      focusIdx = -1;
      $$("button", box).forEach((b) => b.addEventListener("mousedown", (e) => { e.preventDefault(); pick(b.dataset.id); }));
    }
    input.addEventListener("focus", draw);
    input.addEventListener("input", draw);
    input.addEventListener("blur", () => setTimeout(() => box.classList.add("hidden"), 150));
    input.addEventListener("keydown", (e) => {
      const opts = $$("button", box);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!opts.length) return;
        focusIdx = (focusIdx + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length;
        opts.forEach((o, i) => o.classList.toggle("focus", i === focusIdx));
        opts[focusIdx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const o = opts[focusIdx >= 0 ? focusIdx : 0];
        if (o && input.value.trim().length >= 2) pick(o.dataset.id);
        else if (o && focusIdx >= 0) pick(o.dataset.id);
      }
    });
  }

  function setupDictation(btn, field) {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec = null;
    btn.onclick = () => {
      if (rec) { rec.stop(); return; }
      if (!navigator.onLine) toast("Dictation may not work without signal on some phones.");
      rec = new Rec();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.continuous = true;
      const start = field.value;
      let said = "";
      rec.onresult = (ev) => {
        for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) said += ev.results[i][0].transcript;
        field.value = (start ? start.replace(/\s*$/, " ") : "") + said.trim();
        field.value = field.value.slice(0, 500);
        field.dispatchEvent(new Event("input"));
      };
      rec.onerror = (ev) => { if (ev.error !== "no-speech" && ev.error !== "aborted") toast("Dictation isn't available right now (" + ev.error + ").", true); };
      rec.onend = () => { rec = null; btn.classList.remove("listening"); };
      btn.classList.add("listening");
      rec.start();
    };
  }

  function unitLabel(known, m) {
    if (known) return `<b>${esc(known.unit || "each")}</b>${known.price != null ? `<br><span class="muted">$${Number(known.price).toFixed(2)} / ${esc(known.unit || "each")}</span>` : ""}`;
    return m && m.name ? '<span class="badge new">New</span>' : "";
  }
  function renderMaterialRows() {
    const box = $("#matRows");
    const f = state.form;
    box.innerHTML = f.materials.map((m, i) => {
      const known = state.lists.materials.find((x) => x.name.toLowerCase() === (m.name || "").toLowerCase());
      return `<div class="mat-row" data-i="${i}">
        <input class="mat-name" list="materialList" placeholder="Search or type a material" value="${esc(m.name)}" aria-label="Material">
        <input class="mat-qty" type="number" min="0.25" step="0.25" value="${esc(m.quantity)}" aria-label="Quantity">
        <span class="unit">${unitLabel(known, m)}</span>
        <button type="button" class="ghost" aria-label="Remove material" data-remove="${i}">✕</button>
      </div>`;
    }).join("");
    $$(".mat-name", box).forEach((inp) => (inp.onchange = () => {
      readForm();
      // Only update the unit / New label so moving to the next field isn't disturbed
      const row = inp.closest(".mat-row");
      const m = state.form.materials[Number(row.dataset.i)];
      if (m) $(".unit", row).innerHTML = unitLabel(state.lists.materials.find((x) => x.id === m.material_id), m);
    }));
    $$("[data-remove]", box).forEach((b) => (b.onclick = () => { readForm(); f.materials.splice(Number(b.dataset.remove), 1); renderMaterialRows(); }));
  }

  // Copy what's on screen into state.form
  function readForm() {
    const f = state.form;
    if (!f || !$("#fDate")) return;
    if ($("#fUser")) f.user_id = $("#fUser").value;
    f.property = $("#fProperty").value;
    f.entry_date = $("#fDate").value;
    const h = parseFloat($("#fHours").value);
    f.hours = isNaN(h) ? 0 : h;
    if ($("#fService")) f.service_type_id = $("#fService").value;
    f.description = $("#fDesc").value;
    f.site_minimum_amount = $("#fSiteMinAmt").value.trim();
    f.origination = $("#fOrig").checked;
    f.materials = $$(".mat-row").map((row) => {
      const name = $(".mat-name", row).value.trim();
      const known = state.lists.materials.find((x) => x.name.toLowerCase() === name.toLowerCase());
      return {
        name: known ? known.name : name,
        quantity: parseFloat($(".mat-qty", row).value) || 0,
        unit: known ? known.unit : "",
        unit_price: known && known.price != null ? known.price : null,
        material_id: known ? known.id : null,
        is_new: !!name && !known,
      };
    });
  }

  async function saveEntry() {
    readForm();
    const f = state.form;
    const err = $("#formErr");
    err.textContent = "";
    const problems = [];
    if (!f.client_id) problems.push("Choose a client.");
    if (!f.entry_date) problems.push("Pick a date.");
    if (validateHours(true) === null) problems.push(f.hours === 0 ? "Enter the hours worked (more than 0)." : "Fix the hours.");
    if (activeServices().length && !f.service_type_id) problems.push("Choose a service.");
    if (!f.description.trim()) problems.push("Add a description.");
    if (f.materials.some((m) => m.name && !(m.quantity > 0))) problems.push("Each material needs a quantity.");
    if (f.site_minimum_amount !== "" && !(Number(f.site_minimum_amount) >= 0)) problems.push("Site minimum must be a dollar amount.");
    if (problems.length) { err.textContent = problems.join(" "); return; }

    // TT-06: warn for future dates or more than 7 days back
    const days = (parseISO(today()) - parseISO(f.entry_date)) / 86400000;
    const limit = cfg.OLD_DATE_WARNING_DAYS || 7;
    if (days < 0 && !(await confirmBox("Future date?", `This entry is dated ${niceDate(f.entry_date)}, which is in the future. Save it anyway?`, "Save anyway"))) return;
    if (days > limit && !(await confirmBox("Older date", `This entry is dated ${niceDate(f.entry_date)}, more than ${limit} days ago. Save it anyway?`, "Save anyway"))) return;

    const btn = $("#saveEntry");
    btn.disabled = true;
    try {
      await S.saveEntry(
        {
          id: f.id || "", user_id: f.user_id, client_id: f.client_id, property: f.property, entry_date: f.entry_date,
          hours: f.hours, service_type_id: f.service_type_id || "", description: f.description.trim(),
          site_minimum_amount: f.site_minimum_amount, origination: f.origination,
        },
        f.materials.filter((m) => m.name).map((m) => ({ ...m, material_id: m.material_id || "", unit_price: m.unit_price == null ? "" : m.unit_price }))
      );
      const wasEditing = !!f.id;
      toast(wasEditing ? "Changes saved." : "Entry saved.");
      if (wasEditing) { state.form = null; go(state.returnView || "mytime"); }
      else {
        // Keep the date and person so the next entry for the same day is quick
        const keep = { entry_date: f.entry_date, user_id: f.user_id };
        state.form = Object.assign(blankForm(), keep);
        renderLog();
      }
    } catch (e) {
      btn.disabled = false;
      err.textContent = S.friendlyError(e);
    }
  }

  async function renderTodayList() {
    const box = $("#todayList");
    try {
      const d = state.form.entry_date || today();
      const rows = await S.listEntries({ userId: state.form.user_id, from: d, to: d });
      if (!$("#todayList")) return;
      const label = d === today() ? "Today" : niceDate(d);
      box.parentElement.querySelector("h2").textContent = `${label} · ${fmtH(sumH(rows))} hrs`;
      box.classList.remove("muted");
      box.innerHTML = rows.length ? rows.map((e) => entryHTML(e, true)).join("") : `<p class="muted">Nothing logged yet.</p>`;
      wireEntryButtons(box, rows, "log");
    } catch (e) { box.textContent = S.friendlyError(e); }
  }

  // ---------- shared entry display ----------
  function entryHTML(e, showActions, showPerson) {
    const locked = !!e.qb_exported_at || e.status === "approved"; // locked once it's in a QuickBooks file
    return `<div class="entry">
      <div style="min-width:0">
        <div class="title">${esc(e.client_name)}${e.client_one_off ? ' <span class="badge oneoff">One-off</span>' : ""}${e.property && e.property !== e.client_name ? ` <span class="muted small">· ${esc(e.property)}</span>` : ""}
          ${locked ? `<span class="badge sent">In QuickBooks</span>` : ""}</div>
        <div class="desc">${esc(e.description)}</div>
        <div class="meta">${[showPerson ? esc(e.person_name) : "", e.service_name ? esc(e.service_name) : "", e.site_minimum_amount ? `Site minimum $${Number(e.site_minimum_amount).toFixed(2)}` : e.site_minimum ? "Site minimum" : "", e.origination ? "Origination" : "",
          e.materials.length ? "Materials: " + e.materials.map((m) => `${esc(m.name)} × ${m.quantity}${m.unit && m.unit !== "each" ? " " + esc(m.unit) : ""}${m.is_new ? " (new)" : ""}`).join(", ") : ""].filter(Boolean).join(" · ")}</div>
        ${showActions ? `<div class="btn-row" style="margin-top:6px">${locked && !isAdmin() ? `<span class="small muted">Already in a QuickBooks file. Ask an admin if it needs changing.</span>` :
          `<button type="button" class="secondary small" data-edit="${esc(e.id)}">Edit</button><button type="button" class="danger small" data-del="${esc(e.id)}">Delete</button>`}</div>` : ""}
      </div>
      <div class="hrs">${fmtH(e.hours)} h</div>
    </div>`;
  }
  function wireEntryButtons(root, rows, returnView) {
    $$("[data-edit]", root).forEach((b) => (b.onclick = () => editEntry(rows.find((e) => e.id === b.dataset.edit), returnView)));
    $$("[data-del]", root).forEach((b) => (b.onclick = async () => {
      const e = rows.find((x) => x.id === b.dataset.del);
      if (!(await confirmBox("Delete entry?", `${fmtH(e.hours)} hrs for ${e.client_name} on ${niceDate(e.entry_date)}. This can't be undone.`, "Delete"))) return;
      try { await S.deleteEntry(e.id); toast("Entry deleted."); go(state.view); } catch (err) { fail(err); }
    }));
  }
  function editEntry(e, returnView) {
    state.form = {
      id: e.id, user_id: e.user_id, client_id: e.client_id, property: e.property, entry_date: e.entry_date, hours: e.hours,
      service_type_id: e.service_type_id || "", description: e.description, site_minimum_amount: e.site_minimum_amount == null ? "" : e.site_minimum_amount, origination: e.origination,
      materials: e.materials.map((m) => ({ ...m })),
    };
    state.returnView = returnView;
    go("log");
  }

  // =====================================================================
  // My time: day and week totals (TT-10), my download (TT-11)
  // =====================================================================
  async function renderMyTime() {
    const el = $("#view-mytime");
    if (!state.weekStart) state.weekStart = mondayOf(today());
    const ws = state.weekStart;
    const we = addDays(ws, 6);
    el.innerHTML = `
      <div class="page-head">
        <div><p class="eyebrow">My time</p><h1>Week of ${esc(niceDate(ws, { month: "long", day: "numeric" }))}</h1></div>
        <div class="week-nav">
          <button type="button" class="secondary small" id="wkPrev" aria-label="Previous week">◀</button>
          <button type="button" class="secondary small" id="wkThis">This week</button>
          <button type="button" class="secondary small" id="wkNext" aria-label="Next week">▶</button>
        </div>
      </div>
      <div class="stat-row" id="weekStats"></div>
      <div class="card" id="weekDays"><p class="muted">Loading…</p></div>
      <div class="card">
        <h2>Download my time</h2>
        <div class="grid4">
          <div class="field"><label for="myFrom">From</label><input type="date" id="myFrom" value="${monthStart()}"></div>
          <div class="field"><label for="myTo">To</label><input type="date" id="myTo" value="${today()}"></div>
        </div>
        <button type="button" id="myDownload">Download Excel</button>
      </div>`;
    $("#wkPrev").onclick = () => { state.weekStart = addDays(ws, -7); renderMyTime(); };
    $("#wkNext").onclick = () => { state.weekStart = addDays(ws, 7); renderMyTime(); };
    $("#wkThis").onclick = () => { state.weekStart = mondayOf(today()); renderMyTime(); };
    $("#myDownload").onclick = async () => {
      const from = $("#myFrom").value, to = $("#myTo").value;
      try {
        const rows = await S.listEntries({ userId: state.me.id, from, to });
        await Exports.exportEntries(rows, { title: "My time", subtitle: `${state.me.full_name} · ${from} to ${to}`, filename: `${state.me.full_name || "My"} Time ${from} to ${to}.xlsx`, dailyTotals: true });
      } catch (e) { fail(e); }
    };
    try {
      const rows = await S.listEntries({ userId: state.me.id, from: ws, to: we });
      if (state.view !== "mytime") return;
      const total = sumH(rows);
      const pending = sumH(rows.filter((e) => !e.qb_exported_at));
      const todayRows = rows.filter((e) => e.entry_date === today());
      $("#weekStats").innerHTML = `
        <div class="stat"><div class="label">Today</div><div class="num">${fmtH(sumH(todayRows))}</div></div>
        <div class="stat"><div class="label">This week</div><div class="num">${fmtH(total)}</div></div>
        <div class="stat"><div class="label">Not yet in QuickBooks</div><div class="num">${fmtH(pending)}</div></div>`;
      let html = "";
      for (let i = 0; i < 7; i++) {
        const d = addDays(ws, i);
        const dayRows = rows.filter((e) => e.entry_date === d);
        const weekday = i < 5;
        const missing = weekday && !dayRows.length && d <= today();
        if (!dayRows.length && !weekday) continue;
        html += `<div class="day ${missing ? "empty" : ""}">
          <div class="day-head"><h3>${esc(niceDate(d))}</h3><span class="hrs">${fmtH(sumH(dayRows))} h</span></div>
          ${dayRows.length ? dayRows.map((e) => entryHTML(e, true)).join("") : `<div class="none">${missing ? "No time logged" : "—"}</div>`}
        </div>`;
      }
      $("#weekDays").innerHTML = html;
      wireEntryButtons($("#weekDays"), rows, "mytime");
    } catch (e) { $("#weekDays").textContent = S.friendlyError(e); }
  }

  // =====================================================================
  // Admin: review and export (TT-18 to TT-22)
  // =====================================================================
  function reviewDefaults() {
    return { from: monthStart(), to: today(), userId: "", clientId: "", status: "" };
  }
  async function renderReview() {
    if (!isAdmin()) return;
    const el = $("#view-review");
    if (!state.review) state.review = reviewDefaults();
    const r = state.review;
    const client = clientById(r.clientId);
    el.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Admin · download reports and the QuickBooks file</p><h1>Time reports</h1></div></div>
      <div class="card">
        <div class="grid4">
          <div class="field"><label for="rvFrom">From</label><input type="date" id="rvFrom" value="${esc(r.from)}"></div>
          <div class="field"><label for="rvTo">To</label><input type="date" id="rvTo" value="${esc(r.to)}"></div>
          <div class="field"><label for="rvPerson">Person</label>
            <select id="rvPerson"><option value="">Everyone</option>${state.profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === r.userId ? "selected" : ""}>${esc(p.full_name || p.email)}</option>`).join("")}</select></div>
          <div class="field"><label for="rvStatus">QuickBooks</label>
            <select id="rvStatus"><option value="">All</option><option value="open" ${r.status === "open" ? "selected" : ""}>Not yet in a QuickBooks file</option><option value="sent" ${r.status === "sent" ? "selected" : ""}>In a QuickBooks file</option></select></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="rvClient">Client</label>
            <input id="rvClient" list="rvClientList" placeholder="All clients" value="${esc(client ? client.name : "")}">
            <datalist id="rvClientList">${state.lists.clients.map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist></div>

        </div>
      </div>
      <div class="stat-row" id="rvStats"></div>
      <div class="card">
        <div class="btn-row" style="margin-bottom:12px">
          <button type="button" class="secondary" id="rvUnlock">Unlock selected</button>
          <span style="flex:1"></span>
          <button type="button" class="secondary" id="rvExport">Download this list</button>
          <button type="button" class="secondary" id="rvByPerson">Time by person</button>
          <button type="button" class="secondary" id="rvClientSum">Client summary</button>
          <button type="button" id="rvQB">QuickBooks file</button>
        </div>
        <div class="table-wrap" id="rvTable"><p class="muted">Loading…</p></div>
      </div>`;

    const reload = () => { renderReview(); };
    $("#rvFrom").onchange = (e) => { r.from = e.target.value; reload(); };
    $("#rvTo").onchange = (e) => { r.to = e.target.value; reload(); };
    $("#rvPerson").onchange = (e) => { r.userId = e.target.value; reload(); };
    $("#rvStatus").onchange = (e) => { r.status = e.target.value; reload(); };
    $("#rvClient").onchange = (e) => {
      const v = e.target.value.trim().toLowerCase();
      const c = state.lists.clients.find((x) => x.name.toLowerCase() === v);
      if (v && !c) { toast("No client found with that name.", true); return; }
      r.clientId = c ? c.id : "";
      reload();
    };

    let rows = [];
    try {
      rows = await S.listEntries({ from: r.from, to: r.to, userId: r.userId, clientId: r.clientId, notExported: r.status === "open", exported: r.status === "sent" });
    } catch (e) { $("#rvTable").textContent = S.friendlyError(e); return; }
    if (state.view !== "review") return;

    $("#rvStats").innerHTML = `
      <div class="stat"><div class="label">Entries</div><div class="num">${rows.length}</div></div>
      <div class="stat"><div class="label">Hours</div><div class="num">${fmtH(sumH(rows))}</div></div>
      <div class="stat"><div class="label">Not yet in QuickBooks</div><div class="num">${fmtH(sumH(rows.filter((e) => !e.qb_exported_at)))}</div></div>
      <div class="stat"><div class="label">In QuickBooks</div><div class="num">${fmtH(sumH(rows.filter((e) => e.qb_exported_at)))}</div></div>`;

    $("#rvTable").innerHTML = rows.length ? `
      <table>
        <thead><tr><th><input type="checkbox" id="rvAll" aria-label="Select all"></th><th>Date</th><th>Person</th><th>Client</th><th>Service</th><th class="num">Hours</th><th>Description</th><th>Materials</th><th>QuickBooks</th><th></th></tr></thead>
        <tbody>${rows.map((e) => `<tr>
          <td><input type="checkbox" class="rvSel" value="${esc(e.id)}" aria-label="Select entry"></td>
          <td style="white-space:nowrap">${esc(niceDate(e.entry_date, { month: "short", day: "numeric" }))}</td>
          <td>${esc(e.person_name)}</td>
          <td>${esc(e.client_name)}${e.client_one_off ? ' <span class="badge oneoff">One-off</span>' : ""}${e.property && e.property !== e.client_name ? `<div class="small muted">${esc(e.property)}</div>` : ""}</td>
          <td>${esc(e.service_name)}</td>
          <td class="num">${fmtH(e.hours)}</td>
          <td>${esc(e.description)}</td>
          <td>${e.materials.map((m) => `${esc(m.name)} × ${m.quantity}${m.unit && m.unit !== "each" ? " " + esc(m.unit) : ""}${m.is_new ? ' <span class="badge new">New</span>' : ""}`).join("<br>")}</td>
          <td>${e.qb_exported_at ? '<span class="badge sent">In QuickBooks</span>' : ""}</td>
          <td style="white-space:nowrap"><button type="button" class="ghost small" data-edit="${esc(e.id)}">Edit</button><button type="button" class="ghost small" data-hist="${esc(e.id)}">History</button></td>
        </tr>`).join("")}</tbody>
      </table>` : `<p class="muted">No time matches these filters.</p>`;

    const selected = () => $$(".rvSel:checked").map((c) => c.value);
    const all = $("#rvAll");
    if (all) all.onchange = () => $$(".rvSel").forEach((c) => (c.checked = all.checked));
    $$("[data-edit]", $("#rvTable")).forEach((b) => (b.onclick = () => editEntry(rows.find((e) => e.id === b.dataset.edit), "review")));
    $$("[data-hist]", $("#rvTable")).forEach((b) => (b.onclick = () => showHistory(rows.find((e) => e.id === b.dataset.hist))));

    $("#rvUnlock").onclick = async () => {
      const ids = selected();
      if (!ids.length) return toast("Tick the entries to unlock first.");
      if (!(await confirmBox("Unlock entries?", "The person will be able to change these entries again, and they'll go into the next QuickBooks file again. Only do this if you'll fix them in QuickBooks too.", "Unlock"))) return;
      try { await S.unlock(ids); toast(`${ids.length} unlocked.`); reload(); } catch (e) { fail(e); }
    };
    $("#rvExport").onclick = () => Exports.exportEntries(rows, {
      title: "Time review", withPerson: true,
      subtitle: `${client ? client.name + " · " : ""}${r.from} to ${r.to}`,
      filename: `Harmony Horticulture Time ${r.from} to ${r.to}.xlsx`,
    }).catch(fail);
    $("#rvByPerson").onclick = () => byPersonModal();
    $("#rvClientSum").onclick = async () => {
      try {
        if (client) {
          const list = await S.listEntries({ clientId: client.id, from: r.from, to: r.to });
          await Exports.exportClientSummary(list, client.name, { from: r.from, to: r.to });
        } else { // no client picked: every client with time in the range, one tab each
          const list = await S.listEntries({ from: r.from, to: r.to, userId: r.userId });
          if (!list.length) return toast("No time in this date range.");
          await Exports.exportAllClientSummaries(list, { from: r.from, to: r.to });
        }
      } catch (e) { fail(e); }
    };
    $("#rvQB").onclick = () => quickBooksModal();
  }

  function byPersonModal() {
    const r = state.review;
    modal(`
      <h2>Time by person</h2>
      <p class="small muted">A summary tab with everyone's totals, then one tab per person.</p>
      <div class="grid2">
        <div class="field"><label for="bpFrom">From</label><input type="date" id="bpFrom" value="${esc(r.from)}"></div>
        <div class="field"><label for="bpTo">To</label><input type="date" id="bpTo" value="${esc(r.to)}"></div>
      </div>
      <label>People</label>
      <div style="max-height:220px;overflow-y:auto;margin-bottom:14px">
        ${state.profiles.filter((p) => p.active).map((p) => `<div><label class="check"><input type="checkbox" class="bpP" value="${esc(p.id)}" checked> ${esc(p.full_name || p.email)}</label></div>`).join("")}
      </div>
      <div class="btn-row" style="justify-content:flex-end"><button class="secondary" data-close>Cancel</button><button data-go>Download</button></div>`,
    (m, close) => {
      $("[data-close]", m).onclick = close;
      $("[data-go]", m).onclick = async () => {
        const ids = $$(".bpP:checked", m).map((c) => c.value);
        if (!ids.length) return toast("Pick at least one person.");
        const from = $("#bpFrom", m).value, to = $("#bpTo", m).value;
        try {
          const rows = await S.listEntries({ from, to, userIds: ids });
          await Exports.exportTimeByPerson(rows, state.profiles.filter((p) => ids.includes(p.id)), { from, to });
          close();
        } catch (e) { fail(e); }
      };
    });
  }

  function quickBooksModal() {
    const r = state.review;
    modal(`
      <h2>QuickBooks file</h2>
      <p class="small muted">All billable time and materials, in the same columns as your QuickBooks bill sheet (Product/Service, Description, Qty, Customer). Entries already in a QuickBooks file are left out so nothing is billed twice.</p>
      <div class="grid2">
        <div class="field"><label for="qbFrom">From</label><input type="date" id="qbFrom" value="${esc(r.from)}"></div>
        <div class="field"><label for="qbTo">To</label><input type="date" id="qbTo" value="${esc(r.to)}"></div>
      </div>
      <div class="field"><label class="check"><input type="checkbox" id="qbAgain"> Include time already in a QuickBooks file (re-download)</label></div>
      <div id="qbInfo" class="small"></div>
      <div class="btn-row" style="justify-content:flex-end;margin-top:12px"><button class="secondary" data-close>Cancel</button><button data-go>Download</button></div>`,
    (m, close) => {
      $("[data-close]", m).onclick = close;
      $("[data-go]", m).onclick = async () => {
        const from = $("#qbFrom", m).value, to = $("#qbTo", m).value;
        const again = $("#qbAgain", m).checked;
        try {
          const rows = await S.listEntries({ from, to, notExported: !again });
          const { sent, held } = await Exports.exportQuickBooks(rows, { from, to });
          const fresh = sent.filter((e) => !e.qb_exported_at);
          if (fresh.length) await S.markExported(fresh.map((e) => e.id));
          close();
          toast(`${sent.length} entries in the file${held.length ? `, ${held.length} held back (see the "Held back" tab)` : ""}.`);
          if (state.view === "review") renderReview();
        } catch (e) { fail(e); }
      };
    });
  }

  async function showHistory(e) {
    let rows = [];
    try { rows = await S.entryHistory(e.id); } catch (err) { return fail(err); }
    const fields = { client_id: "Client", property: "Property", entry_date: "Date", hours: "Hours", service_type_id: "Service", description: "Description", site_minimum_amount: "Site minimum $", origination: "Origination", status: "Status", qb_exported_at: "QuickBooks file" };
    const show = (k, v) => {
      if (k === "client_id") { const c = clientById(v); return c ? c.name : v; }
      if (k === "service_type_id") { const s = state.lists.serviceTypes.find((x) => x.id === Number(v)); return s ? s.name : "—"; }
      return v == null || v === "" ? "—" : v;
    };
    const html = rows.map((h) => {
      const when = new Date(h.changed_at).toLocaleString();
      let detail = "";
      if (h.action === "update" && h.old_data && h.new_data) {
        detail = Object.keys(fields).filter((k) => String(h.old_data[k]) !== String(h.new_data[k]))
          .map((k) => `<div class="small">${fields[k]}: <s>${esc(show(k, h.old_data[k]))}</s> → ${esc(show(k, h.new_data[k]))}</div>`).join("") || `<div class="small muted">Materials or no visible change</div>`;
      }
      return `<div class="entry"><div><div class="title">${esc({ insert: "Created", update: "Changed", delete: "Deleted" }[h.action] || h.action)} by ${esc(personName(h.changed_by))}</div><div class="meta">${esc(when)}</div>${detail}</div></div>`;
    }).join("");
    modal(`<h2>Entry history</h2><p class="small muted">${esc(e.client_name)} · ${esc(niceDate(e.entry_date))} · ${fmtH(e.hours)} hrs</p>${html || "<p class='muted'>No history yet.</p>"}<div class="btn-row" style="justify-content:flex-end;margin-top:12px"><button data-close>Close</button></div>`,
      (m, close) => { $("[data-close]", m).onclick = close; });
  }

  // =====================================================================
  // Admin: people and invitations (TT-02)
  // =====================================================================
  async function renderPeople() {
    if (!isAdmin()) return;
    const el = $("#view-people");
    let invites = [];
    let access = null; // last sign-in etc. from the admin-users function
    let accessError = "";
    try { state.profiles = await S.listProfiles(); invites = await S.listInvitations(); } catch (e) { fail(e); }
    try { access = await S.listAccess(); } catch (e) { accessError = S.friendlyError(e); }
    const accessOf = (id) => (access || []).find((a) => a.id === id) || null;
    const signInCell = (p) => {
      const a = accessOf(p.id);
      if (!a) return `<span class="muted">-</span>`;
      const when = a.last_sign_in_at ? new Date(a.last_sign_in_at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "Never";
      const note = !p.active ? "" : a.needs_password ? (a.temp_password_set_at ? "Has a temporary password" : "Hasn't chosen a password yet") : "";
      return `${esc(when)}${note ? `<br><span class="small muted">${esc(note)}</span>` : ""}`;
    };
    el.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Admin</p><h1>People</h1></div></div>
      <div class="card">
        <h2>Invite someone</h2>
        <p class="small muted">They get an email with a link to set their password. Only invited people can get in.<br><b>Consultant</b> and <b>Technician</b> log and see only their own time. <b>Admin</b> also sees everyone's time, downloads reports and manages people and lists.</p>
        <div class="grid4">
          <div class="field"><label for="ivName">Name <span class="req">*</span></label><input id="ivName"></div>
          <div class="field"><label for="ivEmail">Email <span class="req">*</span></label><input id="ivEmail" type="email"></div>
          <div class="field"><label for="ivRole">Role <span class="req">*</span></label>
            <select id="ivRole"><option value="">Choose…</option>${roleOptions("")}</select></div>
          <div class="field" style="padding-top:28px"><button type="button" id="ivSend" style="width:100%">Send invitation</button></div>
        </div>
        ${invites.length ? `<p class="small"><b>Waiting to accept:</b> ${invites.map((i) => `${esc(i.full_name || i.email)} (${esc(i.email)}, ${esc(i.role)})`).join("; ")}</p>` : ""}
      </div>
      <div class="card">
        <h2>Who has access</h2>
        <p class="small muted">Everyone who can sign in to the Time Tracker and the Report Builder (they share one login).</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>${state.profiles.map((p) => `<tr data-id="${esc(p.id)}">
            <td>${esc(p.full_name || "")}${p.active ? "" : ` <span class="small muted">(turned off)</span>`}</td>
            <td>${esc(p.email)}</td>
            <td>${esc(roleLabel(p.role))}</td>
            <td class="small">${signInCell(p)}</td>
            <td style="text-align:right">${p.id === state.me.id ? `<span class="small muted">You</span>` : `<button type="button" class="small secondary" data-reset style="white-space:nowrap">Reset password</button>`}</td>
          </tr>`).join("")}</tbody>
        </table></div>
        ${accessError ? `<p class="small error-text">Couldn't load sign-in details: ${esc(accessError)}</p>` : ""}
        <p class="hint"><b>Reset password</b> gives the person a temporary password to pass on to them. It shows once, and they're asked to choose their own the next time they sign in. Passwords are stored scrambled, so nobody (admins included) can look up someone's current password.</p>
      </div>
      <div class="card">
        <h2>Team</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>QuickBooks name</th><th>Active</th><th></th></tr></thead>
          <tbody>${state.profiles.map((p) => `<tr data-id="${esc(p.id)}">
            <td><input class="pName" value="${esc(p.full_name)}" aria-label="Name"></td>
            <td>${esc(p.email)}</td>
            <td><select class="pRole" aria-label="Role" ${p.id === state.me.id ? "disabled" : ""}>${roleOptions(p.role)}</select></td>
            <td><input class="pQB" value="${esc(p.qb_name || "")}" placeholder="e.g. Robbie Stephens" aria-label="QuickBooks name"></td>
            <td><input type="checkbox" class="pActive" ${p.active ? "checked" : ""} ${p.id === state.me.id ? "disabled" : ""} aria-label="Active"></td>
            <td><button type="button" class="small" data-save>Save</button></td>
          </tr>`).join("")}</tbody>
        </table></div>
        <p class="hint">QuickBooks name is the name used in your QuickBooks Product/Service, for example "Consulting Time:Horticultural Consulting; Site Inspection <b>Robbie Stephens</b>". Turn off Active when someone leaves; their past time stays.</p>
      </div>`;
    $("#ivSend").onclick = async () => {
      const full_name = $("#ivName").value.trim(), email = $("#ivEmail").value.trim(), role = $("#ivRole").value;
      if (!full_name || !email || !role) return toast("Name, email and role are all needed.", true);
      try { await S.invite({ email, full_name, role }); toast(`Invitation sent to ${email}.`); renderPeople(); } catch (e) { fail(e); }
    };
    $$("[data-save]", el).forEach((b) => (b.onclick = async () => {
      const tr = b.closest("tr");
      const id = tr.dataset.id;
      const patch = { full_name: $(".pName", tr).value.trim(), qb_name: $(".pQB", tr).value.trim() || null };
      if (id !== state.me.id) { patch.role = $(".pRole", tr).value; patch.active = $(".pActive", tr).checked; }
      try { await S.updateProfile(id, patch); toast("Saved."); } catch (e) { fail(e); }
    }));
    $$("[data-reset]", el).forEach((b) => (b.onclick = async () => {
      const p = state.profiles.find((x) => x.id === b.closest("tr").dataset.id);
      const name = p.full_name || p.email;
      const ok = await confirmBox(
        `Reset ${name}'s password?`,
        `Their current password stops working and they're signed out everywhere. You'll get a temporary password to give them, and they'll choose their own the next time they sign in.`,
        "Reset password"
      );
      if (!ok) return;
      b.disabled = true;
      try {
        const r = await S.resetPassword(p.id);
        await renderPeople();
        showTempPassword(r);
      } catch (e) { fail(e); b.disabled = false; }
    }));
  }

  // Shows a new temporary password once. It isn't saved anywhere, so it can't be shown again.
  function showTempPassword(r) {
    const name = r.full_name || r.email;
    modal(`
      <h2>Temporary password for ${esc(name)}</h2>
      <p class="small muted">Give this to ${esc(name)} in person, by phone or by text. This is the only time it's shown. If it gets lost, just reset it again.</p>
      <div class="field"><label>Email</label><div><b>${esc(r.email)}</b></div></div>
      <div class="field"><label for="tmpPw">Temporary password</label>
        <input id="tmpPw" readonly value="${esc(r.temp_password)}" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:1.2rem;letter-spacing:1px"></div>
      <p class="small">When they sign in with it, the app asks them to choose their own password before they can do anything else.${r.signed_out === false ? " (They may stay signed in on a device they're already using until it refreshes.)" : ""}</p>
      <div class="btn-row" style="justify-content:flex-end"><button class="secondary" data-copy>Copy</button><button data-done>Done</button></div>
    `, (m, close) => {
      const input = $("#tmpPw", m);
      input.onfocus = () => input.select();
      $("[data-copy]", m).onclick = async () => {
        try { await navigator.clipboard.writeText(r.temp_password); toast("Copied."); }
        catch (e) { input.focus(); input.select(); toast("Press Ctrl+C (or Cmd+C) to copy."); }
      };
      $("[data-done]", m).onclick = close;
    });
  }

  // =====================================================================
  // Admin: clients, materials, service types (TT-15, TT-16)
  // =====================================================================
  async function renderLists() {
    if (!isAdmin()) return;
    const el = $("#view-lists");
    const tab = state.listsTab;
    el.innerHTML = `
      <div class="page-head"><div><p class="eyebrow">Admin</p><h1>Lists</h1></div></div>
      <div class="tabs">
        ${[["clients", "Clients"], ["materials", "Materials"], ["newmats", "New materials to review"], ["services", "Service types"]].map(([id, label]) => `<button type="button" data-tab="${id}" class="${tab === id ? "active" : ""}">${label}</button>`).join("")}
      </div>
      <div class="card" id="listBody"></div>`;
    $$("[data-tab]", el).forEach((b) => (b.onclick = () => { state.listsTab = b.dataset.tab; renderLists(); }));
    const body = $("#listBody");
    if (tab === "clients") renderClientsTab(body);
    if (tab === "materials") renderMaterialsTab(body);
    if (tab === "newmats") renderNewMaterialsTab(body);
    if (tab === "services") renderServicesTab(body);
  }
  async function refreshLists() { state.lists = await S.loadLists(); }

  // Shared "update from a file" window for clients, materials and services
  function importModal({ title, intro, accept, turnOffLabel, parse, save }) {
    modal(`
      <h2>${esc(title)}</h2>
      <div class="small muted" style="margin-bottom:12px">${intro}</div>
      <div class="field"><label for="imFile">File</label><input id="imFile" type="file" accept="${accept}"></div>
      <div class="field"><label class="check"><input type="checkbox" id="imOff"> ${esc(turnOffLabel)}</label></div>
      <div id="imInfo" class="small"></div>
      <div class="btn-row" style="justify-content:flex-end;margin-top:12px"><button class="secondary" data-close>Cancel</button><button data-go disabled>Update list</button></div>`,
    (m, close) => {
      let rows = null;
      $("[data-close]", m).onclick = close;
      $("#imFile", m).onchange = async (ev) => {
        const file = ev.target.files[0];
        rows = null; $("[data-go]", m).disabled = true;
        if (!file) return;
        try {
          rows = parse(await Importers.readFileRows(file));
          $("#imInfo", m).textContent = `Found ${rows.length} rows. Click Update list to load them.`;
          $("[data-go]", m).disabled = !rows.length;
        } catch (e) { $("#imInfo", m).innerHTML = `<span class="error-text">${esc(e.message)}</span>`; }
      };
      $("[data-go]", m).onclick = async () => {
        try {
          const r = await save(rows, $("#imOff", m).checked);
          await refreshLists(); close();
          toast(`${r.added} added, ${r.updated} updated${r.turned_off ? `, ${r.turned_off} turned off` : ""}.`);
          renderLists();
        } catch (e) { fail(e); }
      };
    });
  }

  function renderClientsTab(body) {
    body.innerHTML = `
      <div class="btn-row" style="margin-bottom:12px">
        <input id="clSearch" type="search" placeholder="Search clients" style="max-width:320px">
        <select id="clType" style="max-width:180px"><option value="">All customers</option><option value="recurring">Recurring</option><option value="oneoff">One-off</option></select>
        <button type="button" id="clAdd">+ Add client</button>
        <button type="button" class="secondary" id="clBulk">Add several</button>
        <button type="button" class="secondary" id="clImport">Update from QuickBooks</button>
      </div>
      <div class="table-wrap" id="clTable"></div>
      <p class="hint">Customers are matched on their QuickBooks full name, so two customers with the same short name stay separate. Turn a client off instead of deleting it: it disappears from search but old entries keep the name.</p>`;
    const draw = () => {
      const q = $("#clSearch").value.trim().toLowerCase();
      const type = $("#clType").value;
      const list = state.lists.clients.filter((c) => (!q || c.name.toLowerCase().includes(q) || (c.qb_name || "").toLowerCase().includes(q))
        && (!type || (type === "oneoff") === !!c.one_off));
      $("#clTable").innerHTML = `<table><thead><tr><th>Client</th><th>QuickBooks full name</th><th>Type</th><th>Properties</th><th>Active</th><th></th></tr></thead><tbody>
        ${list.slice(0, 150).map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.qb_name || "—")}</td><td>${c.one_off ? '<span class="badge oneoff">One-off</span>' : "Recurring"}</td><td>${esc((c.properties || []).join(", "))}</td><td>${c.active ? "Yes" : "No"}</td><td><button type="button" class="ghost small" data-cl="${c.id}">Edit</button></td></tr>`).join("")}
        </tbody></table>${list.length > 150 ? `<p class="hint">Showing 150 of ${list.length}. Search to narrow it down.</p>` : ""}`;
      $$("[data-cl]").forEach((b) => (b.onclick = () => clientModal(clientById(b.dataset.cl))));
    };
    $("#clSearch").oninput = draw;
    $("#clType").onchange = draw;
    $("#clAdd").onclick = () => clientModal(null);
    $("#clBulk").onclick = bulkClientsModal;
    $("#clImport").onclick = () => importModal({
      title: "Update customers from QuickBooks",
      intro: "In QuickBooks, go to <b>Sales &gt; Customers</b>, click the export icon and choose <b>Export to Excel</b>. Choose that file here. Customers are matched on their <b>Customer full name</b>. A client first added under the contact's name (like &quot;Joel Broder&quot;) is renamed to its QuickBooks name (like &quot;59 Evergreen&quot;) and keeps its time. New ones are added, and existing ones keep their properties and one-off setting.",
      accept: ".xlsx,.csv",
      turnOffLabel: "Turn off customers that aren't in this file",
      parse: Importers.parseQuickBooksCustomers,
      save: (rows, off) => S.importClients(rows, off),
    });
    draw();
  }
  // Paste a list of clients, one per line. Names already on the list are skipped.
  function bulkClientsModal() {
    modal(`
      <h2>Add several clients</h2>
      <p class="small muted">Type or paste one client per line, using the customer's full name as it appears in QuickBooks. You can paste a column straight from a spreadsheet. Names already on the list are skipped.</p>
      <div class="field"><label for="bkNames">Clients</label><textarea id="bkNames" rows="10" placeholder="Smith Residence&#10;Desert Ridge HOA&#10;Mitschelles:Hargreaves"></textarea></div>
      <div class="field"><label class="check"><input type="checkbox" id="bkOneOff"> These are one-off customers (not recurring)</label></div>
      <p class="small" id="bkInfo"></p>
      <div class="btn-row" style="justify-content:flex-end"><button class="secondary" data-close>Cancel</button><button data-go>Add clients</button></div>`,
    (m, close) => {
      $("[data-close]", m).onclick = close;
      const key = (x) => x.replace(/\s+/g, " ").trim().toLowerCase();
      const parse = () => {
        const known = new Set();
        state.lists.clients.forEach((c) => { known.add(key(c.name)); if (c.qb_name) known.add(key(c.qb_name)); });
        const seen = new Set(); const fresh = []; let dupes = 0;
        $("#bkNames", m).value.split(/\r?\n/).map((l) => l.split("\t")[0].replace(/\s+/g, " ").trim()).filter(Boolean).forEach((n) => {
          const k = key(n);
          if (known.has(k) || seen.has(k)) { dupes++; return; }
          seen.add(k); fresh.push(n);
        });
        return { fresh, dupes };
      };
      $("#bkNames", m).oninput = () => {
        const { fresh, dupes } = parse();
        $("#bkInfo", m).textContent = fresh.length || dupes ? `${fresh.length} new${dupes ? `, ${dupes} already on the list` : ""}.` : "";
      };
      $("[data-go]", m).onclick = async () => {
        const { fresh, dupes } = parse();
        if (!fresh.length) return toast(dupes ? "All of those are already on the list." : "Add at least one name.", true);
        const btn = $("[data-go]", m); btn.disabled = true;
        const one_off = $("#bkOneOff", m).checked;
        let added = 0;
        try {
          for (const name of fresh) {
            await S.saveClient({ name, qb_name: name, properties: [], one_off, active: true });
            added++;
          }
          await refreshLists(); close(); toast(`${added} client${added === 1 ? "" : "s"} added${dupes ? `, ${dupes} already on the list` : ""}.`); renderLists();
        } catch (e) {
          btn.disabled = false;
          try { await refreshLists(); } catch (e2) { /* ignore */ }
          fail(e);
        }
      };
    });
  }
  function clientModal(c) {
    c = c || { name: "", qb_name: "", properties: [], one_off: false, active: true };
    modal(`
      <h2>${c.id ? "Edit client" : "Add client"}</h2>
      <div class="field"><label for="cmName">Client name <span class="req">*</span></label><input id="cmName" value="${esc(c.name)}"></div>
      <div class="field"><label for="cmQB">QuickBooks full name</label><input id="cmQB" value="${esc(c.qb_name || "")}" placeholder="Exactly as in QuickBooks"><div class="hint">Used to match customers and on the QuickBooks file.</div></div>
      <div class="field"><label for="cmProps">Properties</label><textarea id="cmProps" placeholder="One per line">${esc((c.properties || []).join("\n"))}</textarea></div>
      <div class="field"><label class="check"><input type="checkbox" id="cmOneOff" ${c.one_off ? "checked" : ""}> One-off customer (not recurring)</label></div>
      <div class="field"><label class="check"><input type="checkbox" id="cmActive" ${c.active ? "checked" : ""}> Active</label></div>
      <div class="btn-row" style="justify-content:flex-end"><button class="secondary" data-close>Cancel</button><button data-go>Save</button></div>`,
    (m, close) => {
      $("[data-close]", m).onclick = close;
      $("[data-go]", m).onclick = async () => {
        const name = $("#cmName", m).value.trim();
        if (!name) return toast("Client name is needed.", true);
        try {
          await S.saveClient({ id: c.id, name, qb_name: $("#cmQB", m).value.trim(), properties: $("#cmProps", m).value.split("\n").map((s) => s.trim()).filter(Boolean), one_off: $("#cmOneOff", m).checked, active: $("#cmActive", m).checked });
          await refreshLists(); close(); toast("Client saved."); renderLists();
        } catch (e) { fail(e); }
      };
    });
  }

  const money2 = (v) => (v == null || v === "" ? "—" : "$" + Number(v).toFixed(2));
  function renderMaterialsTab(body) {
    body.innerHTML = `
      <div class="btn-row" style="margin-bottom:12px">
        <button type="button" id="mtAdd">+ Add material</button>
        <button type="button" class="secondary" id="mtImport">Update from Materials Price List</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Material</th><th>Store</th><th>Unit</th><th class="num">Client price per unit</th><th class="num">Our cost</th><th>Package size</th><th>Active</th><th></th></tr></thead><tbody>
      ${state.lists.materials.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.store || "")}</td><td>${esc(m.unit)}</td><td class="num">${money2(m.price)}</td><td class="num">${money2(m.cost)}</td><td class="small">${esc(m.unit_size || "")}</td><td>${m.active ? "Yes" : "Retired"}</td><td><button type="button" class="ghost small" data-mt="${m.id}">Edit</button></td></tr>`).join("")}
      </tbody></table></div>
      <p class="hint">People pick a material, then enter how many of its unit they used (for example 3 tbsp). Retired materials stop showing in the list but stay on old entries.</p>`;
    $("#mtAdd").onclick = () => materialModal(null);
    $("#mtImport").onclick = () => importModal({
      title: "Update from Materials Price List",
      intro: "Open the <b>Materials Price List</b> Google Sheet, go to <b>File &gt; Download &gt; Microsoft Excel (.xlsx)</b>, and choose that file here. The client charge column sets each material's unit and price (for example \"$.20 / tbsp\").",
      accept: ".xlsx,.csv",
      turnOffLabel: "Retire materials that aren't in this file",
      parse: Importers.parseMaterialsSheet,
      save: (rows, off) => S.importMaterials(rows, off),
    });
    $$("[data-mt]").forEach((b) => (b.onclick = () => materialModal(state.lists.materials.find((x) => x.id === Number(b.dataset.mt)))));
  }
  function materialModal(mat, after) {
    mat = mat || { name: "", unit: "each", price: "", active: true };
    modal(`
      <h2>${mat.id ? "Edit material" : "Add material"}</h2>
      <div class="field"><label for="mmName">Name <span class="req">*</span></label><input id="mmName" value="${esc(mat.name)}"></div>
      <div class="grid2">
        <div class="field"><label for="mmUnit">Unit people enter</label><input id="mmUnit" value="${esc(mat.unit || "each")}" placeholder="tbsp, cup, oz, ft, each"></div>
        <div class="field"><label for="mmPrice">Client price per unit ($)</label><input id="mmPrice" type="number" step="0.01" min="0" value="${mat.price == null ? "" : esc(mat.price)}"></div>
        <div class="field"><label for="mmStore">Store</label><input id="mmStore" value="${esc(mat.store || "")}"></div>
        <div class="field"><label for="mmCost">Our cost ($)</label><input id="mmCost" type="number" step="0.01" min="0" value="${mat.cost == null ? "" : esc(mat.cost)}"></div>
      </div>
      <div class="field"><label for="mmSize">Package size</label><input id="mmSize" value="${esc(mat.unit_size || "")}" placeholder="e.g. 5 lbs = 80 oz"></div>
      <div class="field"><label class="check"><input type="checkbox" id="mmActive" ${mat.active ? "checked" : ""}> Active (uncheck to retire)</label></div>
      <div class="btn-row" style="justify-content:flex-end"><button class="secondary" data-close>Cancel</button><button data-go>Save</button></div>`,
    (m, close) => {
      $("[data-close]", m).onclick = close;
      $("[data-go]", m).onclick = async () => {
        const name = $("#mmName", m).value.trim();
        if (!name) return toast("Name is needed.", true);
        try {
          const id = await S.saveMaterial({
            id: mat.id, name, unit: $("#mmUnit", m).value.trim(), price: $("#mmPrice", m).value, store: $("#mmStore", m).value.trim(),
            cost: $("#mmCost", m).value, unit_size: $("#mmSize", m).value.trim(), client_charge: mat.client_charge, active: $("#mmActive", m).checked,
          });
          if (after) await after(id);
          await refreshLists(); close(); toast("Material saved."); renderLists();
        } catch (e) { fail(e); }
      };
    });
  }

  async function renderNewMaterialsTab(body) {
    body.innerHTML = `<p class="muted">Loading…</p>`;
    let rows = [];
    try { rows = await S.listNewMaterials(); } catch (e) { body.textContent = S.friendlyError(e); return; }
    body.innerHTML = rows.length ? `
      <p class="small muted">Materials people typed that aren't on the list yet. Add them to the list, or dismiss if it was a one-off.</p>
      <div class="table-wrap"><table><thead><tr><th>Material typed</th><th class="num">Qty</th><th>Date</th><th>Person</th><th>Client</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.quantity}</td><td>${esc(r.entry_date || "")}</td><td>${esc(r.person_name)}</td><td>${esc(r.client_name)}</td>
        <td style="white-space:nowrap"><button type="button" class="small" data-addlist="${r.id}">Add to list</button> <button type="button" class="secondary small" data-dismiss="${r.id}">Dismiss</button></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">Nothing to review.</p>`;
    $$("[data-addlist]", body).forEach((b) => (b.onclick = () => {
      const r = rows.find((x) => String(x.id) === b.dataset.addlist);
      const existing = state.lists.materials.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
      if (existing) { S.resolveNewMaterial(r.id, existing.id).then(() => { toast("Linked to the existing material."); renderLists(); }).catch(fail); return; }
      materialModal({ name: r.name, unit: r.unit || "each", price: "", active: true }, (id) => S.resolveNewMaterial(r.id, id));
    }));
    $$("[data-dismiss]", body).forEach((b) => (b.onclick = async () => {
      try { await S.resolveNewMaterial(Number(b.dataset.dismiss), null); toast("Dismissed."); renderLists(); } catch (e) { fail(e); }
    }));
  }

  function renderServicesTab(body) {
    body.innerHTML = `
      <p class="small muted">These come from your QuickBooks Products and Services list. A service with someone's name is only offered to that person; the rest are offered to everyone. Turn off any you don't log time against.</p>
      <div class="btn-row" style="margin-bottom:12px">
        <button type="button" id="svAdd">+ Add service</button>
        <button type="button" class="secondary" id="svImport">Update from QuickBooks</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Service</th><th>Offered to</th><th class="num">Rate</th><th>Billable</th><th>Active</th><th></th></tr></thead><tbody>
      ${state.lists.serviceTypes.map((s) => `<tr><td>${esc(s.name)}<div class="small muted">${esc(s.help_text || "")}</div></td><td>${esc(s.for_person || "Everyone")}</td><td class="num">${money2(s.rate)}</td><td>${s.billable ? "Yes" : "No"}</td><td>${s.active ? "Yes" : "No"}</td><td><button type="button" class="ghost small" data-sv="${s.id}">Edit</button></td></tr>`).join("")}
      </tbody></table></div>`;
    $("#svAdd").onclick = () => serviceModal(null);
    $("#svImport").onclick = () => importModal({
      title: "Update services from QuickBooks",
      intro: "In QuickBooks, go to <b>Sales &gt; Products and services</b>, click the export icon, and choose the file it downloads. Services that name a person are matched to that person by name.",
      accept: ".csv,.xlsx",
      turnOffLabel: "Turn off services that aren't in this file",
      parse: (rows) => Importers.parseQuickBooksServices(rows, state.profiles.map((p) => ({ name: p.full_name || p.qb_name })).filter((p) => p.name)),
      save: (rows, off) => S.importServices(rows, off),
    });
    $$("[data-sv]").forEach((b) => (b.onclick = () => serviceModal(state.lists.serviceTypes.find((x) => x.id === Number(b.dataset.sv)))));
  }
  function serviceModal(s) {
    s = s || { name: "", help_text: "", qb_item: "", for_person: "", billable: true, sort_order: state.lists.serviceTypes.length + 1, active: true };
    const names = Array.from(new Set(state.profiles.map((p) => p.full_name).filter(Boolean).concat(s.for_person ? [s.for_person] : [])));
    modal(`
      <h2>${s.id ? "Edit service" : "Add service"}</h2>
      <div class="field"><label for="smName">Name <span class="req">*</span></label><input id="smName" value="${esc(s.name)}"></div>
      <div class="field"><label for="smFor">Offered to</label>
        <select id="smFor"><option value="">Everyone</option>${names.map((n) => `<option value="${esc(n)}" ${n === s.for_person ? "selected" : ""}>${esc(n)} only</option>`).join("")}</select></div>
      <div class="field"><label for="smHelp">What it covers</label><input id="smHelp" value="${esc(s.help_text || "")}"></div>
      <div class="field"><label for="smQB">QuickBooks Product/Service <span class="req">*</span></label><input id="smQB" value="${esc(s.qb_item || "")}" placeholder="Category:Name, as in QuickBooks"></div>
      <div class="grid2">
        <div class="field"><label for="smRate">Rate ($)</label><input id="smRate" type="number" step="0.01" min="0" value="${s.rate == null ? "" : esc(s.rate)}"></div>
        <div class="field"><label for="smOrder">Order in list</label><input id="smOrder" type="number" value="${esc(s.sort_order)}"></div>
      </div>
      <div class="field"><label class="check"><input type="checkbox" id="smBill" ${s.billable ? "checked" : ""}> Billable</label><label class="check"><input type="checkbox" id="smActive" ${s.active ? "checked" : ""}> Active</label></div>
      <div class="btn-row" style="justify-content:flex-end"><button class="secondary" data-close>Cancel</button><button data-go>Save</button></div>`,
    (m, close) => {
      $("[data-close]", m).onclick = close;
      $("[data-go]", m).onclick = async () => {
        const name = $("#smName", m).value.trim(), qb = $("#smQB", m).value.trim() || name;
        if (!name) return toast("Name is needed.", true);
        try {
          await S.saveServiceType({ id: s.id, name, category: s.category, for_person: $("#smFor", m).value, rate: $("#smRate", m).value, help_text: $("#smHelp", m).value.trim(), qb_item: qb, billable: $("#smBill", m).checked, sort_order: $("#smOrder", m).value, active: $("#smActive", m).checked });
          await refreshLists(); close(); toast("Saved."); renderLists();
        } catch (e) { fail(e); }
      };
    });
  }

  // =====================================================================
  // Start
  // =====================================================================
  $("#signOutBtn").onclick = () => S.signOut();
  $("#signOutBtnMobile").onclick = () => S.signOut();
  $("#resetDemoBtn").onclick = async () => {
    if (!(await confirmBox("Reset demo data?", "This clears everything you've tried in demo mode and starts fresh.", "Reset"))) return;
    await S.resetDemo(); state.form = null; startApp();
  };

  S.onAuthChange((event) => {
    if (event === "SIGNED_OUT") { state.me = null; state.view = "log"; state.form = null; state.review = null; renderSignIn(); }
    else if (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY" || event === "USER_UPDATED") {
      if (event === "USER_UPDATED" && state.me && !state.me.needs_password) return;
      if (event === "SIGNED_IN" && state.me && !$("#appView").classList.contains("hidden")) return; // token refresh on tab focus
      startApp();
    }
  });
  startApp();
})();
