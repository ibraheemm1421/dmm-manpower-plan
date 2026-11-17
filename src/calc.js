// ===== Manpower calculation engine (same logic as the workshop Excel files) =====
// Dates are ISO 'YYYY-MM-DD' handled in UTC.
const Calc = (() => {
  const DAY = 86400000;
  const toDate = (s) => new Date(s + 'T00:00:00Z');
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => iso(new Date(toDate(s).getTime() + n * DAY));
  const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
  const dow = (s) => toDate(s).getUTCDay(); // 0 Sun … 6 Sat
  const weekStart = (s) => addDays(s, -dow(s));
  const monthStart = (s) => s.slice(0, 8) + '01';
  const periodStart = (type, s) => (type === 'week' ? weekStart(s) : monthStart(s));
  function periodDays(type, start) {
    if (type === 'week') { const s = weekStart(start); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
    const s = monthStart(start), d = toDate(s);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return Array.from({ length: last }, (_, i) => addDays(s, i));
  }
  function shiftPeriod(type, s, n) {
    if (type === 'week') return addDays(weekStart(s), 7 * n);
    const d = toDate(monthStart(s));
    return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
  }
  const workdays = (days) => days.filter((x) => dow(x) !== 5 && dow(x) !== 6).length; // Sun–Thu

  const NOT_COUNTED_ROLES = ['Office', 'Data Entry', 'Tools Office'];
  function countedPct(emp, settings) {
    if (emp.status !== 'Active') return 0;
    if (emp.role === 'Foreman') return 0;
    if (emp.hours_pct !== null && emp.hours_pct !== undefined && emp.hours_pct !== '') return Number(emp.hours_pct);
    if (emp.role === 'Team Leader') return Number(settings.tl_factor);
    if (NOT_COUNTED_ROLES.includes(emp.role)) return 0;
    return 1;
  }

  function indexData(raw) {
    const d = { ...raw };
    d.codeMap = {}; raw.shift_codes.forEach((c) => (d.codeMap[c.code] = c));
    d.patMap = {}; raw.patterns.forEach((p) => (d.patMap[p.id] = p));
    d.teamMap = {}; raw.teams.forEach((t) => (d.teamMap[t.id] = t));
    d.secMap = {}; raw.sections.forEach((s) => (d.secMap[s.id] = s));
    d.changesByEmp = {};
    [...raw.status_changes].sort((a, b) => (a.id || 0) - (b.id || 0)).forEach((c) => (d.changesByEmp[c.employee_uid] = d.changesByEmp[c.employee_uid] || []).push(c));
    d.hasAlt = raw.teams.some((t) => t.pattern_alt) || raw.employees.some((e) => e.pattern_alt);
    return d;
  }
  const sectionOf = (emp, d) => { const t = d.teamMap[emp.team_id]; return (t && t.section_id) || emp.section_id || null; };
  function patternFor(emp, alt, d) {
    const t = d.teamMap[emp.team_id] || {};
    let pid = null;
    if (alt) pid = emp.pattern_alt || t.pattern_alt || null;
    if (!pid) pid = emp.pattern_main || t.pattern_main || null;
    return d.patMap[pid] || null;
  }
  function baseCode(p, day) {
    if (!p || !p.cycle || !p.cycle.length) return '';
    const n = p.cycle.length, k = ((diffDays(p.cycle_start, day) % n) + n) % n;
    return p.cycle[k];
  }
  function statusCode(ch, base, pattern, d) {
    if (ch.status_type === 'Custom') return ch.code;
    const bc = d.codeMap[base];
    let shift = bc && (bc.shift_type === '8' || bc.shift_type === '12') ? bc.shift_type : String((pattern && pattern.shift_hrs) || 8);
    const all = d.shift_codes.filter((c) => c.status_type === ch.status_type);
    const hit = all.find((c) => c.shift_type === shift) || all.find((c) => c.shift_type === '-') || all[0];
    return hit ? hit.code : '';
  }
  function dayCode(emp, day, d, pattern) {
    if (emp.start_date && day < emp.start_date) return { code: '', source: '' };
    if (emp.end_date && day > emp.end_date) return { code: '', source: '' };
    const base = baseCode(pattern, day);
    let code = base, source = 'pattern', changeId = null;
    for (const ch of d.changesByEmp[emp.uid] || []) {
      if (day < ch.date_from || day > ch.date_to) continue;
      const anyDay = ch.status_type === 'Overtime' || ch.status_type === 'Custom';
      if (!anyDay && (base === 'R' || base === '')) continue; // leave / sick / training only replace working days
      const c = statusCode(ch, base, pattern, d);
      if (c) { code = c; source = 'change'; changeId = ch.id; }
    }
    return { code, source, changeId };
  }

  // count of an exam in a period: explicit count, else default weekly rate
  function examCount(x, type, days, counts) {
    if (counts && counts[x.id] !== undefined && counts[x.id] !== null) return { n: Number(counts[x.id]), auto: false };
    if (x.default_weekly) return { n: type === 'week' ? Number(x.default_weekly) : Math.round((Number(x.default_weekly) * workdays(days)) / 5), auto: true };
    return { n: 0, auto: false };
  }

  function divisorFor(basis, type, days, s) {
    if (basis === '12') {
      const v = type === 'week' ? Number(s.mp_div_12) : (Number(s.mp_div_12) * days.length) / 7;
      return { value: v, text: type === 'week' ? `${fmtN(s.mp_div_12)} h/week (12 hr shifts)` : `${fmtN(s.mp_div_12)} h/week × ${days.length} days ÷ 7 (12 hr)` };
    }
    const v = type === 'week' ? Number(s.mp_div_8) : (Number(s.mp_div_8) / 5) * workdays(days);
    return { value: v, text: type === 'week' ? `${fmtN(s.mp_div_8)} h/week (8 hr shifts)` : `${fmtN(s.mp_div_8)} ÷ 5 × ${workdays(days)} Sun–Thu days (8 hr)` };
  }
  const fmtN = (n) => Math.round(Number(n) * 100) / 100;

  function compute(raw, opts) {
    const d = raw.codeMap ? raw : indexData(raw);
    const { alt = false, type, start, counts, actuals = {} } = opts;
    const days = periodDays(type, start);
    const secs = {};
    const mk = (id) => (secs[id] = secs[id] || { id, section: d.secMap[id] || { id, name: 'No section', sick_pct: 0 }, rows: [], prod: 0, ot: 0, paid: 0, staffDays: 0, headcount: 0, fte: 0, w8: 0, w12: 0, work: [], alTechs: 0, alDays: 0 });
    d.sections.forEach((s) => mk(s.id));
    const rows = [];
    for (const emp of d.employees) {
      const pct = countedPct(emp, d.settings);
      const pattern = patternFor(emp, alt, d);
      const r = { emp, pct, pattern, cells: [], staffDays: 0, paid: 0, prod: 0, ot: 0, section_id: sectionOf(emp, d) };
      for (const day of days) {
        const dc = dayCode(emp, day, d, pattern);
        const sc = d.codeMap[dc.code];
        if (sc) {
          const on = pct > 0 ? 1 : 0;
          r.staffDays += on * sc.staff_day; r.paid += on * Number(sc.paid_hrs) * sc.staff_day;
          r.prod += pct * Number(sc.prod_hrs); r.ot += pct * Number(sc.ot_hrs);
        }
        r.cells.push({ day, ...dc });
        if (sc && sc.status_type === 'Annual Leave') r.alDays = (r.alDays || 0) + 1;
      }
      rows.push(r);
      const s = mk(r.section_id);
      s.rows.push(r); s.prod += r.prod; s.ot += r.ot; s.paid += r.paid; s.staffDays += r.staffDays;
      if (emp.status === 'Active') s.headcount++;
      s.fte += pct;
      if (pattern && pattern.shift_hrs === 12) s.w12 += pct; else s.w8 += pct;
      if (r.alDays && emp.status === 'Active' && pct > 0) { s.alTechs++; s.alDays += r.alDays; }
    }
    d.exam_types.filter((x) => x.active).forEach((x) => {
      const c = examCount(x, type, days, counts);
      const a = actuals[x.id] === undefined || actuals[x.id] === null ? null : Number(actuals[x.id]);
      mk(x.section_id).work.push({ exam: x, count: c.n, auto: c.auto, hours: c.n * Number(x.hours), actual: a, deferred: a === null ? 0 : Math.max(0, c.n - a) });
    });
    const T = { prod: 0, ot: 0, paid: 0, staffDays: 0, headcount: 0, fte: 0, gross: 0, available: 0, required: 0, exams: 0, balance: 0, manpower: 0, peopleNeeded: 0, peopleHave: 0,
      actual: 0, reported: 0, plannedReported: 0, deferred: 0, cmExams: 0, cmActual: 0, cmHours: 0, alTechs: 0, alDays: 0 };
    const sections = Object.values(secs).map((s) => {
      s.gross = s.prod + s.ot;
      s.sick = Number(s.section.sick_pct || 0);
      s.available = s.gross * (1 - s.sick);
      s.required = s.work.reduce((a, w) => a + w.hours, 0);
      s.exams = s.work.reduce((a, w) => a + w.count, 0);
      s.balance = s.available - s.required;
      s.basis = s.w12 > s.w8 ? '12' : '8';
      s.div = divisorFor(s.basis, type, days, d.settings);
      s.manpower = s.div.value ? s.balance / s.div.value : 0;
      s.peopleNeeded = s.div.value ? s.required / s.div.value : 0;
      s.peopleHave = s.div.value ? s.available / s.div.value : 0;
      s.efficiency = s.available ? s.required / s.available : 0;
      s.otNeeded = Math.max(0, -s.balance);
      s.active = s.rows.length > 0 || s.work.length > 0;
      const rep = s.work.filter((w) => w.actual !== null);
      s.reported = rep.length; s.actual = rep.reduce((a, w) => a + w.actual, 0); s.plannedReported = rep.reduce((a, w) => a + w.count, 0);
      s.deferred = rep.reduce((a, w) => a + w.deferred, 0);
      const cm = s.work.filter((w) => w.exam.category === 'Corrective');
      s.cmExams = cm.reduce((a, w) => a + w.count, 0); s.cmActual = cm.reduce((a, w) => a + (w.actual || 0), 0); s.cmHours = cm.reduce((a, w) => a + w.hours, 0);
      s.cmShare = s.available ? s.cmHours / s.available : 0;
      ['actual', 'reported', 'plannedReported', 'deferred', 'cmExams', 'cmActual', 'cmHours', 'alTechs', 'alDays'].forEach((k) => (T[k] += s[k]));
      ['prod', 'ot', 'paid', 'staffDays', 'headcount', 'fte', 'gross', 'available', 'required', 'exams', 'balance', 'manpower', 'peopleNeeded', 'peopleHave'].forEach((k) => (T[k] += s[k]));
      return s;
    }).filter((s) => s.active).sort((a, b) => (a.section.sort ?? 99) - (b.section.sort ?? 99));
    T.efficiency = T.available ? T.required / T.available : 0;
    T.cmShare = T.available ? T.cmHours / T.available : 0;
    T.completion = T.plannedReported ? T.actual / T.plannedReported : null;
    T.deficitHours = Math.max(0, -T.balance);
    T.otNeeded = sections.reduce((a, s) => a + s.otNeeded, 0);
    T.extraPeople = sections.reduce((a, s) => a + Math.max(0, -s.manpower), 0);
    return { days, rows, sections, tot: T, type, alt };
  }

  return { compute, indexData, periodDays, periodStart, shiftPeriod, weekStart, monthStart, addDays, diffDays, dow, iso, countedPct, sectionOf, workdays, examCount };
})();
if (typeof module !== 'undefined') module.exports = Calc;
