/* xlsx.js - minimal, dependency-free Excel (.xlsx) and CSV reader/writer.
   Reading uses the built-in DecompressionStream; writing uses an uncompressed ZIP.
   Works in modern Chrome, Edge, Firefox, Safari and Node 18+.

   Reading is tolerant of real-world exports: report titles above the header,
   footer/total lines, repeated header lines (page breaks), blank rows,
   duplicate column names, tab/semicolon/comma/pipe delimiters, UTF-8/UTF-16. */
// HOW TO READ THIS FILE (for non-programmers)
// This file reads and writes spreadsheet files, so the tool needs no external software.
//   Reading: an .xlsx file is really a ZIP archive containing XML text files (one per sheet,
//   plus a shared list of all texts and a list of cell formats). The code unzips it, reads
//   the cells, finds the header row and turns every row into a record such as
//   { "User Name": "IVITOLA", "Created On": "06.04.2025", ... }.
//   CSV / text exports are read the same way after detecting the delimiter and encoding.
//   Writing: builds the XML files of a new workbook (cells, styles, merged cells, dropdowns,
//   formulas) and zips them into an .xlsx file – this is how the workpaper is produced.
const XLSX_LITE = (() => {
  const dec = new TextDecoder();
  const enc = new TextEncoder();

  // ---------- ZIP reading ----------
  // Unpacks one compressed file inside the ZIP, using the browser's built-in decompression.
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // Reads the table of contents at the end of the ZIP file and returns a helper that can give
  // the text of any file inside it (e.g. "xl/worksheets/sheet1.xml").
  async function unzip(buf) {
    const b = new Uint8Array(buf), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a valid .xlsx file (ZIP directory not found). Old .xls files are not supported – open the file in Excel and save it as .xlsx or .csv.');
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
  // Small helpers for the XML inside .xlsx files: "ent" turns codes like &amp; back into &,
  // "attr" reads a property of an XML tag, "colIndex" turns a column letter (A, B, ... AA) into a number.
  const ent = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e.toLowerCase()] ?? (e[1].toLowerCase() === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10))));
  const attr = (tag, a) => { const m = tag.match(new RegExp('\\s' + a + '="([^"]*)"')); return m ? ent(m[1]) : null; };
  const colIndex = ref => { let c = 0; for (const ch of ref.replace(/\d+/g, '')) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; };

  // Reads all sheets of an .xlsx workbook. Steps: list the sheets, read the shared texts,
  // find which cell formats are dates (Excel stores dates as numbers with a date format),
  // then read every row and cell of every sheet.
  async function readXlsx(buf) {
    const z = await unzip(buf);
    const wb = await z.text('xl/workbook.xml');
    if (!wb) throw new Error('Not an Excel workbook (xl/workbook.xml missing).');
    const rels = (await z.text('xl/_rels/workbook.xml.rels')) || '';
    const relMap = {};
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) relMap[attr(m[0], 'Id')] = attr(m[0], 'Target');
    const ssXml = (await z.text('xl/sharedStrings.xml')) || '';
    // Excel stores each distinct text once in a shared list; cells refer to it by number.
    const shared = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t => ent(t[1])).join(''));
    // date styles: numFmtIds 14-22, 45-47 or custom formats containing d/m/y/h
    const stXml = (await z.text('xl/styles.xml')) || '';
    // Which cell styles are date formats – so that a number like 45657 is shown as 2024-12-31.
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
      for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
        const rn = +(attr('<row ' + (r[1] || r[3] || ''), 'r') || rows.length + 1);
        // Keep the real Excel row numbers (empty rows are not stored in the file), so evidence can be traced to its row.
        while (rows.length < rn - 1) rows.push([]); // keep real Excel row numbers
        const row = [];
        for (const c of (r[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const tag = '<c ' + c[1], ref = attr(tag, 'r'), t = attr(tag, 't'), s = +(attr(tag, 's') || 0);
          const inner = c[2] || '', vm = inner.match(/<v>([\s\S]*?)<\/v>/);
          let val = null;
          // Read the cell value according to its type: shared text, inline text, true/false, formula text, or number/date.
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
  // Converts an Excel date number (days since 1900) into a readable date such as 2025-12-31.
  function excelDate(serial) { // returns ISO string; keeps time when fractional
    const ms = Math.round((serial - 25569) * 86400000);
    const d = new Date(ms), iso = d.toISOString();
    return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }

  // ---------- From a grid of cells to records ----------
  // FROM A GRID OF CELLS TO RECORDS.
  // "empty" = cell has no content. FOOTER = text that typically starts a total or footer line in
  // report exports ("Total", "Number of records:", "Page 2", "End of report"...).
  const empty = x => x === null || x === undefined || (typeof x === 'string' && x.trim() === '');
  const FOOTER = /^\s*(total|totals|grand total|sum|count|number of (rows|records|entries)|\d+\s+(rows|records|entries|lines)|records?:|rows?:|end of (report|list)|report (generated|run|printed)|generated (by|on)|page \d+|\*{3,})/i;
  // Header = the row (within the first 30) with the most short text cells that is followed by data.
  // Finds the header row: real exports often start with report titles and filter descriptions.
  // Within the first 30 rows, the header is the row with the most short text cells (no numbers,
  // no dates) that is followed by data rows.
  function findHeader(rows) {
    let best = -1, bestScore = 0;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const vals = (rows[i] || []).filter(x => !empty(x));
      if (vals.length < 2) continue;
      const texts = vals.filter(x => typeof x === 'string' && x.trim().length <= 60 && !/^[-+]?\d+([.,]\d+)?$/.test(x.trim()) && !/^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}/.test(x.trim()));
      if (texts.length < vals.length * 0.8) continue;
      const next = rows.slice(i + 1, i + 6).filter(r => r && r.some(x => !empty(x)));
      if (!next.length) continue;
      if (texts.length > bestScore) { best = i; bestScore = texts.length; }
    }
    return best >= 0 ? best : rows.findIndex(r => r && r.some(x => !empty(x)));
  }
  // rows: array of arrays. headerIndex: optional 0-based override.
  // Turns the rows below the header into records. Along the way it:
  //   - skips blank lines,
  //   - drops repeated header lines (page breaks in printed reports),
  //   - drops footer / total lines,
  //   - notes values that sit in columns without a header (sign of a shifted extract),
  //   - renames duplicate column names ("Status", "Status (2)").
  // Everything dropped or noticed is written into "meta" so the data checks and the C&A sheet
  // can show the auditor exactly what was excluded and why. headerIndex lets the auditor
  // override the detected header row in step 3.
  function toObjects(rows, headerIndex) {
    const hi = headerIndex ?? findHeader(rows);
    const out = [];
    const meta = { headerRow: hi + 1, rowNumbers: [], excluded: [], columns: [], titleLines: [], raw: rows };
    if (hi < 0 || !rows[hi]) { Object.defineProperty(out, 'meta', { value: meta, enumerable: false }); return out; }
    // Remember the title lines above the header (shown on the C&A sheet).
    meta.titleLines = rows.slice(0, hi).map(r => (r || []).filter(x => !empty(x)).join(' ')).filter(Boolean);
    // Column names; empty ones become COLUMN_1, COLUMN_2..., duplicates get a number.
    const seen = {};
    const head = rows[hi].map((h, i) => {
      let n = empty(h) ? 'COLUMN_' + (i + 1) : String(h).replace(/\s+/g, ' ').trim();
      if (seen[n.toUpperCase()]) n = `${n} (${++seen[n.toUpperCase()]})`; else seen[n.toUpperCase()] = 1;
      return n;
    });
    meta.columns = head;
    const headKey = head.map(h => h.toUpperCase()).join('|');
    const filledHead = head.filter((h, i) => !empty(rows[hi][i])).length;
    for (let r = hi + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const vals = row.filter(x => !empty(x));
      // Go through every row below the header and decide whether it is a real record.
      if (!vals.length) continue; // blank line
      if (row.map(x => empty(x) ? '' : String(x).replace(/\s+/g, ' ').trim().toUpperCase()).join('|') === headKey) { meta.excluded.push({ row: r + 1, reason: 'Repeated header line (page break)', text: vals.join(' ') }); continue; }
      if (filledHead >= 3 && vals.length <= 2 && FOOTER.test(String(vals[0]))) { meta.excluded.push({ row: r + 1, reason: 'Footer / total line', text: vals.join(' ') }); continue; }
      if (row.length > head.length && row.slice(head.length).some(x => !empty(x))) meta.excluded.push({ row: r + 1, reason: 'Values outside the header columns ignored', text: row.slice(head.length).filter(x => !empty(x)).join(' '), kept: true });
      out.push(Object.fromEntries(head.map((h, i) => [h, row[i] === undefined || (typeof row[i] === 'string' && row[i].trim() === '') ? null : row[i]])));
      meta.rowNumbers.push(r + 1);
    }
    Object.defineProperty(out, 'meta', { value: meta, enumerable: false });
    return out;
  }

  // ---------- CSV / text ----------
  // Text files can be stored in different encodings. SAP GUI often saves "unconverted" exports in
  // UTF-16 (two bytes per letter); Excel CSVs may be UTF-8 or Windows-1252. This detects which one
  // it is, so that letters like ā, ē, ü are read correctly.
  function decodeText(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
    // UTF-16 without BOM: many zero bytes in odd positions
    let z = 0; for (let i = 1; i < Math.min(b.length, 400); i += 2) if (b[i] === 0) z++;
    if (b.length > 4 && z > Math.min(b.length, 400) / 4) return new TextDecoder('utf-16le').decode(b);
    const t = dec.decode(b);
    if (t.includes('�')) { try { return new TextDecoder('windows-1252').decode(b); } catch { return t; } }
    return t;
  }
  // Reads a CSV or text export. The delimiter (tab, semicolon, comma or pipe) is detected by
  // looking at which one appears the same number of times on most of the first lines.
  // Then the text is split into cells, respecting quotes ("a; b" stays one cell).
  function readCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    // delimiter = the candidate that appears most consistently in the first lines
    const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 25);
    let delim = ',', best = -1;
    for (const d of ['\t', ';', ',', '|']) {
      const counts = lines.map(l => l.split(d).length - 1).filter(n => n > 0);
      if (!counts.length) continue;
      const mode = counts.sort((a, b) => counts.filter(x => x === b).length - counts.filter(x => x === a).length)[0];
      const score = counts.filter(n => n === mode).length * 100 + mode;
      if (score > best) { best = score; delim = d; }
    }
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"' && cell.trim() === '') { q = true; cell = ''; }
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    // SAP list output wraps columns in | and draws ---- lines
    // SAP list output draws lines of dashes and wraps columns in | – remove those decorations.
    const clean = rows.filter(r => !(r.length <= 2 && /^[-=_\s|]+$/.test(r.join(''))))
      .map(r => (delim === '|' && r.length > 2 && r[0].trim() === '' && r[r.length - 1].trim() === '' ? r.slice(1, -1) : r).map(x => x.trim() === '' ? null : x.trim()));
    return toObjects(clean);
  }

  // ---------- ZIP + XLSX writing ----------
  // WRITING .XLSX FILES.
  // crc32 = a checksum the ZIP format requires for every file; zip = packs the files together
  // (without compression, which keeps the code simple and Excel accepts it).
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  // Builds the ZIP archive byte by byte: a header per file, then a table of contents at the end.
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
  // esc = makes text safe inside XML (e.g. & becomes &amp;); colName = column number to letters (0 → A, 27 → AB).
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  // The visual styles available for workpaper cells: fonts, fill colours and borders.
  // Each style has a name used by the workpaper code, e.g. 'th' = dark blue table header,
  // 'input' = yellow cell for the auditor to fill in, 'pass' / 'exc' / 'rev' = green / red / amber
  // result cells, 'date' = date format.
  // Named cell styles for workpapers. Order = index in cellXfs.
  // [name, fontId, fillId, borderId, numFmtId, alignment]
  const FONTS = ['<font><sz val="10"/><name val="Arial"/></font>', '<font><b/><sz val="10"/><name val="Arial"/></font>', '<font><b/><sz val="14"/><color rgb="FF1F4E79"/><name val="Arial"/></font>', '<font><b/><sz val="11"/><color rgb="FF1F4E79"/><name val="Arial"/></font>', '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>', '<font><i/><sz val="9"/><color rgb="FF5D6779"/><name val="Arial"/></font>', '<font><b/><sz val="10"/><color rgb="FF1E7A46"/><name val="Arial"/></font>', '<font><b/><sz val="10"/><color rgb="FFB42318"/><name val="Arial"/></font>', '<font><b/><sz val="10"/><color rgb="FF9A6200"/><name val="Arial"/></font>'];
  const FILLS = ['none', 'gray125', 'FFDDE4EC', 'FFFFF2CC', 'FF1F4E79', 'FFE6F4EC', 'FFFDECEA', 'FFFFF4DC', 'FFEDEDED', 'FFF2F2F2'];
  const W = '<alignment wrapText="1" vertical="top"/>', WC = '<alignment wrapText="1" vertical="top" horizontal="center"/>';
  const STYLES = [
    ['default', 0, 0, 0, 0, ''], ['hdr', 1, 2, 0, 0, ''], ['wrap', 0, 0, 0, 0, W],
    ['title', 2, 0, 0, 0, ''], ['h2', 3, 2, 0, 0, '<alignment vertical="center"/>'], ['label', 1, 9, 1, 0, W], ['text', 0, 0, 1, 0, W],
    ['input', 0, 3, 1, 0, W], ['th', 4, 4, 1, 0, WC], ['pass', 6, 5, 1, 0, WC], ['exc', 7, 6, 1, 0, WC], ['rev', 8, 7, 1, 0, WC],
    ['nt', 1, 8, 1, 0, WC], ['note', 5, 0, 0, 0, W], ['num', 0, 0, 1, 1, '<alignment vertical="top"/>'], ['bold', 1, 0, 1, 0, W],
    ['pct', 0, 0, 1, 10, '<alignment vertical="top"/>'], ['center', 0, 0, 1, 0, WC], ['date', 0, 0, 1, 14, '<alignment vertical="top" horizontal="left"/>'],
    ['datetime', 0, 0, 1, 22, '<alignment vertical="top" horizontal="left"/>'], ['plain', 0, 0, 0, 0, ''], ['boldplain', 1, 0, 0, 0, ''],
    ['inputc', 0, 3, 1, 0, WC], ['numbold', 1, 9, 1, 1, '<alignment vertical="top"/>'], ['plaindate', 0, 0, 0, 14, ''], ['noteline', 5, 0, 0, 0, ''],
  ];
  const SID = Object.fromEntries(STYLES.map((s, i) => [s[0], i]));
  // Writes the list of styles in the XML format Excel expects (styles.xml).
  const stylesXml = () => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<fonts count="${FONTS.length}">${FONTS.join('')}</fonts>` +
    `<fills count="${FILLS.length}">${FILLS.map(f => f.length < 8 ? `<fill><patternFill patternType="${f}"/></fill>` : `<fill><patternFill patternType="solid"><fgColor rgb="${f}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills>` +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${STYLES.length}">${STYLES.map(([, f, fi, b, nf, al]) => `<xf numFmtId="${nf}" fontId="${f}" fillId="${fi}" borderId="${b}" xfId="0"${f ? ' applyFont="1"' : ''}${fi ? ' applyFill="1"' : ''}${b ? ' applyBorder="1"' : ''}${nf ? ' applyNumberFormat="1"' : ''}${al ? ' applyAlignment="1">' + al + '</xf>' : '/>'}`).join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  // writeBook creates a complete workbook. For every sheet it writes: column widths, frozen
  // header rows, all cells (text, numbers, dates, formulas), merged cells, auto-filter, dropdown
  // lists (data validation) and print settings (landscape, fit to page width).
  // Low-level writer. sheets: [{ name, rows: [[cell]], widths?: [n], merges?: ['A1:D1'], freeze?: 'A2',
  //   filter?: 'A1:F9', validations?: [{ sqref, list: [..] }], landscape?: bool, tab?: 'FF1F4E79' }]
  // cell: value | { v, s: styleName, f: formula }. Dates: pass { v: Date|ISO string, s: 'date' }.
  function writeBook(sheets) {
    const files = [];
    const add = (name, s) => files.push({ name, data: enc.encode(s) });
    add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>');
    add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    // Excel sheet names: max 31 characters, certain characters forbidden, and no duplicates.
    const names = []; // unique, valid sheet names
    for (const s of sheets) { let n = String(s.name).replace(/[\\/?*[\]:]/g, '_').slice(0, 31), k = 2; while (names.some(x => x.toUpperCase() === n.toUpperCase())) n = String(s.name).slice(0, 27) + ' (' + k++ + ')'; names.push(n); }
    add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
    add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    add('xl/styles.xml', stylesXml());
    // Converts a date into Excel's date number so Excel shows it as a real date.
    const serial = v => { const d = v instanceof Date ? v : new Date(String(v).length <= 10 ? v + 'T00:00:00Z' : String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? '' : 'Z')); return isNaN(d) ? null : d.getTime() / 86400000 + 25569; };
    sheets.forEach((s, si) => {
      const ncol = Math.max(1, ...s.rows.map(r => (r || []).length));
      // Column widths: given by the workpaper, or estimated from the longest value in each column.
      const widths = s.widths || Array.from({ length: ncol }, (_, c) => Math.min(60, Math.max(8, ...s.rows.slice(0, 300).map(r => { const x = r?.[c]; const v = x && typeof x === 'object' && !(x instanceof Date) ? x.v : x; return String(v ?? '').length + 2; }))));
      // Frozen panes keep the header row (and first columns) visible while scrolling.
      const fr = s.freeze ? s.freeze.match(/^([A-Z]+)(\d+)$/) : null;
      const pane = fr ? (() => { const xs = colIndex(fr[1]), ys = +fr[2] - 1; return `<pane${xs ? ` xSplit="${xs}"` : ''}${ys ? ` ySplit="${ys}"` : ''} topLeftCell="${s.freeze}" activePane="${xs && ys ? 'bottomRight' : ys ? 'bottomLeft' : 'topRight'}" state="frozen"/>`; })() : '';
      let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheetPr>${s.tab ? `<tabColor rgb="${s.tab}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr>` +
        `<sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ''}${s.gridlines === false ? ' showGridLines="0"' : ''}>${pane}</sheetView></sheetViews>` +
        '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols><sheetData>';
      s.rows.forEach((r, ri) => {
        const cells = [];
        (r || []).forEach((c, ci) => {
          if (c === undefined || c === null) return;
          const o = typeof c === 'object' && !(c instanceof Date) ? c : { v: c };
          const ref = colName(ci) + (ri + 1), st = o.s !== undefined ? SID[o.s] ?? 0 : 0, sa = st ? ` s="${st}"` : '';
          let v = o.v;
          if ((o.s === 'date' || o.s === 'datetime' || o.s === 'plaindate') && v !== null && v !== undefined && v !== '') { const n = serial(v); if (n !== null) v = n; }
          // Formula cells (e.g. COUNTIF on the leadsheet) are stored with the current value too, so they show correctly even before Excel recalculates.
          if (o.f) { const cached = v === null || v === undefined ? '' : (typeof v === 'number' ? `<v>${v}</v>` : `<v>${esc(v)}</v>`); cells.push(`<c r="${ref}"${sa}${typeof v === 'string' ? ' t="str"' : ''}><f>${esc(o.f)}</f>${cached}</c>`); return; }
          if (v === null || v === undefined || v === '') { if (st) cells.push(`<c r="${ref}"${sa}/>`); return; }
          if (typeof v === 'number' && isFinite(v)) cells.push(`<c r="${ref}"${sa}><v>${v}</v></c>`);
          else if (typeof v === 'boolean') cells.push(`<c r="${ref}"${sa} t="b"><v>${v ? 1 : 0}</v></c>`);
          else cells.push(`<c r="${ref}" t="inlineStr"${sa}><is><t xml:space="preserve">${esc(v)}</t></is></c>`);
        });
        const ht = s.heights?.[ri];
        x += `<row r="${ri + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cells.join('')}</row>`;
      });
      x += '</sheetData>';
      if (s.filter) x += `<autoFilter ref="${s.filter}"/>`;
      if (s.merges?.length) x += `<mergeCells count="${s.merges.length}">${s.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`;
      // Dropdown lists, e.g. "Confirmed exception / Not an exception / More information needed".
      if (s.validations?.length) x += `<dataValidations count="${s.validations.length}">${s.validations.map(d => `<dataValidation type="list" allowBlank="1" showDropDown="0" showInputMessage="1" showErrorMessage="0" sqref="${d.sqref}"><formula1>"${esc(d.list.join(',').slice(0, 250))}"</formula1></dataValidation>`).join('')}</dataValidations>`;
      x += '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' + `<pageSetup paperSize="9" orientation="${s.landscape === false ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/>` + '</worksheet>';
      add(`xl/worksheets/sheet${si + 1}.xml`, x);
    });
    return zip(files);
  }

  // Simple writer: sheets: [{name, rows:[object], columns?:[string]}] - one header row, autofilter, frozen header.
  // Simple writer for plain tables (one header row + records), used for the raw results and evaluation exports.
  function writeXlsx(sheets) {
    return writeBook(sheets.map(s => {
      const cols = s.columns || [...new Set(s.rows.flatMap(r => Object.keys(r)))];
      const rows = [cols.map(c => ({ v: c, s: 'hdr' })), ...s.rows.map(r => cols.map(c => { const v = r[c]; return String(v ?? '').length > 60 ? { v, s: 'wrap' } : v; }))];
      return { name: s.name, rows, freeze: 'A2', filter: s.rows.length && cols.length ? `A1:${colName(cols.length - 1)}${s.rows.length + 1}` : null };
    }));
  }

  // Entry point used by the app: chooses the CSV/text reader or the Excel reader based on the file name.
  async function readFile(name, buf) {
    if (/\.(csv|txt|tsv|dat)$/i.test(name)) { const base = name.replace(/\.[^.]+$/, '').split(/[\\/]/).pop(); return { [base]: readCsv(decodeText(buf)) }; }
    if (/\.xls$/i.test(name)) throw new Error('Old .xls format is not supported. Open it in Excel and save as .xlsx or .csv.');
    return readXlsx(buf);
  }
  return { readXlsx, readCsv, readFile, writeXlsx, writeBook, toObjects, colName, decodeText };
})();
if (typeof module !== 'undefined') module.exports = XLSX_LITE;
