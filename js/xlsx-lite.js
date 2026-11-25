// =====================================================================
// A small .xlsx reader for files ExcelJS can't open (for example files
// whose pictures are saved with a "/xl/media/..." path, as the branded
// workbooks are). Reads every sheet into rows of values; dates come back
// as Date objects (UTC midnight), numbers as numbers, the rest as text.
// Uses the browser's built-in unzip (DecompressionStream).
// =====================================================================
(function (root) {
  async function unzip(buf) {
    const b = new Uint8Array(buf);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("Not an .xlsx file");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      files[name] = async () => {
        const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
        const data = b.subarray(start, start + size);
        if (method === 0) return dec.decode(data);
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return await new Response(stream).text();
      };
    }
    return files;
  }

  const xml = (text) => new DOMParser().parseFromString(text, "application/xml");
  const kids = (el, tag) => Array.from(el.getElementsByTagName(tag));
  const colNum = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

  async function read(buf) {
    const files = await unzip(buf);
    const get = async (path) => (files[path] ? xml(await files[path]()) : null);
    const shared = [];
    const ss = await get("xl/sharedStrings.xml");
    if (ss) kids(ss, "si").forEach((si) => shared.push(kids(si, "t").map((t) => t.textContent).join("")));
    const dateStyles = new Set();
    const st = await get("xl/styles.xml");
    if (st) {
      const custom = {};
      kids(st, "numFmt").forEach((f) => (custom[f.getAttribute("numFmtId")] = f.getAttribute("formatCode") || ""));
      const xfs = st.getElementsByTagName("cellXfs")[0];
      if (xfs) kids(xfs, "xf").forEach((xf, i) => {
        const id = Number(xf.getAttribute("numFmtId"));
        const code = (custom[id] || "").replace(/"[^"]*"|\[[^\]]*\]/g, "");
        if (BUILTIN_DATES.has(id) || /[dy]/i.test(code) || (/m/i.test(code) && !/[h:s]/i.test(code) && !/0/.test(code))) dateStyles.add(i);
      });
    }
    const wb = await get("xl/workbook.xml");
    const rels = await get("xl/_rels/workbook.xml.rels");
    const target = {};
    if (rels) kids(rels, "Relationship").forEach((r) => (target[r.getAttribute("Id")] = r.getAttribute("Target")));
    const sheets = [];
    for (const s of wb ? kids(wb, "sheet") : []) {
      const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let path = target[rid] || "";
      path = path.startsWith("/") ? path.slice(1) : "xl/" + path;
      const doc = await get(path);
      if (!doc) continue;
      const rows = [];
      kids(doc, "row").forEach((r) => {
        const out = [];
        kids(r, "c").forEach((c) => {
          const col = colNum(c.getAttribute("r") || "A") - 1;
          const t = c.getAttribute("t");
          const v = c.getElementsByTagName("v")[0];
          let val = "";
          if (t === "s") val = v ? shared[Number(v.textContent)] || "" : "";
          else if (t === "inlineStr") val = kids(c, "t").map((x) => x.textContent).join("");
          else if (t === "str" || t === "e") val = v ? v.textContent : "";
          else if (t === "b") val = v ? v.textContent === "1" : "";
          else if (v) {
            val = Number(v.textContent);
            if (dateStyles.has(Number(c.getAttribute("s") || 0)) && val > 0 && val < 100000) val = new Date(Date.UTC(1899, 11, 30) + Math.round(val * 864e5));
          }
          while (out.length < col) out.push("");
          out[col] = val;
        });
        if (out.some((x) => x !== "" && x != null)) rows.push(out);
      });
      sheets.push({ name: s.getAttribute("name"), rows });
    }
    return sheets;
  }

  root.XlsxLite = { read };
})(typeof window !== "undefined" ? window : globalThis);
