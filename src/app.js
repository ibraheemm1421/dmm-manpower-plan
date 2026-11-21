/* DMM Workshops — Manpower Plan */
(() => {
'use strict';
const CFG = window.APP_CONFIG;
const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true } });
const EMAIL_DOMAIN = '@dmm-mp.local';
// codes renamed on 21 Nov 2026 (8 hr M/A/N, 12 hr M/N, absent AB); old Excel files are converted on import
const OLD_CODES = { WAGON: { 'E - 8hr': 'M - 8hr', 'D - 8hr': 'M - 8hr', 'L - 8hr': 'A - 8hr', 'D - 12hr': 'M - 12hr', A: 'AB' }, OH10: { 'E - 8hr': 'M - 8hr', 'D - 8hr': 'M - 8hr', 'L - 8hr': 'A - 8hr', 'D - 12hr': 'M - 12hr', A: 'AB' }, LOCO: { 'D - 8hr': 'M - 8hr', 'E - 8hr': 'N - 8hr', 'D - 12hr': 'M - 12hr', 'E - 12hr': 'N - 12hr', A: 'AB' } };
const newCode = (ws, c) => ((OLD_CODES[ws] || {})[c]) || c;
const STATUS_TYPES = ['Annual Leave', 'Planned Leave', 'Sick', 'Training', 'Overtime', 'Absent', 'Custom'];
const ROLES = ['Technician', 'Senior Technician', 'Team Leader', 'Foreman', 'Office', 'Data Entry', 'Tools Office'];
const TABLES = ['workshops', 'settings', 'sections', 'shift_codes', 'patterns', 'teams', 'employees', 'status_changes', 'exam_types', 'workload_counts', 'month_plans'];

const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
const S = {
  me: null, all: null, cache: {}, ws: null, view: 'dashboard',
  alt: false, type: 'month', start: null, section: '',
  studyExam: null, empFilter: { q: '', section: '', status: 'Active' }, studyCache: {},
};

// ---------- helpers ----------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => (n === null || n === undefined || isNaN(n)) ? '–' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
const fmt2 = (n) => fmt(n, 2);
const fmt0 = (n) => fmt(n, 0);
const pct = (n) => isNaN(n) ? '–' : (n * 100).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
const signed = (n, f = fmt) => (n < 0 ? '−' : '+') + f(Math.abs(n));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_L = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dlabel = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; };
const today = () => Calc.iso(new Date(Date.now() + 3 * 3600000)); // Riyadh date
const isAdmin = () => S.me && S.me.role === 'admin';
const canEdit = () => S.me && (S.me.role === 'admin' || S.me.role === 'editor') && (!S.me.workshop_id || S.me.workshop_id === S.ws);
const multiWs = () => S.me && !S.me.workshop_id;
const str = (v) => (v === null || v === undefined) ? '' : String(v).trim();

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg; t.setAttribute('role', 'status');
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500);
}
function fail(e) { console.error(e); toast(e.message || String(e), 'err'); }
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }

// ---------- data ----------
async function loadAll() {
  const res = await Promise.all(TABLES.map((t) => q(sb.from(t).select('*'))));
  const all = {}; TABLES.forEach((t, i) => (all[t] = res[i]));
  all.workshops.sort((a, b) => a.sort - b.sort);
  all.users = isAdmin() ? await q(sb.from('app_users').select('*').order('username')) : [];
  S.all = all; S.cache = {};
  if (!S.ws || !all.workshops.find((w) => w.id === S.ws)) S.ws = S.me.workshop_id || store('mp_ws') || (all.workshops[0] && all.workshops[0].id);
  if (!all.workshops.find((w) => w.id === S.ws)) S.ws = all.workshops[0] && all.workshops[0].id;
}
function wsData(id = S.ws) {
  if (S.cache[id]) return S.cache[id];
  const f = (t) => S.all[t].filter((r) => r.workshop_id === id);
  const roleRank = { 'Team Leader': 0, 'Foreman': 0, 'Senior Technician': 1, 'Technician': 2 };
  const d = Calc.indexData({
    workshop: S.all.workshops.find((w) => w.id === id),
    settings: S.all.settings.find((s) => s.workshop_id === id) || { tl_factor: 1, mp_div_8: 30, mp_div_12: 31.5 },
    sections: f('sections').sort((a, b) => a.sort - b.sort),
    shift_codes: f('shift_codes').sort((a, b) => a.sort - b.sort),
    patterns: f('patterns').sort((a, b) => a.name.localeCompare(b.name)),
    teams: f('teams').sort((a, b) => a.sort - b.sort),
    employees: f('employees'),
    status_changes: f('status_changes'),
    month_plans: f('month_plans'),
    exam_types: f('exam_types').sort((a, b) => a.sort - b.sort || a.id - b.id),
  });
  const teamSort = (e) => { const t = d.teamMap[e.team_id]; return t ? t.sort : 999; };
  d.employees.sort((a, b) => teamSort(a) - teamSort(b) || (roleRank[a.role] ?? 3) - (roleRank[b.role] ?? 3) || a.name.localeCompare(b.name));
  d.counts = S.all.workload_counts.filter((c) => c.workshop_id === id);
  S.cache[id] = d;
  return d;
}
function countsFor(d, type, start, field = 'count') {
  const o = {};
  d.counts.filter((c) => c.period_type === type && c.period_start === start && c[field] !== null && c[field] !== undefined).forEach((c) => (o[c.exam_type_id] = Number(c[field])));
  return o;
}
function result(d = wsData(), type = S.type, start = pStart(), alt = S.alt) {
  const st = Calc.periodStart(type, start);
  return Calc.compute(d, { alt: alt && d.hasAlt, type, start: st, counts: countsFor(d, type, st), actuals: countsFor(d, type, st, 'actual') });
}
async function refresh() { await loadAll(); render(); }
const pStart = () => Calc.periodStart(S.type, S.start);
function periodLabel(type = S.type, start = pStart()) {
  if (type === 'week') { const s = Calc.weekStart(start), e = Calc.addDays(s, 6); return `${dlabel(s)} – ${dlabel(e)}`; }
  return `${MONTHS_L[+start.slice(5, 7) - 1]} ${start.slice(0, 4)}`;
}
const periodNoun = () => (S.type === 'week' ? 'this week' : MONTHS_L[+pStart().slice(5, 7) - 1]);
const patName = (d, id) => (d.patMap[id] || {}).name || '';
const secName = (d, id) => (d.secMap[id] || {}).name || 'No section';

// ---------- modal ----------
function modal({ title, body, buttons = [], wide = false, onOpen }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button aria-label="Close" data-x>×</button></header>
    <div class="body">${body}</div><footer></footer></div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const foot = $('footer', ov);
  buttons.forEach((b) => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.cls || ''); el.textContent = b.label;
    el.onclick = async () => {
      if (!b.action) return close();
      el.disabled = true;
      try { const r = await b.action(ov); if (r !== false) close(); } catch (e) { fail(e); } finally { el.disabled = false; }
    };
    foot.appendChild(el);
  });
  $('[data-x]', ov).onclick = close;
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
  if (onOpen) onOpen(ov);
  const first = $('.body input:not([type=checkbox]),.body select,.body textarea', ov); if (first) first.focus();
  return ov;
}
function confirmBox(title, text, okLabel = 'Delete') {
  return new Promise((res) => {
    const ov = modal({ title, body: `<p class="m0">${text}</p>`, buttons: [
      { label: 'Cancel', action: () => { res(false); } },
      { label: okLabel, cls: okLabel === 'Delete' || okLabel === 'Remove' ? 'danger' : 'primary', action: () => { res(true); } },
    ] });
    $('[data-x]', ov).addEventListener('click', () => res(false));
  });
}

// ---------- auth ----------
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  try {
    const me = await q(sb.from('app_users').select('*').eq('user_id', session.user.id).maybeSingle());
    if (!me) { await sb.auth.signOut(); return showLogin('This account has no access to the app. Ask the admin.'); }
    S.me = me;
    S.start = S.start || today();
    $('#app').innerHTML = '<div class="loading">Loading workshops…</div>';
    await loadAll();
    $('#app').innerHTML = shellHTML(); bindShell();
    route();
  } catch (e) { fail(e); showLogin('Could not load data: ' + (e.message || e)); }
}
function showLogin(msg = '') {
  $('#app').innerHTML = `<div class="login-wrap"><header class="appbar"><span class="logo">${SAR_MARK}<span class="mark">DMM Manpower planning</span></span></header>
    <div class="login-body"><div class="login-card"><div class="login-logo">${SAR_LOGO}</div><h1>Sign in</h1><p class="lead">Use the username and password given to you by the administrator.</p>
    <form id="loginForm" autocomplete="on">
      <label class="f">Username<input type="text" id="lu" autocomplete="username" autocapitalize="none" required></label>
      <label class="f">Password<input type="password" id="lp" autocomplete="current-password" required></label>
      <div class="err" id="lerr" role="alert">${esc(msg)}</div>
      <button class="btn primary w-full" type="submit">Sign in</button>
    </form></div></div><div class="login-foot">Manpower planning for the Wagon, 10-Year Overhaul and Loco workshops</div></div>`;
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const u = $('#lu').value.trim().toLowerCase(), p = $('#lp').value;
    $('#lerr').textContent = 'Signing in…';
    let error;
    try { ({ error } = await sb.auth.signInWithPassword({ email: u + EMAIL_DOMAIN, password: p })); } catch (x) { error = x; }
    if (error) {
      const m = String(error.message || error);
      $('#lerr').textContent = m === 'Invalid login credentials' ? 'Wrong username or password. Passwords are case-sensitive.'
        : /fetch|network|load failed|cors/i.test(m) || error.status === 0 ? 'Cannot reach the server. Check the internet connection and try again.' : m;
      return;
    }
    boot();
  };
  $('#lu').focus();
}

// ---------- shell ----------
const NAV = [
  ['dashboard', 'Dashboard'], ['workload', 'Workload'], ['roster', 'Roster & Leave'], ['employees', 'Employees'],
  ['timestudy', 'Time Study'], ['settings', 'Settings'], ['data', 'Export / Import'], ['users', 'Users', 'admin'], ['log', 'Activity'],
];
// General manager (view only, all workshops) sees the executive dashboard only
const execOnly = () => S.me && S.me.role === 'viewer' && !S.me.workshop_id;
function navAllowed(v) {
  if (v === 'dashboard') return true;
  if (execOnly()) return false;
  if (v === 'users') return isAdmin();
  if (S.me.role === 'viewer' && ['settings', 'data', 'log'].includes(v)) return false;
  return true;
}
function shellHTML() {
  const nav = NAV.filter((n) => navAllowed(n[0])).map((n) => `<a href="#${n[0]}" data-nav="${n[0]}">${n[1]}</a>`).join('');
  const roleText = { admin: 'Administrator', editor: 'Workshop manager', viewer: S.me.workshop_id ? 'View only' : 'General manager' }[S.me.role];
  const scope = S.me.workshop_id ? (S.all.workshops.find((w) => w.id === S.me.workshop_id) || {}).short_name || '' : 'All workshops';
  const initials = (S.me.display_name || S.me.username).split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  return `<header class="appbar">
      <button class="menu-btn" id="menuBtn" aria-label="Menu">☰</button>
      <a class="logo" href="#dashboard" aria-label="Dashboard">${SAR_MARK}<span class="mark">DMM Manpower planning</span></a>
      <nav class="topnav" id="nav">${nav}</nav><div class="spacer"></div>
      <div class="usermenu"><button id="userBtn" aria-haspopup="true"><span class="avatar">${esc(initials)}</span><span class="who"><b>${esc(S.me.display_name || S.me.username)}</b><span>${roleText}, ${esc(scope)}</span></span>▾</button>
        <div class="dropdown" id="userDrop"><button id="pwBtn">Change password</button><button id="outBtn">Sign out</button></div></div>
    </header>
    <main class="page" id="view"></main>`;
}
function bindShell() {
  $('#outBtn').onclick = async () => { await sb.auth.signOut(); S.me = null; showLogin(); };
  $('#pwBtn').onclick = () => { $('#userDrop').classList.remove('open'); changeMyPassword(); };
  $('#userBtn').onclick = (e) => { e.stopPropagation(); $('#userDrop').classList.toggle('open'); };
  document.addEventListener('click', () => { const d = $('#userDrop'); if (d) d.classList.remove('open'); });
  $('#menuBtn').onclick = () => $('#nav').classList.toggle('open');
  $$('#nav a').forEach((a) => a.addEventListener('click', () => $('#nav').classList.remove('open')));
}
function route() {
  let v = (location.hash || '').slice(1);
  if (v === 'overview') v = 'dashboard';
  if (!VIEWS[v] || !navAllowed(v)) v = 'dashboard';
  S.view = v; render();
}
window.addEventListener('hashchange', () => { if (S.me && S.all) route(); });
const PERIOD_VIEWS = ['dashboard', 'workload', 'roster', 'data'];
const WS_VIEWS = ['workload', 'roster', 'employees', 'timestudy', 'settings', 'data'];
// Printing: lay the page out at a fixed width, then zoom it so it fits one A4 landscape page
function fitPrint() {
  const page = $('#view'); if (!page) return;
  document.body.classList.add('printing');
  if (!$('.print-head', page)) return;
  page.classList.add('fit'); page.style.setProperty('--print-zoom', 1);
  const availW = 1062, availH = 733; // A4 landscape at 96 dpi minus 8 mm margins
  if ($('.print-head', page).dataset.fit === 'width') { // long tables: fit the width, let it run onto more pages
    page.classList.add('fitw'); const t = $('table.roster', page); const W = Math.max(1000, (t ? t.scrollWidth : 1400) + 4);
    page.style.setProperty('--print-w', W + 'px'); page.style.setProperty('--print-zoom', Math.min(1, (availW / W) * 0.98).toFixed(3)); return;
  }
  const W = 1400;
  const z = Math.min(availW / W, availH / page.scrollHeight) * 0.97;
  page.style.setProperty('--print-zoom', z.toFixed(3));
}
function unfitPrint() { document.body.classList.remove('printing'); const page = $('#view'); if (page) { page.classList.remove('fit', 'fitw'); page.style.removeProperty('--print-w'); page.style.removeProperty('--print-zoom'); } }
window.addEventListener('beforeprint', fitPrint);
window.addEventListener('afterprint', unfitPrint);
function render() {
  if (!S.me || !S.all) return;
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === S.view));
  const el = $('#view');
  if (!S.all.workshops.length) { el.innerHTML = '<div class="note warn">No workshop is linked to this account yet. Ask the administrator.</div>'; return; }
  try { VIEWS[S.view](el); bindFilters(el); } catch (e) { fail(e); el.innerHTML = `<div class="note warn">Something went wrong: ${esc(e.message)}</div>`; }
}
function filtersHTML({ ws = WS_VIEWS.includes(S.view), period = PERIOD_VIEWS.includes(S.view), alt = true } = {}) {
  const d = ws ? wsData() : null;
  return `<div class="filters">
    ${ws && multiWs() && S.all.workshops.length > 1 ? `<select class="wsselect" id="wsSel" aria-label="Workshop">${S.all.workshops.map((w) => `<option value="${w.id}" ${w.id === S.ws ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>` : ''}
    ${period ? `${alt && d && d.hasAlt && S.view !== 'data' ? `<div class="seg" role="group" aria-label="Roster option"><button data-alt="0" class="${!S.alt ? 'on' : ''}">Current roster</button><button data-alt="1" class="${S.alt ? 'on' : ''}">12 hr option</button></div>` : ''}
      <div class="seg" role="group" aria-label="Period"><button data-type="week" class="${S.type === 'week' ? 'on' : ''}">Week</button><button data-type="month" class="${S.type === 'month' ? 'on' : ''}">Month</button></div>
      <div class="period"><button data-p="-1" aria-label="Previous period">‹</button><span class="label">${periodLabel()}</span><button data-p="1" aria-label="Next period">›</button></div>
      <button class="btn sm" data-p="0">Today</button><input type="date" id="jump" value="${pStart()}" aria-label="Go to date">` : ''}
    <button class="icon-btn" id="reload" title="Reload data" aria-label="Reload data">↻</button></div>`;
}
function bindFilters(el) {
  const sel = $('#wsSel', el); if (sel) sel.onchange = () => { S.ws = sel.value; store('mp_ws', S.ws); S.alt = false; S.section = ''; S.studyExam = null; render(); };
  $$('[data-alt]', el).forEach((b) => (b.onclick = () => { S.alt = b.dataset.alt === '1'; render(); }));
  $$('[data-type]', el).forEach((b) => (b.onclick = () => { S.type = b.dataset.type; render(); }));
  $$('[data-p]', el).forEach((b) => (b.onclick = () => { const n = +b.dataset.p; S.start = n === 0 ? today() : Calc.shiftPeriod(S.type, S.start, n); render(); }));
  const j = $('#jump', el); if (j) j.onchange = () => { if (j.value) { S.start = j.value; render(); } };
  const r = $('#reload', el); if (r) r.onclick = () => refresh().then(() => toast('Data reloaded')).catch(fail);
}
function head(title, sub, right = '') {
  const ws = WS_VIEWS.includes(S.view) ? wsData().workshop.name : '';
  return `<div class="pagebar"><div><div class="crumb">${esc(ws || 'DMM Workshops')}</div><h1>${title}</h1>${sub ? `<div class="hint intro">${sub}</div>` : ''}</div><div class="grow"></div>${filtersHTML()}${right ? `<div class="filters">${right}</div>` : ''}</div>`;
}

function changeMyPassword() {
  modal({ title: 'Change password', body: `
    <label class="f">New password (at least 8 characters)<input type="password" id="np1" autocomplete="new-password"></label>
    <label class="f">Repeat new password<input type="password" id="np2" autocomplete="new-password"></label>`,
    buttons: [{ label: 'Cancel' }, { label: 'Change password', cls: 'primary', action: async (ov) => {
      const a = $('#np1', ov).value, b = $('#np2', ov).value;
      if (a.length < 8) { toast('Use at least 8 characters', 'err'); return false; }
      if (a !== b) { toast('The two passwords are different', 'err'); return false; }
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) throw error;
      toast('Password changed', 'ok');
    } }] });
}

// =====================================================================
// DASHBOARD: figures row, one trend chart, the workshop ledger
// =====================================================================
function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const clamp01 = (v) => Math.max(0, Math.min(1, v || 0));
function svgBullet(planned, done, max, w = 96) {
  const sx = (v) => (max > 0 ? clamp01(v / max) * w : 0);
  return `<svg width="${w}" height="14" viewBox="0 0 ${w} 14" aria-hidden="true"><rect class="bar-track" x="0" y="1" width="${w}" height="12" rx="2"/><rect class="bar-planned" x="0" y="1" width="${sx(planned)}" height="12" rx="2"/>${done == null ? '' : `<rect class="bar-actual" x="0" y="4" width="${sx(done)}" height="6" rx="1"/>`}</svg>`;
}
function svgMeter(v, max, w = 64) {
  const x = max > 0 ? clamp01(v / max) * w : 0;
  return `<svg width="${w}" height="14" viewBox="0 0 ${w} 14" aria-hidden="true"><rect class="bar-track" x="0" y="3" width="${w}" height="8" rx="2"/><rect class="bar-one" x="0" y="3" width="${x}" height="8" rx="2"/></svg>`;
}
function svgDiverge(v, maxAbs, w = 96) {
  const half = w / 2, len = maxAbs > 0 ? clamp01(Math.abs(v) / maxAbs) * half : 0;
  return `<svg width="${w}" height="14" viewBox="0 0 ${w} 14" aria-hidden="true"><rect class="bar-track" x="0" y="3" width="${w}" height="8" rx="2"/><rect class="${v < 0 ? 'bar-bad' : 'bar-good'}" x="${v < 0 ? half - len : half}" y="3" width="${len}" height="8" rx="1"/><line class="axis-zero" x1="${half}" x2="${half}" y1="0" y2="14"/></svg>`;
}
// grouped columns: planned (light) and done (accent) per period
function trendSVG(labels, planned, done, { w = 640, h = 220, title = '' } = {}) {
  const L = 40, R = 8, T = 18, B = 26, iw = w - L - R, ih = h - T - B;
  const max = niceMax(Math.max(1, ...planned, ...done.filter((v) => v != null)));
  const y = (v) => T + ih - (v / max) * ih;
  const slot = iw / labels.length, bw = Math.min(24, slot * 0.32), gap = 2;
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = (max * i) / 4, yy = y(v); g += `<line class="${i ? 'grid-line' : 'axis-zero'}" x1="${L}" x2="${w - R}" y1="${yy}" y2="${yy}"/><text class="chart-text" x="${L - 6}" y="${yy + 4}" text-anchor="end">${fmt0(v)}</text>`; }
  labels.forEach((lb, i) => {
    const cx = L + slot * i + slot / 2, px = cx - bw - gap / 2, ax = cx + gap / 2, p = planned[i] || 0, a = done[i];
    g += `<g><title>${esc(lb)}: planned ${fmt0(p)}${a == null ? ', not reported' : `, done ${fmt0(a)}`}</title>`;
    g += `<rect class="bar-planned" x="${px}" y="${y(p)}" width="${bw}" height="${T + ih - y(p)}" rx="2"/>`;
    if (a != null) g += `<rect class="bar-actual" x="${ax}" y="${y(a)}" width="${bw}" height="${T + ih - y(a)}" rx="2"/><text class="chart-value" x="${ax + bw / 2}" y="${y(a) - 4}" text-anchor="middle">${fmt0(a)}</text>`;
    g += `<rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${ih}" fill="transparent"/></g>`;
    g += `<text class="chart-text" x="${cx}" y="${h - 8}" text-anchor="middle">${esc(lb)}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">${g}</svg>`;
}
const LEGEND = `<div class="legend"><span><i class="sw-planned"></i>Planned</span><span><i class="sw-actual"></i>Done</span><span><i class="sw-good"></i>Man-hours spare</span><span><i class="sw-bad"></i>Man-hours short</span></div>`;
function plabel(type, st) { return type === 'week' ? dlabel(st).replace(/ \d{4}$/, '') : MONTHS[+st.slice(5, 7) - 1] + ' ' + st.slice(2, 4); }
function sumTot(list) {
  const k = ['exams', 'required', 'available', 'balance', 'actual', 'reported', 'plannedReported', 'deferred', 'alTechs', 'alDays', 'cmExams', 'cmHours', 'extraPeople', 'otNeeded', 'headcount', 'manpower'];
  const T = {}; k.forEach((x) => (T[x] = list.reduce((a, t) => a + (t[x] || 0), 0)));
  T.cmShare = T.available ? T.cmHours / T.available : 0; return T;
}
function ledgerMax(rows) {
  return { exams: Math.max(1, ...rows.map((t) => t.exams)), al: Math.max(1, ...rows.map((t) => t.alTechs)), bal: Math.max(1, ...rows.map((t) => Math.abs(t.balance))) };
}
function ledgerRow(nameHTML, t, mx, cls = '') {
  const rep = t.reported;
  return `<tr class="${cls}"><td class="lname">${nameHTML}</td>
    <td>${t.exams ? `<div class="vizcell">${svgBullet(t.exams, rep ? t.actual : null, mx.exams)}<span class="v">${rep ? fmt0(t.actual) : '–'} of ${fmt0(t.exams)}</span></div>` : '<span class="hint">No exams planned</span>'}</td>
    <td class="num">${rep ? fmt0(t.deferred) : '–'}</td>
    <td><div class="vizcell">${svgMeter(t.alTechs, mx.al)}<span class="v">${fmt0(t.alTechs)}</span></div><span class="sub-line">${fmt0(t.alDays)} leave days</span></td>
    <td><div class="vizcell">${svgMeter(t.cmShare, 1)}<span class="v">${pct(t.cmShare)}</span></div><span class="sub-line">${fmt0(t.cmHours)} h in ${fmt0(t.cmExams)} exams</span></td>
    <td><div class="vizcell">${svgDiverge(t.balance, mx.bal)}<span class="v ${t.balance < 0 ? 'neg' : 'pos'}">${signed(t.balance, fmt0)}</span></div></td>
    <td class="num">${t.extraPeople > 0 ? `<span class="tag bad">${fmt(t.extraPeople)} short</span>` : '<span class="tag good">Covered</span>'}</td>
    <td class="num">${t.otNeeded ? fmt0(t.otNeeded) : '–'}</td></tr>`;
}
function ledgerTable(first, rows, total) {
  const mx = ledgerMax(rows.map((r) => r.t));
  return `<div class="tbl-wrap"><table class="ledger"><thead><tr><th>${first}</th><th>Exams done of planned</th><th class="num">Deferred</th><th>On annual leave</th><th>CM share of M/Hrs</th><th>M/Hrs balance</th><th class="num">M/Pwr</th><th class="num">OT h to close</th></tr></thead><tbody>
    ${rows.map((r) => ledgerRow(r.name, r.t, mx, r.cls)).join('')}
    ${total ? ledgerRow('Total', total, ledgerMax([total]), 'total') : ''}</tbody></table></div>`;
}
function figuresHTML(T) {
  const done = T.reported ? `${fmt0(T.actual)}<span class="unit">of ${fmt0(T.plannedReported)}</span>` : '–';
  return `<dl class="figures">
    <div class="figure"><dt>Exams done</dt><dd>${done}</dd><div class="q">${T.reported && T.plannedReported ? `${pct(T.actual / T.plannedReported)} of reported plan, ${fmt0(T.exams)} planned in all` : `${fmt0(T.exams)} planned, not reported yet`}</div></div>
    <div class="figure"><dt>Deferred exams</dt><dd>${T.reported ? fmt0(T.deferred) : '–'}</dd><div class="q">Planned but not done</div></div>
    <div class="figure"><dt>Technicians on annual leave</dt><dd>${fmt0(T.alTechs)}</dd><div class="q">${fmt0(T.alDays)} leave days in the period</div></div>
    <div class="figure"><dt>Corrective (CM) load</dt><dd>${pct(T.cmShare)}<span class="unit">of M/Hrs</span></dd><div class="q">${fmt0(T.cmHours)} of ${fmt0(T.available)} available hours</div></div>
    <div class="figure"><dt>M/Hrs ${T.balance < 0 ? 'deficit' : 'balance'}</dt><dd class="${T.balance < 0 ? 'neg' : 'pos'}">${signed(T.balance, fmt0)}<span class="unit">h</span></dd><div class="q">${fmt0(T.available)} available, ${fmt0(T.required)} required</div></div>
    <div class="figure"><dt>M/Pwr deficit</dt><dd class="${T.extraPeople > 0 ? 'neg' : ''}">${fmt(T.extraPeople)}<span class="unit">people</span></dd><div class="q">${T.extraPeople > 0 ? `or ${fmt0(T.otNeeded)} overtime hours` : 'The roster covers the work'}</div></div>
  </dl>`;
}

function viewDashboard(el) {
  if (!S.dash) S.dash = multiWs() ? 'ALL' : S.me.workshop_id;
  if (!multiWs()) S.dash = S.me.workshop_id;
  const all = S.dash === 'ALL';
  const wsList = S.all.workshops;
  const tabs = multiWs() && wsList.length > 1 ? `<div class="tabs" role="tablist">${[['ALL', 'All workshops'], ...wsList.map((w) => [w.id, w.short_name])].map(([id, n]) => `<button role="tab" data-dash="${id}" class="${S.dash === id ? 'on' : ''}" aria-selected="${S.dash === id}">${esc(n)}</button>`).join('')}</div>` : '';
  const title = all ? 'Workshops overview' : (wsList.find((w) => w.id === S.dash) || {}).name || 'Dashboard';
  const head2 = `<div class="pagebar"><div><div class="crumb">Dashboard</div><h1>${esc(title)}</h1></div><div class="grow"></div>${filtersHTML({ ws: false, period: true, alt: false })}<button class="btn primary" id="pdfBtn" type="button">Export PDF</button></div>`;
  const now = new Date();
  const printHead = `<div class="print-head">${SAR_LOGO}<div><h1>${esc(title)}</h1><p>Dashboard report, ${esc(periodLabel())}. Generated ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.</p></div></div>`;
  const scope = all ? wsList : wsList.filter((w) => w.id === S.dash);
  const results = scope.map((w) => ({ w, r: result(wsData(w.id), S.type, pStart(), false) }));
  const T = sumTot(results.map((x) => x.r.tot));
  const nPer = 6, unit = S.type === 'week' ? 'weeks' : 'months';
  const periods = Array.from({ length: nPer }, (_, i) => Calc.shiftPeriod(S.type, pStart(), i - (nPer - 1)));
  const trendOf = (w) => periods.map((st) => result(wsData(w.id), S.type, st, false).tot);
  const series = (tots) => ({ p: tots.map((t) => t.exams), a: tots.map((t) => (t.reported ? t.actual : null)) });
  const empty = !T.exams && !T.available;

  let chart = '', ledger = '', extra = '';
  if (all) {
    chart = `<section class="panel"><div class="phead"><div class="ttl"><h2>Planned and done exams, last ${nPer} ${unit}</h2><p>One chart per workshop, same scale inside each chart</p></div></div>
      <div class="legend"><span><i class="sw-planned"></i>Planned</span><span><i class="sw-actual"></i>Done</span></div>
      <div class="multiples">${scope.map((w) => { const s = series(trendOf(w)); return `<figure class="chart"><figcaption>${esc(w.short_name)}</figcaption>${trendSVG(periods.map((st) => plabel(S.type, st)), s.p, s.a, { w: 340, h: 190, title: `Planned and done exams, ${w.name}` })}</figure>`; }).join('')}</div></section>`;
    ledger = `<section class="panel"><div class="phead"><div class="ttl"><h2>Workshop ledger, ${periodLabel()}</h2><p>Open a workshop to see its sections and what it takes to close the work</p></div></div>${LEGEND}
      ${ledgerTable('Workshop', results.map(({ w, r }) => ({ name: `<button class="linkbtn" data-dash="${w.id}">${esc(w.name)}</button>`, t: r.tot })), results.length > 1 ? T : null)}</section>`;
  } else {
    const w = scope[0], d = wsData(w.id), R = results[0].r, tots = trendOf(w), s = series(tots);
    chart = `<section class="panel print-skip"><div class="phead"><div class="ttl"><h2>Planned and done exams, last ${nPer} ${unit}</h2><p>Hover a period for its figures</p></div></div>
      <div class="legend"><span><i class="sw-planned"></i>Planned</span><span><i class="sw-actual"></i>Done</span></div>
      <figure class="chart m0">${trendSVG(periods.map((st) => plabel(S.type, st)), s.p, s.a, { w: 1240, h: 260, title: `Planned and done exams, ${w.name}` })}</figure></section>`;
    ledger = `<section class="panel"><div class="phead"><div class="ttl"><h2>Ledger by ${S.type}</h2><p>The selected ${S.type} is the last row</p></div></div>${LEGEND}
      ${ledgerTable(S.type === 'week' ? 'Week' : 'Month', periods.map((st, i) => ({ name: esc(plabel(S.type, st)), t: tots[i], cls: i === nPer - 1 ? 'cur' : '' })), null)}</section>`;
    extra = `<section class="panel"><div class="phead"><div class="ttl"><h2>What it takes to close ${periodLabel()}</h2><p>People or overtime needed per section to finish the planned exams</p></div>${canEdit() ? '<a class="btn sm" href="#workload">Enter planned and done exams</a>' : ''}</div>${closeTable(R, d)}</section>`;
  }
  const emptyNote = empty ? `<div class="note warn mb-sm">No planned exams and no roster hours for ${periodLabel()}. ${canEdit() ? 'Enter the planned exams in Workload, or move to another period.' : 'Move to another period with the arrows.'}</div>` : '';
  el.innerHTML = printHead + head2 + tabs + emptyNote + figuresHTML(T) + chart + ledger + extra;
  $('#pdfBtn', el).onclick = () => {
    const t = document.title;
    document.title = `DMM dashboard ${all ? 'all workshops' : (scope[0] || {}).short_name || ''} ${periodLabel()}`.trim();
    const back = () => { document.title = t; window.removeEventListener('afterprint', back); };
    window.addEventListener('afterprint', back);
    window.print();
  };
  $$('[data-dash]', el).forEach((b) => (b.onclick = () => { S.dash = b.dataset.dash; if (S.dash !== 'ALL') { S.ws = S.dash; store('mp_ws', S.ws); } render(); }));
}

function closeTable(R, d) {
  const secs = R.sections.filter((s) => s.required || s.available || s.rows.some((r) => r.pct > 0));
  return `<div class="tbl-wrap"><table><thead><tr><th>Section</th><th class="num">Planned exams</th><th class="num">Required h</th><th class="num">Available h</th><th class="num">Balance h</th><th class="num">People needed</th><th class="num">People available</th><th class="num">Extra people</th><th class="num">or OT hours</th></tr></thead><tbody>
    ${secs.map((s) => `<tr><td>${esc(s.section.name)}${s.sick ? `<span class="sub-line">less ${pct(s.sick)} sick allowance</span>` : ''}</td><td class="num">${fmt0(s.exams)}</td><td class="num">${fmt(s.required)}</td><td class="num">${fmt(s.available)}</td>
      <td class="num ${s.balance < 0 ? 'neg' : 'pos'}">${signed(s.balance)}</td><td class="num">${fmt(s.peopleNeeded)}</td><td class="num">${fmt(s.peopleHave)}</td>
      <td class="num">${s.manpower < 0 ? `<span class="tag bad">${fmt(-s.manpower)}</span>` : '<span class="tag good">0</span>'}</td><td class="num">${s.otNeeded ? fmt0(s.otNeeded) : '–'}</td></tr>`).join('')}
    ${secs.length > 1 ? `<tr class="total"><td>Workshop</td><td class="num">${fmt0(R.tot.exams)}</td><td class="num">${fmt(R.tot.required)}</td><td class="num">${fmt(R.tot.available)}</td><td class="num ${R.tot.balance < 0 ? 'neg' : 'pos'}">${signed(R.tot.balance)}</td><td class="num">${fmt(R.tot.peopleNeeded)}</td><td class="num">${fmt(R.tot.peopleHave)}</td><td class="num">${fmt(R.tot.extraPeople)}</td><td class="num">${R.tot.otNeeded ? fmt0(R.tot.otNeeded) : '–'}</td></tr>` : ''}
  </tbody></table></div>
  <p class="hint m0 mt-sm">People needed = required hours ÷ productive hours of one full-time person in the period (${esc((secs[0] && secs[0].div.text) || '')}). Extra people = people needed − people available; the same gap can be covered with the overtime hours shown.</p>`;
}

// =====================================================================
// WORKLOAD
// =====================================================================
function viewWorkload(el) {
  const d = wsData(), st = pStart(), planned = countsFor(d, S.type, st), actual = countsFor(d, S.type, st, 'actual'), days = Calc.periodDays(S.type, st);
  const ed = canEdit(), R = result(d), dis = ed ? '' : 'disabled';
  const secs = d.sections.map((s) => ({ s, ex: d.exam_types.filter((x) => x.active && x.section_id === s.id) })).filter((g) => g.ex.length);
  const orphan = d.exam_types.filter((x) => x.active && !x.section_id);
  if (orphan.length) secs.push({ s: { id: null, name: 'No section' }, ex: orphan });
  el.innerHTML = head('Workload', `Planned and actual exams for ${periodLabel()}. Man-hours = planned × standard hours. Leave Actual empty until the exams are counted.`) + `
  <div class="panel"><div class="tbl-wrap"><table id="wl"><thead><tr><th>Exam</th><th class="num">Std man-h</th><th class="num">Planned</th><th class="num">Actual (done)</th><th class="num">Deferred</th><th class="num">Planned man-h</th></tr></thead><tbody>
  ${secs.map((g) => `<tr class="group"><td colspan="6">${esc(g.s.name)}</td></tr>` + g.ex.map((x) => {
    const c = Calc.examCount(x, S.type, days, planned);
    return `<tr data-id="${x.id}" data-h="${x.hours}" data-auto="${c.auto ? c.n : ''}"><td>${esc(x.asset)} <b>${esc(x.exam)}</b>${x.category === 'Corrective' ? ' <span class="tag warn">CM</span>' : x.category === 'Job' ? ' <span class="tag muted">Job</span>' : ''}${x.default_weekly ? `<span class="sub-line">Default ${fmt(x.default_weekly)} a week when Planned is empty</span>` : ''}</td>
      <td class="num">${fmt2(x.hours)}</td>
      <td class="num"><input type="number" class="w_p" min="0" step="1" value="${planned[x.id] ?? ''}" placeholder="${c.auto ? c.n : ''}" aria-label="Planned ${esc(x.asset + ' ' + x.exam)}" ${dis}></td>
      <td class="num"><input type="number" class="w_a" min="0" step="1" value="${actual[x.id] ?? ''}" aria-label="Actual ${esc(x.asset + ' ' + x.exam)}" ${dis}></td>
      <td class="num w_d"></td><td class="num mh"></td></tr>`;
  }).join('')).join('')}
  <tr class="total"><td colspan="2">Total</td><td class="num" id="wl_p"></td><td class="num" id="wl_a"></td><td class="num" id="wl_d"></td><td class="num" id="wl_h"></td></tr></tbody></table></div>
  <div class="row mt-sm">${ed ? `<button class="btn primary" id="wl_save">Save</button><button class="btn" id="wl_copy">Copy planned from previous ${S.type}</button><button class="btn ghost" id="wl_clear">Clear</button>` : '<span class="hint">View only.</span>'}
  <span class="hint">Weekly and monthly figures are kept apart. Standard hours are changed in Time Study or Settings.</span></div></div>
  <div class="panel"><div class="phead"><div class="ttl"><h2>What it takes to close this workload</h2><p>From the saved figures</p></div></div>${closeTable(R, d)}</div>`;
  const tbody = $('#wl tbody', el);
  const calc = () => {
    let n = 0, a = 0, df = 0, h = 0, anyA = false;
    $$('tr[data-id]', tbody).forEach((tr) => {
      const pi = $('.w_p', tr), ai = $('.w_a', tr);
      const p = pi.value === '' ? (+tr.dataset.auto || 0) : +pi.value || 0, mh = p * +tr.dataset.h;
      n += p; h += mh; $('.mh', tr).textContent = p ? fmt(mh) : '';
      if (ai.value !== '') { anyA = true; const av = +ai.value || 0; a += av; const dd = Math.max(0, p - av); df += dd; $('.w_d', tr).innerHTML = dd ? `<span class="tag warn">${fmt0(dd)}</span>` : '0'; } else $('.w_d', tr).textContent = '';
    });
    $('#wl_p', el).textContent = fmt0(n); $('#wl_a', el).textContent = anyA ? fmt0(a) : '–'; $('#wl_d', el).textContent = anyA ? fmt0(df) : '–'; $('#wl_h', el).textContent = fmt(h);
  };
  $$('input', tbody).forEach((i) => (i.oninput = calc)); calc();
  if (!ed) return;
  $('#wl_save', el).onclick = async () => {
    try {
      const rows = $$('tr[data-id]', tbody).map((tr) => ({ id: +tr.dataset.id, p: $('.w_p', tr).value, a: $('.w_a', tr).value }));
      const keep = rows.filter((r) => r.p !== '' || r.a !== '').map((r) => ({ workshop_id: S.ws, period_type: S.type, period_start: st, exam_type_id: r.id, count: r.p === '' ? null : +r.p, actual: r.a === '' ? null : +r.a }));
      const drop = rows.filter((r) => r.p === '' && r.a === '').map((r) => r.id);
      if (keep.length) await q(sb.from('workload_counts').upsert(keep));
      if (drop.length) await q(sb.from('workload_counts').delete().eq('period_type', S.type).eq('period_start', st).in('exam_type_id', drop));
      await refresh(); toast('Workload saved', 'ok');
    } catch (e) { fail(e); }
  };
  $('#wl_copy', el).onclick = () => { const prev = countsFor(d, S.type, Calc.shiftPeriod(S.type, st, -1)); $$('tr[data-id]', tbody).forEach((tr) => { $('.w_p', tr).value = prev[tr.dataset.id] ?? ''; }); calc(); toast('Copied. Press Save to keep it.'); };
  $('#wl_clear', el).onclick = () => { $$('input', tbody).forEach((i) => (i.value = '')); calc(); };
}

// =====================================================================
// ROSTER & LEAVE
// =====================================================================
function codeClass(d, code) {
  if (!code) return 'c-none';
  if (code === 'R') return 'c-rest';
  const c = d.codeMap[code], t = c && c.status_type;
  if (t === 'Annual Leave' || t === 'Planned Leave') return 'c-leave';
  if (t === 'Sick') return 'c-sick';
  if (t === 'Training') return 'c-train';
  if (t === 'Overtime') return 'c-ot';
  if (t === 'Absent') return 'c-abs';
  if (c && Number(c.prod_hrs) > 0) return 'c-work';
  return 'c-rest';
}
function shortCode(code) {
  if (!code) return '';
  if (code === 'R') return '·';
  const m = code.match(/^([A-Z/]+)\s*-?\s*(\d+)?/i);
  if (!m) return code;
  let a = m[1].replace('/', '');
  if (a === 'AL') return 'AL';
  if (m[2] === '12' && a.length === 1) return a + '12';
  return a;
}
function viewRoster(el) {
  const d = wsData(), R = result(d), ed = canEdit();
  const secs = R.sections.filter((s) => s.rows.length);
  const show = S.section ? secs.filter((s) => String(s.id) === S.section) : secs;
  const head1 = R.days.map((x) => { const w = Calc.dow(x); return `<th class="${w === 5 || w === 6 ? 'wk' : ''}">${DOWS[w]}<br>${+x.slice(8)}</th>`; }).join('');
  const body = show.map((s) => `<tr class="group"><td class="left" colspan="2">${esc(s.section.name)}</td><td class="secinfo" colspan="${R.days.length + 3}">${fmt0(s.prod)} productive h, ${s.headcount} people</td></tr>` + s.rows.map((r) => `<tr>
      <td class="left">${ed ? `<button class="linkbtn" data-plan="${r.emp.uid}" title="Plan this person's month">${esc(r.emp.name)}</button>` : `<b>${esc(r.emp.name)}</b>`}${d.planMap[r.emp.uid] && d.planMap[r.emp.uid][R.days[0].slice(0, 7)] ? ' <span class="pill info">Planned month</span>' : ''}<span class="sub-line">${esc(r.emp.emp_no)}, ${esc(r.emp.role)}${d.teamMap[r.emp.team_id] ? ', ' + esc(d.teamMap[r.emp.team_id].name) : ''}${r.emp.status !== 'Active' ? ` <span class="pill muted">${esc(r.emp.status)}</span>` : ''}</span></td>
      <td>${pct(r.pct)}</td>
      ${r.cells.map((c) => `<td class="cell ${codeClass(d, c.code)} ${c.source === 'change' ? 'c-change' : ''}" data-e="${r.emp.uid}" data-d="${c.day}" title="${esc(dlabel(c.day) + ': ' + (c.code || 'not on roster'))}">${esc(shortCode(c.code))}</td>`).join('')}
      <td class="num">${fmt0(r.staffDays)}</td><td class="num">${fmt(r.prod)}</td><td class="num">${fmt(r.ot)}</td></tr>`).join('')).join('');
  const inPeriod = d.status_changes.filter((c) => c.date_to >= R.days[0] && c.date_from <= R.days[R.days.length - 1]).sort((a, b) => a.date_from.localeCompare(b.date_from));
  const empMap = {}; d.employees.forEach((e) => (empMap[e.uid] = e));
  const wsN = (S.all.workshops.find((w) => w.id === S.ws) || {}).name || '';
  const pnow = new Date();
  const rHead = `<div class="print-head" data-fit="width">${SAR_LOGO}<div><h1>${esc(wsN)}, roster ${esc(periodLabel())}</h1><p>${S.section ? esc((secs.find((x) => String(x.id) === S.section) || { section: {} }).section.name) + '. ' : ''}M Morning, A Afternoon, N Night, 12 = 12-hour shift. Generated ${pnow.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.</p></div></div>`;
  el.innerHTML = rHead + head('Roster and leave', 'Shifts come from each team or person pattern, or from a month plan. Leave, sickness, training, overtime and absence are recorded from one date to another.', ed ? '<button class="btn" id="rpBtn">Export PDF</button><button class="btn" id="rxBtn">Export month to Excel</button><button class="btn" id="planMonth">Plan the month</button><button class="btn primary" id="addStatus">Add leave or status</button>' : '<button class="btn" id="rpBtn">Export PDF</button><button class="btn" id="rxBtn">Export month to Excel</button>') + `
  <div class="toolbar"><select id="secSel" aria-label="Section"><option value="">All sections</option>${secs.map((s) => `<option value="${s.id}" ${String(s.id) === S.section ? 'selected' : ''}>${esc(s.section.name)}</option>`).join('')}</select>
    <span class="hint">${ed ? 'Click a day to record leave or a status. Click a name to plan that person\'s month.' : 'View only.'}</span></div>
  <div class="legend"><span><i class="c-work"></i>Working</span><span><i class="c-rest"></i>Rest day</span><span><i class="c-leave"></i>Annual or planned leave</span><span><i class="c-train"></i>Training</span><span><i class="c-sick"></i>Sick</span><span><i class="c-ot"></i>Overtime</span><span><i class="c-abs"></i>Absent</span><span><i class="c-work c-change"></i>Changed from pattern</span><span class="hint">M Morning, A Afternoon, N Night, 12 = 12-hour shift</span></div>
  <div class="tbl-wrap roster-wrap"><table class="roster ${ed ? 'edit' : ''}"><thead><tr><th class="left">Employee</th><th>Count</th>${head1}<th>Days</th><th>Prod h</th><th>OT h</th></tr></thead>
  <tbody>${body}</tbody></table></div>
  <div class="panel mt-lg"><div class="phead"><h2>Leave and status in this period</h2><span class="hint">${inPeriod.length} records</span></div>
  ${inPeriod.length ? `<div class="tbl-wrap"><table><thead><tr><th>Employee</th><th>Status</th><th>From</th><th>To</th><th class="num">Days</th><th>Notes</th><th></th></tr></thead><tbody>
  ${inPeriod.map((c) => { const e = empMap[c.employee_uid] || {}; return `<tr><td>${esc(e.name)}<span class="sub-line">${esc(e.emp_no)}</span></td><td><span class="pill info">${esc(c.status_type === 'Custom' ? 'Shift ' + c.code : c.status_type)}</span></td><td>${dlabel(c.date_from)}</td><td>${dlabel(c.date_to)}</td><td class="num">${Calc.diffDays(c.date_from, c.date_to) + 1}</td><td>${esc(c.notes || '')}</td>
    <td class="actions">${ed ? `<button class="btn sm" data-edit="${c.id}">Edit</button> <button class="btn sm danger" data-del="${c.id}">Delete</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="hint">Nothing recorded for this period.</p>'}</div>`;
  $('#secSel', el).onchange = (e) => { S.section = e.target.value; viewRoster(el); };
  $('#rxBtn', el).onclick = exportRosterXlsx;
  $('#rpBtn', el).onclick = () => {
    const t = document.title; document.title = `Roster ${wsN} ${periodLabel()}`;
    const back = () => { document.title = t; window.removeEventListener('afterprint', back); };
    window.addEventListener('afterprint', back); window.print();
  };
  if (!ed) return;
  $('#addStatus', el).onclick = () => statusModal({});
  $('#planMonth', el).onclick = () => planMonthModal();
  $$('[data-plan]', el).forEach((b) => (b.onclick = () => planMonthModal(+b.dataset.plan)));
  $$('td.cell', el).forEach((td) => (td.onclick = () => {
    const uid = +td.dataset.e, day = td.dataset.d;
    const covering = d.status_changes.filter((c) => c.employee_uid === uid && c.date_from <= day && c.date_to >= day);
    statusModal({ employee_uid: uid, date_from: day, date_to: day }, covering);
  }));
  $$('[data-edit]', el).forEach((b) => (b.onclick = () => statusModal(d.status_changes.find((c) => c.id === +b.dataset.edit))));
  $$('[data-del]', el).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Delete record', 'The roster goes back to the normal pattern for those days.'))) return;
    try { await q(sb.from('status_changes').delete().eq('id', +b.dataset.del)); await refresh(); toast('Deleted', 'ok'); } catch (e) { fail(e); }
  }));
}
function statusModal(ch, covering = []) {
  const d = wsData(), editing = !!ch.id, emps = d.employees;
  const body = `
    ${covering.length ? `<div class="explain"><b>Already recorded on this day</b>${covering.map((c) => `<div class="row between mt-2xs"><span>${esc(c.status_type === 'Custom' ? 'Shift ' + c.code : c.status_type)}, ${dlabel(c.date_from)} to ${dlabel(c.date_to)}</span><button class="btn sm danger" data-rm="${c.id}">Remove</button></div>`).join('')}</div>` : ''}
    ${editing ? `<label class="f">Employee<select id="st_emp">${emps.map((e) => `<option value="${e.uid}" ${e.uid === ch.employee_uid ? 'selected' : ''}>${esc(e.name)} (${esc(e.emp_no)})</option>`).join('')}</select></label>`
      : `<div><div class="hint mb-2xs">Employees (tick one or more)</div>
      <input class="w-full mb-sm" type="text" id="st_q" placeholder="Search name, number or team">
      <div class="checklist" id="st_list">${emps.filter((e) => e.status === 'Active' || e.uid === ch.employee_uid).map((e) => `<label data-s="${esc((e.name + ' ' + e.emp_no + ' ' + ((d.teamMap[e.team_id] || {}).name || '')).toLowerCase())}"><input type="checkbox" value="${e.uid}" ${e.uid === ch.employee_uid ? 'checked' : ''}> ${esc(e.name)} <span class="hint">${esc(e.emp_no)}${d.teamMap[e.team_id] ? ', ' + esc(d.teamMap[e.team_id].name) : ''}</span></label>`).join('')}</div></div>`}
    <div class="grid2">
      <label class="f">Status<select id="st_type">${STATUS_TYPES.map((t) => `<option value="${t}" ${t === (ch.status_type || 'Annual Leave') ? 'selected' : ''}>${t === 'Custom' ? 'Different shift (pick code)' : t}</option>`).join('')}</select></label>
      <label class="f" id="st_code_w">Shift code<select id="st_code">${d.shift_codes.map((c) => `<option ${c.code === ch.code ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select></label>
      <label class="f">From<input type="date" id="st_from" value="${ch.date_from || today()}"></label>
      <label class="f">To<input type="date" id="st_to" value="${ch.date_to || ch.date_from || today()}"></label>
    </div>
    <label class="f">Notes<input type="text" id="st_notes" value="${esc(ch.notes || '')}"></label>
    <p class="hint m0">Leave, sick, training and absence replace working days only. Overtime and a different shift apply on every day in the range, so use them for rest-day overtime.</p>`;
  modal({ title: editing ? 'Edit leave or status' : 'Add leave or status', body, buttons: [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', action: async (ov) => {
    const type = $('#st_type', ov).value, from = $('#st_from', ov).value, to = $('#st_to', ov).value;
    if (!from || !to) { toast('Choose the From and To dates', 'err'); return false; }
    if (to < from) { toast('To must be on or after From', 'err'); return false; }
    const base = { workshop_id: S.ws, status_type: type, code: type === 'Custom' ? $('#st_code', ov).value : null, date_from: from, date_to: to, notes: $('#st_notes', ov).value || null, created_by: S.me.username };
    if (editing) await q(sb.from('status_changes').update({ ...base, employee_uid: +$('#st_emp', ov).value }).eq('id', ch.id));
    else {
      const ids = $$('#st_list input:checked', ov).map((i) => +i.value);
      if (!ids.length) { toast('Tick at least one employee', 'err'); return false; }
      await q(sb.from('status_changes').insert(ids.map((id) => ({ ...base, employee_uid: id }))));
    }
    await refresh(); toast('Saved', 'ok');
  } }], onOpen: (ov) => {
    const sync = () => $('#st_code_w', ov).classList.toggle('hidden', $('#st_type', ov).value !== 'Custom');
    $('#st_type', ov).onchange = sync; sync();
    const sq = $('#st_q', ov); if (sq) sq.oninput = () => $$('#st_list label', ov).forEach((l) => l.classList.toggle('hidden', !l.dataset.s.includes(sq.value.toLowerCase())));
    $$('[data-rm]', ov).forEach((b) => (b.onclick = async () => { try { await q(sb.from('status_changes').delete().eq('id', +b.dataset.rm)); await refresh(); toast('Removed', 'ok'); ov.remove(); } catch (e) { fail(e); } }));
  } });
}

// =====================================================================
// ROSTER EXPORT: a formatted Excel of the month, one row per person
// =====================================================================
const RX = {
  blue: '0B4F79', blue2: '1976A3', light: 'DCEFF8', ink: '333333', muted: '5A6B78', rule: 'C9D6DF', paper: 'F3F7FA',
  fills: { M: ['DCEFF8', '0B4F79'], A: ['B9DDF0', '0B4F79'], N: ['0B4F79', 'FFFFFF'], R: ['FFFFFF', '9AA9B4'], leave: ['E3F4EA', '146B3A'], train: ['FFF1D6', '8F5B0A'], sick: ['FBE3E3', 'A61B1B'], abs: ['D62828', 'FFFFFF'], ot: ['1F9D55', 'FFFFFF'], none: ['F3F7FA', 'C9D6DF'] },
};
function rxKind(d, code) {
  const c = d.codeMap[code]; if (!code) return 'none'; if (code === 'R') return 'R';
  const t = c && c.status_type;
  if (t === 'Annual Leave' || t === 'Planned Leave') return 'leave'; if (t === 'Training') return 'train'; if (t === 'Sick') return 'sick'; if (t === 'Absent') return 'abs'; if (t === 'Overtime') return 'ot';
  const l = letterOf(code); return RX.fills[l] ? l : 'M';
}
function exportRosterXlsx() {
  const X = window.XLSXS; if (!X) { toast('Excel library not loaded', 'err'); return; }
  const d = wsData(), ms = Calc.monthStart(pStart()), R = result(d, 'month', ms), days = R.days, nD = days.length;
  const wsName = (S.all.workshops.find((w) => w.id === S.ws) || {}).name || S.ws;
  const title = `${wsName}, roster ${MONTHS_L[+ms.slice(5, 7) - 1]} ${ms.slice(0, 4)}`;
  const fixed = ['No.', 'Employee', 'Role', 'Team', 'Count'], tail = ['Days', 'Prod h', 'OT h'];
  const nC = fixed.length + nD + tail.length;
  const border = { top: { style: 'thin', color: { rgb: RX.rule } }, bottom: { style: 'thin', color: { rgb: RX.rule } }, left: { style: 'thin', color: { rgb: RX.rule } }, right: { style: 'thin', color: { rgb: RX.rule } } };
  const font = (o = {}) => ({ name: 'Calibri', sz: 10, color: { rgb: RX.ink }, ...o });
  const cell = (v, s = {}, t) => ({ v: v === undefined || v === null ? '' : v, t: t || (typeof v === 'number' ? 'n' : 's'), s });
  const aoa = [], merges = [], rowsH = [];
  const wk = (x) => { const w = Calc.dow(x); return w === 5 || w === 6; };
  // title block
  aoa.push([cell(title, { font: font({ sz: 16, bold: true, color: { rgb: RX.blue } }) })]); merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: nC - 1 } }); rowsH.push({ hpt: 26 });
  aoa.push([cell(`Saudi Arabia Railways, Dammam workshops. Exported ${dlabel(today())} by ${S.me.display_name || S.me.username}. M Morning, A Afternoon, N Night, 12 = 12-hour shift.`, { font: font({ color: { rgb: RX.muted } }) })]); merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: nC - 1 } }); rowsH.push({ hpt: 16 });
  aoa.push([]); rowsH.push({ hpt: 6 });
  // two header rows: day number, weekday
  const hS = (extra = {}) => ({ font: font({ bold: true, color: { rgb: 'FFFFFF' } }), fill: { fgColor: { rgb: RX.blue } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border, ...extra });
  const hW = (x) => hS({ fill: { fgColor: { rgb: wk(x) ? RX.blue2 : RX.blue } } });
  const h1 = [...fixed.map((h) => cell(h, hS({ alignment: { horizontal: 'left', vertical: 'center' } }))), ...days.map((x) => cell(+x.slice(8), hW(x), 'n')), ...tail.map((h) => cell(h, hS()))];
  const h2 = [...fixed.map(() => cell('', hS())), ...days.map((x) => cell(DOWS[Calc.dow(x)].slice(0, 2), hW(x))), ...tail.map(() => cell('', hS()))];
  const H = aoa.length; aoa.push(h1, h2); rowsH.push({ hpt: 18 }, { hpt: 16 });
  [...fixed.keys()].forEach((c) => merges.push({ s: { r: H, c }, e: { r: H + 1, c } }));
  tail.forEach((_, i) => merges.push({ s: { r: H, c: fixed.length + nD + i }, e: { r: H + 1, c: fixed.length + nD + i } }));
  // body by section
  const secs = R.sections.filter((s) => s.rows.length);
  let tot = { days: 0, prod: 0, ot: 0 };
  secs.forEach((s) => {
    const r0 = aoa.length;
    aoa.push([cell(`${s.section.name}   ${s.headcount} people, ${fmt0(s.prod)} productive hours`, { font: font({ bold: true, color: { rgb: RX.blue } }), fill: { fgColor: { rgb: RX.light } }, border }), ...Array(nC - 1).fill(0).map(() => cell('', { fill: { fgColor: { rgb: RX.light } }, border }))]);
    merges.push({ s: { r: r0, c: 0 }, e: { r: r0, c: nC - 1 } }); rowsH.push({ hpt: 18 });
    s.rows.forEach((r, i) => {
      const zebra = i % 2 ? 'FAFCFD' : 'FFFFFF';
      const base = (o = {}) => ({ font: font(), fill: { fgColor: { rgb: zebra } }, border, alignment: { vertical: 'center' }, ...o });
      const team = d.teamMap[r.emp.team_id];
      const row = [cell(r.emp.emp_no, base()), cell(r.emp.name, base({ font: font({ bold: true }) })), cell(r.emp.role, base()), cell(team ? team.name : '', base()), cell(Math.round(r.pct * 100) / 100, base({ numFmt: '0%', alignment: { horizontal: 'center' } }), 'n')];
      r.cells.forEach((c) => { const k = rxKind(d, c.code), [bg, fg] = RX.fills[k]; row.push(cell(c.code === 'R' ? '·' : shortCode(c.code), { font: font({ bold: k !== 'R', color: { rgb: fg } }), fill: { fgColor: { rgb: bg } }, border, alignment: { horizontal: 'center', vertical: 'center' } })); });
      row.push(cell(Math.round(r.staffDays), base({ alignment: { horizontal: 'center' } }), 'n'), cell(Math.round(r.prod * 10) / 10, base({ numFmt: '0.0' }), 'n'), cell(Math.round(r.ot * 10) / 10, base({ numFmt: '0.0' }), 'n'));
      aoa.push(row); rowsH.push({ hpt: 17 });
      tot.days += r.staffDays; tot.prod += r.prod; tot.ot += r.ot;
    });
  });
  // total
  const tS = (o = {}) => ({ font: font({ bold: true, color: { rgb: 'FFFFFF' } }), fill: { fgColor: { rgb: RX.blue } }, border, ...o });
  const rt = aoa.length;
  aoa.push([cell('Workshop total', tS()), ...Array(fixed.length - 1 + nD).fill(0).map(() => cell('', tS())), cell(Math.round(tot.days), tS({ alignment: { horizontal: 'center' } }), 'n'), cell(Math.round(tot.prod), tS({ numFmt: '#,##0' }), 'n'), cell(Math.round(tot.ot), tS({ numFmt: '#,##0' }), 'n')]);
  merges.push({ s: { r: rt, c: 0 }, e: { r: rt, c: fixed.length + nD - 1 } }); rowsH.push({ hpt: 20 });
  // legend
  aoa.push([]); rowsH.push({ hpt: 8 });
  const leg = [['M', 'Morning'], ['A', 'Afternoon'], ['N', 'Night'], ['R', 'Rest'], ['leave', 'Leave'], ['train', 'Training'], ['sick', 'Sick'], ['abs', 'Absent'], ['ot', 'Overtime']];
  const lr = [cell('Key', { font: font({ bold: true }) })];
  leg.forEach(([k, t]) => { const [bg, fg] = RX.fills[k]; lr.push(cell(t, { font: font({ bold: true, color: { rgb: fg } }), fill: { fgColor: { rgb: bg } }, border, alignment: { horizontal: 'center' } })); });
  aoa.push(lr); rowsH.push({ hpt: 18 });
  const ws = X.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges; ws['!rows'] = rowsH;
  ws['!cols'] = [{ wch: 8 }, { wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 7 }, ...days.map(() => ({ wch: 4.2 })), { wch: 6 }, { wch: 8 }, { wch: 7 }];
  // the key cells sit under columns of width 4: put them under the name columns instead
  ws['!cols'][1] = { wch: 28 };
  ws['!freeze'] = { xSplit: 2, ySplit: H + 2 };
  ws['!views'] = [{ state: 'frozen', xSplit: 2, ySplit: H + 2, topLeftCell: X.utils.encode_cell({ r: H + 2, c: 2 }) }];
  ws['!pageSetup'] = { orientation: 'landscape', paperSize: 9, fitToWidth: 1, fitToHeight: 0 };
  // summary sheet
  const sum = [[cell('Section', hS({ alignment: { horizontal: 'left' } })), cell('People', hS()), cell('Productive h', hS()), cell('OT h', hS()), cell('People on leave', hS())],
    ...secs.map((s) => [cell(s.section.name, { font: font({ bold: true }), border }), cell(s.headcount, { font: font(), border, alignment: { horizontal: 'center' } }, 'n'), cell(Math.round(s.prod), { font: font(), border, numFmt: '#,##0' }, 'n'), cell(Math.round(s.ot), { font: font(), border, numFmt: '#,##0' }, 'n'), cell(s.alTechs, { font: font(), border, alignment: { horizontal: 'center' } }, 'n')]),
    [cell('Total', tS()), cell(secs.reduce((a, s) => a + s.headcount, 0), tS({ alignment: { horizontal: 'center' } }), 'n'), cell(Math.round(tot.prod), tS({ numFmt: '#,##0' }), 'n'), cell(Math.round(tot.ot), tS({ numFmt: '#,##0' }), 'n'), cell(secs.reduce((a, s) => a + s.alTechs, 0), tS({ alignment: { horizontal: 'center' } }), 'n')]];
  const ws2 = X.utils.aoa_to_sheet(sum); ws2['!cols'] = [{ wch: 26 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 16 }];
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Roster');
  X.utils.book_append_sheet(wb, ws2, 'Summary');
  X.writeFile(wb, `Roster ${wsName} ${ms.slice(0, 7)}.xlsx`);
  toast('Roster exported', 'ok');
}

// =====================================================================
// SHIFT CYCLE BUILDER (used by Plan month and by Shift patterns)
// =====================================================================
const SHIFT_WORDS = { M: 'Morning', A: 'Afternoon', N: 'Night', R: 'Rest' };
const letterOf = (code) => (code === 'R' ? 'R' : (code || '').charAt(0));
const TEMPLATES = {
  8: [['Morning, Sun to Thu', [[5, 'M'], [2, 'R']], true], ['Afternoon, Sun to Thu', [[5, 'A'], [2, 'R']], true], ['Night, Sun to Thu', [[5, 'N'], [2, 'R']], true],
      ['Week Morning, week Afternoon', [[5, 'M'], [2, 'R'], [5, 'A'], [2, 'R']], true], ['Morning, Afternoon, Night by week', [[5, 'M'], [2, 'R'], [5, 'A'], [2, 'R'], [5, 'N'], [2, 'R']], true]],
  12: [['4 on 4 off, Morning', [[4, 'M'], [4, 'R']]], ['4 on 4 off, Night', [[4, 'N'], [4, 'R']]], ['4 Morning, 4 off, 4 Night, 4 off', [[4, 'M'], [4, 'R'], [4, 'N'], [4, 'R']]],
       ['4 on 4 off: 2 rounds Morning, 2 rounds Night', [[4, 'M'], [4, 'R'], [4, 'M'], [4, 'R'], [4, 'N'], [4, 'R'], [4, 'N'], [4, 'R']]], ['2 Morning, 2 Night, 4 off', [[2, 'M'], [2, 'N'], [4, 'R']]]],
};
function workCodes(d, hrs) {
  const out = {};
  d.shift_codes.filter((c) => c.shift_type === String(hrs) && !c.status_type && Number(c.prod_hrs) > 0).forEach((c) => { const l = letterOf(c.code); if (!out[l]) out[l] = c.code; });
  out.R = 'R'; return out; // { M: 'M - 8hr', A: 'A - 8hr', N: 'N - 8hr', R: 'R' }
}
const toBlocks = (cycle) => cycle.reduce((b, c) => { const l = letterOf(c); if (b.length && b[b.length - 1][1] === l) b[b.length - 1][0]++; else b.push([1, l]); return b; }, []);
// one builder instance inside a modal; onChange fires with the expanded cycle (shift codes)
function cycleBuilder(host, d, { hrs = 8, blocks = [], onChange }) {
  const st = { hrs, blocks: blocks.map((b) => [...b]) };
  const codes = () => workCodes(d, st.hrs);
  const cycle = () => { const m = codes(); return st.blocks.flatMap(([n, l]) => Array(n).fill(m[l] || 'R')); };
  const draw = () => {
    const m = codes(), letters = Object.keys(m);
    host.innerHTML = `<div class="cb">
      <div class="cb-row"><span class="cb-lab">Quick start</span><div class="cb-chips">${TEMPLATES[st.hrs].map((t, i) => `<button type="button" class="btn sm" data-tpl="${i}">${esc(t[0])}</button>`).join('')}</div></div>
      <div class="cb-row"><span class="cb-lab">Add days</span><div class="cb-chips"><input type="number" class="w-xs" id="cb_n" min="1" max="31" value="${st.hrs === 12 ? 4 : 5}" aria-label="Number of days"><span class="hint">days of</span>
        ${letters.map((l) => `<button type="button" class="btn sm cb-k k-${l}" data-add="${l}">${l} ${SHIFT_WORDS[l] || ''}</button>`).join('')}</div></div>
      <div class="cb-row"><span class="cb-lab">The cycle</span><div class="cb-chips" id="cb_list">${st.blocks.length ? st.blocks.map(([n, l], i) => `<span class="cb-block k-${l}">${n} × ${l}<button type="button" aria-label="Remove" data-rm="${i}">×</button></span>`).join('') : '<span class="hint">Empty. Pick a quick start or add days.</span>'}
        ${st.blocks.length ? `<button type="button" class="linkbtn" id="cb_clear">Clear</button><span class="hint">${cycle().length} days, then it repeats</span>` : ''}</div></div>
    </div>`;
    $$('[data-tpl]', host).forEach((b) => (b.onclick = () => { const t = TEMPLATES[st.hrs][+b.dataset.tpl]; st.blocks = t[1].map((x) => [...x]); st.weekly = !!t[2]; draw(); onChange && onChange(cycle(), st); }));
    $$('[data-add]', host).forEach((b) => (b.onclick = () => { const n = Math.max(1, Math.min(31, +$('#cb_n', host).value || 1)); const l = b.dataset.add; const last = st.blocks[st.blocks.length - 1]; if (last && last[1] === l) last[0] += n; else st.blocks.push([n, l]); st.weekly = false; draw(); onChange && onChange(cycle(), st); }));
    $$('[data-rm]', host).forEach((b) => (b.onclick = () => { st.blocks.splice(+b.dataset.rm, 1); draw(); onChange && onChange(cycle(), st); }));
    const cl = $('#cb_clear', host); if (cl) cl.onclick = () => { st.blocks = []; draw(); onChange && onChange(cycle(), st); };
  };
  draw();
  return { setHrs(h) { st.hrs = h; st.blocks = []; draw(); }, setBlocks(b) { st.blocks = b.map((x) => [...x]); draw(); }, cycle, st };
}

// =====================================================================
// PLAN MONTH: a schedule for one month that replaces the pattern
// =====================================================================
function planMonthModal(preUid) {
  const d = wsData();
  const m0 = (S.type === 'month' ? pStart() : Calc.monthStart(pStart())).slice(0, 7);
  const emps = d.employees.filter((e) => e.status === 'Active');
  const pre = preUid && d.planMap[preUid] && d.planMap[preUid][m0];
  const st = { month: m0, hrs: pre ? pre.shift_hrs : (Calc.planOf && (d.patMap[(d.teamMap[(emps.find((e) => e.uid === preUid) || {}).team_id] || {}).pattern_main] || {}).shift_hrs) || 8, start: pre && pre.cycle_start ? pre.cycle_start : m0 + '-01', over: {}, cycle: pre && pre.cycle ? pre.cycle : [] };
  const daysOf = (mo = st.month) => Calc.periodDays('month', mo + '-01');
  const body = `<div class="grid3">
      <label class="f">Month<input type="month" id="pm_m" value="${st.month}"></label>
      <div class="f"><span>Shift length</span><div class="seg" id="pm_h"><button type="button" data-h="8">8 hours</button><button type="button" data-h="12">12 hours</button></div></div>
      <label class="f">Cycle day 1 is<input type="date" id="pm_s" value="${st.start}"></label>
      <label class="f">For how long<select id="pm_n">${[1, 2, 3, 4, 6, 12].map((n) => `<option value="${n}">${n === 1 ? 'This month only' : n + ' months'}</option>`).join('')}</select></label></div>
    <div class="grid2 pm-top">
      <div><div class="hint mb-2xs">Who (tick one or more)</div>
        <div class="row mb-sm"><input class="flex1" type="text" id="pm_q" placeholder="Search name, number or team"><select id="pm_team" aria-label="Tick a whole team"><option value="">Tick a team</option>${d.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
        <div class="checklist" id="pm_list">${emps.map((e) => `<label data-s="${esc((e.name + ' ' + e.emp_no + ' ' + ((d.teamMap[e.team_id] || {}).name || '')).toLowerCase())}"><input type="checkbox" value="${e.uid}" ${e.uid === preUid ? 'checked' : ''}> ${esc(e.name)} <span class="hint">${esc(e.emp_no)}${d.teamMap[e.team_id] ? ', ' + esc(d.teamMap[e.team_id].name) : ''}</span></label>`).join('')}</div></div>
      <div id="pm_b"></div></div>
    <div id="pm_prev"></div>`;
  const ov = modal({ title: 'Plan the month', wide: true, body, buttons: [
    { label: 'Remove plan', cls: 'danger', action: async (o) => {
      const ids = $$('#pm_list input:checked', o).map((i) => +i.value);
      if (!ids.length) { toast('Tick the people whose plan you want to remove', 'err'); return false; }
      const nM = +$('#pm_n', o).value || 1, months = Array.from({ length: nM }, (_, k) => Calc.shiftPeriod('month', st.month + '-01', k));
      await q(sb.from('month_plans').delete().in('employee_uid', ids).in('month', months));
      await refresh(); toast(`Plan removed for ${nM === 1 ? 'this month' : nM + ' months'}. Those days follow the pattern again`, 'ok');
    } },
    { label: 'Cancel' },
    { label: 'Save plan', cls: 'primary', action: async (o) => {
      const ids = $$('#pm_list input:checked', o).map((i) => +i.value);
      if (!ids.length) { toast('Tick at least one person', 'err'); return false; }
      if (!st.cycle.length) { toast('Build the cycle first: pick a quick start or add days', 'err'); return false; }
      const nM = +$('#pm_n', o).value || 1, rows = [];
      for (let k = 0; k < nM; k++) {
        const mo = Calc.shiftPeriod('month', st.month + '-01', k), codes = monthCodes(mo.slice(0, 7));
        ids.forEach((uid) => rows.push({ workshop_id: S.ws, employee_uid: uid, month: mo, shift_hrs: st.hrs, codes, cycle: st.cycle, cycle_start: st.start, updated_at: new Date().toISOString() }));
      }
      await q(sb.from('month_plans').upsert(rows, { onConflict: 'employee_uid,month' }));
      await refresh(); toast(`Plan saved for ${ids.length} ${ids.length === 1 ? 'person' : 'people'}, ${nM === 1 ? 'this month' : nM + ' months'}`, 'ok');
    } }] });
  const monthCodes = (mo = st.month) => daysOf(mo).map((day) => {
    if (st.over[day]) return st.over[day];
    if (!st.cycle.length) return 'R';
    const n = st.cycle.length, k = ((Calc.diffDays(st.start, day) % n) + n) % n; return st.cycle[k];
  });
  const preview = () => {
    const days = daysOf(), codes = monthCodes(), m = workCodes(d, st.hrs), order = Object.values(m);
    const prod = codes.reduce((a, c) => a + Number((d.codeMap[c] || {}).prod_hrs || 0), 0), work = codes.filter((c) => c !== 'R').length;
    const ids = $$('#pm_list input:checked', ov).map((i) => +i.value);
    const had = ids.filter((u) => d.planMap[u] && d.planMap[u][st.month]).length;
    $('#pm_prev', ov).innerHTML = `<div class="pm-sum"><b>${MONTHS_L[+st.month.slice(5) - 1]} ${st.month.slice(0, 4)}</b><span>${work} working days, ${fmt0(prod)} productive hours a person</span><span>${ids.length} ${ids.length === 1 ? 'person' : 'people'} ticked${had ? `, ${had} already planned (will be replaced)` : ''}</span><span class="hint">Click a day to change it. With more than one month the cycle carries on without a break.</span></div>
      <div class="tbl-wrap"><table class="roster pm-cal"><thead><tr>${days.map((x) => { const w = Calc.dow(x); return `<th class="${w === 5 || w === 6 ? 'wk' : ''}">${DOWS[w].slice(0, 2)}<br>${+x.slice(8)}</th>`; }).join('')}</tr></thead>
      <tbody><tr>${codes.map((c, i) => `<td class="cell ${codeClass(d, c)} ${st.over[days[i]] ? 'c-change' : ''}" data-day="${days[i]}" title="${esc(c)}">${esc(letterOf(c))}</td>`).join('')}</tr></tbody></table></div>`;
    $$('[data-day]', ov).forEach((td) => (td.onclick = () => { const cur = monthCodes()[days.indexOf(td.dataset.day)]; const next = order[(order.indexOf(cur) + 1) % order.length]; st.over[td.dataset.day] = next; preview(); }));
  };
  const b = cycleBuilder($('#pm_b', ov), d, { hrs: st.hrs, blocks: toBlocks(st.cycle), onChange: (cyc, bst) => {
    st.cycle = cyc; st.over = {};
    if (bst.weekly) { st.start = Calc.weekStart(st.month + '-01'); $('#pm_s', ov).value = st.start; }
    preview();
  } });
  const segSync = () => $$('#pm_h button', ov).forEach((x) => x.classList.toggle('on', +x.dataset.h === st.hrs));
  $$('#pm_h button', ov).forEach((x) => (x.onclick = () => { st.hrs = +x.dataset.h; st.cycle = []; st.over = {}; b.setHrs(st.hrs); segSync(); preview(); }));
  $('#pm_m', ov).onchange = (e) => { if (!e.target.value) return; const was = st.month; st.month = e.target.value; st.over = {}; if (st.start.slice(0, 7) === was) st.start = st.month + '-01'; $('#pm_s', ov).value = st.start; preview(); };
  $('#pm_s', ov).onchange = (e) => { if (e.target.value) { st.start = e.target.value; st.over = {}; preview(); } };
  $('#pm_q', ov).oninput = (e) => $$('#pm_list label', ov).forEach((l) => l.classList.toggle('hidden', !l.dataset.s.includes(e.target.value.toLowerCase())));
  $('#pm_team', ov).onchange = (e) => { const t = +e.target.value; if (!t) return; const set = new Set(emps.filter((x) => x.team_id === t).map((x) => String(x.uid))); $$('#pm_list input', ov).forEach((i) => { if (set.has(i.value)) i.checked = true; }); e.target.value = ''; preview(); };
  $('#pm_list', ov).onchange = () => preview();
  // continue last month's rotation for the first ticked person
  const cont = document.createElement('button'); cont.type = 'button'; cont.className = 'btn sm'; cont.textContent = 'Continue last month';
  cont.onclick = () => {
    const uid = +($$('#pm_list input:checked', ov)[0] || {}).value; const prev = Calc.shiftPeriod('month', st.month + '-01', -1).slice(0, 7);
    const p = uid && d.planMap[uid] && d.planMap[uid][prev];
    if (!p || !p.cycle) { toast('No plan last month for the first ticked person', 'err'); return; }
    st.hrs = p.shift_hrs; segSync(); b.setHrs(st.hrs); b.setBlocks(toBlocks(p.cycle)); st.cycle = p.cycle; st.start = p.cycle_start; st.over = {}; $('#pm_s', ov).value = st.start; preview();
    toast('Loaded. The rotation carries on from where last month ended', 'ok');
  };
  $('#pm_s', ov).closest('.grid3').appendChild(Object.assign(document.createElement('div'), { className: 'f pm-cont' })).append(cont);
  segSync(); preview();
}

// =====================================================================
// EMPLOYEES
// =====================================================================
function viewEmployees(el) {
  const d = wsData(), f = S.empFilter, ed = canEdit(), td = today();
  const list = d.employees.filter((e) => (!f.section || String(Calc.sectionOf(e, d)) === f.section) && (!f.status || e.status === f.status) &&
    (!f.q || (e.name + ' ' + e.emp_no + ' ' + (e.specialty || '') + ' ' + (e.skills || '')).toLowerCase().includes(f.q.toLowerCase())));
  const current = (e) => d.status_changes.filter((c) => c.employee_uid === e.uid && c.date_from <= td && c.date_to >= td).pop();
  el.innerHTML = head('Employees', `${d.employees.filter((e) => e.status === 'Active').length} active people. Counted % decides how many productive hours each person adds.`, ed ? '<button class="btn primary" id="addEmp">Add employee</button>' : '') + `
  <div class="toolbar"><input class="w-lg" type="text" id="ef_q" placeholder="Search name, number, skill" value="${esc(f.q)}" aria-label="Search">
    <select id="ef_sec" aria-label="Section"><option value="">All sections</option>${d.sections.map((s) => `<option value="${s.id}" ${f.section === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <select id="ef_status" aria-label="Status"><option value="">Any status</option>${['Active', 'Pending', 'Excluded'].map((s) => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <span class="hint">${list.length} shown</span></div>
  <div class="tbl-wrap"><table><thead><tr><th>No.</th><th>Name</th><th>Role</th><th>Team / section</th><th class="num">Counted</th><th>Shift pattern</th><th>Status</th><th>Today</th><th></th></tr></thead><tbody>
  ${list.map((e) => { const c = current(e), t = d.teamMap[e.team_id], p = e.pattern_main || (t && t.pattern_main); return `<tr><td class="mono">${esc(e.emp_no)}</td><td><b>${esc(e.name)}</b>${e.specialty || e.skills ? `<span class="sub-line">${esc([e.specialty, e.skills].filter(Boolean).join(', '))}</span>` : ''}</td><td>${esc(e.role)}</td>
    <td>${t ? esc(t.name) : ''}<span class="sub-line">${esc(secName(d, Calc.sectionOf(e, d)))}</span></td>
    <td class="num">${pct(Calc.countedPct(e, d.settings))}</td><td>${esc(patName(d, p))}${e.pattern_main ? ' <span class="pill muted">own</span>' : ''}</td>
    <td><span class="pill ${e.status === 'Active' ? 'good' : 'muted'}">${esc(e.status)}</span></td><td>${c ? `<span class="pill info">${esc(c.status_type === 'Custom' ? c.code : c.status_type)}</span>` : ''}</td>
    <td class="actions">${ed ? `<button class="btn sm" data-st="${e.uid}">Leave</button> <button class="btn sm" data-ed="${e.uid}">Edit</button> <button class="btn sm danger" data-rm="${e.uid}">Delete</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="9" class="hint">No employees match the filters.</td></tr>'}
  </tbody></table></div>`;
  const upd = () => { S.empFilter = { q: $('#ef_q', el).value, section: $('#ef_sec', el).value, status: $('#ef_status', el).value }; viewEmployees(el); const i = $('#ef_q', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
  $('#ef_q', el).oninput = upd; $('#ef_sec', el).onchange = upd; $('#ef_status', el).onchange = upd;
  if (!ed) return;
  $('#addEmp', el).onclick = () => employeeModal(null);
  $$('[data-ed]', el).forEach((b) => (b.onclick = () => employeeModal(d.employees.find((e) => e.uid === +b.dataset.ed))));
  $$('[data-st]', el).forEach((b) => (b.onclick = () => statusModal({ employee_uid: +b.dataset.st, date_from: td, date_to: td })));
  $$('[data-rm]', el).forEach((b) => (b.onclick = async () => {
    const e = d.employees.find((x) => x.uid === +b.dataset.rm);
    if (!(await confirmBox('Delete employee', `Delete <b>${esc(e.name)}</b> (${esc(e.emp_no)}) and all their leave records? If the person only moved or left, set the status to <b>Excluded</b> or add an end date instead, which keeps the history.`))) return;
    try { await q(sb.from('employees').delete().eq('uid', e.uid)); await refresh(); toast('Employee deleted', 'ok'); } catch (err) { fail(err); }
  }));
}
function employeeModal(e) {
  const d = wsData(), isNew = !e;
  e = e || { status: 'Active', role: 'Technician', team_id: d.teams[0] && d.teams[0].id };
  const pat = (v) => `<option value="">Team pattern</option>` + d.patterns.map((p) => `<option value="${p.id}" ${p.id === v ? 'selected' : ''}>${esc(p.name)} (${p.shift_hrs} h)</option>`).join('');
  modal({ title: isNew ? 'Add employee' : `Edit ${e.name}`, wide: true, body: `
    <div class="grid3">
      <label class="f">Employee number *<input type="text" id="e_no" value="${esc(e.emp_no || '')}"></label>
      <label class="f span2">Name *<input type="text" id="e_name" value="${esc(e.name || '')}"></label>
      <label class="f">Role<input type="text" id="e_role" list="roles" value="${esc(e.role)}"><datalist id="roles">${ROLES.map((r) => `<option>${r}</option>`).join('')}</datalist></label>
      <label class="f">Team<select id="e_team"><option value="">No team</option>${d.teams.map((t) => `<option value="${t.id}" ${t.id === e.team_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <label class="f">Section (when no team)<select id="e_sec"><option value="">None</option>${d.sections.map((s) => `<option value="${s.id}" ${s.id === e.section_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f">Status<select id="e_status">${['Active', 'Pending', 'Excluded'].map((s) => `<option ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="f">Counted % (blank = automatic)<input type="number" id="e_pct" min="0" max="100" step="5" value="${e.hours_pct !== null && e.hours_pct !== undefined ? Math.round(e.hours_pct * 100) : ''}"></label>
      <label class="f">Specialty<input type="text" id="e_spec" value="${esc(e.specialty || '')}"></label>
      <label class="f">Start date<input type="date" id="e_start" value="${e.start_date || ''}"></label>
      <label class="f">End date<input type="date" id="e_end" value="${e.end_date || ''}"></label>
      <div></div>
      <label class="f">Own shift pattern<select id="e_pm">${pat(e.pattern_main)}</select></label>
      ${d.hasAlt ? `<label class="f">Own alternative pattern<select id="e_pa">${pat(e.pattern_alt)}</select></label>` : ''}
    </div>
    <label class="f">Skills<input type="text" id="e_skills" value="${esc(e.skills || '')}"></label>
    <label class="f">Notes<input type="text" id="e_notes" value="${esc(e.notes || '')}"></label>
    <p class="hint m0">Automatic counted %: Technician 100%, Team Leader ${pct(Number(d.settings.tl_factor))}, Foreman and office roles 0%. Welders and support staff are usually 25–50%. Pending and Excluded people are not counted. Days before the start or after the end date are not on the roster.</p>`,
    buttons: [{ label: 'Cancel' }, { label: isNew ? 'Add employee' : 'Save changes', cls: 'primary', action: async (ov) => {
      const v = (id) => ($(id, ov) ? $(id, ov).value.trim() : '');
      const row = { workshop_id: S.ws, emp_no: v('#e_no'), name: v('#e_name'), role: v('#e_role') || 'Technician', team_id: v('#e_team') ? +v('#e_team') : null, section_id: v('#e_sec') ? +v('#e_sec') : null,
        status: v('#e_status'), hours_pct: v('#e_pct') === '' ? null : Number(v('#e_pct')) / 100, specialty: v('#e_spec') || null, skills: v('#e_skills') || null,
        start_date: v('#e_start') || null, end_date: v('#e_end') || null, pattern_main: v('#e_pm') ? +v('#e_pm') : null, notes: v('#e_notes') || null };
      if (d.hasAlt) row.pattern_alt = v('#e_pa') ? +v('#e_pa') : null;
      if (!row.emp_no || !row.name) { toast('Employee number and name are required', 'err'); return false; }
      if (row.hours_pct !== null && (row.hours_pct < 0 || row.hours_pct > 1)) { toast('Counted % must be between 0 and 100', 'err'); return false; }
      if (d.employees.some((x) => x.emp_no === row.emp_no && x.uid !== e.uid)) { toast('This employee number already exists in the workshop', 'err'); return false; }
      if (isNew) await q(sb.from('employees').insert(row)); else await q(sb.from('employees').update(row).eq('uid', e.uid));
      await refresh(); toast(isNew ? 'Employee added' : 'Changes saved', 'ok');
    } }] });
}

// =====================================================================
// TIME STUDY
// =====================================================================
function viewTimeStudy(el) {
  const d = wsData(), exams = d.exam_types, ed = canEdit();
  const ex = exams.find((x) => x.id === S.studyExam) || exams[0];
  if (!ex) { el.innerHTML = head('Time study', '') + '<p class="hint">Add exam types in Settings first.</p>'; return; }
  S.studyExam = ex.id;
  el.innerHTML = head('Time study', 'Break the exam into elements, record stopwatch readings and get the standard man-hours per exam.') + `
  <div class="toolbar"><label class="f">Exam<select id="ts_ex">${d.sections.map((s) => { const xs = exams.filter((x) => x.section_id === s.id); return xs.length ? `<optgroup label="${esc(s.name)}">${xs.map((x) => `<option value="${x.id}" ${x.id === ex.id ? 'selected' : ''}>${esc(x.asset)} ${esc(x.exam)}</option>`).join('')}</optgroup>` : ''; }).join('')}</select></label>
  <div class="spacer"></div><div class="note">Current standard: <b>${fmt2(ex.hours)} man-hours</b> per exam${ex.crew ? `, crew of ${fmt(ex.crew)}` : ''}</div></div>
  <div class="note mb-sm">Average of the readings in minutes, × rating % = normal time, × crew = man-minutes. The sum ÷ 60 is the man-hours per exam. No allowance is added. Rating 100% is normal pace, 110% faster, 90% slower.</div>
  <div class="tbl-wrap"><table id="ts"><thead><tr><th>Step</th><th>Element</th><th>Readings (minutes, comma separated)</th><th class="num">n</th><th class="num">Avg min</th><th class="num">Rating %</th><th class="num">Normal min</th><th class="num">Crew</th><th class="num">Man-min</th><th></th></tr></thead><tbody></tbody>
  <tfoot><tr class="total"><td></td><td colspan="5">Total</td><td class="num" id="ts_el"></td><td></td><td class="num" id="ts_mm"></td><td></td></tr></tfoot></table></div>
  <div class="row mt-sm">
    ${ed ? '<button class="btn" id="ts_add">Add element</button><button class="btn primary" id="ts_save">Save study</button>' : ''}
    <div class="spacer flex1"></div>
    <dl class="figures studybox m0"><div class="figure"><dt>Study result</dt><dd id="ts_res">–</dd><div class="q" id="ts_cmp"></div></div></dl>
    ${ed ? '<button class="btn primary" id="ts_apply">Use as standard hours</button>' : ''}
  </div>`;
  const tbody = $('#ts tbody', el);
  const dis = ed ? '' : 'disabled';
  const rowHTML = (r, i) => `<tr><td>${i + 1}</td><td><input type="text" class="t_el" value="${esc(r.element || '')}" aria-label="Element" ${dis}></td>
    <td><input type="text" class="t_rd" value="${esc((r.readings || []).join(', '))}" placeholder="12, 13.5, 12.2" aria-label="Readings" ${dis}></td>
    <td class="num t_n"></td><td class="num t_avg"></td><td class="num"><input type="number" class="t_rt w-xs" value="${r.rating_pct ?? 100}" min="50" max="150" aria-label="Rating" ${dis}></td>
    <td class="num t_nt"></td><td class="num"><input type="number" class="t_cr w-xs" value="${r.crew ?? 1}" min="1" step="1" aria-label="Crew" ${dis}></td><td class="num t_mm"></td>
    <td class="actions">${ed ? '<button class="btn sm danger t_rm" aria-label="Remove element">✕</button>' : ''}</td></tr>`;
  const parse = (s) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean).map(Number).filter((x) => !isNaN(x) && x >= 0);
  const calc = () => {
    let e2 = 0, mm = 0;
    $$('tr', tbody).forEach((tr, i) => {
      tr.cells[0].textContent = i + 1;
      const rd = parse($('.t_rd', tr).value), rt = +$('.t_rt', tr).value || 100, cr = Math.max(1, +$('.t_cr', tr).value || 1);
      const avg = rd.length ? rd.reduce((a, b) => a + b, 0) / rd.length : 0, nt = (avg * rt) / 100, m = nt * cr;
      $('.t_n', tr).textContent = rd.length; $('.t_avg', tr).textContent = rd.length ? fmt2(avg) : ''; $('.t_nt', tr).textContent = rd.length ? fmt2(nt) : ''; $('.t_mm', tr).textContent = rd.length ? fmt2(m) : '';
      e2 += nt; mm += m;
    });
    $('#ts_el', el).textContent = fmt2(e2); $('#ts_mm', el).textContent = fmt2(mm);
    const h = mm / 60; S._studyHours = h;
    $('#ts_res', el).textContent = mm ? fmt2(h) + ' man-h' : '–';
    $('#ts_cmp', el).textContent = mm ? `Elapsed ${fmt2(e2 / 60)} h. Current standard ${fmt2(ex.hours)} h (${signed(h - ex.hours, fmt2)})` : 'Enter readings to calculate';
  };
  const bindRows = () => { $$('input', tbody).forEach((i) => (i.oninput = calc)); $$('.t_rm', tbody).forEach((b) => (b.onclick = () => { b.closest('tr').remove(); calc(); })); calc(); };
  const draw = (list) => { if (!list.length && ed) list = [{}]; tbody.innerHTML = list.map(rowHTML).join(''); bindRows(); };
  if (S.studyCache[ex.id]) draw(S.studyCache[ex.id]);
  else {
    tbody.innerHTML = '<tr><td colspan="10" class="hint">Loading…</td></tr>';
    q(sb.from('time_study').select('*').eq('exam_type_id', ex.id).order('sort').order('id')).then((list) => { S.studyCache[ex.id] = list; if (S.view === 'timestudy' && S.studyExam === ex.id) draw(list); }).catch(fail);
  }
  $('#ts_ex', el).onchange = (e) => { S.studyExam = +e.target.value; viewTimeStudy(el); };
  if (!ed) return;
  $('#ts_add', el).onclick = () => { tbody.insertAdjacentHTML('beforeend', rowHTML({}, $$('tr', tbody).length)); bindRows(); $('tr:last-child .t_el', tbody).focus(); };
  const save = async () => {
    const list = $$('tr', tbody).map((tr, i) => ({ workshop_id: S.ws, exam_type_id: ex.id, element: $('.t_el', tr).value.trim(), readings: parse($('.t_rd', tr).value), rating_pct: +$('.t_rt', tr).value || 100, crew: Math.max(1, +$('.t_cr', tr).value || 1), sort: i }))
      .filter((r) => r.element || r.readings.length);
    if (list.some((r) => !r.element)) { toast('Give every element a name', 'err'); return false; }
    await q(sb.from('time_study').delete().eq('exam_type_id', ex.id));
    if (list.length) await q(sb.from('time_study').insert(list));
    delete S.studyCache[ex.id];
    return true;
  };
  $('#ts_save', el).onclick = async () => { try { if (await save() !== false) { toast('Time study saved', 'ok'); viewTimeStudy(el); } } catch (e) { fail(e); } };
  $('#ts_apply', el).onclick = async () => {
    const h = Math.round((S._studyHours || 0) * 100) / 100;
    if (!h) { toast('There is no study result yet', 'err'); return; }
    if (!(await confirmBox('Use as standard hours', `Change <b>${esc(ex.asset)} ${esc(ex.exam)}</b> from ${fmt2(ex.hours)} h to <b>${fmt2(h)} h</b> per exam? Every plan will use the new value.`, 'Change'))) return;
    try { if (await save() === false) return; await q(sb.from('exam_types').update({ hours: h }).eq('id', ex.id)); await refresh(); toast('Standard hours changed', 'ok'); } catch (e) { fail(e); }
  };
}

// =====================================================================
// SETTINGS
// =====================================================================
function viewSettings(el) {
  const d = wsData(), s = d.settings, ed = canEdit(), dis = ed ? '' : 'disabled';
  el.innerHTML = head('Settings', `Rules and reference data for ${esc(d.workshop.name)}.`) + `
  <div class="panel"><div class="phead"><h2>Counting rules</h2></div><div class="row">
    <label class="f">Team Leader counted %<input class="w-md" type="number" id="s_tl" value="${Math.round(s.tl_factor * 100)}" min="0" max="100" step="5" ${dis}></label>
    <label class="f">8 hr: productive h per person per week<input class="w-md" type="number" id="s_d8" value="${s.mp_div_8}" step="0.5" ${dis}></label>
    <label class="f">12 hr: productive h per person per week<input class="w-md" type="number" id="s_d12" value="${s.mp_div_12}" step="0.5" ${dis}></label>
    ${ed ? '<button class="btn primary mt-lg" id="s_save">Save rules</button>' : ''}</div>
    <p class="hint m0">These two figures are what one full-time person gives, and they turn hours into people. A month uses the weekly figure ÷ 5 × Sun–Thu days for 8 hr shifts, and × days ÷ 7 for 12 hr shifts. Each section uses the shift length most of its people work.</p></div>

  <div class="panel"><div class="phead"><h2>Sections</h2><span class="hint">Sick allowance reduces available hours</span></div>
  <div class="tbl-wrap"><table id="sec"><thead><tr><th>Name</th><th class="num">Sick allowance %</th><th class="num">Order</th><th></th></tr></thead><tbody>
  ${d.sections.map((x) => `<tr data-id="${x.id}"><td><input type="text" class="x_n" value="${esc(x.name)}" ${dis}></td><td class="num"><input type="number" class="x_s" value="${Math.round(x.sick_pct * 1000) / 10}" step="0.5" min="0" max="50" ${dis}></td><td class="num"><input type="number" class="x_o w-xs" value="${x.sort}" ${dis}></td><td class="actions">${ed ? '<button class="btn sm danger x_rm">Delete</button>' : ''}</td></tr>`).join('')}</tbody></table></div>
  ${ed ? '<div class="row mt-sm"><button class="btn primary" id="sec_save">Save sections</button><button class="btn" id="sec_add">Add section</button></div>' : ''}</div>

  <div class="panel"><div class="phead"><h2>Exam types and standard hours</h2></div>
  <div class="tbl-wrap"><table id="et"><thead><tr><th>Section</th><th>Type</th><th>Asset</th><th>Exam</th><th class="num">Std man-h</th><th class="num">Crew</th><th class="num">Default / week</th><th>Active</th><th class="num">Order</th><th></th></tr></thead><tbody>
  ${d.exam_types.map((x) => `<tr data-id="${x.id}"><td><select class="x_sec" ${dis}>${d.sections.map((s2) => `<option value="${s2.id}" ${s2.id === x.section_id ? 'selected' : ''}>${esc(s2.name)}</option>`).join('')}</select></td>
    <td><select class="x_cat" ${dis}>${['Planned', 'Corrective', 'Job'].map((c) => `<option ${c === x.category ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
    <td><input type="text" class="x_a" value="${esc(x.asset)}" ${dis}></td><td><input type="text" class="x_e" value="${esc(x.exam)}" ${dis}></td>
    <td class="num"><input type="number" class="x_h w-sm" value="${x.hours}" step="0.05" ${dis}></td><td class="num"><input type="number" class="x_c w-xs" value="${x.crew ?? ''}" ${dis}></td>
    <td class="num"><input type="number" class="x_w w-xs" value="${x.default_weekly ?? ''}" ${dis}></td><td><input type="checkbox" class="x_act" ${x.active ? 'checked' : ''} ${dis} aria-label="Active"></td>
    <td class="num"><input type="number" class="x_o w-xs" value="${x.sort}" ${dis}></td><td class="actions">${ed ? '<button class="btn sm danger x_rm">Delete</button>' : ''}</td></tr>`).join('')}</tbody></table></div>
  ${ed ? '<div class="row mt-sm"><button class="btn primary" id="et_save">Save exam types</button><button class="btn" id="et_add">Add exam type</button></div>' : ''}</div>

  <div class="panel"><div class="phead"><h2>Shift codes</h2><span class="hint">Productive hours count towards exams. OT hours count on an overtime day. Staff day counts the day as present.</span></div>
  <div class="tbl-wrap"><table id="sc"><thead><tr><th>Code</th><th>Description</th><th>Shift</th><th>Used for</th><th class="num">Paid h</th><th class="num">Productive h</th><th class="num">OT h</th><th>Staff day</th><th></th></tr></thead><tbody>
  ${d.shift_codes.map((c) => `<tr data-code="${esc(c.code)}"><td><b>${esc(c.code)}</b></td><td><input type="text" class="c_desc" value="${esc(c.description)}" ${dis}></td><td>${c.shift_type === '-' ? 'any' : c.shift_type + ' h'}</td><td>${esc(c.status_type || (c.code === 'R' ? 'Rest' : 'Shift'))}</td>
    <td class="num"><input type="number" class="c_paid w-xs" value="${c.paid_hrs}" step="0.25" ${dis}></td><td class="num"><input type="number" class="c_prod w-xs" value="${c.prod_hrs}" step="0.25" ${dis}></td>
    <td class="num"><input type="number" class="c_ot w-xs" value="${c.ot_hrs}" step="0.25" ${dis}></td><td><select class="c_day" ${dis}><option value="1" ${c.staff_day ? 'selected' : ''}>Yes</option><option value="0" ${!c.staff_day ? 'selected' : ''}>No</option></select></td>
    <td class="actions">${ed ? '<button class="btn sm danger c_rm" aria-label="Delete code">✕</button>' : ''}</td></tr>`).join('')}</tbody></table></div>
  ${ed ? '<div class="row mt-sm"><button class="btn primary" id="sc_save">Save shift codes</button><button class="btn" id="sc_add">Add shift code</button></div>' : ''}</div>

  <div class="cols">
    <div class="panel"><div class="phead"><h2>Teams</h2></div><div class="tbl-wrap"><table id="tm"><thead><tr><th>Code</th><th>Name</th><th>Section</th><th>Pattern</th>${d.hasAlt ? '<th>Alternative</th>' : ''}<th></th></tr></thead><tbody>
    ${d.teams.map((t) => teamRow(d, t, dis, ed)).join('')}</tbody></table></div>
    ${ed ? `<div class="row mt-sm"><button class="btn primary" id="tm_save">Save teams</button><button class="btn" id="tm_add">Add team</button></div>` : ''}</div>
    <div class="panel"><div class="phead"><h2>Shift patterns</h2><div class="grow"></div>${ed ? '<button class="btn sm" id="pt_add">Add pattern</button>' : ''}</div><p class="hint m0">The cycle repeats from its start date.</p>
    ${d.patterns.map((p) => `<div class="patrow"><div class="row between"><b>${esc(p.name)}</b><span><span class="pill info">${p.shift_hrs} h</span> ${ed ? `<button class="btn sm" data-pat="${p.id}">Edit</button>` : ''}</span></div>
      <div class="hint">${esc(p.description || '')}</div><div class="hint mono mt-2xs">From ${dlabel(p.cycle_start)}, ${p.cycle.length}-day cycle: ${p.cycle.slice(0, 28).map(shortCode).join(' ')}${p.cycle.length > 28 ? ' …' : ''}</div></div>`).join('')}</div>
  </div>`;
  if (!ed) return;
  $('#s_save', el).onclick = async () => { try { await q(sb.from('settings').update({ tl_factor: (+$('#s_tl', el).value || 0) / 100, mp_div_8: +$('#s_d8', el).value || 30, mp_div_12: +$('#s_d12', el).value || 31.5 }).eq('workshop_id', S.ws)); await refresh(); toast('Rules saved', 'ok'); } catch (e) { fail(e); } };
  // sections
  const secB = $('#sec tbody', el);
  $('#sec_add', el).onclick = () => secB.insertAdjacentHTML('beforeend', `<tr data-id=""><td><input type="text" class="x_n" placeholder="Section name"></td><td class="num"><input type="number" class="x_s" value="0"></td><td class="num"><input type="number" class="x_o w-xs" value="${d.sections.length + 1}"></td><td></td></tr>`);
  $('#sec_save', el).onclick = async () => {
    try {
      for (const tr of $$('tr', secB)) {
        const row = { workshop_id: S.ws, name: $('.x_n', tr).value.trim(), sick_pct: (+$('.x_s', tr).value || 0) / 100, sort: +$('.x_o', tr).value || 0 };
        if (!row.name) continue;
        if (tr.dataset.id) await q(sb.from('sections').update(row).eq('id', +tr.dataset.id)); else await q(sb.from('sections').insert(row));
      }
      await refresh(); toast('Sections saved', 'ok');
    } catch (e) { fail(e); }
  };
  $$('.x_rm', secB).forEach((b) => (b.onclick = async () => {
    const id = +b.closest('tr').dataset.id;
    if (!(await confirmBox('Delete section', 'Teams and exam types in this section will have no section.'))) return;
    try { await q(sb.from('sections').delete().eq('id', id)); await refresh(); toast('Deleted', 'ok'); } catch (e) { fail(e); }
  }));
  // exam types
  const etB = $('#et tbody', el);
  $('#et_add', el).onclick = () => modal({ title: 'Add exam type', body: `<div class="grid2">
      <label class="f">Section<select id="n_sec">${d.sections.map((s2) => `<option value="${s2.id}">${esc(s2.name)}</option>`).join('')}</select></label>
      <label class="f">Type<select id="n_cat"><option>Planned</option><option>Corrective</option><option>Job</option></select></label>
      <label class="f">Asset (wagon type, locomotive…) *<input type="text" id="n_a"></label><label class="f">Exam *<input type="text" id="n_e"></label>
      <label class="f">Standard man-hours<input type="number" id="n_h" step="0.05" value="0"></label><label class="f">Crew<input type="number" id="n_c"></label></div>`,
    buttons: [{ label: 'Cancel' }, { label: 'Add exam type', cls: 'primary', action: async (ov) => {
      const a = $('#n_a', ov).value.trim(), x = $('#n_e', ov).value.trim(); if (!a || !x) { toast('Asset and exam are required', 'err'); return false; }
      await q(sb.from('exam_types').insert({ workshop_id: S.ws, section_id: +$('#n_sec', ov).value, category: $('#n_cat', ov).value, asset: a, exam: x, hours: +$('#n_h', ov).value || 0, crew: $('#n_c', ov).value ? +$('#n_c', ov).value : null, sort: Math.max(0, ...d.exam_types.map((e2) => e2.sort)) + 1 }));
      await refresh(); toast('Exam type added', 'ok');
    } }] });
  $$('.x_rm', etB).forEach((b) => (b.onclick = async () => {
    const x = d.exam_types.find((e2) => e2.id === +b.closest('tr').dataset.id);
    if (!(await confirmBox('Delete exam type', `Delete <b>${esc(x.asset)} ${esc(x.exam)}</b>? Its workload counts and time study go too. To keep the history, untick Active instead.`))) return;
    try { await q(sb.from('exam_types').delete().eq('id', x.id)); await refresh(); toast('Deleted', 'ok'); } catch (e) { fail(e); }
  }));
  $('#et_save', el).onclick = async () => {
    try {
      let n = 0;
      for (const tr of $$('tr', etB)) {
        const o = d.exam_types.find((e2) => e2.id === +tr.dataset.id);
        const r = { section_id: +$('.x_sec', tr).value, category: $('.x_cat', tr).value, asset: $('.x_a', tr).value.trim(), exam: $('.x_e', tr).value.trim(), hours: +$('.x_h', tr).value || 0,
          crew: $('.x_c', tr).value === '' ? null : +$('.x_c', tr).value, default_weekly: $('.x_w', tr).value === '' ? null : +$('.x_w', tr).value, active: $('.x_act', tr).checked, sort: +$('.x_o', tr).value || 0 };
        if (Object.keys(r).some((k) => String(r[k] ?? '') !== String(o[k] ?? ''))) { await q(sb.from('exam_types').update(r).eq('id', o.id)); n++; }
      }
      await refresh(); toast(n ? `Saved ${n} exam type${n > 1 ? 's' : ''}` : 'Nothing changed', 'ok');
    } catch (e) { fail(e); }
  };
  // shift codes
  const scB = $('#sc tbody', el);
  $('#sc_add', el).onclick = () => modal({ title: 'Add shift code', body: `<div class="grid2">
      <label class="f">Code *<input type="text" id="n_code"></label><label class="f">Description<input type="text" id="n_desc"></label>
      <label class="f">Shift length<select id="n_type"><option value="8">8 h</option><option value="12">12 h</option><option value="-">Any</option></select></label>
      <label class="f">Used for<select id="n_st"><option value="">A normal shift</option>${STATUS_TYPES.filter((t) => t !== 'Custom').map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label class="f">Paid h<input type="number" id="n_paid" value="8"></label><label class="f">Productive h<input type="number" id="n_prod" value="0"></label>
      <label class="f">OT h<input type="number" id="n_ot" value="0"></label><label class="f">Staff day<select id="n_day"><option value="1">Yes</option><option value="0">No</option></select></label></div>`,
    buttons: [{ label: 'Cancel' }, { label: 'Add shift code', cls: 'primary', action: async (ov) => {
      const code = $('#n_code', ov).value.trim(); if (!code) { toast('Code is required', 'err'); return false; }
      await q(sb.from('shift_codes').insert({ workshop_id: S.ws, code, description: $('#n_desc', ov).value || code, shift_type: $('#n_type', ov).value, status_type: $('#n_st', ov).value || null,
        paid_hrs: +$('#n_paid', ov).value || 0, prod_hrs: +$('#n_prod', ov).value || 0, ot_hrs: +$('#n_ot', ov).value || 0, staff_day: +$('#n_day', ov).value, sort: d.shift_codes.length + 1 }));
      await refresh(); toast('Shift code added', 'ok');
    } }] });
  $$('.c_rm', scB).forEach((b) => (b.onclick = async () => {
    const code = b.closest('tr').dataset.code;
    if (!(await confirmBox('Delete shift code', `Delete <b>${esc(code)}</b>? Patterns that use it will show empty days.`))) return;
    try { await q(sb.from('shift_codes').delete().eq('workshop_id', S.ws).eq('code', code)); await refresh(); toast('Deleted', 'ok'); } catch (e) { fail(e); }
  }));
  $('#sc_save', el).onclick = async () => {
    try {
      const rows = $$('tr', scB).map((tr) => { const c = d.codeMap[tr.dataset.code]; return { ...c, description: $('.c_desc', tr).value, paid_hrs: +$('.c_paid', tr).value || 0, prod_hrs: +$('.c_prod', tr).value || 0, ot_hrs: +$('.c_ot', tr).value || 0, staff_day: +$('.c_day', tr).value }; });
      const changed = rows.filter((r) => { const c = d.codeMap[r.code]; return c.description !== r.description || +c.paid_hrs !== r.paid_hrs || +c.prod_hrs !== r.prod_hrs || +c.ot_hrs !== r.ot_hrs || +c.staff_day !== r.staff_day; });
      if (changed.length) await q(sb.from('shift_codes').upsert(changed));
      await refresh(); toast(changed.length ? `Saved ${changed.length} code${changed.length > 1 ? 's' : ''}` : 'Nothing changed', 'ok');
    } catch (e) { fail(e); }
  };
  // teams
  const tmB = $('#tm tbody', el);
  $('#tm_add', el).onclick = () => tmB.insertAdjacentHTML('beforeend', teamRow(d, { id: '', code: '', name: '', section_id: null, pattern_main: null, pattern_alt: null }, '', true));
  tmB.addEventListener('click', async (ev) => {
    const b = ev.target.closest('.t_rm'); if (!b) return;
    const tr = b.closest('tr'); if (!tr.dataset.id) return tr.remove();
    if (!(await confirmBox('Delete team', 'Its people will have no team (they keep their own section and pattern if set).'))) return;
    try { await q(sb.from('teams').delete().eq('id', +tr.dataset.id)); await refresh(); toast('Deleted', 'ok'); } catch (e) { fail(e); }
  });
  $('#tm_save', el).onclick = async () => {
    try {
      let i = 0;
      for (const tr of $$('tr', tmB)) {
        const row = { workshop_id: S.ws, code: $('.t_code', tr).value.trim(), name: $('.t_name', tr).value.trim(), section_id: $('.t_sec', tr).value ? +$('.t_sec', tr).value : null, pattern_main: $('.t_pm', tr).value ? +$('.t_pm', tr).value : null, sort: ++i };
        if (d.hasAlt || $('.t_pa', tr)) row.pattern_alt = $('.t_pa', tr) && $('.t_pa', tr).value ? +$('.t_pa', tr).value : null;
        if (!row.code || !row.name) { toast('Every team needs a code and a name', 'err'); return; }
        if (tr.dataset.id) await q(sb.from('teams').update(row).eq('id', +tr.dataset.id)); else await q(sb.from('teams').insert(row));
      }
      await refresh(); toast('Teams saved', 'ok');
    } catch (e) { fail(e); }
  };
  $$('[data-pat]', el).forEach((b) => (b.onclick = () => patternModal(d.patterns.find((p) => p.id === +b.dataset.pat))));
  $('#pt_add', el).onclick = () => patternModal(null);
}
function teamRow(d, t, dis, ed) {
  const opts = (v) => `<option value="">None</option>` + d.patterns.map((p) => `<option value="${p.id}" ${p.id === v ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  return `<tr data-id="${t.id}"><td><input type="text" class="t_code w-sm" value="${esc(t.code)}" ${dis}></td><td><input type="text" class="t_name" value="${esc(t.name)}" ${dis}></td>
    <td><select class="t_sec" ${dis}><option value="">None</option>${d.sections.map((s) => `<option value="${s.id}" ${s.id === t.section_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></td>
    <td><select class="t_pm" ${dis}>${opts(t.pattern_main)}</select></td>${d.hasAlt ? `<td><select class="t_pa" ${dis}>${opts(t.pattern_alt)}</select></td>` : ''}
    <td class="actions">${ed ? '<button class="btn sm danger t_rm" aria-label="Delete team">✕</button>' : ''}</td></tr>`;
}
function patternModal(p) {
  const d = wsData(), isNew = !p;
  p = p || { name: '', description: '', shift_hrs: 8, cycle_start: Calc.weekStart(today()), cycle: [] };
  let cycle = [...p.cycle];
  const ov = modal({ title: isNew ? 'Add shift pattern' : 'Edit shift pattern', wide: true, body: `<div class="grid3">
    <label class="f">Name *<input type="text" id="p_n" value="${esc(p.name)}" placeholder="For example Team A, 4 on 4 off"></label>
    <div class="f"><span>Shift length</span><div class="seg" id="p_h"><button type="button" data-h="8">8 hours</button><button type="button" data-h="12">12 hours</button></div></div>
    <label class="f">Cycle day 1 is<input type="date" id="p_s" value="${p.cycle_start}"></label></div>
    <label class="f">Description<input type="text" id="p_d" value="${esc(p.description || '')}"></label>
    <div id="p_b"></div><div id="p_prev"></div>
    <p class="hint m0">A pattern repeats with no end. For a schedule that changes month to month, use Plan the month on the Roster page.</p>`,
    buttons: [...(isNew ? [] : [{ label: 'Delete', cls: 'danger', action: async () => {
      if (!(await confirmBox('Delete pattern', `Delete <b>${esc(p.name)}</b>? Teams and people that use it will have no shifts.`))) return false;
      await q(sb.from('patterns').delete().eq('id', p.id)); await refresh(); toast('Pattern deleted', 'ok');
    } }]), { label: 'Cancel' }, { label: 'Save pattern', cls: 'primary', action: async (o) => {
      const row = { workshop_id: S.ws, name: $('#p_n', o).value.trim(), shift_hrs: hrs, cycle_start: $('#p_s', o).value, description: $('#p_d', o).value, cycle };
      if (!row.name || !cycle.length || !row.cycle_start) { toast('Name, cycle day 1 and the cycle are required', 'err'); return false; }
      if (isNew) await q(sb.from('patterns').insert(row)); else await q(sb.from('patterns').update(row).eq('id', p.id));
      await refresh(); toast('Pattern saved', 'ok');
    } }] });
  let hrs = p.shift_hrs;
  const prev = () => {
    const start = $('#p_s', ov).value || today(), days = Array.from({ length: 28 }, (_, i) => Calc.addDays(Calc.weekStart(start), i));
    const code = (day) => { if (!cycle.length) return ''; const n = cycle.length, k = ((Calc.diffDays(start, day) % n) + n) % n; return cycle[k]; };
    const prod = cycle.reduce((a, c) => a + Number((d.codeMap[c] || {}).prod_hrs || 0), 0);
    $('#p_prev', ov).innerHTML = cycle.length ? `<div class="pm-sum"><b>First 4 weeks</b><span>${fmt(cycle.length ? (prod / cycle.length) * 7 : 0)} productive hours a week on average</span></div>
      <div class="tbl-wrap"><table class="roster pm-cal"><thead><tr>${days.map((x) => { const w = Calc.dow(x); return `<th class="${w === 5 || w === 6 ? 'wk' : ''}">${DOWS[w].slice(0, 2)}<br>${+x.slice(8)}</th>`; }).join('')}</tr></thead>
      <tbody><tr>${days.map((x) => { const c = code(x); return `<td class="cell ${codeClass(d, c)}">${esc(letterOf(c))}</td>`; }).join('')}</tr></tbody></table></div>` : '';
  };
  const b = cycleBuilder($('#p_b', ov), d, { hrs, blocks: toBlocks(cycle), onChange: (c, st) => { cycle = c; if (st.weekly) $('#p_s', ov).value = Calc.weekStart($('#p_s', ov).value || today()); prev(); } });
  const sync = () => $$('#p_h button', ov).forEach((x) => x.classList.toggle('on', +x.dataset.h === hrs));
  $$('#p_h button', ov).forEach((x) => (x.onclick = () => { if (+x.dataset.h === hrs) return; hrs = +x.dataset.h; cycle = []; b.setHrs(hrs); sync(); prev(); }));
  $('#p_s', ov).onchange = prev;
  sync(); prev();
}

// =====================================================================
// USERS (admin)
// =====================================================================
function viewUsers(el) {
  const wsName = (id) => id ? (S.all.workshops.find((w) => w.id === id) || {}).name || id : 'All workshops';
  const roleText = { admin: 'Admin (everything, users)', editor: 'Can edit', viewer: 'View only' };
  el.innerHTML = head('Users', 'Who can sign in, what they can do and which workshop they see.', '<button class="btn primary" id="u_add">Add user</button>') + `
  <div class="tbl-wrap"><table><thead><tr><th>Username</th><th>Name</th><th>Access</th><th>Workshop</th><th>Added</th><th></th></tr></thead><tbody>
  ${S.all.users.map((u) => `<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.display_name || '')}</td><td>${roleText[u.role]}</td><td>${esc(wsName(u.workshop_id))}</td><td>${dlabel(u.created_at.slice(0, 10))}</td>
    <td class="actions"><button class="btn sm" data-ed="${u.user_id}">Edit</button> <button class="btn sm" data-pw="${u.user_id}">Reset password</button> ${u.user_id === S.me.user_id ? '' : `<button class="btn sm danger" data-del="${u.user_id}">Remove</button>`}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="hint">Workshop managers: Can edit, their own workshop. General manager: View only, all workshops.</p>`;
  const wsOpts = (v) => `<option value="">All workshops</option>` + S.all.workshops.map((w) => `<option value="${w.id}" ${w.id === v ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
  const roleOpts = (v) => ['editor', 'viewer', 'admin'].map((r) => `<option value="${r}" ${r === v ? 'selected' : ''}>${roleText[r]}</option>`).join('');
  $('#u_add', el).onclick = () => modal({ title: 'Add user', body: `<div class="grid2">
      <label class="f">Username * (a–z, 0–9, . _ -)<input type="text" id="nu_u" autocomplete="off" autocapitalize="none"></label><label class="f">Name<input type="text" id="nu_d"></label>
      <label class="f">Access<select id="nu_r">${roleOpts('editor')}</select></label><label class="f">Workshop<select id="nu_w">${wsOpts(S.ws)}</select></label>
      <label class="f">Temporary password * (8+ characters)<input type="text" id="nu_p" value="${genPw()}"></label></div>
      <p class="hint m0">Give the username and password to the person. They can change the password after signing in.</p>`,
    buttons: [{ label: 'Cancel' }, { label: 'Create user', cls: 'primary', action: async (ov) => {
      const u = $('#nu_u', ov).value.trim().toLowerCase();
      await q(sb.rpc('admin_create_user', { p_username: u, p_password: $('#nu_p', ov).value, p_display: $('#nu_d', ov).value, p_role: $('#nu_r', ov).value, p_ws: $('#nu_w', ov).value }));
      await refresh(); toast(`User ${u} created`, 'ok');
    } }] });
  $$('[data-ed]', el).forEach((b) => (b.onclick = () => { const u = S.all.users.find((x) => x.user_id === b.dataset.ed); modal({ title: `Edit ${u.username}`, body: `<div class="grid2">
      <label class="f">Name<input type="text" id="eu_d" value="${esc(u.display_name || '')}"></label><div></div>
      <label class="f">Access<select id="eu_r">${roleOpts(u.role)}</select></label><label class="f">Workshop<select id="eu_w">${wsOpts(u.workshop_id)}</select></label></div>`,
    buttons: [{ label: 'Cancel' }, { label: 'Save changes', cls: 'primary', action: async (ov) => {
      await q(sb.rpc('admin_update_user', { p_user_id: u.user_id, p_role: $('#eu_r', ov).value, p_ws: $('#eu_w', ov).value, p_display: $('#eu_d', ov).value })); await refresh(); toast('User saved', 'ok');
    } }] }); }));
  $$('[data-pw]', el).forEach((b) => (b.onclick = () => modal({ title: 'Reset password', body: `<label class="f">New password (8+ characters)<input type="text" id="rp" value="${genPw()}"></label>`,
    buttons: [{ label: 'Cancel' }, { label: 'Reset password', cls: 'primary', action: async (ov) => { await q(sb.rpc('admin_set_password', { p_user_id: b.dataset.pw, p_password: $('#rp', ov).value })); toast('Password reset', 'ok'); } }] })));
  $$('[data-del]', el).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Remove user', 'This person will no longer be able to sign in.', 'Remove'))) return;
    try { await q(sb.rpc('admin_delete_user', { p_user_id: b.dataset.del })); await refresh(); toast('User removed', 'ok'); } catch (e) { fail(e); }
  }));
}
function genPw() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; const r = crypto.getRandomValues(new Uint32Array(8)); return 'Dmm-' + [...r].map((x) => a[x % a.length]).join(''); }

// =====================================================================
// ACTIVITY
// =====================================================================
async function viewLog(el) {
  el.innerHTML = head('Activity', 'Who changed what, newest first.') + '<div class="loading">Loading…</div>';
  try {
    const rows = await q(sb.from('audit_log').select('*').order('id', { ascending: false }).limit(500));
    if (S.view !== 'log') return;
    const wsn = (id) => id ? ((S.all.workshops.find((w) => w.id === id) || {}).short_name || id) : '';
    el.innerHTML = head('Activity', 'Who changed what, newest first.') + `<div class="tbl-wrap"><table><thead><tr><th>Time</th><th>User</th><th>Workshop</th><th>Change</th><th>Details</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="nowrap">${esc(new Date(r.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</td><td>${esc(r.username)}</td><td>${esc(wsn(r.workshop_id))}</td><td>${esc(r.action)}</td><td>${esc(r.details)}</td></tr>`).join('') || '<tr><td colspan="5" class="hint">No activity yet.</td></tr>'}</tbody></table></div>`;
  } catch (e) { fail(e); }
}

// =====================================================================
// EXPORT / IMPORT
// =====================================================================
const COLS = {
  Employees: ['Employee No', 'Name', 'Role', 'Team', 'Section', 'Counted % (blank = auto)', 'Specialty', 'Skills', 'Start Date', 'End Date', 'Status', 'Own Pattern', 'Own Alternative Pattern', 'Notes'],
  'Leave and Status': ['Employee No', 'Employee Name', 'Status', 'Shift Code (Custom only)', 'From', 'To', 'Notes'],
  'Exam Types': ['Section', 'Type', 'Asset', 'Exam', 'Std Man-hours', 'Crew', 'Default per Week', 'Active', 'Order'],
  Workload: ['Period (Week/Month)', 'Period Start', 'Section', 'Asset', 'Exam', 'Planned', 'Actual'],
  'Time Study': ['Section', 'Asset', 'Exam', 'Element', 'Readings (min)', 'Rating %', 'Crew', 'Order'],
  Sections: ['Section', 'Sick Allowance %', 'Order'],
  'Shift Codes': ['Code', 'Description', 'Shift (8/12/-)', 'Used For', 'Paid Hrs', 'Productive Hrs', 'OT Hrs', 'Staff Day (1/0)'],
  Teams: ['Team Code', 'Name', 'Section', 'Pattern', 'Alternative Pattern'],
  Patterns: ['Pattern', 'Description', 'Shift Hours', 'Cycle Start', 'Cycle (comma separated)'],
  Rules: ['Setting', 'Value'],
};
function viewData(el) {
  const d = wsData(), ed = canEdit();
  el.innerHTML = head('Export and import', `Excel files for ${esc(d.workshop.name)}. The full export is also the import template.`) + `
  <div class="cols"><div class="panel"><h2>Export</h2>
    <p>Everything for this workshop, one sheet per table.</p><button class="btn primary" id="x_all">Download all data (.xlsx)</button>
    <p class="mt-lg">Report for ${periodLabel()}: summary by section, workload and the day-by-day roster.</p><button class="btn" id="x_rep">Download period report (.xlsx)</button></div>
  <div class="panel"><h2>Import</h2>${ed ? `<p>Pick an .xlsx file with the same sheet names and columns as the export. Only the sheets in the file are read.</p>
    <input type="file" id="imp" accept=".xlsx,.xls" aria-label="Excel file to import"><div class="mt-sm" id="imp_prev"></div>` : '<p class="hint">Only editors and admins can import.</p>'}
    <div class="explain mt-sm">Employees, exam types, sections, shift codes, teams, patterns and rules are added or updated by their key (employee number, section + asset + exam, name or code). Workload sets the count for each period. Time study replaces the elements of each exam in the file. Leave and status rows are added and exact duplicates skipped. Nothing is deleted unless you tick the option.</div></div></div>`;
  $('#x_all', el).onclick = () => exportAll().catch(fail);
  $('#x_rep', el).onclick = () => exportReport();
  if (ed) $('#imp', el).onchange = (e) => e.target.files[0] && previewImport(e.target.files[0], el);
}
function sheet(wb, name, rows, cols) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: cols });
  ws['!cols'] = cols.map((k) => ({ wch: Math.min(48, Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)) + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, name);
}
async function exportAll() {
  const d = wsData();
  const study = await q(sb.from('time_study').select('*').eq('workshop_id', S.ws).order('exam_type_id').order('sort'));
  const exM = {}; d.exam_types.forEach((x) => (exM[x.id] = x));
  const empM = {}; d.employees.forEach((e) => (empM[e.uid] = e));
  const wb = XLSX.utils.book_new();
  sheet(wb, 'Employees', d.employees.map((e) => ({ 'Employee No': e.emp_no, Name: e.name, Role: e.role, Team: (d.teamMap[e.team_id] || {}).code || '', Section: e.section_id ? secName(d, e.section_id) : '', 'Counted % (blank = auto)': e.hours_pct === null || e.hours_pct === undefined ? '' : Math.round(e.hours_pct * 100), Specialty: e.specialty || '', Skills: e.skills || '', 'Start Date': e.start_date || '', 'End Date': e.end_date || '', Status: e.status, 'Own Pattern': patName(d, e.pattern_main), 'Own Alternative Pattern': patName(d, e.pattern_alt), Notes: e.notes || '' })), COLS.Employees);
  if (d.month_plans.length) sheet(wb, 'Month Plans', d.month_plans.map((m) => ({ 'Employee No': (empM[m.employee_uid] || {}).emp_no, 'Employee Name': (empM[m.employee_uid] || {}).name, Month: String(m.month).slice(0, 7), 'Shift Hours': m.shift_hrs, ...Object.fromEntries(m.codes.map((c, i) => [String(i + 1), letterOf(c)])) })), ['Employee No', 'Employee Name', 'Month', 'Shift Hours', ...Array.from({ length: 31 }, (_, i) => String(i + 1))]);
  sheet(wb, 'Leave and Status', d.status_changes.map((c) => ({ 'Employee No': (empM[c.employee_uid] || {}).emp_no, 'Employee Name': (empM[c.employee_uid] || {}).name, Status: c.status_type, 'Shift Code (Custom only)': c.code || '', From: c.date_from, To: c.date_to, Notes: c.notes || '' })), COLS['Leave and Status']);
  sheet(wb, 'Exam Types', d.exam_types.map((x) => ({ Section: secName(d, x.section_id), Type: x.category, Asset: x.asset, Exam: x.exam, 'Std Man-hours': Number(x.hours), Crew: x.crew ?? '', 'Default per Week': x.default_weekly ?? '', Active: x.active ? 'Yes' : 'No', Order: x.sort })), COLS['Exam Types']);
  sheet(wb, 'Workload', [...d.counts].sort((a, b) => a.period_start.localeCompare(b.period_start)).map((c) => { const x = exM[c.exam_type_id] || {}; return { 'Period (Week/Month)': c.period_type === 'week' ? 'Week' : 'Month', 'Period Start': c.period_start, Section: secName(d, x.section_id), Asset: x.asset, Exam: x.exam, Planned: c.count ?? '', Actual: c.actual ?? '' }; }), COLS.Workload);
  sheet(wb, 'Time Study', study.map((t) => { const x = exM[t.exam_type_id] || {}; return { Section: secName(d, x.section_id), Asset: x.asset, Exam: x.exam, Element: t.element, 'Readings (min)': (t.readings || []).join(', '), 'Rating %': Number(t.rating_pct), Crew: t.crew, Order: t.sort }; }), COLS['Time Study']);
  sheet(wb, 'Sections', d.sections.map((s) => ({ Section: s.name, 'Sick Allowance %': Math.round(s.sick_pct * 1000) / 10, Order: s.sort })), COLS.Sections);
  sheet(wb, 'Shift Codes', d.shift_codes.map((c) => ({ Code: c.code, Description: c.description, 'Shift (8/12/-)': c.shift_type, 'Used For': c.status_type || '', 'Paid Hrs': Number(c.paid_hrs), 'Productive Hrs': Number(c.prod_hrs), 'OT Hrs': Number(c.ot_hrs), 'Staff Day (1/0)': c.staff_day })), COLS['Shift Codes']);
  sheet(wb, 'Teams', d.teams.map((t) => ({ 'Team Code': t.code, Name: t.name, Section: secName(d, t.section_id), Pattern: patName(d, t.pattern_main), 'Alternative Pattern': patName(d, t.pattern_alt) })), COLS.Teams);
  sheet(wb, 'Patterns', d.patterns.map((p) => ({ Pattern: p.name, Description: p.description || '', 'Shift Hours': p.shift_hrs, 'Cycle Start': p.cycle_start, 'Cycle (comma separated)': p.cycle.join(', ') })), COLS.Patterns);
  const s = d.settings;
  sheet(wb, 'Rules', [{ Setting: 'Team Leader counted %', Value: Math.round(s.tl_factor * 100) }, { Setting: '8hr productive hours per person per week', Value: Number(s.mp_div_8) }, { Setting: '12hr productive hours per person per week', Value: Number(s.mp_div_12) }], COLS.Rules);
  XLSX.writeFile(wb, `${d.workshop.short_name.replace(/\W+/g, '_')}_Manpower_Data_${today()}.xlsx`);
  toast('Download started', 'ok');
}
function exportReport() {
  const d = wsData(), R = result(d), wb = XLSX.utils.book_new(), T = R.tot;
  const sum = [[d.workshop.name + ', manpower plan'], [periodLabel() + (R.alt ? ', alternative roster' : '')], [],
    ['Section', 'Exams', 'Required h', 'Available h', 'Balance h', 'People needed', 'People available', 'Extra people', 'OT hours to close', 'Hours per person', 'Basis'],
    ...R.sections.map((s) => [s.section.name, s.exams, +s.required.toFixed(2), +s.available.toFixed(2), +s.balance.toFixed(2), +s.peopleNeeded.toFixed(2), +s.peopleHave.toFixed(2), +Math.max(0, -s.manpower).toFixed(2), +s.otNeeded.toFixed(2), +s.div.value.toFixed(2), s.div.text]),
    ['Total', T.exams, +T.required.toFixed(2), +T.available.toFixed(2), +T.balance.toFixed(2), +T.peopleNeeded.toFixed(2), +T.peopleHave.toFixed(2), +T.extraPeople.toFixed(2), +T.otNeeded.toFixed(2)], [],
    ['People on roster', T.headcount], ['Counted people', +T.fte.toFixed(2)], ['Staff days', T.staffDays], ['Paid hours', T.paid], ['Productive hours', +T.prod.toFixed(2)], ['Overtime hours', +T.ot.toFixed(2)]];
  const ws1 = XLSX.utils.aoa_to_sheet(sum); ws1['!cols'] = [{ wch: 26 }, ...Array(9).fill({ wch: 13 }), { wch: 40 }]; XLSX.utils.book_append_sheet(wb, ws1, 'Summary');
  const wk = [['Section', 'Asset', 'Exam', 'Std h', 'Count', 'Man-hours'], ...R.sections.flatMap((s) => s.work.filter((w) => w.count).map((w) => [s.section.name, w.exam.asset, w.exam.exam, Number(w.exam.hours), w.count, +w.hours.toFixed(2)]))];
  const ws2 = XLSX.utils.aoa_to_sheet(wk); ws2['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 11 }]; XLSX.utils.book_append_sheet(wb, ws2, 'Workload');
  const ro = [['Section', 'Team', 'No.', 'Name', 'Role', 'Counted %', ...R.days.map((x) => `${DOWS[Calc.dow(x)]} ${x.slice(5)}`), 'Staff days', 'Prod h', 'OT h'],
    ...R.sections.flatMap((s) => s.rows.map((r) => [s.section.name, (d.teamMap[r.emp.team_id] || {}).name || '', r.emp.emp_no, r.emp.name, r.emp.role, r.pct, ...r.cells.map((c) => c.code), r.staffDays, +r.prod.toFixed(2), +r.ot.toFixed(2)]))];
  const ws3 = XLSX.utils.aoa_to_sheet(ro); ws3['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 7 }, { wch: 26 }, { wch: 16 }, { wch: 9 }, ...R.days.map(() => ({ wch: 10 })), { wch: 10 }, { wch: 8 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Roster');
  XLSX.writeFile(wb, `${d.workshop.short_name.replace(/\W+/g, '_')}_Report_${pStart()}_${S.type}.xlsx`);
}
const cellDate = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  if (typeof v === 'number') { const x = XLSX.SSF.parse_date_code(v); return `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`; }
  const s = String(v).trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const dd = new Date(s); return isNaN(dd) ? null : Calc.iso(dd);
};
async function previewImport(file, el) {
  const box = $('#imp_prev', el);
  box.innerHTML = '<div class="hint">Reading the file…</div>';
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const found = Object.keys(COLS).filter((n) => wb.SheetNames.includes(n));
    if (!found.length) { box.innerHTML = `<p class="err">No known sheets in this file. Expected sheet names: ${Object.keys(COLS).join(', ')}.</p>`; return; }
    const data = {}; found.forEach((n) => (data[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' })));
    box.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Sheet</th><th class="num">Rows</th></tr></thead><tbody>${found.map((n) => `<tr><td>${n}</td><td class="num">${data[n].length}</td></tr>`).join('')}</tbody></table></div>
      ${data['Leave and Status'] ? '<label class="row mt-sm"><input type="checkbox" id="imp_rs"> Replace all leave and status records of this workshop with the file</label>' : ''}
      <div class="row mt-sm"><button class="btn primary" id="imp_go">Import into ${esc(wsData().workshop.short_name)}</button><span class="hint" id="imp_msg"></span></div>`;
    $('#imp_go', el).onclick = async () => {
      const btn = $('#imp_go', el); btn.disabled = true; $('#imp_msg', el).textContent = 'Importing…';
      try { const log = await runImport(data, { replaceStatus: $('#imp_rs', el) && $('#imp_rs', el).checked }); await refresh(); toast('Import finished', 'ok'); modal({ title: 'Import finished', body: `<ul class="m0 list">${log.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`, buttons: [{ label: 'Done', cls: 'primary' }] }); }
      catch (e) { fail(e); btn.disabled = false; $('#imp_msg', el).textContent = 'Import stopped: ' + e.message; }
    };
  } catch (e) { box.innerHTML = `<p class="err">Could not read the file: ${esc(e.message)}</p>`; }
}
async function runImport(data, opt) {
  const W = S.ws, log = [], yes = (v) => /^(yes|y|true|1)$/i.test(str(v));
  let d = wsData();
  const reload = async () => { await loadAll(); d = wsData(); };
  if (data.Rules) {
    const m = {}; data.Rules.forEach((r) => (m[str(r.Setting)] = r.Value)); const up = {};
    if (m['Team Leader counted %'] !== undefined) up.tl_factor = Number(m['Team Leader counted %']) / 100;
    if (m['8hr productive hours per person per week'] !== undefined) up.mp_div_8 = Number(m['8hr productive hours per person per week']);
    if (m['12hr productive hours per person per week'] !== undefined) up.mp_div_12 = Number(m['12hr productive hours per person per week']);
    if (Object.keys(up).length) { await q(sb.from('settings').update(up).eq('workshop_id', W)); log.push('Rules updated'); }
  }
  if (data.Sections) {
    let n = 0;
    for (const r of data.Sections.filter((r) => str(r.Section))) {
      const row = { workshop_id: W, name: str(r.Section), sick_pct: (Number(r['Sick Allowance %']) || 0) / 100, sort: Number(r.Order) || 0 };
      const ex = d.sections.find((s) => s.name === row.name);
      if (ex) await q(sb.from('sections').update(row).eq('id', ex.id)); else await q(sb.from('sections').insert(row)); n++;
    }
    log.push(`Sections: ${n} saved`); await reload();
  }
  if (data['Shift Codes']) {
    const seenC = new Set(); const rows = data['Shift Codes'].filter((r) => str(r.Code) && !seenC.has(newCode(W, str(r.Code))) && seenC.add(newCode(W, str(r.Code)))).map((r, i) => ({ workshop_id: W, code: newCode(W, str(r.Code)), description: str(r.Description) || str(r.Code), shift_type: ['8', '12'].includes(str(r['Shift (8/12/-)'])) ? str(r['Shift (8/12/-)']) : '-', status_type: str(r['Used For']) || null,
      paid_hrs: Number(r['Paid Hrs']) || 0, prod_hrs: Number(r['Productive Hrs']) || 0, ot_hrs: Number(r['OT Hrs']) || 0, staff_day: Number(r['Staff Day (1/0)']) ? 1 : 0, sort: i }));
    if (rows.length) await q(sb.from('shift_codes').upsert(rows)); log.push(`Shift codes: ${rows.length} saved`);
  }
  if (data.Patterns) {
    let n = 0;
    for (const r of data.Patterns.filter((r) => str(r.Pattern))) {
      const row = { workshop_id: W, name: str(r.Pattern), description: str(r.Description), shift_hrs: Number(r['Shift Hours']) === 12 ? 12 : 8, cycle_start: cellDate(r['Cycle Start']), cycle: str(r['Cycle (comma separated)']).split(',').map((x) => newCode(W, x.trim())).filter(Boolean) };
      if (!row.cycle_start || !row.cycle.length) continue;
      const ex = d.patterns.find((p) => p.name === row.name);
      if (ex) await q(sb.from('patterns').update(row).eq('id', ex.id)); else await q(sb.from('patterns').insert(row)); n++;
    }
    log.push(`Patterns: ${n} saved`); await reload();
  }
  const secId = (n) => (d.sections.find((s) => s.name === str(n)) || {}).id || null;
  const patId = (n) => (str(n) ? (d.patterns.find((p) => p.name === str(n)) || {}).id || null : null);
  if (data.Teams) {
    let n = 0, i = 0;
    for (const r of data.Teams.filter((r) => str(r['Team Code']))) {
      const row = { workshop_id: W, code: str(r['Team Code']), name: str(r.Name) || str(r['Team Code']), section_id: secId(r.Section), pattern_main: patId(r.Pattern), pattern_alt: patId(r['Alternative Pattern']), sort: ++i };
      const ex = d.teams.find((t) => t.code === row.code);
      if (ex) await q(sb.from('teams').update(row).eq('id', ex.id)); else await q(sb.from('teams').insert(row)); n++;
    }
    log.push(`Teams: ${n} saved`); await reload();
  }
  if (data.Employees) {
    let add = 0, upd = 0;
    const rows = data.Employees.filter((r) => str(r['Employee No']) && str(r.Name)).map((r) => {
      const p = str(r['Counted % (blank = auto)']);
      return { workshop_id: W, emp_no: str(r['Employee No']), name: str(r.Name), role: str(r.Role) || 'Technician', team_id: (d.teams.find((t) => t.code === str(r.Team)) || {}).id || null, section_id: secId(r.Section),
        hours_pct: p === '' ? null : (Number(p) > 1 ? Number(p) / 100 : Number(p)), specialty: str(r.Specialty) || null, skills: str(r.Skills) || null, start_date: cellDate(r['Start Date']), end_date: cellDate(r['End Date']),
        status: ['Active', 'Pending', 'Excluded'].find((s) => s.toLowerCase() === str(r.Status).toLowerCase()) || 'Active', pattern_main: patId(r['Own Pattern']), pattern_alt: patId(r['Own Alternative Pattern']), notes: str(r.Notes) || null };
    });
    const before = new Set(d.employees.map((e) => e.emp_no));
    rows.forEach((r) => (before.has(r.emp_no) ? upd++ : add++));
    if (rows.length) await q(sb.from('employees').upsert(rows, { onConflict: 'workshop_id,emp_no' }));
    log.push(`Employees: ${add} added, ${upd} updated`); await reload();
  }
  if (data['Exam Types']) {
    let add = 0, upd = 0;
    for (const r of data['Exam Types'].filter((r) => str(r.Asset) && str(r.Exam))) {
      const row = { workshop_id: W, section_id: secId(r.Section), category: ['Planned', 'Corrective', 'Job'].find((c) => c.toLowerCase() === str(r.Type).toLowerCase()) || 'Planned', asset: str(r.Asset), exam: str(r.Exam),
        hours: Number(r['Std Man-hours']) || 0, crew: str(r.Crew) === '' ? null : Number(r.Crew), default_weekly: str(r['Default per Week']) === '' ? null : Number(r['Default per Week']), active: str(r.Active) === '' ? true : yes(r.Active), sort: Number(r.Order) || 0 };
      const ex = d.exam_types.find((x) => x.section_id === row.section_id && x.asset === row.asset && x.exam === row.exam);
      if (ex) { await q(sb.from('exam_types').update(row).eq('id', ex.id)); upd++; } else { await q(sb.from('exam_types').insert(row)); add++; }
    }
    log.push(`Exam types: ${add} added, ${upd} updated`); await reload();
  }
  const findEx = (r) => d.exam_types.find((x) => x.asset === str(r.Asset) && x.exam === str(r.Exam) && (!str(r.Section) || secName(d, x.section_id) === str(r.Section)));
  if (data.Workload) {
    const rows = []; let miss = 0;
    data.Workload.forEach((r) => {
      const ex = findEx(r), ps = cellDate(r['Period Start']);
      if (!ex || !ps) { miss++; return; }
      const type = /week/i.test(str(r['Period (Week/Month)'])) ? 'week' : 'month';
      const pv = str(r.Planned !== undefined ? r.Planned : r.Count), av = str(r.Actual);
      rows.push({ workshop_id: W, period_type: type, period_start: Calc.periodStart(type, ps), exam_type_id: ex.id, count: pv === '' ? null : Number(pv), actual: av === '' ? null : Number(av) });
    });
    if (rows.length) await q(sb.from('workload_counts').upsert(rows));
    log.push(`Workload: ${rows.length} counts saved${miss ? `, ${miss} rows skipped (unknown exam or date)` : ''}`);
  }
  if (data['Time Study']) {
    const by = {}; let miss = 0;
    data['Time Study'].forEach((r, i) => {
      const ex = findEx(r); if (!ex || !str(r.Element)) { miss++; return; }
      (by[ex.id] = by[ex.id] || []).push({ workshop_id: W, exam_type_id: ex.id, element: str(r.Element), readings: str(r['Readings (min)']).split(/[,;\s]+/).map(Number).filter((x) => !isNaN(x) && x > 0), rating_pct: Number(r['Rating %']) || 100, crew: Math.max(1, Number(r.Crew) || 1), sort: Number(r.Order) || i });
    });
    for (const id of Object.keys(by)) { await q(sb.from('time_study').delete().eq('exam_type_id', +id)); await q(sb.from('time_study').insert(by[id])); }
    S.studyCache = {};
    log.push(`Time study: ${Object.keys(by).length} exams replaced${miss ? `, ${miss} rows skipped` : ''}`);
  }
  if (data['Leave and Status']) {
    let existing = d.status_changes;
    if (opt.replaceStatus) { await q(sb.from('status_changes').delete().eq('workshop_id', W)); existing = []; log.push('All earlier leave and status records of this workshop removed'); }
    const key = (c) => [c.employee_uid, c.status_type, c.code || '', c.date_from, c.date_to].join('|');
    const have = new Set(existing.map(key)), rows = []; let skip = 0, bad = 0;
    data['Leave and Status'].forEach((r) => {
      const t = STATUS_TYPES.find((x) => x.toLowerCase() === str(r.Status).toLowerCase());
      const emp = d.employees.find((e) => e.emp_no === str(r['Employee No']));
      const row = { workshop_id: W, employee_uid: emp && emp.uid, status_type: t, code: t === 'Custom' ? newCode(W, str(r['Shift Code (Custom only)'])) : null, date_from: cellDate(r.From), date_to: cellDate(r.To), notes: str(r.Notes) || null, created_by: S.me.username };
      if (!t || !emp || !row.date_from || !row.date_to || row.date_to < row.date_from || (t === 'Custom' && !row.code)) { bad++; return; }
      if (have.has(key(row))) { skip++; return; }
      have.add(key(row)); rows.push(row);
    });
    if (rows.length) await q(sb.from('status_changes').insert(rows));
    log.push(`Leave and status: ${rows.length} added, ${skip} duplicates skipped${bad ? `, ${bad} rows with errors skipped` : ''}`);
  }
  return log;
}

const VIEWS = { dashboard: viewDashboard, workload: viewWorkload, roster: viewRoster, employees: viewEmployees, timestudy: viewTimeStudy, settings: viewSettings, data: viewData, users: viewUsers, log: viewLog };
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && S.me) { S.me = null; showLogin('You were signed out.'); } });
boot();
})();
