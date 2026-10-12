/* app.js - user interface. Uses XLSX_LITE (files), ITGC (testing logic) and WORKPAPER (Excel workpapers). */
// HOW TO READ THIS FILE (for non-programmers)
// This file is the user interface: the seven steps on the left and the screens you click
// through. It contains no audit rules – those are in engine.js. Each step has a "view..."
// function that draws its screen; buttons call small functions that update "state" (what has
// been loaded, mapped, run and decided so far) and then redraw the screen.
// Steps: 1 Scope → 2 Load evidence → 3 Map & check data → 4 Settings → 5 Run tests →
//        6 Review & export → 7 Evaluate.
// Every screen has the same parts: a heading, a "How this step works" box in plain language,
// the content cards, and a Back / Next bar at the bottom.
// Everything runs inside the browser; no file is ever sent anywhere.
(() => {
  // Helpers for building the screen: "$" finds an element on the page, "h" creates one (a button, a table cell...).
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
  // Small line icons (drawn as SVG, so they need no image files and work offline).
  const ICONS = {
    check: '<polyline points="20 6 9 17 4 12"/>', x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>', help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    play: '<polygon points="6 4 20 12 6 20 6 4"/>', lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.2 4.2 7 7M17 17l2.8 2.8M1 12h4M19 12h4M4.2 19.8 7 17M17 7l2.8-2.8"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>', table: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
    sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><polyline points="9 14 11 16 15 12"/>',
    chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    star: '<polygon points="12 2 15 9 22 9 16.5 13.5 18.5 21 12 16.5 5.5 21 7.5 13.5 2 9 9 9 12 2"/>',
    right: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>', left: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"/><path d="M6.5 17A2.5 2.5 0 0 0 4 19.5 2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  };
  const ico = name => { const s = document.createElement('span'); s.className = 'ico'; s.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`; return s; };
  // A small "?" that explains a term when the mouse rests on it.
  const tip = text => h('span', { class: 'tip', 'data-tip': text }, '?');
  // Coloured status labels. The text stays the audit term (e.g. WARNING); the icon and the
  // tooltip explain it in plain words.
  const STATUS = { OK: ['check', 'Everything is fine.'], PASS: ['check', 'The rule is met.'], INFO: ['info', 'For your information – no action needed.'], WARNING: ['alert', 'Please look at this before relying on the results.'], REVIEW: ['help', 'The evidence is unclear – you need to judge this item.'], EXCEPTION: ['x', 'A rule is clearly broken.'], FAIL: ['x', 'This check failed.'], MISSING: ['x', 'Required evidence is missing.'], 'NOT TESTED': ['info', 'The field needed is not in the files – test this attribute manually.'], 'N/A': ['info', 'Not applicable.'] };
  const chip = s => h('span', { class: 'chip ' + s.replace(/[^A-Z]/gi, ''), title: STATUS[s]?.[1] || '' }, STATUS[s] ? ico(STATUS[s][0]) : null, s);
  // Tickmarks per attribute, as in an audit testing table.
  const TICK = { PASS: '✓', EXCEPTION: 'X', REVIEW: '?', 'N/A': 'N/A', 'NOT TESTED': 'N/T' };
  const tick = r => h('span', { class: 'tick ' + r.replace(/[^A-Z]/gi, ''), title: r }, TICK[r] || r);
  // Number formatting: percentages and decimals for the evaluation tables.
  const pct = v => v === null || v === undefined ? '–' : (v * 100).toFixed(1) + '%';
  const num = v => v === null || v === undefined ? '–' : (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : v);
  // "store" remembers things in this browser (settings, decisions, run history) so they survive
  // closing the page. It is the browser's own local storage – nothing leaves the computer.
  const store = { get(k, d) { try { const v = localStorage.getItem('itgc.' + k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem('itgc.' + k, JSON.stringify(v)); } catch { } } };
  // Short pop-up confirmation in the bottom-right corner (e.g. "Workpaper downloaded").
  const toast = text => { const t = h('div', { class: 'toast' }, ico('check'), text); $('#toasts').append(t); setTimeout(() => t.remove(), 3800); };
  // Lets the browser save a file (workpaper, settings, evaluation) to the Downloads folder.
  const download = (name, bytes, type) => { const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type })), download: name }); document.body.append(a); a.click(); a.remove(); toast(`${name} saved to your Downloads folder`); };
  const XTYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  // Current local date and time, used to stamp runs and workpapers.
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' '); }; // local time
  const I = ITGC, CTRL = I.CONTROLS;

  // "state" = everything the app currently knows: the step shown, the loaded files and sheets,
  // the settings, the mapped evidence and data checks, the last run, the auditor's decisions,
  // and the evaluation inputs.
  const state = {
    step: 1, files: [], sheets: {}, settings: store.get('settings', null) || I.clone(I.DEFAULT_SETTINGS),
    mapped: null, checks: null, run: null, decisions: {}, auditor: store.get('auditor', ''), evalAuto: null, evalManual: null, key: null, manual: null, notes: [],
  };
  // keep any newly added default fields when an older saved settings object is loaded
  const merge = (d, s) => { if (typeof d !== 'object' || d === null || Array.isArray(d)) return s === undefined ? d : s; const o = { ...d }; for (const k of Object.keys(s || {})) o[k] = merge(d[k], s[k]); return o; };
  state.settings = merge(I.DEFAULT_SETTINGS, state.settings);
  // Short helpers: save the settings; "scope" = controls ticked in step 1; "needed" = all evidence
  // those controls use; "required" = evidence they cannot run without; "reset" = forget results
  // that are no longer valid after something changed (e.g. a new file means mapping again).
  const saveSettings = () => store.set('settings', state.settings);
  const scope = () => I.CONTROL_IDS.filter(c => state.settings.controls[c].enabled !== false);
  const needed = () => I.controlEntities(scope());
  const required = () => [...new Set(scope().flatMap(c => I.CONTROL_NEEDS[c]))];
  const reset = (what = 'map') => { if (what === 'map') { state.mapped = null; state.checks = null; } state.run = null; };
  const AREA_ICON = c => c === 'C6' ? 'gear' : (c === 'C4' || c === 'C5') ? 'code' : 'user';

  // The seven steps of the left-hand menu, each with a one-line explanation and an icon.
  const STEPS = [
    [1, 'Scope', 'Choose what to test', 'target'], [2, 'Load evidence', 'Add the client\'s files', 'upload'],
    [3, 'Map & check data', 'Confirm the files were read correctly', 'table'], [4, 'Settings', 'Adjust the rules (optional)', 'sliders'],
    [5, 'Run tests', 'The tool tests every item', 'play'], [6, 'Review & export', 'Decide on flagged items, download workpapers', 'clipboard'],
    [7, 'Evaluate', 'Thesis metrics (optional)', 'chart']];
  // Which steps are finished (shown with a green tick in the menu).
  const doneSteps = () => ({ 1: scope().length > 0, 2: state.files.length > 0, 3: !!state.checks, 4: !!state.checks, 5: !!state.run, 6: !!state.run && Object.keys(state.decisions).length > 0, 7: !!state.evalAuto });
  // "renderNav" draws the menu; "go" opens a step.
  function renderNav() {
    const nav = $('nav'); nav.replaceChildren();
    const done = doneSteps(), n = Object.values(done).filter(Boolean).length;
    nav.append(h('div', { class: 'navhead' }, `Your progress · ${n} of 7`), h('div', { class: 'navprog' }, h('div', { style: `width:${n / 7 * 100}%` })));
    for (const [k, t, sub, icon] of STEPS) {
      const isDone = done[k] && state.step !== k;
      nav.append(h('button', { class: (state.step === k ? 'active ' : '') + (isDone ? 'done' : ''), onclick: () => go(k), title: sub },
        h('span', { class: 'n' }, isDone ? ico('check') : k), h('span', { class: 'tx' }, h('b', {}, t), h('span', {}, sub))));
    }
    nav.append(h('div', { class: 'scope small' }, h('b', {}, 'In scope: '), scope().length ? scope().map(c => h('span', { class: 'pill' }, c)) : 'none'));
  }
  function go(n) { state.step = n; renderNav(); const m = $('main'); m.replaceChildren(); ({ 1: viewScope, 2: viewLoad, 3: viewMap, 4: viewSettings, 5: viewRun, 6: viewReview, 7: viewEval })[n](m); window.scrollTo(0, 0); }

  // ---------- Building blocks used on every screen ----------
  // Page heading: "STEP 2 OF 7", title and a one-sentence explanation.
  const pageHead = (m, n, lead) => m.append(h('div', { class: 'eyebrow' }, `Step ${n} of 7`), h('h2', {}, STEPS[n - 1][1]), h('p', { class: 'lead' }, lead));
  // "How this step works" box with numbered instructions in plain words. It can be folded away;
  // the app remembers that per step.
  const helpBox = (n, items) => {
    const closed = store.get('help.' + n, false);
    const d = h('details', { class: 'help', open: !closed || null, ontoggle: e => store.set('help.' + n, !e.target.open) }, h('summary', {}, ico('book'), 'How this step works'), h('ol', {}, items.map(i => h('li', {}, i))));
    return d;
  };
  // The Back / Next bar at the bottom of the screen. "next" can be disabled with a reason.
  const actionBar = (m, back, next) => {
    const bar = h('div', { class: 'actionbar' });
    if (back) bar.append(h('button', { class: 'btn ghost', onclick: () => go(back) }, ico('left'), 'Back'));
    if (next) {
      const [n, label, ok = true, why = ''] = next;
      bar.append(!ok && why ? h('span', { class: 'hint' }, why) : h('span', { class: 'spacer' }), h('button', { class: 'btn', disabled: !ok || null, onclick: () => go(n) }, `Next: ${label}`, ico('right')));
    }
    m.append(bar);
  };
  const msg = (kind, ...content) => h('div', { class: 'msg ' + kind }, ico({ warn: 'alert', err: 'x', ok: 'check', info: 'info' }[kind]), h('div', {}, ...content));
  // A labelled input field, and a text box that saves its value into the settings.
  const field = (label, input, style) => h('div', { class: 'field', style }, h('label', {}, label), input);
  const txt = (obj, key, onchg, type = 'text') => h('input', { type, value: obj[key] ?? '', onchange: e => { obj[key] = type === 'number' ? +e.target.value : e.target.value; saveSettings(); (onchg || (() => reset('run')))(); } });

  // ---------- Glossary (button in the header) ----------
  const GLOSSARY = [
    ['ITGC', 'IT general controls – controls over IT systems (who gets access, how programs are changed, how batch jobs run) that the financial figures depend on.'],
    ['Control / attribute', 'A control is a rule the company follows, e.g. "new users need approval". The tool checks each control as a few attributes (A, B, C…): separate things that must all be true.'],
    ['Population', 'All items the control applies to in the period, e.g. every user created in 2025. This tool tests all of them – no sampling.'],
    ['Evidence / IPE', 'The files from the client\'s systems (user lists, tickets, logs). Auditors call this "information produced by the entity" and must check it is complete and accurate.'],
    ['C&A', 'Completeness and accuracy – procedures showing that an extract contains all records and correct values (e.g. agree the record count to the system).'],
    ['PASS', 'The rule is met for this item.'],
    ['EXCEPTION', 'The evidence shows the rule was broken (e.g. access approved after the user was created). You confirm it or explain why it is not an exception.'],
    ['REVIEW', 'The evidence is incomplete or unclear (e.g. an approver but no date). The tool does not guess – you look at the item and decide.'],
    ['NOT TESTED (N/T)', 'The information needed is not in the files at all, so the tool could not test that attribute. Test it manually or get a better extract.'],
    ['Workpaper', 'The Excel file documenting the test for the audit file: leadsheet (summary), C&A, population, testing table and exceptions.'],
    ['Mapping', 'Telling the tool which column of your file holds which information (e.g. the column "Requested for" = the user ID). Usually done automatically.'],
    ['Answer key', 'For the thesis experiment only: the list of deviations planted in the synthetic data, used to measure how many the tool finds.'],
  ];
  function setupHeader() {
    $('#logo').append(ico('shield'));
    $('#privacy').append(ico('lock'), h('span', {}, 'Offline · data stays on this computer'));
    $('#glossaryBtn').append(ico('book'), 'Glossary');
    const dlg = $('#glossary');
    dlg.append(h('div', { class: 'dh' }, h('h3', {}, 'Glossary – audit terms in plain words'), h('button', { class: 'btn secondary small', onclick: () => dlg.close() }, 'Close')),
      h('dl', {}, GLOSSARY.flatMap(([t, d]) => [h('dt', {}, t), h('dd', {}, d)])));
    $('#glossaryBtn').addEventListener('click', () => dlg.showModal());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  }

  // ---------- Step 1: scope ----------
  // Screen 1 – SCOPE: a welcome box with a one-click demo, the engagement details and the list of
  // controls. Ticking only one control means only that control's evidence is requested and only
  // its workpaper is produced.
  function viewScope(m) {
    const S = state.settings, E = S.engagement;
    pageHead(m, 1, 'Choose the control(s) you want to test. You can test just one – the tool then asks only for the evidence that control needs.');
    if (!state.files.length && !state.run) m.append(h('div', { class: 'hero' }, h('div', {},
      h('h3', {}, 'New here? See the whole process in one click'),
      h('p', {}, 'The demo loads a sample company\'s data (FY 2025), tests all six controls and shows you the results. Nothing is sent anywhere.'),
      h('div', { class: 'steps3' }, h('span', {}, h('b', {}, '1'), 'Choose controls'), h('span', {}, h('b', {}, '2'), 'Add files'), h('span', {}, h('b', {}, '3'), 'Run'), h('span', {}, h('b', {}, '4'), 'Review & download'))),
      h('button', { class: 'btn big', onclick: quickDemo }, ico('star'), 'Try the demo')));
    m.append(helpBox(1, ['Fill in the engagement details – they appear on every workpaper.', 'Tick the controls you want to test. Each card shows what is checked and which files are needed.', 'Click "Next" at the bottom to add the files.']));
    m.append(h('div', { class: 'card' }, h('h3', {}, 'Engagement'), h('p', { class: 'sub' }, 'Shown in the header of every workpaper.'), h('div', { class: 'row' },
      field('Client / entity', txt(E, 'client')), field('System in scope', txt(E, 'system')),
      field('Period from', h('input', { type: 'date', value: S.period.start, onchange: e => { S.period.start = e.target.value; saveSettings(); reset(); } }), 'max-width:180px'),
      field('Period to', h('input', { type: 'date', value: S.period.end, onchange: e => { S.period.end = e.target.value; saveSettings(); reset(); } }), 'max-width:180px')),
      h('div', { class: 'row', style: 'margin-top:12px' }, field('Prepared by (your name or initials)', h('input', { type: 'text', value: state.auditor, placeholder: 'e.g. J. Smith', oninput: e => { state.auditor = e.target.value; store.set('auditor', state.auditor); } }), 'max-width:280px'),
        field('Reviewer (optional)', txt(E, 'reviewer'), 'max-width:280px'), field('Workpaper reference prefix', txt(E, 'wp_prefix'), 'max-width:220px'))));
    const grid = h('div', { class: 'grid2' });
    for (const c of I.CONTROL_IDS) {
      const d = CTRL[c], on = S.controls[c].enabled !== false;
      const ev = Object.entries(d.evidence).map(([e, r]) => h('span', { class: 'ev ' + (r.required ? 'req' : 'opt') }, I.ENTITY_LABELS[e] + (r.required ? '' : ' (optional)')));
      grid.append(h('label', { class: 'ctlpick' + (on ? ' on' : '') },
        h('input', { type: 'checkbox', checked: on, onchange: e => { S.controls[c].enabled = e.target.checked; saveSettings(); reset(); go(1); } }),
        h('div', {}, h('div', { class: 'ttl' }, `${c} – ${S.controls[c].name || d.name}`), h('div', { class: 'area' }, ico(AREA_ICON(c)), d.area),
          h('div', { class: 'small muted' }, d.description),
          h('div', { style: 'margin-top:8px' }, h('span', { class: 'small', style: 'font-weight:600;margin-right:6px' }, 'Files needed:'), ev),
          h('details', {}, h('summary', {}, `What is checked (${d.attributes.length} attribute${d.attributes.length > 1 ? 's' : ''})`), h('ul', { class: 'small', style: 'margin:6px 0 0 18px;padding:0' }, d.attributes.map(a => h('li', {}, h('b', {}, `${a.id}. ${a.name}`), ' – ', a.test)))))));
    }
    m.append(h('div', { class: 'card' }, h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' }, h('div', {}, h('h3', {}, 'Controls to test'), h('p', { class: 'sub', style: 'margin:0' }, `${scope().length} of ${I.CONTROL_IDS.length} selected`)),
      h('div', { class: 'row' }, h('button', { class: 'btn secondary small', onclick: () => { I.CONTROL_IDS.forEach(c => S.controls[c].enabled = true); saveSettings(); reset(); go(1); } }, 'Select all'), h('button', { class: 'btn secondary small', onclick: () => { I.CONTROL_IDS.forEach(c => S.controls[c].enabled = false); saveSettings(); reset(); go(1); } }, 'Clear'))), grid));
    actionBar(m, null, [2, 'Load evidence', scope().length > 0, 'Select at least one control']);
  }
  // One-click demo: select all controls, load the built-in demo data, run all tests, show results.
  async function quickDemo() {
    I.CONTROL_IDS.forEach(c => state.settings.controls[c].enabled = true);
    state.settings.mapping = I.clone(I.DEFAULT_SETTINGS.mapping); saveSettings();
    const b = Uint8Array.from(atob(window.DEMO_XLSX_B64), c => c.charCodeAt(0));
    await loadFiles([new File([b], 'ITGC_synthetic_evidence_FY2025.xlsx')], true);
    doMap(); go(5); await doRun($('main'));
    toast('Demo finished – these are the results for all six controls');
  }

  // ---------- Step 2: load ----------
  // Reads the files dropped by the user: each file is read (Excel or text), gets a SHA-256
  // fingerprint for the run log, and its sheets are added to the list of loaded sheets.
  // Workbooks with one sheet are named after the file, because exports often all call their sheet
  // "Page 1". Afterwards the evidence is mapped automatically where possible.
  async function loadFiles(fileList, quiet) {
    const errors = []; let n = 0;
    for (const f of fileList) {
      try {
        const buf = await f.arrayBuffer();
        const sheets = await XLSX_LITE.readFile(f.name, buf);
        const hash = await I.sha256(buf);
        const old = state.files.find(x => x.name === f.name);
        if (old) Object.keys(old.sheets).forEach(k => delete state.sheets[k]);
        state.files = state.files.filter(x => x.name !== f.name);
        // one-sheet workbooks are named after the file (exports often all call their sheet "Page 1"); clashes get the file name as prefix
        const base = f.name.replace(/\.[^.]+$/, ''), named = {}, list = Object.entries(sheets);
        for (const [k, v] of list) { let key = list.length === 1 ? base : k; if (state.sheets[key]) key = `${base} › ${k}`; named[key] = v; }
        state.files.push({ name: f.name, size: f.size, sha256: hash, sheets: Object.fromEntries(Object.entries(named).map(([k, v]) => [k, v.length])), header: Object.fromEntries(Object.entries(named).map(([k, v]) => [k, v.meta?.headerRow || 1])) });
        Object.assign(state.sheets, named); n++;
      } catch (e) { errors.push(`${f.name}: ${e.message}`); }
    }
    autoMapMissing();
    reset();
    if (quiet) return;
    go(2);
    if (n) toast(`${n} file${n > 1 ? 's' : ''} loaded`);
    if (errors.length) $('main').querySelector('.lead').after(msg('err', h('b', {}, 'Some files could not be read. '), errors.join('; ')));
  }
  // Automatic mapping for evidence types whose configured sheet is not among the loaded files
  // (or for all of them when the "Auto-detect" button is pressed). Uses engine.autoMap, which
  // recognises columns by their usual names. The result is shown to the auditor as a message.
  function autoMapMissing(force) {
    const S = state.settings, ents = needed().filter(e => force || !Object.keys(state.sheets).some(s => s.toUpperCase() === String(S.mapping[e]?.sheet || '').toUpperCase()));
    if (!ents.length) return;
    const taken = force ? [] : Object.keys(state.sheets).filter(s => needed().some(e => !ents.includes(e) && s.toUpperCase() === String(S.mapping[e]?.sheet || '').toUpperCase()));
    const r = I.autoMap(state.sheets, S, ents, taken);
    state.notes = [];
    for (const [e, mp] of Object.entries(r.mapping)) {
      S.mapping[e] = { sheet: mp.sheet, fields: { ...Object.fromEntries(Object.keys(I.ENTITIES[e].fields).map(f => [f, ''])), ...mp.fields } };
      state.notes.push(`${I.ENTITY_LABELS[e]} → "${mp.sheet}" (${Object.keys(mp.fields).length} of ${Object.keys(I.ENTITIES[e].fields).length} fields recognised)`);
    }
    saveSettings();
  }
  // For the checklist: is this evidence type mapped to a loaded sheet, and how many rows does it have?
  function evidenceStatus(e) {
    const mp = state.settings.mapping[e], s = Object.keys(state.sheets).find(x => x.toUpperCase() === String(mp?.sheet || '').toUpperCase());
    return s ? { ok: true, sheet: s, n: state.sheets[s].length } : { ok: false };
  }
  // Screen 2 – LOAD EVIDENCE: a checklist of the files the selected controls need (with their
  // typical source and status), the upload area, the demo data link, and the loaded files.
  function viewLoad(m) {
    pageHead(m, 2, 'Add the files exported from the client\'s systems. The tool recognises the usual SAP, ServiceNow and Jira exports by their column names.');
    m.append(helpBox(2, ['Look at the checklist: it shows which files the selected controls need.', 'Drag the files into the upload area (Excel, CSV or SAP text exports – several at once is fine).', 'Each item in the checklist turns green when a matching file is found. Optional items can stay empty.']));
    const req = new Set(required());
    const missing = needed().filter(e => req.has(e) && !evidenceStatus(e).ok);
    const t = h('table', {}, h('tr', {}, h('th', {}, 'File needed'), h('th', {}, 'Used for'), h('th', {}, 'Where it usually comes from'), h('th', {}, 'Status')));
    for (const e of needed()) {
      const st = evidenceStatus(e), users = scope().filter(c => CTRL[c].evidence[e]);
      t.append(h('tr', {}, h('td', {}, h('b', {}, I.ENTITY_LABELS[e]), req.has(e) ? '' : h('span', { class: 'muted small' }, ' (optional)')), h('td', {}, users.join(', ')), h('td', { class: 'small muted' }, I.ENTITIES[e].source),
        h('td', {}, st.ok ? h('span', {}, chip('OK'), h('span', { class: 'small muted' }, ` "${st.sheet}" · ${st.n} rows`)) : chip(req.has(e) ? 'MISSING' : 'INFO'))));
    }
    m.append(h('div', { class: 'card' }, h('h3', {}, ico('clipboard'), `Checklist for ${scope().join(', ')}`), h('p', { class: 'sub' }, missing.length ? `${missing.length} required file${missing.length > 1 ? 's' : ''} still missing.` : 'All required files are here.'), h('div', { class: 'tablewrap' }, t)));
    const input = h('input', { type: 'file', multiple: true, accept: '.xlsx,.csv,.txt,.tsv', style: 'display:none', onchange: e => loadFiles(e.target.files) });
    const drop = h('div', { class: 'drop' }, h('div', { class: 'big-ico' }, ico('upload')), h('h4', {}, 'Drag your files here'), h('p', {}, 'Excel (.xlsx), CSV or text exports · files never leave this computer'), h('button', { class: 'btn', onclick: () => input.click() }, ico('file'), 'Choose files'), input);
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); loadFiles(e.dataTransfer.files); });
    const card = h('div', { class: 'card' }, drop);
    if (window.DEMO_XLSX_B64) card.append(h('p', { class: 'demo-line' }, 'No files at hand? ', h('a', { href: '#', onclick: async e => { e.preventDefault(); const b = Uint8Array.from(atob(window.DEMO_XLSX_B64), c => c.charCodeAt(0)); state.settings.mapping = I.clone(I.DEFAULT_SETTINGS.mapping); await loadFiles([new File([b], 'ITGC_synthetic_evidence_FY2025.xlsx')]); } }, 'Load the synthetic demo dataset (FY 2025)'), '.'));
    m.append(card);
    if (state.notes.length) m.append(msg('ok', h('b', {}, 'Files recognised automatically. '), 'You can check the details in the next step.', h('ul', {}, state.notes.map(n => h('li', {}, n)))));
    if (state.files.length) {
      const ft = h('table', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Content (records)'), h('th', {}, h('span', {}, 'Fingerprint', tip('A SHA-256 code that identifies this exact file. It is recorded in the run log and the workpaper, so it can later be proven which file was tested.')))));
      for (const f of state.files) ft.append(h('tr', {}, h('td', {}, h('span', { style: 'display:inline-flex;gap:6px;align-items:center' }, ico('file'), f.name)), h('td', {}, Object.entries(f.sheets).map(([k, v]) => `${k} (${v})`).join(', ')), h('td', { class: 'small muted' }, f.sha256.slice(0, 16) + '…')));
      m.append(h('div', { class: 'card' }, h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('h3', {}, 'Loaded files'), h('button', { class: 'btn secondary small', onclick: () => { state.files = []; state.sheets = {}; state.notes = []; reset(); go(2); } }, 'Clear all')), h('div', { class: 'tablewrap' }, ft)));
    }
    actionBar(m, 1, [3, 'Check the data', state.files.length > 0, 'Add at least one file']);
  }

  // ---------- Step 3: mapping and data checks ----------
  // Maps the loaded sheets to evidence records (engine.mapEntities) and runs the data checks (engine.dataChecks).
  function doMap() {
    const only = needed();
    state.mapped = I.mapEntities(state.sheets, state.settings, only);
    state.checks = I.dataChecks(state.mapped.entities, state.settings, { ...state.mapped, only, required: required() });
    state.run = null;
  }
  // Screen 3 – MAP & CHECK DATA: a summary at the top, then for each evidence type which sheet and
  // columns are used (folded away when everything is fine), then the completeness and accuracy
  // checks – the ones that need attention first, all of them in a folded table.
  function viewMap(m) {
    pageHead(m, 3, 'Check that the tool read your files correctly before testing. In most cases everything is recognised automatically and you only need to read the points marked for attention.');
    if (!state.files.length) { m.append(msg('warn', 'No files yet. ', h('a', { href: '#', onclick: e => { e.preventDefault(); go(2); } }, 'Go to step 2 to add them.'))); actionBar(m, 2, null); return; }
    if (!state.checks) doMap();
    m.append(helpBox(3, ['Read the summary below. Green means every file was recognised.', 'Read each point under "Needs your attention" – these are things an auditor should look at (e.g. duplicate tickets, missing columns).', 'Only if a file was recognised wrongly: open it under "Columns used" and pick the right sheet or column.']));
    const sheetNames = Object.keys(state.sheets), S = state.settings, req = new Set(required());
    const boxes = [], probs = [];
    for (const ent of needed()) {
      const def = I.ENTITIES[ent], mp = S.mapping[ent] || (S.mapping[ent] = { sheet: '', fields: {} });
      const sName = sheetNames.find(s => s.toUpperCase() === (mp.sheet || '').toUpperCase());
      const cols = sName ? (state.sheets[sName].meta?.columns || Object.keys(state.sheets[sName][0] || {})) : [];
      // Fields this evidence must have for the selected controls, and which attributes (e.g. C1.D) use each field.
      const reqFields = new Set(scope().flatMap(c => CTRL[c].evidence[ent]?.fields || []));
      const usedBy = f => scope().flatMap(c => CTRL[c].attributes.filter(a => a.needs.some(n => n.split('|').includes(ent + '.' + f))).map(a => `${c}.${a.id}`));
      // Choosing another sheet re-runs the automatic column matching for that sheet only.
      const sel = h('select', { onchange: e => { mp.sheet = e.target.value; const r = I.autoMap({ [mp.sheet]: state.sheets[mp.sheet] }, S, [ent]); mp.fields = r.mapping[ent]?.fields || {}; saveSettings(); reset(); go(3); } }, h('option', { value: '' }, '– not available –'), ...sheetNames.map(s => h('option', { value: s, selected: s === sName || null }, `${s} (${state.sheets[s].length} rows)`)));
      // If the header row was detected wrongly, the auditor can type the correct row number here.
      const hdr = sName ? h('input', { type: 'number', min: 1, value: state.sheets[sName].meta?.headerRow || 1, style: 'max-width:90px', onchange: e => { const raw = state.sheets[sName].meta?.raw; if (raw) { state.sheets[sName] = XLSX_LITE.toObjects(raw, Math.max(0, +e.target.value - 1)); reset(); go(3); } } }) : null;
      const ok = sName && [...reqFields].every(f => cols.length && I.blank(mp.fields[f]) === false);
      if (!ok && req.has(ent)) probs.push(def.label);
      const found = Object.keys(def.fields).filter(f => !I.blank(mp.fields?.[f]) && cols.length).length;
      const det = h('details', { class: 'mapbox', open: (!ok && req.has(ent)) || null }, h('summary', {}, ico(ok ? 'check' : 'alert'), h('b', {}, def.label), h('span', { class: 'sheet' }, sName ? `from "${sName}" · ${found} of ${Object.keys(def.fields).length} fields` : 'no file chosen'), req.has(ent) ? '' : h('span', { class: 'small muted' }, '(optional)'), chip(ok ? 'OK' : req.has(ent) ? 'MISSING' : 'INFO')));
      const g = h('div', { class: 'row', style: 'margin:4px 0 12px;align-items:flex-end' }, field('Which file / sheet holds this?', sel, 'max-width:360px'), hdr ? field('Header row', hdr, 'max-width:120px;min-width:100px') : null, hdr ? tip('The row that contains the column names. Usually detected automatically; change it only if the column names below look wrong.') : null);
      const fg = h('div', { class: 'fgrid' });
      for (const [f, fd] of Object.entries(def.fields)) {
        const u = usedBy(f), star = reqFields.has(f) ? ' *' : '';
        const cur = mp.fields?.[f] || '';
        const input = cols.length ? h('select', { onchange: e => { mp.fields = mp.fields || {}; mp.fields[f] = e.target.value; saveSettings(); reset(); } }, h('option', { value: '' }, '– not in this file –'), ...cols.map(c => h('option', { value: c, selected: c.toUpperCase() === cur.toUpperCase() || null }, c)), ...(cur.includes('+') ? [h('option', { value: cur, selected: true }, cur)] : []))
          : h('input', { type: 'text', value: cur, onchange: e => { mp.fields = mp.fields || {}; mp.fields[f] = e.target.value; saveSettings(); reset(); } });
        fg.append(h('div', { class: 'field' }, h('label', {}, fd.label + star, u.length ? h('span', { class: 'muted', style: 'font-weight:400' }, ' · used by ' + u.join(', ')) : ''), input));
      }
      det.append(h('div', { class: 'inner' }, g, fg, h('p', { class: 'small muted', style: 'margin:10px 0 0' }, '* needed for the control to run. Without an optional field, the attributes that use it are marked NOT TESTED.')));
      boxes.push(det);
    }
    const warn = state.mapped.issues.filter(i => i.level !== 'info');
    const attention = state.checks.filter(c => c.Status === 'WARNING' || c.Status === 'FAIL' || c.Status === 'MISSING');
    // Summary banner: green when everything is fine, amber when there are points to read, red when files are missing.
    const kind = probs.length ? 'bad' : attention.length ? 'attn' : 'good';
    m.append(h('div', { class: 'summary-banner ' + kind }, h('div', { class: 'big-ico' }, ico(kind === 'good' ? 'check' : kind === 'bad' ? 'x' : 'alert')),
      h('div', {}, h('h3', {}, kind === 'bad' ? `Not ready: ${probs.join(', ')} not recognised` : kind === 'attn' ? `Files recognised – ${attention.length} point${attention.length > 1 ? 's' : ''} need${attention.length > 1 ? '' : 's'} your attention` : 'All files recognised – no problems found'),
        h('p', {}, kind === 'bad' ? 'Choose the right file below, or go back and add it.' : 'You can continue to testing. The checks below are also copied into the workpaper (C&A sheet).'))));
    if (warn.length) m.append(...warn.map(i => msg('warn', i.text)));
    if (attention.length) {
      const t = h('table', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'What was checked'), h('th', {}, 'Status'), h('th', {}, 'What it means')));
      for (const c of attention) t.append(h('tr', {}, h('td', {}, c.Evidence), h('td', {}, c.Check), h('td', {}, chip(c.Status)), h('td', {}, c.Detail)));
      m.append(h('div', { class: 'card' }, h('h3', {}, ico('alert'), 'Needs your attention', tip('Investigate each point before relying on the results, e.g. ask the client about duplicates or confirm the excluded lines are not real records. Document your conclusion on the C&A sheet of the workpaper.')), h('p', { class: 'sub' }, 'Not necessarily errors – but an auditor should look at them.'), h('div', { class: 'tablewrap' }, t)));
    }
    const cnt = s => state.checks.filter(c => c.Status === s).length;
    const all = h('table', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Check'), h('th', {}, 'Status'), h('th', {}, 'Detail')));
    for (const c of state.checks) all.append(h('tr', {}, h('td', {}, c.Evidence), h('td', {}, c.Check), h('td', {}, chip(c.Status)), h('td', {}, c.Detail)));
    m.append(h('div', { class: 'card' }, h('h3', {}, ico('shield'), 'Completeness and accuracy checks', tip('The client\'s files are "information produced by the entity" (IPE). These automatic checks support your completeness and accuracy (C&A) work: record counts, duplicates, unreadable dates, period coverage, and the values found in status fields.')),
      h('div', { class: 'counts' }, ['OK', 'INFO', 'WARNING', 'FAIL', 'MISSING'].filter(cnt).map(s => h('span', {}, chip(s), h('span', { class: 'small muted' }, ` ${cnt(s)}`)))),
      h('details', {}, h('summary', {}, `Show all ${state.checks.length} checks`), h('div', { class: 'scroll', style: 'margin-top:10px' }, all))));
    m.append(h('div', { class: 'card' }, h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' }, h('div', {}, h('h3', {}, ico('table'), 'Columns used'), h('p', { class: 'sub', style: 'margin:0' }, 'Which file and which columns the tool uses for each type of evidence. Open one only if something looks wrong.')),
      h('div', { class: 'row' }, h('button', { class: 'btn secondary small', onclick: () => { autoMapMissing(true); reset(); go(3); toast('Columns detected again'); } }, 'Auto-detect again'), h('button', { class: 'btn secondary small', onclick: () => { doMap(); go(3); toast('Checks updated'); } }, 'Re-run checks'))), boxes));
    actionBar(m, 2, [5, 'Run the tests', !probs.length, 'Some required files are not recognised']);
  }

  // ---------- Step 4: settings ----------
  // Input helpers for the settings screen: comma-separated lists, numbers, text and longer text.
  const listIn = (obj, key, label) => h('div', { class: 'field' }, h('label', {}, label, h('span', { class: 'muted', style: 'font-weight:400' }, ' (separate with commas)')), h('input', { type: 'text', value: (obj[key] || []).join(', '), onchange: e => { obj[key] = e.target.value.split(',').map(x => x.trim()).filter(Boolean); saveSettings(); reset('run'); } }));
  const numIn = (obj, key, label) => field(label, txt(obj, key, null, 'number'), 'max-width:240px');
  const txtIn = (obj, key, label, type = 'text') => field(label, txt(obj, key, null, type));
  const area = (obj, key, label) => field(label, h('textarea', { onchange: e => { obj[key] = e.target.value; saveSettings(); } }, obj[key] || ''));
  // Screen 4 – SETTINGS: the parameters of each control in scope (e.g. authorised approvers,
  // maximum days, keyword lists), the leadsheet texts, the free-text assessment method
  // (keywords or AI), the date format, and saving/loading the settings file.
  function viewSettings(m) {
    const S = state.settings, C = S.controls;
    pageHead(m, 4, 'Adapt the rules to the client\'s control description. This step is optional – the defaults work for the demo data.');
    m.append(helpBox(4, ['Check the parameters of each control, e.g. who is allowed to approve access, or how many days a leaver\'s account may stay active.', 'Open "Leadsheet information" to enter the client\'s own control ID, owner and description – they are printed on the workpaper.', 'Save the settings to a file to keep them with the audit documentation.']));
    // Which parameter fields are shown for each control.
    const P = {
      C1: () => [listIn(C.C1, 'authorised_approvers', 'Who may approve new access (empty = anyone except the creator)'), listIn(C.C1, 'approved_status', 'Ticket status that means "approved"'), listIn(C.C1, 'user_types', 'User types in scope (A = dialog)'), listIn(C.C1.approval_text, 'positive', 'Comment words that suggest an approval (no approver field → REVIEW)'), listIn(C.C1.approval_text, 'negative', 'Comment words that do not count as approval')],
      C2: () => [numIn(C.C2, 'max_days', 'Maximum days from leaving to account lock'), listIn(C.C2, 'lock_events', 'Lock history: words meaning "locked"'), listIn(C.C2, 'unlock_events', 'Lock history: words meaning "unlocked"')],
      C3: () => [listIn(C.C3, 'privileged_profiles', 'Profiles / roles that count as privileged'), listIn(C.C3, 'user_types', 'User types in scope')],
      C4: () => [listIn(C.C4, 'emergency_types', 'Change types that are emergency changes'), txtIn(C.C4, 'ref_pattern', 'Pattern of a change number in transport descriptions (advanced)'), listIn(C.C4.text, 'positive', 'Words that show business testing'), listIn(C.C4.text, 'negative', 'Words that show missing testing')],
      C5: () => [listIn(C.C5, 'technical_import_users', 'Technical import users (sent to review)')],
      C6: () => [listIn(C.C6, 'failed_status', 'Job status that means "failed"'), listIn(C.C6, 'closed_status', 'Incident status that means "resolved"'), numIn(C.C6, 'link_days', 'Days to link an incident by job name'), listIn(C.C6.text, 'positive', 'Words that show a real fix'), listIn(C.C6.text, 'negative', 'Words that show no real fix')],
    };
    const card = h('div', { class: 'card' }, h('h3', {}, ico('sliders'), 'Rules per control'), h('p', { class: 'sub' }, 'Only the controls you selected in step 1 are shown.'));
    for (const c of scope()) {
      const wp = C[c].wp;
      card.append(h('div', { class: 'ctl' }, h('h4', {}, ico(AREA_ICON(c)), `${c} – ${C[c].name}`), h('div', { class: 'fgrid' }, ...P[c]()),
        h('details', { style: 'margin-top:12px' }, h('summary', {}, 'Leadsheet information (client\'s control description)'),
          h('div', { class: 'fgrid', style: 'margin-top:10px' }, txtIn(C[c], 'name', 'Control name'), txtIn(wp, 'ref', 'Client control ID'), txtIn(wp, 'owner', 'Control owner'), txtIn(wp, 'frequency', 'Frequency'), txtIn(wp, 'type', 'Type (preventive / detective)'), txtIn(wp, 'nature', 'Nature (manual / automated)'), txtIn(wp, 'key', 'Key control')),
          h('div', { class: 'row', style: 'margin-top:10px' }, area(wp, 'description', 'Control description'), area(wp, 'risk', 'Risk addressed')))));
    }
    if (!scope().length) card.append(h('p', { class: 'muted' }, 'No controls selected.'));
    m.append(card);
    const ai = S.ai, aiBox = h('div', {});
    // The AI section: provider, address, model, number of repeated runs, and a "Test connection" button.
    const drawAi = () => {
      aiBox.replaceChildren(h('div', { class: 'row' }, field('How should written notes (test evidence, incident resolutions) be judged?', h('select', { onchange: e => { ai.mode = e.target.value; saveSettings(); reset('run'); drawAi(); } }, h('option', { value: 'keywords', selected: ai.mode === 'keywords' || null }, 'Keyword rules – simple and transparent (recommended)'), h('option', { value: 'llm', selected: ai.mode === 'llm' || null }, 'Language model (AI) – needs a local AI installed')), 'max-width:520px')));
      if (ai.mode === 'llm') {
        const res = h('span', { class: 'small' });
        aiBox.append(h('div', { class: 'fgrid', style: 'margin-top:12px' },
          field('Provider', h('select', { onchange: e => { ai.provider = e.target.value; saveSettings(); } }, h('option', { value: 'ollama', selected: ai.provider === 'ollama' || null }, 'Ollama (local)'), h('option', { value: 'openai', selected: ai.provider === 'openai' || null }, 'OpenAI-compatible API'))),
          txtIn(ai, 'url', 'Address'), txtIn(ai, 'model', 'Model name'), txtIn(ai, 'api_key', 'API key (if needed)', 'password'), numIn(ai, 'runs', 'Repeat each check (runs)')),
          h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn secondary', onclick: async () => { res.textContent = 'Testing…'; const r = await I.llmCheck('C4', 'UAT passed, sign-off by key user attached.', ai); res.textContent = r.source === 'llm-error' ? '✗ ' + r.reason : `✓ Model answered: ${r.label} – ${r.reason}`; } }, 'Test connection'), res),
          msg('warn', 'Confidentiality: with a cloud API the ticket texts leave your computer. Use a local model (Ollama) for real client data, or only use synthetic data. With Ollama, start it with the environment variable OLLAMA_ORIGINS=* so this page may call it (see the guide).'));
      }
    };
    drawAi();
    m.append(h('div', { class: 'card' }, h('h3', {}, ico('file'), 'Written notes'), h('p', { class: 'sub' }, 'Some attributes depend on text, e.g. "UAT passed, sign-off attached". Unclear texts always go to you for review.'), aiBox));
    m.append(h('div', { class: 'card' }, h('h3', {}, ico('table'), 'Date format'), h('div', { class: 'row' }, field('Dates like 03/04/2025 mean…', h('select', { onchange: e => { S.date_order = e.target.value; saveSettings(); reset(); } }, ...[['auto', 'Detect automatically (default: day/month)'], ['DMY', 'Day/month/year (Europe)'], ['MDY', 'Month/day/year (US)']].map(([v, t]) => h('option', { value: v, selected: S.date_order === v || null }, t))), 'max-width:380px'))));
    const fin = h('input', { type: 'file', accept: '.json', style: 'display:none', onchange: async e => { try { state.settings = merge(I.DEFAULT_SETTINGS, JSON.parse(await e.target.files[0].text())); saveSettings(); reset(); go(4); toast('Settings loaded'); } catch (err) { alert('Not a valid settings file: ' + err.message); } } });
    m.append(h('div', { class: 'card' }, h('h3', {}, ico('download'), 'Settings file'), h('p', { class: 'sub' }, 'Keep the settings with the audit documentation, or reuse them next year.'), h('div', { class: 'row' },
      h('button', { class: 'btn secondary', onclick: () => { const s = I.clone(state.settings); s.ai.api_key = ''; download('itgc_settings.json', JSON.stringify(s, null, 2), 'application/json'); } }, 'Save settings to file'),
      h('button', { class: 'btn secondary', onclick: () => fin.click() }, 'Load settings from file'), fin,
      h('button', { class: 'btn ghost', onclick: () => { if (confirm('Reset all settings and mappings to the defaults?')) { state.settings = I.clone(I.DEFAULT_SETTINGS); saveSettings(); reset(); go(4); toast('Settings reset'); } } }, 'Reset to defaults'))));
    actionBar(m, 3, [5, 'Run the tests']);
  }

  // ---------- Step 5: run ----------
  // RUN: executes the control tests (engine.runControls) on the mapped evidence, shows a progress
  // bar while free texts are assessed, then writes a run log entry (run ID, time, auditor, tool
  // version, settings fingerprint, file fingerprints, counts, run time).
  async function doRun(m) {
    if (!state.checks) doMap();
    const bar = h('div'), prog = h('div', { class: 'progress' }, bar), note = h('p', { class: 'small muted', style: 'margin:0' }, 'Testing…');
    const box = h('div', { class: 'card' }, h('h3', {}, 'Testing in progress'), note, prog);
    const anchor = m.querySelector('.runbox')?.closest('.card');
    if (anchor) anchor.after(box); else m.append(box);
    const t0 = performance.now();
    const run = await I.runControls(state.mapped.entities, state.settings, { avail: state.mapped.avail, controls: scope(), progress: (a, b) => { bar.style.width = (100 * a / b) + '%'; note.textContent = `Reading written notes ${a} / ${b}…`; } });
    run.seconds = (performance.now() - t0) / 1000;
    run.id = 'run-' + Date.now();
    run.started = today();
    run.consistency = I.runConsistency(run.textRuns);
    const cnt = r => run.items.filter(i => i.result === r).length;
    const settingsHash = await I.sha256(new TextEncoder().encode(JSON.stringify({ ...state.settings, ai: { ...state.settings.ai, api_key: '' } })));
    run.log = { 'Run ID': run.id, Timestamp: run.started, Auditor: state.auditor || '(not entered)', 'Tool version': I.VERSION, 'Controls': run.controls.join(', '), 'Settings fingerprint': settingsHash.slice(0, 16), 'Period': state.settings.period.start + ' to ' + state.settings.period.end, 'Text assessment': state.settings.ai.mode === 'llm' ? `LLM ${state.settings.ai.provider} / ${state.settings.ai.model} x${state.settings.ai.runs}` : 'Keyword rules', 'Input files': state.files.map(f => `${f.name} [sha256 ${f.sha256}]`).join('; '), 'Items tested': run.items.length, Exceptions: cnt('EXCEPTION'), 'Requires review': cnt('REVIEW'), 'Run time (s)': +run.seconds.toFixed(2) };
    const logs = store.get('runlog', []); logs.push(run.log); store.set('runlog', logs.slice(-200));
    // Decisions from the previous run are kept for items whose tool result did not change.
    const prev = state.run, prevDec = state.decisions, keep = {};
    if (prev) for (const it of run.items) { const k = it.control + '|' + it.record_id, old = prev.items.find(x => x.control === it.control && x.record_id === it.record_id); if (old && old.result === it.result && prevDec[k]) keep[k] = prevDec[k]; }
    state.run = run; state.decisions = keep; store.set('decisions.' + run.id, keep);
    go(5);
  }
  // Screen 5 – RUN TESTS: the run button, warnings for controls that could not run or attributes
  // that could not be tested, one result card per control (big numbers, a coloured bar and the
  // counts per attribute), and the technical run log.
  function viewRun(m) {
    pageHead(m, 5, 'The tool checks every item of the population against every attribute – no sampling. Each item gets PASS, EXCEPTION or REVIEW.');
    if (!state.files.length) { m.append(msg('warn', 'No files yet. ', h('a', { href: '#', onclick: e => { e.preventDefault(); go(2); } }, 'Go to step 2 to add them.'))); actionBar(m, 2, null); return; }
    m.append(helpBox(5, ['Click the run button. It takes a few seconds (longer with the AI option).', 'Read the result card of each control: red = exceptions, amber = items you need to review, green = passed.', 'Continue to "Review & export" to decide on the flagged items and download the workpapers.']));
    const r = state.run;
    const items = r ? r.items.length : null;
    m.append(h('div', { class: 'card' }, h('div', { class: 'runbox' }, h('div', { class: 'big-ico' }, ico('play')),
      h('div', {}, h('h3', {}, r ? `Tested ${items} items on ${r.started.slice(0, 16)}` : 'Ready to test'), h('p', { class: 'sub', style: 'margin:0' }, r ? 'Run again after changing files or settings.' : `Controls: ${scope().join(', ')} · every item will be checked.`)),
      h('button', { class: 'btn big' + (r ? ' secondary' : ''), onclick: () => doRun(m) }, ico('play'), r ? 'Run again' : `Run tests (${scope().join(', ')})`))));
    if (!r) { actionBar(m, 3, [6, 'Review & export', false, 'Run the tests first']); return; }
    for (const s of r.skipped) m.append(msg('err', h('b', {}, `${s.control} could not run. `), s.reason.replace('Missing evidence:', 'Missing:') + '. Add the file in step 2 or check the columns in step 3.'));
    for (const [c, l] of Object.entries(r.limitations || {})) for (const x of l) m.append(msg('warn', h('b', {}, `${c} attribute ${x.id} (${x.name}) was not tested. `), `The files do not contain ${x.missing.join(', ')}. Test it manually – these cells are yellow (N/T) in the workpaper.`));
    const g = h('div', { class: 'grid' });
    for (const c of r.controls) {
      const its = r.items.filter(i => i.control === c), n = x => its.filter(i => i.result === x).length, tot = its.length || 1;
      const attrs = CTRL[c].attributes.map(a => {
        const chips = ['EXCEPTION', 'REVIEW', 'NOT TESTED'].map(res => [res, its.filter(i => i.attributes.some(x => x.id === a.id && x.result === res)).length]).filter(([, k]) => k).map(([res, k]) => h('span', { class: 'chip ' + res.replace(/ /g, '') }, `${k} ${{ EXCEPTION: k > 1 ? 'exceptions' : 'exception', REVIEW: 'to review', 'NOT TESTED': 'not tested' }[res]}`));
        return h('div', { class: 'a' }, h('span', {}, `${a.id}. ${a.name}`), h('span', { class: 'chips' }, chips.length ? chips : h('span', { class: 'chip PASS' }, ico('check'), 'all met')));
      });
      g.append(h('div', { class: 'stat' }, h('div', { class: 't' }, `${c} – ${state.settings.controls[c].name}`), h('div', { class: 'small muted' }, `Population ${its.length} · coverage 100%`),
        h('div', { class: 'nums' }, h('div', { class: 'num exc' }, h('b', {}, n('EXCEPTION')), h('span', {}, 'exceptions')), h('div', { class: 'num rev' }, h('b', {}, n('REVIEW')), h('span', {}, 'to review')), h('div', { class: 'num pass' }, h('b', {}, n('PASS')), h('span', {}, 'passed'))),
        h('div', { class: 'bar' }, h('i', { class: 'b-exc', style: `width:${n('EXCEPTION') / tot * 100}%` }), h('i', { class: 'b-rev', style: `width:${n('REVIEW') / tot * 100}%` }), h('i', { class: 'b-pass', style: `width:${n('PASS') / tot * 100}%` })),
        h('div', { class: 'attrs' }, attrs),
        n('EXCEPTION') + n('REVIEW') ? h('button', { class: 'btn secondary small', onclick: () => { store.set('reviewFilter', { control: c, result: 'flagged', q: '' }); go(6); } }, `Review ${n('EXCEPTION') + n('REVIEW')} flagged items`, ico('right')) : null));
    }
    m.append(g);
    const info = h('details', { class: 'card', style: 'margin-top:18px' }, h('summary', {}, 'Technical run log (recorded in the workpaper)'), h('div', { class: 'tablewrap', style: 'margin-top:12px' }, h('table', {}, ...Object.entries(r.log).map(([k, v]) => h('tr', {}, h('th', { style: 'width:200px;position:static' }, k), h('td', { class: 'small' }, String(v)))))));
    if (r.consistency) info.append(h('p', {}, `AI consistency over ${r.consistency.runs} runs on ${r.consistency.items} texts: all runs agree on ${pct(r.consistency.all_runs_agree)} of texts; mean pairwise agreement ${pct(r.consistency.mean_pairwise_agreement)}; mean Cohen’s kappa ${num(r.consistency.mean_pairwise_kappa)}. Items where runs disagree are set to REVIEW.`));
    m.append(info);
    actionBar(m, 3, [6, 'Review & export']);
  }

  // ---------- Step 6: review and export ----------
  const DECISIONS = ['', ...WORKPAPER.DECISIONS];
  // Builds the Excel workpaper of one control (workpaper.js) and downloads it.
  function exportWorkpaper(c) {
    const sheets = WORKPAPER.build(c, { run: state.run, settings: state.settings, decisions: state.decisions, checks: state.checks || [], mapped: state.mapped || {}, files: state.files, auditor: state.auditor, entities: state.mapped?.entities || {}, ITGC: I, XLSX_LITE });
    download(WORKPAPER.fileName(c, state.settings, state.run), XLSX_LITE.writeBook(sheets), XTYPE);
  }
  // Screen 6 – REVIEW & EXPORT: review progress, workpaper downloads, then the list of items with
  // filters. For every EXCEPTION or REVIEW item the auditor chooses a decision and writes a comment;
  // these are saved immediately and appear in the workpaper.
  function viewReview(m) {
    pageHead(m, 6, 'Decide on every item the tool flagged, then download the workpapers for the audit file.');
    const r = state.run; if (!r) { m.append(msg('warn', 'Run the tests first. ', h('a', { href: '#', onclick: e => { e.preventDefault(); go(5); } }, 'Go to step 5.'))); actionBar(m, 5, null); return; }
    m.append(helpBox(6, ['For each flagged item, open the details to see why it was flagged.', 'Choose your decision: "Confirmed exception", "Not an exception" or "More information needed", and add a short comment.', 'Download the workpaper of each control. Your decisions are included – you can also finish them later in Excel.']));
    const flagged = r.items.filter(i => i.result !== 'PASS');
    const decided = () => flagged.filter(i => state.decisions[i.control + '|' + i.record_id]?.decision).length;
    const progBar = h('div'), progTxt = h('b', {});
    const updateProg = () => { const d = decided(); progBar.style.width = (flagged.length ? d / flagged.length * 100 : 100) + '%'; progTxt.textContent = flagged.length ? `${d} of ${flagged.length} flagged items decided` : 'Nothing was flagged – no decisions needed'; };
    updateProg();
    m.append(h('div', { class: 'card' }, h('h3', {}, ico('clipboard'), 'Your review'), h('div', { class: 'reviewprog', style: 'margin:10px 0 16px' }, progTxt, h('div', { class: 'progress' }, progBar)),
      h('h3', { style: 'margin-top:4px' }, ico('download'), 'Workpapers', tip('One Excel file per control: Leadsheet (summary and conclusion), C&A, Population, Testing table with tickmarks, Exceptions, source data and run log. Yellow cells are for you to complete.')),
      h('p', { class: 'sub' }, 'One Excel file per control, ready for the audit file.'),
      h('div', { class: 'exports' },
        ...r.controls.map(c => h('button', { class: 'btn', onclick: () => exportWorkpaper(c) }, ico('download'), `Export ${c} workpaper`)),
        r.controls.length > 1 ? h('button', { class: 'btn secondary', onclick: async () => { for (const c of r.controls) { exportWorkpaper(c); await new Promise(res => setTimeout(res, 600)); } } }, 'Export all') : null,
        h('button', { class: 'btn ghost', onclick: exportRaw }, 'Raw results (one file)'))));
    const f = store.get('reviewFilter', { control: '', result: 'flagged', q: '' });
    if (f.control && !r.controls.includes(f.control)) f.control = '';
    const body = h('tbody');
    const count = h('span', { class: 'small muted', style: 'align-self:flex-end;padding-bottom:9px' });
    // Redraws the item list whenever a filter (control, result, search text) changes.
    const draw = () => {
      store.set('reviewFilter', f); body.replaceChildren();
      const rows = r.items.filter(i => (!f.control || i.control === f.control) && (f.result === 'all' || (f.result === 'flagged' ? i.result !== 'PASS' : f.result === 'NOT TESTED' ? i.attributes.some(a => a.result === 'NOT TESTED') : i.result === f.result)) && (!f.q || (i.record_id + ' ' + i.description + ' ' + i.reason).toLowerCase().includes(f.q.toLowerCase())));
      count.textContent = `${rows.length} item(s)`;
      for (const i of rows.slice(0, 1000)) {
        const k = i.control + '|' + i.record_id, d = state.decisions[k] || { decision: '', comment: '' };
        const save = () => { state.decisions[k] = d; store.set('decisions.' + r.id, state.decisions); renderNav(); updateProg(); };
        body.append(h('tr', { class: 'r-' + i.result }, h('td', {}, h('b', {}, i.record_id), h('div', { class: 'small muted' }, i.control)), h('td', {}, chip(i.result)),
          h('td', { class: 'ticks' }, i.attributes.map(a => h('span', { title: `${a.id}. ${a.name}: ${a.detail}` }, h('span', { class: 'small muted' }, a.id), tick(a.result)))),
          h('td', {}, h('div', {}, i.description), h('details', { open: null }, h('summary', { class: 'small' }, i.result === 'PASS' ? 'What was checked' : 'Why it was flagged'), ...i.attributes.map(a => h('div', { class: 'attr' }, tick(a.result), h('span', {}, h('b', {}, `${a.id}. ${a.name}`), ': ', a.detail))))),
          h('td', {}, i.result === 'PASS' ? h('span', { class: 'small muted' }, 'no decision needed') : h('select', { onchange: e => { d.decision = e.target.value; save(); } }, ...DECISIONS.map(x => h('option', { value: x, selected: d.decision === x || null }, x || '– choose –')))),
          h('td', {}, i.result === 'PASS' ? '' : h('textarea', { placeholder: 'Your comment…', onchange: e => { d.comment = e.target.value; save(); } }, d.comment))));
      }
      if (!rows.length) body.append(h('tr', {}, h('td', { colspan: 6, class: 'muted', style: 'text-align:center;padding:24px' }, 'No items match the filters.')));
      if (rows.length > 1000) body.append(h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'First 1000 shown; use the filters or the export for the rest.')));
    };
    m.append(h('div', { class: 'card' }, h('h3', {}, ico('table'), 'Items'), h('div', { class: 'row', style: 'margin:8px 0 12px;align-items:flex-end' },
      field('Control', h('select', { onchange: e => { f.control = e.target.value; draw(); } }, h('option', { value: '' }, 'All controls'), ...r.controls.map(c => h('option', { value: c, selected: f.control === c || null }, `${c} – ${state.settings.controls[c].name}`))), 'max-width:330px'),
      field('Show', h('select', { onchange: e => { f.result = e.target.value; draw(); } }, ...[['flagged', 'Items to decide (exceptions + review)'], ['EXCEPTION', 'Exceptions only'], ['REVIEW', 'Review only'], ['NOT TESTED', 'With attributes not tested'], ['PASS', 'Passed items'], ['all', 'All items']].map(([v, t]) => h('option', { value: v, selected: f.result === v || null }, t))), 'max-width:290px'),
      field('Search', h('input', { type: 'text', value: f.q, placeholder: 'User, transport, job…', oninput: e => { f.q = e.target.value; draw(); } })), count),
      h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Item', 'Result', 'Attributes', 'Details', 'Your decision', 'Comment'].map(x => h('th', {}, x)))), body))));
    draw();
    actionBar(m, 5, [7, 'Evaluate (optional)']);
  }
  // The simple all-controls export from version 1 (flat tables, no workpaper layout).
  function exportRaw() {
    const r = state.run, dec = state.decisions;
    const flaggedRows = r.items.filter(i => i.result !== 'PASS').map(i => ({ Control: i.control, 'Record ID': i.record_id, 'Tool result': i.result, Description: i.description, Reason: i.reason, 'Auditor decision': dec[i.control + '|' + i.record_id]?.decision || '', 'Auditor comment': dec[i.control + '|' + i.record_id]?.comment || '' }));
    const all = r.items.map(i => ({ Control: i.control, 'Record ID': i.record_id, 'Tool result': i.result, Description: i.description }));
    const attrs = r.items.flatMap(i => i.attributes.map(a => ({ Control: i.control, 'Record ID': i.record_id, Attribute: `${a.id}. ${a.name}`, Result: a.result, Detail: a.detail })));
    download(`ITGC_raw_results_${r.started.slice(0, 10)}.xlsx`, XLSX_LITE.writeXlsx([{ name: 'Flagged', rows: flaggedRows }, { name: 'All_items', rows: all }, { name: 'Attribute_results', rows: attrs }, { name: 'Data_checks', rows: (state.checks || []).map(({ entity, ...c }) => c) }, { name: 'Run_log', rows: [r.log] }, ...(r.consistency ? [{ name: 'AI_consistency', rows: [r.consistency, ...r.textRuns.map(t => ({ control: t.control, record_id: t.record_id, text: t.text, labels: t.labels.join(' / ') }))] }] : [])]), XTYPE);
  }

  // ---------- Step 7: evaluation ----------
  // Screen 7 – EVALUATE (thesis experiment): load the answer key to score the tool, load the
  // manual testers' results to score them and their agreement, download the template for manual
  // testers, and export everything. Also shows the run history of this browser.
  function viewEval(m) {
    pageHead(m, 7, 'Only for the thesis experiment: measure how well the tool (and manual testers) found the deviations planted in the test data.');
    const r = state.run; if (!r) { m.append(msg('warn', 'Run the tests first. ', h('a', { href: '#', onclick: e => { e.preventDefault(); go(5); } }, 'Go to step 5.'))); actionBar(m, 6, null); return; }
    m.append(helpBox(7, ['Load the answer key – the list of deviations that were planted in the test data.', 'Optionally load the manual testers\' results (use the template) to compare them with the tool.', 'Export the evaluation to Excel for the thesis.']));
    const readOne = async (file) => Object.values(await XLSX_LITE.readFile(file.name, await file.arrayBuffer()))[0];
    const strict = h('input', { type: 'checkbox', checked: !!state.evalStrict, style: 'width:auto', onchange: e => { state.evalStrict = e.target.checked; if (state.key) state.evalAuto = I.evaluateAutomated(r, state.key, state.evalStrict); go(7); } });
    const kin = h('input', { type: 'file', accept: '.xlsx,.csv', style: 'display:none', onchange: async e => { state.key = await readOne(e.target.files[0]); state.evalAuto = I.evaluateAutomated(r, state.key, state.evalStrict); if (state.manual) state.evalManual = I.evaluateManual(state.manual, state.key, r.populations); go(7); toast('Answer key loaded'); } });
    const min = h('input', { type: 'file', accept: '.xlsx,.csv', style: 'display:none', onchange: async e => { state.manual = await readOne(e.target.files[0]); if (state.key) state.evalManual = I.evaluateManual(state.manual, state.key, r.populations); go(7); toast('Manual results loaded'); } });
    const tbl = (rows, fmt = {}) => { if (!rows?.length) return h('p', { class: 'muted' }, 'No rows.'); const cols = Object.keys(rows[0]); return h('div', { class: 'scroll' }, h('table', {}, h('tr', {}, ...cols.map(c => h('th', {}, c))), ...rows.map(x => h('tr', {}, ...cols.map(c => h('td', {}, fmt[c] ? fmt[c](x[c]) : num(x[c]))))))); };
    const P = { Precision: pct, Recall: pct, F1: pct, Coverage: pct, 'Sample precision': pct, 'Sample recall': pct, 'Population recall': pct, 'Percent agreement': pct };
    m.append(h('div', { class: 'card' }, h('h3', {}, '1. Answer key', tip('Precision = share of flagged items that are real deviations. Recall = share of real deviations that were found. F1 balances both.')), h('p', { class: 'sub' }, 'A file with one row per real deviation and the columns control and record_id.'), h('div', { class: 'row' }, h('button', { class: 'btn secondary', onclick: () => kin.click() }, ico('upload'), state.key ? 'Load a different answer key' : 'Load answer key'), kin, h('label', { style: 'display:flex;gap:6px;align-items:center;margin:0;font-weight:400' }, strict, 'Strict: count only EXCEPTION as flagged (REVIEW counted as not flagged)')),
      state.evalAuto ? h('div', { style: 'margin-top:14px' }, h('h3', {}, 'Automated test vs answer key'), tbl(state.evalAuto, P)) : ''));
    const tmpl = () => { const rows = []; for (const c of r.controls.slice(0, 2)) for (let k = 0; k < 2; k++) rows.push({ Participant: 'P1', Control: c, 'Record ID': '', Conclusion: 'Exception / No exception', Minutes: '' }); download('manual_results_template.xlsx', XLSX_LITE.writeXlsx([{ name: 'Manual_results', rows }, { name: 'Instructions', rows: [{ Instruction: 'One row per tested item. Participant = code (P1, P2...). Control = C1..C6. Record ID = user ID, transport or job count exactly as in the evidence. Conclusion = Exception or No exception. Minutes = total time spent on that control (repeat on each row or fill once).' }] }]), XTYPE); };
    m.append(h('div', { class: 'card' }, h('h3', {}, '2. Manual testing results', tip('Cohen\'s kappa measures how much two testers agree beyond chance: 1 = perfect, 0 = no better than chance.')), h('p', { class: 'sub' }, 'Collect the participants\' results in the template (one row per tested item), then load it here. Requires the answer key.'), h('div', { class: 'row' }, h('button', { class: 'btn secondary', onclick: tmpl }, ico('download'), 'Download template'), h('button', { class: 'btn secondary', disabled: !state.key || null, onclick: () => min.click() }, ico('upload'), 'Load manual results'), min),
      state.evalManual ? h('div', { style: 'margin-top:14px' }, h('h3', {}, 'Manual testing vs answer key'), tbl(state.evalManual.perf, P), h('h3', { style: 'margin-top:14px' }, 'Agreement between participants (items tested by both)'), tbl(state.evalManual.agreement, P)) : ''));
    if (state.evalAuto) m.append(h('div', { class: 'card' }, h('h3', {}, '3. Export'), h('button', { class: 'btn', onclick: () => download('ITGC_evaluation.xlsx', XLSX_LITE.writeXlsx([{ name: 'Automated', rows: state.evalAuto }, ...(state.evalManual ? [{ name: 'Manual', rows: state.evalManual.perf }, { name: 'Agreement', rows: state.evalManual.agreement }] : []), ...(r.consistency ? [{ name: 'AI_consistency', rows: [r.consistency] }] : []), { name: 'Run_log', rows: [r.log] }]), XTYPE) }, ico('download'), 'Export evaluation (.xlsx)')));
    m.append(h('details', { class: 'card' }, h('summary', {}, 'Run history in this browser'), h('div', { style: 'margin-top:12px' }, tbl(store.get('runlog', []).slice().reverse())), h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn secondary small', onclick: () => download('ITGC_run_log.xlsx', XLSX_LITE.writeXlsx([{ name: 'Run_log', rows: store.get('runlog', []) }]), XTYPE) }, 'Export run history'))));
    actionBar(m, 6, null);
  }

  // When the page has loaded: build the header, show the version number and open step 1.
  document.addEventListener('DOMContentLoaded', () => { setupHeader(); $('#ver').textContent = 'v' + I.VERSION; go(1); });
})();
