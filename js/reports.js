// التقارير المنسقة (تُطبع أو تُحفظ PDF من نافذة الطباعة): تقرير حضور الحصة، وتقرير حضور فترة
import { get, ws, all, workspace, className, classes, privateOf, roster, findSession, sessionAttendance, sessionEvents, enrollmentsOf, isEnrolledOn } from './store.js';
import { escapeHTML as e, fmtDate, DAY_NAMES, dow, normAr } from './utils.js';
import { formatName } from './display.js';
import { fmtH } from './plan.js';
import { NOTE_KINDS } from './defaults.js';
import { formDialog, toast } from './ui.js';
import { printHTML } from './print.js';
import { NAME_FMT } from './display.js';
import { tagLibrary } from './tags.js';

export const ST = {
  present: { label: 'حاضر', cls: 'ok', ic: 'M9 12l2 2 4-4M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18' },
  absent_unexcused: { label: 'غائب', cls: 'bad', ic: 'M15 9l-6 6M9 9l6 6M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18' },
  late: { label: 'متأخر', cls: 'warn', ic: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18' },
  escaped: { label: 'هارب', cls: 'esc', ic: 'M13 4a1.5 1.5 0 1 0 0 .1M10 20l2-6 3 3v4M7 12l3-4 4 1 3 3' },
  absent_excused: { label: 'غائب بعذر', cls: 'exc', ic: 'M8 7h8M8 11h8M8 15h5M6 3h12v18H6z' },
  permitted: { label: 'مستأذن', cls: 'perm', ic: 'M16 11V7a4 4 0 0 0-8 0v4M6 11h12v9H6z' },
};
const ORDER = ['present', 'late', 'permitted', 'escaped', 'absent_excused', 'absent_unexcused'];
const svg = d => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const g = iso => iso.split('-').reverse().join('/');
// نوع الحدث: هروب أو استئذان (حسب الاسم أو النوع النظامي)
const evKind = t => { if (!t) return null; const n = normAr(t.name || ''); if (t.sys === 'escape' || /هروب|هارب/.test(n)) return 'escaped'; if (t.sys === 'permission' || /مستاذن|استئذان|استيذان/.test(n)) return 'permitted'; return null; };

// حالة كل طالب في حصة
export function sessionStatuses(s) {
  const att = sessionAttendance(s.id); const evs = sessionEvents(s.id);
  const out = new Map();
  for (const x of roster(s.class_id, s.date)) {
    const sid = x.student.id; let st = att.get(sid)?.status || 'present';
    const k = evs.filter(ev => ev.student_id === sid).map(ev => evKind(get('event_types', ev.type_id))).find(Boolean);
    if (k && !st.startsWith('absent')) st = k;
    out.set(sid, { x, st });
  }
  return out;
}

function banner(title) {
  const w = workspace() || {}; const lg = w.logos || {}; const id = w.identity || {};
  const logo = lg.ministry || lg.school;
  return `<div class="rp-banner">${logo ? `<img src="${logo}" alt="">` : `<div class="rp-org"><b>${e(id.school || '')}</b><span>${e(id.admin || '')}</span></div>`}<h1>${e(title)}</h1><div class="rp-org l">${logo ? `<b>${e(id.school || '')}</b>` : ''}</div></div>`;
}
const info = pairs => `<div class="rp-info">${pairs.map(([k, v]) => `<div><span>${e(k)}</span><b>${v}</b></div>`).join('')}</div>`;
const cards = (counts, keys) => `<div class="rp-cards">${keys.map(k => `<div class="rp-card ${ST[k].cls}"><i>${svg(ST[k].ic)}</i><span>${ST[k].label}</span><b>${counts[k] || 0}</b></div>`).join('')}</div>`;
const sign = () => { const id = workspace()?.identity || {}; return `<div class="rp-sign"><div><span>المعلم</span><b>${e(id.teacher || '')}</b></div><div><span>المدير</span><b>${e(id.principal || '')}</b></div><div><span>المدرسة</span><b>${e(id.school || '')}</b></div></div>`; };

// ---------- تقرير حضور الحصة (اليومي) ----------
export function attendanceReport({ sessionId = null, classId = null, date = null, period = null, nameFmt = 'full', order = 'status' }) {
  const s = sessionId ? get('sessions', sessionId) : findSession(classId, date, period ? +period : null);
  if (!s) return `<section class="pr-page rp-page">${banner('كشف حضور الطلاب اليومي')}<p style="text-align:center;margin-top:30mm">لم تُسجَّل حصة لهذا الفصل في هذا التاريخ.</p></section>`;
  const c = get('classes', s.class_id); const id = workspace()?.identity || {};
  const map = sessionStatuses(s); const rows = [...map.values()];
  const counts = {}; for (const r of rows) counts[r.st] = (counts[r.st] || 0) + 1;
  const sorted = order === 'status' ? rows.sort((a, b) => ORDER.indexOf(a.st) - ORDER.indexOf(b.st) || normAr(a.x.student.full_name).localeCompare(normAr(b.x.student.full_name), 'ar')) : rows;
  return `<section class="pr-page rp-page">${banner('كشف حضور الطلاب اليومي')}
    ${info([['الصف', e(className(c))], ['المادة', e(id.subject || '')], ['التاريخ', `${fmtH(s.date)}هـ <small>${DAY_NAMES[dow(s.date)]} ${g(s.date)}</small>`], ['الحصة', s.period ? `الحصة ${s.period}` : 'حصة إضافية']])}
    <div class="rp-sec"><h2>ملخص الحضور والغياب</h2><span class="rp-pill">عدد الطلاب: ${rows.length}</span></div>
    ${cards(counts, ['present', 'absent_unexcused', 'late', 'escaped', 'absent_excused', 'permitted'])}
    <div class="rp-sec"><h2>سجل الحضور</h2></div>
    <table class="rp-tbl"><thead><tr><th style="width:12mm">#</th><th>اسم الطالب</th><th style="width:38mm">حالة الحضور</th></tr></thead>
    <tbody>${sorted.map((r, i) => `<tr><td>${i + 1}</td><td class="nm">${e(formatName(r.x.student.full_name, nameFmt))}</td><td><span class="rp-chip ${ST[r.st].cls}">${svg(ST[r.st].ic)} ${ST[r.st].label}</span></td></tr>`).join('')}</tbody></table>
    ${sign()}</section>`;
}

// ---------- تقرير حضور فترة (لكل طالب: الحضور والغياب والتأخر… ونسبة الحضور) ----------
export function periodAttendanceReport({ classId, from, to, nameFmt = 'full', order = 'alpha' }) {
  const c = get('classes', classId); const id = workspace()?.identity || {};
  const sess = ws('sessions', s => s.class_id === classId && s.date >= from && s.date <= to).sort((a, b) => a.date.localeCompare(b.date) || (a.period || 0) - (b.period || 0));
  const per = new Map();
  for (const s of sess) for (const [sid, r] of sessionStatuses(s)) {
    const o = per.get(sid) || { x: r.x, n: 0 }; o.n++; o[r.st] = (o[r.st] || 0) + 1; per.set(sid, o);
  }
  const rows = [...per.values()];
  if (order === 'alpha') rows.sort((a, b) => normAr(a.x.student.full_name).localeCompare(normAr(b.x.student.full_name), 'ar'));
  else if (order === 'absence') rows.sort((a, b) => ((b.absent_unexcused || 0) + (b.absent_excused || 0)) - ((a.absent_unexcused || 0) + (a.absent_excused || 0)));
  const tot = {}; for (const r of rows) for (const k of ORDER) tot[k] = (tot[k] || 0) + (r[k] || 0);
  const pct = r => (r.n ? Math.round((r.n - (r.absent_unexcused || 0) - (r.absent_excused || 0) - (r.escaped || 0)) / r.n * 100) : 0);
  return `<section class="pr-page rp-page">${banner('تقرير حضور الطلاب لفترة')}
    ${info([['الصف', e(className(c))], ['المادة', e(id.subject || '')], ['من', `${fmtH(from)}هـ <small>${g(from)}</small>`], ['إلى', `${fmtH(to)}هـ <small>${g(to)}</small>`]])}
    <div class="rp-sec"><h2>ملخص الفترة</h2><span class="rp-pill">${sess.length} حصة • ${rows.length} طالب</span></div>
    ${cards(tot, ['present', 'absent_unexcused', 'late', 'escaped', 'absent_excused', 'permitted'])}
    <div class="rp-sec"><h2>تفصيل الطلاب</h2></div>
    <table class="rp-tbl"><thead><tr><th style="width:9mm">#</th><th>اسم الطالب</th><th>حضور</th><th>غياب</th><th>بعذر</th><th>تأخر</th><th>هروب</th><th>استئذان</th><th style="width:30mm">نسبة الحضور</th></tr></thead>
    <tbody>${rows.map((r, i) => { const p = pct(r); return `<tr><td>${i + 1}</td><td class="nm">${e(formatName(r.x.student.full_name, nameFmt))}</td>
      <td>${(r.present || 0) + (r.late || 0) + (r.permitted || 0)}</td><td class="${r.absent_unexcused ? 'b' : ''}">${r.absent_unexcused || 0}</td><td>${r.absent_excused || 0}</td><td>${r.late || 0}</td><td class="${r.escaped ? 'b' : ''}">${r.escaped || 0}</td><td>${r.permitted || 0}</td>
      <td><div class="rp-bar ${p < 75 ? 'bad' : p < 90 ? 'warn' : 'ok'}"><i style="width:${p}%"></i><b>${p}%</b></div></td></tr>`; }).join('') || '<tr><td colspan="9">لا توجد حصص مسجلة في هذه الفترة</td></tr>'}</tbody></table>
    <div class="rp-note">الحضور يشمل المتأخر والمستأذن. نسبة الحضور = (الحصص − الغياب بنوعيه − الهروب) ÷ حصص الطالب. طُبع في ${e(fmtDate(new Date().toISOString().slice(0, 10)))}.</div>
    ${sign()}</section>`;
}

// ---------- تقرير ملاحظات المعلم الخاصة: الطلاب الذين سُجّل لهم وسم أو ملاحظة أو تنبيه صحي فقط ----------
export function privateNotesRows({ classIds = null, tag = '', inc = { tags: true, notes: true, health: true }, from = '', to = '' } = {}) {
  const cls = classes().filter(c => !classIds || classIds.includes(c.id));
  const out = [];
  for (const c of cls) for (const x of roster(c.id)) {
    const sid = x.student.id; const pv = privateOf(sid);
    const tags = inc.tags ? (pv.tags || []) : [];
    if (tag && !(pv.tags || []).includes(tag)) continue;
    const notes = inc.notes ? all('notes', n => n.student_id === sid && !n.deleted && (!from || n.date >= from) && (!to || n.date <= to)).sort((a, b) => (a.date || '').localeCompare(b.date || '')) : [];
    const health = inc.health ? (pv.health || []) : []; const hnote = inc.health ? (pv.health_note || '').trim() : '';
    if (!tags.length && !notes.length && !health.length && !hnote) continue;
    out.push({ c, x, tags, notes, health, hnote, starred: !!pv.starred });
  }
  return out;
}
export function privateNotesReport(opt = {}) {
  const { nameFmt = 'full' } = opt; const rows = privateNotesRows(opt); const id = workspace()?.identity || {};
  const byClass = new Map(); for (const r of rows) { if (!byClass.has(r.c.id)) byClass.set(r.c.id, []); byClass.get(r.c.id).push(r); }
  const nNotes = rows.reduce((a, r) => a + r.notes.length, 0);
  const tagCount = new Map(); for (const r of rows) for (const t of r.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  const card = (r, i) => `<div class="rp-st">
      <div class="rp-st-h"><span class="n">${i + 1}</span><b>${e(formatName(r.x.student.full_name, nameFmt))}</b>${r.starred ? '<span class="star">★</span>' : ''}<small>${e(className(r.c))}${r.x.student.seat_no ? ' • رقم ' + e(r.x.student.seat_no) : ''}</small></div>
      ${r.tags.length ? `<div class="rp-st-row"><span class="k">الوسوم</span><div>${r.tags.map(t => `<span class="rp-tag">${e(t)}</span>`).join('')}</div></div>` : ''}
      ${r.health.length || r.hnote ? `<div class="rp-st-row"><span class="k">تنبيه صحي</span><div>${r.health.map(t => `<span class="rp-tag h">${e(t)}</span>`).join('')}${r.hnote ? ` <span class="txt">${e(r.hnote)}</span>` : ''}</div></div>` : ''}
      ${r.notes.length ? `<div class="rp-st-row"><span class="k">الملاحظات</span><ol>${r.notes.map(n => `<li><small>${n.date ? fmtH(n.date) + 'هـ' : ''}${NOTE_KINDS[n.kind] && n.kind !== 'general' ? ' • ' + e(NOTE_KINDS[n.kind]) : ''}${n.kind === 'reminder' ? (n.done ? ' • تم' : ' • لم يُنفَّذ') : ''}</small> ${e(n.text)}</li>`).join('')}</ol></div>` : ''}
    </div>`;
  return `<section class="pr-page rp-page">${banner('ملاحظات المعلم ووسومه')}
    ${info([['المعلم', e(id.teacher || '')], ['المادة', e(id.subject || '')], ['الفصول', String(byClass.size)], ['تاريخ الطباعة', `${fmtH(new Date().toISOString().slice(0, 10))}هـ`]])}
    <div class="rp-sec"><h2>الملخص</h2><span class="rp-pill">${rows.length} طالب • ${nNotes} ملاحظة${opt.tag ? ` • وسم «${e(opt.tag)}»` : ''}</span></div>
    ${tagCount.size ? `<div class="rp-tagsum">${[...tagCount.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="rp-tag">${e(t)} <b>${n}</b></span>`).join('')}</div>` : ''}
    ${rows.length ? [...byClass.values()].map(list => `<div class="rp-sec"><h2>${e(className(list[0].c))}</h2><span class="rp-pill">${list.length} طالب</span></div><div class="rp-sts">${list.map(card).join('')}</div>`).join('') : '<p style="text-align:center;margin:20mm 0">لا يوجد طلاب عليهم وسوم أو ملاحظات بهذه الشروط.</p>'}
    <div class="rp-note">سري — للمعلم فقط. يشمل الطلاب الذين سُجّل لهم وسم أو ملاحظة خاصة أو تنبيه صحي فقط.</div></section>`;
}

export async function openNotesReport({ classId = null, tag = '' } = {}) {
  const cls = classes();
  const v = await formDialog({ title: 'طباعة ملاحظات المعلم ووسومه', okText: 'إنشاء التقرير', fields: [
    { name: 'scope', label: 'الفصول', type: 'select', value: classId || 'all', options: [{ value: 'all', label: 'كل الفصول' }, ...cls.map(c => ({ value: c.id, label: className(c) }))] },
    { name: 'inc', label: 'يشمل', type: 'select', value: 'all', options: [{ value: 'all', label: 'الوسوم والملاحظات والتنبيهات الصحية' }, { value: 'tags', label: 'الوسوم فقط' }, { value: 'notes', label: 'الملاحظات الخاصة فقط' }, { value: 'tags_notes', label: 'الوسوم والملاحظات (بدون الصحية)' }, { value: 'health', label: 'التنبيهات الصحية فقط' }] },
    { name: 'tag', label: 'وسم معيّن (اختياري)', type: 'select', value: tag, options: [{ value: '', label: 'كل الطلاب الذين عليهم تسجيل' }, ...tagLibrary().map(t => ({ value: t, label: t }))] },
    { name: 'from', label: 'الملاحظات من تاريخ (اختياري)', type: 'date', value: '' },
    { name: 'to', label: 'إلى تاريخ (اختياري)', type: 'date', value: '' },
    { name: 'name', label: 'اسم الطالب', type: 'select', value: 'full', options: Object.entries(NAME_FMT).map(([value, label]) => ({ value, label })) },
  ] });
  if (!v) return;
  const inc = { all: { tags: true, notes: true, health: true }, tags: { tags: true }, notes: { notes: true }, tags_notes: { tags: true, notes: true }, health: { health: true } }[v.inc];
  const opt = { classIds: v.scope === 'all' ? null : [v.scope], tag: v.tag, inc, from: v.from, to: v.to, nameFmt: v.name === 'full' ? 'full' : +v.name };
  if (!privateNotesRows(opt).length) return toast('لا يوجد طلاب عليهم تسجيل بهذه الشروط', 'warn');
  printHTML(privateNotesReport(opt));
}
