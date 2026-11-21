import sys,json
from urllib.parse import quote
cfg = {"url":"https://vceotinkkfstkbhobiaq.supabase.co","key":"sb_publishable_qcmLT_Baox1T_pcu3FwLng_-i3ANOCi"}
if len(sys.argv)>1 and sys.argv[1]=='mock': cfg={"url":"http://mock","key":"mock"}
r=lambda p: open(p,encoding='utf-8').read()
sbjs = r('mock_supabase.js') if len(sys.argv)>1 and sys.argv[1]=='mock' else r('node_modules/@supabase/supabase-js/dist/umd/supabase.js')
def css():
    st=r('src/style.css'); i=st.index('@import')
    rest=st[i:].split('\n',2)[2]
    return st[:i]+r('src/tokens.css')+'\n'+r('src/base.css')+'\n'+rest
html=f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DMM Manpower Planning</title>
<meta name="description" content="Man-hours and manpower planning for the Dammam wagon, 10-year overhaul and loco workshops.">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,{quote(r('src/favicon.svg'))}">
<style>{css()}</style></head>
<body><div id="app"><div class="loading">Loading…</div></div><div class="toasts" id="toasts"></div>
<script>window.APP_CONFIG={json.dumps(cfg)};</script>
<script>{sbjs.replace('</script>','<\\/script>')}</script>
<script>{r('node_modules/xlsx/dist/xlsx.full.min.js').replace('</script>','<\\/script>')}</script>
<script>(function(){{{r('node_modules/xlsx-js-style/dist/xlsx.min.js').replace('</script>','<\\/script>')}
window.XLSXS = XLSX;}})();</script>
<script>{r('src/sar-logo.js')}</script>
<script>{r('src/calc.js')}</script>
<script>{r('src/app.js')}</script>
</body></html>'''
out = 'dist/mock.html' if len(sys.argv)>1 and sys.argv[1]=='mock' else 'dist/index.html'
import os; os.makedirs('dist',exist_ok=True); open(out,'w',encoding='utf-8').write(html); print(out, len(html))
