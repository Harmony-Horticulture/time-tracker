// =====================================================================
// Reading the lists Harmony already keeps elsewhere:
//  - Materials Price List (Google Sheet, downloaded as .xlsx or .csv)
//  - QuickBooks Products and Services export (.csv or .xlsx)
//  - QuickBooks customer list export (.csv or .xlsx), matched on full name
// Works in the browser and in Node (used to build supabase/04 seed data).
// =====================================================================
(function (root) {
  const clean = (v) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQ = false;
    text = String(text).replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQ = false;
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => clean(c) !== ""));
  }

  // Reads an uploaded .csv or .xlsx File into rows of cell text (browser only)
  async function readFileRows(file) {
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") return parseCSV(await file.text());
    const wb = new root.ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const out = [];
      for (let c = 1; c <= r.cellCount; c++) {
        const v = r.getCell(c).value;
        out.push(v && typeof v === "object" ? (v.text || v.result || (v.richText ? v.richText.map((t) => t.text).join("") : "")) : v);
      }
      rows.push(out.map((x) => (x == null ? "" : String(x))));
    });
    return rows;
  }

  // ---------- money like "$ .08 cents / ft", "$. 2.60 / lid", "$12.00 / 8 oz" ----------
  function parseCharge(text) {
    const first = clean(text).split("=")[0];
    if (!first) return { price: null, unit: "" };
    const [amountPart, ...unitParts] = first.split("/");
    let num = amountPart.replace(/\$|cents?|'/gi, "").replace(/\s+/g, "");
    const m = num.match(/^\.(\d+\.\d+)$/); // "$. 2.60" means 2.60
    if (m) num = m[1];
    const price = parseFloat(num);
    return { price: isNaN(price) ? null : Math.round(price * 100) / 100, unit: clean(unitParts.join("/")) };
  }
  const money = (t) => parseCharge(t).price;

  // ---------- Materials Price List ----------
  function parseMaterialsSheet(rows) {
    const h = rows.findIndex((r) => /^item/i.test(clean(r[0])));
    const out = new Map();
    rows.slice(h + 1).forEach((r) => {
      const name = clean(r[0]);
      const store = clean(r[1]);
      if (!name || /mark-?up|guide/i.test(name) || /\$/.test(store)) return; // skip the markup guide rows
      const unitSize = clean(r[3]);
      let chargeText = clean(r[6]) || clean(r[5]);
      let { price, unit } = parseCharge(chargeText);
      if (price == null && clean(r[4])) { // only a marked-up price for the whole package
        price = money(r[4]);
        unit = clean(unitSize.replace(/^\//, ""));
        chargeText = clean(r[4]) + (unitSize ? " / " + unit : "");
      }
      const item = { name, store, unit: unit || "each", price, cost: money(r[2]), unit_size: unitSize, client_charge: chargeText };
      const key = name.toLowerCase();
      const prev = out.get(key);
      if (!prev || item.price != null || prev.price == null) out.set(key, item); // later priced rows win
    });
    return Array.from(out.values());
  }

  // ---------- QuickBooks Products and Services ----------
  // people: [{ name: "Robbie Stephens" }, ...]; an item naming someone is only offered to them
  const ACTIVE_CATEGORIES = ["consulting time", "labor", "labor + materials"];
  function findPerson(text, people) {
    const t = " " + text.toLowerCase() + " ";
    let hit = people.find((p) => p.name && t.includes(" " + p.name.toLowerCase()));
    if (!hit) hit = people.find((p) => p.name && new RegExp("\\b" + p.name.split(" ")[0].toLowerCase() + "\\b").test(t));
    return hit ? hit.name : null;
  }
  function parseQuickBooksServices(rows, people) {
    const head = rows[0].map((c) => clean(c).toLowerCase());
    const col = (n) => head.indexOf(n);
    const iName = col("product/service name"), iType = col("item type"), iCat = col("category"), iPrice = col("price"),
      iIncome = col("income account"), iDesc = col("sales description"), iSupp = col("preferred supplier");
    if (iName < 0 || iType < 0) throw new Error("This doesn't look like a QuickBooks Products and Services export.");
    return rows.slice(1).filter((r) => clean(r[iType]).toLowerCase() === "service").map((r, i) => {
      const name = clean(r[iName]);
      const category = iCat >= 0 ? clean(r[iCat]) : "";
      const desc = iDesc >= 0 ? clean(r[iDesc]) : "";
      return {
        name,
        category,
        qb_item: category ? `${category}:${name}` : name,
        for_person: findPerson(`${name} ${desc} ${iSupp >= 0 ? clean(r[iSupp]) : ""}`, people),
        rate: iPrice >= 0 ? money(r[iPrice]) : null,
        billable: !/non.?billable/i.test(iIncome >= 0 ? r[iIncome] : ""),
        active: ACTIVE_CATEGORIES.includes(category.toLowerCase()),
        help_text: desc,
        sort_order: i + 1,
      };
    });
  }

  // ---------- QuickBooks customers (full name is the unique key) ----------
  function parseQuickBooksCustomers(rows) {
    const hi = rows.findIndex((r) => r.some((c) => /full ?name|^customer$|^name$|display name/i.test(clean(c))));
    if (hi < 0) throw new Error("Couldn't find a customer name column. Export the customer list from QuickBooks and try again.");
    const head = rows[hi].map((c) => clean(c).toLowerCase());
    const pick = ["customer full name", "full name", "fullname", "customer", "name", "display name"].map((n) => head.indexOf(n)).find((i) => i >= 0);
    // The contact's name (QuickBooks "Full name" next to "Customer full name"), used to find clients first added under a person's name
    const contactCol = head[pick] === "customer full name" ? head.indexOf("full name") : -1;
    const seen = new Set();
    const out = [];
    rows.slice(hi + 1).forEach((r) => {
      const n = clean(r[pick]);
      if (!n || /^total/i.test(n) || seen.has(n.toLowerCase())) return;
      // QuickBooks puts the date the report was run under the list, e.g. "Tuesday, November 17, 2026 07:23 PM GMT-07:00"
      if (/^(mon|tues|wednes|thurs|fri|satur|sun)day, .*\d{4}/i.test(n) || /GMT[+-]\d/.test(n)) return;
      seen.add(n.toLowerCase());
      const row = { full_name: n };
      if (contactCol >= 0 && clean(r[contactCol])) row.contact = clean(r[contactCol]);
      out.push(row);
    });
    return out;
  }

  // Clients that were first added under the contact's name (e.g. "Joel Broder") instead of the
  // QuickBooks customer name ("59 Evergreen"). Returns [{ id, full_name }] to rename before importing.
  function matchByContact(rows, clients) {
    const k = (s) => clean(s).replace(/\s+/g, " ").toLowerCase();
    const known = new Set();
    clients.forEach((c) => { known.add(k(c.name)); if (c.qb_name) known.add(k(c.qb_name)); });
    const inFile = new Set(rows.map((r) => k(r.full_name)));
    const free = clients.filter((c) => !inFile.has(k(c.name)) && !(c.qb_name && inFile.has(k(c.qb_name))));
    const used = new Set();
    const out = [];
    rows.forEach((r) => {
      if (!r.contact || known.has(k(r.full_name))) return;
      const c = free.find((x) => !used.has(x.id) && (k(x.name) === k(r.contact) || (x.qb_name && k(x.qb_name) === k(r.contact))));
      if (!c) return;
      used.add(c.id);
      out.push({ id: c.id, full_name: r.full_name });
    });
    return out;
  }

  const api = { parseCSV, readFileRows, parseCharge, parseMaterialsSheet, parseQuickBooksServices, parseQuickBooksCustomers, matchByContact };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Importers = api;
})(typeof window !== "undefined" ? window : globalThis);
