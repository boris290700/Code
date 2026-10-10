# ITGC Tester – user guide

A prototype tool for automated testing of IT general controls (ITGCs), built for the master thesis *Development and Empirical Evaluation of an Automated IT General Controls Testing Framework*.

It tests the **whole population** of six common SAP ITGCs, marks every item as **PASS**, **EXCEPTION** or **REVIEW**, lets the auditor record a decision on each flagged item and exports an Excel workpaper. It also calculates the evaluation metrics for the thesis experiment (precision, recall, F1, coverage, Cohen's kappa).

---

## 1. Opening the app

1. Open the folder `dist` and double-click **`ITGC_Tester.html`**.
2. It opens in your web browser. Use Chrome or Edge; Firefox and Safari also work.
3. Nothing needs to be installed. The app works offline. **All files are processed inside the browser and nothing is uploaded anywhere.** That's important for client data.

To try it right away, click **"Load the synthetic demo dataset"** on the first screen.

## 2. The six steps

| Step | What you do |
|---|---|
| 1. Load evidence | Drag in the Excel or CSV extracts. Each file gets a SHA-256 fingerprint for the run log. Enter your name or initials. |
| 2. Map & check data | Tell the tool which sheet and column holds each field. The defaults match the demo data. Then read the completeness and accuracy checks (IPE), and investigate every WARNING. |
| 3. Settings | Set the audit period and the parameters of each control, for example the leaver days, the approver list and the privileged profiles. Choose keyword rules or AI for the free-text checks. Save the settings to a file for the audit documentation. |
| 4. Run tests | One click. You get a summary per control and a run log entry. |
| 5. Review & export | Decide on every EXCEPTION and REVIEW item (Confirmed exception / Not an exception / More information needed) and add comments. Then **export the workpaper** (.xlsx). |
| 6. Evaluate | For the experiment: load the answer key and the manual testers' results to get the metrics, then export them. |

Your settings, decisions and run history are remembered in this browser. They are lost if you clear browser data, so export the workpaper and the settings file.

## 3. The controls and their rules

| ID | Control | Flagged as EXCEPTION when… | Sent to REVIEW when… |
|---|---|---|---|
| C1 | New users approved before creation | no ticket; ticket not approved; no approver, approver = creator or not on the approver list; approval date after creation | – |
| C2 | Leavers locked within *N* days | locked later than *N* days; still active at period end; logon after termination | no user account found; locked but lock date unknown |
| C3 | Privileged profiles restricted | active user holds a privileged profile and is not on the approved list | – |
| C4 | Changes approved and tested before import | no ticket; approval after import; emergency change without post-approval; test text inadequate | test text unclear |
| C5 | Developer does not import own change | transport owner = importing user | owner or importer missing |
| C6 | Failed jobs followed up | no incident; incident not resolved; resolution text inadequate | resolution text unclear |

**Free text** (C4 test evidence, C6 resolution) is assessed in one of two ways:

- **Keyword rules (default):** a negative word (for example "no testing") gives an EXCEPTION, a positive word (for example "UAT") gives a PASS, and anything else goes to REVIEW. You can edit the word lists in Settings.
- **Language model (AI):** the model answers ADEQUATE, INADEQUATE or UNCLEAR and must quote the evidence. If it says ADEQUATE but the quote is not really in the text, the item goes to REVIEW (protection against invented answers). With several runs, any item where the runs disagree also goes to REVIEW.

## 4. Using real SAP data

Extract the data for the audit period to Excel, then adjust the mapping in step 2. Typical sources:

| Evidence | Typical SAP source |
|---|---|
| User master (type, created on/by, lock flag, last logon) | USR02 (or the SUIM user report) |
| Lock date | USH02 / change documents for users (USR02 holds only the lock flag) |
| Profiles / roles | UST04 (profiles); for roles AGR_USERS |
| Transports to production | E070 (owner) + import history from STMS or TPALOG (import time, importing user) |
| Batch jobs | TBTCO (status A = cancelled, F = finished) |
| HR leavers, access requests, change tickets, incidents | HR system and ticketing tool exports |

Other date formats such as `DD.MM.YYYY` and `YYYYMMDD` are recognised. Before using real data, follow your firm's data protection rules: pseudonymise user IDs if possible and never use a cloud AI service with client data.

## 5. Setting up a local AI model (optional)

1. Install **Ollama** from ollama.com.
2. Download a model in a terminal: `ollama pull llama3.1:8b`
3. Allow the app to call it by starting Ollama with the setting `OLLAMA_ORIGINS=*`:
   - **Windows:** System Properties → Environment Variables → add `OLLAMA_ORIGINS` with value `*`, then restart Ollama.
   - **Mac:** in Terminal run `launchctl setenv OLLAMA_ORIGINS "*"`, then restart Ollama.
4. In the app, go to Settings → Free-text assessment → *Language model*, choose provider Ollama with address `http://localhost:11434` and model `llama3.1:8b`, then click **Test connection**.
5. For the consistency measurement, set **Repeat each check (runs)** to 5.

The AI part was tested with a simulated model only, not with a real one. Test it with Ollama before the experiment.

## 6. Running the thesis experiment

1. **Automated conditions:**
   - **A1:** run with keyword rules.
   - **A2:** run with AI and 5 runs.
   - Note the run time from the run log, and note your set-up time yourself.
2. **Manual condition (M):** give participants only the evidence file, never the answer key, plus the control descriptions. Collect their results in the template from step 6 (**Download template**): one row per tested item with Participant, Control, Record ID, Conclusion and Minutes.
3. **Hybrid condition (H):** review the flagged items in step 5 and time it.
4. In step 6, load the answer key and the manual results, then **Export evaluation**.

**Important for interpreting the results:** on the synthetic data the keyword rules find all 47 seeded deviations with no false alarms. That's expected, because the rules and the data were designed together (see Section 3.5 of the thesis on validity). The real test of the tool is real or independently prepared data.

## 7. Changing the tool

- **Parameters and word lists:** change them in the app (step 3). No coding is needed.
- **Program logic:** all test rules are in `src/engine.js`, section 6, one block per control, with comments. After editing, rebuild the app by running `python3 build.py` (creates `dist/ITGC_Tester.html`).
- **Automated check after changes:** run `node tests/test_engine.js`. It needs Node.js. It runs the tool on the synthetic data and must end with "All checks passed".

## 8. Folder contents

```
dist/ITGC_Tester.html     the app (the only file you need to use it)
src/engine.js             test logic: mapping, data checks, controls C1–C6, AI, metrics
src/xlsx.js               Excel/CSV reading and writing (no external libraries)
src/app.js, style.css     user interface
sample_data/              synthetic evidence and the CONFIDENTIAL answer key
tests/test_engine.js      automated check of the engine
build.py                  builds dist/ITGC_Tester.html from src/
```

## 9. Note for the thesis

This prototype was developed with the help of an AI assistant (Claude, Anthropic). Under RTU/FCSITE rules, describe this in the thesis's AI-use statement (Appendix 3). Agree with your supervisor how AI-assisted development fits the requirement that the solution be your own work. Either way, you should be able to explain every rule in `engine.js` at the defence.
