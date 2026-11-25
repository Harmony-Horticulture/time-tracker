// =====================================================================
// Consultant check: a consultant's bill next to the time they logged
// in the app and what's been paid. Nothing here is saved; it reads the
// uploaded bill, compares it with the entries and hands back the result.
// Works in the browser and in Node (for testing).
// =====================================================================
(function (root) {
  const clean = (v) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
  const pad = (n) => String(n).padStart(2, "0");
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const num = (v) => {
    if (typeof v === "number") return v;
    const s = clean(v).replace(/[$,\s]/g, "");
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    return Number(s);
  };

  // "10/26/2026", "2026-10-26", a Date, or an Excel serial number -> "2026-10-26"
  function toISO(v) {
    if (v == null || v === "") return "";
    if (v instanceof Date && !isNaN(v)) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    if (typeof v === "number" && v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5);
      return toISO(d);
    }
    const s = clean(v);
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(m[1])}-${pad(m[2])}`;
    return "";
  }

  // Reads an uploaded .xlsx or .csv and returns the rows of the sheet that looks most like a time log
  async function readBillFile(file) {
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") return root.Importers.parseCSV(await file.text());
    const sheets = await readSheets(file);
    let best = null;
    sheets.forEach((sh) => {
      const score = parseBill(sh.rows).lines.length;
      if (!best || score > best.score) best = { rows: sh.rows, score };
    });
    return best ? best.rows : [];
  }

  // Every sheet of an .xlsx as { name, rows }, dates kept as Dates
  async function readSheets(file) {
    const buf = await file.arrayBuffer();
    try { return await root.XlsxLite.read(buf); }
    catch (e) {
      const wb = new root.ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      return wb.worksheets.map((ws) => {
        const rows = [];
        ws.eachRow({ includeEmpty: false }, (r) => {
          const out = [];
          for (let c = 1; c <= r.cellCount; c++) {
            let v = r.getCell(c).value;
            if (v && typeof v === "object" && !(v instanceof Date)) v = v.result !== undefined ? v.result : v.text || (v.richText ? v.richText.map((t) => t.text).join("") : "");
            out.push(v == null ? "" : v);
          }
          rows.push(out);
        });
        return { name: ws.name, rows };
      });
    }
  }

  // Finds the header row and turns the rows under it into bill lines.
  // Understands the consultant's own time log (Property Name, Service Date,
  // Hours, Description, Consultant Billable Rate, Rate Type) and the
  // QuickBooks bill sheet (Product/Service, Description, Qty, Customer).
  function parseBill(rows) {
    const find = (cells, re) => cells.findIndex((c) => re.test(clean(c).toLowerCase()));
    let h = -1, col = {};
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const cells = rows[i].map((c) => clean(c));
      const client = find(cells, /^(property( name)?|client( name)?|customer( name)?|customer:? ?job|job)$/);
      const hours = find(cells, /^(hours?|hrs|qty|quantity|time)$/);
      if (client >= 0 && hours >= 0) {
        h = i;
        col = {
          client, hours,
          date: find(cells, /date/),
          description: find(cells, /^(description|memo|notes?|task|work done|activity)$/),
          rate: find(cells, /rate$|^rate|billable rate/),
          rateType: find(cells, /rate type|^type$/),
          amount: find(cells, /^(amount|total|line total)$/),
        };
        break;
      }
    }
    if (h < 0) return { lines: [], error: "Couldn't find the column headings. The file needs a Property, Client or Customer column and an Hours or Qty column." };
    const lines = [];
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i];
      const client = clean(r[col.client]);
      const hours = num(r[col.hours]);
      if (!client || hours == null || hours === 0 || /\btotal\b/i.test(client)) continue;
      const rate = col.rate >= 0 ? num(r[col.rate]) : null;
      const rateType = col.rateType >= 0 ? clean(r[col.rateType]) : "";
      let amount = col.amount >= 0 ? num(r[col.amount]) : null;
      // A site minimum is a flat charge for the visit; everything else is hours x rate
      if (amount == null && rate != null) amount = /site ?min/i.test(rateType) ? rate : hours * rate;
      lines.push({
        row: i + 1, client, date: col.date >= 0 ? toISO(r[col.date]) : "", hours: round2(hours),
        description: col.description >= 0 ? clean(r[col.description]) : "",
        rate, rateType, amount: amount == null ? null : round2(amount),
      });
    }
    return { lines, hasDates: col.date >= 0 && lines.some((l) => l.date), hasAmounts: lines.some((l) => l.amount != null) };
  }

  // Client names differ between a bill ("Azure") and the app ("Azure HOA",
  // "Ricci, Kelly"), so compare on a simplified key.
  const STOP = /\b(the|residence|res|hoa|estate|estates|home|house|property|llc|inc|community|association|assn)\b/g;
  function clientKey(name) {
    return clean(name).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(STOP, " ").replace(/\s+/g, " ").trim();
  }
  // Picks the app's client name for a bill name: same key, or one starts with the other's first word
  function clientMatcher(appNames) {
    const keys = appNames.map((n) => ({ n, k: clientKey(n) }));
    const cache = new Map();
    return (billName) => {
      if (cache.has(billName)) return cache.get(billName);
      const k = clientKey(billName);
      let hit = keys.find((x) => x.k === k);
      if (!hit && k) {
        const first = k.split(" ")[0];
        const cands = keys.filter((x) => x.k.split(" ").includes(first) || k.split(" ").includes(x.k.split(" ")[0]));
        if (cands.length === 1) hit = cands[0];
      }
      const out = hit ? hit.n : clean(billName);
      cache.set(billName, out);
      return out;
    };
  }

  const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 864e5);

  // entries: time entries from the app for that person and month
  // lines:   bill lines from parseBill
  // Returns visits (one row per client and date) and clients (totals per client)
  function compare(entries, lines, opts = {}) {
    const match = clientMatcher(Array.from(new Set(entries.map((e) => e.client_name))));
    const useDates = opts.hasDates !== false && lines.some((l) => l.date);
    const key = (client, date) => client + "|" + (useDates ? date : "");
    const visits = new Map();
    const get = (client, date) => {
      const k = key(client, date);
      if (!visits.has(k)) visits.set(k, { client, date: useDates ? date : "", appHours: 0, billHours: 0, billAmount: 0, appDesc: [], billDesc: [], entries: 0, lines: 0 });
      return visits.get(k);
    };
    entries.forEach((e) => {
      const v = get(e.client_name, e.entry_date);
      v.appHours += e.hours; v.entries++;
      if (e.description) v.appDesc.push(e.description);
    });
    lines.forEach((l) => {
      const v = get(match(l.client), l.date);
      v.billHours += l.hours; v.lines++;
      v.billAmount += l.amount || 0;
      if (l.description) v.billDesc.push(l.description);
    });
    let list = Array.from(visits.values());
    list.forEach((v) => { v.appHours = round2(v.appHours); v.billHours = round2(v.billHours); v.billAmount = round2(v.billAmount); });

    // A bill line and an app entry for the same client and hours a few days apart is the same visit with the date typed differently
    if (useDates) {
      const onlyBill = list.filter((v) => v.lines && !v.entries);
      const onlyApp = list.filter((v) => v.entries && !v.lines);
      onlyBill.forEach((b) => {
        const a = onlyApp.filter((x) => !x.merged && x.client === b.client && x.appHours === b.billHours && dayDiff(x.date, b.date) <= 3)
          .sort((x, y) => dayDiff(x.date, b.date) - dayDiff(y.date, b.date))[0];
        if (!a) return;
        a.merged = true;
        Object.assign(b, { appHours: a.appHours, entries: a.entries, appDesc: a.appDesc, appDate: a.date });
      });
      list = list.filter((v) => !v.merged);
    }

    list.forEach((v) => {
      const diff = round2(v.billHours - v.appHours);
      v.diff = diff;
      if (!v.entries) v.status = "On the bill, not in the app";
      else if (!v.lines) v.status = "In the app, not on the bill";
      else if (Math.abs(diff) >= 0.01) v.status = diff > 0 ? "More hours on the bill" : "Fewer hours on the bill";
      else if (v.appDate) v.status = "Matches, different date";
      else v.status = "Matches";
      v.ok = v.status.startsWith("Matches");
    });
    list.sort((a, b) => a.client.localeCompare(b.client) || (a.date || "").localeCompare(b.date || ""));

    const byClient = new Map();
    list.forEach((v) => {
      if (!byClient.has(v.client)) byClient.set(v.client, { client: v.client, appHours: 0, billHours: 0, billAmount: 0, issues: 0 });
      const c = byClient.get(v.client);
      c.appHours += v.appHours; c.billHours += v.billHours; c.billAmount += v.billAmount;
      if (!v.ok) c.issues++;
    });
    const clients = Array.from(byClient.values()).map((c) => ({ ...c, appHours: round2(c.appHours), billHours: round2(c.billHours), billAmount: round2(c.billAmount), diff: round2(c.billHours - c.appHours) }));

    const totals = {
      appHours: round2(entries.reduce((s, e) => s + e.hours, 0)),
      billHours: round2(lines.reduce((s, l) => s + l.hours, 0)),
      billAmount: round2(lines.reduce((s, l) => s + (l.amount || 0), 0)),
      issues: list.filter((v) => !v.ok).length,
      visits: list.length,
    };
    totals.diff = round2(totals.billHours - totals.appHours);
    return { visits: list, clients, totals, useDates };
  }

  const api = { toISO, readBillFile, readSheets, parseBill, clientKey, clientMatcher, compare };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ConsultantCheck = api;
})(typeof window !== "undefined" ? window : globalThis);
