/* DMM Workshops — Manpower Plan */
(() => {
'use strict';
const CFG = window.APP_CONFIG;
const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true } });
const EMAIL_DOMAIN = '@dmm-mp.local';
const STATUS_TYPES = ['Annual Leave', 'Planned Leave', 'Sick', 'Training', 'Overtime', 'Absent', 'Custom'];
const ROLES = ['Technician', 'Senior Technician', 'Team Leader', 'Foreman', 'Office', 'Data Entry', 'Tools Office'];
const TABLES = ['workshops', 'settings', 'sections', 'shift_codes', 'patterns', 'teams', 'employees', 'status_changes', 'exam_types', 'workload_counts'];

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
    exam_types: f('exam_types').sort((a, b) => a.sort - b.sort || a.id - b.id),
  });
  const teamSort = (e) => { const t = d.teamMap[e.team_id]; return t ? t.sort : 999; };
  d.employees.sort((a, b) => teamSort(a) - teamSort(b) || (roleRank[a.role] ?? 3) - (roleRank[b.role] ?? 3) || a.name.localeCompare(b.name));
  d.counts = S.all.workload_counts.filter((c) => c.workshop_id === id);
  S.cache[id] = d;
  return d;
}
function countsFor(d, type, start) {
  const o = {};
  d.counts.filter((c) => c.period_type === type && c.period_start === start).forEach((c) => (o[c.exam_type_id] = Number(c.count)));
  return o;
}
function result(d = wsData(), type = S.type, start = pStart(), alt = S.alt) {
  const st = Calc.periodStart(type, start);
  return Calc.compute(d, { alt: alt && d.hasAlt, type, start: st, counts: countsFor(d, type, st) });
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
    const ov = modal({ title, body: `<p style="margin:0">${text}</p>`, buttons: [
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
const TRACK_SVG = `<svg viewBox="0 0 600 170" preserveAspectRatio="none" aria-hidden="true"><g stroke="rgba(255,255,255,.22)" stroke-width="3" fill="none"><path d="M-20 160 L620 40"/><path d="M-20 175 L620 70"/></g><g stroke="rgba(255,255,255,.14)" stroke-width="6">${Array.from({ length: 22 }, (_, i) => { const x = -10 + i * 30, y = 166 - i * 5.6; return `<path d="M${x} ${y + 12} L${x + 8} ${y - 26}"/>`; }).join('')}</g></svg>`;
function showLogin(msg = '') {
  $('#app').innerHTML = `<div class="login-wrap">
    <div class="login-side"><div style="position:relative"><h1>Workshop manpower plan</h1><p>Man-hours needed for the planned exams against the hours the roster can give, for every DMM workshop.</p></div>
      <div class="org">Saudi Arabia Railways · Dammam workshops</div>${TRACK_SVG}</div>
    <div class="login-form"><form id="loginForm" autocomplete="on">
      <h2>Sign in</h2>
      <label class="f">Username<input type="text" id="lu" autocomplete="username" autocapitalize="none" required></label>
      <label class="f">Password<input type="password" id="lp" autocomplete="current-password" required></label>
      <div class="err" id="lerr" role="alert">${esc(msg)}</div>
      <button class="btn primary" type="submit" style="justify-content:center;padding:10px">Sign in</button>
      <p class="hint" style="margin:0">Each workshop manager signs in to their own workshop. Ask the admin for an account.</p>
    </form></div></div>`;
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
const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  dashboard: '<path d="M3 20h18M6 16V9M11 16V5M16 16v-5M21 16V8"/>',
  workload: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  roster: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  employees: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6M16 4a3.5 3.5 0 010 7M19 20c0-2.5-1-4.5-3-5.5"/>',
  timestudy: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  data: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  users: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  log: '<path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/>',
};
const NAV = [
  ['overview', 'All workshops', 'multi'], ['dashboard', 'Dashboard'], ['workload', 'Workload'], ['roster', 'Roster and leave'], ['employees', 'Employees'],
  ['timestudy', 'Time study'], '-', ['settings', 'Settings'], ['data', 'Export and import'], ['users', 'Users', 'admin'], ['log', 'Activity'],
];
function shellHTML() {
  const nav = NAV.map((n) => {
    if (n === '-') return '<div class="grp">Setup</div>';
    if (n[2] === 'admin' && !isAdmin()) return '';
    if (n[2] === 'multi' && !multiWs()) return '';
    return `<a href="#${n[0]}" data-nav="${n[0]}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n[0]]}</svg>${n[1]}</a>`;
  }).join('');
  const roleText = { admin: 'Admin', editor: 'Can edit', viewer: 'View only' }[S.me.role];
  return `<div class="shell"><aside class="rail" id="rail">
      <div class="brand"><div class="mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M4 20L20 4M8 20L20 8"/><path d="M6 14l4 4M10 10l4 4M14 6l4 4" stroke-width="1.5"/></svg>Manpower plan</div><small>DMM workshops</small></div>
      <nav id="nav">${nav}</nav>
      <div class="me"><b>${esc(S.me.display_name || S.me.username)}</b><span>${roleText}${S.me.workshop_id ? ', ' + esc((S.all.workshops.find((w) => w.id === S.me.workshop_id) || {}).short_name || '') : ', all workshops'}</span>
        <div class="row"><button id="pwBtn">Change password</button><button id="outBtn">Sign out</button></div></div>
    </aside>
    <div class="main"><div class="context" id="ctx"></div><div class="page" id="view"></div></div></div>`;
}
function bindShell() {
  $('#outBtn').onclick = async () => { await sb.auth.signOut(); S.me = null; showLogin(); };
  $('#pwBtn').onclick = changeMyPassword;
  $$('#nav a').forEach((a) => a.addEventListener('click', () => $('#rail').classList.remove('open')));
}
function route() {
  let v = (location.hash || '').slice(1);
  if (!VIEWS[v]) v = multiWs() ? 'overview' : 'dashboard';
  if (v === 'users' && !isAdmin()) v = 'dashboard';
  if (v === 'overview' && !multiWs()) v = 'dashboard';
  S.view = v; render();
}
window.addEventListener('hashchange', () => { if (S.me && S.all) route(); });
const PERIOD_VIEWS = ['overview', 'dashboard', 'workload', 'roster', 'data'];
function render() {
  if (!S.me || !S.all) return;
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === S.view));
  renderContext();
  const el = $('#view');
  if (!S.all.workshops.length) { el.innerHTML = '<div class="note warn">No workshop is linked to this account yet. Ask the admin.</div>'; return; }
  try { VIEWS[S.view](el); } catch (e) { fail(e); el.innerHTML = `<div class="note warn">Something went wrong: ${esc(e.message)}</div>`; }
  window.scrollTo({ top: 0 });
}
function renderContext() {
  const c = $('#ctx');
  const ws = S.all.workshops;
  const showWs = S.view !== 'overview' && S.view !== 'users' && S.view !== 'log';
  const d = showWs ? wsData() : null;
  c.innerHTML = `<button class="menu-btn" id="menuBtn" aria-label="Menu">☰</button>
    ${showWs ? `<div class="ws-pick">${multiWs() && ws.length > 1 ? `<label class="hidden" for="wsSel">Workshop</label><select id="wsSel">${ws.map((w) => `<option value="${w.id}" ${w.id === S.ws ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>` : `<span class="ws-name">${esc(d.workshop.name)}</span>`}</div>` : `<div class="ws-pick"><span class="ws-name">${S.view === 'overview' ? 'All workshops' : S.view === 'users' ? 'Users' : 'Activity'}</span></div>`}
    <div class="spacer"></div>
    ${PERIOD_VIEWS.includes(S.view) ? `
      ${d && d.hasAlt && S.view !== 'data' ? `<div class="seg" role="group" aria-label="Roster option"><button data-alt="0" class="${!S.alt ? 'on' : ''}">Current roster</button><button data-alt="1" class="${S.alt ? 'on' : ''}">Alternative roster</button></div>` : ''}
      <div class="seg" role="group" aria-label="Period"><button data-type="week" class="${S.type === 'week' ? 'on' : ''}">Week</button><button data-type="month" class="${S.type === 'month' ? 'on' : ''}">Month</button></div>
      <div class="period"><button class="icon-btn" data-p="-1" aria-label="Previous">‹</button><span class="label">${periodLabel()}</span><button class="icon-btn" data-p="1" aria-label="Next">›</button>
      <button class="btn sm" data-p="0">Today</button><input type="date" id="jump" value="${pStart()}" aria-label="Go to date"></div>` : ''}
    <button class="icon-btn" id="reload" title="Reload from server" aria-label="Reload">↻</button>`;
  $('#menuBtn', c).onclick = () => $('#rail').classList.toggle('open');
  const sel = $('#wsSel', c); if (sel) sel.onchange = () => { S.ws = sel.value; store('mp_ws', S.ws); S.alt = false; S.section = ''; S.studyExam = null; render(); };
  $$('[data-alt]', c).forEach((b) => (b.onclick = () => { S.alt = b.dataset.alt === '1'; render(); }));
  $$('[data-type]', c).forEach((b) => (b.onclick = () => { S.type = b.dataset.type; render(); }));
  $$('[data-p]', c).forEach((b) => (b.onclick = () => { const n = +b.dataset.p; S.start = n === 0 ? today() : Calc.shiftPeriod(S.type, S.start, n); render(); }));
  const j = $('#jump', c); if (j) j.onchange = () => { if (j.value) { S.start = j.value; render(); } };
  $('#reload', c).onclick = () => refresh().then(() => toast('Data reloaded')).catch(fail);
}
function head(title, sub, right = '') { return `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="grow"></div>${right}</div>`; }

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
// OVERVIEW (all workshops)
// =====================================================================
function viewOverview(el) {
  const rows = S.all.workshops.map((w) => ({ w, r: result(wsData(w.id), S.type, pStart(), false) }));
  const T = rows.reduce((a, x) => ({ req: a.req + x.r.tot.required, av: a.av + x.r.tot.available, mp: a.mp + x.r.tot.manpower, ex: a.ex + x.r.tot.extraPeople, ot: a.ot + x.r.tot.otNeeded, hc: a.hc + x.r.tot.headcount }), { req: 0, av: 0, mp: 0, ex: 0, ot: 0, hc: 0 });
  el.innerHTML = head('All workshops', `Workload against roster capacity for ${periodLabel()}. Open a workshop for its roster and details.`) + `
  <div class="stats">
    <div class="stat"><div class="t">Required man-hours</div><div class="n">${fmt0(T.req)}</div></div>
    <div class="stat"><div class="t">Available man-hours</div><div class="n">${fmt0(T.av)}</div></div>
    <div class="stat"><div class="t">Balance</div><div class="n ${T.av - T.req < 0 ? 'neg' : 'pos'}">${signed(T.av - T.req, fmt0)} h</div></div>
    <div class="stat"><div class="t">Extra people needed</div><div class="n ${T.ex > 0 ? 'neg' : ''}">${fmt(T.ex)}</div><div class="s">in sections that are short</div></div>
    <div class="stat"><div class="t">People on the rosters</div><div class="n">${fmt0(T.hc)}</div></div>
  </div>
  <div class="ws-cards">${rows.map(({ w, r }) => { const t = r.tot, load = t.available ? t.required / t.available : 0; return `
    <button class="ws-card" data-ws="${w.id}"><h3>${esc(w.name)}</h3>
      <div class="big ${t.balance < 0 ? 'neg' : 'pos'}">${signed(t.balance, fmt0)} h</div>
      <div class="minibar" title="Load ${pct(load)}"><i class="${load > 1 ? 'over' : ''}" style="width:${Math.min(100, load * 100)}%"></i></div>
      <div class="line"><span>Required / available</span><b>${fmt0(t.required)} / ${fmt0(t.available)} h</b></div>
      <div class="line"><span>Load</span><b>${pct(load)}</b></div>
      <div class="line"><span>Extra people to close the work</span><b class="${t.extraPeople > 0 ? 'neg' : ''}">${fmt(t.extraPeople)}</b></div>
      <div class="line"><span>People on roster</span><b>${t.headcount}</b></div>
    </button>`; }).join('')}</div>
  <div class="panel"><div class="phead"><h2>By section</h2></div><div class="tbl-wrap"><table><thead><tr><th>Workshop</th><th>Section</th><th class="num">Required h</th><th class="num">Available h</th><th class="num">Balance h</th><th class="num">People needed</th><th class="num">Extra people</th><th class="num">or OT h</th></tr></thead><tbody>
    ${rows.map(({ w, r }) => r.sections.filter((s) => s.required || s.available).map((s) => `<tr><td>${esc(w.short_name)}</td><td>${esc(s.section.name)}</td><td class="num">${fmt0(s.required)}</td><td class="num">${fmt0(s.available)}</td>
      <td class="num ${s.balance < 0 ? 'neg' : 'pos'}">${signed(s.balance, fmt0)}</td><td class="num">${fmt(s.peopleNeeded)}</td><td class="num ${s.manpower < 0 ? 'neg' : ''}">${s.manpower < 0 ? fmt(-s.manpower) : '–'}</td><td class="num">${s.otNeeded ? fmt0(s.otNeeded) : '–'}</td></tr>`).join('')).join('')}
  </tbody></table></div></div>`;
  $$('[data-ws]', el).forEach((b) => (b.onclick = () => { S.ws = b.dataset.ws; store('mp_ws', S.ws); location.hash = 'dashboard'; }));
}

// =====================================================================
// DASHBOARD
// =====================================================================
function closeTable(R, d) {
  const secs = R.sections.filter((s) => s.required || s.available || s.rows.some((r) => r.pct > 0));
  return `<div class="tbl-wrap"><table><thead><tr><th>Section</th><th class="num">Exams</th><th class="num">Required h</th><th class="num">Available h</th><th class="num">Balance h</th><th class="num">People needed</th><th class="num">People available</th><th class="num">Extra people</th><th class="num">or OT hours</th></tr></thead><tbody>
    ${secs.map((s) => `<tr><td>${esc(s.section.name)}${s.sick ? `<span class="sub-line">less ${pct(s.sick)} sick allowance</span>` : ''}</td><td class="num">${fmt0(s.exams)}</td><td class="num">${fmt(s.required)}</td><td class="num">${fmt(s.available)}</td>
      <td class="num ${s.balance < 0 ? 'neg' : 'pos'}">${signed(s.balance)}</td><td class="num">${fmt(s.peopleNeeded)}</td><td class="num">${fmt(s.peopleHave)}</td>
      <td class="num">${s.manpower < 0 ? `<span class="pill bad">${fmt(-s.manpower)}</span>` : '<span class="pill good">none</span>'}</td><td class="num">${s.otNeeded ? fmt0(s.otNeeded) : '–'}</td></tr>`).join('')}
    ${secs.length > 1 ? `<tr class="total"><td>Workshop</td><td class="num">${fmt0(R.tot.exams)}</td><td class="num">${fmt(R.tot.required)}</td><td class="num">${fmt(R.tot.available)}</td><td class="num ${R.tot.balance < 0 ? 'neg' : 'pos'}">${signed(R.tot.balance)}</td><td class="num">${fmt(R.tot.peopleNeeded)}</td><td class="num">${fmt(R.tot.peopleHave)}</td><td class="num">${fmt(R.tot.extraPeople)}</td><td class="num">${R.tot.otNeeded ? fmt0(R.tot.otNeeded) : '–'}</td></tr>` : ''}
  </tbody></table></div>
  <p class="hint" style="margin:8px 0 0">People needed = required hours ÷ hours one full-time person gives in the period. Extra people = people needed − people available. Instead of extra people the same gap can be closed with the overtime hours shown.</p>`;
}
function viewDashboard(el) {
  const d = wsData(), R = result(d), T = R.tot;
  const noun = periodNoun();
  const short = T.balance < 0;
  const say = !T.required ? `No workload is entered for ${noun} yet. The roster gives <b>${fmt0(T.available)} man-hours</b>.`
    : short ? `${noun[0].toUpperCase() + noun.slice(1)} needs <b>${fmt0(T.required)} man-hours</b>. The roster gives ${fmt0(T.available)}, so you are <b>${fmt0(-T.balance)} hours short</b>.`
      : `${noun[0].toUpperCase() + noun.slice(1)} needs <b>${fmt0(T.required)} man-hours</b>. The roster gives ${fmt0(T.available)}, leaving <b>${fmt0(T.balance)} hours spare</b>.`;
  const load = T.available ? T.required / T.available : 0;
  const outlook = Array.from({ length: 6 }, (_, i) => { const st = Calc.shiftPeriod(S.type, pStart(), i); return { start: st, r: result(d, S.type, st) }; });
  const work = R.sections.flatMap((s) => s.work.filter((w) => w.count > 0).map((w) => ({ ...w, sec: s.section.name })));
  el.innerHTML = `
  <section class="hero" aria-label="Summary">
    <div style="position:relative;z-index:1"><p class="say">${say}</p>
      <p class="sub">${heroSub(R)}</p>
      <div class="track"><div class="bar"><div class="fill" style="width:${Math.min(100, load * 100)}%"></div>${load > 1 ? `<div class="over" style="left:${100 / load}%;right:0"></div>` : ''}</div>
        <div class="legend2"><span>Load ${pct(load)} of available hours</span><span>${periodLabel()}</span></div></div></div>
    <div class="figs">
      <div class="fig"><div class="n">${fmt0(T.required)}</div><div class="t">man-hours required</div></div>
      <div class="fig"><div class="n">${fmt0(T.available)}</div><div class="t">man-hours available</div></div>
      <div class="fig ${T.extraPeople > 0 ? 'bad' : 'good'}"><div class="n">${T.extraPeople > 0 ? fmt(T.extraPeople) : '0'}</div><div class="t">extra people needed</div></div>
      <div class="fig ${T.otNeeded > 0 ? 'bad' : 'good'}"><div class="n">${fmt0(T.otNeeded)}</div><div class="t">overtime hours to close it</div></div>
    </div>
  </section>
  <div class="stats">
    <div class="stat"><div class="t">People on roster</div><div class="n">${T.headcount}</div><div class="s">${fmt2(T.fte)} counted</div></div>
    <div class="stat"><div class="t">Productive hours</div><div class="n">${fmt0(T.prod)}</div><div class="s">plus ${fmt0(T.ot)} overtime</div></div>
    <div class="stat"><div class="t">Staff days</div><div class="n">${fmt0(T.staffDays)}</div></div>
    <div class="stat"><div class="t">Paid hours</div><div class="n">${fmt0(T.paid)}</div></div>
    <div class="stat"><div class="t">Exams planned</div><div class="n">${fmt0(T.exams)}</div></div>
  </div>
  <div class="panel"><div class="phead"><h2>What it takes to close ${noun === 'this week' ? 'this week' : noun}</h2><div class="grow"></div><a class="btn sm" href="#workload">Edit workload</a></div>${closeTable(R, d)}</div>
  <div class="cols">
    <div class="panel"><div class="phead"><h2>Next 6 ${S.type === 'week' ? 'weeks' : 'months'}</h2></div>${outlookChart(outlook)}
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>${S.type === 'week' ? 'Week of' : 'Month'}</th><th class="num">Required</th><th class="num">Available</th><th class="num">Balance</th><th class="num">Extra people</th></tr></thead><tbody>
      ${outlook.map((o) => `<tr><td>${S.type === 'week' ? dlabel(o.start) : MONTHS[+o.start.slice(5, 7) - 1] + ' ' + o.start.slice(0, 4)}</td><td class="num">${fmt0(o.r.tot.required)}</td><td class="num">${fmt0(o.r.tot.available)}</td>
        <td class="num ${o.r.tot.balance < 0 ? 'neg' : 'pos'}">${signed(o.r.tot.balance, fmt0)}</td><td class="num">${o.r.tot.extraPeople ? fmt(o.r.tot.extraPeople) : '–'}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><div class="phead"><h2>Workload this period</h2></div>${work.length ? `<div class="tbl-wrap"><table><thead><tr><th>Exam</th><th class="num">Std h</th><th class="num">Count</th><th class="num">Man-hours</th></tr></thead><tbody>
      ${work.map((w) => `<tr><td>${esc(w.exam.asset)} ${esc(w.exam.exam)}<span class="sub-line">${esc(w.sec)}${w.auto ? ', default weekly rate' : ''}</span></td><td class="num">${fmt2(w.exam.hours)}</td><td class="num">${fmt0(w.count)}</td><td class="num">${fmt(w.hours)}</td></tr>`).join('')}
      <tr class="total"><td colspan="2">Total</td><td class="num">${fmt0(T.exams)}</td><td class="num">${fmt(T.required)}</td></tr></tbody></table></div>` : `<p class="hint">No exams entered for ${noun}. <a href="#workload">Enter the workload</a>.</p>`}
      ${explainBlock(R, d)}</div>
  </div>`;
}
function heroSub(R) {
  const T = R.tot;
  if (!T.required) return 'Enter the planned exams on the Workload page to see the gap.';
  const shortSecs = R.sections.filter((s) => s.manpower < 0);
  if (!shortSecs.length) return 'The roster covers all the planned work.';
  const list = shortSecs.map((s) => `${s.section.name} needs ${fmt(-s.manpower)} more ${-s.manpower === 1 ? 'person' : 'people'} or ${fmt0(s.otNeeded)} overtime hours`).join('; ');
  if (shortSecs.length === R.sections.filter((s) => s.required || s.available).length || R.sections.length === 1) return `To close the work you need about ${fmt(T.extraPeople)} more ${T.extraPeople === 1 ? 'person' : 'people'} on the roster, or ${fmt0(T.otNeeded)} overtime hours.`;
  return `There are spare hours overall, but hours do not move between sections: ${list}.`;
}
function explainBlock(R, d) {
  const s = R.sections.find((x) => x.required || x.available) || R.sections[0];
  if (!s) return '';
  return `<details style="margin-top:14px"><summary class="hint" style="cursor:pointer">How the numbers are worked out</summary><div class="explain" style="margin-top:8px"><table>
    <tr><td>Required</td><td>Σ exams × standard man-hours per exam</td></tr>
    <tr><td>Available</td><td>Σ for every person and day: productive hours of the shift × counted % (+ overtime)${s.sick ? ', less the section sick allowance' : ''}</td></tr>
    <tr><td>Counted %</td><td>Technician 100%, Team Leader ${pct(Number(d.settings.tl_factor))} unless set on the person, Foreman and office 0%. Leave, sick, training and absence give 0 hours.</td></tr>
    <tr><td>One person</td><td>${esc(s.div.text)} = <b>${fmt(s.div.value)} h</b> in ${esc(s.section.name)}</td></tr>
    <tr><td>People needed</td><td>${fmt(s.required)} ÷ ${fmt(s.div.value)} = <b>${fmt2(s.peopleNeeded)}</b></td></tr>
    <tr><td>Extra people</td><td>(${fmt(s.required)} − ${fmt(s.available)}) ÷ ${fmt(s.div.value)} = <b>${fmt2(-s.manpower)}</b></td></tr>
  </table></div></details>`;
}
function outlookChart(list) {
  const W = 600, H = 200, pad = 40, bw = 22;
  const max = Math.max(1, ...list.flatMap((o) => [o.r.tot.required, o.r.tot.available]));
  const step = (W - pad - 10) / list.length;
  const y = (v) => H - 26 - (v / max) * (H - 50);
  let s = `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Required against available man-hours">`;
  [0, 0.5, 1].forEach((f) => { const yy = y(max * f); s += `<line x1="${pad}" x2="${W - 6}" y1="${yy}" y2="${yy}" stroke="#E2E8ED"/><text x="${pad - 6}" y="${yy + 4}" text-anchor="end">${fmt0(max * f)}</text>`; });
  list.forEach((o, i) => {
    const x = pad + i * step + step / 2, t = o.r.tot;
    s += `<rect x="${x - bw - 1}" y="${y(t.available)}" width="${bw}" height="${H - 26 - y(t.available)}" fill="#DCEFF8" stroke="#1976A3"><title>Available ${fmt0(t.available)} h</title></rect>`;
    s += `<rect x="${x + 1}" y="${y(t.required)}" width="${bw}" height="${H - 26 - y(t.required)}" fill="#0B4F79"><title>Required ${fmt0(t.required)} h</title></rect>`;
    s += `<text x="${x}" y="${H - 9}" text-anchor="middle">${S.type === 'week' ? dlabel(o.start).replace(/ \d{4}$/, '') : MONTHS[+o.start.slice(5, 7) - 1]}</text>`;
    s += `<text x="${x}" y="${Math.min(y(t.required), y(t.available)) - 6}" text-anchor="middle" style="fill:${t.balance < 0 ? '#D62828' : '#1F9D55'};font-weight:600">${signed(t.balance, fmt0)}</text>`;
  });
  return s + `</svg></div><div class="legend"><span><i style="background:#DCEFF8;border-color:#1976A3"></i>Available</span><span><i style="background:#0B4F79;border-color:#0B4F79"></i>Required</span><span>Figures above the bars are the balance in hours</span></div>`;
}

// =====================================================================
// WORKLOAD
// =====================================================================
function viewWorkload(el) {
  const d = wsData(), st = pStart(), counts = countsFor(d, S.type, st), days = Calc.periodDays(S.type, st);
  const ed = canEdit();
  const R = result(d);
  const secs = d.sections.map((s) => ({ s, ex: d.exam_types.filter((x) => x.active && x.section_id === s.id) })).filter((g) => g.ex.length);
  const orphan = d.exam_types.filter((x) => x.active && !x.section_id);
  if (orphan.length) secs.push({ s: { id: null, name: 'No section' }, ex: orphan });
  el.innerHTML = head('Workload', `Exams planned for ${periodLabel()}. Man-hours = count × standard hours from the time study. Weekly and monthly counts are kept apart.`) + `
  <div class="panel"><div class="tbl-wrap"><table id="wl"><thead><tr><th>Exam</th><th class="num">Std man-h</th><th class="num">Crew</th><th class="num">Count</th><th class="num">Man-hours</th></tr></thead><tbody>
  ${secs.map((g) => `<tr class="group"><td colspan="5">${esc(g.s.name)}</td></tr>` + g.ex.map((x) => {
    const c = Calc.examCount(x, S.type, days, counts);
    return `<tr data-id="${x.id}" data-h="${x.hours}" data-auto="${c.auto ? c.n : ''}"><td>${esc(x.asset)} <b>${esc(x.exam)}</b>${x.category !== 'Planned' ? ` <span class="pill muted">${esc(x.category)}</span>` : ''}${x.default_weekly ? `<span class="sub-line">Default ${fmt(x.default_weekly)} a week when no count is entered</span>` : ''}</td>
      <td class="num">${fmt2(x.hours)}</td><td class="num">${x.crew ? fmt(x.crew) : ''}</td>
      <td class="num"><input type="number" min="0" step="1" value="${counts[x.id] ?? ''}" placeholder="${c.auto ? c.n : ''}" aria-label="Count for ${esc(x.asset + ' ' + x.exam)}" ${ed ? '' : 'disabled'}></td><td class="num mh"></td></tr>`;
  }).join('')).join('')}
  <tr class="total"><td colspan="3">Total</td><td class="num" id="wl_n"></td><td class="num" id="wl_h"></td></tr></tbody></table></div>
  <div class="row" style="margin-top:14px">${ed ? `<button class="btn primary" id="wl_save">Save workload</button><button class="btn" id="wl_copy">Copy previous ${S.type}</button><button class="btn ghost" id="wl_clear">Clear</button>` : '<span class="hint">View only.</span>'}
  <span class="hint">Change standard hours in Time study or Settings.</span></div></div>
  <div class="panel"><div class="phead"><h2>What it takes to close this workload</h2><span class="hint">Saved figures</span></div>${closeTable(R, d)}</div>`;
  const tbody = $('#wl tbody', el);
  const calc = () => {
    let n = 0, h = 0;
    $$('tr[data-id]', tbody).forEach((tr) => { const i = $('input', tr); const c = i.value === '' ? (+tr.dataset.auto || 0) : +i.value || 0; const mh = c * +tr.dataset.h; n += c; h += mh; $('.mh', tr).textContent = c ? fmt(mh) : ''; });
    $('#wl_n', el).textContent = fmt0(n); $('#wl_h', el).textContent = fmt(h);
  };
  $$('input', tbody).forEach((i) => (i.oninput = calc)); calc();
  if (!ed) return;
  $('#wl_save', el).onclick = async () => {
    try {
      const rows = $$('tr[data-id]', tbody).map((tr) => ({ v: $('input', tr).value, id: +tr.dataset.id }));
      const keep = rows.filter((r) => r.v !== '').map((r) => ({ workshop_id: S.ws, period_type: S.type, period_start: st, exam_type_id: r.id, count: +r.v || 0 }));
      const drop = rows.filter((r) => r.v === '').map((r) => r.id);
      if (keep.length) await q(sb.from('workload_counts').upsert(keep));
      if (drop.length) await q(sb.from('workload_counts').delete().eq('period_type', S.type).eq('period_start', st).in('exam_type_id', drop));
      await refresh(); toast('Workload saved', 'ok');
    } catch (e) { fail(e); }
  };
  $('#wl_copy', el).onclick = () => { const prev = countsFor(d, S.type, Calc.shiftPeriod(S.type, st, -1)); $$('tr[data-id]', tbody).forEach((tr) => { $('input', tr).value = prev[tr.dataset.id] ?? ''; }); calc(); toast('Copied. Press Save workload to keep it.'); };
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
  const body = show.map((s) => `<tr class="group"><td class="left" colspan="2">${esc(s.section.name)}</td><td colspan="${R.days.length + 3}" style="text-align:left;font-family:var(--font);font-size:12.5px;color:var(--muted);font-weight:400">${fmt0(s.prod)} productive h · ${s.headcount} people</td></tr>` + s.rows.map((r) => `<tr>
      <td class="left"><b>${esc(r.emp.name)}</b><span class="sub-line">${esc(r.emp.emp_no)}, ${esc(r.emp.role)}${d.teamMap[r.emp.team_id] ? ', ' + esc(d.teamMap[r.emp.team_id].name) : ''}${r.emp.status !== 'Active' ? ` <span class="pill muted">${esc(r.emp.status)}</span>` : ''}</span></td>
      <td>${pct(r.pct)}</td>
      ${r.cells.map((c) => `<td class="cell ${codeClass(d, c.code)} ${c.source === 'change' ? 'c-change' : ''}" data-e="${r.emp.uid}" data-d="${c.day}" title="${esc(dlabel(c.day) + ': ' + (c.code || 'not on roster'))}">${esc(shortCode(c.code))}</td>`).join('')}
      <td class="num">${fmt0(r.staffDays)}</td><td class="num">${fmt(r.prod)}</td><td class="num">${fmt(r.ot)}</td></tr>`).join('')).join('');
  const inPeriod = d.status_changes.filter((c) => c.date_to >= R.days[0] && c.date_from <= R.days[R.days.length - 1]).sort((a, b) => a.date_from.localeCompare(b.date_from));
  const empMap = {}; d.employees.forEach((e) => (empMap[e.uid] = e));
  el.innerHTML = head('Roster and leave', 'Shifts come from each team or person pattern. Leave, sickness, training, overtime and absence are recorded from one date to another.', ed ? '<button class="btn primary" id="addStatus">Add leave or status</button>' : '') + `
  <div class="toolbar"><select id="secSel" aria-label="Section"><option value="">All sections</option>${secs.map((s) => `<option value="${s.id}" ${String(s.id) === S.section ? 'selected' : ''}>${esc(s.section.name)}</option>`).join('')}</select>
    <span class="hint">${ed ? 'Click a day to record leave or a status for that person.' : 'View only.'}</span></div>
  <div class="legend"><span><i class="c-work"></i>Working</span><span><i class="c-rest"></i>Rest day</span><span><i class="c-leave"></i>Annual or planned leave</span><span><i class="c-train"></i>Training</span><span><i class="c-sick"></i>Sick</span><span><i class="c-ot"></i>Overtime</span><span><i class="c-abs"></i>Absent</span><span><i class="c-work c-change"></i>Changed from pattern</span></div>
  <div class="tbl-wrap" style="max-height:72vh"><table class="roster ${ed ? 'edit' : ''}"><thead><tr><th class="left">Employee</th><th>Count</th>${head1}<th>Days</th><th>Prod h</th><th>OT h</th></tr></thead>
  <tbody>${body}</tbody></table></div>
  <div class="panel" style="margin-top:18px"><div class="phead"><h2>Leave and status in this period</h2><span class="hint">${inPeriod.length} records</span></div>
  ${inPeriod.length ? `<div class="tbl-wrap"><table><thead><tr><th>Employee</th><th>Status</th><th>From</th><th>To</th><th class="num">Days</th><th>Notes</th><th></th></tr></thead><tbody>
  ${inPeriod.map((c) => { const e = empMap[c.employee_uid] || {}; return `<tr><td>${esc(e.name)}<span class="sub-line">${esc(e.emp_no)}</span></td><td><span class="pill info">${esc(c.status_type === 'Custom' ? 'Shift ' + c.code : c.status_type)}</span></td><td>${dlabel(c.date_from)}</td><td>${dlabel(c.date_to)}</td><td class="num">${Calc.diffDays(c.date_from, c.date_to) + 1}</td><td>${esc(c.notes || '')}</td>
    <td class="actions">${ed ? `<button class="btn sm" data-edit="${c.id}">Edit</button> <button class="btn sm danger" data-del="${c.id}">Delete</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="hint">Nothing recorded for this period.</p>'}</div>`;
  $('#secSel', el).onchange = (e) => { S.section = e.target.value; viewRoster(el); };
  if (!ed) return;
  $('#addStatus', el).onclick = () => statusModal({});
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
    ${covering.length ? `<div class="explain"><b>Already recorded on this day</b>${covering.map((c) => `<div class="row" style="justify-content:space-between;margin-top:6px"><span>${esc(c.status_type === 'Custom' ? 'Shift ' + c.code : c.status_type)}, ${dlabel(c.date_from)} to ${dlabel(c.date_to)}</span><button class="btn sm danger" data-rm="${c.id}">Remove</button></div>`).join('')}</div>` : ''}
    ${editing ? `<label class="f">Employee<select id="st_emp">${emps.map((e) => `<option value="${e.uid}" ${e.uid === ch.employee_uid ? 'selected' : ''}>${esc(e.name)} (${esc(e.emp_no)})</option>`).join('')}</select></label>`
      : `<div><div class="hint" style="font-weight:500;margin-bottom:4px">Employees (tick one or more)</div>
      <input type="text" id="st_q" placeholder="Search name, number or team" style="width:100%;margin-bottom:6px">
      <div class="checklist" id="st_list">${emps.filter((e) => e.status === 'Active' || e.uid === ch.employee_uid).map((e) => `<label data-s="${esc((e.name + ' ' + e.emp_no + ' ' + ((d.teamMap[e.team_id] || {}).name || '')).toLowerCase())}"><input type="checkbox" value="${e.uid}" ${e.uid === ch.employee_uid ? 'checked' : ''}> ${esc(e.name)} <span class="hint">${esc(e.emp_no)}${d.teamMap[e.team_id] ? ', ' + esc(d.teamMap[e.team_id].name) : ''}</span></label>`).join('')}</div></div>`}
    <div class="grid2">
      <label class="f">Status<select id="st_type">${STATUS_TYPES.map((t) => `<option value="${t}" ${t === (ch.status_type || 'Annual Leave') ? 'selected' : ''}>${t === 'Custom' ? 'Different shift (pick code)' : t}</option>`).join('')}</select></label>
      <label class="f" id="st_code_w">Shift code<select id="st_code">${d.shift_codes.map((c) => `<option ${c.code === ch.code ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select></label>
      <label class="f">From<input type="date" id="st_from" value="${ch.date_from || today()}"></label>
      <label class="f">To<input type="date" id="st_to" value="${ch.date_to || ch.date_from || today()}"></label>
    </div>
    <label class="f">Notes<input type="text" id="st_notes" value="${esc(ch.notes || '')}"></label>
    <p class="hint" style="margin:0">Leave, sick, training and absence replace working days only. Overtime and a different shift apply on every day in the range, so use them for rest-day overtime.</p>`;
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
// EMPLOYEES
// =====================================================================
function viewEmployees(el) {
  const d = wsData(), f = S.empFilter, ed = canEdit(), td = today();
  const list = d.employees.filter((e) => (!f.section || String(Calc.sectionOf(e, d)) === f.section) && (!f.status || e.status === f.status) &&
    (!f.q || (e.name + ' ' + e.emp_no + ' ' + (e.specialty || '') + ' ' + (e.skills || '')).toLowerCase().includes(f.q.toLowerCase())));
  const current = (e) => d.status_changes.filter((c) => c.employee_uid === e.uid && c.date_from <= td && c.date_to >= td).pop();
  el.innerHTML = head('Employees', `${d.employees.filter((e) => e.status === 'Active').length} active people. Counted % decides how many productive hours each person adds.`, ed ? '<button class="btn primary" id="addEmp">Add employee</button>' : '') + `
  <div class="toolbar"><input type="text" id="ef_q" placeholder="Search name, number, skill" value="${esc(f.q)}" style="width:250px" aria-label="Search">
    <select id="ef_sec" aria-label="Section"><option value="">All sections</option>${d.sections.map((s) => `<option value="${s.id}" ${f.section === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <select id="ef_status" aria-label="Status"><option value="">Any status</option>${['Active', 'Pending', 'Excluded'].map((s) => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <span class="hint">${list.length} shown</span></div>
  <div class="tbl-wrap"><table><thead><tr><th>No.</th><th>Name</th><th>Role</th><th>Team / section</th><th class="num">Counted</th><th>Shift pattern</th><th>Status</th><th>Today</th><th></th></tr></thead><tbody>
  ${list.map((e) => { const c = current(e), t = d.teamMap[e.team_id], p = e.pattern_main || (t && t.pattern_main); return `<tr><td class="mono">${esc(e.emp_no)}</td><td><b>${esc(e.name)}</b>${e.specialty || e.skills ? `<span class="sub-line">${esc([e.specialty, e.skills].filter(Boolean).join(' · '))}</span>` : ''}</td><td>${esc(e.role)}</td>
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
      <label class="f" style="grid-column:span 2">Name *<input type="text" id="e_name" value="${esc(e.name || '')}"></label>
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
    <p class="hint" style="margin:0">Automatic counted %: Technician 100%, Team Leader ${pct(Number(d.settings.tl_factor))}, Foreman and office roles 0%. Welders and support staff are usually 25–50%. Pending and Excluded people are not counted. Days before the start or after the end date are not on the roster.</p>`,
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
  <div class="note" style="margin-bottom:14px">Average of the readings in minutes, × rating % = normal time, × crew = man-minutes. The sum ÷ 60 is the man-hours per exam. No allowance is added. Rating 100% is normal pace, 110% faster, 90% slower.</div>
  <div class="tbl-wrap"><table id="ts"><thead><tr><th style="width:34px">Step</th><th>Element</th><th>Readings (minutes, comma separated)</th><th class="num">n</th><th class="num">Avg min</th><th class="num">Rating %</th><th class="num">Normal min</th><th class="num">Crew</th><th class="num">Man-min</th><th></th></tr></thead><tbody></tbody>
  <tfoot><tr class="total"><td></td><td colspan="5">Total</td><td class="num" id="ts_el"></td><td></td><td class="num" id="ts_mm"></td><td></td></tr></tfoot></table></div>
  <div class="row" style="margin-top:14px">
    ${ed ? '<button class="btn" id="ts_add">Add element</button><button class="btn primary" id="ts_save">Save study</button>' : ''}
    <div class="spacer" style="flex:1"></div>
    <div class="stat" style="border:1px solid var(--line);border-radius:8px;min-width:260px"><div class="t">Study result</div><div class="n" id="ts_res">–</div><div class="s" id="ts_cmp"></div></div>
    ${ed ? '<button class="btn primary" id="ts_apply">Use as standard hours</button>' : ''}
  </div>`;
  const tbody = $('#ts tbody', el);
  const dis = ed ? '' : 'disabled';
  const rowHTML = (r, i) => `<tr><td>${i + 1}</td><td><input type="text" class="t_el" value="${esc(r.element || '')}" aria-label="Element" ${dis}></td>
    <td><input type="text" class="t_rd" value="${esc((r.readings || []).join(', '))}" placeholder="12, 13.5, 12.2" aria-label="Readings" ${dis}></td>
    <td class="num t_n"></td><td class="num t_avg"></td><td class="num"><input type="number" class="t_rt" value="${r.rating_pct ?? 100}" min="50" max="150" style="width:72px" aria-label="Rating" ${dis}></td>
    <td class="num t_nt"></td><td class="num"><input type="number" class="t_cr" value="${r.crew ?? 1}" min="1" step="1" style="width:62px" aria-label="Crew" ${dis}></td><td class="num t_mm"></td>
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
    <label class="f">Team Leader counted %<input type="number" id="s_tl" value="${Math.round(s.tl_factor * 100)}" min="0" max="100" step="5" style="width:150px" ${dis}></label>
    <label class="f">8 hr: productive h per person per week<input type="number" id="s_d8" value="${s.mp_div_8}" step="0.5" style="width:150px" ${dis}></label>
    <label class="f">12 hr: productive h per person per week<input type="number" id="s_d12" value="${s.mp_div_12}" step="0.5" style="width:150px" ${dis}></label>
    ${ed ? '<button class="btn primary" id="s_save" style="margin-top:18px">Save rules</button>' : ''}</div>
    <p class="hint" style="margin-bottom:0">These two figures are what one full-time person gives, and they turn hours into people. A month uses the weekly figure ÷ 5 × Sun–Thu days for 8 hr shifts, and × days ÷ 7 for 12 hr shifts. Each section uses the shift length most of its people work.</p></div>

  <div class="panel"><div class="phead"><h2>Sections</h2><span class="hint">Sick allowance reduces available hours</span></div>
  <div class="tbl-wrap"><table id="sec"><thead><tr><th>Name</th><th class="num">Sick allowance %</th><th class="num">Order</th><th></th></tr></thead><tbody>
  ${d.sections.map((x) => `<tr data-id="${x.id}"><td><input type="text" class="x_n" value="${esc(x.name)}" ${dis}></td><td class="num"><input type="number" class="x_s" value="${Math.round(x.sick_pct * 1000) / 10}" step="0.5" min="0" max="50" ${dis}></td><td class="num"><input type="number" class="x_o" value="${x.sort}" style="width:70px" ${dis}></td><td class="actions">${ed ? '<button class="btn sm danger x_rm">Delete</button>' : ''}</td></tr>`).join('')}</tbody></table></div>
  ${ed ? '<div class="row" style="margin-top:10px"><button class="btn primary" id="sec_save">Save sections</button><button class="btn" id="sec_add">Add section</button></div>' : ''}</div>

  <div class="panel"><div class="phead"><h2>Exam types and standard hours</h2></div>
  <div class="tbl-wrap"><table id="et"><thead><tr><th>Section</th><th>Type</th><th>Asset</th><th>Exam</th><th class="num">Std man-h</th><th class="num">Crew</th><th class="num">Default / week</th><th>Active</th><th class="num">Order</th><th></th></tr></thead><tbody>
  ${d.exam_types.map((x) => `<tr data-id="${x.id}"><td><select class="x_sec" ${dis}>${d.sections.map((s2) => `<option value="${s2.id}" ${s2.id === x.section_id ? 'selected' : ''}>${esc(s2.name)}</option>`).join('')}</select></td>
    <td><select class="x_cat" ${dis}>${['Planned', 'Corrective', 'Job'].map((c) => `<option ${c === x.category ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
    <td><input type="text" class="x_a" value="${esc(x.asset)}" ${dis}></td><td><input type="text" class="x_e" value="${esc(x.exam)}" ${dis}></td>
    <td class="num"><input type="number" class="x_h" value="${x.hours}" step="0.05" style="width:84px" ${dis}></td><td class="num"><input type="number" class="x_c" value="${x.crew ?? ''}" style="width:64px" ${dis}></td>
    <td class="num"><input type="number" class="x_w" value="${x.default_weekly ?? ''}" style="width:72px" ${dis}></td><td><input type="checkbox" class="x_act" ${x.active ? 'checked' : ''} ${dis} aria-label="Active"></td>
    <td class="num"><input type="number" class="x_o" value="${x.sort}" style="width:64px" ${dis}></td><td class="actions">${ed ? '<button class="btn sm danger x_rm">Delete</button>' : ''}</td></tr>`).join('')}</tbody></table></div>
  ${ed ? '<div class="row" style="margin-top:10px"><button class="btn primary" id="et_save">Save exam types</button><button class="btn" id="et_add">Add exam type</button></div>' : ''}</div>

  <div class="panel"><div class="phead"><h2>Shift codes</h2><span class="hint">Productive hours count towards exams. OT hours count on an overtime day. Staff day counts the day as present.</span></div>
  <div class="tbl-wrap"><table id="sc"><thead><tr><th>Code</th><th>Description</th><th>Shift</th><th>Used for</th><th class="num">Paid h</th><th class="num">Productive h</th><th class="num">OT h</th><th>Staff day</th><th></th></tr></thead><tbody>
  ${d.shift_codes.map((c) => `<tr data-code="${esc(c.code)}"><td><b>${esc(c.code)}</b></td><td><input type="text" class="c_desc" value="${esc(c.description)}" ${dis}></td><td>${c.shift_type === '-' ? 'any' : c.shift_type + ' h'}</td><td>${esc(c.status_type || (c.code === 'R' ? 'Rest' : 'Shift'))}</td>
    <td class="num"><input type="number" class="c_paid" value="${c.paid_hrs}" step="0.25" style="width:70px" ${dis}></td><td class="num"><input type="number" class="c_prod" value="${c.prod_hrs}" step="0.25" style="width:70px" ${dis}></td>
    <td class="num"><input type="number" class="c_ot" value="${c.ot_hrs}" step="0.25" style="width:70px" ${dis}></td><td><select class="c_day" ${dis}><option value="1" ${c.staff_day ? 'selected' : ''}>Yes</option><option value="0" ${!c.staff_day ? 'selected' : ''}>No</option></select></td>
    <td class="actions">${ed ? '<button class="btn sm danger c_rm" aria-label="Delete code">✕</button>' : ''}</td></tr>`).join('')}</tbody></table></div>
  ${ed ? '<div class="row" style="margin-top:10px"><button class="btn primary" id="sc_save">Save shift codes</button><button class="btn" id="sc_add">Add shift code</button></div>' : ''}</div>

  <div class="cols">
    <div class="panel"><div class="phead"><h2>Teams</h2></div><div class="tbl-wrap"><table id="tm"><thead><tr><th>Code</th><th>Name</th><th>Section</th><th>Pattern</th>${d.hasAlt ? '<th>Alternative</th>' : ''}<th></th></tr></thead><tbody>
    ${d.teams.map((t) => teamRow(d, t, dis, ed)).join('')}</tbody></table></div>
    ${ed ? `<div class="row" style="margin-top:10px"><button class="btn primary" id="tm_save">Save teams</button><button class="btn" id="tm_add">Add team</button></div>` : ''}</div>
    <div class="panel"><div class="phead"><h2>Shift patterns</h2><div class="grow"></div>${ed ? '<button class="btn sm" id="pt_add">Add pattern</button>' : ''}</div><p class="hint" style="margin-top:-6px">The cycle repeats from its start date.</p>
    ${d.patterns.map((p) => `<div style="border-top:1px solid var(--line);padding:10px 0"><div class="row" style="justify-content:space-between"><b>${esc(p.name)}</b><span><span class="pill info">${p.shift_hrs} h</span> ${ed ? `<button class="btn sm" data-pat="${p.id}">Edit</button>` : ''}</span></div>
      <div class="hint">${esc(p.description || '')}</div><div class="hint mono" style="margin-top:3px">From ${dlabel(p.cycle_start)}, ${p.cycle.length}-day cycle: ${p.cycle.slice(0, 28).map(shortCode).join(' ')}${p.cycle.length > 28 ? ' …' : ''}</div></div>`).join('')}</div>
  </div>`;
  if (!ed) return;
  $('#s_save', el).onclick = async () => { try { await q(sb.from('settings').update({ tl_factor: (+$('#s_tl', el).value || 0) / 100, mp_div_8: +$('#s_d8', el).value || 30, mp_div_12: +$('#s_d12', el).value || 31.5 }).eq('workshop_id', S.ws)); await refresh(); toast('Rules saved', 'ok'); } catch (e) { fail(e); } };
  // sections
  const secB = $('#sec tbody', el);
  $('#sec_add', el).onclick = () => secB.insertAdjacentHTML('beforeend', `<tr data-id=""><td><input type="text" class="x_n" placeholder="Section name"></td><td class="num"><input type="number" class="x_s" value="0"></td><td class="num"><input type="number" class="x_o" value="${d.sections.length + 1}" style="width:70px"></td><td></td></tr>`);
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
  return `<tr data-id="${t.id}"><td><input type="text" class="t_code" value="${esc(t.code)}" style="width:90px" ${dis}></td><td><input type="text" class="t_name" value="${esc(t.name)}" ${dis}></td>
    <td><select class="t_sec" ${dis}><option value="">None</option>${d.sections.map((s) => `<option value="${s.id}" ${s.id === t.section_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></td>
    <td><select class="t_pm" ${dis}>${opts(t.pattern_main)}</select></td>${d.hasAlt ? `<td><select class="t_pa" ${dis}>${opts(t.pattern_alt)}</select></td>` : ''}
    <td class="actions">${ed ? '<button class="btn sm danger t_rm" aria-label="Delete team">✕</button>' : ''}</td></tr>`;
}
function patternModal(p) {
  const d = wsData(), isNew = !p;
  p = p || { name: '', description: '', shift_hrs: 8, cycle_start: Calc.weekStart(today()), cycle: [] };
  modal({ title: isNew ? 'Add shift pattern' : 'Edit shift pattern', wide: true, body: `<div class="grid3">
    <label class="f">Name *<input type="text" id="p_n" value="${esc(p.name)}"></label>
    <label class="f">Shift length<select id="p_h"><option value="8" ${p.shift_hrs === 8 ? 'selected' : ''}>8 h</option><option value="12" ${p.shift_hrs === 12 ? 'selected' : ''}>12 h</option></select></label>
    <label class="f">Cycle starts (day 1)<input type="date" id="p_s" value="${p.cycle_start}"></label></div>
    <label class="f">Description<input type="text" id="p_d" value="${esc(p.description || '')}"></label>
    <label class="f">Cycle codes in order, comma separated<textarea id="p_c" rows="4">${esc(p.cycle.join(', '))}</textarea></label>
    <p class="hint" style="margin:0">Codes you can use: ${d.shift_codes.map((c) => esc(c.code)).join(', ')}</p>`,
    buttons: [...(isNew ? [] : [{ label: 'Delete', cls: 'danger', action: async () => {
      if (!(await confirmBox('Delete pattern', `Delete <b>${esc(p.name)}</b>? Teams and people that use it will have no shifts.`))) return false;
      await q(sb.from('patterns').delete().eq('id', p.id)); await refresh(); toast('Pattern deleted', 'ok');
    } }]), { label: 'Cancel' }, { label: 'Save pattern', cls: 'primary', action: async (ov) => {
      const cycle = $('#p_c', ov).value.split(',').map((x) => x.trim()).filter(Boolean);
      const bad = cycle.filter((c) => !d.codeMap[c]);
      if (bad.length) { toast('Unknown code: ' + bad.join(', '), 'err'); return false; }
      const row = { workshop_id: S.ws, name: $('#p_n', ov).value.trim(), shift_hrs: +$('#p_h', ov).value, cycle_start: $('#p_s', ov).value, description: $('#p_d', ov).value, cycle };
      if (!row.name || !cycle.length || !row.cycle_start) { toast('Name, start date and cycle are required', 'err'); return false; }
      if (isNew) await q(sb.from('patterns').insert(row)); else await q(sb.from('patterns').update(row).eq('id', p.id));
      await refresh(); toast('Pattern saved', 'ok');
    } }] });
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
      <p class="hint" style="margin:0">Give the username and password to the person. They can change the password after signing in.</p>`,
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
      ${rows.map((r) => `<tr><td style="white-space:nowrap">${esc(new Date(r.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}</td><td>${esc(r.username)}</td><td>${esc(wsn(r.workshop_id))}</td><td>${esc(r.action)}</td><td>${esc(r.details)}</td></tr>`).join('') || '<tr><td colspan="5" class="hint">No activity yet.</td></tr>'}</tbody></table></div>`;
  } catch (e) { fail(e); }
}

// =====================================================================
// EXPORT / IMPORT
// =====================================================================
const COLS = {
  Employees: ['Employee No', 'Name', 'Role', 'Team', 'Section', 'Counted % (blank = auto)', 'Specialty', 'Skills', 'Start Date', 'End Date', 'Status', 'Own Pattern', 'Own Alternative Pattern', 'Notes'],
  'Leave and Status': ['Employee No', 'Employee Name', 'Status', 'Shift Code (Custom only)', 'From', 'To', 'Notes'],
  'Exam Types': ['Section', 'Type', 'Asset', 'Exam', 'Std Man-hours', 'Crew', 'Default per Week', 'Active', 'Order'],
  Workload: ['Period (Week/Month)', 'Period Start', 'Section', 'Asset', 'Exam', 'Count'],
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
    <p style="margin-top:20px">Report for ${periodLabel()}: summary by section, workload and the day-by-day roster.</p><button class="btn" id="x_rep">Download period report (.xlsx)</button></div>
  <div class="panel"><h2>Import</h2>${ed ? `<p>Pick an .xlsx file with the same sheet names and columns as the export. Only the sheets in the file are read.</p>
    <input type="file" id="imp" accept=".xlsx,.xls" aria-label="Excel file to import"><div id="imp_prev" style="margin-top:14px"></div>` : '<p class="hint">Only editors and admins can import.</p>'}
    <div class="explain" style="margin-top:14px">Employees, exam types, sections, shift codes, teams, patterns and rules are added or updated by their key (employee number, section + asset + exam, name or code). Workload sets the count for each period. Time study replaces the elements of each exam in the file. Leave and status rows are added and exact duplicates skipped. Nothing is deleted unless you tick the option.</div></div></div>`;
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
  sheet(wb, 'Leave and Status', d.status_changes.map((c) => ({ 'Employee No': (empM[c.employee_uid] || {}).emp_no, 'Employee Name': (empM[c.employee_uid] || {}).name, Status: c.status_type, 'Shift Code (Custom only)': c.code || '', From: c.date_from, To: c.date_to, Notes: c.notes || '' })), COLS['Leave and Status']);
  sheet(wb, 'Exam Types', d.exam_types.map((x) => ({ Section: secName(d, x.section_id), Type: x.category, Asset: x.asset, Exam: x.exam, 'Std Man-hours': Number(x.hours), Crew: x.crew ?? '', 'Default per Week': x.default_weekly ?? '', Active: x.active ? 'Yes' : 'No', Order: x.sort })), COLS['Exam Types']);
  sheet(wb, 'Workload', [...d.counts].sort((a, b) => a.period_start.localeCompare(b.period_start)).map((c) => { const x = exM[c.exam_type_id] || {}; return { 'Period (Week/Month)': c.period_type === 'week' ? 'Week' : 'Month', 'Period Start': c.period_start, Section: secName(d, x.section_id), Asset: x.asset, Exam: x.exam, Count: Number(c.count) }; }), COLS.Workload);
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
      ${data['Leave and Status'] ? '<label style="display:flex;gap:8px;margin-top:10px"><input type="checkbox" id="imp_rs"> Replace all leave and status records of this workshop with the file</label>' : ''}
      <div class="row" style="margin-top:12px"><button class="btn primary" id="imp_go">Import into ${esc(wsData().workshop.short_name)}</button><span class="hint" id="imp_msg"></span></div>`;
    $('#imp_go', el).onclick = async () => {
      const btn = $('#imp_go', el); btn.disabled = true; $('#imp_msg', el).textContent = 'Importing…';
      try { const log = await runImport(data, { replaceStatus: $('#imp_rs', el) && $('#imp_rs', el).checked }); await refresh(); toast('Import finished', 'ok'); modal({ title: 'Import finished', body: `<ul style="margin:0;padding-left:18px">${log.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`, buttons: [{ label: 'Done', cls: 'primary' }] }); }
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
    const rows = data['Shift Codes'].filter((r) => str(r.Code)).map((r, i) => ({ workshop_id: W, code: str(r.Code), description: str(r.Description) || str(r.Code), shift_type: ['8', '12'].includes(str(r['Shift (8/12/-)'])) ? str(r['Shift (8/12/-)']) : '-', status_type: str(r['Used For']) || null,
      paid_hrs: Number(r['Paid Hrs']) || 0, prod_hrs: Number(r['Productive Hrs']) || 0, ot_hrs: Number(r['OT Hrs']) || 0, staff_day: Number(r['Staff Day (1/0)']) ? 1 : 0, sort: i }));
    if (rows.length) await q(sb.from('shift_codes').upsert(rows)); log.push(`Shift codes: ${rows.length} saved`);
  }
  if (data.Patterns) {
    let n = 0;
    for (const r of data.Patterns.filter((r) => str(r.Pattern))) {
      const row = { workshop_id: W, name: str(r.Pattern), description: str(r.Description), shift_hrs: Number(r['Shift Hours']) === 12 ? 12 : 8, cycle_start: cellDate(r['Cycle Start']), cycle: str(r['Cycle (comma separated)']).split(',').map((x) => x.trim()).filter(Boolean) };
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
      rows.push({ workshop_id: W, period_type: type, period_start: Calc.periodStart(type, ps), exam_type_id: ex.id, count: Number(r.Count) || 0 });
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
      const row = { workshop_id: W, employee_uid: emp && emp.uid, status_type: t, code: t === 'Custom' ? str(r['Shift Code (Custom only)']) : null, date_from: cellDate(r.From), date_to: cellDate(r.To), notes: str(r.Notes) || null, created_by: S.me.username };
      if (!t || !emp || !row.date_from || !row.date_to || row.date_to < row.date_from || (t === 'Custom' && !row.code)) { bad++; return; }
      if (have.has(key(row))) { skip++; return; }
      have.add(key(row)); rows.push(row);
    });
    if (rows.length) await q(sb.from('status_changes').insert(rows));
    log.push(`Leave and status: ${rows.length} added, ${skip} duplicates skipped${bad ? `, ${bad} rows with errors skipped` : ''}`);
  }
  return log;
}

const VIEWS = { overview: viewOverview, dashboard: viewDashboard, workload: viewWorkload, roster: viewRoster, employees: viewEmployees, timestudy: viewTimeStudy, settings: viewSettings, data: viewData, users: viewUsers, log: viewLog };
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && S.me) { S.me = null; showLogin('You were signed out.'); } });
boot();
})();
