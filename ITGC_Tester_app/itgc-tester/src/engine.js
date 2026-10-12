/* engine.js - ITGC testing logic. No user-interface code here, so the same
   functions run in the browser and in automated tests (Node). */
// HOW TO READ THIS FILE (for non-programmers)
// -------------------------------------------
// This file is the "audit brain" of the tool. It does not draw any screens; it only
// takes the evidence tables, applies the audit rules and returns the results.
// It is organised like an audit programme:
//   1. Evidence catalogue  – which evidence exists and what its columns are usually called
//   2. Control catalogue   – the six controls, their attributes (A, B, C...) and procedures
//   3. Default settings    – parameters the auditor can change (approvers, days, keywords...)
//   4. Value helpers       – small tools to read dates and user IDs written in many formats
//   5. Mapping             – connects the columns of YOUR files to the fields the rules need
//   6. Data checks         – completeness and accuracy (C&A) checks on the evidence (IPE)
//   7. Text checks         – judges free text (e.g. "UAT passed") with keywords or an AI model
//   8. Control tests       – the actual test of every item, attribute by attribute
//   9. Evaluation          – thesis metrics: precision, recall, F1, Cohen's kappa
//  10. Fingerprint         – SHA-256 "fingerprint" of each file for the run log
// Reading tips: "const x = ..." gives a name to something; "function name(...)" or
// "name => ..." is a small procedure; text after // is a comment for humans only.
// Everything is wrapped in one container called ITGC, so other files can use it as ITGC.something.
const ITGC = (() => {
  // Version number printed in the run log and on every workpaper.
  const VERSION = '2.0.0';

  // ===== 1. Evidence catalogue: what each type of evidence is and how its columns are usually called =====
  // Field types: id, text, date, datetime. Synonyms are compared ignoring case, spaces and punctuation.
  // "A+B" means: join columns A and B (e.g. a date column and a time column).
  // Each block below describes one TYPE of evidence ("entity"), for example the user master.
  // For each one:
  //   label  – the name shown to the auditor
  //   source – where this evidence typically comes from (shown on the C&A sheet)
  //   key    – the field that should identify each record uniquely (checked for duplicates)
  //   must   – fields a sheet must have before the automatic mapping accepts it as this evidence
  //   hints  – words in a sheet or file name that suggest this evidence (e.g. "USR02")
  //   fields – the fields the rules use. Each field has a type (id / text / date / datetime),
  //            a label, and "syn" = the different column names this field has in different
  //            systems (SAP technical name, SAP screen name, ServiceNow name, ...).
  //            The tool looks for these names in your files to map columns automatically.
  const ENTITIES = {
    // HR list of employees, including leavers – used for C2 (leavers).
    employees: { label: 'HR employee list', source: 'HR system export (all employees incl. leavers)', key: 'employee_id', must: ['termination_date'], hints: ['HR', 'EMPLOYEE', 'LEAVER', 'STAFF', 'PERSONNEL', 'WORKER', 'TERMINAT'],
      fields: {
        employee_id: { type: 'id', label: 'Employee number', syn: ['PERNR', 'Personnel number', 'Personnel no', 'Pers.No.', 'Employee ID', 'Employee number', 'Employee no', 'Emp ID', 'Worker ID', 'Staff ID'] },
        user_id: { type: 'id', label: 'SAP user ID', syn: ['USER_ID', 'SAP user', 'SAP user ID', 'SAP user name', 'User ID', 'Username', 'User name', 'System user', 'Login', 'BNAME'] },
        hire_date: { type: 'date', label: 'Hire date', syn: ['HIRE_DATE', 'Hire date', 'Entry date', 'Start date', 'Joining date', 'Date of hire'] },
        termination_date: { type: 'date', label: 'Termination date', syn: ['TERMINATION_DATE', 'Termination date', 'Leaving date', 'Exit date', 'Last working day', 'Separation date', 'Leave date', 'End date'] },
      } },
    // SAP user accounts (table USR02) – used for C1, C2 and C3.
    users: { label: 'User master', source: 'SAP USR02 via SE16N / SUIM (RSUSR200)', key: 'user_id', must: ['user_id'], hints: ['USR02', 'USER', 'SUIM', 'RSUSR200', 'ACCOUNT'],
      fields: {
        user_id: { type: 'id', label: 'User ID', syn: ['BNAME', 'User', 'User name', 'Username', 'User ID'] },
        user_type: { type: 'text', label: 'User type', syn: ['USTYP', 'User type', 'Type'] },
        created_on: { type: 'date', label: 'Created on', syn: ['ERDAT', 'Created on', 'Creation date', 'Date created', 'Created'] },
        created_by: { type: 'id', label: 'Created by', syn: ['ANAME', 'Created by', 'Creator', 'Creator of user'] },
        lock_flag: { type: 'text', label: 'Lock status', syn: ['UFLAG', 'Lock status', 'User lock status', 'Locked', 'Lock'] },
        lock_date: { type: 'date', label: 'Lock date', syn: ['LOCK_DATE', 'Lock date', 'Locked on', 'Date locked'] },
        valid_to: { type: 'date', label: 'Valid to', syn: ['GLTGB', 'Valid to', 'Valid through', 'Valid until', 'End of validity'] },
        last_logon: { type: 'date', label: 'Last logon', syn: ['TRDAT', 'Last logon', 'Last logon date', 'Last login', 'Last logon on'] },
      } },
    // History of lock / unlock events per user. Needed because USR02 itself has no lock date.
    user_locks: { label: 'User lock history', source: 'SAP USH02 / SUIM change documents for users (RSUSR100N)', key: null, must: ['user_id', 'changed_on'], hints: ['USH02', 'CHANGE DOC', 'CHANGEDOC', 'LOCK', 'HISTORY', 'RSUSR100'],
      fields: {
        user_id: { type: 'id', label: 'User ID', syn: ['BNAME', 'User', 'User name', 'User ID'] },
        changed_on: { type: 'datetime', label: 'Change date', syn: ['MODDA+MODTI', 'Date+Time', 'Change date+Change time', 'Changed on', 'Change date', 'MODDA', 'Date', 'Timestamp'] },
        event: { type: 'text', label: 'Change / event', syn: ['Change', 'Event', 'Action', 'Change type', 'Lock status', 'Text', 'Description'] },
      } },
    // Tickets requesting new user access – used for C1.
    access_requests: { label: 'Access request tickets', source: 'Ticketing tool export (e.g. ServiceNow RITM, Jira)', key: 'ticket_id', must: ['user_id'], hints: ['ACCESS', 'REQUEST', 'RITM', 'TICKET', 'SERVICENOW', 'JIRA', 'SR'],
      fields: {
        ticket_id: { type: 'id', label: 'Ticket number', syn: ['TICKET_ID', 'Number', 'Ticket', 'Ticket number', 'Request', 'Request ID', 'RITM', 'Key', 'Issue key', 'ID'] },
        user_id: { type: 'id', label: 'User ID requested for', syn: ['USER_ID', 'Requested for', 'User', 'User ID', 'New user', 'SAP user', 'User name'] },
        approved_by: { type: 'id', label: 'Approver', syn: ['APPROVED_BY', 'Approver', 'Approved by', 'Approval by'] },
        approved_on: { type: 'datetime', label: 'Approval date', syn: ['APPROVED_ON', 'Approval set', 'Approval date', 'Approved on', 'Approved date', 'Approved'] },
        status: { type: 'text', label: 'Approval status', syn: ['STATUS', 'Approval status', 'Approval', 'State', 'Ticket status'] },
        comments: { type: 'text', label: 'Comments', syn: ['COMMENTS', 'Comments and Work notes', 'Comments', 'Work notes', 'Notes', 'Description', 'Short description'] },
      } },
    // Which profiles / roles each user holds – used for C3 (privileged access).
    user_profiles: { label: 'User profiles / roles', source: 'SAP UST04 (profiles) or AGR_USERS (roles)', key: null, must: ['user_id', 'profile'], hints: ['UST04', 'AGR_USERS', 'PROFILE', 'ROLE', 'AUTH'],
      fields: {
        user_id: { type: 'id', label: 'User ID', syn: ['BNAME', 'UNAME', 'User', 'User name', 'User ID'] },
        profile: { type: 'text', label: 'Profile / role', syn: ['PROFILE', 'PROFN', 'AGR_NAME', 'Profile', 'Profile name', 'Profile / role', 'Role', 'Role name'] },
      } },
    // The client's list of users officially allowed to hold privileged access – C3.
    privileged_approved: { label: 'Approved privileged accounts', source: 'Client list of approved privileged / firefighter IDs', key: null, must: ['user_id'], hints: ['PRIVILEGED', 'FIREFIGHTER', 'APPROVED', 'SUPERUSER', 'EMERGENCY ACCESS', 'ADMIN'],
      fields: {
        user_id: { type: 'id', label: 'User ID', syn: ['BNAME', 'User', 'User name', 'User ID', 'Account'] },
        profile: { type: 'text', label: 'Approved profile', syn: ['PROFILE', 'Profile', 'Profile / role', 'Role', 'Approved profile', 'Approved role'] },
      } },
    // Program changes (SAP "transports") moved into the production system – C4 and C5.
    transports: { label: 'Transports to production', source: 'SAP E070 + import history (STMS / TPALOG)', key: 'transport_id', must: ['transport_id'], hints: ['E070', 'TPALOG', 'STMS', 'TRANSPORT', 'IMPORT'],
      fields: {
        transport_id: { type: 'id', label: 'Transport request', syn: ['TRKORR', 'Request', 'Transport', 'Transport request', 'Request/Task', 'Request number'] },
        owner: { type: 'id', label: 'Owner (developer)', syn: ['AS4USER', 'Owner', 'Developer', 'Request owner', 'Created by'] },
        imported_on: { type: 'datetime', label: 'Import to PRD', syn: ['IMPORT_PRD_TS', 'Import date+Import time', 'Imported on', 'Import date', 'Import timestamp', 'TRDATE+TRTIME', 'Date+Time'] },
        imported_by: { type: 'id', label: 'Imported by', syn: ['IMPORTED_BY', 'Imported by', 'Import user', 'TP user', 'User'] },
        change_id: { type: 'id', label: 'Change ticket ID', syn: ['CHANGE_ID', 'Change', 'Change ID', 'Change number', 'Change request', 'CR', 'RFC'] },
        description: { type: 'text', label: 'Description', syn: ['DESCRIPTION', 'AS4TEXT', 'Short description', 'Description', 'Short text', 'Text'] },
      } },
    // Change requests from the change management tool – C4.
    changes: { label: 'Change tickets', source: 'Change management tool export (e.g. ServiceNow CHG)', key: 'change_id', must: ['change_id'], hints: ['CHANGE', 'CHG', 'RFC', 'CAB'],
      fields: {
        change_id: { type: 'id', label: 'Change ID', syn: ['CHANGE_ID', 'Number', 'Change', 'Change number', 'Change ID', 'CR number', 'Key'] },
        change_type: { type: 'text', label: 'Change type', syn: ['CHANGE_TYPE', 'Type', 'Change type', 'Category'] },
        approver: { type: 'id', label: 'Approver', syn: ['APPROVER', 'Approver', 'Approved by', 'CAB', 'Approval by'] },
        approved_on: { type: 'datetime', label: 'Approval date', syn: ['APPROVED_TS', 'Approval date', 'Approved on', 'CAB date', 'CAB approval date', 'Approval set'] },
        post_approved_on: { type: 'datetime', label: 'Post-implementation approval', syn: ['POST_IMPL_APPROVED_TS', 'Post-implementation approval', 'Post implementation approval date', 'Post-implementation review date', 'PIR date', 'Retrospective approval'] },
        test_evidence: { type: 'text', label: 'Test evidence', syn: ['TEST_EVIDENCE', 'Test results', 'Test evidence', 'Testing', 'Test plan', 'UAT', 'Test notes'] },
      } },
    // Log of batch job runs (automatic background programs) – C6.
    job_runs: { label: 'Batch job runs', source: 'SAP TBTCO via SE16N / SM37', key: 'job_id', must: ['job_id', 'status'], hints: ['TBTCO', 'SM37', 'JOB', 'BATCH'],
      fields: {
        job_id: { type: 'id', label: 'Job count', syn: ['JOBCOUNT', 'Job count', 'Job ID', 'Job number', 'Run ID', 'Job Cnt'] },
        job_name: { type: 'text', label: 'Job name', syn: ['JOBNAME', 'Job name', 'Job'] },
        run_date: { type: 'date', label: 'Run date', syn: ['SDLSTRTDT', 'Start date', 'Run date', 'STRTDATE', 'Planned start date', 'Scheduled start', 'Date'] },
        status: { type: 'text', label: 'Status', syn: ['STATUS', 'Job status', 'Status', 'State'] },
      } },
    // Incident tickets raised when something fails – C6.
    incidents: { label: 'Incident tickets', source: 'Ticketing tool export (incidents)', key: 'incident_id', must: ['incident_id'], hints: ['INCIDENT', 'INC', 'TICKET'],
      fields: {
        incident_id: { type: 'id', label: 'Incident ID', syn: ['INCIDENT_ID', 'Number', 'Incident', 'Incident number', 'Ticket', 'Key', 'ID'] },
        job_id: { type: 'id', label: 'Job count', syn: ['JOBCOUNT', 'Job count', 'Job ID', 'Job number'] },
        job_name: { type: 'text', label: 'Job name', syn: ['JOBNAME', 'Job name', 'Configuration item', 'CI'] },
        description: { type: 'text', label: 'Short description', syn: ['Short description', 'Description', 'Summary', 'Title'] },
        opened_on: { type: 'date', label: 'Opened on', syn: ['OPENED_ON', 'Opened', 'Opened on', 'Created', 'Created on', 'Reported on'] },
        resolved_on: { type: 'date', label: 'Resolved on', syn: ['RESOLVED_ON', 'Resolved', 'Resolved on', 'Closed', 'Closed on'] },
        status: { type: 'text', label: 'Status', syn: ['STATUS', 'State', 'Incident state', 'Status'] },
        resolution: { type: 'text', label: 'Resolution', syn: ['RESOLUTION', 'Resolution notes', 'Close notes', 'Resolution', 'Solution'] },
      } },
  };
  // Two short look-up lists derived from the catalogue above (field types, and display names).
  const ENTITY_FIELDS = Object.fromEntries(Object.entries(ENTITIES).map(([k, v]) => [k, Object.fromEntries(Object.entries(v.fields).map(([f, d]) => [f, d.type]))]));
  const ENTITY_LABELS = Object.fromEntries(Object.entries(ENTITIES).map(([k, v]) => [k, v.label]));

  // ===== 2. Control catalogue: description, evidence needed, attributes and procedures =====
  // evidence: entity -> { required: true|false, fields: [fields without which the control cannot run] }
  // attribute needs: 'entity.field' – if any is missing the attribute is NOT TESTED (to be tested manually).
  // Each block describes one control in audit terms – the same texts appear on the leadsheet:
  //   name, area, description, objective, risk, type, nature, frequency – control information
  //   population – which items are tested (always the whole population, no sampling)
  //   evidence   – which evidence types the control needs; "required: true" means the control
  //                cannot run without it, "fields" lists the fields that must be present
  //   attributes – what is checked for each item (A, B, C, ...). Each attribute has:
  //                test = what must be true, procedure = what the tool does (printed on the
  //                leadsheet), needs = which evidence fields it requires. If a needed field is
  //                missing from the files, that attribute is marked NOT TESTED (test manually).
  //                "a|b" in needs means "a OR b is enough".
  const CONTROLS = {
    // C1 – User provisioning: every new user must have an approved access request.
    C1: {
      name: 'New user access approved before creation', area: 'Access to programs and data – user provisioning',
      description: 'New SAP user accounts are created only on the basis of an access request that has been approved by an authorised approver (line manager or role owner) before the account is created. The approver is independent of the administrator who creates the account.',
      objective: 'Logical access to the financially relevant application is granted only to authorised users.',
      risk: 'Unauthorised users obtain access to SAP and record unauthorised or erroneous transactions.',
      type: 'Preventive', nature: 'Manual (IT-dependent)', frequency: 'Ad hoc – each new user',
      population: 'All SAP users of the in-scope user types whose creation date falls within the audit period.',
      evidence: { users: { required: true, fields: ['user_id', 'created_on'] }, access_requests: { required: true, fields: ['user_id'] } },
      attributes: [
        { id: 'A', name: 'Access request exists', test: 'An access request ticket exists for the new user.', procedure: 'Matched every user in the population to the access request extract on user ID and verified that at least one request ticket exists.', needs: ['access_requests.user_id'] },
        { id: 'B', name: 'Request approved', test: 'The request has an approved status.', procedure: 'Inspected the status of the matched ticket and verified that it is a status defined as "approved" (see Parameters).', needs: ['access_requests.status'] },
        { id: 'C', name: 'Authorised, independent approver', test: 'The approver is an authorised approver and is not the person who created the user.', procedure: 'Compared the approver on the ticket with the list of authorised approvers and with the user who created the account (USR02-ANAME).', needs: ['access_requests.approved_by'] },
        { id: 'D', name: 'Approved before creation', test: 'Approval was given on or before the date the user was created.', procedure: 'Compared the approval date on the ticket with the user creation date (USR02-ERDAT).', needs: ['access_requests.approved_on'] },
      ],
    },
    // C2 – Leavers: access of people who left the company must be removed within N days.
    C2: {
      name: 'Leavers’ access removed timely', area: 'Access to programs and data – user de-provisioning',
      description: 'SAP access of employees leaving the company is removed (user locked or validity ended) within the defined number of days after the termination date notified by HR.',
      objective: 'Access of terminated employees is removed timely so that it cannot be misused.',
      risk: 'Terminated employees, or others using their accounts, retain access to SAP and record unauthorised transactions.',
      type: 'Preventive', nature: 'Manual (IT-dependent)', frequency: 'Ad hoc – each leaver',
      population: 'All employees with a termination date within the audit period according to the HR system.',
      evidence: { employees: { required: true, fields: ['termination_date'] }, users: { required: true, fields: ['user_id'] }, user_locks: { required: false, fields: [] } },
      attributes: [
        { id: 'A', name: 'User account identified', test: 'The leaver’s SAP account is identified in the user master.', procedure: 'Matched each leaver from the HR list to the SAP user master on the SAP user ID recorded in HR.', needs: ['employees.user_id'] },
        { id: 'B', name: 'Access removed within allowed days', test: 'The account was locked or its validity ended within the allowed number of days after termination.', procedure: 'Compared the termination date with the lock date (user master or lock history) or the end of validity, and calculated the days between them.', needs: ['users.lock_date|users.lock_flag|users.valid_to|user_locks.changed_on'] },
        { id: 'C', name: 'No logon after termination', test: 'The account was not used after the termination date.', procedure: 'Compared the last logon date of the account with the termination date.', needs: ['users.last_logon'] },
      ],
    },
    // C3 – Privileged access: powerful profiles (e.g. SAP_ALL) only for approved accounts.
    C3: {
      name: 'Privileged access restricted', area: 'Access to programs and data – privileged access',
      description: 'Privileged profiles (e.g. SAP_ALL, SAP_NEW) are assigned only to a limited number of approved accounts (emergency / firefighter or technical accounts). Assignments are approved and monitored by IT security.',
      objective: 'Super-user access is restricted to authorised accounts.',
      risk: 'Users with excessive access bypass segregation of duties and change data or configuration without authorisation.',
      type: 'Preventive', nature: 'Manual (IT-dependent)', frequency: 'Continuous / reviewed periodically',
      population: 'All active (not locked, valid) users of the in-scope user types in the user master at the extraction date.',
      evidence: { users: { required: true, fields: ['user_id'] }, user_profiles: { required: true, fields: ['user_id', 'profile'] }, privileged_approved: { required: false, fields: ['user_id'] } },
      attributes: [
        { id: 'A', name: 'No unapproved privileged profile', test: 'If the user holds a privileged profile, the user is on the approved privileged list.', procedure: 'Identified all privileged profiles assigned to each active user and compared the users holding them with the approved privileged account list.', needs: ['user_profiles.profile'] },
      ],
    },
    // C4 – Change management: every change in production approved and tested beforehand.
    C4: {
      name: 'Changes approved and tested before import', area: 'Program change management',
      description: 'Every transport imported into the production system is linked to a change ticket that was approved before the import (emergency changes: approved after implementation) and contains evidence of user acceptance testing.',
      objective: 'Only authorised, tested changes are moved to production.',
      risk: 'Unauthorised or untested changes to programs or configuration cause incorrect processing of financial data.',
      type: 'Preventive', nature: 'Manual (IT-dependent)', frequency: 'Ad hoc – each change',
      population: 'All transport requests imported into the production system within the audit period.',
      evidence: { transports: { required: true, fields: ['transport_id', 'imported_on'] }, changes: { required: true, fields: ['change_id'] } },
      attributes: [
        { id: 'A', name: 'Change ticket exists', test: 'The transport is linked to a change ticket that exists in the change tool.', procedure: 'Traced the change ID on each transport (or a change reference in the transport description) to the change ticket extract.', needs: ['transports.change_id|transports.description'] },
        { id: 'B', name: 'Approved before import', test: 'The change was approved before import; emergency changes were approved after implementation.', procedure: 'Compared the approval timestamp on the change ticket with the import timestamp; for emergency changes verified the post-implementation approval.', needs: ['changes.approved_on'] },
        { id: 'C', name: 'User acceptance testing evidenced', test: 'The ticket shows that the change was tested and accepted by the business.', procedure: 'Assessed the test evidence text on the change ticket (keyword rules or language model, see Parameters); unclear texts sent to auditor review.', needs: ['changes.test_evidence'] },
      ],
    },
    // C5 – Segregation of duties: the developer may not move their own change into production.
    C5: {
      name: 'Developers do not import own changes', area: 'Program change management – segregation of duties',
      description: 'Transports are imported into production by a user other than the developer who created the transport.',
      objective: 'Segregation of duties between development and migration to production.',
      risk: 'Developers move unauthorised or untested code into production without independent review.',
      type: 'Preventive', nature: 'Manual (IT-dependent)', frequency: 'Ad hoc – each change',
      population: 'All transport requests imported into the production system within the audit period.',
      evidence: { transports: { required: true, fields: ['transport_id', 'imported_on'] } },
      attributes: [
        { id: 'A', name: 'Importer is not the developer', test: 'The user who imported the transport is different from the transport owner.', procedure: 'Compared the transport owner (E070-AS4USER) with the user who performed the import into production.', needs: ['transports.owner', 'transports.imported_by'] },
      ],
    },
    // C6 – Operations: failed batch jobs must be followed up through a resolved incident.
    C6: {
      name: 'Failed jobs followed up and resolved', area: 'Computer operations – job scheduling',
      description: 'Failed (cancelled) batch jobs are logged as incidents, investigated and resolved; the resolution is documented.',
      objective: 'Processing failures are identified and resolved so that financial data is complete.',
      risk: 'Failed interfaces or batch jobs are not resolved, resulting in incomplete or inaccurate financial data.',
      type: 'Detective', nature: 'Manual (IT-dependent)', frequency: 'Daily / ad hoc',
      population: 'All batch job runs with a failed status scheduled within the audit period.',
      evidence: { job_runs: { required: true, fields: ['job_id', 'run_date', 'status'] }, incidents: { required: true, fields: [] } },
      attributes: [
        { id: 'A', name: 'Incident logged', test: 'An incident ticket exists for the failed job.', procedure: 'Traced each failed job to the incident extract on the job count, or on job name and date where the job count is not recorded.', needs: ['incidents.job_id|incidents.job_name|incidents.description'] },
        { id: 'B', name: 'Incident resolved', test: 'The incident is resolved / closed.', procedure: 'Inspected the incident status at extraction date.', needs: ['incidents.status'] },
        { id: 'C', name: 'Resolution documented', test: 'The resolution notes show that the cause was addressed (e.g. job rerun, data reconciled).', procedure: 'Assessed the resolution text (keyword rules or language model, see Parameters); unclear texts sent to auditor review.', needs: ['incidents.resolution'] },
      ],
    },
  };
  // Short look-ups derived from the catalogue: the list of control IDs, the evidence each
  // control requires, and (controlEntities) all evidence needed for a chosen set of controls –
  // this is what the "Load evidence" checklist shows when you test only some controls.
  const CONTROL_IDS = Object.keys(CONTROLS);
  const CONTROL_NEEDS = Object.fromEntries(CONTROL_IDS.map(c => [c, Object.entries(CONTROLS[c].evidence).filter(([, e]) => e.required).map(([k]) => k)]));
  const controlEntities = ids => [...new Set(ids.flatMap(c => Object.keys(CONTROLS[c].evidence)))];

  // ===== 3. Default settings (all can be changed in the app or in a settings file) =====
  // Default leadsheet texts for a control, taken from the control catalogue (editable in the app).
  const wpDefaults = c => ({ ref: c, owner: '', description: CONTROLS[c].description, risk: CONTROLS[c].risk, frequency: CONTROLS[c].frequency, type: CONTROLS[c].type, nature: CONTROLS[c].nature, key: 'Yes' });
  // The starting settings. Everything here can be changed in the app (step 4 "Settings")
  // and saved to a file for the audit documentation.
  //   period     – the audit period; only events inside it are tested
  //   engagement – client name, system, workpaper reference prefix, reviewer
  //   date_order – how to read ambiguous dates like 03/04/2025 (day first or month first)
  //   mapping    – for each evidence type: which sheet and which column holds each field.
  //                These defaults match the demo file; for other files the app maps automatically.
  //   controls   – the parameters of each control test (see the comments on each line)
  //   ai         – how free text is judged: keyword rules (default) or a language model
  const DEFAULT_SETTINGS = {
    settings_version: '2.0',
    period: { start: '2025-01-01', end: '2025-12-31' },
    engagement: { client: 'Demo Company SIA', system: 'SAP S/4HANA – production client (PRD)', wp_prefix: 'ITGC', reviewer: '' },
    date_order: 'auto', // auto | DMY | MDY  (for dates like 03/04/2025)
    // Where each piece of evidence is found: sheet name and column names in YOUR files
    mapping: {
      employees: { sheet: 'HR_EMPLOYEES', fields: { employee_id: 'PERNR', user_id: 'USER_ID', hire_date: 'HIRE_DATE', termination_date: 'TERMINATION_DATE' } },
      users: { sheet: 'USR02_USERS', fields: { user_id: 'BNAME', user_type: 'USTYP', created_on: 'ERDAT', created_by: 'ANAME', lock_flag: 'UFLAG', lock_date: 'LOCK_DATE', valid_to: 'GLTGB', last_logon: 'TRDAT' } },
      user_locks: { sheet: '', fields: {} },
      access_requests: { sheet: 'ACCESS_REQUESTS', fields: { ticket_id: 'TICKET_ID', user_id: 'USER_ID', approved_by: 'APPROVED_BY', approved_on: 'APPROVED_ON', status: 'STATUS', comments: 'COMMENTS' } },
      user_profiles: { sheet: 'UST04_PROFILES', fields: { user_id: 'BNAME', profile: 'PROFILE' } },
      privileged_approved: { sheet: 'PRIVILEGED_APPROVED', fields: { user_id: 'BNAME', profile: 'PROFILE' } },
      transports: { sheet: 'E070_TRANSPORTS', fields: { transport_id: 'TRKORR', owner: 'AS4USER', imported_on: 'IMPORT_PRD_TS', imported_by: 'IMPORTED_BY', change_id: 'CHANGE_ID', description: 'DESCRIPTION' } },
      changes: { sheet: 'CHANGE_TICKETS', fields: { change_id: 'CHANGE_ID', change_type: 'CHANGE_TYPE', approver: 'APPROVER', approved_on: 'APPROVED_TS', post_approved_on: 'POST_IMPL_APPROVED_TS', test_evidence: 'TEST_EVIDENCE' } },
      job_runs: { sheet: 'TBTCO_JOBS', fields: { job_id: 'JOBCOUNT', job_name: 'JOBNAME', run_date: 'SDLSTRTDT', status: 'STATUS' } },
      incidents: { sheet: 'INCIDENTS', fields: { incident_id: 'INCIDENT_ID', job_id: 'JOBCOUNT', opened_on: 'OPENED_ON', resolved_on: 'RESOLVED_ON', status: 'STATUS', resolution: 'RESOLUTION' } },
    },
    controls: {
      // C1 parameters: user types in scope (A = dialog user), which ticket statuses count as
      // "approved", the list of authorised approvers, and words in a ticket comment that do /
      // do not suggest an approval (used only when the approver field itself is empty).
      C1: { enabled: true, name: CONTROLS.C1.name, user_types: ['A', 'Dialog'], approved_status: ['APPROVED'], authorised_approvers: ['MOZOLS', 'ILIEPA', 'KBERZINS', 'DABELE'],
        approval_text: { positive: ['approved by', 'approval received', 'approved via', 'approval attached'], negative: ['verbal', 'by phone', 'will be added later', 'pending', 'rejected', 'no approval'] }, wp: wpDefaults('C1') },
      // C2: maximum days allowed between termination and lock; words that mean "lock" / "unlock" in the lock history.
      C2: { enabled: true, name: CONTROLS.C2.name, max_days: 3, lock_events: ['lock'], unlock_events: ['unlock'], wp: wpDefaults('C2') },
      // C3: user types in scope and the list of profiles that count as "privileged".
      C3: { enabled: true, name: CONTROLS.C3.name, user_types: ['A', 'Dialog'], privileged_profiles: ['SAP_ALL', 'SAP_NEW', 'S_A.SYSTEM'], wp: wpDefaults('C3') },
      // C4: change types that count as emergency changes; the pattern of a change number inside a
      // transport description (e.g. CHG70000 or CHG-70000); and keywords that show good testing
      // (positive) or missing testing (negative) in the ticket's test notes.
      C4: { enabled: true, name: CONTROLS.C4.name, emergency_types: ['EMERGENCY'], ref_pattern: '\\b(CHG|CR|RFC)[-_ ]?\\d{3,}\\b',
        text: { positive: ['UAT', 'user acceptance', 'QAS by business', 'tested by business', 'key user', 'sign-off', 'signed off'], negative: ['no testing', 'not needed', 'not tested', 'by developer', 'in DEV'] }, wp: wpDefaults('C4') },
      // C5: technical users (e.g. TMSADM) – an import by them hides who really did it, so it goes to review.
      C5: { enabled: true, name: CONTROLS.C5.name, technical_import_users: ['TMSADM', 'DDIC'], wp: wpDefaults('C5') },
      // C6: which job statuses mean "failed", which incident statuses mean "resolved", how many days
      // after a failure an incident may be opened to still be linked by job name, and keywords for
      // a real fix (positive) or no real fix (negative) in the resolution notes.
      C6: { enabled: true, name: CONTROLS.C6.name, failed_status: ['A', 'CANCELED', 'CANCELLED', 'ABORTED', 'FAILED'], closed_status: ['CLOSED', 'RESOLVED', 'CLOSED COMPLETE'], link_days: 3,
        text: { positive: ['rerun', 're-run', 'restarted', 'reloaded', 'reprocessed', 'reconciled'], negative: ['no action', 'n/a', 'duplicate'] }, wp: wpDefaults('C6') },
    },
    // Free-text assessment: "keywords" (no AI) or "llm" (local language model, e.g. Ollama), and how many times to repeat each AI check.
    ai: { mode: 'keywords', provider: 'ollama', url: 'http://localhost:11434', model: 'llama3.1:8b', api_key: '', runs: 1 },
  };
  // Makes an independent copy of the settings, so changing the copy does not change the original.
  const clone = o => JSON.parse(JSON.stringify(o));

  // ===== 4. Value helpers =====
  // Value helpers: real exports write the same thing in many ways. These small tools make
  // values comparable. "blank" = the cell is empty (or only spaces).
  const blank = v => v === null || v === undefined || String(v).replace(/ /g, ' ').trim() === '';
  // IDs: trimmed; "Name Surname (USERID)" -> USERID; numbers kept as text without ".0"
  // Cleans an identifier such as a user ID: removes spaces, and if the export shows a display
  // name like "Ilze Vitola (IVITOLA)" it keeps only the ID in brackets: "IVITOLA".
  const id = v => {
    if (blank(v)) return null;
    let s = String(v).replace(/ /g, ' ').trim();
    const m = s.match(/^[^()]*\S\s*\(([A-Za-z0-9_.@\-]+)\)$/); if (m) s = m[1];
    return s;
  };
  // Makes two IDs comparable: upper case ("ivitola" = "IVITOLA") and, for numbers, without
  // leading zeros (job count "00000712" = "712", because Excel often drops the zeros).
  const normId = v => { const s = id(v); return s === null ? null : (/^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s.toUpperCase()); };
  // Month names, so that dates like "07-Nov-2025" or "Dec 31, 2025" can be read.
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  // SAP writes an empty date as 00000000 or 00.00.0000 – such values mean "no date".
  const NULL_DATE = /^0{4}-?0{2}-?0{2}|^0{2}[./]0{2}[./]0{4}|^0{8}/;
  // returns milliseconds (UTC) or null. order: 'DMY' or 'MDY' for ambiguous dd/mm/yyyy dates
  // Reads a date written in any common format and converts it to one internal number
  // (milliseconds since 1970, the usual way computers store time). Returns nothing (null) if the
  // value is not a valid date. It tries the formats one after the other:
  function parseDate(v, order = 'DMY') {
    if (blank(v)) return null;
    // Already a date (Excel date cell) – use it as it is.
    if (v instanceof Date) return isNaN(v) ? null : v.getTime();
    // A number: either an Excel date serial number (days since 1900) or SAP style 20251231.
    if (typeof v === 'number') return v > 20000 && v < 80000 ? Math.round((v - 25569) * 86400000) : (v >= 19000101 && v <= 99991231 ? parseDate(String(v)) : null);
    const s = String(v).replace(/ /g, ' ').trim();
    // SAP "empty date" → no date.
    if (NULL_DATE.test(s)) return null;
    // Helper: reads the time part (hours, minutes, seconds, AM/PM).
    const time = (h, mi, se, ap) => { let H = +(h || 0); if (ap) { ap = ap.toUpperCase(); if (ap === 'PM' && H < 12) H += 12; if (ap === 'AM' && H === 12) H = 0; } return [H, +(mi || 0), +(se || 0)]; };
    // Helper: builds the date and rejects impossible ones (e.g. 31.02.2025). Two-digit years mean 20xx.
    const ok = (y, mo, d, t = [0, 0, 0]) => { if (y < 100) y += 2000; if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900) return null; const ms = Date.UTC(y, mo - 1, d, ...t); return new Date(ms).getUTCDate() === d ? ms : null; };
    // Format 1: year first – 2025-12-31, 2025/12/31, optionally with time and time zone.
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(AM|PM)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
    if (m) { const ms = ok(+m[1], +m[2], +m[3], time(m[4], m[5], m[6], m[7])); if (ms === null || !m[8] || /^z$/i.test(m[8])) return ms; const z = m[8].replace(':', ''); return ms - (z[0] === '-' ? -1 : 1) * (+z.slice(1, 3) * 60 + +z.slice(3, 5)) * 60000; }
    // Format 2: day and month first – 31.12.2025 or 12/31/2025. When both numbers are 12 or less
    // (03/04/2025) the "order" setting decides whether it is 3 April or 4 March.
    m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
    if (m) { const [a, b] = [+m[1], +m[2]]; const dmy = order === 'MDY' ? (b > 12 && a <= 12 ? false : a > 12 ? true : false) : !(b > 12 && a <= 12); return dmy ? ok(+m[3], b, a, time(m[4], m[5], m[6], m[7])) : ok(+m[3], a, b, time(m[4], m[5], m[6], m[7])); }
    // Format 3: SAP raw format 20251231, optionally followed by a time 143005.
    m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\s*(\d{2}):?(\d{2}):?(\d{2}))?$/); // YYYYMMDD [HHMMSS] (SAP raw)
    if (m) return ok(+m[1], +m[2], +m[3], time(m[4], m[5], m[6]));
    // Format 4: day, month name, year – 31-Dec-2025, 31 Dec 2025.
    m = s.match(/^(\d{1,2})[-\s.]([A-Za-z]{3,9})\.?[-\s.,]+(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/); // 31-Dec-2025
    if (m && MONTHS[m[2].toLowerCase()]) return ok(+m[3], MONTHS[m[2].toLowerCase()], +m[1], time(m[4], m[5], m[6], m[7]));
    // Format 5: month name first – Dec 31, 2025.
    m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/); // Dec 31, 2025
    if (m && MONTHS[m[1].toLowerCase()]) return ok(+m[3], MONTHS[m[1].toLowerCase()], +m[2], time(m[4], m[5], m[6], m[7]));
    // Nothing matched – not a readable date (reported as a WARNING in the data checks).
    return null;
  }
  // which order do ambiguous dd/mm vs mm/dd values in a column follow?
  // Looks at all dates in one column to decide whether it is day/month or month/day:
  // if any value has a first number above 12 (e.g. 25/03/2025) the column must be day-first;
  // if any has a second number above 12 (03/25/2025) it must be month-first.
  function detectDateOrder(values, fallback) {
    let dmy = 0, mdy = 0;
    for (const v of values) { const m = typeof v === 'string' && v.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-]\d{2,4}/); if (!m) continue; if (+m[1] > 12) dmy++; if (+m[2] > 12) mdy++; }
    if (dmy && !mdy) return { order: 'DMY', how: 'detected' };
    if (mdy && !dmy) return { order: 'MDY', how: 'detected' };
    if (dmy && mdy) return { order: fallback, how: 'conflicting – check' };
    return { order: fallback, how: 'assumed' };
  }
  // Date arithmetic helpers: DAY = one day in milliseconds; day0 = the same date at midnight
  // (so that times are ignored); fmtD / fmtDT = print a date as 2025-12-31 (with time);
  // daysBetween = number of calendar days between two dates.
  const DAY = 86400000;
  const day0 = ms => ms === null ? null : Math.floor(ms / DAY) * DAY;
  const fmtD = ms => ms === null || ms === undefined ? '' : new Date(ms).toISOString().slice(0, 10);
  const fmtDT = ms => ms === null || ms === undefined ? '' : new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  const daysBetween = (a, b) => Math.round((day0(b) - day0(a)) / DAY);
  // Comparison helpers: "up" tidies text (single spaces, upper case); "inList" checks whether a
  // value is in a parameter list ignoring case – e.g. is status "Approved" in ["APPROVED"]?
  // "colKey" reduces a column name to letters and digits so that "Pers.No." = "PERS NO".
  const up = v => String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  const inList = (v, list) => !blank(v) && (list || []).map(up).includes(up(v));
  const colKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const OPEN_END = Date.UTC(9000, 0, 1); // dates from 9000 on mean "no end" (e.g. 31.12.9999)

  // ===== 5. Mapping your files to the common data model =====
  // resolve a mapping value ("COL" or "COL1+COL2") against the columns of a sheet
  // Finds the column(s) named in the mapping in a sheet. A mapping may join two columns with
  // "+", e.g. "Import Date+Import Time" when the date and the time are in separate columns.
  function resolveCols(cols, spec) {
    if (blank(spec)) return null;
    const parts = String(spec).split('+').map(p => p.trim()).filter(Boolean);
    const found = parts.map(p => cols.find(c => c.trim().toUpperCase() === p.toUpperCase()) || cols.find(c => colKey(c) === colKey(p)));
    return found.every(Boolean) ? found : null;
  }
  // Finds a loaded sheet by name, ignoring upper/lower case.
  const findSheet = (sheets, name) => blank(name) ? null : Object.keys(sheets).find(s => s.trim().toUpperCase() === String(name).trim().toUpperCase()) || null;

  // MAPPING: turns your loaded sheets into the standard evidence records the rules work with.
  // For each evidence type: find the sheet named in the mapping, find each column, and copy
  // every row into a clean record (dates converted, IDs cleaned). It also notes:
  //   - which fields are available (avail) – missing ones make attributes NOT TESTED
  //   - problems (issues), e.g. a column named in the mapping that is not in the file
  //   - background facts for the C&A sheet (meta): header row, excluded lines, columns used.
  // "only" limits the work to the evidence needed by the controls in scope.
  function mapEntities(sheets, settings, only) {
    const entities = {}, issues = [], avail = {}, meta = {};
    const wanted = only ? Object.keys(ENTITIES).filter(e => only.includes(e)) : Object.keys(ENTITIES);
    for (const ent of wanted) {
      const def = ENTITIES[ent], m = settings.mapping[ent] || { sheet: '', fields: {} };
      avail[ent] = {};
      // Evidence type not mapped to any sheet – note it and move on.
      if (blank(m.sheet)) { issues.push({ entity: ent, level: 'info', text: `${def.label}: not mapped.` }); continue; }
      const sheetName = findSheet(sheets, m.sheet);
      if (!sheetName) { issues.push({ entity: ent, level: 'warning', text: `${def.label}: sheet "${m.sheet}" not found in the loaded files.` }); continue; }
      // The rows of the sheet, plus the reader's notes about it (header row, excluded lines...).
      const rows = sheets[sheetName], sm = rows.meta || {};
      const cols = sm.columns?.length ? sm.columns : (rows.length ? Object.keys(rows[0]) : []);
      const res = {}, missing = [];
      // Look up the column(s) for each field and remember whether the field is available.
      for (const f of Object.keys(def.fields)) {
        const spec = (m.fields || {})[f];
        res[f] = resolveCols(cols, spec);
        avail[ent][f] = !!res[f];
        if (!blank(spec) && !res[f]) missing.push(`${f} → "${spec}"`);
      }
      if (missing.length) issues.push({ entity: ent, level: 'warning', text: `${def.label}: column(s) not found: ${missing.join(', ')}.` });
      // Helper: the raw cell value of a field in one row (joins two columns if the mapping says "A+B").
      const raw = (r, f) => { const c = res[f]; if (!c) return null; const vs = c.map(x => r[x]).filter(x => !blank(x)); return vs.length ? (vs.length === 1 ? vs[0] : vs.join(' ')) : null; };
      // date order per column (dd/mm vs mm/dd)
      const orders = {};
      for (const [f, d] of Object.entries(def.fields)) if ((d.type === 'date' || d.type === 'datetime') && res[f]) orders[f] = detectDateOrder(rows.slice(0, 5000).map(r => raw(r, f)), settings.date_order === 'MDY' ? 'MDY' : 'DMY');
      // Keep the facts about this source for the data checks and the C&A sheet of the workpaper.
      meta[ent] = { sheet: sheetName, headerRow: sm.headerRow || 1, titleLines: sm.titleLines || [], excluded: sm.excluded || [], columns: cols, resolved: Object.fromEntries(Object.entries(res).filter(([, v]) => v).map(([k, v]) => [k, v.join(' + ')])), dateOrders: orders };
      // Convert every row into a clean record. Each record also remembers its original row
      // number (_row) and the original row (_raw) so the workpaper can show the evidence as received.
      // Unreadable dates are kept aside as "_bad_..." so the data checks can report them.
      entities[ent] = rows.map((r, i) => {
        const o = { _row: sm.rowNumbers ? sm.rowNumbers[i] : i + 2, _sheet: sheetName, _raw: r };
        for (const [f, d] of Object.entries(def.fields)) {
          const v = raw(r, f);
          if (d.type === 'date' || d.type === 'datetime') { o[f] = parseDate(v, orders[f]?.order); if (!blank(v) && o[f] === null && !NULL_DATE.test(String(v).trim())) o['_bad_' + f] = String(v); }
          else o[f] = d.type === 'id' ? id(v) : (blank(v) ? null : String(v).replace(/ /g, ' ').trim());
        }
        return o;
      });
    }
    return { entities, issues, avail, meta };
  }

  // Suggest sheet and column mapping from sheet names and column names (synonyms).
  // AUTOMATIC MAPPING: guesses which sheet holds which evidence and which column holds which
  // field, by comparing column names with the synonym lists in the evidence catalogue.
  // Each (evidence, sheet) pair gets a score: more recognised fields, the key field present,
  // and a hint in the sheet name (e.g. "USR02") all raise the score. Then the best pairs are
  // chosen, each sheet used only once. The auditor can always correct the result in step 3.
  function autoMap(sheets, settings, ents, exclude = []) {
    const names = Object.keys(sheets), used = new Set(exclude), out = {}, report = [];
    const colsOf = s => sheets[s].meta?.columns?.length ? sheets[s].meta.columns : (sheets[s].length ? Object.keys(sheets[s][0]) : []);
    // For one sheet: find, field by field, the first synonym that exists as a column.
    const fieldMatch = (cols, def, taken) => {
      const fm = {};
      for (const [f, d] of Object.entries(def.fields)) {
        for (const syn of d.syn) { const r = resolveCols(cols, syn); if (r && !r.some(c => taken.has(c))) { fm[f] = syn.includes('+') ? r.join('+') : r[0]; r.forEach(c => taken.add(c)); break; } }
      }
      return fm;
    };
    const cands = [];
    for (const ent of ents) {
      const def = ENTITIES[ent];
      for (const s of names) {
        const cols = colsOf(s), fm = fieldMatch(cols, def, new Set());
        const n = Object.keys(fm).length; if (!n || def.must.some(f => !fm[f])) continue;
        const keyOk = !def.key || fm[def.key] ? 1 : 0;
        const hint = def.hints.some(h => colKey(s).includes(colKey(h))) ? 1 : 0;
        const exact = settings.mapping[ent]?.sheet && colKey(settings.mapping[ent].sheet) === colKey(s) ? 1 : 0;
        cands.push({ ent, s, fm, score: n * 10 / Object.keys(def.fields).length * 3 + keyOk * 8 + hint * 12 + exact * 30, n });
      }
    }
    // Best matches first; give each evidence type its best still-unused sheet.
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands) {
      if (out[c.ent] || used.has(c.s)) continue;
      out[c.ent] = { sheet: c.s, fields: c.fm };
      used.add(c.s);
      report.push({ entity: c.ent, sheet: c.s, matched: c.n, of: Object.keys(ENTITIES[c.ent].fields).length });
    }
    for (const ent of ents) if (!out[ent]) report.push({ entity: ent, sheet: null, matched: 0, of: Object.keys(ENTITIES[ent].fields).length });
    return { mapping: out, report };
  }

  // ===== 6. Data completeness and accuracy checks on the evidence (IPE) =====
  // Counts how often each value occurs in a column, e.g. "APPROVED: 106; REJECTED: 1".
  function valueProfile(rows, f, max = 12) {
    const m = new Map(); rows.forEach(r => { const k = blank(r[f]) ? '(empty)' : up(r[f]); m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
  }
  // DATA CHECKS on the evidence (information produced by the entity, IPE). These support the
  // auditor's completeness and accuracy work and are copied to the C&A sheet. Each check gets
  // a status: OK, INFO (for information), WARNING (investigate), FAIL or MISSING.
  function dataChecks(E, settings, mapped = {}) {
    const out = [], S = settings, p0 = parseDate(S.period.start), p1 = parseDate(S.period.end) + DAY - 1;
    const add = (entity, check, status, detail) => out.push({ entity, Evidence: ENTITY_LABELS[entity] || entity, Check: check, Status: status, Detail: detail });
    const meta = mapped.meta || {}, avail = mapped.avail || {};
    const ents = mapped.only || Object.keys(E), req = mapped.required ? new Set(mapped.required) : null;
    for (const ent of ents) {
      const rows = E[ent], def = ENTITIES[ent], mt = meta[ent];
      // Evidence not loaded: MISSING if a control needs it, otherwise just INFO (optional evidence).
      if (!rows) { const must = !req || req.has(ent); add(ent, 'Evidence loaded', must ? 'MISSING' : 'INFO', must ? 'Not loaded or not mapped. Controls that need it cannot run.' : 'Optional evidence not provided. Attributes that use it are tested with the other evidence or sent to review.'); continue; }
      if (mt) {
        // Where the data came from, and title lines that were skipped above the header.
        add(ent, 'Source', 'INFO', `Sheet "${mt.sheet}", header on row ${mt.headerRow}${mt.titleLines.length ? `; ${mt.titleLines.length} title line(s) above the header skipped ("${mt.titleLines[0].slice(0, 80)}")` : ''}.`);
        // Lines that were not treated as records (footer totals, repeated headers) – the auditor confirms none is real.
        const ex = mt.excluded.filter(e => !e.kept);
        if (ex.length) add(ent, 'Lines not treated as records', 'INFO', `${ex.length} line(s) excluded: ` + ex.slice(0, 4).map(e => `row ${e.row} ${e.reason.toLowerCase()} ("${String(e.text).slice(0, 40)}")`).join('; ') + (ex.length > 4 ? '…' : '') + '. Confirm none of them is a real record.');
        // Values sitting in columns without a header usually mean a shifted, broken extract.
        const kept = mt.excluded.filter(e => e.kept);
        if (kept.length) add(ent, 'Values outside header columns', 'WARNING', `${kept.length} row(s) have values in columns without a header (e.g. row ${kept[0].row}). The extract may be shifted – check it.`);
        // Fields that are not in the extract – the attributes needing them will be NOT TESTED.
        const notMapped = Object.keys(def.fields).filter(f => !avail[ent]?.[f]);
        if (notMapped.length) add(ent, 'Fields not available', 'INFO', `Not mapped / not in extract: ${notMapped.map(f => def.fields[f].label).join(', ')}. An attribute that has no other source for this information is marked NOT TESTED (see Run tests).`);
      }
      // Completeness: how many records the extract contains (to reconcile with the system).
      add(ent, 'Record count', rows.length ? 'OK' : 'FAIL', `${rows.length} records`);
      // Completeness / accuracy: is the key field always filled and unique? Duplicates are tested once.
      if (def.key && avail[ent]?.[def.key] !== false) {
        const k = def.key, empty = rows.filter(r => blank(r[k])).length;
        const seen = new Map(); rows.forEach(r => { const v = normId(r[k]); if (v) seen.set(v, (seen.get(v) || 0) + 1); });
        const dup = [...seen.entries()].filter(([, n]) => n > 1);
        add(ent, `Key "${def.fields[k].label}" complete and unique`, empty || dup.length ? 'WARNING' : 'OK', `${empty} empty, ${dup.length} duplicated${dup.length ? ' (e.g. ' + dup.slice(0, 3).map(d => d[0]).join(', ') + ')' : ''}${dup.length ? '. Duplicates are tested once.' : ''}`);
      }
      for (const [f, d] of Object.entries(def.fields)) if ((d.type === 'date' || d.type === 'datetime') && avail[ent]?.[f] !== false) {
        // Accuracy: dates that could not be read, and which day/month order was used.
        const bad = rows.filter(r => r['_bad_' + f]);
        if (bad.length) add(ent, `Field "${d.label}" readable as date`, 'WARNING', `${bad.length} values not recognised (e.g. "${bad[0]['_bad_' + f]}", row ${bad[0]._row}). Those records are treated as having no date.`);
        const o = mt?.dateOrders?.[f];
        if (o && o.how !== 'assumed') add(ent, `Date format of "${d.label}"`, o.how === 'detected' ? 'INFO' : 'WARNING', `Numeric dates read as ${o.order === 'DMY' ? 'day/month/year' : 'month/day/year'} (${o.how}).`);
      }
      // The value lists show the auditor every status / type value found and whether the
      // parameters treat it as approved / failed / resolved. A WARNING appears if no value at all
      // matches – usually a sign that the parameter list must be adapted to the client's wording.
      // value profiles of fields that drive the tests
      const prof = (f, label, list, listName) => {
        if (!avail[ent]?.[f]) return;
        const p = valueProfile(rows, f), hit = p.filter(([v]) => inList(v, list));
        add(ent, `Values of "${label}"`, list && !hit.length ? 'WARNING' : 'INFO', p.map(([v, n]) => `${v}: ${n}${list && inList(v, list) ? ` (= ${listName})` : ''}`).join('; ') + (list && !hit.length ? `. No value matches the ${listName} list in Settings – check the parameters.` : ''));
      };
      if (ent === 'access_requests') prof('status', 'Approval status', S.controls.C1.approved_status, 'approved');
      if (ent === 'users') { prof('user_type', 'User type', S.controls.C1.user_types, 'in scope'); prof('lock_flag', 'Lock status', null); }
      if (ent === 'changes') prof('change_type', 'Change type', null);
      if (ent === 'job_runs') prof('status', 'Job status', S.controls.C6.failed_status, 'failed');
      if (ent === 'incidents') prof('status', 'Incident status', S.controls.C6.closed_status, 'resolved');
      if (ent === 'user_locks') prof('event', 'Change / event', null);
    }
    // Do the event dates cover the whole audit period? If the earliest or latest date is more than
    // a month away from the period start/end, the extract may have been run with wrong filters.
    // completeness of the period: event extracts should cover the whole audit period
    const cover = (ent, f, label) => {
      const rows = E[ent]; if (!rows || !avail[ent]?.[f]) return;
      const d = rows.map(r => r[f]).filter(x => x !== null && x < OPEN_END); if (!d.length) return;
      const lo = Math.min(...d), hi = Math.max(...d);
      const gap = lo > p0 + 31 * DAY || hi < p1 - 31 * DAY;
      add(ent, `${label} cover the audit period`, gap ? 'WARNING' : 'OK', `Earliest ${fmtD(lo)}, latest ${fmtD(hi)}${gap ? '. The extract may not cover the whole period – check the selection parameters.' : '.'}`);
    };
    cover('transports', 'imported_on', 'Import dates'); cover('job_runs', 'run_date', 'Run dates');
    // Transports and job runs outside the period are excluded from testing; records without a date go to review.
    if (E.transports && avail.transports?.imported_on) { const n = E.transports.filter(t => t.imported_on !== null && (t.imported_on < p0 || t.imported_on > p1)).length; const nb = E.transports.filter(t => t.imported_on === null).length; add('transports', 'Import dates within audit period', nb ? 'WARNING' : n ? 'INFO' : 'OK', `${n} transports outside the period (excluded)${nb ? `; ${nb} without import date (included, sent to REVIEW)` : ''}`); }
    if (E.job_runs && avail.job_runs?.run_date) { const n = E.job_runs.filter(t => t.run_date !== null && (t.run_date < p0 || t.run_date > p1)).length; add('job_runs', 'Run dates within audit period', n ? 'INFO' : 'OK', `${n} runs outside the period (excluded)`); }
    // Can every change number on a transport be found in the change ticket extract?
    if (E.transports && E.changes) {
      const ids = new Set(E.changes.map(c => refId(c.change_id))), re = refRegex(S);
      const refs = E.transports.map(t => t.change_id || ((t.description || '').match(re) || [])[0] || null);
      const n = refs.filter(r => r && !ids.has(refId(r))).length, none = refs.filter(r => !r).length;
      add('transports', 'Change IDs found in change tickets', n ? 'WARNING' : 'OK', `${n} transports refer to a change ID that is not in the ticket extract; ${none} have no change reference`);
    }
    // Can every leaver be found in the user master? Leavers without a SAP user ID are counted too.
    if (E.employees && E.users) { const ids = new Set(E.users.map(u => normId(u.user_id))); const lv = E.employees.filter(e => e.termination_date !== null && e.termination_date < OPEN_END); const n = lv.filter(e => e.user_id && !ids.has(normId(e.user_id))).length, nu = lv.filter(e => !e.user_id).length; add('employees', 'Leavers matched to user accounts', n || nu ? 'WARNING' : 'OK', `${n} leavers with a user ID that is not in the user master; ${nu} leavers without a SAP user ID in HR data`); }
    // Do the incidents refer to job runs that exist in the job extract?
    if (E.incidents && E.job_runs && avail.incidents?.job_id) { const ids = new Set(E.job_runs.map(j => normId(j.job_id))); const n = E.incidents.filter(i => i.job_id && !ids.has(normId(i.job_id))).length; add('incidents', 'Incidents linked to job runs', n ? 'INFO' : 'OK', `${n} incidents refer to a job count not in the job extract`); }
    return out;
  }
  // change references: CHG-70000, CHG_70000 and CHG70000 are the same ticket
  const refId = v => { const s = normId(v); return s === null ? null : s.replace(/[-_ ]/g, ''); };
  // The pattern used to find a change number inside a transport description (from the C4 settings).
  const refRegex = S => { try { return new RegExp(S.controls.C4.ref_pattern || '\\bCHG\\d+', 'i'); } catch { return /\bCHG\d+/i; } };

  // ===== 7. Text checks: keyword rules or a language model =====
  // KEYWORD RULES for free text (e.g. test notes, incident resolutions):
  //   - empty text                        → INADEQUATE (nothing documented)
  //   - contains a "negative" word first  → INADEQUATE (e.g. "tested by developer")
  //   - contains a "positive" word        → ADEQUATE   (e.g. "UAT", "sign-off")
  //   - none of the known words           → UNCLEAR    (sent to the auditor for review)
  // Negative words are checked first, so "UAT done in DEV" counts as inadequate.
  function keywordCheck(text, cfg) {
    if (blank(text)) return { label: 'INADEQUATE', reason: 'Text is empty.', quote: '', source: 'keywords' };
    const t = String(text).toLowerCase();
    const neg = (cfg.negative || []).find(k => t.includes(String(k).toLowerCase()));
    if (neg) return { label: 'INADEQUATE', reason: `Contains "${neg}".`, quote: neg, source: 'keywords' };
    const pos = (cfg.positive || []).find(k => t.includes(String(k).toLowerCase()));
    if (pos) return { label: 'ADEQUATE', reason: `Contains "${pos}".`, quote: pos, source: 'keywords' };
    return { label: 'UNCLEAR', reason: 'No known positive or negative wording found.', quote: '', source: 'keywords' };
  }
  // The question asked to the language model for each control that has free text.
  const QUESTIONS = {
    C4: 'Does this text show that the change was tested and accepted by the business users (for example user acceptance testing or key-user sign-off) before going to production? Testing only by the developer, or no testing, is NOT adequate.',
    C6: 'Does this text show that the failed batch job was actually investigated and fixed (for example root cause identified and job rerun, restarted or data reconciled)? Closing without action is NOT adequate.',
  };
  // The full instruction sent to the language model. The model must answer in a fixed format and
  // QUOTE the words from the evidence that support its answer – so the answer can be verified.
  function buildPrompt(control, text) {
    return `You help an IT auditor review evidence. Question: ${QUESTIONS[control]}\n\nEvidence text:\n"""${text}"""\n\nAnswer ONLY with JSON in this form: {"label": "ADEQUATE" or "INADEQUATE" or "UNCLEAR", "quote": "exact words copied from the evidence text that support your answer", "reason": "one short sentence"}. Use UNCLEAR if the text does not allow a clear decision.`;
  }
  // LANGUAGE MODEL CHECK: sends the question and the text to the model (normally a local Ollama
  // model, so client data does not leave the computer) and reads its answer. Safeguards:
  //   - an answer that is not ADEQUATE / INADEQUATE / UNCLEAR is treated as UNCLEAR
  //   - an ADEQUATE answer whose quote does not appear in the evidence text is downgraded to
  //     UNCLEAR (protection against the model inventing evidence)
  //   - if the model cannot be reached, the result is UNCLEAR, never a silent pass.
  async function llmCheck(control, text, ai, fetchFn) {
    if (blank(text)) return { label: 'INADEQUATE', reason: 'Text is empty.', quote: '', source: 'rule' };
    const prompt = buildPrompt(control, text);
    const f = fetchFn || fetch;
    let content;
    try {
      // Ollama (local model) and OpenAI-compatible services use slightly different message formats.
      if (ai.provider === 'ollama') {
        const r = await f(ai.url.replace(/\/$/, '') + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: ai.model, stream: false, format: 'json', options: { temperature: 0 }, messages: [{ role: 'user', content: prompt }] }) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        content = (await r.json()).message.content;
      } else {
        const r = await f(ai.url.replace(/\/$/, '') + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ai.api_key ? { Authorization: 'Bearer ' + ai.api_key } : {}) }, body: JSON.stringify({ model: ai.model, temperature: 0, messages: [{ role: 'user', content: prompt }] }) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        content = (await r.json()).choices[0].message.content;
      }
      // Read the model's answer (it was asked to answer in JSON, a simple structured text format).
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

  // ===== 8. Control tests =====
  // Attribute results: PASS, EXCEPTION, REVIEW (auditor judgement needed), N/A (not applicable,
  // e.g. no ticket so its approval cannot be checked), NOT TESTED (field not in evidence – test manually).
  // How attribute results combine into one result per item: the "worst" attribute wins.
  // EXCEPTION is worse than REVIEW, which is worse than PASS. N/A and NOT TESTED do not change
  // the item result (NOT TESTED is reported separately as a limitation of the test).
  // TEXT_RESULT translates the free-text verdict into an attribute result.
  const RANK = { PASS: 0, 'N/A': 0, 'NOT TESTED': 0, REVIEW: 1, EXCEPTION: 2 };
  const TEXT_RESULT = { ADEQUATE: 'PASS', INADEQUATE: 'EXCEPTION', UNCLEAR: 'REVIEW' };

  // THE CONTROL TESTS. Input: the mapped evidence (E) and the settings. Output: one "item" per
  // population member (e.g. per new user), each with the result of every attribute.
  // Step by step, for every control in scope:
  //   1. check the required evidence is there (otherwise the control is skipped, with the reason)
  //   2. derive the population from the extract and record each step (for the leadsheet)
  //   3. test every item, attribute by attribute (PASS / EXCEPTION / REVIEW / N/A / NOT TESTED)
  // At the end free texts are assessed and each item gets its overall result.
  async function runControls(E, settings, opts = {}) {
    const S = settings, C = S.controls, p0 = parseDate(S.period.start), p1 = parseDate(S.period.end) + DAY - 1;
    // "av" = which fields are available in the loaded evidence (from the mapping step).
    const av = opts.avail || availFromData(E);
    // "has" answers: is this field (or one of the alternatives "a|b") available?
    const has = spec => spec.split('|').some(x => { const [e, f] = x.split('.'); return !!(E[e] && av[e]?.[f]); });
    // "inP" answers: does this date fall inside the audit period?
    const inP = ms => ms !== null && ms >= p0 && ms <= p1;
    // The controls to test: those chosen in the Scope step.
    const scope = (opts.controls || CONTROL_IDS.filter(c => C[c]?.enabled !== false)).filter(c => CONTROLS[c]);
    const items = [], skipped = [], textJobs = [], derivation = {}, limitations = {};
    const cur = { c: null, n: 0 };
    // Creates one row of the testing table: control, reference number, record ID, description,
    // the key data shown in the workpaper (data) and the original evidence record (source).
    const item = (control, record_id, description, data, source) => { const it = { control, ref: ++cur.n, record_id: String(record_id ?? '(no ID)'), description, attributes: [], data, source }; items.push(it); return it; };
    // Lists the evidence fields an attribute needs but which are not in the loaded files.
    const missingFor = (c, a) => a.needs.filter(n => !has(n)).map(n => n.split('|').map(x => { const [e, f] = x.split('.'); return `${ENTITIES[e].fields[f].label} (${ENTITIES[e].label})`; }).join(' or '));
    // Records the result of one attribute for one item, with an explanation (detail). If the
    // attribute needs a field that is not in the evidence, the result is replaced by NOT TESTED –
    // so the tool never claims to have tested something it could not see.
    const att = (it, aid, result, detail) => {
      const a = CONTROLS[it.control].attributes.find(x => x.id === aid);
      if (result !== 'N/A' && missingFor(it.control, a).length) { result = 'NOT TESTED'; detail = 'Not tested automatically – field not in evidence. Test manually.'; }
      it.attributes.push({ id: aid, name: a.name, result, detail });
    };
    // Marks attributes as N/A – e.g. when there is no ticket at all, its approval cannot be checked.
    const notApplicable = (it, ids, why) => ids.forEach(x => att(it, x, 'N/A', why));
    // Removes duplicate records (same key) so each item is tested once; the number removed is shown in the population derivation.
    const dedupe = (rows, keyFn, steps) => { const seen = new Set(), out = []; let d = 0; for (const r of rows) { const k = keyFn(r); if (k && seen.has(k)) { d++; continue; } if (k) seen.add(k); out.push(r); } if (d) steps.push({ step: 'Less: duplicate records (tested once)', n: -d }); return out; };
    // Can control c run? Checks that all required evidence and fields are loaded. If not, the
    // control is listed as "not run" with the reason. If yes, it notes which attributes will be
    // NOT TESTED because optional fields are missing (shown as a limitation on the leadsheet).
    const can = c => {
      const miss = [];
      for (const [e, req] of Object.entries(CONTROLS[c].evidence)) {
        if (!req.required) continue;
        if (!E[e]) { miss.push(ENTITY_LABELS[e]); continue; }
        for (const f of req.fields) if (!av[e]?.[f]) miss.push(`${ENTITIES[e].fields[f].label} in ${ENTITY_LABELS[e]}`);
      }
      if (miss.length) { skipped.push({ control: c, reason: 'Missing evidence: ' + miss.join(', ') }); return false; }
      limitations[c] = CONTROLS[c].attributes.map(a => ({ id: a.id, name: a.name, missing: missingFor(c, a) })).filter(x => x.missing.length);
      cur.c = c; cur.n = 0;
      return true;
    };
    // Safety net: if one record is so broken that it cannot be processed, it is sent to REVIEW instead of stopping the whole test.
    const safely = (it, fn) => { try { fn(); } catch (e) { it.attributes.push({ id: '!', name: 'Processing', result: 'REVIEW', detail: 'The record could not be processed automatically (' + e.message + '). Test manually.' }); } };

    // C1 – NEW USERS. Population: users created in the audit period (of the in-scope user types).
    // For each user, find the access request ticket(s) for that user ID, then test:
    //   A  a ticket exists                      (none → EXCEPTION)
    //   B  the ticket status is "approved"      (other status → EXCEPTION; empty → REVIEW)
    //   C  the approver is authorised and is not the person who created the user
    //      (no approver → EXCEPTION, unless the comment describes an approval → REVIEW)
    //   D  approval date on or before the creation date
    //      (later → EXCEPTION; date missing but approver present → REVIEW)
    // C1 new users
    if (scope.includes('C1') && can('C1')) {
      const cfg = C.C1, byUser = new Map(), steps = [];
      // Group the tickets by user ID so each user's tickets can be found quickly.
      E.access_requests.forEach(r => { const k = normId(r.user_id); if (!k) return; if (!byUser.has(k)) byUser.set(k, []); byUser.get(k).push(r); });
      // Population derivation: start from all users, then remove users outside the period / out of scope.
      steps.push({ step: 'Records in user master extract', n: E.users.length });
      let us = E.users.filter(u => u.created_on !== null); if (us.length < E.users.length) steps.push({ step: 'Less: users without creation date (see data checks)', n: us.length - E.users.length });
      let n0 = us.length; us = us.filter(u => inP(u.created_on)); steps.push({ step: 'Less: created outside the audit period', n: us.length - n0 });
      if (cfg.user_types?.length && av.users?.user_type) { n0 = us.length; us = us.filter(u => inList(u.user_type, cfg.user_types)); steps.push({ step: `Less: user types not in scope (in scope: ${cfg.user_types.join(', ')})`, n: us.length - n0 }); }
      us = dedupe(us, u => normId(u.user_id), steps);
      derivation.C1 = { steps, population: us.length };
      for (const u of us) {
        const reqs = byUser.get(normId(u.user_id)) || [];
        // If a user has several tickets, use the approved one with the earliest approval date.
        const appr = reqs.filter(r => inList(r.status, cfg.approved_status)).sort((a, b) => (a.approved_on ?? 9e15) - (b.approved_on ?? 9e15));
        const r = appr[0] || reqs[0];
        // Create the testing table row with the key facts the auditor wants to see.
        const it = item('C1', u.user_id, `User ${u.user_id} created ${fmtD(u.created_on)} by ${u.created_by || '?'}`,
          { 'User ID': u.user_id, 'User type': u.user_type, 'Created on': fmtD(u.created_on), 'Created by': u.created_by, 'Ticket': r?.ticket_id ?? '', 'Tickets found': reqs.length, 'Ticket status': r?.status ?? '', 'Approver': r?.approved_by ?? '', 'Approved on': r ? fmtD(r.approved_on) : '', 'Ticket comments': r?.comments ?? '' }, u);
        safely(it, () => {
          // Attribute A: no ticket at all → exception, and B–D cannot be tested (N/A).
          if (!reqs.length) { att(it, 'A', 'EXCEPTION', 'No access request ticket found for this user.'); notApplicable(it, ['B', 'C', 'D'], 'No ticket – see attribute A.'); return; }
          att(it, 'A', 'PASS', `Ticket ${r.ticket_id ?? '(no number)'}${reqs.length > 1 ? ` (${reqs.length} tickets found; the approved one used)` : ''}.`);
          // Attribute B: is the ticket in an approved status?
          if (blank(r.status)) att(it, 'B', 'REVIEW', 'Ticket status is empty in the extract – inspect the ticket.');
          else att(it, 'B', appr.length ? 'PASS' : 'EXCEPTION', appr.length ? `Status "${r.status}".` : `Status "${r.status}" is not an approved status.`);
          // Attribute C: approver. Real tickets sometimes have the approval only in the comment field.
          const textOk = keywordCheck(r.comments, cfg.approval_text || {});
          if (blank(r.approved_by)) {
            if (!blank(r.comments) && textOk.label === 'ADEQUATE') att(it, 'C', 'REVIEW', `No approver recorded in the approver field, but the comment suggests approval: "${r.comments}". Inspect the ticket.`);
            else att(it, 'C', 'EXCEPTION', `No approver recorded on the ticket.${blank(r.comments) ? '' : ` Comment: "${r.comments}".`}`);
          } else if (av.users?.created_by && u.created_by && normId(r.approved_by) === normId(u.created_by)) att(it, 'C', 'EXCEPTION', `Approved by ${r.approved_by}, who also created the user.`);
          else if (cfg.authorised_approvers?.length && !inList(r.approved_by, cfg.authorised_approvers)) att(it, 'C', 'EXCEPTION', `Approver ${r.approved_by} is not on the list of authorised approvers.`);
          else att(it, 'C', 'PASS', `Approved by ${r.approved_by}${av.users?.created_by ? `; user created by ${u.created_by || '?'}` : ' (creator not in extract – independence not checked)'}.`);
          // Attribute D: approval date compared with the user creation date (same day counts as before).
          if (r.approved_on === null) att(it, 'D', blank(r.approved_by) ? 'EXCEPTION' : 'REVIEW', blank(r.approved_by) ? 'No approval recorded.' : `Approver ${r.approved_by} recorded but no approval date in the extract – inspect the ticket.`);
          else { const ok = day0(r.approved_on) <= day0(u.created_on); att(it, 'D', ok ? 'PASS' : 'EXCEPTION', `Approved ${fmtD(r.approved_on)}, created ${fmtD(u.created_on)}${ok && day0(r.approved_on) === day0(u.created_on) ? ' (same day)' : ''}.`); }
        });
      }
    }
    // C2 – LEAVERS. Population: employees whose termination date (from HR) is in the audit period.
    // For each leaver, find the SAP user, then test:
    //   A  the user account is found            (no user ID in HR / not in user master → REVIEW)
    //   B  access was removed within N days      (later or still active → EXCEPTION;
    //                                             locked but date unknown → REVIEW)
    //   C  no logon after the termination date   (logon after → EXCEPTION)
    // The removal date is the earliest of: lock date in the user master, lock date from the lock
    // history, or the end of the account's validity period.
    // C2 leavers
    if (scope.includes('C2') && can('C2')) {
      const cfg = C.C2, max = +cfg.max_days, users = new Map(), steps = [];
      // Index the user master by user ID for quick look-up.
      E.users.forEach(u => { const k = normId(u.user_id); if (k && !users.has(k)) users.set(k, u); });
      // lock history: the removal date is the start of the lock that is still in place (a later unlock cancels a lock)
      const events = new Map(), locks = new Map();
      if (E.user_locks && av.user_locks?.changed_on) for (const l of E.user_locks) {
        if (l.changed_on === null) continue;
        const ev = String(l.event || '').toLowerCase(), isUnlock = av.user_locks.event && (cfg.unlock_events || []).some(k => ev.includes(k.toLowerCase()));
        const isLock = !av.user_locks.event || (!isUnlock && (cfg.lock_events || []).some(k => ev.includes(k.toLowerCase())));
        if (!isLock && !isUnlock) continue;
        const k = normId(l.user_id); if (!events.has(k)) events.set(k, []); events.get(k).push({ d: l.changed_on, lock: isLock });
      }
      // For each user, walk through the lock/unlock events in date order. A lock followed by an
      // unlock is cancelled; the remaining lock start date is the date access was really removed.
      for (const [k, evs] of events) { let start = null; for (const e of evs.sort((a, b) => a.d - b.d)) start = e.lock ? (start ?? e.d) : null; if (start !== null) locks.set(k, start); }
      // Population derivation: all employees → only leavers → only leavers in the audit period.
      steps.push({ step: 'Records in HR employee extract', n: E.employees.length });
      let es = E.employees.filter(e => e.termination_date !== null && e.termination_date < OPEN_END); steps.push({ step: 'Less: employees without a termination date (active)', n: es.length - E.employees.length });
      let n0 = es.length; es = es.filter(e => inP(e.termination_date)); steps.push({ step: 'Less: terminated outside the audit period', n: es.length - n0 });
      es = dedupe(es, e => normId(e.employee_id) || normId(e.user_id), steps);
      derivation.C2 = { steps, population: es.length };
      for (const e of es) {
        const u = e.user_id ? users.get(normId(e.user_id)) : null;
        // Collect all possible removal dates for this user and take the earliest one.
        const lockHist = u ? locks.get(normId(u.user_id)) ?? null : null;
        const cands = [];
        if (u?.lock_date != null) cands.push({ d: u.lock_date, how: 'lock date in user master' });
        if (lockHist !== null) cands.push({ d: lockHist, how: 'lock history' });
        if (u?.valid_to != null && u.valid_to < OPEN_END) cands.push({ d: u.valid_to, how: 'end of validity' });
        const rem = cands.sort((a, b) => a.d - b.d)[0];
        const it = item('C2', e.user_id || e.employee_id, `Employee ${e.employee_id ?? '?'} (${e.user_id || 'no user ID'}) terminated ${fmtD(e.termination_date)}`,
          { 'Employee': e.employee_id, 'SAP user ID': e.user_id, 'Termination date': fmtD(e.termination_date), 'User found': u ? 'Yes' : 'No', 'Lock flag': u?.lock_flag ?? '', 'Access removed on': rem ? fmtD(rem.d) : '', 'Removal source': rem?.how ?? '', 'Days to removal': rem ? daysBetween(e.termination_date, rem.d) : '', 'Last logon': u ? fmtD(u.last_logon) : '' }, e);
        safely(it, () => {
          // Attribute A: can the leaver's SAP account be identified?
          if (!e.user_id) { att(it, 'A', 'REVIEW', 'No SAP user ID recorded in the HR data. Confirm that the employee had no SAP access (e.g. search the user master by name).'); notApplicable(it, ['B', 'C'], 'No user account identified – see attribute A.'); return; }
          if (!u) { att(it, 'A', 'REVIEW', `User ${e.user_id} not found in the user master. Confirm the employee had no access, or that the account was deleted.`); notApplicable(it, ['B', 'C'], 'No user account identified – see attribute A.'); return; }
          att(it, 'A', 'PASS', `User ${u.user_id}.`);
          // Is the account flagged as locked? (SAP lock flag 0 = not locked; 64, 128... = locked.)
          const flagged = !blank(u.lock_flag) && !/^0+$/.test(String(u.lock_flag).trim()) && !/^(no|unlocked|not locked|active|false|n)$/i.test(String(u.lock_flag).trim());
          // Attribute B: days between termination and removal compared with the allowed maximum.
          // If there is no removal date: locked without a date → REVIEW; still active at period end
          // → EXCEPTION; terminated in the last days of the period → still within the allowed time.
          if (rem) { const d = daysBetween(e.termination_date, rem.d); att(it, 'B', d <= max ? 'PASS' : 'EXCEPTION', `Access removed ${fmtD(rem.d)} (${rem.how}), ${d} day(s) after termination; allowed ${max}.`); }
          else if (flagged) att(it, 'B', 'REVIEW', `Account is locked (flag "${u.lock_flag}") but the lock date is not in the evidence. Obtain the lock date (USH02 / change documents).`);
          else if (day0(e.termination_date) + max * DAY < day0(p1)) att(it, 'B', 'EXCEPTION', 'Account still active at period end.');
          else att(it, 'B', 'PASS', `Terminated ${fmtD(e.termination_date)}, within ${max} days of period end; account still active at extraction – follow up after period end.`);
          // Attribute C: was the account used after the person left?
          if (u.last_logon !== null && day0(u.last_logon) > day0(e.termination_date)) att(it, 'C', 'EXCEPTION', `Last logon ${fmtD(u.last_logon)} is after termination.`);
          else att(it, 'C', 'PASS', u.last_logon !== null ? `Last logon ${fmtD(u.last_logon)}.` : 'No logon recorded.');
        });
      }
    }
    // C3 – PRIVILEGED ACCESS. Population: all active users (not locked, still valid) of the
    // in-scope user types. For each user, list the profiles held and test:
    //   A  any privileged profile (e.g. SAP_ALL) is held only by users on the approved list
    //      (not on the list → EXCEPTION; list not provided → REVIEW)
    // C3 privileged access
    if (scope.includes('C3') && can('C3')) {
      const cfg = C.C3, profs = new Map(), steps = [];
      // The approved privileged users (if that list was loaded).
      const approved = E.privileged_approved && av.privileged_approved?.user_id ? new Set(E.privileged_approved.map(a => normId(a.user_id))) : null;
      // Group the profiles by user.
      E.user_profiles.forEach(p => { const k = normId(p.user_id); if (!k) return; if (!profs.has(k)) profs.set(k, []); profs.get(k).push(p.profile); });
      // A user counts as locked if there is a lock date or a non-zero lock flag.
      const locked = u => u.lock_date !== null || (!blank(u.lock_flag) && !/^0+$/.test(String(u.lock_flag).trim()) && !/^(no|unlocked|not locked|active|false|n)$/i.test(String(u.lock_flag).trim()));
      // Population derivation: all users → remove locked → remove expired → keep in-scope user types.
      steps.push({ step: 'Records in user master extract', n: E.users.length });
      let us = E.users.filter(u => !locked(u)); steps.push({ step: 'Less: locked users', n: us.length - E.users.length });
      let n0 = us.length; us = us.filter(u => u.valid_to === null || u.valid_to >= p1); if (us.length < n0) steps.push({ step: 'Less: users whose validity ended before period end', n: us.length - n0 });
      if (cfg.user_types?.length && av.users?.user_type) { n0 = us.length; us = us.filter(u => inList(u.user_type, cfg.user_types)); steps.push({ step: `Less: user types not in scope (in scope: ${cfg.user_types.join(', ')})`, n: us.length - n0 }); }
      us = dedupe(us, u => normId(u.user_id), steps);
      derivation.C3 = { steps, population: us.length };
      for (const u of us) {
        // Which of the user's profiles are on the privileged list?
        const all = profs.get(normId(u.user_id)) || [], priv = all.filter(p => inList(p, cfg.privileged_profiles));
        const it = item('C3', u.user_id, `Active user ${u.user_id}`, { 'User ID': u.user_id, 'User type': u.user_type, 'Profiles / roles held': all.length, 'Privileged profiles': priv.join(', '), 'On approved list': priv.length ? (approved ? (approved.has(normId(u.user_id)) ? 'Yes' : 'No') : 'List not provided') : '' }, u);
        safely(it, () => {
          if (!priv.length) att(it, 'A', 'PASS', all.length ? 'No privileged profile assigned.' : 'No profiles assigned.');
          else if (!approved) att(it, 'A', 'REVIEW', `Holds ${priv.join(', ')}; the approved privileged list was not provided – obtain approval evidence.`);
          else att(it, 'A', approved.has(normId(u.user_id)) ? 'PASS' : 'EXCEPTION', `Holds ${priv.join(', ')}; ${approved.has(normId(u.user_id)) ? 'on' : 'NOT on'} the approved privileged list.`);
        });
      }
    }
    // C4 and C5 share one population: all transports imported into production in the audit period.
    // Transports without an import date are kept (better to review them than to drop them).
    // C4 and C5 changes
    const transportPop = (c) => {
      const steps = [{ step: 'Records in transport extract', n: E.transports.length }];
      let trs = E.transports.filter(t => t.imported_on === null || inP(t.imported_on)); steps.push({ step: 'Less: imported outside the audit period', n: trs.length - E.transports.length });
      const nb = trs.filter(t => t.imported_on === null).length; if (nb) steps.push({ step: `Note: ${nb} transport(s) without import date included (sent to review)`, n: 0 });
      trs = dedupe(trs, t => normId(t.transport_id), steps);
      derivation[c] = { steps, population: trs.length };
      return trs;
    };
    // C4 – CHANGE MANAGEMENT. For each transport:
    //   A  a change ticket exists – using the change ID field or, if empty, a change number found
    //      in the transport description (no ticket → EXCEPTION)
    //   B  approved before import; emergency changes need an approval after implementation
    //      (late or missing → EXCEPTION; approver present but no date → REVIEW)
    //   C  the test notes show user acceptance testing (judged by keywords or the AI model)
    if (scope.includes('C4') && can('C4')) {
      const cfg = C.C4, ch = new Map(), re = refRegex(S);
      // Index the change tickets by change number (CHG-70000 and CHG70000 treated as the same).
      E.changes.forEach(c => { const k = refId(c.change_id); if (k && !ch.has(k)) ch.set(k, c); });
      for (const t of transportPop('C4')) {
        // No change ID on the transport? Then look for a change number in its description.
        const fromText = !t.change_id && t.description ? ((t.description.match(re) || [])[0] || null) : null;
        const ref = t.change_id || fromText, c = ref ? ch.get(refId(ref)) : null;
        const it = item('C4', t.transport_id, `Transport ${t.transport_id} imported ${fmtDT(t.imported_on) || '(no date)'}`,
          { 'Transport': t.transport_id, 'Description': t.description, 'Imported on': fmtDT(t.imported_on), 'Change ID': ref ?? '', 'Change type': c?.change_type ?? '', 'Approver': c?.approver ?? '', 'Approved on': c ? fmtDT(c.approved_on) : '', 'Post-impl. approval': c ? fmtDT(c.post_approved_on) : '', 'Test evidence': c?.test_evidence ?? '' }, t);
        safely(it, () => {
          // Attribute A: ticket found or not.
          if (!c) { att(it, 'A', 'EXCEPTION', ref ? `Change ${ref} not found in the change ticket extract.` : 'No change ticket linked (no change ID and no reference in the description).'); notApplicable(it, ['B', 'C'], 'No change ticket – see attribute A.'); return; }
          att(it, 'A', 'PASS', `Change ${c.change_id} (${c.change_type || 'type not given'})${fromText ? ' – reference taken from the transport description' : ''}.`);
          // Attribute B: emergency changes are checked for approval after implementation, normal changes for approval before import.
          if (inList(c.change_type, cfg.emergency_types)) att(it, 'B', c.post_approved_on !== null ? 'PASS' : 'EXCEPTION', c.post_approved_on !== null ? `Emergency change; post-implementation approval ${fmtDT(c.post_approved_on)}.` : 'Emergency change without post-implementation approval.');
          else if (c.approved_on === null) att(it, 'B', blank(c.approver) ? 'EXCEPTION' : 'REVIEW', blank(c.approver) ? 'No approval recorded on the change ticket.' : `Approver ${c.approver} recorded but no approval date in the extract – inspect the ticket.`);
          else if (t.imported_on === null) att(it, 'B', 'REVIEW', `Approved ${fmtDT(c.approved_on)}, but the import date is missing – obtain the import log.`);
          else att(it, 'B', c.approved_on <= t.imported_on ? 'PASS' : 'EXCEPTION', `Approved ${fmtDT(c.approved_on)}, imported ${fmtDT(t.imported_on)}.`);
          // Attribute C: the test notes are judged later, together with all other free texts.
          if (!av.changes?.test_evidence) att(it, 'C', 'NOT TESTED', '');
          else textJobs.push({ it, control: 'C4', aid: 'C', text: c.test_evidence });
        });
      }
    }
    // C5 – SEGREGATION OF DUTIES. For each transport:
    //   A  the person who imported it into production is not the developer who created it
    //      (same person → EXCEPTION; one of them missing, or imported by a technical user → REVIEW)
    if (scope.includes('C5') && can('C5')) {
      const tech = C.C5.technical_import_users || [];
      for (const t of transportPop('C5')) {
        const it = item('C5', t.transport_id, `Transport ${t.transport_id} owner ${t.owner || '?'}, imported by ${t.imported_by || '?'}`, { 'Transport': t.transport_id, 'Description': t.description, 'Owner': t.owner, 'Imported by': t.imported_by, 'Imported on': fmtDT(t.imported_on) }, t);
        safely(it, () => {
          if (blank(t.owner) || blank(t.imported_by)) att(it, 'A', 'REVIEW', 'Owner or importing user missing in the extract.');
          else if (inList(t.imported_by, tech)) att(it, 'A', 'REVIEW', `Imported by technical user ${t.imported_by}; identify who triggered the import (STMS log).`);
          else att(it, 'A', normId(t.owner) !== normId(t.imported_by) ? 'PASS' : 'EXCEPTION', `Owner ${t.owner}, imported by ${t.imported_by}.`);
        });
      }
    }
    // C6 – FAILED JOBS. Population: job runs in the audit period with a "failed" status.
    // For each failed run, find the incident ticket and test:
    //   A  an incident exists – linked by job count or, if the incident has no job count, by job
    //      name and a date within a few days of the failure (none → EXCEPTION)
    //   B  the incident is resolved              (still open → EXCEPTION; status empty → REVIEW)
    //   C  the resolution notes show a real fix  (judged by keywords or the AI model)
    // C6 failed jobs
    if (scope.includes('C6') && can('C6')) {
      const cfg = C.C6, inc = new Map(), steps = [], linkDays = +cfg.link_days || 3;
      // Index the incidents by job count.
      E.incidents.forEach(i => { const k = normId(i.job_id); if (k) { if (!inc.has(k)) inc.set(k, []); inc.get(k).push(i); } });
      // Population derivation: all job runs → runs in the period → failed runs only.
      steps.push({ step: 'Records in job run extract', n: E.job_runs.length });
      let js = E.job_runs.filter(j => inP(j.run_date)); steps.push({ step: 'Less: runs outside the audit period', n: js.length - E.job_runs.length });
      const n0 = js.length; js = js.filter(j => inList(j.status, cfg.failed_status)); steps.push({ step: `Less: runs not failed (failed status: ${cfg.failed_status.join(', ')})`, n: js.length - n0 });
      js = dedupe(js, j => normId(j.job_id), steps);
      derivation.C6 = { steps, population: js.length };
      // Fallback link: an incident without job count that names the same job and was opened shortly after the failure.
      const byName = j => j.job_name ? E.incidents.filter(i => !i.job_id && (up(i.job_name || '') === up(j.job_name) || up(i.description || '').includes(up(j.job_name))) && i.opened_on !== null && j.run_date !== null && i.opened_on >= day0(j.run_date) && i.opened_on <= day0(j.run_date) + linkDays * DAY) : [];
      for (const j of js) {
        // Prefer the link by job count; use the job-name link only if there is none. Prefer a resolved incident if there are several.
        let list = inc.get(normId(j.job_id)) || [], how = 'job count';
        if (!list.length) { list = byName(j); how = 'job name and date'; }
        const i = list.find(x => inList(x.status, cfg.closed_status)) || list[0];
        const it = item('C6', j.job_id, `${j.job_name || 'Job'} run ${j.job_id} failed ${fmtD(j.run_date)}`, { 'Job count': j.job_id, 'Job name': j.job_name, 'Run date': fmtD(j.run_date), 'Status': j.status, 'Incident': i?.incident_id ?? '', 'Linked by': i ? how : '', 'Incident status': i?.status ?? '', 'Resolved on': i ? fmtD(i.resolved_on) : '', 'Resolution': i?.resolution ?? '' }, j);
        safely(it, () => {
          if (!i) { att(it, 'A', 'EXCEPTION', 'No incident linked to the failed job.'); notApplicable(it, ['B', 'C'], 'No incident – see attribute A.'); return; }
          att(it, 'A', 'PASS', `Incident ${i.incident_id} opened ${fmtD(i.opened_on)} (linked by ${how}).`);
          // Attribute B: is the incident resolved? Attribute C is only assessed for resolved incidents.
          const closed = inList(i.status, cfg.closed_status);
          if (blank(i.status)) att(it, 'B', 'REVIEW', 'Incident status empty in the extract.');
          else att(it, 'B', closed ? 'PASS' : 'EXCEPTION', closed ? `Resolved ${fmtD(i.resolved_on) || '(date not given)'}.` : `Status "${i.status}" at extraction.`);
          if (!closed) notApplicable(it, ['C'], 'Incident not resolved – see attribute B.');
          else if (!av.incidents?.resolution) att(it, 'C', 'NOT TESTED', '');
          else textJobs.push({ it, control: 'C6', aid: 'C', text: i.resolution });
        });
      }
    }

    // FREE-TEXT ATTRIBUTES (C4-C, C6-C) are assessed here, all together. With the AI option each
    // text can be checked several times; if the runs disagree, the item goes to REVIEW – an
    // unstable answer is not trusted. All answers are kept to measure consistency (thesis).
    // text attributes: keywords or language model, possibly several runs
    const ai = S.ai || {}; const runsN = ai.mode === 'llm' ? Math.max(1, +ai.runs || 1) : 1;
    const textRuns = [];
    let done = 0;
    for (const job of textJobs) {
      const answers = [];
      for (let k = 0; k < runsN; k++) answers.push(ai.mode === 'llm' ? await llmCheck(job.control, job.text, ai, opts.fetch) : keywordCheck(job.text, C[job.control].text || {}));
      const a = answers[0];
      const disagree = answers.some(x => x.label !== a.label);
      att(job.it, job.aid, disagree ? 'REVIEW' : TEXT_RESULT[a.label], `${disagree ? 'Runs disagree (' + answers.map(x => x.label).join('/') + '). ' : ''}Text: "${job.text ?? ''}". ${a.source === 'keywords' ? 'Keyword check' : 'AI check'}: ${a.label} – ${a.reason}`);
      textRuns.push({ control: job.control, record_id: job.it.record_id, text: job.text, labels: answers.map(x => x.label) });
      if (opts.progress) opts.progress(++done, textJobs.length);
    }
    // Final result of each item = its worst attribute result; "reason" collects the explanations
    // of the attributes that caused that result (shown in the review screen and the workpaper).
    for (const it of items) {
      it.attributes.sort((a, b) => a.id.localeCompare(b.id));
      it.result = it.attributes.reduce((w, a) => RANK[a.result] > RANK[w] ? a.result : w, 'PASS');
      it.reason = it.attributes.filter(a => a.result === it.result && a.result !== 'PASS').map(a => `${a.id}. ${a.name}: ${a.detail}`).join(' | ');
    }
    // Population size per control, then everything is handed back to the app.
    const populations = {};
    for (const c of CONTROL_IDS) populations[c] = items.filter(i => i.control === c).length;
    return { items, populations, skipped, textRuns, derivation, limitations, controls: scope.filter(c => derivation[c]) };
  }
  // availability when runControls is called without mapping info: a field is available if any record has it
  // Used by the automated tests: if no mapping information is given, a field counts as available when any record has a value in it.
  function availFromData(E) { const a = {}; for (const [e, rows] of Object.entries(E)) { a[e] = {}; for (const f of Object.keys(ENTITIES[e]?.fields || {})) a[e][f] = rows.some(r => r[f] !== null && r[f] !== undefined); } return a; }

  // ===== 9. Evaluation (thesis experiment) =====
  // EVALUATION FOR THE THESIS. Compares the tool (or a manual tester) with the answer key, i.e.
  // the list of deviations that were deliberately planted in the synthetic data.
  // "safe" divides without failing when dividing by zero.
  const safe = (a, b) => b ? a / b : null;
  // The classic confusion matrix:
  //   TP (true positive)  = flagged and really a deviation
  //   FP (false positive) = flagged but not a deviation (a false alarm)
  //   FN (false negative) = a real deviation that was missed
  //   TN (true negative)  = correctly not flagged
  //   Precision = TP / (TP + FP)  – how many flags were right
  //   Recall    = TP / (TP + FN)  – how many real deviations were found
  //   F1        = balance of precision and recall
  function confusion(flaggedIds, truthIds, population) {
    const tp = [...flaggedIds].filter(x => truthIds.has(x)).length, fp = flaggedIds.size - tp, fn = [...truthIds].filter(x => !flaggedIds.has(x)).length;
    const tn = population === null ? null : population - tp - fp - fn;
    const p = safe(tp, tp + fp), r = safe(tp, tp + fn), f1 = p !== null && r !== null && p + r > 0 ? 2 * p * r / (p + r) : null;
    return { TP: tp, FP: fp, FN: fn, TN: tn, Precision: p, Recall: r, F1: f1 };
  }
  // Reads the answer key file: one row per real deviation with its control and record ID.
  function readKey(rows) { // columns: control, record_id (flexible names)
    const k = r => { const ks = Object.keys(r); const g = n => ks.find(x => x.toLowerCase().replace(/[^a-z]/g, '') === n); return { control: id(r[g('control')]), record_id: normId(r[g('recordid')] ?? r[g('id')]) }; };
    return rows.map(k).filter(x => x.control && x.record_id);
  }
  // Scores the tool per control. Normally EXCEPTION and REVIEW both count as "flagged" (the
  // auditor looks at both); with "strict" only EXCEPTION counts.
  function evaluateAutomated(run, keyRows, strict = false) {
    const key = readKey(keyRows), out = [];
    for (const c of CONTROL_IDS) {
      const its = run.items.filter(i => i.control === c); if (!its.length) continue;
      const flagged = new Set(its.filter(i => strict ? i.result === 'EXCEPTION' : i.result !== 'PASS').map(i => normId(i.record_id)));
      const truth = new Set(key.filter(k => k.control === c).map(k => k.record_id));
      out.push({ Control: c, Population: its.length, Tested: its.length, Coverage: 1, 'Deviations in key': truth.size, Flagged: flagged.size, ...confusion(flagged, truth, its.length) });
    }
    return out;
  }
  // Cohen's kappa: how much two raters (two testers, or two AI runs) agree beyond what would be
  // expected by chance. 1 = perfect agreement, 0 = no better than chance.
  function kappa(a, b) { // two arrays of labels on the same items
    const n = a.length; if (!n) return { agreement: null, kappa: null, n };
    const labels = [...new Set([...a, ...b])]; let agree = 0;
    for (let i = 0; i < n; i++) if (a[i] === b[i]) agree++;
    const po = agree / n; let pe = 0;
    for (const l of labels) pe += (a.filter(x => x === l).length / n) * (b.filter(x => x === l).length / n);
    return { agreement: po, kappa: pe === 1 ? 1 : (po - pe) / (1 - pe), n };
  }
  // Consistency of the AI over repeated runs: share of texts where all runs agree, and average agreement / kappa between runs.
  function runConsistency(textRuns) {
    if (!textRuns.length || textRuns[0].labels.length < 2) return null;
    const R = textRuns[0].labels.length, pairs = [];
    for (let i = 0; i < R; i++) for (let j = i + 1; j < R; j++) pairs.push(kappa(textRuns.map(t => t.labels[i]), textRuns.map(t => t.labels[j])));
    return { runs: R, items: textRuns.length, all_runs_agree: textRuns.filter(t => t.labels.every(l => l === t.labels[0])).length / textRuns.length, mean_pairwise_agreement: pairs.reduce((s, p) => s + p.agreement, 0) / pairs.length, mean_pairwise_kappa: pairs.reduce((s, p) => s + (p.kappa ?? 0), 0) / pairs.length };
  }
  // manual results: columns Participant, Control, Record ID, Conclusion (Exception / No exception), Minutes (optional)
  // Scores the manual testers (experiment condition M). Manual testers test a sample, so two
  // recalls are calculated: within their sample, and against the whole population (how many of
  // all real deviations they found). Agreement between each pair of testers is also measured.
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

  // ===== 10. Run log fingerprint =====
  // SHA-256 FINGERPRINT of a file: a long code that changes completely if even one character of
  // the file changes. Recorded in the run log and on the C&A sheet, so it can later be proven
  // which exact files were tested.
  async function sha256(bytes) {
    if (globalThis.crypto?.subtle) { const h = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); }
    let h = 2166136261; for (const b of new Uint8Array(bytes)) { h ^= b; h = Math.imul(h, 16777619); } return 'fnv-' + (h >>> 0).toString(16);
  }
  // The list of everything this file offers to the rest of the app and to the tests.
  return { VERSION, ENTITIES, CONTROLS, CONTROL_IDS, DEFAULT_SETTINGS, ENTITY_FIELDS, ENTITY_LABELS, CONTROL_NEEDS, controlEntities, clone, parseDate, fmtD, fmtDT, mapEntities, autoMap, dataChecks, keywordCheck, buildPrompt, llmCheck, runControls, evaluateAutomated, evaluateManual, kappa, runConsistency, sha256, normId, blank };
})();
if (typeof module !== 'undefined') module.exports = ITGC;
