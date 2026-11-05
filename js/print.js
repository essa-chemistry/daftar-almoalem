// الطباعة: ترويسة المدرسة، كشف المتابعة الأسبوعي، كشف الحصة، كشف المهمة، كشف تفصيل الدرجة
import { workspace, get, roster, eventTypes, calCtx, className, all, ws, sessionAttendance, sessionEvents, findSession, enrollmentsOf, isEnrolledOn } from './store.js';
import { meetingsRange, isHeldStatus, termRange } from './calendar.js';
import { escapeHTML as e, DAY_SHORT, DAY_NAMES, weekStart, fmtShort, fmtHijriShort, fmtDate, fmtDateLong, todayISO, dow, addDays, fmtNum } from './utils.js';
import { TASK_KINDS, HW_STATUS, METHODS, taskMode, ATT_STATUS, OCC_STATUS } from './grading.js';

const ATT_CODE = { absent_unexcused: 'غ', absent_excused: 'ع', late: 'ت' };

export function printHTML(html, { landscape = false } = {}) {
  const root = document.getElementById('print-root');
  root.innerHTML = html;
  let st = document.getElementById('page-style');
  if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.appendChild(st); }
  st.textContent = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: ${landscape ? '8mm 8mm 9mm' : '12mm 12mm 12mm'}; }`;
  const imgs = [...root.querySelectorAll('img')];
  Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(() => window.print(), 60));
}

export function header(title, metaPairs = []) {
  const w = workspace() || {}; const id = w.identity || {}; const lg = w.logos || {};
  const right = [id.country || 'المملكة العربية السعودية', id.ministry || 'وزارة التعليم', id.admin, id.school].filter(Boolean).map(x => `<div>${e(x)}</div>`).join('');
  const center = lg.ministry ? `<img src="${lg.ministry}" alt="">` : '';
  const left = (lg.school ? `<img src="${lg.school}" alt="">` : '');
  const leftTxt = [id.region ? `المنطقة/المحافظة: ${id.region}` : '', id.subject ? `المادة: ${id.subject}` : '', id.teacher ? `المعلم: ${id.teacher}` : ''].filter(Boolean).map(x => `<div>${e(x)}</div>`).join('');
  return `<div class="pr-head"><div class="r">${right}</div><div class="c">${center}</div><div class="l"><div class="txt">${leftTxt}</div>${left}</div></div>
    ${title ? `<div class="pr-title">${e(title)}</div>` : ''}
    ${metaPairs.length ? `<div class="pr-meta">${metaPairs.filter(p => p && p[1] != null && p[1] !== '').map(([k, v]) => `<span>${e(k)}: <b>${e(v)}</b></span>`).join('')}</div>` : ''}`;
}

function codeKey(extra = []) {
  const types = eventTypes().filter(t => t.code);
  return `<div class="pr-key"><span><b>✓</b>حاضر</span>${types.map(t => `<span><b>${e(t.code)}</b>${e(t.name)}</span>`).join('')}${extra.join('')}<span><b style="background:#ddd">▨</b>إجازة/حصة ملغاة</span></div>`;
}

function recordedCodes(classId, studentId, date, period) {
  const s = findSession(classId, date, period); if (!s) return '';
  const a = sessionAttendance(s.id).get(studentId);
  const codes = [];
  if (a && ATT_CODE[a.status]) codes.push(ATT_CODE[a.status]);
  for (const ev of sessionEvents(s.id).filter(x => x.student_id === studentId)) {
    const t = get('event_types', ev.type_id); if (t?.code && !t.sys?.startsWith('absent') && t.sys !== 'late') codes.push(t.code);
  }
  return codes.join('');
}

// ---------- كشف المتابعة الأسبوعي ----------
export function weeklySheet({ classId, from, to, weeksPerPage = 'auto', extraRows = 3, prefill = false, hijri = true, maxCols = 30 }) {
  const cls = get('classes', classId); const ctx = calCtx();
  const ms = meetingsRange(ctx, classId, from, to).filter(m => m.status !== 'teacher_absent' || true);
  // تجميع بالأسبوع وتخطي الأسابيع التي كلها إجازة
  const weeks = [];
  for (const m of ms) {
    const ws0 = weekStart(m.date, 0);
    let w = weeks.find(x => x.start === ws0);
    if (!w) { w = { start: ws0, items: [] }; weeks.push(w); }
    w.items.push(m);
  }
  const usable = weeks.filter(w => w.items.some(m => isHeldStatus(m.status)));
  if (!usable.length) return null;
  usable.forEach((w, i) => { w.n = i + 1; });
  const pages = []; let cur = [], cols = 0;
  const perPage = weeksPerPage === 'auto' ? null : +weeksPerPage;
  for (const w of usable) {
    const add = w.items.length;
    if (cur.length && (perPage ? cur.length >= perPage : cols + add > maxCols)) { pages.push(cur); cur = []; cols = 0; }
    cur.push(w); cols += add;
  }
  if (cur.length) pages.push(cur);

  const html = pages.map((pw, pi) => {
    const pFrom = pw[0].items[0].date, pTo = pw[pw.length - 1].items[pw[pw.length - 1].items.length - 1].date;
    const cells = pw.flatMap(w => w.items.map((m, i) => ({ ...m, first: i === 0 })));
    // الطلاب الذين كانوا مسجلين في أي يوم من الصفحة
    const rows = roster(classId, pTo, { includeLeft: true }).filter(x => {
      const es = enrollmentsOf(x.student.id).filter(e => e.class_id === classId);
      return es.some(e => e.start_date <= pTo && (!e.end_date || e.end_date >= pFrom));
    });
    const nameW = 46, seatW = 7, noteW = 24;
    const colgroup = `<colgroup><col style="width:${seatW}mm"><col style="width:${nameW}mm">${cells.map(() => '<col>').join('')}<col style="width:${noteW}mm"></colgroup>`;
    const h1 = `<tr><th rowspan="3">م</th><th rowspan="3">اسم الطالب</th>${pw.map(w => `<th class="wk wk-sep" colspan="${w.items.length}">الأسبوع ${w.n} — ${fmtShort(w.items[0].date)}</th>`).join('')}<th rowspan="3">ملاحظات</th></tr>`;
    const h2 = `<tr>${cells.map(m => `<th class="vt ${m.first ? 'wk-sep' : ''} ${isHeldStatus(m.status) ? '' : 'shade'}">${DAY_SHORT[dow(m.date)]}<br>${fmtShort(m.date)}${hijri ? `<br><span style="font-weight:400">${fmtHijriShort(m.date)}</span>` : ''}</th>`).join('')}</tr>`;
    const h3 = `<tr>${cells.map(m => `<th class="vt ${m.first ? 'wk-sep' : ''} ${isHeldStatus(m.status) ? '' : 'shade'}">ح${m.period}</th>`).join('')}</tr>`;
    const body = rows.map((x, i) => {
      const es = enrollmentsOf(x.student.id).filter(e => e.class_id === classId);
      const left = !es.some(e => isEnrolledOn(e, pTo));
      return `<tr class="${left ? 'left' : ''}"><td>${e(x.student.seat_no || i + 1)}</td><td class="nm">${e(x.student.full_name)}</td>${cells.map(m => {
        const enr = es.some(e => isEnrolledOn(e, m.date));
        const cl = [m.first ? 'wk-sep' : '', !isHeldStatus(m.status) ? 'shade' : '', !enr ? 'na' : ''].join(' ');
        const txt = prefill && enr && isHeldStatus(m.status) ? recordedCodes(classId, x.student.id, m.date, m.period) : '';
        return `<td class="code ${cl}">${e(txt)}</td>`;
      }).join('')}<td></td></tr>`;
    }).join('') + Array.from({ length: +extraRows || 0 }, () => `<tr><td></td><td class="nm"></td>${cells.map(m => `<td class="${m.first ? 'wk-sep' : ''} ${isHeldStatus(m.status) ? '' : 'shade'}"></td>`).join('')}<td></td></tr>`).join('');
    const reasons = cells.filter(m => !isHeldStatus(m.status)).map(m => `${DAY_SHORT[dow(m.date)]} ${fmtShort(m.date)}: ${m.reason || 'ملغاة'}`);
    return `<section class="pr-page">${header('كشف متابعة الطلاب', [['الفصل', className(cls)], ['المادة', workspace()?.identity?.subject], ['الفترة', `${fmtDate(pFrom)} — ${fmtDate(pTo)}`]])}
      <table class="pr">${colgroup}<thead>${h1}${h2}${h3}</thead><tbody>${body}</tbody></table>
      ${codeKey()}${reasons.length ? `<div class="pr-small" style="margin-top:3px">المظلل: ${e(reasons.join(' • '))}</div>` : ''}
      <div class="pr-foot"><div>توقيع المعلم: ....................</div><div>ملاحظات: ..........................................</div></div>
      <span class="pr-pagenum">${pi + 1} / ${pages.length}</span></section>`;
  }).join('');
  return html;
}

// ---------- كشف الحصة الواحدة (أو اليوم) ----------
export function sessionSheet({ classId, date, period, prefill = true, typeCount = 8 }) {
  const cls = get('classes', classId);
  const rows = roster(classId, date);
  const s = period != null ? findSession(classId, date, +period) : null;
  // الأنواع المسجلة في الحصة أولاً، ثم البقية بترتيبها (دون الحضور والملاحظة المحايدة)
  const usedIds = new Set(s ? sessionEvents(s.id).map(v => v.type_id) : []);
  const pool = eventTypes().filter(t => t.code && !t.sys?.startsWith('absent') && t.sys !== 'late' && (t.sys || t.category || t.points));
  const types = [...pool.filter(t => usedIds.has(t.id)), ...pool.filter(t => !usedIds.has(t.id))].slice(0, Math.max(typeCount, usedIds.size));
  const att = s ? sessionAttendance(s.id) : new Map();
  const evs = s ? sessionEvents(s.id) : [];
  const per = workspace()?.day?.periods?.find(p => p.n === +period);
  const body = rows.map((x, i) => {
    const a = att.get(x.student.id);
    const attTxt = prefill && s ? (a ? ({ late: 'ت' + (a.late_minutes ? ` ${a.late_minutes}د` : ''), absent_excused: 'ع', absent_unexcused: 'غ', present: '✓' }[a.status]) : '✓') : '';
    return `<tr><td>${e(x.student.seat_no || i + 1)}</td><td class="nm">${e(x.student.full_name)}</td><td class="code">${e(attTxt)}</td>${types.map(t => {
      const c = prefill ? evs.filter(v => v.student_id === x.student.id && v.type_id === t.id).length : 0;
      return `<td class="code">${c ? (c > 1 ? c + '×' : '✓') : ''}</td>`;
    }).join('')}<td></td></tr>`;
  }).join('') + `<tr><td></td><td class="nm"></td><td></td>${types.map(() => '<td></td>').join('')}<td></td></tr>`.repeat(3);
  return `<section class="pr-page">${header('كشف متابعة حصة', [['الفصل', className(cls)], ['التاريخ', fmtDateLong(date)], ['الحصة', period ? `${period}${per ? ` (${per.start}–${per.end})` : ''}` : '—'], ['المادة', workspace()?.identity?.subject]])}
    <table class="pr big"><colgroup><col style="width:9mm"><col style="width:58mm"><col style="width:14mm">${types.map(() => '<col>').join('')}<col style="width:40mm"></colgroup>
    <thead><tr><th>م</th><th>اسم الطالب</th><th>الحضور</th>${types.map(t => `<th class="vt">${e(t.code)}<br>${e(t.name)}</th>`).join('')}<th>ملاحظات</th></tr></thead><tbody>${body}</tbody></table>
    ${codeKey()}
    <div class="pr-foot"><div>عدد الحضور: ........ الغياب: ........</div><div>توقيع المعلم: ....................</div></div></section>`;
}

// ---------- كشف درجات مهمة ----------
export function taskSheet({ taskId, classId, prefill = true }) {
  const t = get('tasks', taskId); const cls = get('classes', classId);
  const rows = roster(classId, t.date);
  const res = new Map(all('task_results', r => r.task_id === taskId).map(r => [r.student_id, r]));
  const mode = taskMode(t);
  const body = rows.map((x, i) => {
    const r = res.get(x.student.id);
    const v = !prefill || !r ? '' : mode === 'status' ? (HW_STATUS[r.status] || '') : (r.status === 'excused' ? 'معذور' : (r.score ?? ''));
    return `<tr><td>${e(x.student.seat_no || i + 1)}</td><td class="nm">${e(x.student.full_name)}</td><td class="code">${e(v)}</td><td></td></tr>`;
  }).join('');
  return `<section class="pr-page">${header(`كشف رصد: ${t.title}`, [['الفصل', className(cls)], ['النوع', TASK_KINDS[t.kind]], ['التاريخ', fmtDate(t.date)], ['الدرجة العظمى', mode === 'status' ? 'حالات' : t.max_score]])}
    <table class="pr big"><colgroup><col style="width:10mm"><col style="width:80mm"><col style="width:30mm"><col></colgroup>
    <thead><tr><th>م</th><th>اسم الطالب</th><th>${mode === 'status' ? 'الحالة' : 'الدرجة'}</th><th>ملاحظات</th></tr></thead><tbody>${body}</tbody></table>
    <div class="pr-foot"><div>توقيع المعلم: ....................</div><div>التاريخ: ${fmtDate(todayISO())}</div></div></section>`;
}

// ---------- كشف تفصيل الدرجة (لطالب) ----------
export function gradeBreakdownSheet({ student, cls, term, g, includeEvents = true }) {
  const cats = g.categories.map(c => `<div class="pr-box"><h4>${e(c.name)} — ${c.final == null ? 'غير مقيّمة بعد' : `${fmtNum(c.final)} من ${c.weight}`} <span class="pr-small">(طريقة الحساب: ${e(METHODS[c.method])})</span></h4>
      <div>${e(c.text)}</div>
      ${c.override ? `<div><b>تعديل يدوي:</b> المقترحة ${fmtNum(c.suggested)} ← المعتمدة ${fmtNum(c.final)} — السبب: ${e(c.override.reason)}</div>` : ''}
      ${includeEvents && c.items.length ? `<div class="pr-small" style="margin-top:4px">${c.items.slice(0, 40).map(it => it.type
        ? `${fmtDate(it.date, 'g')}${it.period ? ` ح${it.period}` : ''}: ${e(it.type.name)} (${it.status === 'applied' ? (it.points > 0 ? '+' : '') + fmtNum(it.points) : OCC_STATUS[it.status]})`
        : `${fmtDate(it.date, 'g')}: ${e(it.title)} — ${it.excluded ? e(it.excluded) : `${fmtNum(it.earned)}/${it.max}${it.makeup ? ' (تعويضي)' : ''}`}`).join(' • ')}</div>` : ''}</div>`).join('');
  const m = g.monthly;
  const a = g.attendance;
  return `<section class="pr-page">${header('كشف تفصيل الدرجة', [['الطالب', student.full_name], ['الفصل', className(cls)], ['الفصل الدراسي', term === 1 ? 'الأول' : 'الثاني'], ['تاريخ الطباعة', fmtDate(todayISO())]])}
    <div class="pr-box"><b>ملخص:</b> الدرجة الأدائية ${fmtNum(g.total)} من 40 • الاختبارات الشهرية ${m.final == null ? '—' : fmtNum(m.final)} من ${m.weight}
      • الحضور: حضر ${a.present + a.late} من ${a.sessions} حصة (تأخر ${a.late}، غياب بعذر ${a.absent_excused}، بدون عذر ${a.absent_unexcused})</div>
    ${cats}
    <div class="pr-box"><h4>${e(m.name)} — ${m.final == null ? '—' : fmtNum(m.final)} من ${m.weight}</h4><div>${e(m.text)}</div>
      ${m.items.length ? `<div class="pr-small">${m.items.map(i => `${e(i.title)}: ${i.excluded ? e(i.excluded) : `${fmtNum(i.earned)}/${i.max}`}`).join(' • ')}</div>` : ''}
      ${m.override ? `<div><b>تعديل يدوي:</b> السبب: ${e(m.override.reason)}</div>` : ''}</div>
    <div class="pr-sign"><div>المعلم: ${e(workspace()?.identity?.teacher || '....................')}<br>التوقيع: ....................</div><div>الطالب: ${e(student.full_name)}<br>التوقيع بالاطلاع: ....................</div></div></section>`;
}

// ---------- كشف درجات الفصل ----------
export function classGradesSheet({ cls, term, rows, scheme }) {
  const cats = scheme.categories;
  const body = rows.map((x, i) => `<tr class="${x.active ? '' : 'left'}"><td>${e(x.student.seat_no || i + 1)}</td><td class="nm">${e(x.student.full_name)}</td>
    ${x.g.categories.map(c => `<td>${c.final == null ? '—' : fmtNum(c.final)}${c.override ? '*' : ''}</td>`).join('')}
    <td><b>${fmtNum(x.g.total)}</b></td><td>${x.g.monthly.final == null ? '—' : fmtNum(x.g.monthly.final)}</td><td><b>${fmtNum(x.g.grand)}</b></td></tr>`).join('');
  return `<section class="pr-page">${header('كشف الدرجات الأدائية', [['الفصل', className(cls)], ['الفصل الدراسي', term === 1 ? 'الأول' : 'الثاني'], ['التاريخ', fmtDate(todayISO())]])}
    <table class="pr big"><colgroup><col style="width:9mm"><col style="width:60mm">${cats.map(() => '<col>').join('')}<col><col><col></colgroup>
    <thead><tr><th>م</th><th>اسم الطالب</th>${cats.map(c => `<th class="vt">${e(c.name)}<br>(${c.weight})</th>`).join('')}<th>الأدائية (40)</th><th>الشهري (${scheme.monthly?.outOf || 20})</th><th>المجموع</th></tr></thead><tbody>${body}</tbody></table>
    <div class="pr-small" style="margin-top:4px">* درجة معدلة يدوياً بسبب مسجّل.</div>
    <div class="pr-foot"><div>المعلم: ${e(workspace()?.identity?.teacher || '')} — التوقيع: ............</div><div>اعتماد: ....................</div></div></section>`;
}
export { ATT_STATUS, termRange, DAY_NAMES, addDays, ws };
