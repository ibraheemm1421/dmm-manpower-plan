import sys,json
cfg = {"url":"https://vceotinkkfstkbhobiaq.supabase.co","key":"sb_publishable_qcmLT_Baox1T_pcu3FwLng_-i3ANOCi"}
if len(sys.argv)>1 and sys.argv[1]=='mock': cfg={"url":"http://mock","key":"mock"}
r=lambda p: open(p,encoding='utf-8').read()
sbjs = r('mock_supabase.js') if len(sys.argv)>1 and sys.argv[1]=='mock' else r('node_modules/@supabase/supabase-js/dist/umd/supabase.js')
html=f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DMM Manpower Planning</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230B4F79'/%3E%3Ctext x='16' y='22' font-size='14' text-anchor='middle' fill='white' font-family='Arial' font-weight='bold'%3EMP%3C/text%3E%3C/svg%3E">
<style>{r('src/style.css')}</style></head>
<body><div id="app"><div class="loading">Loading…</div></div><div class="toasts" id="toasts"></div>
<script>window.APP_CONFIG={json.dumps(cfg)};</script>
<script>{sbjs.replace('</script>','<\\/script>')}</script>
<script>{r('node_modules/xlsx/dist/xlsx.full.min.js').replace('</script>','<\\/script>')}</script>
<script>{r('node_modules/chart.js/dist/chart.umd.min.js').replace('</script>','<\\/script>')}</script>
<script>{r('src/calc.js')}</script>
<script>{r('src/app.js')}</script>
</body></html>'''
out = 'dist/index.html'
import os; os.makedirs('dist',exist_ok=True); open(out,'w',encoding='utf-8').write(html); print(out, len(html))
