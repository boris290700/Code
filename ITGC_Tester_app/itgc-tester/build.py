"""Builds the single-file app: dist/ITGC_Tester.html (open it in Chrome or Edge).
Run:  python3 build.py"""
import base64, pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
html = (src / 'index.html').read_text(encoding='utf-8')
demo = root / 'sample_data' / 'ITGC_synthetic_evidence_FY2025.xlsx'
parts = {
    '/*STYLE*/': (src / 'style.css').read_text(encoding='utf-8'),
    '/*XLSX*/': (src / 'xlsx.js').read_text(encoding='utf-8'),
    '/*ENGINE*/': (src / 'engine.js').read_text(encoding='utf-8'),
    '/*DEMO*/': ('window.DEMO_XLSX_B64="%s";' % base64.b64encode(demo.read_bytes()).decode()) if demo.exists() else '',
    '/*APP*/': (src / 'app.js').read_text(encoding='utf-8'),
}
for k, v in parts.items():
    html = html.replace(k, v.replace('</script', '<\\/script'))
out = root / 'dist' / 'ITGC_Tester.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print('Built', out, round(out.stat().st_size / 1024), 'KB')
