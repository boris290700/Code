/* xlsx.js - minimal, dependency-free Excel (.xlsx) and CSV reader/writer.
   Reading uses the browser's built-in DecompressionStream; writing uses an
   uncompressed ZIP. Works in modern Chrome, Edge, Firefox, Safari and Node 18+. */
const XLSX_LITE = (() => {
  const dec = new TextDecoder();
  const enc = new TextEncoder();

  // ---------- ZIP reading ----------
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buf) {
    const b = new Uint8Array(buf), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a valid .xlsx file (ZIP directory not found).');
    const n = v.getUint16(eocd + 10, true); let p = v.getUint32(eocd + 16, true);
    const files = {};
    for (let k = 0; k < n; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt ZIP directory.');
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
      const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
      const lho = v.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
      const lnlen = v.getUint16(lho + 26, true), lxlen = v.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lxlen, data = b.subarray(start, start + csize);
      files[name] = { method, data };
      p += 46 + nlen + xlen + clen;
    }
    return {
      async text(name) {
        const f = files[name] || files[Object.keys(files).find(k => k.toLowerCase() === name.toLowerCase())];
        if (!f) return null;
        const raw = f.method === 0 ? f.data : await inflateRaw(f.data);
        return dec.decode(raw);
      },
      names: Object.keys(files),
    };
  }

  // ---------- XML helpers (regex based; sufficient for SpreadsheetML) ----------
  const ent = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e.toLowerCase()] ?? (e[1].toLowerCase() === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10))));
  const attr = (tag, a) => { const m = tag.match(new RegExp('\\s' + a + '="([^"]*)"')); return m ? ent(m[1]) : null; };
  const colIndex = ref => { let c = 0; for (const ch of ref.replace(/\d+/g, '')) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; };

  async function readXlsx(buf) {
    const z = await unzip(buf);
    const wb = await z.text('xl/workbook.xml');
    if (!wb) throw new Error('Not an Excel workbook (xl/workbook.xml missing).');
    const rels = (await z.text('xl/_rels/workbook.xml.rels')) || '';
    const relMap = {};
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) relMap[attr(m[0], 'Id')] = attr(m[0], 'Target');
    const ssXml = (await z.text('xl/sharedStrings.xml')) || '';
    const shared = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t => ent(t[1])).join(''));
    // date styles: numFmtIds 14-22, 45-47 or custom formats containing d/m/y/h
    const stXml = (await z.text('xl/styles.xml')) || '';
    const customDate = new Set();
    for (const m of stXml.matchAll(/<numFmt\b[^>]*>/g)) { const code = (attr(m[0], 'formatCode') || '').replace(/\[[^\]]*\]|"[^"]*"/g, ''); if (/[dmyh]/i.test(code)) customDate.add(+attr(m[0], 'numFmtId')); }
    const xfs = (stXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [, ''])[1];
    const dateStyle = [...xfs.matchAll(/<xf\b[^>]*\/?>/g)].map(m => { const id = +attr(m[0], 'numFmtId'); return (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || customDate.has(id); });
    const sheets = {};
    for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
      const name = attr(m[0], 'name'); let target = relMap[attr(m[0], 'r:id')] || '';
      target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
      const xml = await z.text('xl/' + target);
      if (!xml) continue;
      const rows = [];
      for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
        const row = [];
        for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const tag = '<c ' + c[1], ref = attr(tag, 'r'), t = attr(tag, 't'), s = +(attr(tag, 's') || 0);
          const inner = c[2] || '', vm = inner.match(/<v>([\s\S]*?)<\/v>/);
          let val = null;
          if (t === 's') val = vm ? shared[+vm[1]] : null;
          else if (t === 'inlineStr') val = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => ent(x[1])).join('');
          else if (t === 'b') val = vm ? vm[1] === '1' : null;
          else if (t === 'str' || t === 'e') val = vm ? ent(vm[1]) : null;
          else if (vm) { const num = Number(vm[1]); val = dateStyle[s] ? excelDate(num) : num; }
          const ci = ref ? colIndex(ref) : row.length;
          row[ci] = val;
        }
        rows.push(row);
      }
      sheets[name] = toObjects(rows);
    }
    return sheets;
  }
  function excelDate(serial) { // returns ISO string; keeps time when fractional
    const ms = Math.round((serial - 25569) * 86400000);
    const d = new Date(ms), iso = d.toISOString();
    return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  function toObjects(rows) {
    const hi = rows.findIndex(r => r && r.some(x => x !== null && x !== undefined && x !== ''));
    if (hi < 0) return [];
    const head = rows[hi].map((h, i) => (h === null || h === undefined || h === '') ? 'COLUMN_' + (i + 1) : String(h).trim());
    return rows.slice(hi + 1).filter(r => r && r.some(x => x !== null && x !== undefined && x !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? null : r[i]])));
  }

  // ---------- CSV ----------
  function readCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const first = text.split(/\r?\n/, 1)[0];
    const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return toObjects(rows.map(r => r.map(x => x === '' ? null : x)));
  }

  // ---------- ZIP + XLSX writing ----------
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) { // files: [{name, data:Uint8Array}] - stored (no compression)
    const parts = [], central = []; let offset = 0;
    for (const f of files) {
      const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, nm.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), nm);
      offset += 30 + nm.length + sz;
    }
    const csize = central.reduce((a, x) => a + x.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)];
    const out = new Uint8Array(all.reduce((a, x) => a + x.length, 0)); let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
    return out;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // sheets: [{name, rows:[object], columns?:[string], widths?:{col:width}}]
  function writeXlsx(sheets) {
    const files = [];
    const add = (name, s) => files.push({ name, data: enc.encode(s) });
    add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>');
    add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>');
    add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    // style 0 normal, 1 bold header with fill, 2 wrap text
    add('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDE4EC"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/><xf fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    sheets.forEach((s, si) => {
      const cols = s.columns || [...new Set(s.rows.flatMap(r => Object.keys(r)))];
      const widths = cols.map(c => Math.min(60, Math.max(String(c).length + 2, ...s.rows.slice(0, 300).map(r => String(r[c] ?? '').length + 1))));
      let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols><sheetData>';
      const cell = (v, ref, st) => {
        if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st ? ` s="${st}"` : ''}><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${st ? ` s="${st}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      };
      x += '<row r="1">' + cols.map((c, i) => cell(c, colName(i) + 1, 1)).join('') + '</row>';
      s.rows.forEach((r, ri) => { x += `<row r="${ri + 2}">` + cols.map((c, i) => cell(r[c], colName(i) + (ri + 2), String(r[c] ?? '').length > 60 ? 2 : 0)).join('') + '</row>'; });
      x += '</sheetData>' + (s.rows.length ? `<autoFilter ref="A1:${colName(cols.length - 1)}${s.rows.length + 1}"/>` : '') + '</worksheet>';
      add(`xl/worksheets/sheet${si + 1}.xml`, x);
    });
    return zip(files);
  }

  async function readFile(name, buf) {
    if (/\.csv$|\.txt$/i.test(name)) { const base = name.replace(/\.[^.]+$/, '').split(/[\\/]/).pop(); return { [base]: readCsv(dec.decode(buf)) }; }
    return readXlsx(buf);
  }
  return { readXlsx, readCsv, readFile, writeXlsx };
})();
if (typeof module !== 'undefined') module.exports = XLSX_LITE;
