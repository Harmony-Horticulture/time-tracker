// =====================================================================
// Branded Excel downloads (Montserrat, brand colors, official logo)
// =====================================================================
(function () {
  const BROWN = "FF5F351B";
  const PINK = "FFF065A5";
  const GREEN = "FF009344";
  const LEAF = "FF8AC641";
  const PANEL = "FFF2F2F2";
  const TEXT = "FF1A1A1A";
  const GRAY = "FF595959";
  const FONT = "Montserrat";

  let logoCache = null;
  async function logoBase64() {
    if (logoCache) return logoCache;
    const res = await fetch("assets/logo.png");
    const buf = await res.arrayBuffer();
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    logoCache = btoa(bin);
    return logoCache;
  }

  function safeSheetName(name, used) {
    let base = String(name || "Sheet").replace(/[\[\]:*?\/\\]/g, " ").trim().slice(0, 31) || "Sheet";
    let n = base;
    let i = 2;
    while (used.has(n.toLowerCase())) {
      const suffix = ` (${i++})`;
      n = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(n.toLowerCase());
    return n;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function materialsText(e) {
    return e.materials.map((m) => `${m.name} x ${m.quantity}${m.unit && m.unit !== "each" ? " " + m.unit : ""}${m.is_new ? " (new)" : ""}`).join("; ");
  }

  // Adds a branded sheet: logo, caps title, pink subtitle, brown header row, gray body
  async function brandedSheet(wb, used, opts) {
    const ws = wb.addWorksheet(safeSheetName(opts.name, used), {
      views: [{ state: "frozen", ySplit: 6, showGridLines: false }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 } },
      headerFooter: { oddFooter: '&L&"Montserrat"&8Harmony Horticulture&R&"Montserrat"&8Page &P of &N' },
    });
    ws.columns = opts.columns.map((c) => ({ key: c.key, width: c.width || 14 }));

    const img = wb.addImage({ base64: await logoBase64(), extension: "png" });
    ws.addImage(img, { tl: { col: 0.15, row: 0.15 }, ext: { width: 131, height: 96 } });
    for (let r = 1; r <= 5; r++) ws.getRow(r).height = r === 5 ? 12 : 21;

    const titleCol = opts.columns.length > 2 ? 3 : 2;
    const t = ws.getCell(2, titleCol);
    t.value = String(opts.title).toUpperCase();
    t.font = { name: FONT, size: 16, color: { argb: BROWN } };
    const s = ws.getCell(3, titleCol);
    s.value = String(opts.subtitle || "").toUpperCase();
    s.font = { name: FONT, size: 9, bold: true, color: { argb: PINK } };
    const g = ws.getCell(4, titleCol);
    g.value = `Prepared ${new Date().toLocaleDateString()}`;
    g.font = { name: FONT, size: 8, color: { argb: GRAY } };

    const header = ws.getRow(6);
    opts.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BROWN } };
      cell.alignment = { vertical: "middle", horizontal: c.align || "left", wrapText: true };
    });
    header.height = 22;

    let rowNum = 7;
    opts.rows.forEach((r, idx) => {
      const row = ws.getRow(rowNum++);
      opts.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.value = r[c.key] === undefined ? null : r[c.key];
        cell.font = { name: FONT, size: 10, color: { argb: TEXT } };
        if (idx % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PANEL } };
        cell.alignment = { vertical: "top", horizontal: c.align || "left", wrapText: !!c.wrap };
        if (c.numFmt) cell.numFmt = c.numFmt;
      });
    });
    if (!opts.rows.length) {
      const cell = ws.getRow(rowNum++).getCell(1);
      cell.value = opts.emptyText || "No time in this range.";
      cell.font = { name: FONT, size: 10, italic: true, color: { argb: GRAY } };
    }

    if (opts.totals) {
      const row = ws.getRow(rowNum++);
      opts.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.value = opts.totals[c.key] === undefined ? null : opts.totals[c.key];
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: BROWN } };
        cell.border = { top: { style: "medium", color: { argb: GREEN } } };
        cell.alignment = { horizontal: c.align || "left" };
        if (c.numFmt) cell.numFmt = c.numFmt;
      });
    }
    return ws;
  }

  async function download(wb, filename) {
    wb.creator = "Harmony Horticulture";
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename.replace(/[\\/:*?"<>|]/g, "-");
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  const HOURS = "0.00";
  const MONEY = '"$"#,##0.00';
  const DATE = "mm/dd/yyyy";
  const sumHours = (list) => list.reduce((s, e) => s + e.hours, 0);
  const rangeText = (from, to) => (from || to ? `${from ? fmtDate(from).toLocaleDateString() : "start"} to ${to ? fmtDate(to).toLocaleDateString() : "today"}` : "All dates");

  const entryColumns = (withPerson) => [
    { header: "Date", key: "date", width: 12, numFmt: DATE },
    ...(withPerson ? [{ header: "Person", key: "person", width: 20 }] : []),
    { header: "Client", key: "client", width: 30, wrap: true },
    { header: "Property", key: "property", width: 22, wrap: true },
    { header: "Service", key: "service", width: 20, wrap: true },
    { header: "Hours", key: "hours", width: 9, numFmt: HOURS, align: "right" },
    { header: "Description", key: "description", width: 44, wrap: true },
    { header: "Materials", key: "materials", width: 32, wrap: true },
    { header: "Site min", key: "sitemin", width: 10, numFmt: MONEY, align: "right" },
    { header: "QuickBooks", key: "status", width: 14 },
  ];
  const entryRow = (e) => ({
    date: fmtDate(e.entry_date),
    person: e.person_name,
    client: e.client_name + (e.client_one_off ? " (one-off)" : ""),
    property: e.property,
    service: e.service_name,
    hours: e.hours,
    description: e.description,
    materials: materialsText(e),
    sitemin: e.site_minimum_amount || null,
    status: e.qb_exported_at ? "In QuickBooks" : "",
  });
  const byDateAsc = (a, b) => (a.entry_date + (a.created_at || "")).localeCompare(b.entry_date + (b.created_at || ""));

  // TT-18 / TT-11: a list of entries (filtered list, or my own time)
  async function exportEntries(entries, { title, subtitle, filename, withPerson, dailyTotals }) {
    const wb = new ExcelJS.Workbook();
    const used = new Set();
    const list = entries.slice().sort(byDateAsc);
    await brandedSheet(wb, used, {
      name: "Time", title, subtitle, columns: entryColumns(withPerson),
      rows: list.map(entryRow), totals: { date: "Total", hours: sumHours(list) },
    });
    if (dailyTotals) {
      const days = {};
      list.forEach((e) => { days[e.entry_date] = (days[e.entry_date] || 0) + e.hours; });
      await brandedSheet(wb, used, {
        name: "Daily totals", title: "Daily totals", subtitle,
        columns: [{ header: "Date", key: "date", width: 14, numFmt: DATE }, { header: "Hours", key: "hours", width: 10, numFmt: HOURS, align: "right" }],
        rows: Object.keys(days).sort().map((d) => ({ date: fmtDate(d), hours: days[d] })),
        totals: { date: "Total", hours: sumHours(list) },
      });
    }
    await download(wb, filename);
  }

  // TT-19: summary tab + one tab per person; people with no time show 0
  async function exportTimeByPerson(entries, people, { from, to }) {
    const wb = new ExcelJS.Workbook();
    const used = new Set(["summary"]);
    const sub = rangeText(from, to);
    const byPerson = people.map((p) => ({ p, list: entries.filter((e) => e.user_id === p.id).sort(byDateAsc) }));
    await brandedSheet(wb, new Set(), {
      name: "Summary", title: "Time by person", subtitle: sub,
      columns: [
        { header: "Person", key: "person", width: 26 },
        { header: "Total hours", key: "hours", width: 13, numFmt: HOURS, align: "right" },
        { header: "Billable hours", key: "billable", width: 15, numFmt: HOURS, align: "right" },
        { header: "Entries", key: "count", width: 10, align: "right" },
      ],
      rows: byPerson.map(({ p, list }) => ({
        person: p.full_name || p.email,
        hours: sumHours(list),
        billable: sumHours(list.filter((e) => e.service_billable)),
        count: list.length,
      })),
      totals: {
        person: "Total", hours: sumHours(entries), billable: sumHours(entries.filter((e) => e.service_billable)),
        count: entries.length,
      },
    });
    for (const { p, list } of byPerson) {
      await brandedSheet(wb, used, {
        name: p.full_name || p.email, title: p.full_name || p.email, subtitle: sub,
        columns: entryColumns(false), rows: list.map(entryRow), totals: { date: "Total", hours: sumHours(list) },
      });
    }
    await download(wb, `Harmony Horticulture Time by Person ${from || ""} to ${to || ""}.xlsx`);
  }

  // TT-22: branded time and materials backup for one client
  async function exportClientSummary(entries, clientName, { from, to }) {
    const wb = new ExcelJS.Workbook();
    const used = new Set();
    const list = entries.slice().sort(byDateAsc);
    const sub = `${clientName} · ${rangeText(from, to)}`;
    await brandedSheet(wb, used, {
      name: "Time", title: "Time and materials summary", subtitle: sub,
      columns: [
        { header: "Date", key: "date", width: 12, numFmt: DATE },
        { header: "Consultant", key: "person", width: 20 },
        { header: "Property", key: "property", width: 22, wrap: true },
        { header: "Service", key: "service", width: 22, wrap: true },
        { header: "Description", key: "description", width: 48, wrap: true },
        { header: "Hours", key: "hours", width: 9, numFmt: HOURS, align: "right" },
      ],
      rows: list.map(entryRow), totals: { date: "Total hours", hours: sumHours(list) },
    });
    const mats = [];
    list.forEach((e) => e.materials.forEach((m) => mats.push({
      date: fmtDate(e.entry_date), person: e.person_name, material: m.name, qty: m.quantity, unit: m.unit,
      price: m.unit_price, total: m.unit_price == null ? null : m.unit_price * m.quantity,
    })));
    const matTotal = mats.reduce((s, m) => s + (m.total || 0), 0);
    await brandedSheet(wb, used, {
      name: "Materials", title: "Materials", subtitle: sub, emptyText: "No materials in this range.",
      columns: [
        { header: "Date", key: "date", width: 12, numFmt: DATE },
        { header: "Consultant", key: "person", width: 20 },
        { header: "Material", key: "material", width: 40, wrap: true },
        { header: "Qty", key: "qty", width: 8, numFmt: "0.00", align: "right" },
        { header: "Unit", key: "unit", width: 10 },
        { header: "Unit price", key: "price", width: 12, numFmt: MONEY, align: "right" },
        { header: "Total", key: "total", width: 12, numFmt: MONEY, align: "right" },
      ],
      rows: mats, totals: mats.some((m) => m.total != null) ? { date: "Total", total: matTotal } : null,
    });
    await download(wb, `${clientName} - Time and Materials - ${from || ""} to ${to || ""}.xlsx`);
  }

  // Every client in the range: a summary tab, then one tab per client with its time and materials
  async function exportAllClientSummaries(entries, { from, to }) {
    const wb = new ExcelJS.Workbook();
    const used = new Set(["summary"]);
    const sub = rangeText(from, to);
    const byClient = new Map();
    entries.slice().sort(byDateAsc).forEach((e) => {
      const k = e.client_name;
      if (!byClient.has(k)) byClient.set(k, []);
      byClient.get(k).push(e);
    });
    const names = Array.from(byClient.keys()).sort((a, b) => a.localeCompare(b));
    const matTotal = (list) => list.reduce((s, e) => s + e.materials.reduce((t, m) => t + (m.unit_price == null ? 0 : m.unit_price * m.quantity), 0), 0);
    const siteMin = (list) => list.reduce((s, e) => s + (e.site_minimum_amount || 0), 0);
    await brandedSheet(wb, new Set(), {
      name: "Summary", title: "Client summary", subtitle: sub,
      columns: [
        { header: "Client", key: "client", width: 40, wrap: true },
        { header: "Type", key: "type", width: 12 },
        { header: "Entries", key: "count", width: 10, align: "right" },
        { header: "Hours", key: "hours", width: 10, numFmt: HOURS, align: "right" },
        { header: "Materials", key: "mats", width: 13, numFmt: MONEY, align: "right" },
        { header: "Site minimums", key: "min", width: 15, numFmt: MONEY, align: "right" },
      ],
      rows: names.map((n) => { const l = byClient.get(n); return { client: n, type: l[0].client_one_off ? "One-off" : "Recurring", count: l.length, hours: sumHours(l), mats: matTotal(l), min: siteMin(l) }; }),
      totals: { client: "Total", count: entries.length, hours: sumHours(entries), mats: matTotal(entries), min: siteMin(entries) },
    });
    for (const n of names) {
      const list = byClient.get(n);
      await brandedSheet(wb, used, {
        name: n, title: n, subtitle: sub,
        columns: [
          { header: "Date", key: "date", width: 12, numFmt: DATE },
          { header: "Consultant", key: "person", width: 20 },
          { header: "Service", key: "service", width: 26, wrap: true },
          { header: "Description", key: "description", width: 44, wrap: true },
          { header: "Hours", key: "hours", width: 9, numFmt: HOURS, align: "right" },
          { header: "Materials", key: "materials", width: 32, wrap: true },
          { header: "Site min", key: "sitemin", width: 10, numFmt: MONEY, align: "right" },
        ],
        rows: list.map(entryRow), totals: { date: "Total", hours: sumHours(list) },
      });
    }
    await download(wb, `Harmony Horticulture Client Summary ${from || ""} to ${to || ""}.xlsx`);
  }

  // TT-21: QuickBooks file in the same layout as the October 2026 bill
  function qbItem(e) {
    const name = e.person_qb_name || "";
    return (e.service_qb_item || "").replace(/\{consultant\}/g, name).replace(/\s+/g, " ").trim();
  }
  function quickBooksCheck(entries) {
    const ready = [];
    const held = [];
    entries.forEach((e) => {
      if (!e.service_billable) return; // non-billable time never goes to QuickBooks
      const reasons = [];
      if (!e.service_type_id) reasons.push("No service type");
      if (/\{consultant\}/.test(e.service_qb_item || "") && !e.person_qb_name) reasons.push(`No QuickBooks name for ${e.person_name}`);
      (reasons.length ? held : ready).push({ e, reasons });
    });
    return { ready: ready.map((r) => r.e), held };
  }
  async function exportQuickBooks(entries, { from, to }) {
    const { ready, held } = quickBooksCheck(entries);
    const list = ready.slice().sort((a, b) => (a.client_qb_name || a.client_name).localeCompare(b.client_qb_name || b.client_name) || byDateAsc(a, b));
    const wb = new ExcelJS.Workbook();
    const used = new Set(["quickbooks bill"]);
    // Plain sheet, same 4 columns as "Robbie Stephens October 2026 Bill - QuickBooks.xlsx"
    const ws = wb.addWorksheet("QuickBooks Bill");
    ws.columns = [
      { header: "Product/Service", key: "item", width: 70 },
      { header: "Description", key: "description", width: 50 },
      { header: "Qty", key: "qty", width: 8 },
      { header: "Customer", key: "customer", width: 30 },
    ];
    ws.getRow(1).font = { bold: true };
    list.forEach((e) => ws.addRow({ item: qbItem(e), description: e.description, qty: e.hours, customer: e.client_qb_name || e.client_name }));
    list.forEach((e) => e.materials.forEach((m) => ws.addRow({ item: m.name, description: `Materials · ${e.entry_date}`, qty: m.quantity, customer: e.client_qb_name || e.client_name })));

    await brandedSheet(wb, used, {
      name: "Details", title: "QuickBooks export details", subtitle: rangeText(from, to),
      columns: entryColumns(true), rows: list.map(entryRow), totals: { date: "Total", hours: sumHours(list) },
    });
    if (held.length) {
      await brandedSheet(wb, used, {
        name: "Held back", title: "Held back, please fix", subtitle: "These entries were not included",
        columns: [...entryColumns(true), { header: "Why", key: "why", width: 34, wrap: true }],
        rows: held.map(({ e, reasons }) => ({ ...entryRow(e), why: reasons.join("; ") })),
      });
    }
    await download(wb, `QuickBooks Time Export ${from || ""} to ${to || ""}.xlsx`);
    return { sent: list, held };
  }

  // Consultant check: summary, things to check, by client, every visit
  async function exportConsultantCheck(res, { person, from, to, fileName, paid, hasAmounts }) {
    const wb = new ExcelJS.Workbook();
    const used = new Set();
    const sub = `${person} · ${rangeText(from, to)}`;
    const t = res.totals;
    const summary = [
      { item: "Hours logged in the app", value: t.appHours, fmt: HOURS },
      { item: "Hours on their bill", value: t.billHours, fmt: HOURS },
      { item: "Difference (bill minus app)", value: t.diff, fmt: HOURS },
      ...(hasAmounts ? [
        { item: "Bill total", value: t.billAmount, fmt: MONEY },
        { item: "Paid so far", value: paid || 0, fmt: MONEY },
        { item: "Still owed", value: t.billAmount - (paid || 0), fmt: MONEY },
      ] : []),
      { item: "Visits to check", value: t.issues, fmt: "0" },
      { item: "Bill file", value: fileName || "", fmt: null },
    ];
    const ws = await brandedSheet(wb, used, {
      name: "Summary", title: "Consultant check", subtitle: sub,
      columns: [{ header: "", key: "item", width: 34 }, { header: "", key: "value", width: 30, align: "right" }],
      rows: summary.map((r) => ({ item: r.item, value: r.value })),
    });
    summary.forEach((r, i) => { if (r.fmt) ws.getRow(7 + i).getCell(2).numFmt = r.fmt; });
    const vcols = [
      { header: "Client", key: "client", width: 30, wrap: true },
      ...(res.useDates ? [{ header: "Date", key: "date", width: 12, numFmt: DATE }, { header: "Date in app", key: "appDate", width: 12, numFmt: DATE }] : []),
      { header: "App hours", key: "app", width: 11, numFmt: HOURS, align: "right" },
      { header: "Bill hours", key: "bill", width: 11, numFmt: HOURS, align: "right" },
      { header: "Result", key: "status", width: 28, wrap: true },
      ...(hasAmounts ? [{ header: "Billed", key: "amount", width: 12, numFmt: MONEY, align: "right" }] : []),
      { header: "On the bill", key: "billDesc", width: 40, wrap: true },
      { header: "In the app", key: "appDesc", width: 40, wrap: true },
    ];
    const vrow = (v) => ({ client: v.client, date: v.date ? fmtDate(v.date) : null, appDate: v.appDate ? fmtDate(v.appDate) : null, app: v.appHours, bill: v.billHours, status: v.status, amount: v.billAmount || null, billDesc: v.billDesc.join("; "), appDesc: v.appDesc.join("; ") });
    const issues = res.visits.filter((v) => !v.ok);
    await brandedSheet(wb, used, { name: "To check", title: "Things to check", subtitle: sub, columns: vcols, rows: issues.map(vrow), emptyText: "Everything matches." });
    await brandedSheet(wb, used, {
      name: "By client", title: "By client", subtitle: sub,
      columns: [
        { header: "Client", key: "client", width: 34, wrap: true },
        { header: "App hours", key: "app", width: 11, numFmt: HOURS, align: "right" },
        { header: "Bill hours", key: "bill", width: 11, numFmt: HOURS, align: "right" },
        { header: "Difference", key: "diff", width: 11, numFmt: HOURS, align: "right" },
        ...(hasAmounts ? [{ header: "Billed", key: "amount", width: 12, numFmt: MONEY, align: "right" }] : []),
        { header: "Visits to check", key: "issues", width: 14, align: "right" },
      ],
      rows: res.clients.map((x) => ({ client: x.client, app: x.appHours, bill: x.billHours, diff: x.diff, amount: x.billAmount, issues: x.issues || null })),
      totals: { client: "Total", app: t.appHours, bill: t.billHours, diff: t.diff, amount: hasAmounts ? t.billAmount : null, issues: t.issues },
    });
    await brandedSheet(wb, used, { name: "Every visit", title: "Every visit", subtitle: sub, columns: vcols, rows: res.visits.map(vrow) });
    await download(wb, `${person} - Consultant Check - ${from} to ${to}.xlsx`);
  }

  window.Exports = { exportEntries, exportTimeByPerson, exportClientSummary, exportAllClientSummaries, exportQuickBooks, quickBooksCheck, exportConsultantCheck };
})();
