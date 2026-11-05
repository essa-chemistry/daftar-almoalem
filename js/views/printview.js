// مركز الطباعة: كشف المتابعة الأسبوعي، كشف الحصة/اليوم، كشف درجات مهمة
import { html, useState } from '../lib.js';
import { classes, className, workspace, ws, get, calCtx } from '../store.js';
import { useStore, Icon, Btn, Empty, toast } from '../ui.js';
import { termRange, currentTerm, meetingsOn, meetingsRange, isHeldStatus } from '../calendar.js';
import { printHTML, weeklySheet, sessionSheet, taskSheet } from '../print.js';
import { todayISO, weekStart, addDays, fmtDate, fmtShort, DAY_NAMES, dow } from '../utils.js';
import { TASK_KINDS } from '../grading.js';

export function PrintPage({ q = {} }) {
  useStore();
  const cls = classes(); const w = workspace(); const today = todayISO();
  const t = currentTerm(w, today); const tr = termRange(w, t);
  const [o, setO] = useState({ classId: q.class || cls[0]?.id || '', range: 'week', term: t, from: weekStart(today), weeks: 4, to: addDays(weekStart(today), 27), wpp: 'auto', extra: 3, prefill: false, hijri: true });
  const [s, setS] = useState({ classId: q.class || cls[0]?.id || '', date: today, period: '', prefill: true, whole: false });
  const [tk, setTk] = useState({ taskId: '', classId: '' });
  if (!cls.length) return html`<div class="page"><div class="card"><${Empty} icon="print" title="لا توجد فصول بعد" /></div></div>`;
  const set = (k, v) => setO(x => ({ ...x, [k]: v }));

  const doWeekly = () => {
    let from, to;
    if (o.range === 'term') { const r = termRange(w, +o.term); if (!r) return toast('حدد تواريخ الفصل الدراسي من الإعدادات', 'warn'); from = r.start; to = r.end; }
    else if (o.range === 'week') { from = weekStart(o.from); to = addDays(from, 7 * (+o.weeks || 1) - 1); }
    else { from = o.from; to = o.to; }
    const h = weeklySheet({ classId: o.classId, from, to, weeksPerPage: o.wpp, extraRows: +o.extra, prefill: o.prefill, hijri: o.hijri });
    if (!h) return toast('لا توجد حصص لهذا الفصل في الفترة المختارة — تحقق من الجدول والتقويم', 'warn');
    printHTML(h, { landscape: true });
  };
  const dayMeetings = meetingsOn(calCtx(), s.date, s.classId).filter(m => isHeldStatus(m.status));
  const doSession = () => {
    const periods = s.whole ? (dayMeetings.length ? dayMeetings.map(m => m.period) : [null]) : [s.period === '' ? (dayMeetings[0]?.period ?? null) : +s.period];
    printHTML(periods.map(p => sessionSheet({ classId: s.classId, date: s.date, period: p, prefill: s.prefill })).join(''));
  };
  const tasks = ws('tasks').sort((a, b) => b.date.localeCompare(a.date));
  const task = get('tasks', tk.taskId);

  return html`<div class="page">
    <div class="page-head"><div><h1>الطباعة</h1><div class="sub">كل الكشوف بترويسة المدرسة والشعارين، A4، وتصلح للحفظ PDF من نافذة الطباعة.</div></div></div>
    ${!w.logos?.ministry || !w.logos?.school ? html`<div class="notice" style="margin-bottom:14px">لم تُرفع كل الشعارات بعد — ارفع شعار الوزارة وشعار المدرسة من <a href="#/settings/school">الإعدادات ← المدرسة</a>.</div>` : null}
    <div class="grid-2">
      <div class="card stack"><h2><${Icon} name="calendar" /> كشف المتابعة الأسبوعي</h2>
        <div class="form-grid">
          <label class="field"><span>الفصل</span><select value=${o.classId} onChange=${e => set('classId', e.target.value)}>${cls.map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select></label>
          <label class="field"><span>الفترة</span><select value=${o.range} onChange=${e => set('range', e.target.value)}><option value="week">أسابيع معينة</option><option value="term">فصل دراسي كامل</option><option value="custom">من تاريخ إلى تاريخ</option></select></label>
          ${o.range === 'term' ? html`<label class="field"><span>الفصل الدراسي</span><select value=${o.term} onChange=${e => set('term', +e.target.value)}><option value="1">الأول</option><option value="2">الثاني</option></select></label>` : null}
          ${o.range === 'week' ? html`<label class="field"><span>بداية من أسبوع</span><input type="date" value=${o.from} onInput=${e => set('from', e.target.value)} /></label><label class="field"><span>عدد الأسابيع</span><input type="number" min="1" max="30" value=${o.weeks} onInput=${e => set('weeks', e.target.value)} /></label>` : null}
          ${o.range === 'custom' ? html`<label class="field"><span>من</span><input type="date" value=${o.from} onInput=${e => set('from', e.target.value)} /></label><label class="field"><span>إلى</span><input type="date" value=${o.to} onInput=${e => set('to', e.target.value)} /></label>` : null}
          <label class="field"><span>الأسابيع في الصفحة</span><select value=${o.wpp} onChange=${e => set('wpp', e.target.value)}><option value="auto">تلقائي حسب عدد الحصص</option>${[1, 2, 3, 4, 5, 6, 8].map(n => html`<option value=${n}>${n}</option>`)}</select></label>
          <label class="field"><span>صفوف فارغة إضافية</span><input type="number" min="0" max="15" value=${o.extra} onInput=${e => set('extra', e.target.value)} /></label>
        </div>
        <div class="row"><label class="check"><input type="checkbox" checked=${o.hijri} onChange=${e => set('hijri', e.target.checked)} /> إظهار التاريخ الهجري</label><label class="check"><input type="checkbox" checked=${o.prefill} onChange=${e => set('prefill', e.target.checked)} /> تعبئة ما سُجّل (للأرشفة)</label></div>
        <p class="muted small" style="margin:0">يُبنى من الجدول الفعلي: عمود لكل حصة مجمّعة بالأسبوع، والإجازات والحصص الملغاة مظللة، والمنسحب مشطوب بعد تاريخ انسحابه. A4 أفقي.</p>
        <${Btn} cls="primary lg" onClick=${doWeekly}><${Icon} name="print" /> طباعة كشف المتابعة</${Btn}>
      </div>
      <div class="card stack"><h2><${Icon} name="file" /> كشف الحصة الواحدة أو اليوم</h2>
        <div class="form-grid">
          <label class="field"><span>الفصل</span><select value=${s.classId} onChange=${e => setS({ ...s, classId: e.target.value, period: '' })}>${cls.map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select></label>
          <label class="field"><span>التاريخ</span><input type="date" value=${s.date} onInput=${e => setS({ ...s, date: e.target.value, period: '' })} /></label>
          <label class="field"><span>الحصة</span><select value=${s.period} disabled=${s.whole} onChange=${e => setS({ ...s, period: e.target.value })}><option value="">${dayMeetings.length ? 'حصة الجدول' : 'بدون رقم'}</option>${(w.day?.periods || []).map(p => html`<option value=${p.n}>الحصة ${p.n}${dayMeetings.some(m => m.period === p.n) ? ' ✓' : ''}</option>`)}</select></label>
        </div>
        <div class="row"><label class="check"><input type="checkbox" checked=${s.whole} onChange=${e => setS({ ...s, whole: e.target.checked })} /> كل حصص هذا الفصل في اليوم</label><label class="check"><input type="checkbox" checked=${s.prefill} onChange=${e => setS({ ...s, prefill: e.target.checked })} /> تعبئة ما سُجّل</label></div>
        <p class="muted small" style="margin:0">${dayMeetings.length ? `حصص هذا الفصل في ${DAY_NAMES[dow(s.date)]}: ${dayMeetings.map(m => m.period).join('، ')}` : 'لا توجد حصة لهذا الفصل في الجدول بهذا التاريخ.'}</p>
        <${Btn} cls="primary lg" onClick=${doSession}><${Icon} name="print" /> طباعة كشف الحصة</${Btn}>
      </div>
      <div class="card stack"><h2><${Icon} name="tasks" /> كشف درجات مهمة أو اختبار</h2>
        <label class="field"><span>المهمة</span><select value=${tk.taskId} onChange=${e => setTk({ taskId: e.target.value, classId: get('tasks', e.target.value)?.class_ids?.[0] || '' })}><option value="">— اختر —</option>${tasks.map(t => html`<option value=${t.id}>${t.title} (${TASK_KINDS[t.kind]} — ${fmtShort(t.date)})</option>`)}</select></label>
        ${task && task.class_ids.length > 1 ? html`<label class="field"><span>الفصل</span><select value=${tk.classId} onChange=${e => setTk({ ...tk, classId: e.target.value })}>${task.class_ids.map(id => html`<option value=${id}>${className(get('classes', id))}</option>`)}</select></label>` : null}
        <${Btn} cls="primary lg" disabled=${!task} onClick=${() => printHTML(taskSheet({ taskId: tk.taskId, classId: tk.classId || task.class_ids[0] }))}><${Icon} name="print" /> طباعة كشف المهمة</${Btn}>
      </div>
      <div class="card stack"><h2><${Icon} name="grades" /> كشوف الدرجات</h2>
        <p class="muted" style="margin:0">كشف درجات الفصل وكشف تفصيل درجة الطالب يُطبعان من صفحة الدرجات.</p>
        <a class="btn" href="#/grades">الذهاب إلى الدرجات</a>
        <p class="muted small" style="margin:0">النماذج (رصد مشكلة سلوكية، الإحالة، تقرير ولي الأمر) والإدخال السريع من الكشف الورقي تأتي في المرحلة 2.</p>
      </div>
    </div></div>`;
}
