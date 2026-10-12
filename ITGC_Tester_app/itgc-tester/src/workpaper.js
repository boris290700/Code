/* workpaper.js - builds an audit workpaper (one Excel workbook per control) in the
   usual Big4 layout: Leadsheet, C&A of IPE, Population, Testing table, Exceptions,
   source data and parameters. Yellow cells are for the auditor to complete.
   Pure function: returns sheet definitions for XLSX_LITE.writeBook. */
// HOW TO READ THIS FILE (for non-programmers)
// This file lays out the Excel workpaper for ONE control. It does not test anything itself –
// it takes the results of the engine and arranges them like an audit workpaper:
//   .1 Leadsheet       – summary: control, approach, population, attributes, results, conclusion
//   .2 C&A             – completeness and accuracy of each extract (tool checks + auditor steps)
//   .3 Population      – how the population was derived, and every item in it
//   .4 Testing table   – one row per item, one column per attribute with tickmarks
//   .5 Exceptions      – flagged items with room for root cause and impact
//   .6 Source data     – the evidence exactly as received
//   .7 Parameters & log– settings, mapping, run details
// Each sheet is built as a list of rows; each row is a list of cells; each cell has a value
// and a style name (see xlsx.js). Yellow "input" cells are for the auditor to complete.
const WORKPAPER = (() => {
  // Tickmarks used in the testing table: ✓ met, X exception, ? review, N/A not applicable,
  // N/T not tested automatically. TSTYLE gives each one its colour (N/T is yellow = to do).
  const TICK = { PASS: '✓', EXCEPTION: 'X', REVIEW: '?', 'N/A': 'N/A', 'NOT TESTED': 'N/T' };
  const TSTYLE = { PASS: 'pass', EXCEPTION: 'exc', REVIEW: 'rev', 'N/A': 'nt', 'NOT TESTED': 'inputc' };
  // The choices in the "Auditor decision" dropdown and in the leadsheet conclusion dropdown.
  const DECISIONS = ['Confirmed exception', 'Not an exception', 'More information needed'];
  const CONCLUSIONS = ['Operating effectively', 'Operating effectively – exceptions evaluated as not a deficiency', 'Not operating effectively', 'Not concluded – further work required'];
  // "C" creates one cell: a value plus a style name.
  const C = (v, s) => ({ v, s });
  // Estimates how tall a row must be to show a long text (Excel does not do this for merged cells).
  const est = (t, w) => Math.max(1, String(t ?? '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / w)), 0)) * 12.75 + 3;
  // Puts a sheet name in quotes for use inside Excel formulas, e.g. 'Testing table'!A1.
  const qs = n => `'${String(n).replace(/'/g, "''")}'`;
  // Cell colour of an item's overall tool result (NOT TESTED is yellow: the auditor must test it).
  const resStyle = r => r === 'PASS' ? 'pass' : r === 'EXCEPTION' ? 'exc' : r === 'NOT TESTED' ? 'inputc' : 'rev';

  // Builds all sheets for one control. "ctx" contains everything needed: the run results,
  // the settings, the auditor's decisions, the data checks, the mapping facts and the files.
  function build(control, ctx) {
    const { run, settings: S, decisions = {}, checks = [], mapped = {}, files = [], auditor = '' } = ctx;
    const I = ctx.ITGC, X = ctx.XLSX_LITE, col = X.colName;
    const def = I.CONTROLS[control], cfg = S.controls[control], wp = { ...cfg.wp };
    // Only the items (population members) of this control.
    const items = run.items.filter(i => i.control === control);
    // Workpaper reference, e.g. ITGC-C1; sheets are numbered ITGC-C1.1, .2, ...
    const prefix = `${S.engagement?.wp_prefix || 'ITGC'}-${wp.ref || control}`;
    const ents = Object.keys(def.evidence).filter(e => ctx.entities?.[e]);
    const runDate = (run.started || '').slice(0, 10);
    const title = `${control} – ${cfg.name || def.name}`;
    // The standard header on top of every sheet: client, title, period, system, W/P ref, prepared/reviewed by.
    const head = (ref, what) => [
      [C(S.engagement?.client || 'Client', 'title')],
      [C(`${title}  |  ${what}`, 'h2')],
      [C(`Period: ${S.period.start} to ${S.period.end}    System: ${S.engagement?.system || ''}    W/P ref: ${ref}`, 'plain')],
      [C(`Prepared by: ${auditor || '________'} on ${runDate} (ITGC Tester v${I.VERSION}, run ${run.id})    Reviewed by: ________ on ________`, 'noteline')],
      [],
    ];
    const mergeHead = n => [`A2:${col(n - 1)}2`];
    const sheets = [];
    const names = { lead: 'Leadsheet', ca: 'C&A', pop: 'Population', tt: 'Testing table', exc: 'Exceptions', par: 'Parameters & log' };

    // TESTING TABLE. Built first because the leadsheet and the exceptions sheet refer to its cells
    // with formulas. Columns: Ref, Record ID, the key data of the item, one column per attribute
    // (A, B, C...) with the tickmark, the overall tool result, what was checked, and the
    // auditor's decision (dropdown), comment, who decided and when, and the evidence reference.
    // The sheet is protected (no password) so tool results are not changed by accident; the
    // yellow cells stay editable. "Unprotect sheet" in Excel lifts it when really needed.
    // ---------- Testing table (built first: other sheets refer to its cells) ----------
    // Data columns to show (a column that only repeats the record ID is left out).
    const dataCols = items.length ? Object.keys(items[0].data || {}).filter(k => !items.every(i => String(i.data[k] ?? '') === i.record_id)) : [];
    const attrs = def.attributes;
    const ttHead = ['Ref', 'Record ID', ...dataCols, ...attrs.map(a => a.id), 'Tool result', 'Tool details (what was checked)', 'Auditor decision', 'Auditor comment / manual testing', 'Decided by / on', 'Evidence ref'];
    const tt = head(`${prefix}.4`, 'Testing table');
    // Legend above the table: what each attribute letter means.
    tt.push([C('Attributes tested', 'boldplain')]);
    attrs.forEach(a => tt.push([C(a.id, 'bold'), C(`${a.name}: ${a.test}`, 'plain')]));
    tt.push([C('Tickmarks: ✓ attribute met · X exception · ? auditor review required · N/A not applicable · N/T not tested automatically (yellow – test manually and replace with ✓ / X).', 'noteline')]);
    tt.push([]);
    const ttHeaderRow = tt.length + 1; // 1-based
    tt.push(ttHead.map(h => C(h, 'th')));
    const firstAttrCol = 2 + dataCols.length, resCol = firstAttrCol + attrs.length, decCol = resCol + 2, comCol = decCol + 1;
    const ttRowOf = {};
    // One row per item; the auditor's decision from the app is filled in if already made.
    for (const it of items) {
      const d = decisions[control + '|' + it.record_id] || {};
      const amap = Object.fromEntries(it.attributes.map(a => [a.id, a]));
      ttRowOf[it.ref] = tt.length + 1;
      tt.push([C(it.ref, 'center'), C(it.record_id, 'bold'), ...dataCols.map(k => C(it.data[k] ?? '', typeof it.data[k] === 'number' ? 'num' : 'text')),
        ...attrs.map(a => { const r = amap[a.id]?.result || 'N/A'; return C(TICK[r], TSTYLE[r]); }),
        C(it.result, resStyle(it.result)),
        C(it.attributes.map(a => `${a.id}. ${a.detail}`).join('\n'), 'text'),
        C(d.decision || '', it.result === 'PASS' ? 'text' : 'input'),
        C(d.comment || '', 'input'), C(d.decision ? `${d.by || ''} ${d.at || ''}`.trim() : '', 'input'), C('', 'input')]);
    }
    const ttLast = Math.max(ttHeaderRow + 1, tt.length);
    // Helper: the Excel range of one testing-table column, used in the leadsheet formulas.
    const rng = c => `${qs(names.tt)}!$${col(c)}$${ttHeaderRow + 1}:$${col(c)}$${ttLast}`;
    // Column widths; then the sheet is added with frozen header, filter and the decision dropdown.
    const ttWidths = [6, 14, ...dataCols.map(k => Math.min(32, Math.max(10, k.length + 3, ...items.slice(0, 200).map(i => String(i.data[k] ?? '').length + 3)))), ...attrs.map(() => 6), 13, 62, 22, 36, 18, 12];
    sheets.push({ key: 'tt', name: names.tt, rows: tt, widths: ttWidths, merges: mergeHead(ttHead.length), freeze: `C${ttHeaderRow + 1}`, filter: `A${ttHeaderRow}:${col(ttHead.length - 1)}${ttLast}`, validations: [{ sqref: `${col(decCol)}${ttHeaderRow + 1}:${col(decCol)}${ttLast}`, list: DECISIONS }], tab: 'FF1F4E79', protect: true });

    // EXCEPTIONS SHEET: every item flagged EXCEPTION, REVIEW or NOT TESTED. The decision and comment columns
    // are formulas pointing to the testing table, so the auditor records them only once (in the
    // testing table). Root cause, impact and deficiency reference are left for the auditor.
    // ---------- Exceptions ----------
    const flagged = items.filter(i => i.result !== 'PASS');
    const ex = head(`${prefix}.5`, 'Exceptions and items for review');
    const nNT = flagged.filter(i => i.result === 'NOT TESTED').length;
    ex.push([C(`${flagged.length} item(s) flagged by the tool: ${flagged.filter(i => i.result === 'EXCEPTION').length} EXCEPTION, ${flagged.filter(i => i.result === 'REVIEW').length} REVIEW${nNT ? `, ${nNT} NOT TESTED (test manually)` : ''}. Record the decision in the Testing table (it is linked here). Complete root cause and impact for confirmed exceptions.`, 'noteline')]);
    ex.push([]);
    const exHeaderRow = ex.length + 1;
    ex.push(['Ref', 'Record ID', 'Tool result', 'Attribute(s) not met', 'Details', 'Auditor decision', 'Auditor comment', 'Root cause (per control owner)', 'Impact / compensating control', 'Deficiency ref'].map(h => C(h, 'th')));
    for (const it of flagged) {
      const r = ttRowOf[it.ref], d = decisions[control + '|' + it.record_id] || {};
      ex.push([C(it.ref, 'center'), C(it.record_id, 'bold'), C(it.result, resStyle(it.result)),
        C(it.attributes.filter(a => a.result === it.result).map(a => `${a.id}. ${a.name}`).join('\n'), 'text'),
        C(it.reason, 'text'),
        { v: d.decision || '', f: `IF(${qs(names.tt)}!${col(decCol)}${r}="","",${qs(names.tt)}!${col(decCol)}${r})`, s: 'text' },
        { v: d.comment || '', f: `IF(${qs(names.tt)}!${col(comCol)}${r}="","",${qs(names.tt)}!${col(comCol)}${r})`, s: 'text' },
        C('', 'input'), C('', 'input'), C('', 'input')]);
    }
    if (!flagged.length) ex.push([C('No exceptions or review items.', 'note')]);
    sheets.push({ key: 'exc', name: names.exc, rows: ex, widths: [6, 14, 11, 30, 60, 22, 30, 30, 30, 12], merges: mergeHead(10), freeze: `A${exHeaderRow + 1}`, filter: flagged.length ? `A${exHeaderRow}:J${exHeaderRow + flagged.length}` : null, tab: 'FFB42318' });

    // POPULATION SHEET: first the derivation (records in the extract, minus those outside the
    // period / out of scope / duplicates = population tested), then every population item with
    // all its original columns and its row number in the source file – for traceability.
    // ---------- Population ----------
    const pe = Object.keys(def.evidence)[0];
    const deriv = run.derivation?.[control] || { steps: [], population: items.length };
    const po = head(`${prefix}.3`, 'Population');
    po.push([C('Population definition', 'label'), C(def.population, 'text')]);
    po.push([C('Source', 'label'), C(`${I.ENTITY_LABELS[pe]} – ${mapped.meta?.[pe]?.sheet || ''} (see ${names.ca})`, 'text')]);
    po.push([]);
    po.push([C('Population derivation', 'th'), C('Records', 'th')]);
    for (const s of deriv.steps) po.push([C(s.step, 'text'), C(s.n, 'num')]);
    po.push([C('Population tested (100%)', 'bold'), C(deriv.population, 'numbold')]);
    po.push([]);
    const rawCols = [...new Set(items.flatMap(i => Object.keys(i.source?._raw || {})))];
    const poHeaderRow = po.length + 1;
    po.push(['Ref', 'Source row', 'Tool result', ...rawCols].map(h => C(h, 'th')));
    for (const it of items) po.push([C(it.ref, 'center'), C(it.source?._row ?? '', 'center'), C(it.result, resStyle(it.result)), ...rawCols.map(k => { const v = it.source?._raw?.[k]; return C(v ?? '', 'text'); })]);
    sheets.push({ key: 'pop', name: names.pop, rows: po, widths: [34, 12, 11, ...rawCols.map(k => Math.min(40, Math.max(10, k.length + 2, ...items.slice(0, 200).map(i => String(i.source?._raw?.[k] ?? '').length + 1))))], merges: [...mergeHead(Math.max(6, rawCols.length + 3)), `B${6}:${col(Math.max(5, rawCols.length + 2))}6`, `B${7}:${col(Math.max(5, rawCols.length + 2))}7`], freeze: `D${poHeaderRow + 1}`, filter: items.length ? `A${poHeaderRow}:${col(rawCols.length + 2)}${poHeaderRow + items.length}` : null, protect: true });

    // C&A SHEET (completeness and accuracy of information produced by the entity). For every
    // extract used by the control:
    //   - facts recorded by the tool: typical source, file name and fingerprint, header row,
    //     number of records, which columns were used;
    //   - questions for the auditor (yellow): which report was used, parameters, who extracted it,
    //     how the auditor obtained it;
    //   - the tool's checks (record count, duplicates, dates, values, period coverage...);
    //   - standard procedures for the auditor to perform and document: reconcile the record count,
    //     check the extraction parameters, and sample in both directions (system ↔ extract);
    //   - a conclusion cell (Yes / No / Pending).
    // ---------- C&A of IPE ----------
    const ca = head(`${prefix}.2`, 'Completeness and accuracy of information produced by the entity (IPE)');
    const caMerges = [], caVal = [], caH = [];
    ca.push([C('For each extract used in this test, document how it was obtained and the procedures performed to conclude that it is complete and accurate. Grey rows were performed by the tool; yellow cells must be completed by the auditor.', 'note')]);
    caMerges.push(`A${ca.length}:F${ca.length}`); caH[ca.length - 1] = 28;
    ca.push([]);
    ents.forEach((e, n) => {
      const m = mapped.meta?.[e] || {}, f = files.find(x => Object.keys(x.sheets || {}).includes(m.sheet)) || {};
      const ec = checks.filter(c => c.entity === e);
      const lab = (l, v, s = 'text') => { ca.push([C(l, 'label'), C(v, s), C('', s), C('', s), C('', s), C('', s)]); caMerges.push(`B${ca.length}:F${ca.length}`); caH[ca.length - 1] = Math.max(est(v, 140), est(l, 32)); };
      ca.push([C(`${n + 1}. ${I.ENTITY_LABELS[e]}`, 'h2')]); caMerges.push(`A${ca.length}:F${ca.length}`);
      lab('Typical source', I.ENTITIES[e].source);
      lab('Report / table / transaction actually used', '', 'input');
      lab('Extraction parameters (period, company codes, clients, filters)', '', 'input');
      lab('Extracted by / date and time', '', 'input');
      lab('How obtained by the auditor', '', 'input'); caVal.push({ sqref: `B${ca.length}`, list: ['Auditor observed the extraction', 'Auditor performed the extraction', 'Provided by client – re-performed', 'Provided by client – not re-performed'] });
      lab('File received', `${f.name || '(not recorded)'}${f.sha256 ? `  ·  SHA-256 ${f.sha256}` : ''}`);
      lab('Sheet / header row / records', `${m.sheet || ''}  ·  header on row ${m.headerRow || 1}  ·  ${ctx.entities[e].length} records`);
      lab('Columns used by the test', Object.entries(m.resolved || {}).map(([k, v]) => `${I.ENTITIES[e].fields[k].label} = ${v}`).join('; ') || '(default)');
      ca.push([C('#', 'th'), C('Procedure', 'th'), C('Type', 'th'), C('Performed by', 'th'), C('Result', 'th'), C('Evidence ref / comment', 'th')]);
      let k = 0;
      // Adds one procedure row; tool rows are filled in, auditor rows are yellow.
      const proc = (p, type, by, res, st, cmt = '') => ca.push([C(++k, 'center'), C(p, 'text'), C(type, 'center'), C(by, by === 'ITGC Tester' ? 'center' : 'inputc'), C(res, st), C(cmt, by === 'ITGC Tester' ? 'text' : 'input')]);
      for (const c of ec) proc(`${c.Check}: ${c.Detail}`, /^(Source|Fields not available)/.test(c.Check) ? 'Information' : /count|cover|key|loaded|matched|linked|found|lines|within/i.test(c.Check) ? 'Completeness' : 'Accuracy', 'ITGC Tester', c.Status, c.Status === 'OK' || c.Status === 'INFO' ? 'pass' : c.Status === 'WARNING' ? 'rev' : 'exc');
      proc('Reconciled the record count of the extract to the total shown in the system (e.g. SE16N "number of entries", report footer or a control total).', 'Completeness', '', '', 'inputc');
      proc('Verified that the extraction parameters cover the full audit period and all in-scope company codes / clients, and that no filter excluded relevant records.', 'Completeness', '', '', 'inputc');
      proc('Agreed a sample of records from the system to the extract (system → extract).', 'Completeness', '', '', 'inputc');
      proc('Agreed a sample of records from the extract to the system for the fields used in the test (extract → system).', 'Accuracy', '', '', 'inputc');
      // For the extract the population is taken from: the known completeness risks of this control.
      if (e === pe && def.completeness?.length) proc(`Addressed the known population completeness risks listed on the ${names.lead} (section 3) and documented how each was covered.`, 'Completeness', '', '', 'inputc');
      ca.push([C('Conclusion: the extract is sufficiently complete and accurate for the purpose of this test', 'label'), C('', 'input'), C('', 'input'), C('', 'input'), C('', 'input'), C('', 'input')]);
      caMerges.push(`B${ca.length}:F${ca.length}`); caVal.push({ sqref: `B${ca.length}`, list: ['Yes', 'No', 'Pending'] });
      ca.push([]);
    });
    sheets.push({ key: 'ca', name: names.ca, rows: ca, widths: [34, 70, 14, 16, 12, 34], merges: [...mergeHead(6), ...caMerges], validations: caVal, heights: caH, gridlines: false });

    // LEADSHEET: the summary page a reviewer reads first. Sections:
    //   1 Control information  2 Test objective and approach  3 Population
    //   4 Attributes and procedures (with counts per tickmark)  5 Results
    //   6 Conclusion (tool draft + auditor conclusion)  7 Tickmarks and sign-off
    // "sec" adds a section title, "kv" a label + value row.
    // ---------- Leadsheet ----------
    const L = head(`${prefix}.1`, 'Leadsheet'), LM = [...mergeHead(8)], LV = [], LH = [];
    const sec = t => { L.push([C(t, 'h2'), C('', 'h2'), C('', 'h2'), C('', 'h2'), C('', 'h2'), C('', 'h2'), C('', 'h2'), C('', 'h2')]); LM.push(`A${L.length}:H${L.length}`); };
    const kv = (k, v, s = 'text') => { L.push([C(k, 'label'), C('', 'label'), C(v, s), C('', s), C('', s), C('', s), C('', s), C('', s)]); LH[L.length - 1] = Math.max(est(v, 88), est(k, 38)); LM.push(`A${L.length}:B${L.length}`, `C${L.length}:H${L.length}`); };
    sec('1. Control information');
    kv('Control ID (client RCM)', wp.ref || control); kv('Control name', cfg.name || def.name); kv('Process / area', def.area);
    kv('Control description', wp.description || def.description); kv('Control objective', def.objective); kv('Risk addressed', wp.risk || def.risk);
    kv('Control owner', wp.owner || '', wp.owner ? 'text' : 'input'); kv('Frequency', wp.frequency); kv('Control type / nature', `${wp.type} / ${wp.nature}`);
    kv('Key control', wp.key); kv('System / application', S.engagement?.system || '');
    L.push([]); sec('2. Test objective and approach');
    kv('Objective', `To test whether the control operated effectively throughout the period ${S.period.start} to ${S.period.end}.`);
    kv('Nature of test', 'Test of operating effectiveness by inspection, performed on 100% of the population with automated data analytics (ITGC Tester). Items flagged by the tool were investigated by the auditor.');
    kv('Sampling', 'Not applicable – the whole population was tested.');
    kv('Reliance on IPE', `The population and the evidence are system extracts. Their completeness and accuracy are documented in ${names.ca} (${prefix}.2).`);
    kv('Free-text assessment', S.ai.mode === 'llm' ? `Language model ${S.ai.provider} / ${S.ai.model}, ${S.ai.runs} run(s); disagreements, unsupported answers and answers contradicting the keyword rules sent to review.` : 'Keyword rules (see Parameters & log); texts without a known positive or negative wording, or with a negation, sent to review.');
    // Reliance on the tool: the tool is a research prototype, so its rules must be validated by
    // the engagement team before reliance – the usual requirement for audit data analytics.
    kv('Reliance on the tool', `Testing was performed with ITGC Tester v${I.VERSION}, a research prototype developed for a master thesis – not a firm-approved audit tool. Before relying on the results, validate the rules used for this control: re-perform a selection of items manually (including PASS items), agree them to the tool result and retain that evidence. Results fingerprint ${run.log?.['Results fingerprint'] || '(not recorded)'}: re-running the same files with the same settings and tool version must reproduce it.`);
    kv('Validation of the tool – ref', '', 'input');
    kv('Design and implementation', 'Not assessed by the tool. Reference the walkthrough / D&I workpaper:', 'text'); kv('D&I workpaper ref', '', 'input');
    L.push([]); sec('3. Population');
    kv('Definition', def.population);
    // Known reasons why the extract may not contain the whole population – each must be addressed (see C&A).
    if (def.completeness?.length) kv('Population completeness risks (address each – see C&A)', def.completeness.map((t, i) => `${i + 1}. ${t}`).join('\n'));
    kv('Source', ents.map(e => `${I.ENTITY_LABELS[e]} (${mapped.meta?.[e]?.sheet || ''})`).join('; '));
    L.push([C('Derivation', 'th'), C('', 'th'), C('', 'th'), C('', 'th'), C('', 'th'), C('', 'th'), C('Records', 'th'), C('', 'th')]); LM.push(`A${L.length}:F${L.length}`, `G${L.length}:H${L.length}`);
    for (const s of deriv.steps) { L.push([C(s.step, 'text'), C('', 'text'), C('', 'text'), C('', 'text'), C('', 'text'), C('', 'text'), C(s.n, 'num'), C('', 'num')]); LM.push(`A${L.length}:F${L.length}`, `G${L.length}:H${L.length}`); }
    L.push([C(`Population tested (100%) – see ${names.pop}`, 'bold'), C('', 'bold'), C('', 'bold'), C('', 'bold'), C('', 'bold'), C('', 'bold'), C(deriv.population, 'numbold'), C('', 'numbold')]); LM.push(`A${L.length}:F${L.length}`, `G${L.length}:H${L.length}`);
    L.push([]); sec('4. Attributes tested and procedures performed');
    L.push(['Attr', 'What must be true', 'Procedure performed', '✓ Met', 'X Exc.', '? Review', 'N/A', 'N/T'].map(h => C(h, 'th')));
    // Attribute counts are Excel formulas (COUNTIF) over the testing table, so if the auditor changes
    // a tickmark or decision in Excel, the leadsheet updates. Note: "~?" is needed because a plain
    // "?" means "any single character" in COUNTIF.
    attrs.forEach((a, i) => {
      const cn = col(firstAttrCol + i), r = `${qs(names.tt)}!$${cn}$${ttHeaderRow + 1}:$${cn}$${ttLast}`;
      const cnt = res => items.filter(it => (it.attributes.find(x => x.id === a.id)?.result || 'N/A') === res).length;
      L.push([C(a.id, 'center'), C(`${a.name}: ${a.test}`, 'text'), C(a.procedure, 'text'),
        { v: cnt('PASS'), f: `COUNTIF(${r},"${TICK.PASS}")`, s: 'num' }, { v: cnt('EXCEPTION'), f: `COUNTIF(${r},"X")`, s: 'num' }, { v: cnt('REVIEW'), f: `COUNTIF(${r},"~?")`, s: 'num' },
        { v: cnt('N/A'), f: `COUNTIF(${r},"N/A")`, s: 'num' }, { v: cnt('NOT TESTED'), f: `COUNTIF(${r},"N/T")`, s: 'num' }]);
    });
    // Procedures performed, including any limitation (attributes the tool could not test).
    const lim = run.limitations?.[control] || [];
    const steps = [
      `Obtained the extracts listed in ${names.ca} and performed the completeness and accuracy procedures documented there.`,
      `Derived the population of ${deriv.population} item(s) as shown above (${names.pop}).`,
      `For every item, the attributes above were tested with ITGC Tester v${I.VERSION} (run ${run.id}, settings fingerprint ${run.log?.['Settings fingerprint'] || ''}). Parameters are in ${names.par}. Results per item and attribute are in ${names.tt}.`,
      `Investigated every item flagged EXCEPTION, REVIEW or NOT TESTED and recorded the conclusion in ${names.tt} and ${names.exc}.`,
      ...(lim.length ? [`LIMITATION – attribute(s) ${lim.map(l => `${l.id} (${l.name})`).join(', ')} could not be (fully) tested automatically because ${lim.map(l => l.missing.join(', ')).join('; ')} is not in the evidence. These must be tested manually (fully untested attributes are marked N/T in ${names.tt}).`] : []),
    ];
    L.push([C('Procedures performed', 'label'), C('', 'label'), C(steps.map((s, i) => `${i + 1}. ${s}`).join('\n'), 'text'), C('', 'text'), C('', 'text'), C('', 'text'), C('', 'text'), C('', 'text')]); LM.push(`A${L.length}:B${L.length}`, `C${L.length}:H${L.length}`); LH[L.length - 1] = est(steps.map((s, i) => `${i + 1}. ${s}`).join('\n'), 88);
    L.push([]); sec('5. Results');
    // Results: tool counts and auditor decisions, again as formulas over the testing table.
    const rc = rng(resCol), dc = rng(decCol);
    const nEx = items.filter(i => i.result === 'EXCEPTION').length, nRev = items.filter(i => i.result === 'REVIEW').length;
    const dn = v => flagged.filter(i => decisions[control + '|' + i.record_id]?.decision === v).length;
    const kf = (k, v, f, s = 'num') => { L.push([C(k, 'label'), C('', 'label'), { v, f, s }]); LM.push(`A${L.length}:B${L.length}`); };
    kf('Population / items tested', items.length, `COUNTA(${rng(1)})`); kf('Coverage', 1, null, 'pct');
    kf('Tool result: PASS', items.length - nEx - nRev - nNT, `COUNTIF(${rc},"PASS")`); kf('Tool result: EXCEPTION', nEx, `COUNTIF(${rc},"EXCEPTION")`); kf('Tool result: REVIEW', nRev, `COUNTIF(${rc},"REVIEW")`);
    if (nNT) kf('Tool result: NOT TESTED (test manually)', nNT, `COUNTIF(${rc},"NOT TESTED")`);
    kf('Auditor: confirmed exceptions', dn('Confirmed exception'), `COUNTIF(${dc},"Confirmed exception")`); kf('Auditor: not an exception', dn('Not an exception'), `COUNTIF(${dc},"Not an exception")`);
    kf('Auditor: more information needed', dn('More information needed'), `COUNTIF(${dc},"More information needed")`);
    kf('Flagged items not yet concluded', flagged.filter(i => !['Confirmed exception', 'Not an exception'].includes(decisions[control + '|' + i.record_id]?.decision)).length, `${flagged.length}-COUNTIF(${dc},"Confirmed exception")-COUNTIF(${dc},"Not an exception")`);
    // Overriding a tool flag needs a documented reason: count "Not an exception" without a comment.
    kf('Cleared as "Not an exception" without a comment', flagged.filter(i => { const d = decisions[control + '|' + i.record_id]; return d?.decision === 'Not an exception' && !String(d.comment || '').trim(); }).length, `COUNTIFS(${dc},"Not an exception",${rng(comCol)},"")`);
    const byAttr = attrs.map(a => ({ a, n: items.filter(i => i.attributes.some(x => x.id === a.id && x.result === 'EXCEPTION')).length, r: items.filter(i => i.attributes.some(x => x.id === a.id && x.result === 'REVIEW')).length })).filter(x => x.n || x.r);
    kv('Flagged items by attribute', byAttr.length ? byAttr.map(x => `${x.a.id}. ${x.a.name}: ${x.n} exception(s), ${x.r} review`).join('\n') : 'None');
    L.push([]); sec('6. Conclusion');
    // Draft conclusion written by the tool: "no exceptions" only if the population is not empty,
    // nothing was flagged AND every attribute was tested – and even then it is conditional on the
    // C&A work and the review. An empty population never reads as "operated effectively". The
    // final conclusion is always the auditor's (dropdown).
    const draft = !items.length ? 'The population is empty – no items were identified for the period. Confirm independently that this is plausible (e.g. no new users were created) and that the extract is complete. With no occurrences, operating effectiveness could not be tested; conclude on that basis.'
      : !flagged.length && !lim.length ? `No exceptions noted by the tool. Subject to the completion of the C&A procedures (${prefix}.2), the population completeness risks (section 3), the validation of the tool and the review of this workpaper, the results support the conclusion that the control operated effectively throughout the period.`
      : `${nEx} exception(s), ${nRev} item(s) for review${nNT ? ` and ${nNT} item(s) not tested` : ''} were identified by the tool${lim.length ? ', and some attributes could not be (fully) tested automatically (see limitation above)' : ''}. Conclude after investigating all flagged items. If exceptions are confirmed, the control did not operate effectively for those items; evaluate the deficiency (root cause, extent, compensating controls) and document the reference below.`;
    kv('Draft conclusion (tool)', draft);
    kv('Auditor conclusion', '', 'input'); LV.push({ sqref: `C${L.length}`, list: CONCLUSIONS });
    kv('Conclusion narrative', '', 'input'); kv('Deficiency evaluation ref', '', 'input');
    L.push([]); sec('7. Tickmarks and sign-off');
    kv('Tickmarks', '✓ attribute met · X exception · ? auditor review required · N/A not applicable · N/T not tested automatically – test manually · yellow cell = to be completed by the auditor');
    kv('Prepared by / date', `${auditor || ''} / ${runDate}`, auditor ? 'text' : 'input');
    // The review sign-off is left empty: only the reviewer signs it, after the review. The planned
    // reviewer from step 1 is shown separately so it is not mistaken for a sign-off.
    if (S.engagement?.reviewer) kv('Planned reviewer', S.engagement.reviewer);
    kv('Reviewed by / date', '', 'input');
    const lead = { key: 'lead', name: names.lead, rows: L, widths: [7, 34, 46, 9, 9, 9, 9, 9], merges: LM, validations: LV, heights: LH, gridlines: false, landscape: false, tab: 'FF1E7A46' };

    // SOURCE DATA SHEETS: each extract as received, with its original row numbers.
    // ---------- Source data ----------
    const src = ents.map((e, n) => {
      const rows = ctx.entities[e], cols = mapped.meta?.[e]?.columns || [...new Set(rows.flatMap(r => Object.keys(r._raw || {})))];
      const sr = head(`${prefix}.6.${n + 1}`, `Source data – ${I.ENTITY_LABELS[e]} (as received, ${rows.length} records)`);
      const hr = sr.length + 1;
      sr.push(['Source row', ...cols].map(h => C(h, 'th')));
      for (const r of rows) sr.push([r._row, ...cols.map(k => r._raw?.[k] ?? '')]);
      return { key: 'src' + n, name: `Src ${n + 1} ${I.ENTITY_LABELS[e]}`.slice(0, 31), rows: sr, widths: [10, ...cols.map(k => Math.min(40, Math.max(10, k.length + 2, ...rows.slice(0, 200).map(r => String(r._raw?.[k] ?? '').length + 1))))], merges: mergeHead(Math.max(4, cols.length + 1)), freeze: `B${hr + 1}`, filter: rows.length ? `A${hr}:${col(cols.length)}${hr + rows.length}` : null, tab: 'FF7F7F7F', protect: true };
    });

    // PARAMETERS & LOG: run ID, tool version, settings fingerprint, file fingerprints, parameters and mapping – so the test can be reproduced.
    // ---------- Parameters & log ----------
    const pa = head(`${prefix}.7`, 'Parameters and run log');
    const pv = (k, v) => pa.push([C(k, 'label'), C(typeof v === 'string' ? v : JSON.stringify(v), 'text')]);
    pa.push([C('Run log', 'h2'), C('', 'h2')]);
    for (const [k, v] of Object.entries(run.log || {})) pv(k, String(v));
    pa.push([]); pa.push([C('Control parameters', 'h2'), C('', 'h2')]);
    for (const [k, v] of Object.entries(cfg)) if (k !== 'wp' && k !== 'enabled') pv(k, Array.isArray(v) ? v.join(', ') : v);
    pv('Audit period', `${S.period.start} to ${S.period.end}`);
    pv('Date order for ambiguous dates', S.date_order);
    pv('Negation words (free text)', (S.negation_words || []).join(', '));
    pv('Free-text assessment', { ...S.ai, api_key: S.ai.api_key ? '(set)' : '' });
    pa.push([]); pa.push([C('Evidence mapping', 'h2'), C('', 'h2')]);
    for (const e of ents) pv(I.ENTITY_LABELS[e], `Sheet "${mapped.meta?.[e]?.sheet}": ` + Object.entries(mapped.meta?.[e]?.resolved || {}).map(([k, v]) => `${k} = ${v}`).join('; '));
    sheets.push({ key: 'par', name: names.par, rows: pa, widths: [36, 110], merges: mergeHead(2), gridlines: false, protect: true });

    // Sheet order in the workbook: Leadsheet, C&A, Population, Testing table, Exceptions, sources, parameters.
    const order = ['lead', 'ca', 'pop', 'tt', 'exc'];
    const main = order.map(k => k === 'lead' ? lead : sheets.find(s => s.key === k));
    return [...main, ...src, sheets.find(s => s.key === 'par')];
  }
  // File name of the workpaper, e.g. ITGC-C1_workpaper_2026-10-11.xlsx.
  const fileName = (control, S, run) => `${S.engagement?.wp_prefix || 'ITGC'}-${S.controls[control].wp?.ref || control}_workpaper_${(run.started || '').slice(0, 10)}.xlsx`.replace(/[\\/:*?"<>|\s]+/g, '_');
  return { build, fileName, DECISIONS };
})();
if (typeof module !== 'undefined') module.exports = WORKPAPER;
