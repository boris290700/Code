// Builds a "real-world" version of the synthetic evidence: separate exports per system,
// in the formats auditors actually receive (SE16N text exports in UTF-16, ServiceNow
// Excel exports with title rows, display names and local date formats, STMS logs with
// separate date and time columns, SM37 CSV with leading zeros lost, missing fields...).
// The same 47 seeded deviations are kept, so the same answer key applies; a few extra
// ambiguous records are planted that a good tool must send to REVIEW (listed in the key file).
// Run:  node tools/make_messy_dataset.js
const fs = require('fs'), path = require('path');
const X = require('../src/xlsx.js');
const root = path.join(__dirname, '..');
const out = path.join(root, 'sample_data', 'messy_FY2025');
fs.mkdirSync(out, { recursive: true });

// Helpers that rewrite an ISO date (2025-12-31) in the formats real systems use: 31.12.2025, 31/12/2025, 20251231, 31-Dec-2025.
const dmy = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '';
const slash = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}${iso.length > 10 ? ' ' + iso.slice(11, 19) : ''}` : '';
const raw8 = iso => iso ? iso.slice(0, 10).replace(/-/g, '') : '';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = iso => iso ? `${iso.slice(8, 10)}-${MON[+iso.slice(5, 7) - 1]}-${iso.slice(0, 4)}${iso.length > 10 ? ' ' + iso.slice(11, 16) : ''}` : '';
const addDays = (iso, n) => new Date(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// Helpers: report title lines, a header row, tab-separated text, and UTF-16 encoding (as SAP GUI saves it).
const title = (...lines) => lines.map(l => [{ v: l, s: l === lines[0] ? 'boldplain' : 'plain' }]);
const hdr = cols => cols.map(c => ({ v: c, s: 'hdr' }));
const tsv = rows => rows.map(r => r.map(x => x ?? '').join('\t')).join('\r\n') + '\r\n';
const utf16 = s => { const b = Buffer.from('﻿' + s, 'utf16le'); return b; };
// List of the ambiguous records planted on purpose; they are written to the answer key's second sheet.
const planted = [];

(async () => {
  const s = await X.readXlsx(fs.readFileSync(path.join(root, 'sample_data', 'ITGC_synthetic_evidence_FY2025.xlsx')));
  // Employee names by user ID, so tickets can show "Ilze Vitola (IVITOLA)" like ServiceNow does.
  const names = Object.fromEntries(s.HR_EMPLOYEES.filter(e => e.USER_ID).map(e => [e.USER_ID, `${e.FIRST_NAME} ${e.LAST_NAME}`]));

  // Each block below writes one export file: it starts from the clean data and makes it look like a real export.
  // 1. HR export: title lines, combined name, SAP user sometimes lower case, real Excel dates, 31.12.9999 for active staff
  {
    const rows = [...title('Employee master data – all employees incl. leavers', 'Report run 15.01.2026 by HRADMIN · Company code 1000'), [],
      hdr(['Pers.No.', 'Employee name', 'Org. unit', 'SAP user name', 'Entry date', 'Leaving date'])];
    s.HR_EMPLOYEES.forEach((e, i) => rows.push([e.PERNR, `${e.FIRST_NAME} ${e.LAST_NAME}`, e.DEPARTMENT, e.USER_ID ? (i % 7 === 0 ? e.USER_ID.toLowerCase() + ' ' : e.USER_ID) : '', { v: e.HIRE_DATE, s: 'plaindate' }, { v: e.TERMINATION_DATE || '9999-12-31', s: 'plaindate' }]));
    rows.push([19001, 'Anna Kalnina', 'Logistics', '', { v: '2019-02-01', s: 'plaindate' }, { v: '2025-05-10', s: 'plaindate' }]);
    planted.push({ control: 'C2', record_id: '19001', expected: 'REVIEW', why: 'Leaver without SAP user ID in HR data – auditor must confirm no access.' });
    rows.push([19002, 'Peteris Gaidis', 'Finance', 'PGAIDIS', { v: '2021-06-01', s: 'plaindate' }, { v: '2025-08-01', s: 'plaindate' }]);
    planted.push({ control: 'C2', record_id: 'PGAIDIS', expected: 'REVIEW', why: 'Leaver whose user ID is not in the user master (deleted user or wrong ID).' });
    rows.push([], [`Number of records: ${s.HR_EMPLOYEES.length + 2}`]);
    fs.writeFileSync(path.join(out, 'HR_employee_master_export.xlsx'), X.writeBook([{ name: 'Employees', rows }]));
  }
  // 2. SE16N export of USR02: UTF-16 tab-delimited, header lines, DD.MM.YYYY, no lock date column (USR02 has none)
  {
    const lines = [['Table:', '', 'USR02'], ['Displayed Fields:  7 of  52  Fixed Columns:  1  List Width 0250'], [],
      ['User Name', 'User Type', 'Created On', 'Creator', 'User Lock Status', 'Valid through', 'Last Logon Date']];
    s.USR02_USERS.forEach((u, i) => {
      lines.push([u.BNAME, u.USTYP, dmy(u.ERDAT), u.ANAME, u.UFLAG, dmy(u.GLTGB), dmy(u.TRDAT)]);
      if (i === 250) lines.push(['User Name', 'User Type', 'Created On', 'Creator', 'User Lock Status', 'Valid through', 'Last Logon Date']); // page break
    });
    fs.writeFileSync(path.join(out, 'SE16N_USR02_users.txt'), utf16(tsv(lines)));
  }
  // 3. Lock history from change documents (RSUSR100N): the only source of lock dates; contains noise events
  {
    const ev = [];
    for (const u of s.USR02_USERS) if (u.LOCK_DATE) ev.push([u.BNAME, u.LOCK_DATE, '18:05:12', 'ITSUPPORT1', 'Lock status: Locked by administrator']);
    s.USR02_USERS.slice(0, 120).forEach((u, i) => { if (i % 3 === 0) ev.push([u.BNAME, `2025-${String(1 + i % 12).padStart(2, '0')}-1${i % 9}`, '09:12:40', 'ITSUPPORT2', 'Password changed']); });
    // a temporary lock/unlock before the real lock must not count as removal
    const tmp = s.HR_EMPLOYEES.find(e => e.USER_ID === 'JLACIS'), ok = s.USR02_USERS.find(u => u.LOCK_DATE && s.HR_EMPLOYEES.some(e => e.USER_ID === u.BNAME && e.TERMINATION_DATE && e.TERMINATION_DATE.startsWith('2025') && u.LOCK_DATE >= e.TERMINATION_DATE && u.LOCK_DATE <= addDays(e.TERMINATION_DATE, 3)));
    ev.push(['JLACIS', addDays(tmp.TERMINATION_DATE, 1), '08:00:00', 'ITSUPPORT1', 'Lock status: Locked by administrator'], ['JLACIS', addDays(tmp.TERMINATION_DATE, 2), '10:30:00', 'ITSUPPORT1', 'Lock status: Unlocked']);
    const term = s.HR_EMPLOYEES.find(e => e.USER_ID === ok.BNAME).TERMINATION_DATE;
    ev.push([ok.BNAME, addDays(term, -20), '08:00:00', 'ITSUPPORT1', 'Lock status: Locked (incorrect logons)'], [ok.BNAME, addDays(term, -19), '08:10:00', 'ITSUPPORT1', 'Lock status: Unlocked']);
    ev.sort((a, b) => (a[0] + a[1] + a[2]).localeCompare(b[0] + b[1] + b[2]));
    const rows = [...title('Change Documents for Users', 'Selection: change date 01.01.2025 – 31.01.2026, all users'), [], hdr(['User', 'Date', 'Time', 'Changed By', 'Change'])];
    ev.forEach(e => rows.push([e[0], dmy(e[1]), e[2], e[3], e[4]]));
    fs.writeFileSync(path.join(out, 'RSUSR100N_user_change_documents.xlsx'), X.writeBook([{ name: 'Change documents', rows }]));
  }
  // 4. ServiceNow requested items: title rows, display names, lower-case approver IDs, dd/mm/yyyy, gaps, duplicate, footer
  {
    const rows = [...title('sc_req_item – Requested Items', 'Filter: Item = SAP S/4HANA access request · Opened on 2025'), [],
      hdr(['Number', 'Requested for', 'Item', 'Opened', 'Approval', 'Approver', 'Approval set', 'State', 'Comments and Work notes'])];
    const ap = { APPROVED: 'Approved', REJECTED: 'Rejected', OPEN: 'Requested' }, st = { APPROVED: 'Closed Complete', REJECTED: 'Closed Incomplete', OPEN: 'Open' };
    let gapDate = 0, gapApprover = 0;
    s.ACCESS_REQUESTS.forEach((r, i) => {
      let approver = r.APPROVED_BY ? r.APPROVED_BY.toLowerCase() : '', set = r.APPROVED_ON ? slash(r.APPROVED_ON + ' 14:2' + (i % 10) + ':10') : '', comment = r.COMMENTS;
      const clean = r.STATUS === 'APPROVED' && r.APPROVED_BY && r.APPROVED_BY !== 'ITSUPPORT1' && !['PABELE2', 'EGRAVA', 'SEGLITE', 'LLACIS4'].includes(r.USER_ID);
      if (clean && i % 23 === 5 && gapDate < 4) { set = ''; gapDate++; planted.push({ control: 'C1', record_id: r.USER_ID, expected: 'REVIEW', why: 'Approver recorded but approval date missing in the ServiceNow export.' }); }
      else if (clean && i % 31 === 7 && gapApprover < 2) { approver = ''; comment = `Approved by line manager ${r.APPROVED_BY} via e-mail, attached to ticket.`; gapApprover++; planted.push({ control: 'C1', record_id: r.USER_ID, expected: 'REVIEW', why: 'Approver field empty; approval only described in the comment.' }); }
      const row = ['RITM00' + r.TICKET_ID.slice(2), names[r.USER_ID] ? `${names[r.USER_ID]} (${r.USER_ID})` : r.USER_ID, 'SAP S/4HANA access', r.REQUESTED_ON + ' 09:1' + (i % 10) + ':44', ap[r.STATUS] || r.STATUS, approver, set, st[r.STATUS] || '', comment];
      rows.push(row);
      if (i === 40) rows.push([...row]); // exact duplicate line from the export
    });
    rows.push([], [`Total: ${s.ACCESS_REQUESTS.length + 1}`]);
    fs.writeFileSync(path.join(out, 'ServiceNow_RITM_access_requests.xlsx'), X.writeBook([{ name: 'Page 1', rows }]));
  }
  // 5. UST04 as CSV and the firefighter list from IT security
  fs.writeFileSync(path.join(out, 'SE16N_UST04_profiles.csv'), 'User Name,Profile\r\n' + s.UST04_PROFILES.map(p => `${p.BNAME},${p.PROFILE}`).join('\r\n') + `\r\nTotal ${s.UST04_PROFILES.length} entries\r\n`);
  {
    const rows = [...title('Approved privileged / firefighter IDs – FY2025', 'Owner: IT Security (CISO) · version 3, 02.01.2025'), [], hdr(['User ID', 'Profile / role', 'Approved by', 'Valid until'])];
    s.PRIVILEGED_APPROVED.forEach(p => rows.push([p.BNAME, p.PROFILE, p.APPROVED_BY, dmy(p.VALID_UNTIL)]));
    fs.writeFileSync(path.join(out, 'Firefighter_IDs_approved_list.xlsx'), X.writeBook([{ name: 'Approved IDs', rows }]));
  }
  // 6. STMS import history: tab text, SAP raw date + time in separate columns, no change ID column (only in the description)
  {
    const lines = [['Import History – System PRD'], [], ['Request', 'Owner', 'Short Description', 'Import Date', 'Import Time', 'Imported by']];
    s.E070_TRANSPORTS.forEach((t, i) => {
      const ref = t.CHANGE_ID ? (i % 3 === 0 ? t.CHANGE_ID.replace('CHG', 'CHG-') : t.CHANGE_ID) : '';
      const by = i === 17 && t.AS4USER !== t.IMPORTED_BY ? 'TMSADM' : t.IMPORTED_BY;
      if (by === 'TMSADM') planted.push({ control: 'C5', record_id: t.TRKORR, expected: 'REVIEW', why: 'Imported by technical user TMSADM – who triggered the import is not visible.' });
      lines.push([t.TRKORR, t.AS4USER, ref ? `${ref} ${t.DESCRIPTION}` : t.DESCRIPTION, raw8(t.IMPORT_PRD_TS), t.IMPORT_PRD_TS.slice(11, 19).replace(/:/g, ''), by]);
    });
    fs.writeFileSync(path.join(out, 'STMS_import_history_PRD.txt'), tsv(lines));
  }
  // 7. ServiceNow change requests: different names, month-name dates, some approval dates missing, vaguer test notes
  {
    const rows = [...title('change_request – Change Requests', 'Filter: Assignment group = SAP Basis/Development · Closed in 2025'), [],
      hdr(['Number', 'Type', 'Short description', 'Requested by', 'Approver', 'CAB approval date', 'Post-implementation review date', 'Test results', 'State'])];
    const devs = new Set(['CHG70036', 'CHG70114', 'CHG70123', 'CHG70162', 'CHG70321', 'CHG70420', 'CHG70429', 'CHG70600', 'CHG70675']);
    const tr = Object.fromEntries(s.E070_TRANSPORTS.filter(t => t.CHANGE_ID).map(t => [t.CHANGE_ID, t.TRKORR]));
    let gap = 0, vague = 0;
    s.CHANGE_TICKETS.forEach((c, i) => {
      let appr = c.APPROVED_TS ? monthName(c.APPROVED_TS) : '', test = c.TEST_EVIDENCE;
      if (!devs.has(c.CHANGE_ID) && tr[c.CHANGE_ID] && c.CHANGE_TYPE === 'STANDARD') {
        if (i % 37 === 3 && gap < 2) { appr = ''; gap++; planted.push({ control: 'C4', record_id: tr[c.CHANGE_ID], expected: 'REVIEW', why: 'Approver recorded but CAB approval date missing.' }); }
        else if (i % 29 === 11 && vague < 3) { test = 'Tested OK.'; vague++; planted.push({ control: 'C4', record_id: tr[c.CHANGE_ID], expected: 'REVIEW', why: 'Test note too vague to judge ("Tested OK.").' }); }
      }
      rows.push([c.CHANGE_ID, c.CHANGE_TYPE === 'EMERGENCY' ? 'Emergency' : 'Normal', c.SUMMARY, c.REQUESTED_BY, c.APPROVER, appr, c.POST_IMPL_APPROVED_TS ? monthName(c.POST_IMPL_APPROVED_TS) : '', test, c.STATUS === 'CLOSED' ? 'Closed' : c.STATUS]);
    });
    fs.writeFileSync(path.join(out, 'ServiceNow_change_requests.xlsx'), X.writeBook([{ name: 'Page 1', rows }]));
  }
  // 8. SM37 job overview as semicolon CSV with BOM: job count lost its leading zeros, descriptive status
  fs.writeFileSync(path.join(out, 'SM37_job_overview.csv'), '﻿Job Name;Job Count;Start date;Status\r\n' + s.TBTCO_JOBS.map(j => `${j.JOBNAME};${+j.JOBCOUNT};${dmy(j.SDLSTRTDT)};${j.STATUS === 'A' ? 'Canceled' : 'Finished'}`).join('\r\n') + '\r\n');
  // 9. ServiceNow incidents: job count only on some tickets, the rest identified by job name + date
  {
    const jobs = Object.fromEntries(s.TBTCO_JOBS.map(j => [j.JOBCOUNT, j]));
    const rows = [...title('incident – Incidents', 'Filter: Category = Batch processing · Opened in 2025'), [],
      hdr(['Number', 'Short description', 'Configuration item', 'Job count', 'Opened', 'Resolved', 'State', 'Resolution notes'])];
    s.INCIDENTS.forEach((i, n) => {
      const j = jobs[i.JOBCOUNT], byName = n % 3 === 1 && j && i.OPENED_ON >= j.SDLSTRTDT && i.OPENED_ON <= addDays(j.SDLSTRTDT, 3);
      rows.push([i.INCIDENT_ID, `Batch job ${j ? j.JOBNAME : '?'} cancelled`, j ? j.JOBNAME : '', byName ? '' : +i.JOBCOUNT, i.OPENED_ON + ' 07:4' + (n % 10) + ':00', i.RESOLVED_ON ? i.RESOLVED_ON + ' 16:00:00' : '', i.STATUS === 'CLOSED' ? (n % 2 ? 'Resolved' : 'Closed') : 'In Progress', i.RESOLUTION || '']);
    });
    fs.writeFileSync(path.join(out, 'ServiceNow_incidents.xlsx'), X.writeBook([{ name: 'Page 1', rows }]));
  }
  // answer key: the same 47 deviations (first sheet) + the planted review items (second sheet, for information)
  const key = Object.values(await X.readXlsx(fs.readFileSync(path.join(root, 'sample_data', 'ITGC_answer_key_FY2025_CONFIDENTIAL.xlsx'))))[0];
  fs.writeFileSync(path.join(out, 'ITGC_messy_answer_key_CONFIDENTIAL.xlsx'), X.writeXlsx([{ name: 'Deviations', rows: key }, { name: 'Expected_REVIEW_not_deviations', rows: planted }]));
  fs.writeFileSync(path.join(out, 'README.txt'), [
    'Messy ("real-world") version of the FY2025 synthetic evidence, generated by tools/make_messy_dataset.js.',
    'Same 47 seeded deviations as the clean dataset (answer key, first sheet). The second sheet of the key lists',
    `${planted.length} records that are NOT deviations but are ambiguous in these exports; the tool should send them to REVIEW.`,
    '', 'What is different from the clean file:',
    '- one file per system, in typical export formats (SE16N text in UTF-16, ServiceNow Excel, STMS log, SM37 CSV);',
    '- report titles above the header, footer/total lines, a repeated header line, a duplicate ticket line;',
    '- column names as shown in the source systems, not technical field names;',
    '- dates as DD.MM.YYYY, DD/MM/YYYY hh:mm:ss, 07-Nov-2025 19:00, YYYYMMDD + HHMMSS, real Excel dates, 31.12.9999 for "no end";',
    '- USR02 has no lock date: lock dates come from the change documents, which also contain unrelated events and a lock/unlock pair;',
    '- user IDs as "Name (USERID)", lower case or with trailing spaces; job counts without leading zeros;',
    '- no change ID column on transports: the change number is only in the description (sometimes as CHG-70000);',
    '- one third of incidents have no job count and must be linked by job name and date;',
    '- some approval dates and approvers missing, vague test notes, a technical import user (TMSADM).',
  ].join('\r\n'));
  console.log('Written to', out, '–', planted.length, 'planted review items');
})();
