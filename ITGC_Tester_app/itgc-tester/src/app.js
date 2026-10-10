/* app.js - user interface. Uses XLSX_LITE (files) and ITGC (testing logic). */
(() => {
  const $ = s => document.querySelector(s);
  const h = (tag, a = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(a || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else if (k === 'value') e.value = v; else if (k === 'checked') e.checked = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return e;
  };
  const chip = s => h('span', { class: 'chip ' + s }, s);
  const pct = v => v === null || v === undefined ? '–' : (v * 100).toFixed(1) + '%';
  const num = v => v === null || v === undefined ? '–' : (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : v);
  const store = { get(k, d) { try { const v = localStorage.getItem('itgc.' + k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem('itgc.' + k, JSON.stringify(v)); } catch { } } };
  const download = (name, bytes, type) => { const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type })), download: name }); document.body.append(a); a.click(); a.remove(); };
  const XTYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const today = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

  const state = {
    step: 1, files: [], sheets: {}, settings: store.get('settings', null) || ITGC.clone(ITGC.DEFAULT_SETTINGS),
    entities: null, mapIssues: [], checks: null, run: null, decisions: {}, auditor: store.get('auditor', ''), evalAuto: null, evalManual: null, key: null, manual: null,
  };
  // keep any newly added default fields when an older saved settings object is loaded
  const merge = (d, s) => { if (typeof d !== 'object' || d === null || Array.isArray(d)) return s === undefined ? d : s; const o = { ...d }; for (const k of Object.keys(s || {})) o[k] = merge(d[k], s[k]); return o; };
  state.settings = merge(ITGC.DEFAULT_SETTINGS, state.settings);
  const saveSettings = () => store.set('settings', state.settings);

  const STEPS = [[1, 'Load evidence'], [2, 'Map & check data'], [3, 'Settings'], [4, 'Run tests'], [5, 'Review & export'], [6, 'Evaluate']];
  function renderNav() {
    const nav = $('nav'); nav.replaceChildren();
    const done = { 1: state.files.length > 0, 2: !!state.checks, 3: true, 4: !!state.run, 5: !!state.run && Object.keys(state.decisions).length > 0, 6: !!state.evalAuto };
    for (const [n, t] of STEPS) nav.append(h('button', { class: (state.step === n ? 'active ' : '') + (done[n] && state.step !== n ? 'done' : ''), onclick: () => go(n) }, h('span', { class: 'n' }, done[n] && state.step !== n ? '✓' : n), t));
  }
  function go(n) { state.step = n; renderNav(); const m = $('main'); m.replaceChildren(); ({ 1: viewLoad, 2: viewMap, 3: viewSettings, 4: viewRun, 5: viewReview, 6: viewEval })[n](m); window.scrollTo(0, 0); }
  const nextBtn = (n, label) => h('button', { class: 'btn', onclick: () => go(n) }, label + ' →');

  // ---------- Step 1: load ----------
  async function loadFiles(fileList) {
    const errors = [];
    for (const f of fileList) {
      try {
        const buf = await f.arrayBuffer();
        const sheets = await XLSX_LITE.readFile(f.name, buf);
        const hash = await ITGC.sha256(buf);
        state.files = state.files.filter(x => x.name !== f.name);
        state.files.push({ name: f.name, size: f.size, sha256: hash, sheets: Object.fromEntries(Object.entries(sheets).map(([k, v]) => [k, v.length])) });
        Object.assign(state.sheets, sheets);
      } catch (e) { errors.push(`${f.name}: ${e.message}`); }
    }
    state.entities = null; state.checks = null; state.run = null;
    go(1);
    if (errors.length) $('main').prepend(h('div', { class: 'msg err' }, 'Could not read: ' + errors.join('; ')));
  }
  function viewLoad(m) {
    m.append(h('h2', {}, 'Load evidence'),
      h('p', { class: 'lead' }, 'Add the evidence extracts for the audit period: Excel (.xlsx) or CSV files, one or several. Files are processed only inside this browser window – nothing is uploaded anywhere.'));
    const input = h('input', { type: 'file', multiple: true, accept: '.xlsx,.csv,.txt', style: 'display:none', onchange: e => loadFiles(e.target.files) });
    const drop = h('div', { class: 'drop' }, h('p', {}, 'Drag files here, or'), h('button', { class: 'btn', onclick: () => input.click() }, 'Choose files'), input);
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); loadFiles(e.dataTransfer.files); });
    const card = h('div', { class: 'card' }, drop);
    if (window.DEMO_XLSX_B64) card.append(h('p', { class: 'small muted', style: 'margin:10px 0 0' }, 'No data at hand? ', h('a', { href: '#', onclick: async e => { e.preventDefault(); const b = Uint8Array.from(atob(window.DEMO_XLSX_B64), c => c.charCodeAt(0)); await loadFiles([new File([b], 'ITGC_synthetic_evidence_FY2025.xlsx')]); } }, 'Load the synthetic demo dataset (FY 2025)'), '.'));
    m.append(card);
    if (state.files.length) {
      const t = h('table', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Sheets (rows)'), h('th', {}, 'SHA-256 fingerprint')));
      for (const f of state.files) t.append(h('tr', {}, h('td', {}, f.name), h('td', {}, Object.entries(f.sheets).map(([k, v]) => `${k} (${v})`).join(', ')), h('td', { class: 'small muted' }, f.sha256.slice(0, 16) + '…')));
      m.append(h('div', { class: 'card' }, h('h3', {}, 'Loaded files'), t, h('div', { class: 'row', style: 'margin-top:12px' }, nextBtn(2, 'Map & check data'), h('button', { class: 'btn secondary', onclick: () => { state.files = []; state.sheets = {}; state.run = null; state.checks = null; go(1); } }, 'Clear all'))));
    }
    m.append(h('div', { class: 'card' }, h('h3', {}, 'Auditor'), h('div', { class: 'field', style: 'max-width:320px' }, h('label', {}, 'Your name or initials (recorded in the run log)'), h('input', { type: 'text', value: state.auditor, oninput: e => { state.auditor = e.target.value; store.set('auditor', state.auditor); } }))));
  }

  // ---------- Step 2: mapping and data checks ----------
  function doMap() {
    const r = ITGC.mapEntities(state.sheets, state.settings);
    state.entities = r.entities; state.mapIssues = r.issues; state.checks = ITGC.dataChecks(r.entities, state.settings); state.run = null;
  }
  function viewMap(m) {
    m.append(h('h2', {}, 'Map & check data'), h('p', { class: 'lead' }, 'Tell the tool where each type of evidence is (sheet) and which column holds each field. The defaults match standard SAP extracts. Then review the completeness and accuracy checks before testing.'));
    if (!state.files.length) { m.append(h('div', { class: 'msg warn' }, 'Load evidence first (step 1).')); return; }
    if (!state.checks) doMap();
    const sheetNames = Object.keys(state.sheets);
    const wrap = h('div', { class: 'card' }, h('h3', {}, 'Column mapping'));
    for (const [ent, fields] of Object.entries(ITGC.ENTITY_FIELDS)) {
      const mp = state.settings.mapping[ent];
      const sheetCols = state.sheets[sheetNames.find(s => s.toUpperCase() === (mp.sheet || '').toUpperCase())]?.[0];
      const cols = sheetCols ? Object.keys(sheetCols) : [];
      const sel = h('select', { onchange: e => { mp.sheet = e.target.value; saveSettings(); state.checks = null; go(2); } }, h('option', { value: '' }, '– not available –'), ...sheetNames.map(s => h('option', { value: s, selected: s.toUpperCase() === (mp.sheet || '').toUpperCase() || null }, s)));
      const det = h('details', {}, h('summary', {}, `${ITGC.ENTITY_LABELS[ent]} → ${mp.sheet || 'not mapped'}${sheetCols ? '' : ' (sheet not loaded)'}`));
      const g = h('div', { class: 'row', style: 'margin:8px 0 4px' }, h('div', { class: 'field' }, h('label', {}, 'Sheet / file'), sel));
      for (const f of Object.keys(fields)) g.append(h('div', { class: 'field' }, h('label', {}, f), cols.length ? h('select', { onchange: e => { mp.fields[f] = e.target.value; saveSettings(); state.checks = null; } }, h('option', { value: '' }, '– none –'), ...cols.map(c => h('option', { value: c, selected: c.toUpperCase() === String(mp.fields[f] || '').toUpperCase() || null }, c))) : h('input', { type: 'text', value: mp.fields[f] || '', onchange: e => { mp.fields[f] = e.target.value; saveSettings(); state.checks = null; } })));
      det.append(g); wrap.append(det);
    }
    wrap.append(h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn secondary', onclick: () => { doMap(); go(2); } }, 'Re-run data checks')));
    m.append(wrap);
    if (state.mapIssues.filter(i => i.level !== 'info').length) m.append(...state.mapIssues.filter(i => i.level !== 'info').map(i => h('div', { class: 'msg warn' }, i.text)));
    const t = h('table', {}, h('tr', {}, h('th', {}, 'Evidence'), h('th', {}, 'Check'), h('th', {}, 'Status'), h('th', {}, 'Detail')));
    for (const c of state.checks) t.append(h('tr', {}, h('td', {}, c.Evidence), h('td', {}, c.Check), h('td', {}, chip(c.Status)), h('td', {}, c.Detail)));
    m.append(h('div', { class: 'card' }, h('h3', {}, 'Completeness and accuracy checks'), h('p', { class: 'small muted' }, 'The evidence is information produced by the entity (IPE). Investigate every WARNING before relying on the test results; reconcile record counts to the system where possible.'), h('div', { class: 'scroll' }, t)), h('div', { class: 'row' }, nextBtn(3, 'Settings'), nextBtn(4, 'Run tests')));
  }

  // ---------- Step 3: settings ----------
  const listIn = (obj, key, label) => h('div', { class: 'field' }, h('label', {}, label + ' (comma separated)'), h('input', { type: 'text', value: (obj[key] || []).join(', '), onchange: e => { obj[key] = e.target.value.split(',').map(x => x.trim()).filter(Boolean); saveSettings(); state.run = null; } }));
  const numIn = (obj, key, label) => h('div', { class: 'field', style: 'max-width:200px' }, h('label', {}, label), h('input', { type: 'number', value: obj[key], onchange: e => { obj[key] = +e.target.value; saveSettings(); state.run = null; } }));
  const txtIn = (obj, key, label, type = 'text') => h('div', { class: 'field' }, h('label', {}, label), h('input', { type, value: obj[key] || '', onchange: e => { obj[key] = e.target.value; saveSettings(); state.run = null; } }));
  function viewSettings(m) {
    const S = state.settings, C = S.controls;
    m.append(h('h2', {}, 'Settings'), h('p', { class: 'lead' }, 'Parameters of each control test. Change them to match the control description of the audited company. Settings are remembered in this browser and can be saved to a file for the audit documentation.'));
    m.append(h('div', { class: 'card' }, h('h3', {}, 'Audit period'), h('div', { class: 'row' }, h('div', { class: 'field', style: 'max-width:200px' }, h('label', {}, 'From'), h('input', { type: 'date', value: S.period.start, onchange: e => { S.period.start = e.target.value; saveSettings(); state.checks = null; state.run = null; } })), h('div', { class: 'field', style: 'max-width:200px' }, h('label', {}, 'To'), h('input', { type: 'date', value: S.period.end, onchange: e => { S.period.end = e.target.value; saveSettings(); state.checks = null; state.run = null; } })))));
    const card = h('div', { class: 'card' }, h('h3', {}, 'Controls'));
    const head = (id) => h('h4', {}, h('input', { type: 'checkbox', checked: C[id].enabled !== false, onchange: e => { C[id].enabled = e.target.checked; saveSettings(); state.run = null; } }), `${id} – ${C[id].name}`);
    card.append(
      h('div', { class: 'ctl' }, head('C1'), h('div', { class: 'row' }, listIn(C.C1, 'authorised_approvers', 'Authorised approvers (empty = anyone except the creator)'), listIn(C.C1, 'approved_status', 'Ticket status meaning "approved"'), listIn(C.C1, 'user_types', 'User types in scope (A = dialog)'))),
      h('div', { class: 'ctl' }, head('C2'), h('div', { class: 'row' }, numIn(C.C2, 'max_days', 'Maximum days from termination to lock'))),
      h('div', { class: 'ctl' }, head('C3'), h('div', { class: 'row' }, listIn(C.C3, 'privileged_profiles', 'Privileged profiles'), listIn(C.C3, 'user_types', 'User types in scope'))),
      h('div', { class: 'ctl' }, head('C4'), h('div', { class: 'row' }, listIn(C.C4, 'emergency_types', 'Change types that are emergency changes'), listIn(C.C4.text, 'positive', 'Words that show business testing'), listIn(C.C4.text, 'negative', 'Words that show missing testing'))),
      h('div', { class: 'ctl' }, head('C5'), h('p', { class: 'small muted' }, 'No parameters: the transport owner must differ from the user who imported it.')),
      h('div', { class: 'ctl' }, head('C6'), h('div', { class: 'row' }, listIn(C.C6, 'failed_status', 'Job status meaning failed'), listIn(C.C6, 'closed_status', 'Incident status meaning resolved'), listIn(C.C6.text, 'positive', 'Words that show a real fix'), listIn(C.C6.text, 'negative', 'Words that show no real fix'))));
    m.append(card);
    const ai = S.ai, aiBox = h('div', {});
    const drawAi = () => {
      aiBox.replaceChildren(h('div', { class: 'row' }, h('div', { class: 'field', style: 'max-width:340px' }, h('label', {}, 'How to assess free text (test evidence, incident resolutions)'), h('select', { onchange: e => { ai.mode = e.target.value; saveSettings(); state.run = null; drawAi(); } }, h('option', { value: 'keywords', selected: ai.mode === 'keywords' || null }, 'Keyword rules (no AI)'), h('option', { value: 'llm', selected: ai.mode === 'llm' || null }, 'Language model (AI)')))));
      if (ai.mode === 'llm') {
        const res = h('span', { class: 'small' });
        aiBox.append(h('div', { class: 'row', style: 'margin-top:8px' },
          h('div', { class: 'field', style: 'max-width:220px' }, h('label', {}, 'Provider'), h('select', { onchange: e => { ai.provider = e.target.value; saveSettings(); } }, h('option', { value: 'ollama', selected: ai.provider === 'ollama' || null }, 'Ollama (local)'), h('option', { value: 'openai', selected: ai.provider === 'openai' || null }, 'OpenAI-compatible API'))),
          txtIn(ai, 'url', 'Address'), txtIn(ai, 'model', 'Model name'), txtIn(ai, 'api_key', 'API key (if needed)', 'password'), numIn(ai, 'runs', 'Repeat each check (runs)')),
          h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn secondary', onclick: async () => { res.textContent = 'Testing…'; const r = await ITGC.llmCheck('C4', 'UAT passed, sign-off by key user attached.', ai); res.textContent = r.source === 'llm-error' ? '✗ ' + r.reason : `✓ Model answered: ${r.label} – ${r.reason}`; } }, 'Test connection'), res),
          h('div', { class: 'msg warn small' }, 'Confidentiality: with a cloud API the ticket texts leave your computer. Use a local model (Ollama) for real client data, or only use synthetic data. With Ollama, start it with the environment variable OLLAMA_ORIGINS=* so this page may call it (see the guide).'));
      }
    };
    drawAi();
    m.append(h('div', { class: 'card' }, h('h3', {}, 'Free-text assessment'), aiBox));
    const fin = h('input', { type: 'file', accept: '.json', style: 'display:none', onchange: async e => { try { state.settings = merge(ITGC.DEFAULT_SETTINGS, JSON.parse(await e.target.files[0].text())); saveSettings(); state.checks = null; state.run = null; go(3); } catch (err) { alert('Not a valid settings file: ' + err.message); } } });
    m.append(h('div', { class: 'card' }, h('h3', {}, 'Settings file'), h('div', { class: 'row' },
      h('button', { class: 'btn secondary', onclick: () => { const s = ITGC.clone(state.settings); s.ai.api_key = ''; download('itgc_settings.json', JSON.stringify(s, null, 2), 'application/json'); } }, 'Save settings to file'),
      h('button', { class: 'btn secondary', onclick: () => fin.click() }, 'Load settings from file'), fin,
      h('button', { class: 'btn secondary', onclick: () => { if (confirm('Reset all settings and mappings to the defaults?')) { state.settings = ITGC.clone(ITGC.DEFAULT_SETTINGS); saveSettings(); state.checks = null; state.run = null; go(3); } } }, 'Reset to defaults'))), h('div', { class: 'row' }, nextBtn(4, 'Run tests')));
  }

  // ---------- Step 4: run ----------
  async function doRun(m) {
    if (!state.checks) doMap();
    const bar = h('div'), prog = h('div', { class: 'progress' }, bar), msg = h('p', { class: 'small muted' }, 'Running…');
    m.append(h('div', { class: 'card' }, msg, prog));
    const t0 = performance.now();
    const run = await ITGC.runControls(state.entities, state.settings, { progress: (a, b) => { bar.style.width = (100 * a / b) + '%'; msg.textContent = `Assessing free text ${a} / ${b}…`; } });
    run.seconds = (performance.now() - t0) / 1000;
    run.id = 'run-' + Date.now();
    run.started = today();
    run.consistency = ITGC.runConsistency(run.textRuns);
    const cnt = r => run.items.filter(i => i.result === r).length;
    const settingsHash = await ITGC.sha256(new TextEncoder().encode(JSON.stringify({ ...state.settings, ai: { ...state.settings.ai, api_key: '' } })));
    run.log = { 'Run ID': run.id, Timestamp: run.started, Auditor: state.auditor || '(not entered)', 'Tool version': ITGC.VERSION, 'Settings fingerprint': settingsHash.slice(0, 16), 'Period': state.settings.period.start + ' to ' + state.settings.period.end, 'Text assessment': state.settings.ai.mode === 'llm' ? `LLM ${state.settings.ai.provider} / ${state.settings.ai.model} x${state.settings.ai.runs}` : 'Keyword rules', 'Input files': state.files.map(f => `${f.name} [sha256 ${f.sha256}]`).join('; '), 'Items tested': run.items.length, Exceptions: cnt('EXCEPTION'), 'Requires review': cnt('REVIEW'), 'Run time (s)': +run.seconds.toFixed(2) };
    const logs = store.get('runlog', []); logs.push(run.log); store.set('runlog', logs.slice(-200));
    state.run = run; state.decisions = store.get('decisions.' + run.id, {});
    go(4);
  }
  function viewRun(m) {
    m.append(h('h2', {}, 'Run tests'), h('p', { class: 'lead' }, 'The tool tests the whole population of each enabled control. Every item gets PASS, EXCEPTION (a rule is clearly broken) or REVIEW (the evidence needs your judgement).'));
    if (!state.files.length) { m.append(h('div', { class: 'msg warn' }, 'Load evidence first (step 1).')); return; }
    m.append(h('div', { class: 'row', style: 'margin-bottom:16px' }, h('button', { class: 'btn', onclick: () => doRun(m) }, state.run ? 'Run again' : 'Run tests')));
    const r = state.run; if (!r) return;
    for (const s of r.skipped) m.append(h('div', { class: 'msg warn' }, `${s.control} not run – ${s.reason}`));
    const g = h('div', { class: 'grid' });
    for (const c of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) {
      const its = r.items.filter(i => i.control === c); if (!its.length) continue;
      const n = x => its.filter(i => i.result === x).length;
      g.append(h('div', { class: 'stat' }, h('div', { class: 't' }, `${c} – ${state.settings.controls[c].name}`), h('div', { class: 'small muted' }, `Population ${its.length} · coverage 100%`), h('div', { class: 'v' }, h('span', { class: 'chip EXCEPTION' }, n('EXCEPTION') + ' exceptions'), h('span', { class: 'chip REVIEW' }, n('REVIEW') + ' review'), h('span', { class: 'chip PASS' }, n('PASS') + ' pass'))));
    }
    m.append(g);
    const info = h('div', { class: 'card', style: 'margin-top:16px' }, h('h3', {}, 'Run log entry'), h('table', {}, ...Object.entries(r.log).map(([k, v]) => h('tr', {}, h('th', { style: 'width:200px;position:static' }, k), h('td', { class: 'small' }, String(v))))));
    if (r.consistency) info.append(h('p', {}, `AI consistency over ${r.consistency.runs} runs on ${r.consistency.items} texts: all runs agree on ${pct(r.consistency.all_runs_agree)} of texts; mean pairwise agreement ${pct(r.consistency.mean_pairwise_agreement)}; mean Cohen’s kappa ${num(r.consistency.mean_pairwise_kappa)}. Items where runs disagree are set to REVIEW.`));
    m.append(info, h('div', { class: 'row' }, nextBtn(5, 'Review & export')));
  }

  // ---------- Step 5: review and export ----------
  const DECISIONS = ['', 'Confirmed exception', 'Not an exception', 'More information needed'];
  function viewReview(m) {
    m.append(h('h2', {}, 'Review & export'), h('p', { class: 'lead' }, 'Evaluate every EXCEPTION and REVIEW item and record your decision. The tool result is kept unchanged next to your decision. Export the workpaper for the audit file.'));
    const r = state.run; if (!r) { m.append(h('div', { class: 'msg warn' }, 'Run the tests first (step 4).')); return; }
    const f = store.get('reviewFilter', { control: '', result: 'flagged', q: '' });
    const body = h('tbody');
    const draw = () => {
      store.set('reviewFilter', f); body.replaceChildren();
      const rows = r.items.filter(i => (!f.control || i.control === f.control) && (f.result === 'all' || (f.result === 'flagged' ? i.result !== 'PASS' : i.result === f.result)) && (!f.q || (i.record_id + ' ' + i.description + ' ' + i.reason).toLowerCase().includes(f.q.toLowerCase())));
      count.textContent = `${rows.length} item(s)`;
      for (const i of rows.slice(0, 1000)) {
        const k = i.control + '|' + i.record_id, d = state.decisions[k] || { decision: '', comment: '' };
        const save = () => { state.decisions[k] = d; store.set('decisions.' + r.id, state.decisions); renderNav(); };
        body.append(h('tr', {}, h('td', {}, i.control), h('td', {}, i.record_id), h('td', {}, chip(i.result)),
          h('td', {}, h('div', {}, i.description), h('details', {}, h('summary', { class: 'small' }, i.result === 'PASS' ? 'attributes' : (i.reason.length > 110 ? i.reason.slice(0, 110) + '…' : i.reason)), ...i.attributes.map(a => h('div', { class: 'attr' }, chip(a.result), ' ', h('b', {}, a.name), ': ', a.detail)))),
          h('td', {}, i.result === 'PASS' ? '' : h('select', { onchange: e => { d.decision = e.target.value; save(); } }, ...DECISIONS.map(x => h('option', { value: x, selected: d.decision === x || null }, x || '– decide –')))),
          h('td', {}, i.result === 'PASS' ? '' : h('textarea', { onchange: e => { d.comment = e.target.value; save(); } }, d.comment))));
      }
      if (rows.length > 1000) body.append(h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'First 1000 shown; use the filters or the export for the rest.')));
    };
    const count = h('span', { class: 'small muted' });
    m.append(h('div', { class: 'card' }, h('div', { class: 'row' },
      h('div', { class: 'field', style: 'max-width:160px' }, h('label', {}, 'Control'), h('select', { onchange: e => { f.control = e.target.value; draw(); } }, h('option', { value: '' }, 'All'), ...['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map(c => h('option', { value: c, selected: f.control === c || null }, c)))),
      h('div', { class: 'field', style: 'max-width:200px' }, h('label', {}, 'Result'), h('select', { onchange: e => { f.result = e.target.value; draw(); } }, ...[['flagged', 'Exceptions + review'], ['EXCEPTION', 'Exceptions'], ['REVIEW', 'Review'], ['PASS', 'Pass'], ['all', 'All items']].map(([v, t]) => h('option', { value: v, selected: f.result === v || null }, t)))),
      h('div', { class: 'field' }, h('label', {}, 'Search'), h('input', { type: 'text', value: f.q, oninput: e => { f.q = e.target.value; draw(); } })), count),
      h('div', { class: 'scroll', style: 'margin-top:12px' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Control', 'Record', 'Result', 'Description and attributes', 'Auditor decision', 'Comment'].map(x => h('th', {}, x)))), body))));
    draw();
    m.append(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: exportWorkpaper }, 'Export workpaper (.xlsx)'), nextBtn(6, 'Evaluate')));
  }
  function exportWorkpaper() {
    const r = state.run, S = state.settings, dec = state.decisions;
    const summary = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].filter(c => r.populations[c]).map(c => { const its = r.items.filter(i => i.control === c), n = x => its.filter(i => i.result === x).length, flagged = its.filter(i => i.result !== 'PASS'); return { Control: c, Description: S.controls[c].name, Population: its.length, 'Coverage': '100%', Pass: n('PASS'), Exceptions: n('EXCEPTION'), 'Requires review': n('REVIEW'), 'Auditor: confirmed exceptions': flagged.filter(i => dec[c + '|' + i.record_id]?.decision === 'Confirmed exception').length, 'Auditor: not exceptions': flagged.filter(i => dec[c + '|' + i.record_id]?.decision === 'Not an exception').length, 'Not yet decided': flagged.filter(i => !dec[c + '|' + i.record_id]?.decision).length }; });
    const flaggedRows = r.items.filter(i => i.result !== 'PASS').map(i => ({ Control: i.control, 'Record ID': i.record_id, 'Tool result': i.result, Description: i.description, Reason: i.reason, 'Auditor decision': dec[i.control + '|' + i.record_id]?.decision || '', 'Auditor comment': dec[i.control + '|' + i.record_id]?.comment || '' }));
    const all = r.items.map(i => ({ Control: i.control, 'Record ID': i.record_id, 'Tool result': i.result, Description: i.description }));
    const attrs = r.items.flatMap(i => i.attributes.map(a => ({ Control: i.control, 'Record ID': i.record_id, Attribute: a.name, Result: a.result, Detail: a.detail })));
    const params = [{ Setting: 'Period', Value: S.period.start + ' to ' + S.period.end }, ...Object.entries(S.controls).map(([c, v]) => ({ Setting: c, Value: JSON.stringify(v) })), { Setting: 'Free-text assessment', Value: JSON.stringify({ ...S.ai, api_key: S.ai.api_key ? '(set)' : '' }) }, { Setting: 'Mapping', Value: JSON.stringify(S.mapping) }];
    const bytes = XLSX_LITE.writeXlsx([
      { name: 'Summary', rows: summary }, { name: 'Exceptions_for_review', rows: flaggedRows }, { name: 'All_items', rows: all }, { name: 'Attribute_results', rows: attrs },
      { name: 'Data_checks', rows: state.checks || [] }, { name: 'Parameters', rows: params }, { name: 'Run_log', rows: [r.log] },
      ...(r.consistency ? [{ name: 'AI_consistency', rows: [r.consistency, ...r.textRuns.map(t => ({ control: t.control, record_id: t.record_id, text: t.text, labels: t.labels.join(' / ') }))] }] : []),
    ]);
    download(`ITGC_workpaper_${r.started.slice(0, 10)}.xlsx`, bytes, XTYPE);
  }

  // ---------- Step 6: evaluation ----------
  function viewEval(m) {
    m.append(h('h2', {}, 'Evaluate'), h('p', { class: 'lead' }, 'For the experiment: compare the tool and the manual testers with the answer key (seeded deviations). Precision = share of flagged items that are real deviations; recall = share of real deviations that were found.'));
    const r = state.run; if (!r) { m.append(h('div', { class: 'msg warn' }, 'Run the tests first (step 4).')); return; }
    const readOne = async (file) => Object.values(await XLSX_LITE.readFile(file.name, await file.arrayBuffer()))[0];
    const strict = h('input', { type: 'checkbox', checked: !!state.evalStrict, onchange: e => { state.evalStrict = e.target.checked; if (state.key) state.evalAuto = ITGC.evaluateAutomated(r, state.key, state.evalStrict); go(6); } });
    const kin = h('input', { type: 'file', accept: '.xlsx,.csv', style: 'display:none', onchange: async e => { state.key = await readOne(e.target.files[0]); state.evalAuto = ITGC.evaluateAutomated(r, state.key, state.evalStrict); if (state.manual) state.evalManual = ITGC.evaluateManual(state.manual, state.key, r.populations); go(6); } });
    const min = h('input', { type: 'file', accept: '.xlsx,.csv', style: 'display:none', onchange: async e => { state.manual = await readOne(e.target.files[0]); if (state.key) state.evalManual = ITGC.evaluateManual(state.manual, state.key, r.populations); go(6); } });
    const tbl = (rows, fmt = {}) => { if (!rows?.length) return h('p', { class: 'muted' }, 'No rows.'); const cols = Object.keys(rows[0]); return h('div', { class: 'scroll' }, h('table', {}, h('tr', {}, ...cols.map(c => h('th', {}, c))), ...rows.map(x => h('tr', {}, ...cols.map(c => h('td', {}, fmt[c] ? fmt[c](x[c]) : num(x[c]))))))); };
    const P = { Precision: pct, Recall: pct, F1: pct, Coverage: pct, 'Sample precision': pct, 'Sample recall': pct, 'Population recall': pct, 'Percent agreement': pct };
    m.append(h('div', { class: 'card' }, h('h3', {}, '1. Answer key'), h('p', { class: 'small muted' }, 'A file with one row per real deviation and the columns control and record_id.'), h('div', { class: 'row' }, h('button', { class: 'btn secondary', onclick: () => kin.click() }, state.key ? 'Load a different answer key' : 'Load answer key'), kin, h('label', { style: 'display:flex;gap:6px;align-items:center;margin:0' }, strict, 'Strict: count only EXCEPTION as flagged (REVIEW counted as not flagged)')),
      state.evalAuto ? h('div', { style: 'margin-top:12px' }, h('h3', {}, 'Automated test vs answer key'), tbl(state.evalAuto, P)) : ''));
    const tmpl = () => { const rows = []; for (const c of ['C1', 'C2']) for (let k = 0; k < 2; k++) rows.push({ Participant: 'P1', Control: c, 'Record ID': '', Conclusion: 'Exception / No exception', Minutes: '' }); download('manual_results_template.xlsx', XLSX_LITE.writeXlsx([{ name: 'Manual_results', rows }, { name: 'Instructions', rows: [{ Instruction: 'One row per tested item. Participant = code (P1, P2...). Control = C1..C6. Record ID = user ID, transport or job count exactly as in the evidence. Conclusion = Exception or No exception. Minutes = total time spent on that control (repeat on each row or fill once).' }] }]), XTYPE); };
    m.append(h('div', { class: 'card' }, h('h3', {}, '2. Manual testing results'), h('p', { class: 'small muted' }, 'Collect the participants’ results in the template (one row per tested item), then load it here. Requires the answer key.'), h('div', { class: 'row' }, h('button', { class: 'btn secondary', onclick: tmpl }, 'Download template'), h('button', { class: 'btn secondary', disabled: !state.key || null, onclick: () => min.click() }, 'Load manual results'), min),
      state.evalManual ? h('div', { style: 'margin-top:12px' }, h('h3', {}, 'Manual testing vs answer key'), tbl(state.evalManual.perf, P), h('h3', { style: 'margin-top:14px' }, 'Agreement between participants (items tested by both)'), tbl(state.evalManual.agreement, P)) : ''));
    if (state.evalAuto) m.append(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => download('ITGC_evaluation.xlsx', XLSX_LITE.writeXlsx([{ name: 'Automated', rows: state.evalAuto }, ...(state.evalManual ? [{ name: 'Manual', rows: state.evalManual.perf }, { name: 'Agreement', rows: state.evalManual.agreement }] : []), ...(r.consistency ? [{ name: 'AI_consistency', rows: [r.consistency] }] : []), { name: 'Run_log', rows: [r.log] }]), XTYPE) }, 'Export evaluation (.xlsx)')));
    m.append(h('div', { class: 'card' }, h('h3', {}, 'Run history (this browser)'), tbl(store.get('runlog', []).slice().reverse()), h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn secondary', onclick: () => download('ITGC_run_log.xlsx', XLSX_LITE.writeXlsx([{ name: 'Run_log', rows: store.get('runlog', []) }]), XTYPE) }, 'Export run history'))));
  }

  document.addEventListener('DOMContentLoaded', () => { $('#ver').textContent = 'v' + ITGC.VERSION; go(1); });
})();
