# Getting started – running the ITGC Tester on your computer

This guide takes you from a fresh computer to a working app in about 10 minutes. There are three levels. Most people only need **Part A**.

| I want to… | Follow | Install needed |
|---|---|---|
| Use the app (test controls, review, export) | Part A | Nothing – only a web browser |
| Check that the test logic works | Part A + B | Node.js |
| Change the code and rebuild the app | Part A + B + C | Node.js and Python |
| Use the AI free-text check | Part D (optional) | Ollama |

---

## Part A – Use the app (no installation)

### A1. Get the files

- **From GitHub:** open the repository page, click **Code → Download ZIP**, and unzip it, *or* run `git clone <repository URL>` if you have Git.
- **From a ZIP you received:** right-click it → **Extract All…** (Windows) or double-click it (Mac).

You should end up with a folder named `itgc-tester` that contains `dist`, `src`, `sample_data`, `tests`, `build.py` and `README.md`.

### A2. Open the app

1. Open the folder `itgc-tester/dist`.
2. Double-click **`ITGC_Tester.html`**.
3. It opens in your default browser. Use **Chrome or Edge** (Firefox and Safari also work).
   - If it opens in another program, right-click the file → **Open with** → Chrome / Edge.

The app runs entirely in your browser and works offline. Files you load are **not uploaded anywhere**.

### A3. First run with the demo data

**Fastest way:** click **Try the demo** on the welcome screen. The app selects all six controls, loads the demo data, runs the tests and opens the results. Then continue with step 6 below.

**Step by step** (to see each screen). Use the **Next** button at the bottom of each screen. If a term is unclear, click **Glossary** in the top right corner.

| Step | Do this | You should see |
|---|---|---|
| 1. Scope | Type your initials in *Prepared by*. Leave all six controls ticked. | Six controls with their attributes and the evidence each one needs |
| 2. Load evidence | Click **"Load the synthetic demo dataset (FY 2025)"**. | The evidence checklist turns to OK; one file with 9 sheets and a SHA-256 fingerprint |
| 3. Map & check data | Leave the mapping as is. | Completeness and accuracy checks, with no FAIL or MISSING rows |
| 4. Settings | Leave the defaults. | Parameters and leadsheet details per control |
| 5. Run tests | Click **Run tests**. | Populations C1 = 110, C2 = 85, C3 = 409, C4 = 240, C5 = 240, C6 = 55 |
| 6. Review & export | Choose a decision for a few flagged items, then **Export C1 workpaper**. | An Excel workpaper in your *Downloads* folder (Leadsheet, C&A, Population, Testing table, Exceptions…) |
| 7. Evaluate | **Load answer key** → choose `sample_data/ITGC_answer_key_FY2025_CONFIDENTIAL.xlsx`. | Precision and recall 100% for every control (47 deviations) |

If you see these numbers, the app works on your machine.

> **Note:** settings, decisions and run history are saved in this browser only, and clearing browser data deletes them. Decisions are kept per engagement (client and period): after a reload, load the same files and run again, and they come back for items whose tool result didn't change. **Start a new engagement** (step 1) deletes everything stored before you move to another client. Export the workpaper to keep your work.

### A4. Try one control with "real-world" exports

This shows how the tool copes with untidy exports and how to test a single control.

1. Step 1: click **Clear**, then tick only **C1**.
2. Step 2: the checklist now asks only for the *User master* and *Access request tickets*. From `sample_data/messy_FY2025/`, drag in `SE16N_USR02_users.txt` and `ServiceNow_RITM_access_requests.xlsx`.
3. Both are recognised automatically, even though one is a UTF-16 SAP text export and the other has title rows, display names like `Ilze Vitola (IVITOLA)` and `dd/mm/yyyy` dates.
4. Step 3 shows what was handled: header rows, footer lines and the duplicate ticket. Steps 5–6: run, review and export the C1 workpaper.

You should see 9 exceptions and 5 review items. The review items are tickets with a missing approval date, or with the approval only mentioned in a comment.

### A5. Using your own data

1. Put your extracts (`.xlsx`, `.csv` or SAP `.txt` exports) in the folder `itgc-tester/real_data/`. Git ignores this folder, so the data is never committed.
2. In step 1, choose the controls you are testing.
3. In step 2, load your files. Sheets and columns are matched automatically.
4. In step 3, check the mapping, correct it where needed and read every WARNING.
5. In step 4, set the control parameters and the client's control description. Click **Save settings to file** for the audit documentation.

See `README.md` sections 4 and 6 for what the tool handles and for typical SAP sources.

---

## Part B – Check the test logic (install Node.js)

The automated tests run the tool on the clean and the messy datasets and compare the results with the answer keys.

### B1. Install Node.js (LTS version)

**Windows** – open *PowerShell* (Start menu → type "PowerShell") and run:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

Or download the **LTS** installer from https://nodejs.org and click through it with the defaults.

**Mac** – download the **LTS** installer from https://nodejs.org, or, if you use Homebrew:

```bash
brew install node
```

**Close the terminal and open a new one** so it finds the new program. Then check:

```
node --version
```

It should print a version such as `v24.x.x`.

### B2. Run the tests

In the terminal, go to the `itgc-tester` folder. Replace the path with yours. Tip: type `cd ` and drag the folder into the window.

```
cd "C:\Users\<you>\...\itgc-tester"        (Windows)
cd ~/.../itgc-tester                        (Mac)
node tests/test_engine.js                   # clean demo data
node tests/test_messy.js                    # real-world style exports, workpapers
node tests/test_browser.js                  # clicks through the app in headless Edge/Chrome
```

Each prints a list of `PASS` lines and ends with:

```
All checks passed
```

If any line starts with `FAIL`, the tool no longer gives the expected results. The browser test needs Edge or Chrome; if neither is found, it is skipped.

---

## Part C – Change the code and rebuild (install Python)

The app you open (`dist/ITGC_Tester.html`) is built from the files in `src/`. After editing anything in `src/`, rebuild it.

### C1. Install Python 3

**Windows:**

```powershell
winget install --id Python.Python.3.12 -e
```

Or use the installer from https://www.python.org/downloads/. **Tick "Add python.exe to PATH"** on its first screen.

> On Windows, typing `python` may open the Microsoft Store instead of running Python. If that happens, use `py` instead of `python` below, or turn off *Settings → Apps → Advanced app settings → App execution aliases → python.exe / python3.exe*.

**Mac:** Python 3 is usually already there (`python3 --version`). If not, run `brew install python` or use the python.org installer.

Open a new terminal and check:

```
python --version      (Windows; or: py --version)
python3 --version     (Mac)
```

### C2. Edit, rebuild, test

| File | What it contains |
|---|---|
| `src/engine.js` | Evidence catalogue with column synonyms (section 1), controls with attributes and procedures (section 2), data checks, test rules (section 8, one block per control), AI check, metrics |
| `src/workpaper.js` | Layout of the Excel workpaper (leadsheet, C&A, population, testing table, exceptions) |
| `src/app.js` | User interface (the seven steps) |
| `src/xlsx.js` | Reading Excel/CSV/text exports and writing formatted Excel |
| `src/style.css`, `src/index.html` | Look and page layout |
| `tools/make_messy_dataset.js` | Generates `sample_data/messy_FY2025/` |

After editing, run this from the `itgc-tester` folder:

```
node tests/test_engine.js     # check the logic still works
node tests/test_messy.js
python build.py               # Windows (or: py build.py)
python3 build.py              # Mac
node tests/test_browser.js    # check the rebuilt app
```

The build prints `Built …/dist/ITGC_Tester.html 393 KB`. Reload the page in the browser (F5) to see your changes.

---

## Part D – Optional: the AI free-text check with a local model

Only needed for the AI condition of the experiment. The keyword rules work without it.

1. Install **Ollama** from https://ollama.com (Windows: `winget install --id Ollama.Ollama -e`).
2. In a terminal, download a model (about 5 GB):
   ```
   ollama pull llama3.1:8b
   ```
3. Allow the app to talk to Ollama by setting the environment variable `OLLAMA_ORIGINS` to `*`:
   - **Windows:** Start → "Edit the system environment variables" → *Environment Variables…* → under *User variables* click **New** → name `OLLAMA_ORIGINS`, value `*`. Then quit Ollama (tray icon → Quit) and start it again.
   - **Mac:** `launchctl setenv OLLAMA_ORIGINS "*"`, then quit and restart Ollama.
4. In the app: **Settings → Free-text assessment → Language model (AI)**, provider **Ollama**, address `http://localhost:11434`, model `llama3.1:8b`. Click **Test connection**. You should see `✓ Model answered: ADEQUATE …`.
5. To measure consistency, set **Repeat each check (runs)** to `5`. Running all 287 texts five times takes several minutes.

Never send real client data to a cloud AI service. Use a local model, or only the synthetic data.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| The HTML file opens as text or in the wrong program | Right-click → Open with → Chrome / Edge |
| `node` or `python` is "not recognized" / "command not found" | Close and reopen the terminal after installing. If it still fails, reinstall and make sure "Add to PATH" is ticked. |
| `python` opens the Microsoft Store | Use `py`, or turn off the App execution aliases (see C1) |
| An evidence type is MISSING or a column isn't found | The automatic mapping didn't recognise your file. In step 3 choose the sheet and columns in the drop-downs, or click **Auto-detect all from column names**. |
| The header row is wrong (columns called COLUMN_1…) | In step 3, set the correct **Header row** number for that sheet |
| A control says "not run – Missing evidence" | That control needs a sheet or field you haven't mapped (the message says which). Map it in step 3, or remove the control from the scope in step 1. |
| An attribute is NOT TESTED | The field it needs isn't in your export. Get a better extract, or test that attribute manually and fill the yellow N/T cells in the workpaper's testing table. |
| Dates show as "not recognised" | Most formats are read (see README section 4). For ambiguous `03/04/2025` dates choose day/month or month/day in step 4 → *Data format*. |
| A status value isn't treated as approved / failed / resolved | Step 3 lists every status value found. Add the missing ones to the matching list in step 4. || AI "Test connection" fails | Check that Ollama is running, the model name matches `ollama list`, and `OLLAMA_ORIGINS=*` is set (restart Ollama after setting it) |
| My settings or decisions disappeared | They live in browser storage. Use the same browser, don't clear site data, and keep the exported settings file and workpaper. |
