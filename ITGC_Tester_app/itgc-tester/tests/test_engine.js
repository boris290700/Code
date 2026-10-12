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
  const S2 = I.clone(S); S2.ai = { mode: 'llm', provider: 'ollama', url: 'http://fake', model: 'fake', runs: 3 };
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
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
