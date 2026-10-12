"""Builds the single-file app: dist/ITGC_Tester.html (open it in Chrome or Edge).
Run:  python3 build.py"""
# How it works: the app is developed as separate files in src/ (screens, rules, Excel code,
# styles). For users it is combined into ONE html file that opens by double-click and works
# offline. This script copies each source file into the placeholders (/*STYLE*/, /*ENGINE*/ ...)
# of src/index.html, also embeds the demo dataset, and writes dist/ITGC_Tester.html.
import base64, pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
html = (src / 'index.html').read_text(encoding='utf-8')
# The demo workbook is embedded as text (base64) so the "Load demo dataset" link works without the file.
demo = root / 'sample_data' / 'ITGC_synthetic_evidence_FY2025.xlsx'
parts = {
    '/*STYLE*/': (src / 'style.css').read_text(encoding='utf-8'),
    '/*XLSX*/': (src / 'xlsx.js').read_text(encoding='utf-8'),
    '/*ENGINE*/': (src / 'engine.js').read_text(encoding='utf-8'),
    '/*WORKPAPER*/': (src / 'workpaper.js').read_text(encoding='utf-8'),
    '/*DEMO*/': ('window.DEMO_XLSX_B64="%s";' % base64.b64encode(demo.read_bytes()).decode()) if demo.exists() else '',
    '/*APP*/': (src / 'app.js').read_text(encoding='utf-8'),
}
# Fill each placeholder; "</script" is escaped so the browser does not end the code block early.
for k, v in parts.items():
    html = html.replace(k, v.replace('</script', '<\\/script'))
out = root / 'dist' / 'ITGC_Tester.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8', newline='\n')
print('Built', out, round(out.stat().st_size / 1024), 'KB')
