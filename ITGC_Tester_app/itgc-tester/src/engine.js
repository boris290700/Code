/* engine.js - ITGC testing logic. No user-interface code here, so the same
   functions run in the browser and in automated tests (Node). */
const ITGC = (() => {
  const VERSION = '1.0.0';

  // ===== 1. Default settings (all can be changed in the app or in a settings file) =====
  const DEFAULT_SETTINGS = {
    settings_version: '1.0',
    period: { start: '2025-01-01', end: '2025-12-31' },
    // Where each piece of evidence is found: sheet name and column names in YOUR files
    mapping: {
      employees: { sheet: 'HR_EMPLOYEES', fields: { employee_id: 'PERNR', user_id: 'USER_ID', hire_date: 'HIRE_DATE', termination_date: 'TERMINATION_DATE' } },
      users: { sheet: 'USR02_USERS', fields: { user_id: 'BNAME', user_type: 'USTYP', created_on: 'ERDAT', created_by: 'ANAME', lock_flag: 'UFLAG', lock_date: 'LOCK_DATE', last_logon: 'TRDAT' } },
      access_requests: { sheet: 'ACCESS_REQUESTS', fields: { ticket_id: 'TICKET_ID', user_id: 'USER_ID', approved_by: 'APPROVED_BY', approved_on: 'APPROVED_ON', status: 'STATUS', comments: 'COMMENTS' } },
      user_profiles: { sheet: 'UST04_PROFILES', fields: { user_id: 'BNAME', profile: 'PROFILE' } },
      privileged_approved: { sheet: 'PRIVILEGED_APPROVED', fields: { user_id: 'BNAME', profile: 'PROFILE' } },
      transports: { sheet: 'E070_TRANSPORTS', fields: { transport_id: 'TRKORR', owner: 'AS4USER', imported_on: 'IMPORT_PRD_TS', imported_by: 'IMPORTED_BY', change_id: 'CHANGE_ID' } },
      changes: { sheet: 'CHANGE_TICKETS', fields: { change_id: 'CHANGE_ID', change_type: 'CHANGE_TYPE', approver: 'APPROVER', approved_on: 'APPROVED_TS', post_approved_on: 'POST_IMPL_APPROVED_TS', test_evidence: 'TEST_EVIDENCE' } },
      job_runs: { sheet: 'TBTCO_JOBS', fields: { job_id: 'JOBCOUNT', job_name: 'JOBNAME', run_date: 'SDLSTRTDT', status: 'STATUS' } },
      incidents: { sheet: 'INCIDENTS', fields: { incident_id: 'INCIDENT_ID', job_id: 'JOBCOUNT', opened_on: 'OPENED_ON', resolved_on: 'RESOLVED_ON', status: 'STATUS', resolution: 'RESOLUTION' } },
    },
    controls: {
      C1: { enabled: true, name: 'New user access approved before creation', user_types: ['A'], approved_status: ['APPROVED'], authorised_approvers: ['MOZOLS', 'ILIEPA', 'KBERZINS', 'DABELE'] },
      C2: { enabled: true, name: 'Leavers locked within allowed days', max_days: 3 },
      C3: { enabled: true, name: 'Privileged profiles restricted', user_types: ['A'], privileged_profiles: ['SAP_ALL', 'SAP_NEW', 'S_A.SYSTEM'] },
      C4: { enabled: true, name: 'Changes approved and tested before import', emergency_types: ['EMERGENCY'],
        text: { positive: ['UAT', 'user acceptance', 'QAS by business', 'tested by business', 'key user', 'sign-off', 'signed off'], negative: ['no testing', 'not needed', 'not tested', 'by developer', 'in DEV'] } },
      C5: { enabled: true, name: 'Developers do not import own changes' },
      C6: { enabled: true, name: 'Failed jobs followed up and resolved', failed_status: ['A'], closed_status: ['CLOSED', 'RESOLVED'],
        text: { positive: ['rerun', 're-run', 'restarted', 'reloaded', 'reprocessed', 'reconciled'], negative: ['no action', 'n/a', 'duplicate'] } },
    },
    ai: { mode: 'keywords', provider: 'ollama', url: 'http://localhost:11434', model: 'llama3.1:8b', api_key: '', runs: 1 },
  };

  const ENTITY_FIELDS = {
    employees: { employee_id: 'id', user_id: 'id', hire_date: 'date', termination_date: 'date' },
    users: { user_id: 'id', user_type: 'text', created_on: 'date', created_by: 'id', lock_flag: 'text', lock_date: 'date', last_logon: 'date' },
    access_requests: { ticket_id: 'id', user_id: 'id', approved_by: 'id', approved_on: 'date', status: 'text', comments: 'text' },
    user_profiles: { user_id: 'id', profile: 'text' },
    privileged_approved: { user_id: 'id', profile: 'text' },
    transports: { transport_id: 'id', owner: 'id', imported_on: 'datetime', imported_by: 'id', change_id: 'id' },
    changes: { change_id: 'id', change_type: 'text', approver: 'id', approved_on: 'datetime', post_approved_on: 'datetime', test_evidence: 'text' },
    job_runs: { job_id: 'id', job_name: 'text', run_date: 'date', status: 'text' },
    incidents: { incident_id: 'id', job_id: 'id', opened_on: 'date', resolved_on: 'date', status: 'text', resolution: 'text' },
  };
  const ENTITY_LABELS = { employees: 'HR employee list', users: 'User master', access_requests: 'Access request tickets', user_profiles: 'User profiles', privileged_approved: 'Approved privileged accounts', transports: 'Transports to production', changes: 'Change tickets', job_runs: 'Batch job runs', incidents: 'Incident tickets' };
  const CONTROL_NEEDS = { C1: ['users', 'access_requests'], C2: ['employees', 'users'], C3: ['users', 'user_profiles', 'privileged_approved'], C4: ['transports', 'changes'], C5: ['transports'], C6: ['job_runs', 'incidents'] };
  const clone = o => JSON.parse(JSON.stringify(o));

  // ===== 2. Value helpers =====
  const blank = v => v === null || v === undefined || String(v).trim() === '';
  const id = v => blank(v) ? null : String(v).trim();
  const normId = v => { const s = id(v); return s === null ? null : (/^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s.toUpperCase()); };
  function parseDate(v) { // returns milliseconds (UTC) or null
    if (blank(v)) return null;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v > 20000 && v < 80000 ? Math.round((v - 25569) * 86400000) : null; // Excel serial
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/); // DD.MM.YYYY (European / SAP GUI)
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/); // YYYYMMDD (SAP raw)
    if (m) return +m[1] < 1900 ? null : Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return null;
  }
  const DAY = 86400000;
  const day0 = ms => ms === null ? null : Math.floor(ms / DAY) * DAY;
  const fmtD = ms => ms === null || ms === undefined ? '' : new Date(ms).toISOString().slice(0, 10);
  const fmtDT = ms => ms === null || ms === undefined ? '' : new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  const daysBetween = (a, b) => Math.round((day0(b) - day0(a)) / DAY);
  const inList = (v, list) => !blank(v) && (list || []).map(x => String(x).trim().toUpperCase()).includes(String(v).trim().toUpperCase());

  // ===== 3. Mapping your files to the common data model =====
  function mapEntities(sheets, settings) {
    const entities = {}, issues = [];
    for (const [ent, fields] of Object.entries(ENTITY_FIELDS)) {
      const m = settings.mapping[ent];
      if (!m || blank(m.sheet)) { issues.push({ entity: ent, level: 'info', text: `${ENTITY_LABELS[ent]}: not mapped.` }); continue; }
      const sheetName = Object.keys(sheets).find(s => s.trim().toUpperCase() === m.sheet.trim().toUpperCase());
      if (!sheetName) { issues.push({ entity: ent, level: 'warning', text: `${ENTITY_LABELS[ent]}: sheet "${m.sheet}" not found in the loaded files.` }); continue; }
      const rows = sheets[sheetName];
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const findCol = c => cols.find(x => x.trim().toUpperCase() === String(c || '').trim().toUpperCase());
      const missing = Object.keys(fields).filter(f => !blank(m.fields[f]) && !findCol(m.fields[f]));
      if (missing.length) issues.push({ entity: ent, level: 'warning', text: `${ENTITY_LABELS[ent]}: column(s) not found: ${missing.map(f => `${f} → "${m.fields[f]}"`).join(', ')}.` });
      entities[ent] = rows.map((r, i) => {
        const o = { _row: i + 2, _sheet: sheetName };
        for (const [f, type] of Object.entries(fields)) {
          const c = findCol(m.fields[f]); const raw = c ? r[c] : null;
          o[f] = type === 'date' || type === 'datetime' ? parseDate(raw) : (type === 'id' ? id(raw) : (blank(raw) ? null : String(raw).trim()));
          if ((type === 'date' || type === 'datetime') && !blank(raw) && o[f] === null) o['_bad_' + f] = String(raw);
        }
        return o;
      });
    }
    return { entities, issues };
  }

  // ===== 4. Data completeness and accuracy checks (FR2) =====
  function dataChecks(E, settings) {
    const out = [], p0 = parseDate(settings.period.start), p1 = parseDate(settings.period.end) + DAY - 1;
    const add = (entity, check, status, detail) => out.push({ Evidence: ENTITY_LABELS[entity] || entity, Check: check, Status: status, Detail: detail });
    const keys = { employees: 'employee_id', users: 'user_id', access_requests: 'ticket_id', transports: 'transport_id', changes: 'change_id', job_runs: 'job_id', incidents: 'incident_id' };
    for (const [ent, fields] of Object.entries(ENTITY_FIELDS)) {
      const rows = E[ent];
      if (!rows) { add(ent, 'Evidence loaded', 'MISSING', 'Not loaded or not mapped. Controls that need it cannot run.'); continue; }
      add(ent, 'Record count', rows.length ? 'OK' : 'FAIL', `${rows.length} records`);
      if (keys[ent]) {
        const empty = rows.filter(r => blank(r[keys[ent]])).length;
        const seen = new Map(); rows.forEach(r => { const k = r[keys[ent]]; if (k) seen.set(k, (seen.get(k) || 0) + 1); });
        const dup = [...seen.entries()].filter(([, n]) => n > 1);
        add(ent, `Key "${keys[ent]}" complete and unique`, empty || dup.length ? 'WARNING' : 'OK', `${empty} empty, ${dup.length} duplicated${dup.length ? ' (e.g. ' + dup.slice(0, 3).map(d => d[0]).join(', ') + ')' : ''}`);
      }
      for (const [f, t] of Object.entries(fields)) if (t === 'date' || t === 'datetime') {
        const bad = rows.filter(r => r['_bad_' + f]);
        if (bad.length) add(ent, `Field "${f}" readable as date`, 'WARNING', `${bad.length} values not recognised (e.g. "${bad[0]['_bad_' + f]}")`);
      }
    }
    if (E.transports) { const n = E.transports.filter(t => t.imported_on !== null && (t.imported_on < p0 || t.imported_on > p1)).length; add('transports', 'Import dates within audit period', n ? 'INFO' : 'OK', `${n} transports outside the period (excluded from testing)`); }
    if (E.job_runs) { const n = E.job_runs.filter(t => t.run_date !== null && (t.run_date < p0 || t.run_date > p1)).length; add('job_runs', 'Run dates within audit period', n ? 'INFO' : 'OK', `${n} runs outside the period (excluded)`); }
    if (E.transports && E.changes) { const ids = new Set(E.changes.map(c => c.change_id)); const n = E.transports.filter(t => t.change_id && !ids.has(t.change_id)).length; add('transports', 'Change IDs found in change tickets', n ? 'WARNING' : 'OK', `${n} transports refer to a change ID that is not in the ticket extract`); }
    if (E.employees && E.users) { const ids = new Set(E.users.map(u => normId(u.user_id))); const n = E.employees.filter(e => e.termination_date !== null && e.user_id && !ids.has(normId(e.user_id))).length; add('employees', 'Leavers matched to user accounts', n ? 'WARNING' : 'OK', `${n} leavers with a user ID that is not in the user master`); }
    return out;
  }

  // ===== 5. Text checks: keyword rules or a language model (FR5) =====
  function keywordCheck(text, cfg) {
    if (blank(text)) return { label: 'INADEQUATE', reason: 'Text is empty.', quote: '', source: 'keywords' };
    const t = String(text).toLowerCase();
    const neg = (cfg.negative || []).find(k => t.includes(String(k).toLowerCase()));
    if (neg) return { label: 'INADEQUATE', reason: `Contains "${neg}".`, quote: neg, source: 'keywords' };
    const pos = (cfg.positive || []).find(k => t.includes(String(k).toLowerCase()));
    if (pos) return { label: 'ADEQUATE', reason: `Contains "${pos}".`, quote: pos, source: 'keywords' };
    return { label: 'UNCLEAR', reason: 'No known positive or negative wording found.', quote: '', source: 'keywords' };
  }
  const QUESTIONS = {
    C4: 'Does this text show that the change was tested and accepted by the business users (for example user acceptance testing or key-user sign-off) before going to production? Testing only by the developer, or no testing, is NOT adequate.',
    C6: 'Does this text show that the failed batch job was actually investigated and fixed (for example root cause identified and job rerun, restarted or data reconciled)? Closing without action is NOT adequate.',
  };
  function buildPrompt(control, text) {
    return `You help an IT auditor review evidence. Question: ${QUESTIONS[control]}\n\nEvidence text:\n"""${text}"""\n\nAnswer ONLY with JSON in this form: {"label": "ADEQUATE" or "INADEQUATE" or "UNCLEAR", "quote": "exact words copied from the evidence text that support your answer", "reason": "one short sentence"}. Use UNCLEAR if the text does not allow a clear decision.`;
  }
  async function llmCheck(control, text, ai, fetchFn) {
    if (blank(text)) return { label: 'INADEQUATE', reason: 'Text is empty.', quote: '', source: 'rule' };
    const prompt = buildPrompt(control, text);
    const f = fetchFn || fetch;
    let content;
    try {
      if (ai.provider === 'ollama') {
        const r = await f(ai.url.replace(/\/$/, '') + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: ai.model, stream: false, format: 'json', options: { temperature: 0 }, messages: [{ role: 'user', content: prompt }] }) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        content = (await r.json()).message.content;
      } else {
        const r = await f(ai.url.replace(/\/$/, '') + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ai.api_key ? { Authorization: 'Bearer ' + ai.api_key } : {}) }, body: JSON.stringify({ model: ai.model, temperature: 0, messages: [{ role: 'user', content: prompt }] }) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        content = (await r.json()).choices[0].message.content;
      }
      const j = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
      let label = String(j.label || '').toUpperCase().trim();
      if (!['ADEQUATE', 'INADEQUATE', 'UNCLEAR'].includes(label)) label = 'UNCLEAR';
      const quote = String(j.quote || '');
      // guard against invented evidence: an ADEQUATE answer must quote the real text
      if (label === 'ADEQUATE' && (!quote || !String(text).toLowerCase().includes(quote.toLowerCase().trim()))) return { label: 'UNCLEAR', reason: 'Model said adequate but its quote is not in the evidence text: ' + (j.reason || ''), quote, source: 'llm' };
      return { label, reason: String(j.reason || ''), quote, source: 'llm' };
    } catch (e) {
      return { label: 'UNCLEAR', reason: 'Language model not reachable or answer not readable (' + e.message + ').', quote: '', source: 'llm-error' };
    }
  }

  // ===== 6. Control tests (FR3, FR4, FR6) =====
  const RANK = { PASS: 0, REVIEW: 1, EXCEPTION: 2 };
  const TEXT_RESULT = { ADEQUATE: 'PASS', INADEQUATE: 'EXCEPTION', UNCLEAR: 'REVIEW' };

  async function runControls(E, settings, opts = {}) {
    const S = settings, C = S.controls, p0 = parseDate(S.period.start), p1 = parseDate(S.period.end) + DAY - 1;
    const inP = ms => ms !== null && ms >= p0 && ms <= p1;
    const items = [], skipped = [], textJobs = [];
    const item = (control, record_id, description) => { const it = { control, record_id, description, attributes: [] }; items.push(it); return it; };
    const att = (it, name, result, detail) => it.attributes.push({ name, result, detail });
    const can = c => C[c] && C[c].enabled !== false && CONTROL_NEEDS[c].every(e => E[e]) || (C[c] && C[c].enabled !== false && (skipped.push({ control: c, reason: 'Missing evidence: ' + CONTROL_NEEDS[c].filter(e => !E[e]).map(e => ENTITY_LABELS[e]).join(', ') }), false));

    // C1 new users
    if (can('C1')) {
      const cfg = C.C1, byUser = new Map();
      E.access_requests.forEach(r => { const k = normId(r.user_id); if (!byUser.has(k)) byUser.set(k, []); byUser.get(k).push(r); });
      for (const u of E.users.filter(u => inP(u.created_on) && (!cfg.user_types?.length || inList(u.user_type, cfg.user_types)))) {
        const it = item('C1', u.user_id, `User ${u.user_id} created ${fmtD(u.created_on)} by ${u.created_by || '?'}`);
        const reqs = byUser.get(normId(u.user_id)) || [];
        if (!reqs.length) { att(it, 'Access request exists', 'EXCEPTION', 'No access request ticket found for this user.'); continue; }
        const appr = reqs.filter(r => inList(r.status, cfg.approved_status)).sort((a, b) => (a.approved_on ?? 9e15) - (b.approved_on ?? 9e15));
        const r = appr[0] || reqs[0];
        att(it, 'Access request exists', 'PASS', `Ticket ${r.ticket_id}.`);
        att(it, 'Request approved', appr.length ? 'PASS' : 'EXCEPTION', `Status "${r.status || 'empty'}".`);
        if (blank(r.approved_by)) att(it, 'Authorised approver', 'EXCEPTION', 'No approver recorded on the ticket.');
        else if (normId(r.approved_by) === normId(u.created_by)) att(it, 'Authorised approver', 'EXCEPTION', `Approved by ${r.approved_by}, who also created the user.`);
        else if (cfg.authorised_approvers?.length && !inList(r.approved_by, cfg.authorised_approvers)) att(it, 'Authorised approver', 'EXCEPTION', `Approver ${r.approved_by} is not on the list of authorised approvers.`);
        else att(it, 'Authorised approver', 'PASS', `Approved by ${r.approved_by}.`);
        if (r.approved_on === null) att(it, 'Approved before creation', 'EXCEPTION', 'No approval date.');
        else att(it, 'Approved before creation', day0(r.approved_on) <= day0(u.created_on) ? 'PASS' : 'EXCEPTION', `Approved ${fmtD(r.approved_on)}, created ${fmtD(u.created_on)}.`);
      }
    }
    // C2 leavers
    if (can('C2')) {
      const max = +C.C2.max_days, users = new Map(E.users.map(u => [normId(u.user_id), u]));
      for (const e of E.employees.filter(e => inP(e.termination_date))) {
        const u = users.get(normId(e.user_id));
        const it = item('C2', e.user_id || e.employee_id, `Employee ${e.employee_id} (${e.user_id || 'no user ID'}) terminated ${fmtD(e.termination_date)}`);
        if (!u) { att(it, 'User account found', 'REVIEW', 'No user account found. Confirm the employee had no access.'); continue; }
        const locked = u.lock_date !== null || (!blank(u.lock_flag) && String(u.lock_flag) !== '0');
        if (u.lock_date !== null) { const d = daysBetween(e.termination_date, u.lock_date); att(it, `Locked within ${max} days`, d <= max ? 'PASS' : 'EXCEPTION', `Locked ${fmtD(u.lock_date)}, ${d} day(s) after termination.`); }
        else if (locked) att(it, `Locked within ${max} days`, 'REVIEW', 'Account is locked but the lock date is not in the extract.');
        else if (day0(e.termination_date) + max * DAY < day0(p1)) att(it, `Locked within ${max} days`, 'EXCEPTION', 'Account still active at period end.');
        else att(it, `Locked within ${max} days`, 'PASS', 'Termination at period end, still within the allowed days.');
        if (u.last_logon !== null && day0(u.last_logon) > day0(e.termination_date)) att(it, 'No logon after termination', 'EXCEPTION', `Last logon ${fmtD(u.last_logon)} is after termination.`);
        else att(it, 'No logon after termination', 'PASS', u.last_logon !== null ? `Last logon ${fmtD(u.last_logon)}.` : 'No logon recorded.');
      }
    }
    // C3 privileged access
    if (can('C3')) {
      const cfg = C.C3, profs = new Map(), approved = new Set(E.privileged_approved.map(a => normId(a.user_id)));
      E.user_profiles.forEach(p => { const k = normId(p.user_id); if (!profs.has(k)) profs.set(k, []); profs.get(k).push(p.profile); });
      const active = u => u.lock_date === null && (blank(u.lock_flag) || String(u.lock_flag) === '0');
      for (const u of E.users.filter(u => active(u) && (!cfg.user_types?.length || inList(u.user_type, cfg.user_types)))) {
        const it = item('C3', u.user_id, `Active user ${u.user_id}`);
        const priv = (profs.get(normId(u.user_id)) || []).filter(p => inList(p, cfg.privileged_profiles));
        if (!priv.length) att(it, 'No unapproved privileged profile', 'PASS', 'No privileged profile assigned.');
        else att(it, 'No unapproved privileged profile', approved.has(normId(u.user_id)) ? 'PASS' : 'EXCEPTION', `Holds ${priv.join(', ')}; ${approved.has(normId(u.user_id)) ? 'on' : 'NOT on'} the approved privileged list.`);
      }
    }
    // C4 and C5 changes
    const trs = (E.transports || []).filter(t => inP(t.imported_on));
    if (can('C4')) {
      const cfg = C.C4, ch = new Map(E.changes.map(c => [normId(c.change_id), c]));
      for (const t of trs) {
        const it = item('C4', t.transport_id, `Transport ${t.transport_id} imported ${fmtDT(t.imported_on)}`);
        const c = t.change_id ? ch.get(normId(t.change_id)) : null;
        if (!c) { att(it, 'Change ticket exists', 'EXCEPTION', t.change_id ? `Change ${t.change_id} not found in ticket extract.` : 'No change ticket linked.'); continue; }
        att(it, 'Change ticket exists', 'PASS', `Change ${c.change_id} (${c.change_type || 'type not given'}).`);
        if (inList(c.change_type, cfg.emergency_types)) att(it, 'Emergency change approved after implementation', c.post_approved_on !== null ? 'PASS' : 'EXCEPTION', c.post_approved_on !== null ? `Post-approval ${fmtDT(c.post_approved_on)}.` : 'No post-implementation approval.');
        else if (c.approved_on === null) att(it, 'Approved before import', 'EXCEPTION', 'No approval recorded.');
        else att(it, 'Approved before import', c.approved_on <= t.imported_on ? 'PASS' : 'EXCEPTION', `Approved ${fmtDT(c.approved_on)}, imported ${fmtDT(t.imported_on)}.`);
        textJobs.push({ it, control: 'C4', name: 'Business testing evidence', text: c.test_evidence });
      }
    }
    if (can('C5')) {
      for (const t of trs) {
        const it = item('C5', t.transport_id, `Transport ${t.transport_id} owner ${t.owner}, imported by ${t.imported_by}`);
        if (blank(t.owner) || blank(t.imported_by)) att(it, 'Developer did not import own change', 'REVIEW', 'Owner or importing user missing.');
        else att(it, 'Developer did not import own change', normId(t.owner) !== normId(t.imported_by) ? 'PASS' : 'EXCEPTION', `Owner ${t.owner}, imported by ${t.imported_by}.`);
      }
    }
    // C6 failed jobs
    if (can('C6')) {
      const cfg = C.C6, inc = new Map();
      E.incidents.forEach(i => { const k = normId(i.job_id); if (k) { if (!inc.has(k)) inc.set(k, []); inc.get(k).push(i); } });
      for (const j of E.job_runs.filter(j => inP(j.run_date) && inList(j.status, cfg.failed_status))) {
        const it = item('C6', j.job_id, `${j.job_name} run ${j.job_id} failed ${fmtD(j.run_date)}`);
        const list = inc.get(normId(j.job_id)) || [];
        if (!list.length) { att(it, 'Incident logged', 'EXCEPTION', 'No incident linked to the failed job.'); continue; }
        const i = list.find(x => inList(x.status, cfg.closed_status)) || list[0];
        att(it, 'Incident logged', 'PASS', `Incident ${i.incident_id} opened ${fmtD(i.opened_on)}.`);
        const closed = inList(i.status, cfg.closed_status);
        att(it, 'Incident resolved', closed ? 'PASS' : 'EXCEPTION', closed ? `Resolved ${fmtD(i.resolved_on)}.` : `Status "${i.status || 'empty'}" at extraction.`);
        if (closed) textJobs.push({ it, control: 'C6', name: 'Resolution documented', text: i.resolution });
      }
    }

    // text attributes: keywords or language model, possibly several runs
    const ai = S.ai || {}; const runsN = ai.mode === 'llm' ? Math.max(1, +ai.runs || 1) : 1;
    const textRuns = [];
    let done = 0;
    for (const job of textJobs) {
      const answers = [];
      for (let k = 0; k < runsN; k++) {
        const a = ai.mode === 'llm' ? await llmCheck(job.control, job.text, ai, opts.fetch) : keywordCheck(job.text, C[job.control].text || {});
        answers.push(a);
      }
      const a = answers[0];
      const disagree = answers.some(x => x.label !== a.label);
      att(job.it, job.name, disagree ? 'REVIEW' : TEXT_RESULT[a.label], `${disagree ? 'Runs disagree (' + answers.map(x => x.label).join('/') + '). ' : ''}Text: "${job.text ?? ''}". ${a.source === 'keywords' ? 'Keyword check' : 'AI check'}: ${a.label} – ${a.reason}`);
      textRuns.push({ control: job.control, record_id: job.it.record_id, text: job.text, labels: answers.map(x => x.label) });
      if (opts.progress) opts.progress(++done, textJobs.length);
    }
    for (const it of items) {
      it.result = it.attributes.reduce((w, a) => RANK[a.result] > RANK[w] ? a.result : w, 'PASS');
      it.reason = it.attributes.filter(a => a.result === it.result && a.result !== 'PASS').map(a => `${a.name}: ${a.detail}`).join(' | ');
    }
    const populations = {};
    for (const c of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) populations[c] = items.filter(i => i.control === c).length;
    return { items, populations, skipped, textRuns };
  }

  // ===== 7. Evaluation (FR10) =====
  const safe = (a, b) => b ? a / b : null;
  function confusion(flaggedIds, truthIds, population) {
    const tp = [...flaggedIds].filter(x => truthIds.has(x)).length, fp = flaggedIds.size - tp, fn = [...truthIds].filter(x => !flaggedIds.has(x)).length;
    const tn = population === null ? null : population - tp - fp - fn;
    const p = safe(tp, tp + fp), r = safe(tp, tp + fn), f1 = p !== null && r !== null && p + r > 0 ? 2 * p * r / (p + r) : null;
    return { TP: tp, FP: fp, FN: fn, TN: tn, Precision: p, Recall: r, F1: f1 };
  }
  function readKey(rows) { // columns: control, record_id (flexible names)
    const k = r => { const ks = Object.keys(r); const g = n => ks.find(x => x.toLowerCase().replace(/[^a-z]/g, '') === n); return { control: id(r[g('control')]), record_id: normId(r[g('recordid')] ?? r[g('id')]) }; };
    return rows.map(k).filter(x => x.control && x.record_id);
  }
  function evaluateAutomated(run, keyRows, strict = false) {
    const key = readKey(keyRows), out = [];
    for (const c of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) {
      const its = run.items.filter(i => i.control === c); if (!its.length) continue;
      const flagged = new Set(its.filter(i => strict ? i.result === 'EXCEPTION' : i.result !== 'PASS').map(i => normId(i.record_id)));
      const truth = new Set(key.filter(k => k.control === c).map(k => k.record_id));
      out.push({ Control: c, Population: its.length, Tested: its.length, Coverage: 1, 'Deviations in key': truth.size, Flagged: flagged.size, ...confusion(flagged, truth, its.length) });
    }
    return out;
  }
  function kappa(a, b) { // two arrays of labels on the same items
    const n = a.length; if (!n) return { agreement: null, kappa: null, n };
    const labels = [...new Set([...a, ...b])]; let agree = 0;
    for (let i = 0; i < n; i++) if (a[i] === b[i]) agree++;
    const po = agree / n; let pe = 0;
    for (const l of labels) pe += (a.filter(x => x === l).length / n) * (b.filter(x => x === l).length / n);
    return { agreement: po, kappa: pe === 1 ? 1 : (po - pe) / (1 - pe), n };
  }
  function runConsistency(textRuns) {
    if (!textRuns.length || textRuns[0].labels.length < 2) return null;
    const R = textRuns[0].labels.length, pairs = [];
    for (let i = 0; i < R; i++) for (let j = i + 1; j < R; j++) pairs.push(kappa(textRuns.map(t => t.labels[i]), textRuns.map(t => t.labels[j])));
    return { runs: R, items: textRuns.length, all_runs_agree: textRuns.filter(t => t.labels.every(l => l === t.labels[0])).length / textRuns.length, mean_pairwise_agreement: pairs.reduce((s, p) => s + p.agreement, 0) / pairs.length, mean_pairwise_kappa: pairs.reduce((s, p) => s + (p.kappa ?? 0), 0) / pairs.length };
  }
  // manual results: columns Participant, Control, Record ID, Conclusion (Exception / No exception), Minutes (optional)
  function evaluateManual(rows, keyRows, populations) {
    const key = readKey(keyRows);
    const g = (r, n) => { const k = Object.keys(r).find(x => x.toLowerCase().replace(/[^a-z]/g, '') === n); return k ? r[k] : null; };
    const recs = rows.map(r => ({ p: id(g(r, 'participant')), c: id(g(r, 'control')), rid: normId(g(r, 'recordid')), exc: /^(exc|dev|yes|y|fail|x)/i.test(String(g(r, 'conclusion') || '')), min: Number(g(r, 'minutes')) || 0 })).filter(r => r.p && r.c && r.rid);
    const perf = [];
    const parts = [...new Set(recs.map(r => r.p))];
    for (const p of parts) for (const c of [...new Set(recs.filter(r => r.p === p).map(r => r.c))]) {
      const rs = recs.filter(r => r.p === p && r.c === c);
      const truth = new Set(key.filter(k => k.control === c).map(k => k.record_id));
      const tested = new Set(rs.map(r => r.rid)), flagged = new Set(rs.filter(r => r.exc).map(r => r.rid));
      const truthInSample = new Set([...truth].filter(t => tested.has(t)));
      const s = confusion(flagged, truthInSample, tested.size);
      const tpPop = [...flagged].filter(x => truth.has(x)).length;
      perf.push({ Participant: p, Control: c, Population: populations?.[c] ?? null, Tested: tested.size, Coverage: populations?.[c] ? tested.size / populations[c] : null, 'Deviations in sample': truthInSample.size, 'Sample TP': s.TP, 'Sample FP': s.FP, 'Sample FN': s.FN, 'Sample precision': s.Precision, 'Sample recall': s.Recall, 'Deviations in population': truth.size, 'Population recall': safe(tpPop, truth.size), Minutes: Math.max(0, ...rs.map(r => r.min)) });
    }
    const agreement = [];
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) for (const c of [...new Set(recs.map(r => r.c))]) {
      const A = new Map(recs.filter(r => r.p === parts[i] && r.c === c).map(r => [r.rid, r.exc])), B = new Map(recs.filter(r => r.p === parts[j] && r.c === c).map(r => [r.rid, r.exc]));
      const common = [...A.keys()].filter(k => B.has(k)); if (!common.length) continue;
      const k = kappa(common.map(x => A.get(x)), common.map(x => B.get(x)));
      agreement.push({ Control: c, 'Participant A': parts[i], 'Participant B': parts[j], 'Common items': k.n, 'Percent agreement': k.agreement, 'Cohen kappa': k.kappa });
    }
    return { perf, agreement };
  }

  // ===== 8. Run log fingerprint (FR9) =====
  async function sha256(bytes) {
    if (globalThis.crypto?.subtle) { const h = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); }
    let h = 2166136261; for (const b of new Uint8Array(bytes)) { h ^= b; h = Math.imul(h, 16777619); } return 'fnv-' + (h >>> 0).toString(16);
  }
  return { VERSION, DEFAULT_SETTINGS, ENTITY_FIELDS, ENTITY_LABELS, CONTROL_NEEDS, clone, parseDate, fmtD, fmtDT, mapEntities, dataChecks, keywordCheck, buildPrompt, llmCheck, runControls, evaluateAutomated, evaluateManual, kappa, runConsistency, sha256, normId };
})();
if (typeof module !== 'undefined') module.exports = ITGC;
