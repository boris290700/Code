# ITGC Tester – user guide

A prototype tool for automated testing of IT general controls (ITGCs), built for the master thesis *Development and Empirical Evaluation of an Automated IT General Controls Testing Framework*.

It tests the **whole population** of six common SAP ITGCs, attribute by attribute. Every item is marked **PASS**, **EXCEPTION** or **REVIEW**, and attributes that the evidence doesn't allow to test are marked **NOT TESTED**. The auditor records a decision on each flagged item, and the tool exports a **Big4-style workpaper** for each control (leadsheet, C&A of IPE, population, testing table, exceptions). It also calculates the evaluation metrics for the thesis experiment (precision, recall, F1, coverage, Cohen's kappa).

Version 2 adds:
- tolerance for real-world exports (see section 4);
- testing a single control or any selection of controls;
- the Big4-style workpaper.

Version 2.1 (review hardening) closes gaps a senior reviewer would raise:
- **No false PASS:**
  - Keywords must start a word, so "UAT" no longer matches "evaluation".
  - A positive word next to a negation ("UAT not performed") goes to REVIEW.
  - An item where nothing could be tested is NOT TESTED, not PASS.
  - A leaver still active close to period end goes to REVIEW.
- **New rule elements:**
  - C1: an empty creator goes to REVIEW.
  - C3: approval is checked per profile.
  - C4: approval by the developer is an exception, and emergency post-approval must come within *N* days.
  - Duplicates with different content go to REVIEW.
  - Users without a user type stay in the population.
- **Safety stops:**
  - A blank or reversed audit period stops the run.
  - An empty population is never reported as "no exceptions".
  - Day/month order that was only assumed is a WARNING.
  - Settings that make a rule meaningless are reported.
- **Workpaper:**
  - tool-reliance statement and results fingerprint;
  - population completeness risks per control;
  - who decided each item and when;
  - "Not an exception" needs a reason;
  - review sign-off left empty for the reviewer;
  - tool-output sheets protected against accidental edits.
- **Data protection:**
  - Decisions are kept per engagement.
  - **Start a new engagement** deletes everything stored in the browser.
  - A language model that is not on this computer needs explicit confirmation, and the run log records it.

---

## 1. Opening the app

New here? **[GETTING_STARTED.md](GETTING_STARTED.md)** has step-by-step setup for Windows and Mac.

1. Open the folder `dist` and double-click **`ITGC_Tester.html`**.
2. It opens in your web browser. Use Chrome or Edge; Firefox and Safari also work.
3. Nothing needs to be installed. The app works offline. **All files are processed inside the browser and nothing is uploaded anywhere.** That's important for client data.
4. First time? Click **Try the demo** on the welcome screen. It loads the sample data, tests all six controls and shows the results in one click. Every step has a "How this step works" box, and the **Glossary** button (top right) explains the audit terms in plain words.

## 2. The seven steps

| Step | What you do |
|---|---|
| 1. Scope | Enter the engagement details (client, system, period, workpaper prefix, your name). **Choose the control(s) to test.** You can test one control, for example only C1 access provisioning. |
| 2. Load evidence | A checklist shows only the evidence the selected controls need. Drag in the exports (.xlsx, .csv, .txt). Each file gets a SHA-256 fingerprint. Sheets and columns are **mapped automatically** from their names. |
| 3. Map & check data | Check or correct the mapping. Fields marked * are required; the others are optional. Read the completeness and accuracy checks and investigate every WARNING. |
| 4. Settings | Set the parameters of each control (approvers, leaver days, privileged profiles, keywords…) and the leadsheet details (client control ID, owner, description). Save the settings to a file. |
| 5. Run tests | One click. You get a summary per control and per attribute, plus a run log entry. |
| 6. Review & export | Decide on every EXCEPTION and REVIEW item. Then **export the workpaper for each control**, or all of them. |
| 7. Evaluate | For the experiment: load the answer key and the manual testers' results to get the metrics. |

Your settings, decisions and run history are remembered in this browser. Decisions are saved per engagement (client and period). After a page reload, load the same files and run again, and your decisions come back for every item whose tool result hasn't changed. Each decision records who made it and when. **Start a new engagement** (step 1) deletes everything the app stored in the browser, so one client's approver lists, user IDs and comments never carry over to the next client. Export the workpaper and the settings file to keep them.

## 3. The controls, attributes and rules

Each control is tested as a set of attributes (A, B, C…), the way an audit testing table works.

| ID | Control | Attributes | Evidence |
|---|---|---|---|
| C1 | New user access approved before creation | A request exists · B request approved · C authorised, independent approver · D approved before creation | User master, access request tickets |
| C2 | Leavers' access removed timely | A user account identified · B access removed within *N* days · C no logon after termination | HR list, user master, lock history (optional) |
| C3 | Privileged access restricted | A no unapproved privileged profile (checked per profile when the approved list names profiles) | User master, profiles/roles, approved list (optional) |
| C4 | Changes approved and tested before import | A change ticket exists · B approved before import, not by the developer (emergency: within *N* days after) · C user acceptance testing evidenced | Transports, change tickets |
| C5 | Developers do not import own changes | A importer is not the developer | Transports |
| C6 | Failed jobs followed up | A incident logged · B incident resolved · C resolution documented | Job runs, incidents |

**Result of an attribute:**

| Result | Meaning |
|---|---|
| ✓ PASS | The rule is met. |
| X EXCEPTION | The evidence shows the rule is broken (e.g. approval after creation, no ticket, approver = creator). |
| ? REVIEW | The evidence is incomplete or ambiguous, so the auditor must judge. Examples: approver recorded but approval date empty; approval only described in a comment; account locked but lock date unknown; leaver without SAP user ID; import by a technical user (TMSADM); a vague test note. |
| N/A | Not applicable (e.g. no ticket, so its approval can't be checked). |
| N/T NOT TESTED | The field isn't in the evidence at all (e.g. the ticket export has no approval date). The attribute must be tested manually. The run screen and the leadsheet show this as a limitation. |

The rule of thumb behind EXCEPTION versus REVIEW: **missing approval is an exception; a missing supporting detail when approval is evidenced goes to review.** All rules are in `src/engine.js`, section 8, one block per control.

**Item result.** The worst attribute decides the item result. An item where *no* attribute could be tested (all N/T) is **NOT TESTED**, never PASS, and you must test it manually. If an attribute is only partly testable (for example C1-C when the extract has no "created by"), the rest is still tested and the missing part appears as a limitation on the run screen and the leadsheet.

**Free text** (C4 test evidence, C6 resolution, C1 approval comments) is assessed with keyword rules (default) or a local language model.
- A keyword must start a word: "UAT" is found in "UAT passed" but not in "evaluation".
- Positive wording together with a negation word ("UAT not performed", "no UAT", "UAT pending") is UNCLEAR and goes to REVIEW. You can edit the negation list in Settings.
- With a model, an ADEQUATE answer must quote the evidence. Items where several runs disagree go to REVIEW, and so do items where the model says ADEQUATE but the keyword rules say INADEQUATE. That rule also limits evidence text written to mislead the model.

## 4. Real-world evidence: what the tool handles

Ticketing tools and SAP exports are rarely as tidy as the demo file. The reader and the engine handle:

| Situation | How it's handled |
|---|---|
| Report title lines above the header, footer/total lines, repeated header lines (page breaks), blank lines | Header row detected automatically (you can override it in step 3); footer and repeated-header lines excluded and listed in the data checks and the C&A sheet |
| SE16N "text with tabs" in UTF-16, semicolon CSV from Excel, pipe-separated SAP lists, Windows-1252 | Encoding and delimiter detected |
| Column names that differ per system (`BNAME` / "User Name" / "Requested for") | Automatic mapping from a list of synonyms per field; manual override in step 3 |
| Date and time in separate columns (STMS, change documents) | Columns joined, e.g. `Import Date+Import Time` |
| `31.12.2025`, `12/31/2025`, `20251231`, `20251231 143005`, `07-Nov-2025 19:00`, `Dec 31, 2025`, Excel dates, `00.00.0000`, `31.12.9999` | All recognised. Day/month order detected per column (setting for ambiguous files). SAP empty dates are blank; 9999 means "no end". |
| IDs as `Ilze Vitola (IVITOLA)`, lower case, trailing spaces, job counts without leading zeros | Normalised before matching |
| Change number only in the transport description (`CHG-70000 Fix…`) | Extracted with a pattern (setting) |
| Incidents without a job count | Linked by job name and date |
| No lock date in USR02 | Taken from the lock history (change documents); a later unlock cancels a lock |
| Statuses like "Closed Complete", "Canceled", "Resolved" | Value lists in Settings; the data checks show every value and how it was classified |
| Missing or duplicate keys, unreadable dates, values outside the header | Data check WARNING; duplicates tested once; records without a needed date go to REVIEW |
| A field that doesn't exist in the export | Attribute marked NOT TESTED instead of failing silently; the control still runs |
| Evidence a control requires is missing | The control isn't run, and the screen says why |

## 5. The workpaper

**Export C*n* workpaper** creates one Excel file per control (`ITGC-C1_workpaper_<date>.xlsx`). Yellow cells are for the auditor to complete.

| Sheet | W/P ref | Content |
|---|---|---|
| Leadsheet | .1 | Control information (description, objective, risk, owner, frequency, type, key control); test objective and approach; population definition and derivation; attributes with the procedure performed and counts per tickmark; procedures performed (incl. limitations); results; draft conclusion; auditor conclusion (dropdown); sign-off |
| C&A | .2 | For each extract: typical source; report actually used, parameters, extracted by, how obtained (auditor input); file name and SHA-256; header row; columns used; the tool's completeness and accuracy checks; **auditor procedures to complete** (reconcile record count, check parameters, system→extract and extract→system samples); conclusion |
| Population | .3 | Derivation from the extract to the tested population, then every population item with all its source columns and source row number |
| Testing table | .4 | One row per item: key data, **one column per attribute with tickmarks (✓ X ? N/A N/T)**, tool result, what was checked, auditor decision (dropdown), comment, evidence ref |
| Exceptions | .5 | Flagged items with the failed attributes and details; decision linked to the testing table; root cause, impact / compensating control, deficiency ref (auditor input) |
| Src *n* … | .6.n | The evidence as received, with source row numbers |
| Parameters & log | .7 | Run log (run ID, timestamp, tool version, settings fingerprint, file hashes), control parameters, mapping |

Leadsheet counts are Excel formulas over the testing table, so decisions entered later in Excel update the leadsheet. **Export raw results** still gives the flat all-controls file from version 1.

Review safeguards in the workpaper:
- The **leadsheet** includes:
  - a *Reliance on the tool* statement: the tool is a research prototype, so validate its rules by re-performing a few items, PASS items included;
  - the *results fingerprint*: re-running the same files and settings must reproduce it;
  - a cell for the D&I (walkthrough) reference;
  - the *population completeness risks* of the control (e.g. users deleted during the period are missing from USR02, or SAP deletes old job logs), each to be addressed on the C&A sheet;
  - a count of items cleared as "Not an exception" without a comment.
- The **draft conclusion** never says "operated effectively" when the population is empty. When nothing was flagged, it is conditional on the C&A work, the tool validation and the review.
- **Reviewed by** is left empty for the reviewer to sign. The reviewer named in step 1 appears as *Planned reviewer*.
- The **Testing table**, **Population**, **Src** and **Parameters & log** sheets are protected without a password. Tool results can't be changed by accident, while yellow cells, filters and formatting stay usable.

## 6. Using real SAP data

Typical sources:

| Evidence | Typical SAP / tool source |
|---|---|
| User master (type, created on/by, lock flag, valid to, last logon) | USR02 via SE16N, or SUIM RSUSR200 |
| Lock history | USH02 / change documents for users (SUIM RSUSR100N) – USR02 holds only the lock flag |
| Profiles / roles | UST04 (profiles) or AGR_USERS (roles) |
| Transports to production | E070 (owner) + import history from STMS or TPALOG (import time, importing user) |
| Batch jobs | TBTCO via SE16N or SM37 (status A / Canceled = failed) |
| HR leavers, access requests, change tickets, incidents | HR system and ticketing tool exports (ServiceNow, Jira…) |

Put real (anonymised) extracts in `real_data/` – git ignores that folder. Follow your firm's data protection rules: pseudonymise user IDs if possible and never use a cloud AI service with client data.

## 7. Setting up a local AI model (optional)

1. Install **Ollama** from ollama.com.
2. Download a model in a terminal: `ollama pull llama3.1:8b`
3. Allow the app to call it by starting Ollama with the setting `OLLAMA_ORIGINS=*`:
   - **Windows:** System Properties → Environment Variables → add `OLLAMA_ORIGINS` with value `*`, then restart Ollama.
   - **Mac:** in Terminal run `launchctl setenv OLLAMA_ORIGINS "*"`, then restart Ollama.
4. In the app, go to Settings → Free-text assessment → *Language model*, choose provider Ollama with address `http://localhost:11434` and model `llama3.1:8b`, then click **Test connection**.
5. For the consistency measurement, set **Repeat each check (runs)** to 5.

The AI part was tested with a simulated model only, not with a real one. Test it with Ollama before the experiment.

Notes:
- **Address not on this computer:** if it isn't `localhost`, the run stops and asks for explicit confirmation before any evidence text is sent. The run log and the workpaper record whether evidence left the computer.
- **`OLLAMA_ORIGINS=*`** lets *any* web page open in your browser use the local model, not only this app. That's acceptable on a thesis or test computer. On a work computer, ask IT whether a narrower setting is needed, and turn it off when you're done.

## 8. Test data and the thesis experiment

Two synthetic datasets with the **same 47 seeded deviations**:

| Dataset | What it is |
|---|---|
| `sample_data/ITGC_synthetic_evidence_FY2025.xlsx` | Clean: one workbook, technical SAP column names, ISO dates, all fields filled. Built into the app as the demo. |
| `sample_data/messy_FY2025/` | **Real-world version**: ten exports in typical formats (SE16N UTF-16 text, ServiceNow Excel with title rows, STMS log, SM37 CSV…). It has all the problems listed in section 4, plus **13 planted ambiguous records** that are not deviations but must go to REVIEW. Generated by `tools/make_messy_dataset.js`; see its `README.txt`. |

Results of the keyword rules:

| Dataset | Recall | False positives |
|---|---|---|
| Clean | 47/47 | 0 |
| Messy | 47/47 | 13: exactly the planted ambiguous records, all REVIEW, none called an EXCEPTION |

**Important for interpreting the results:** the rules and both datasets were designed together (see Section 3.5 of the thesis on validity). The real test of the tool is real or independently prepared data.

Running the experiment:
1. **Automated conditions:** A1 = keyword rules; A2 = AI with 5 runs. Note the run time from the run log and your set-up time.
2. **Manual condition (M):** give participants only the evidence (ideally the messy exports), never the answer key, plus the control descriptions. Collect their results in the template from step 7 (**Download template**).
3. **Hybrid condition (H):** review the flagged items in step 6 and time it.
4. In step 7, load the answer key and the manual results, then **Export evaluation**. For the messy data use `messy_FY2025/ITGC_messy_answer_key_CONFIDENTIAL.xlsx` (first sheet = deviations).

## 9. Changing the tool and automated tests

- **Parameters, word lists, leadsheet texts:** in the app (step 4). No coding needed.
- **Program logic:** `src/engine.js` (evidence catalogue with column synonyms in section 1, control catalogue with attributes and procedures in section 2, test rules in section 8). Workpaper layout: `src/workpaper.js`. After editing, rebuild with `python build.py` (Mac: `python3 build.py`).
- **Automated checks** (need Node.js 22+):

| Command | Checks |
|---|---|
| `node tests/test_engine.js` | Clean data: populations, 100% recall and precision, AI mode with a simulated model, hallucination guard, kappa; the 2.1 safeguards on small hand-made cases (keyword and negation rules, AI cannot overrule a negative keyword, non-local AI refused, invalid period, results fingerprint, C1–C5 rule additions, NOT TESTED items) |
| `node tests/test_messy.js` | Messy exports: reading, auto-mapping, date and ID formats, recall, planted REVIEW items, NOT TESTED handling, single-control scope, workpaper for every control |
| `node tests/test_browser.js` | Clicks through the built app in headless Edge/Chrome: single-control run on messy files, workpaper download, all controls on demo data, evaluation, run log fingerprint, "Start a new engagement" wipes stored data |

Each must end with "All checks passed". To regenerate the messy dataset: `node tools/make_messy_dataset.js`.

## 10. Folder contents

```
dist/ITGC_Tester.html        the app (the only file you need to use it)
src/engine.js                evidence and control catalogue, mapping, data checks, control tests, AI, metrics
src/workpaper.js             Big4-style workpaper (leadsheet, C&A, population, testing table, exceptions)
src/xlsx.js                  Excel/CSV/text reading and formatted Excel writing (no external libraries)
src/app.js, style.css        user interface
sample_data/                 clean synthetic evidence and its CONFIDENTIAL answer key
sample_data/messy_FY2025/    real-world style exports of the same data + answer key
tools/make_messy_dataset.js  generates the messy dataset
tests/                       automated checks (engine, messy data, browser)
build.py                     builds dist/ITGC_Tester.html from src/
```
