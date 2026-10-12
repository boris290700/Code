// End-to-end check of the built app (dist/ITGC_Tester.html) in a headless Edge or Chrome,
// driven through the DevTools protocol: clicks through the steps like a user would.
// Needs Node.js 22+ and Edge or Chrome. Run after building:  node tests/test_browser.js
// How it works: starts Edge or Chrome without a visible window, opens the built app and
// "remote-controls" it like a user – clicking buttons, choosing files, reading what appears on
// the screen – then checks the results with ok(condition, message) lines (PASS / FAIL).
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const R = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'itgc-e2e-')), DL = path.join(tmp, 'downloads');
fs.mkdirSync(DL);
const browsers = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];
const exe = browsers.find(b => fs.existsSync(b));
if (!exe) { console.log('No Edge or Chrome found – browser test skipped.'); process.exit(0); }
const PORT = 9333;
const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${PORT}`, '--user-data-dir=' + path.join(tmp, 'profile'), '--no-first-run', 'about:blank']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = {}, errors = [];
// Low-level helpers to talk to the browser (send a command, run a piece of script in the page, click, wait).
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending[i] = { res, rej }; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
const nav = n => ev(`document.querySelectorAll('nav button')[${n - 1}].click(); return 1;`);
const click = text => ev(`const b=[...document.querySelectorAll('main button, main a')].find(x=>x.textContent.includes(${JSON.stringify(text)})); if(!b) throw new Error('no button '+${JSON.stringify(text)}); b.click(); return true;`);
const waitFor = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(`return !!(${expr})`)) return true; await sleep(200); } throw new Error('timeout: ' + expr); };
let failures = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };
const setFiles = async (selector, files) => { const d = await send('DOM.getDocument'); const n = await send('DOM.querySelector', { nodeId: d.root.nodeId, selector }); await send('DOM.setFileInputFiles', { nodeId: n.nodeId, files }); };
const download = async () => { for (let k = 0; k < 60; k++) { await sleep(250); const f = fs.readdirSync(DL).find(f => f.endsWith('.xlsx')); if (f) { await sleep(300); return f; } } return null; };
const finish = code => { try { ws?.close(); } catch { } proc.kill(); setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { } process.exit(code); }, 500); };

(async () => {
  for (let k = 0; k < 50; k++) { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(200); } }
  // open a desktop-sized window (headless ignores --window-size)
  const bv = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(), bws = new WebSocket(bv.webSocketDebuggerUrl);
  await new Promise(r => bws.onopen = r);
  const tid = await new Promise(r => { bws.onmessage = m => { const d = JSON.parse(m.data); if (d.id === 1) r(d.result.targetId); }; bws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank', newWindow: true, width: 1400, height: 1000 } })); });
  bws.close();
  ws = new WebSocket((await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.id === tid).webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { d.error ? pending[d.id].rej(new Error(d.error.message)) : pending[d.id].res(d.result); } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map(a => a.value || a.description).join(' ')); };
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
  await send('Page.navigate', { url: 'file:///' + path.join(R, 'dist', 'ITGC_Tester.html').replace(/\\/g, '/').replace(/^\//, '') });
  await sleep(1500);
  await ev(`localStorage.clear(); location.reload(); return 1`); await sleep(1500);

  // Scenario 1: one control (C1) tested on messy real-world exports
  ok((await ev(`return document.querySelector('main').textContent`)).includes('Controls to test'), 'app opens on the Scope step');
  await click('Clear');
  await ev(`[...document.querySelectorAll('.ctlpick')].find(l=>l.textContent.startsWith('C1')).querySelector('input').click(); return 1`);
  const sc = await ev(`return document.querySelector('nav .scope').textContent`);
  ok(sc.includes('C1') && !sc.includes('C2'), 'scope: only C1 selected');
  await click('Load evidence');
  const need = await ev(`return [...document.querySelectorAll('main table tr')].slice(1).map(r=>r.cells[0].textContent)`);
  ok(need.length === 2 && need.join().includes('User master') && need.join().includes('Access request'), 'evidence checklist asks only for C1 evidence: ' + need.join(', '));
  const md = path.join(R, 'sample_data', 'messy_FY2025');
  await setFiles('input[type=file]', ['SE16N_USR02_users.txt', 'ServiceNow_RITM_access_requests.xlsx', 'ServiceNow_change_requests.xlsx'].map(f => path.join(md, f)));
  await waitFor(`document.querySelector('main').textContent.includes('Loaded files')`);
  const st = await ev(`return [...document.querySelectorAll('main table')][0].innerText`);
  ok(/User master[\s\S]*OK[\s\S]*SE16N_USR02_users/.test(st) && /Access request tickets[\s\S]*OK[\s\S]*ServiceNow_RITM_access_requests/.test(st), 'both exports recognised and mapped automatically (unrelated file ignored)');
  await nav(3);
  const chips = await ev(`return [...document.querySelectorAll('main .chip')].map(c=>c.textContent)`);
  ok(!chips.includes('MISSING') && !chips.includes('FAIL'), `mapping and data checks: nothing missing (${chips.filter(c => c === 'WARNING').length} warning)`);
  await nav(5); await click('Run tests ('); await waitFor(`document.querySelector('.stat')`);
  const stat = await ev(`return document.querySelector('.stat').innerText`);
  ok(/Population 110/.test(stat) && (await ev(`return document.querySelectorAll('.stat').length`)) === 1, 'only C1 run: ' + stat.replace(/\s+/g, ' ').slice(0, 100));
  await nav(6);
  await ev(`const s=document.querySelector('main tbody select'); s.value='Confirmed exception'; s.dispatchEvent(new Event('change')); const t=document.querySelector('main tbody textarea'); t.value='checked'; t.dispatchEvent(new Event('change')); return 1`);
  await click('Export C1 workpaper');
  const f1 = await download();
  ok(!!f1, 'workpaper downloaded: ' + f1);
  if (f1) {
    const X = require('../src/xlsx.js'), wb = await X.readXlsx(fs.readFileSync(path.join(DL, f1)));
    ok(Object.keys(wb).includes('Leadsheet') && wb['Testing table'].length === 110 && wb['Testing table'].some(r => Object.values(r).includes('Confirmed exception')), 'workpaper: leadsheet, 110-row testing table with the auditor decision');
  }
  // Scenario 2: all six controls on the built-in demo data, then evaluation against the answer key
  await nav(1); await click('Select all'); await nav(2); await click('Clear all');
  await click('Load the synthetic demo dataset'); await waitFor(`document.querySelector('main').textContent.includes('Loaded files')`);
  await nav(5); await click('Run tests ('); await waitFor(`document.querySelectorAll('.stat').length===6`);
  const pops = await ev(`return [...document.querySelectorAll('.stat')].map(s=>s.querySelector('.small').textContent.match(/\\d+/)[0]).join(',')`);
  ok(pops === '110,85,409,240,240,55', 'demo data, all six controls: populations ' + pops);
  await nav(7);
  await setFiles('main input[type=file]', [path.join(R, 'sample_data', 'ITGC_answer_key_FY2025_CONFIDENTIAL.xlsx')]);
  await waitFor(`document.querySelector('main').textContent.includes('Automated test vs answer key')`);
  const evt = await ev(`return document.querySelector('main .scroll').innerText`);
  ok((evt.match(/100\.0%/g) || []).length >= 24, 'evaluation: coverage, precision, recall and F1 100% on all six controls');
  // Scenario 3: a first-time user clicks "Try the demo" on the welcome screen
  await ev(`localStorage.clear(); location.reload(); return 1`); await sleep(1500);
  await click('Try the demo'); await waitFor(`document.querySelectorAll('.stat').length===6`);
  ok((await ev(`return document.querySelector('main h2').textContent`)) === 'Run tests', 'one-click demo: loads the demo data, runs all six controls and shows the results');
  ok(!errors.length, 'no JavaScript errors in the page' + (errors.length ? ': ' + errors.join(' | ').slice(0, 500) : ''));
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  finish(failures ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message, errors); finish(1); });
