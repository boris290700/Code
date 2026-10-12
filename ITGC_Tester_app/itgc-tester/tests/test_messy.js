// Automated check on the "real-world" exports in sample_data/messy_FY2025 (made by tools/make_messy_dataset.js):
// files are read and mapped automatically as in the app, every seeded deviation must be flagged,
// and the only other flagged items must be the planted ambiguous records (sent to REVIEW).
// Also checks: missing fields give NOT TESTED, single-control runs, date formats, workpaper export.
// Run with:  node tests/test_messy.js
// How the tests work: each "ok(condition, message)" line checks one expected fact and prints
// PASS or FAIL. This file simulates exactly what the app does with real-world style exports:
// read the files, map them automatically, check the data, run all controls, compare with the
// answer key, then check the special cases (NOT TESTED, single control, workpaper export).
const fs = require('fs'), path = require('path');
const X = require('../src/xlsx.js'), I = require('../src/engine.js'), W = require('../src/workpaper.js');
const dir = path.join(__dirname, '..', 'sample_data', 'messy_FY2025');
let failures = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };

(async () => {
  // --- value parsing ---
  const d = (v, o) => I.fmtDT(I.parseDate(v, o));
  ok(d('31.12.2025') === '2025-12-31 00:00' && d('20251231') === '2025-12-31 00:00' && d('20251231 143005') === '2025-12-31 14:30', 'dates: DD.MM.YYYY, YYYYMMDD, YYYYMMDD HHMMSS');
  ok(d('07-Nov-2025 19:00') === '2025-11-07 19:00' && d('Nov 7, 2025') === '2025-11-07 00:00' && d('05/04/2025 14:22:10') === '2025-04-05 14:22' && d('05/04/2025', 'MDY') === '2025-05-04 00:00', 'dates: month names, dd/mm vs mm/dd');
  ok(I.parseDate('00.00.0000') === null && I.parseDate('31.02.2025') === null && I.parseDate(45000) !== null, 'dates: SAP empty date and impossible date give no date; Excel serial read');
  ok(I.normId('Ilze Vitola (IVITOLA)') === 'IVITOLA' && I.normId(' ivitola ') === 'IVITOLA' && I.normId('00000712') === I.normId(712), 'IDs: "Name (ID)", case/spaces, leading zeros');
  const csv = X.readCsv('Report: jobs\nrun by X on 01.01.2026\n\nJob;Count;Status\nA;1;F\nB;2;A\nTotal records: 2\n');
  ok(csv.length === 2 && csv.meta.headerRow === 4 && csv.meta.excluded.length === 1, 'CSV: semicolon, title lines skipped, footer excluded');

  // --- load all files the way the app does ---
  const sheets = {}, files = [];
  for (const f of fs.readdirSync(dir).filter(f => !/answer_key|README/i.test(f))) {
    const buf = fs.readFileSync(path.join(dir, f)), s = await X.readFile(f, buf), base = f.replace(/\.[^.]+$/, ''), list = Object.entries(s), named = {};
    for (const [k, v] of list) { let key = list.length === 1 ? base : k; if (sheets[key]) key = `${base} › ${k}`; named[key] = v; }
    Object.assign(sheets, named); files.push({ name: f, sha256: await I.sha256(buf), sheets: Object.fromEntries(Object.entries(named).map(([k, v]) => [k, v.length])) });
  }
  ok(Object.keys(sheets).length === 10, 'ten exports read (xlsx, UTF-16 SE16N text, tab text, CSV)');
  ok(sheets.SE16N_USR02_users.length === 498 && sheets.SE16N_USR02_users.meta.headerRow === 4, 'SE16N UTF-16 export: header on row 4, repeated header line removed, 498 users');
  const S = I.clone(I.DEFAULT_SETTINGS);
  for (const e of Object.keys(S.mapping)) S.mapping[e] = { sheet: '', fields: {} };
  const ents = I.controlEntities(I.CONTROL_IDS);
  const am = I.autoMap(sheets, S, ents);
  for (const [e, m] of Object.entries(am.mapping)) S.mapping[e] = { sheet: m.sheet, fields: m.fields };
  const expectSheet = { users: 'SE16N_USR02_users', employees: 'HR_employee_master_export', access_requests: 'ServiceNow_RITM_access_requests', user_locks: 'RSUSR100N_user_change_documents', user_profiles: 'SE16N_UST04_profiles', privileged_approved: 'Firefighter_IDs_approved_list', transports: 'STMS_import_history_PRD', changes: 'ServiceNow_change_requests', job_runs: 'SM37_job_overview', incidents: 'ServiceNow_incidents' };
  ok(Object.entries(expectSheet).every(([e, s]) => S.mapping[e].sheet === s), 'auto-mapping picks the right export for every evidence type');
  ok(S.mapping.transports.fields.imported_on === 'Import Date+Import Time' && S.mapping.access_requests.fields.user_id === 'Requested for', 'auto-mapping joins date + time columns and recognises ServiceNow names');
  const mp = I.mapEntities(sheets, S, ents);
  const checks = I.dataChecks(mp.entities, S, { ...mp, only: ents, required: [...new Set(I.CONTROL_IDS.flatMap(c => I.CONTROL_NEEDS[c]))] });
  ok(!checks.some(c => c.Status === 'FAIL' || c.Status === 'MISSING'), 'data checks: nothing missing');
  ok(checks.some(c => c.Status === 'WARNING' && /duplicated/.test(c.Detail)) && checks.some(c => /footer/i.test(c.Detail)), 'data checks report the duplicate ticket and the footer lines');
  ok(checks.find(c => c.Check === 'Change IDs found in change tickets')?.Status === 'OK', 'change references in descriptions (CHG-70000 / CHG70000) all found');

  // --- full run ---
  const run = await I.runControls(mp.entities, S, { avail: mp.avail });
  const pops = run.populations;
  ok(!run.skipped.length && pops.C1 === 110 && pops.C2 === 87 && pops.C3 === 409 && pops.C4 === 240 && pops.C5 === 240 && pops.C6 === 55, 'all controls ran; populations ' + JSON.stringify(pops));
  const keyBook = await X.readXlsx(fs.readFileSync(path.join(dir, 'ITGC_messy_answer_key_CONFIDENTIAL.xlsx')));
  const ev = I.evaluateAutomated(run, keyBook.Deviations);
  console.table(ev.map(e => ({ C: e.Control, Pop: e.Population, Key: e['Deviations in key'], Flagged: e.Flagged, TP: e.TP, FP: e.FP, FN: e.FN })));
  ok(ev.every(e => e.FN === 0), 'recall 100%: all 47 seeded deviations flagged in the messy exports');
  const keyset = new Set(keyBook.Deviations.map(k => k.control + '|' + I.normId(k.record_id)));
  const planted = keyBook.Expected_REVIEW_not_deviations, plantset = new Set(planted.map(k => k.control + '|' + I.normId(k.record_id)));
  const unexpected = run.items.filter(it => it.result !== 'PASS' && !keyset.has(it.control + '|' + I.normId(it.record_id)) && !plantset.has(it.control + '|' + I.normId(it.record_id)));
  ok(!unexpected.length, `no unexpected flags (${unexpected.map(i => i.control + ' ' + i.record_id).join(', ') || 'none'})`);
  ok(planted.every(p => run.items.find(i => i.control === p.control && I.normId(i.record_id) === I.normId(p.record_id))?.result === 'REVIEW'), `all ${planted.length} planted ambiguous records sent to REVIEW (not passed, not called exceptions)`);
  const jl = run.items.find(i => i.control === 'C2' && i.record_id === 'JLACIS');
  ok(jl.result === 'EXCEPTION' && /lock history/.test(jl.reason), 'temporary lock + unlock is not counted as removal (JLACIS still an exception)');

  // --- missing field → NOT TESTED; missing required evidence → control not run; single-control scope ---
  const S2 = I.clone(S); S2.mapping.access_requests.fields.approved_on = ''; S2.mapping.changes.fields.test_evidence = '';
  const mp2 = I.mapEntities(sheets, S2, I.controlEntities(['C1', 'C4']));
  const run2 = await I.runControls(mp2.entities, S2, { avail: mp2.avail, controls: ['C1', 'C4'] });
  ok(run2.controls.join() === 'C1,C4' && run2.items.every(i => i.control === 'C1' || i.control === 'C4'), 'scope: only the selected controls are tested');
  ok(run2.limitations.C1.map(l => l.id).join() === 'D' && run2.items.filter(i => i.control === 'C1').every(i => ['NOT TESTED', 'N/A'].includes(i.attributes.find(a => a.id === 'D').result)), 'approval date not in extract → C1 attribute D NOT TESTED, others still tested');
  ok(run2.limitations.C4.map(l => l.id).join() === 'C', 'test evidence not in extract → C4 attribute C NOT TESTED');
  const S3 = I.clone(S); S3.mapping.users.fields.created_on = '';
  const mp3 = I.mapEntities(sheets, S3, I.controlEntities(['C1']));
  const run3 = await I.runControls(mp3.entities, S3, { avail: mp3.avail, controls: ['C1'] });
  ok(run3.skipped.length === 1 && /Created on/.test(run3.skipped[0].reason) && !run3.items.length, 'user creation date not mapped → C1 not run, with the reason');
  const S4 = I.clone(S); S4.mapping.users.fields.created_by = '';
  const mp4 = I.mapEntities(sheets, S4, I.controlEntities(['C1']));
  const run4 = await I.runControls(mp4.entities, S4, { avail: mp4.avail, controls: ['C1'] });
  ok(run4.limitations.C1.some(l => l.id === 'C' && l.partial) && !run4.items.some(i => i.attributes.some(a => a.id === 'C' && a.result === 'NOT TESTED')), 'creator not in extract → C1-C still tested, independence part reported as a limitation');

  // --- workpapers ---
  run.id = 'run-test'; run.started = '2026-01-20 10:00:00'; run.log = { 'Run ID': run.id, 'Settings fingerprint': 'test' };
  for (const c of I.CONTROL_IDS) {
    const wb = W.build(c, { run, settings: S, decisions: {}, checks, mapped: mp, files, auditor: 'TEST', entities: mp.entities, ITGC: I, XLSX_LITE: X });
    const bytes = X.writeBook(wb), back = await X.readXlsx(bytes);
    const names = Object.keys(back);
    ok(['Leadsheet', 'C&A', 'Population', 'Testing table', 'Exceptions', 'Parameters & log'].every(n => names.includes(n)) && back['Testing table'].length === pops[c], `${c} workpaper: leadsheet, C&A, population, testing table (${pops[c]} rows), exceptions, ${names.filter(n => n.startsWith('Src')).length} source sheet(s)`);
    // The workbook is stored uncompressed, so its XML can be searched directly.
    const xml = Buffer.from(bytes).toString('utf8');
    if (c === 'C1') ok(Object.keys(back['Testing table'][0]).includes('Decided by / on') && (xml.match(/<sheetProtection /g) || []).length >= 4 && /<protection locked="0"\/>/.test(xml) && /Reliance on the tool/.test(xml) && /Population completeness risks/.test(xml), 'workpaper: decision audit trail column, tool-output sheets protected (input cells open), tool-reliance and completeness-risk sections');
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
