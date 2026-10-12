// Automated check: run the engine on the synthetic dataset and compare with the answer key.
// Run with:  node tests/test_engine.js
// How the tests work: each "ok(condition, message)" line checks one expected fact and prints
// PASS or FAIL. If anything fails, the script ends with an error, so a broken rule is noticed.
const fs = require('fs'), path = require('path');
const X = require('../src/xlsx.js'), I = require('../src/engine.js');
const dir = path.join(__dirname, '..', 'sample_data');
let failures = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };
(async () => {
  const sheets = await X.readXlsx(fs.readFileSync(path.join(dir, 'ITGC_synthetic_evidence_FY2025.xlsx')));
  const key = Object.values(await X.readXlsx(fs.readFileSync(path.join(dir, 'ITGC_answer_key_FY2025_CONFIDENTIAL.xlsx'))))[0];
  // Map the demo data with the default settings and check that nothing is missing.
  const S = I.clone(I.DEFAULT_SETTINGS);
  const { entities, issues } = I.mapEntities(sheets, S);
  ok(issues.filter(i => i.level !== 'info').length === 0, 'all evidence mapped without warnings');
  const checks = I.dataChecks(entities, S);
  ok(!checks.some(c => c.Status === 'FAIL' || c.Status === 'MISSING'), 'data checks: no FAIL/MISSING');
  const run = await I.runControls(entities, S);
  const pops = run.populations;
  ok(pops.C1 === 110 && pops.C2 === 85 && pops.C3 === 409 && pops.C4 === 240 && pops.C5 === 240 && pops.C6 === 55, 'populations ' + JSON.stringify(pops));
  // Compare the tool's results with the answer key: every seeded deviation found, no false alarms.
  const ev = I.evaluateAutomated(run, key);
  console.table(ev.map(e => ({ C: e.Control, Pop: e.Population, Key: e['Deviations in key'], TP: e.TP, FP: e.FP, FN: e.FN, P: e.Precision?.toFixed(2), R: e.Recall?.toFixed(2) })));
  ok(ev.every(e => e.FN === 0), 'recall 100% on all controls (keyword mode)');
  ok(ev.every(e => e.FP === 0), 'no false positives (keyword mode)');
  // LLM mode with a fake model that answers from keywords, 3 runs, one item made unstable
  const S2 = I.clone(S); S2.ai = { mode: 'llm', provider: 'ollama', url: 'http://localhost:11434', model: 'fake', runs: 3 };
  let call = 0;
  const fakeFetch = async (url, o) => { call++; const p = JSON.parse(o.body).messages[0].content; const t = p.split('"""')[1];
    let k = I.keywordCheck(t, /tested/i.test(p) ? S.controls.C4.text : S.controls.C6.text);
    if (/Timeout/.test(t) && call % 2) k = { label: 'UNCLEAR' };
    return { ok: true, json: async () => ({ message: { content: JSON.stringify({ label: k.label, quote: k.quote || '', reason: 'fake' }) } }) }; };
  const run2 = await I.runControls(entities, S2, { fetch: fakeFetch });
  const cons = I.runConsistency(run2.textRuns);
  ok(cons && cons.runs === 3 && cons.all_runs_agree < 1, 'consistency measured across 3 LLM runs: ' + JSON.stringify(cons));
  const ev2 = I.evaluateAutomated(run2, key);
  ok(ev2.every(e => e.FN === 0), 'LLM mode keeps recall 100% (unstable items go to REVIEW)');
  // hallucination guard
  const g = await I.llmCheck('C4', 'Tested by developer in DEV.', { provider: 'ollama', url: 'x', model: 'm' }, async () => ({ ok: true, json: async () => ({ message: { content: '{"label":"ADEQUATE","quote":"UAT passed","reason":"x"}' } }) }));
  ok(g.label === 'UNCLEAR', 'invented quote is downgraded to UNCLEAR');
  // manual evaluation and kappa
  const C2items = run.items.filter(i => i.control === 'C2');
  const keyC2 = new Set(I.evaluateAutomated(run, key) && key.filter(k => k.control === 'C2').map(k => I.normId(k.record_id)));
  const sample = C2items.slice(0, 25).map(i => i.record_id);
  const manual = [];
  for (const p of ['A', 'B']) sample.forEach((rid, n) => manual.push({ Participant: p, Control: 'C2', 'Record ID': rid, Conclusion: keyC2.has(I.normId(rid)) && !(p === 'B' && n % 2) ? 'Exception' : 'No exception', Minutes: 40 }));
  const m = I.evaluateManual(manual, key, pops);
  console.table(m.perf); console.table(m.agreement);
  ok(m.perf.length === 2 && m.agreement.length === 1, 'manual evaluation and kappa computed');
  // round trip of workpaper writer
  const wb = X.writeXlsx([{ name: 'Items', rows: run.items.slice(0, 5).map(i => ({ control: i.control, id: i.record_id, result: i.result })) }]);
  ok(Object.keys(await X.readXlsx(wb)).length === 1, 'workpaper file can be read back');

  // ===== Safeguards added in version 2.1 (each one prevents a false PASS or a data leak) =====
  // Keyword rules: a keyword must start a word, and a negation turns "adequate" into "unclear".
  const k4 = S.controls.C4.text;
  ok(I.keywordCheck('Situation evaluated, closed.', k4).label === 'UNCLEAR', 'keywords: "UAT" inside "sitUATion"/"evalUATion" is not a match (was a false PASS)');
  ok(I.keywordCheck('UAT not performed.', k4).label === 'UNCLEAR' && I.keywordCheck('No UAT done', k4).label === 'UNCLEAR' && I.keywordCheck("UAT wasn't completed", k4).label === 'UNCLEAR', 'keywords: positive word with a negation ("UAT not performed", "No UAT", "wasn\'t") goes to REVIEW');
  ok(I.keywordCheck('UAT passed, sign-off attached.', k4).label === 'ADEQUATE' && I.keywordCheck('Missing bank file, reloaded and rerun.', S.controls.C6.text).label === 'ADEQUATE', 'keywords: genuine positive texts still pass');
  // The AI may not overrule a negative keyword towards PASS (also limits prompt injection).
  const yesMan = async (url, o) => { const t = JSON.parse(o.body).messages[0].content.split('"""')[1]; return { ok: true, json: async () => ({ message: { content: JSON.stringify({ label: 'ADEQUATE', quote: t.slice(0, 6), reason: 'always yes' }) } }) }; };
  const S3 = I.clone(S); S3.ai = { mode: 'llm', provider: 'ollama', url: 'http://localhost:11434', model: 'fake', runs: 1 };
  const run3 = await I.runControls(entities, S3, { fetch: yesMan, controls: ['C4'] });
  const dev = run3.items.find(i => i.attributes.some(a => a.id === 'C' && /Tested by developer/.test(a.detail)));
  ok(dev && dev.result !== 'PASS' && /keyword rules say INADEQUATE/.test(dev.reason + dev.attributes.map(a => a.detail).join()), 'AI saying ADEQUATE to "Tested by developer in DEV" is sent to REVIEW, not passed');
  // Evidence is never sent to a model outside this computer without explicit consent.
  const S4 = I.clone(S3); S4.ai.url = 'https://api.example.com';
  let blocked = false; try { await I.runControls(entities, S4, { fetch: yesMan, controls: ['C4'] }); } catch (e) { blocked = /not on this computer/.test(e.message); }
  ok(blocked && I.isLocalUrl('http://127.0.0.1:11434') && !I.isLocalUrl('https://api.example.com'), 'non-local AI address is refused unless the auditor confirms (allowExternalAI)');
  // An invalid audit period stops the run instead of giving empty populations.
  const S5 = I.clone(S); S5.period.end = '';
  let pErr = null; try { await I.runControls(entities, S5); } catch (e) { pErr = e.message; }
  ok(/period/.test(pErr || '') && I.periodError({ period: { start: '2025-12-31', end: '2025-01-01' } }) && I.dataChecks(entities, S5).some(c => c.Status === 'FAIL' && /period/.test(c.Detail)), 'blank or reversed audit period: run refused, data checks FAIL');
  // Reproducibility: the same files and settings give the same results fingerprint.
  const fpA = await I.resultsFingerprint(run), fpB = await I.resultsFingerprint(await I.runControls(entities, S));
  ok(fpA === fpB && fpA.length === 64, 'results fingerprint is reproducible: ' + fpA.slice(0, 16));
  ok(I.settingsWarnings({ ...S, controls: { ...S.controls, C1: { ...S.controls.C1, authorised_approvers: [] } } }, ['C1']).some(w => /authorised approvers is empty/.test(w)), 'empty approver list is reported as a settings warning');

  // Small hand-made cases for the new rules (P = date helper, R = row with its source data; every
  // field of the evidence type is present and empty unless given, as after the real mapping step).
  const P = s => I.parseDate(s);
  const ALL = Object.fromEntries(Object.values(I.ENTITIES).flatMap(e => Object.keys(e.fields)).map(f => [f, null]));
  const R = (o, row) => ({ ...ALL, ...o, _row: row, _raw: { ...o } });
  const mini = {
    users: [R({ user_id: 'U1', user_type: 'A', lock_flag: '0', created_on: P('2020-01-01'), created_by: 'ADM' }, 2), R({ user_id: 'N1', user_type: 'A', lock_flag: '0', created_on: P('2025-03-01'), created_by: null }, 3),
      R({ user_id: 'N2', user_type: 'A', lock_flag: '0', created_on: P('2025-03-01'), created_by: 'ADM' }, 4), R({ user_id: 'N3', user_type: 'A', lock_flag: '0', created_on: P('2025-04-01'), created_by: 'ADM' }, 5),
      R({ user_id: 'N3', user_type: 'A', lock_flag: '0', created_on: P('2025-05-01'), created_by: 'ADM' }, 6), R({ user_id: 'N4', user_type: null, lock_flag: '0', created_on: P('2025-06-01'), created_by: 'ADM' }, 7),
      R({ user_id: 'FF1', user_type: 'A', lock_flag: '0', created_on: P('2020-01-01'), created_by: 'ADM' }, 8)],
    access_requests: ['N1', 'N2', 'N3', 'N4'].map((u, n) => R({ ticket_id: 'R' + n, user_id: u, approved_by: 'MGR', approved_on: P('2025-02-28'), status: 'APPROVED' }, n + 2)),
    employees: [R({ employee_id: 'E1', user_id: 'U1', termination_date: P('2025-12-30') }, 2)],
    user_profiles: [R({ user_id: 'FF1', profile: 'SAP_ALL' }, 2), R({ user_id: 'FF1', profile: 'SAP_NEW' }, 3)],
    privileged_approved: [R({ user_id: 'FF1', profile: 'SAP_ALL' }, 2)],
    transports: [R({ transport_id: 'T1', owner: 'DEV1', imported_on: P('2025-06-01 10:00'), imported_by: 'OPS', change_id: 'CHG100' }, 2), R({ transport_id: 'T2', owner: 'DEV2', imported_on: P('2025-06-01 10:00'), imported_by: 'OPS', change_id: 'CHG200' }, 3)],
    changes: [R({ change_id: 'CHG100', change_type: 'NORMAL', approver: 'DEV1', approved_on: P('2025-05-30'), post_approved_on: null, test_evidence: 'UAT passed' }, 2), R({ change_id: 'CHG200', change_type: 'EMERGENCY', approver: 'CAB', approved_on: null, post_approved_on: P('2025-06-20'), test_evidence: 'UAT passed' }, 3)],
  };
  const SM = I.clone(S); SM.controls.C1.authorised_approvers = ['MGR'];
  const rm = await I.runControls(mini, SM, { controls: ['C1', 'C2', 'C3', 'C4', 'C5'] });
  const res = (c, id) => rm.items.find(i => i.control === c && i.record_id === id);
  const attr = (c, id, a) => res(c, id)?.attributes.find(x => x.id === a)?.result;
  ok(attr('C2', 'U1', 'B') === 'REVIEW', 'C2: leaver within the allowed days at period end and still active → REVIEW (was PASS)');
  ok(attr('C1', 'N1', 'C') === 'REVIEW' && attr('C1', 'N2', 'C') === 'PASS', 'C1: creator empty → independence cannot be confirmed → REVIEW');
  ok(res('C1', 'N3')?.result === 'REVIEW' && /source rows 5, 6/.test(res('C1', 'N3').reason), 'duplicates with different content → REVIEW with both source rows');
  ok(!!res('C1', 'N4') && rm.derivation.C1.steps.some(s => /without a user type kept/.test(s.step)), 'user without a user type stays in the population (not silently excluded)');
  ok(attr('C3', 'FF1', 'A') === 'REVIEW', 'C3: approved for SAP_ALL only but also holds SAP_NEW → REVIEW');
  ok(attr('C4', 'T1', 'B') === 'EXCEPTION' && /also the developer/.test(res('C4', 'T1').reason), 'C4: change approved by its own developer → EXCEPTION');
  ok(attr('C4', 'T2', 'B') === 'EXCEPTION' && /19 day\(s\) after import; allowed 5/.test(res('C4', 'T2').reason), 'C4: emergency post-approval after more than the allowed days → EXCEPTION');
  // Nothing testable → NOT TESTED, never PASS (C5 without the owner and importer fields).
  const noOwner = { transports: mini.transports.map(t => ({ ...t, owner: null, imported_by: null })) };
  const rn = await I.runControls(noOwner, S, { controls: ['C5'] });
  ok(rn.items.length === 2 && rn.items.every(i => i.result === 'NOT TESTED'), 'item where no attribute could be tested → NOT TESTED (was PASS)');
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
