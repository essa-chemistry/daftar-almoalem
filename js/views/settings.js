// الإعدادات: المدرسة والشعارات، التقويم، اليوم الدراسي، الجدول بنسخه، الاستثناءات، أنواع الأحداث،
// توزيع الدرجات، الاختيار، المظهر، الحساب، النسخ الاحتياطي، سجل التدقيق، مساحات العمل
import { html, useState } from '../lib.js';
import { S, get, all, ws, save, saveMany, patch, purge, audit, workspace, classes, className, eventTypes, timetables, emit } from '../store.js';
import { useStore, Icon, Btn, Tabs, Empty, go, formDialog, confirmDialog, toast } from '../ui.js';
import { buildPeriods, weeklyCounts, HOLIDAY_KINDS, EXC_KINDS, termRange } from '../calendar.js';
import { defaultScheme, validateScheme, METHODS, TASK_KINDS } from '../grading.js';
import { createWorkspace, setWorkspace, deleteWorkspaceData } from '../ops.js';
import { exportJSON, exportExcel, restoreJSON } from '../backup.js';
import { SYNC, signOut, syncNow, configured } from '../sync.js';
import { setUI, getUI } from '../theme.js';
import { schemeFor } from '../gradeutil.js';
import { PortalSettings } from './portal.js';
import { DEFAULT_REFERRAL_REASONS, DEFAULT_PARENT_TEMPLATES, SEVERITIES, severityOf } from '../defaults.js';
import { daysBetween, addDays, weekStart } from '../utils.js';
import { DAY_NAMES, todayISO, compressImage, fmtDate, fmtDateTime, uuid, fmtNum, GRADE_NAMES } from '../utils.js';

const TABS = [
  { key: 'school', label: 'المدرسة' }, { key: 'calendar', label: 'التقويم' }, { key: 'day', label: 'اليوم الدراسي' },
  { key: 'timetable', label: 'الجدول' }, { key: 'exceptions', label: 'استثناءات الجدول' }, { key: 'events', label: 'أنواع الأحداث' },
  { key: 'grading', label: 'توزيع الدرجات' }, { key: 'forms', label: 'النماذج' }, { key: 'portal', label: 'بوابة الطالب' }, { key: 'picker', label: 'الاختيار العادل' }, { key: 'display', label: 'المظهر' },
  { key: 'account', label: 'الحساب والمزامنة' }, { key: 'backup', label: 'النسخ الاحتياطي' }, { key: 'audit', label: 'سجل التدقيق' },
  { key: 'workspaces', label: 'مساحات العمل' },
];

export function SettingsPage({ tab = 'school' }) {
  useStore();
  const w = workspace();
  if (!w) return null;
  const T = { school: SchoolTab, calendar: CalendarTab, day: DayTab, timetable: TimetableTab, exceptions: ExceptionsTab, events: EventsTab, grading: GradingTab, forms: FormsTab, portal: PortalSettings, picker: PickerTab, display: DisplayTab, account: AccountTab, backup: BackupTab, audit: AuditTab, workspaces: WorkspacesTab }[tab] || SchoolTab;
  return html`<div class="page"><div class="page-head"><div><h1>الإعدادات</h1><div class="sub">${w.name} — اللوائح تضبطها أنت؛ لا شيء مفروض في الكود.</div></div></div>
    <${Tabs} active=${tab} onChange=${t => go('#/settings/' + t)} tabs=${TABS} /><${T} w=${w} /></div>`;
}
const upd = (w, changes) => patch('workspaces', w.id, changes);
const Field = ({ label, children, full, hint }) => html`<label class=${'field' + (full ? ' full' : '')}><span>${label}</span>${children}${hint ? html`<small>${hint}</small>` : null}</label>`;

// ---------- المدرسة ----------
function SchoolTab({ w }) {
  const id = w.identity || {};
  const setId = (k, v) => upd(w, { identity: { ...id, [k]: v } });
  const F = (k, label, ph = '') => html`<${Field} label=${label}><input value=${id[k] || ''} placeholder=${ph} onChange=${e => setId(k, e.target.value.trim())} /></${Field}>`;
  const upload = async (which, e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const data = await compressImage(f, { maxDim: 600, maxBytes: 200000, keepAlpha: true }); await upd(w, { logos: { ...(w.logos || {}), [which]: data } }); toast('حُفظ الشعار', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  };
  const Logo = ({ which, label }) => html`<div class="card flat" style="display:grid;gap:10px;justify-items:center;text-align:center">
    <b>${label}</b>
    <div style="height:90px;display:grid;place-items:center">${w.logos?.[which] ? html`<img src=${w.logos[which]} style="max-height:90px;max-width:200px;object-fit:contain" alt="" />` : html`<span class="muted small">لم يُرفع بعد</span>`}</div>
    <div class="row"><label class="btn sm"><${Icon} name="upload" size=${16} /> رفع صورة<input type="file" accept="image/*" hidden onChange=${e => upload(which, e)} /></label>${w.logos?.[which] ? html`<button class="btn sm ghost" onClick=${() => upd(w, { logos: { ...w.logos, [which]: null } })}>حذف</button>` : null}</div></div>`;
  return html`<div class="stack">
    <div class="card"><h2>مساحة العمل</h2><div class="form-grid">
      <${Field} label="اسم مساحة العمل"><input value=${w.name} onChange=${e => upd(w, { name: e.target.value })} /></${Field}>
      <${Field} label="السنة الدراسية"><input value=${w.year_label || ''} placeholder="1448هـ" onChange=${e => upd(w, { year_label: e.target.value })} /></${Field}></div></div>
    <div class="card"><h2>هوية المدرسة (للترويسات)</h2><div class="form-grid">
      ${F('country', 'السطر الأول', 'المملكة العربية السعودية')}${F('ministry', 'السطر الثاني', 'وزارة التعليم')}
      ${F('admin', 'إدارة التعليم', 'الإدارة العامة للتعليم بمحافظة …')}${F('region', 'المنطقة / المحافظة')}
      ${F('school', 'اسم المدرسة')}${F('teacher', 'اسم المعلم')}${F('subject', 'المادة', 'كيمياء')}
      ${F('principal', 'مدير المدرسة')}${F('deputy', 'الوكيل')}${F('counselor', 'المرشد الطلابي')}</div></div>
    <div class="card"><h2>الشعارات</h2><p class="muted small" style="margin-top:0">ارفع الشعارين بصورة؛ تُضغط في المتصفح وتُحفظ بحد أقصى 200KB لكل شعار. التطبيق لا يرسم أي شعار من عنده.</p>
      <div class="grid-2"><${Logo} which="ministry" label="شعار الوزارة" /><${Logo} which="school" label="شعار المدرسة" /></div></div>
  </div>`;
}

// ---------- التقويم ----------
function CalendarTab({ w }) {
  const cal = w.calendar || {};
  const terms = cal.terms || [{}, {}];
  const setTerm = (i, k, v) => { const t = terms.map((x, j) => j === i ? { ...x, [k]: v } : x); upd(w, { calendar: { ...cal, terms: t } }); };
  const wd = cal.workdays || [0, 1, 2, 3, 4];
  const addHol = async (h = null) => {
    const v = await formDialog({ title: h ? 'تعديل' : 'إضافة إجازة / تعطيل / اختبارات', fields: [
      { name: 'kind', label: 'النوع', type: 'select', options: Object.entries(HOLIDAY_KINDS).map(([value, label]) => ({ value, label })), value: h?.kind || 'holiday' },
      { name: 'label', label: 'الوصف', value: h?.label || '', placeholder: 'إجازة منتصف الفصل…' },
      { name: 'from', label: 'من', type: 'date', value: h?.from || todayISO(), required: true },
      { name: 'to', label: 'إلى', type: 'date', value: h?.to || h?.from || todayISO(), required: true },
    ], validate: v => v.to < v.from ? 'تاريخ النهاية قبل البداية' : null });
    if (!v) return;
    const list = (cal.holidays || []).filter(x => x.id !== h?.id);
    await upd(w, { calendar: { ...cal, holidays: [...list, { id: h?.id || uuid(), ...v }].sort((a, b) => a.from.localeCompare(b.from)) } });
  };
  return html`<div class="stack">
    <div class="card"><h2>الفصلان الدراسيان</h2><div class="form-grid">${[0, 1].map(i => html`
      <${Field} label=${`بداية الفصل ${i ? 'الثاني' : 'الأول'}`}><input type="date" value=${terms[i]?.start || ''} onChange=${e => setTerm(i, 'start', e.target.value)} /></${Field}>
      <${Field} label=${`نهاية الفصل ${i ? 'الثاني' : 'الأول'}`}><input type="date" value=${terms[i]?.end || ''} onChange=${e => setTerm(i, 'end', e.target.value)} /></${Field}>`)}</div></div>
    <${PeriodsCard} w=${w} />
    <div class="card"><h2>أيام الدوام</h2><div class="chips">${DAY_NAMES.map((d, i) => html`<button class=${'chip' + (wd.includes(i) ? ' on' : '')} onClick=${() => upd(w, { calendar: { ...cal, workdays: wd.includes(i) ? wd.filter(x => x !== i) : [...wd, i].sort() } })}>${d}</button>`)}</div></div>
    <div class="card"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">الإجازات وأسابيع الاختبارات وأيام التعطيل</h2><span class="grow"></span><button class="btn primary sm" onClick=${() => addHol()}><${Icon} name="plus" size=${16} /> إضافة</button></div>
      ${(cal.holidays || []).length ? html`<div class="list">${cal.holidays.map(h => html`<div class="li"><span class=${'badge ' + (h.kind === 'exams' ? 'warn' : 'pri')}>${HOLIDAY_KINDS[h.kind]}</span><div class="grow"><div class="main-t">${h.label || HOLIDAY_KINDS[h.kind]}</div><div class="sub-t">${fmtDate(h.from)}${h.to && h.to !== h.from ? ' — ' + fmtDate(h.to) : ''}</div></div>
        <button class="icon-btn" onClick=${() => addHol(h)}><${Icon} name="edit" size=${18} /></button><button class="icon-btn" onClick=${() => upd(w, { calendar: { ...cal, holidays: cal.holidays.filter(x => x.id !== h.id) } })}><${Icon} name="trash" size=${18} /></button></div>`)}</div>` : html`<p class="muted">لا شيء بعد.</p>`}
      <p class="muted small">هذه الأيام لا تُحتسب غياباً ولا تدخل في عدد الحصص، وتظهر مظللة في الكشوف.</p></div>
  </div>`;
}

// ---------- فترات التقويم ----------
const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
function splitTerm(t, n) {
  // تقسيم الفصل إلى n فترات متساوية تقريباً على حدود الأسابيع (تبدأ الأحد)
  const days = daysBetween(t.start, t.end) + 1, out = [];
  let start = t.start;
  for (let i = 0; i < n; i++) {
    let end = i === n - 1 ? t.end : addDays(t.start, Math.round(days * (i + 1) / n) - 1);
    if (i < n - 1) { const ws0 = weekStart(addDays(end, 1)); end = addDays(ws0, -1); if (end < start) end = addDays(start, 6); }
    out.push({ id: uuid(), label: `التقويم ${ORD[i] || i + 1}`, start, end, cumulative: false });
    start = addDays(end, 1);
  }
  return out;
}
function PeriodsCard({ w }) {
  const cal = w.calendar || {}; const terms = cal.terms || [{}, {}];
  const [ti, setTi] = useState(0);
  const t = terms[ti] || {}; const ps = (t.periods || []).slice().sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const save_ = async list => { const nt = terms.map((x, j) => j === ti ? { ...x, periods: list } : x); await upd(w, { calendar: { ...cal, terms: nt } }); };
  const setP = (id, k, v) => save_(ps.map(p => p.id === id ? { ...p, [k]: v } : p));
  const auto = async n => {
    if (!t.start || !t.end) return toast('حدد بداية ونهاية الفصل الدراسي أولاً', 'warn');
    if (ps.length && !await confirmDialog({ title: 'تقسيم تلقائي', message: 'ستُستبدل الفترات الحالية. التعديلات اليدوية والاعتمادات المرتبطة بالفترات القديمة لن تظهر في الفترات الجديدة.', okText: 'تقسيم' })) return;
    await save_(splitTerm(t, n)); await audit('ضبط فترات التقويم', `الفصل الدراسي ${ti + 1}: ${n} فترات`);
  };
  const add = () => { const last = ps[ps.length - 1]; const start = last?.end ? addDays(last.end, 1) : (t.start || todayISO()); save_([...ps, { id: uuid(), label: `التقويم ${ORD[ps.length] || ps.length + 1}`, start, end: t.end && t.end >= start ? t.end : start, cumulative: false }]); };
  const remove = async p => { if (await confirmDialog({ title: 'حذف الفترة', message: `حذف «${p.label}»؟ الأحداث والدرجات لا تُحذف؛ تبقى ضمن الفصل الدراسي.`, danger: true, okText: 'حذف' })) await save_(ps.filter(x => x.id !== p.id)); };
  const issues = [];
  ps.forEach((p, i) => {
    if (p.end < p.start) issues.push(`«${p.label}»: النهاية قبل البداية`);
    if (t.start && (p.start < t.start || p.end > t.end)) issues.push(`«${p.label}» تخرج عن تواريخ الفصل الدراسي`);
    if (i && ps[i - 1].end >= p.start) issues.push(`«${ps[i - 1].label}» و«${p.label}» متداخلتان`);
  });
  return html`<div class="card stack">
    <div class="row"><h2 style="margin:0">فترات التقويم</h2><span class="grow"></span><div class="chips">${[0, 1].map(i => html`<button class=${'chip' + (ti === i ? ' on' : '')} onClick=${() => setTi(i)}>الفصل ${i ? 'الثاني' : 'الأول'}</button>`)}</div></div>
    <p class="muted small" style="margin:0">اختياري. قسّم الفصل الدراسي إلى فترات تقويم إن كنت ترفع تقييم الطالب أكثر من مرة. كل فترة تُحسب درجتها (40) من أحداثها ومهامها فقط، أو «تراكمياً» من بداية الفصل حتى نهايتها. بدون فترات تُحسب الدرجة على الفصل كاملاً.</p>
    ${ps.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>الفترة</th><th>من</th><th>إلى</th><th>طريقة الحساب</th><th></th></tr></thead><tbody>
      ${ps.map(p => html`<tr key=${p.id}><td><input value=${p.label} onChange=${e => setP(p.id, 'label', e.target.value.trim() || p.label)} style="min-width:130px" /></td>
        <td><input type="date" value=${p.start} onChange=${e => setP(p.id, 'start', e.target.value)} /></td>
        <td><input type="date" value=${p.end} onChange=${e => setP(p.id, 'end', e.target.value)} /></td>
        <td><select value=${p.cumulative ? 'c' : 'n'} onChange=${e => setP(p.id, 'cumulative', e.target.value === 'c')} style="min-width:200px"><option value="n">مستقلة (من بداية الفترة)</option><option value="c">تراكمية (من بداية الفصل الدراسي)</option></select></td>
        <td><button class="icon-btn" onClick=${() => remove(p)}><${Icon} name="trash" size=${16} /></button></td></tr>`)}
    </tbody></table></div>` : null}
    ${issues.length ? html`<div class="error small">${issues.join(' • ')}</div>` : null}
    <div class="row"><button class="btn sm soft" onClick=${() => auto(2)}>تقسيم إلى فترتين</button><button class="btn sm soft" onClick=${() => auto(3)}>إلى ثلاث فترات</button><button class="btn sm ghost" onClick=${add}><${Icon} name="plus" size=${16} /> فترة</button>
      ${ps.length ? html`<button class="btn sm ghost" onClick=${async () => { if (await confirmDialog({ title: 'إلغاء الفترات', message: 'ستعود الدرجة لتُحسب على الفصل الدراسي كاملاً.', okText: 'إلغاء الفترات' })) await save_([]); }}>إلغاء الفترات</button>` : null}</div>
  </div>`;
}

// ---------- اليوم الدراسي ----------
function DayTab({ w }) {
  const d = w.day || {};
  const [g, setG] = useState({ start: d.start || '07:00', count: d.count || 7, duration: d.duration || 50, gap: d.gap || 0, breaks: d.breaks || [] });
  const regen = async () => {
    const periods = buildPeriods({ start: g.start, count: +g.count, duration: +g.duration, gap: +g.gap, breaks: g.breaks });
    await upd(w, { day: { ...d, ...g, count: +g.count, duration: +g.duration, gap: +g.gap, periods, end: periods[periods.length - 1]?.end } });
    toast('حُدّثت أوقات الحصص', 'ok');
  };
  const setP = (i, k, v) => upd(w, { day: { ...d, periods: d.periods.map((p, j) => j === i ? { ...p, [k]: v } : p) } });
  return html`<div class="grid-2">
    <div class="card stack"><h2>توليد الحصص</h2><div class="form-grid">
      <${Field} label="بداية اليوم"><input type="time" value=${g.start} onInput=${e => setG({ ...g, start: e.target.value })} /></${Field}>
      <${Field} label="عدد الحصص"><input type="number" min="1" max="10" value=${g.count} onInput=${e => setG({ ...g, count: e.target.value })} /></${Field}>
      <${Field} label="مدة الحصة (دقيقة)"><input type="number" min="20" max="120" value=${g.duration} onInput=${e => setG({ ...g, duration: e.target.value })} /></${Field}>
      <${Field} label="فاصل بين الحصص (دقيقة)"><input type="number" min="0" max="20" value=${g.gap} onInput=${e => setG({ ...g, gap: e.target.value })} /></${Field}></div>
      <div><div class="section-title">الفسح</div>${g.breaks.map((b, i) => html`<div class="row" style="margin-bottom:6px"><span>بعد الحصة</span><input type="number" style="width:70px" value=${b.after} onInput=${e => setG({ ...g, breaks: g.breaks.map((x, j) => j === i ? { ...x, after: +e.target.value } : x) })} /><span>لمدة</span><input type="number" style="width:80px" value=${b.minutes} onInput=${e => setG({ ...g, breaks: g.breaks.map((x, j) => j === i ? { ...x, minutes: +e.target.value } : x) })} /><span>دقيقة</span><input style="width:130px" value=${b.label || ''} placeholder="الوصف" onInput=${e => setG({ ...g, breaks: g.breaks.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} /><button class="icon-btn" onClick=${() => setG({ ...g, breaks: g.breaks.filter((_, j) => j !== i) })}><${Icon} name="trash" size=${16} /></button></div>`)}
        <button class="btn sm ghost" onClick=${() => setG({ ...g, breaks: [...g.breaks, { after: 3, minutes: 20, label: 'فسحة' }] })}>+ فسحة</button></div>
      <${Btn} cls="primary" onClick=${regen}>توليد أوقات الحصص</${Btn}></div>
    <div class="card"><h2>أوقات الحصص</h2><p class="muted small" style="margin-top:0">يمكن تعديل كل حصة يدوياً.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>الحصة</th><th>البداية</th><th>النهاية</th></tr></thead><tbody>${(d.periods || []).map((p, i) => html`<tr><td><b>${p.n}</b></td><td><input type="time" value=${p.start} onChange=${e => setP(i, 'start', e.target.value)} /></td><td><input type="time" value=${p.end} onChange=${e => setP(i, 'end', e.target.value)} /></td></tr>`)}</tbody></table></div></div>
  </div>`;
}

// ---------- الجدول ----------
function TimetableTab({ w }) {
  const versions = timetables();
  const [vid, setVid] = useState(versions[versions.length - 1]?.id || '');
  const v = get('timetables', vid) || versions[versions.length - 1];
  const cls = classes(); const periods = w.day?.periods || []; const days = (w.calendar?.workdays || [0, 1, 2, 3, 4]);
  const editDate = async () => {
    const t1 = termRange(w, 1);
    const isFirst = v.id === versions[0]?.id;
    const r = await formDialog({ title: 'تاريخ سريان هذه النسخة', fields: [{ name: 'from', label: 'ساري من تاريخ', type: 'date', value: v.effective_from, required: true, hint: isFirst && t1 ? `لأول نسخة يُنصح ببداية الفصل الدراسي (${t1.start}) حتى تظهر الحصص الماضية` : '' }] });
    if (!r || r.from === v.effective_from) return;
    if (versions.some(x => x.id !== v.id && x.effective_from === r.from)) return toast('توجد نسخة أخرى بالتاريخ نفسه', 'warn');
    await patch('timetables', v.id, { effective_from: r.from });
    await audit('تعديل تاريخ سريان الجدول', `${v.effective_from} ← ${r.from}`);
    toast('حُدّث تاريخ السريان', 'ok');
  };
  const newVersion = async () => {
    // أول نسخة تسري افتراضياً من بداية الفصل الدراسي الأول حتى تظهر الحصص الماضية
    const first = !versions.length ? (termRange(w, 1)?.start || todayISO()) : todayISO();
    const r = await formDialog({ title: 'نسخة جدول جديدة', fields: [{ name: 'from', label: 'ساري من تاريخ', type: 'date', value: first, required: true }, { name: 'label', label: 'الوصف', value: v ? 'تعديل الجدول' : 'الجدول الأسبوعي' }] });
    if (!r) return;
    if (versions.some(x => x.effective_from === r.from)) return toast('توجد نسخة بالتاريخ نفسه', 'warn');
    const nv = await save('timetables', { effective_from: r.from, label: r.label, slots: v ? JSON.parse(JSON.stringify(v.slots)) : [] });
    await audit('نسخة جدول جديدة', `سارية من ${r.from}`);
    setVid(nv.id);
  };
  if (!v) return html`<div class="card"><${Empty} icon="calendar" title="لم يُنشأ جدول بعد">${!cls.length ? html`<span>أضف الفصول أولاً (أو استورد الطلاب).</span>` : null}<button class="btn primary" onClick=${newVersion}>إنشاء الجدول</button></${Empty}></div>`;
  const slotAt = (day, period) => v.slots.find(s => s.day === day && s.period === period);
  const setSlot = async (day, period, class_id) => {
    const slots = v.slots.filter(s => !(s.day === day && s.period === period));
    if (class_id) slots.push({ day, period, class_id, subject: w.identity?.subject || '' });
    await patch('timetables', v.id, { slots });
  };
  const counts = weeklyCounts(v, cls);
  const isLatest = v.id === versions[versions.length - 1].id;
  return html`<div class="stack">
    <div class="card"><div class="row"><label class="field" style="min-width:260px"><span>نسخة الجدول</span><select value=${v.id} onChange=${e => setVid(e.target.value)}>${versions.map(x => html`<option value=${x.id}>${x.label || 'جدول'} — ساري من ${fmtDate(x.effective_from, 'g')}</option>`)}</select></label>
      <span class="grow"></span><button class="btn" onClick=${editDate}><${Icon} name="calendar" /> تعديل تاريخ السريان</button><button class="btn soft" onClick=${newVersion}><${Icon} name="plus" /> نسخة جديدة بتاريخ سريان</button>
      ${versions.length > 1 ? html`<button class="btn ghost" onClick=${async () => { if (await confirmDialog({ title: 'حذف نسخة الجدول', message: 'حذف هذه النسخة؟', danger: true, okText: 'حذف' })) { await purge('timetables', [v.id]); setVid(''); } }}><${Icon} name="trash" /></button>` : null}</div>
      ${!isLatest ? html`<div class="notice" style="margin-top:10px">تعدّل نسخة قديمة؛ هذا يغيّر الحصص المحسوبة لفترتها. لتغيير الجدول من الآن فصاعداً أنشئ «نسخة جديدة».</div>` : html`<p class="muted small" style="margin-bottom:0">لتعديل الجدول دون تغيير سجل ما مضى، أنشئ نسخة جديدة بتاريخ سريان.</p>`}</div>
    <div class="card"><div class="table-wrap" style="border:0"><table class="tt"><thead><tr><th></th>${days.map(d => html`<th>${DAY_NAMES[d]}</th>`)}</tr></thead>
      <tbody>${periods.map(p => html`<tr><th>الحصة ${p.n}<br /><small>${p.start}</small></th>${days.map(d => { const s = slotAt(d, p.n); return html`<td><select class=${s ? 'set' : ''} value=${s?.class_id || ''} onChange=${e => setSlot(d, p.n, e.target.value)}><option value="">—</option>${cls.map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select></td>`; })}</tr>`)}</tbody></table></div>
      <div class="row" style="margin-top:12px"><b>الحصص الأسبوعية:</b>${Object.entries(counts.byGrade).map(([g, n]) => html`<span class="badge pri">${GRADE_NAMES[g] || g}: ${n}</span>`)}${cls.map(c => counts.byClass[c.id] ? html`<span class="badge">${className(c)}: ${counts.byClass[c.id]}</span>` : null)}</div></div>
  </div>`;
}

// ---------- الاستثناءات ----------
function ExceptionsTab({ w }) {
  const list = ws('exceptions').sort((a, b) => b.date.localeCompare(a.date));
  const cls = classes(); const periods = (w.day?.periods || []).map(p => ({ value: p.n, label: `الحصة ${p.n}` }));
  const clsOpts = [{ value: '', label: 'كل الفصول' }, ...cls.map(c => ({ value: c.id, label: className(c) }))];
  const add = async kind => {
    const F = {
      cancel: [{ name: 'date', label: 'التاريخ', type: 'date', value: todayISO(), required: true }, { name: 'period', label: 'الحصة', type: 'select', options: [{ value: '', label: 'كل حصص اليوم' }, ...periods] }, { name: 'class_id', label: 'الفصل', type: 'select', options: clsOpts }],
      teacher_absent: [{ name: 'date', label: 'من', type: 'date', value: todayISO(), required: true }, { name: 'date_to', label: 'إلى', type: 'date', value: todayISO(), required: true }],
      extra: [{ name: 'date', label: 'التاريخ', type: 'date', value: todayISO(), required: true }, { name: 'period', label: 'الحصة', type: 'select', options: periods, value: periods[0]?.value }, { name: 'class_id', label: 'الفصل', type: 'select', options: cls.map(c => ({ value: c.id, label: className(c) })), value: cls[0]?.id, required: true }],
      swap: [{ name: 'date', label: 'التاريخ', type: 'date', value: todayISO(), required: true }, { name: 'period', label: 'من الحصة', type: 'select', options: periods, value: periods[0]?.value }, { name: 'to_period', label: 'إلى الحصة', type: 'select', options: periods, value: periods[1]?.value }, { name: 'class_id', label: 'الفصل', type: 'select', options: clsOpts }],
    }[kind];
    const v = await formDialog({ title: EXC_KINDS[kind], fields: [...F, { name: 'reason', label: 'السبب', required: kind === 'cancel', full: true }], validate: v => v.date_to && v.date_to < v.date ? 'تاريخ النهاية قبل البداية' : null });
    if (!v) return;
    await save('exceptions', { kind, ...v, period: v.period === '' || v.period == null ? null : +v.period, to_period: v.to_period ? +v.to_period : null, class_id: v.class_id || null, date_to: v.date_to || v.date });
    toast('أُضيف الاستثناء', 'ok');
  };
  return html`<div class="card"><div class="row" style="margin-bottom:12px">${Object.entries(EXC_KINDS).map(([k, l]) => html`<button class="btn soft sm" onClick=${() => add(k)}><${Icon} name="plus" size=${16} /> ${l}</button>`)}</div>
    <p class="muted small">الحصص الملغاة وغياب المعلم لا تُحتسب غياباً للطلاب، ولا تدخل في عدد الحصص، وتظهر مظللة في الكشوف.</p>
    ${list.length ? html`<div class="list">${list.map(x => html`<div class="li"><span class=${'badge ' + (x.kind === 'extra' ? 'pos' : x.kind === 'swap' ? 'pri' : 'neg')}>${EXC_KINDS[x.kind]}</span>
      <div class="grow"><div class="main-t">${fmtDate(x.date)}${x.date_to && x.date_to !== x.date ? ' — ' + fmtDate(x.date_to) : ''}</div><div class="sub-t">${x.period ? `الحصة ${x.period}` : ''}${x.to_period ? ` ← ${x.to_period}` : ''} ${x.class_id ? '• ' + className(get('classes', x.class_id)) : ''} ${x.reason ? '• ' + x.reason : ''}</div></div>
      <button class="icon-btn" onClick=${async () => { if (await confirmDialog({ title: 'حذف الاستثناء', message: 'حذف؟', danger: true, okText: 'حذف' })) await purge('exceptions', [x.id]); }}><${Icon} name="trash" size=${18} /></button></div>`)}</div>` : html`<${Empty} icon="calendar" title="لا استثناءات" />`}</div>`;
}

// ---------- أنواع الأحداث ----------
function catOptions(w) {
  const keys = new Map();
  for (const s of ws('grade_schemes')) for (const c of s.categories || []) keys.set(c.key, c.name);
  for (const c of defaultScheme().categories) if (!keys.has(c.key)) keys.set(c.key, c.name);
  return [{ value: '', label: 'لا تؤثر في الدرجة' }, ...[...keys].map(([value, label]) => ({ value, label }))];
}
async function typeDialog(w, t = null) {
  const v = await formDialog({ title: t ? 'تعديل نوع حدث' : 'نوع حدث جديد', size: '', fields: [
    { name: 'name', label: 'الاسم', required: true, value: t?.name || '' },
    { name: 'code', label: 'الرمز للطباعة', value: t?.code || '', placeholder: 'غ، ت، ن…' },
    { name: 'icon', label: 'الأيقونة', value: t?.icon || '', placeholder: 'رمز تعبيري' },
    { name: 'color', label: 'اللون', type: 'color', value: t?.color || '#0f8b8d' },
    { name: 'valence', label: 'النوع', type: 'select', options: [{ value: 'pos', label: 'إيجابي' }, { value: 'neg', label: 'سلبي' }, { value: 'neu', label: 'محايد' }], value: t?.valence || 'pos' },
    { name: 'points', label: 'النقاط', type: 'number', step: '0.25', value: t?.points ?? 1, hint: 'السلبي بقيمة سالبة' },
    { name: 'category', label: 'الفئة التي يؤثر فيها', type: 'select', options: catOptions(w), value: t?.category ?? 'participation' },
    { name: 'cap', label: 'سقف لكل حصة (0 = بلا سقف)', type: 'number', min: 0, value: t?.cap ?? 0, hint: 'لا يُحتسب أكثر من هذا العدد للطالب في الحصة الواحدة' },
    { name: 'severity', label: 'درجة المشكلة (لنموذج الرصد)', type: 'select', options: SEVERITIES, value: t ? severityOf(t) : 'بسيطة', hint: 'للأنواع السلبية' },
    { name: 'free', label: 'تنبيهات أولى بلا خصم', type: 'number', min: 0, value: t?.free ?? 0, hint: 'أول N مرات في الفصل الدراسي تُسجَّل تنبيهاً' },
    { name: 'visible', label: 'يظهر للطالب في بوابته', type: 'checkbox', value: t?.visible ?? true },
    { name: 'portal_group', label: 'يُعرض في البوابة ضمن', type: 'select', options: [{ value: '', label: 'تلقائي حسب النوع' }, { value: 'participation', label: 'المشاركة' }, { value: 'behavior', label: 'السلوك' }, { value: 'sleep', label: 'النوم في الحصة' }, { value: 'other', label: 'لا يُعرض' }], value: t?.portal_group || '' },
    { name: 'active', label: 'مفعّل', type: 'checkbox', value: t?.active ?? true },
  ] });
  if (!v) return;
  const row = { ...(t || {}), ...v, points: +v.points, cap: +v.cap || 0, free: +v.free || 0, order: t?.order ?? eventTypes({ activeOnly: false }).length };
  if (row.valence === 'neg' && row.points > 0) row.points = -row.points;
  await save('event_types', row);
}
function EventsTab({ w }) {
  const types = eventTypes({ activeOnly: false });
  const cats = Object.fromEntries(catOptions(w).map(o => [o.value, o.label]));
  const move = async (t, d) => {
    const i = types.indexOf(t), j = i + d; if (j < 0 || j >= types.length) return;
    await saveMany('event_types', types.map((x, k) => ({ ...x, order: k === i ? j : k === j ? i : k })));
  };
  const del = async t => {
    const used = all('events', e => e.type_id === t.id).length;
    if (t.sys) return toast('هذا النوع يستخدمه التطبيق (الحضور/الاختيار)؛ يمكنك تعديله أو تعطيله فقط', 'warn');
    if (used) { if (await confirmDialog({ title: 'النوع مستخدم', message: `سُجّل ${used} حدث بهذا النوع. سيُعطَّل بدلاً من حذفه.`, okText: 'تعطيل' })) await patch('event_types', t.id, { active: false }); return; }
    if (await confirmDialog({ title: 'حذف النوع', message: t.name, danger: true, okText: 'حذف' })) await purge('event_types', [t.id]);
  };
  return html`<div class="card"><div class="row" style="margin-bottom:12px"><span class="muted small">القيم الافتراضية اقتراح فقط. السقف يمنع الخصم أكثر من مرة في الحصة للسلوك نفسه.</span><span class="grow"></span><button class="btn primary sm" onClick=${() => typeDialog(w)}><${Icon} name="plus" size=${16} /> نوع جديد</button></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th></th><th>الاسم</th><th class="num">الرمز</th><th class="num">النقاط</th><th>الفئة</th><th class="num">سقف/حصة</th><th class="num">تنبيه أول</th><th>للطالب</th><th></th></tr></thead>
    <tbody>${types.map(t => html`<tr class=${t.active === false ? 'voided' : ''}><td style="font-size:1.3rem">${t.icon}</td><td><b style=${`color:${t.color}`}>${t.name}</b> ${t.sys ? html`<span class="badge">نظام</span>` : null}</td><td class="num"><b>${t.code}</b></td>
      <td class="num"><span class=${'badge ' + t.valence}>${t.points > 0 ? '+' : ''}${fmtNum(t.points)}</span></td><td class="small">${cats[t.category || ''] || t.category}</td><td class="num">${t.cap || '—'}</td><td class="num">${t.free || '—'}</td><td>${t.visible ? '✓' : '—'}</td>
      <td style="white-space:nowrap"><button class="icon-btn" onClick=${() => move(t, -1)}>▲</button><button class="icon-btn" onClick=${() => move(t, 1)}>▼</button><button class="icon-btn" onClick=${() => typeDialog(w, t)}><${Icon} name="edit" size=${16} /></button><button class="icon-btn" onClick=${() => del(t)}><${Icon} name="trash" size=${16} /></button></td></tr>`)}</tbody></table></div></div>`;
}

// ---------- توزيع الدرجات ----------
function GradingTab({ w }) {
  const grades = [...new Set([1, 2, 3, ...classes().map(c => +c.grade)])].sort();
  const [grade, setGrade] = useState(classes()[0]?.grade || 1);
  const [term, setTerm] = useState(1);
  const cur = schemeFor(grade, term);
  const [draft, setDraft] = useState(null);
  const key = `${grade}|${term}`;
  const d = draft && draft.key === key ? draft.s : JSON.parse(JSON.stringify({ categories: cur.categories, monthly: cur.monthly || defaultScheme().monthly, options: { ...defaultScheme().options, ...(cur.options || {}) } }));
  const setD = s => setDraft({ key, s });
  const val = validateScheme(d);
  const setCat = (i, k, v) => setD({ ...d, categories: d.categories.map((c, j) => j === i ? { ...c, [k]: v } : c) });
  const saveIt = async (g = grade, t = term, s = d) => {
    const ex = ws('grade_schemes', x => +x.grade === +g && +x.term === +t)[0];
    await save('grade_schemes', { ...(ex || {}), grade: +g, term: +t, ...s, categories: s.categories.map(c => ({ ...c, weight: +c.weight, target: c.target ? +c.target : undefined })) });
  };
  const doSave = async () => { if (!val.ok) return toast(val.errors[0], 'err'); await saveIt(); await audit('تعديل توزيع الدرجات', `${GRADE_NAMES[grade]} ف${term}`); setDraft(null); toast('حُفظ التوزيع', 'ok'); };
  const copyTo = async () => {
    const opts = grades.flatMap(g => [1, 2].map(t => ({ value: `${g}|${t}`, label: `${GRADE_NAMES[g] || g} — الفصل ${t === 1 ? 'الأول' : 'الثاني'}` }))).filter(o => o.value !== key);
    const v = await formDialog({ title: 'نسخ التوزيع إلى', fields: [{ name: 'to', label: 'الوجهات', type: 'multi', options: opts, value: [] }] });
    if (!v || !v.to.length) return;
    if (!val.ok) return toast(val.errors[0], 'err');
    for (const k of v.to) { const [g, t] = k.split('|'); await saveIt(g, t); }
    toast(`نُسخ إلى ${v.to.length}`, 'ok');
  };
  const usedBy = k => eventTypes().filter(t => t.category === k).map(t => t.name);
  return html`<div class="stack">
    <div class="card"><div class="row"><div class="chips">${grades.map(g => html`<button class=${'chip' + (+grade === g ? ' on' : '')} onClick=${() => setGrade(g)}>${GRADE_NAMES[g] || g}</button>`)}</div><span class="grow"></span><div class="chips">${[1, 2].map(t => html`<button class=${'chip' + (term === t ? ' on' : '')} onClick=${() => setTerm(t)}>الفصل ${t === 1 ? 'الأول' : 'الثاني'}</button>`)}</div></div>
      ${!cur.id && !draft ? html`<div class="info" style="margin-top:10px">لم يُحفظ توزيع لهذا الصف والفصل بعد — المعروض هو الاقتراح المبدئي ويُستخدم حتى تحفظ.</div>` : null}</div>
    <div class="card">
      <div class="row" style="margin-bottom:12px"><h2 style="margin:0">فئات الدرجة الأدائية</h2><span class=${'badge ' + (val.ok ? 'pos' : 'neg')} style="font-size:.95rem">المجموع ${fmtNum(val.sum)} / 40</span><span class="grow"></span>
        <button class="btn sm ghost" onClick=${() => setD({ ...d, categories: defaultScheme().categories })}>الاقتراح المبدئي</button><button class="btn sm" onClick=${copyTo}>نسخ إلى…</button></div>
      ${d.categories.map((c, i) => html`<div class="g-cat"><div class="form-grid">
        <${Field} label="اسم الفئة"><input value=${c.name} onInput=${e => setCat(i, 'name', e.target.value)} /></${Field}>
        <${Field} label="الوزن"><input type="number" step="0.5" min="0" value=${c.weight} onInput=${e => setCat(i, 'weight', e.target.value)} /></${Field}>
        <${Field} label="طريقة الحساب"><select value=${c.method} onChange=${e => setCat(i, 'method', e.target.value)}>${Object.entries(METHODS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select></${Field}>
        ${c.method === 'target' ? html`<${Field} label="هدف النقاط للفصل الدراسي" hint="يُقسَّم تلقائياً بنسبة الحصص التي حضرها الطالب"><input type="number" min="1" value=${c.target || ''} onInput=${e => setCat(i, 'target', e.target.value)} /></${Field}>` : null}</div>
        ${c.method === 'ratio' ? html`<div class="field full" style="margin-top:8px"><span class="muted small">المهام المحتسبة</span><div class="chips">${Object.entries(TASK_KINDS).filter(([k]) => !['monthly', 'final'].includes(k)).map(([k, l]) => { const on = (c.task_kinds || []).includes(k); return html`<button class=${'chip' + (on ? ' on' : '')} onClick=${() => setCat(i, 'task_kinds', on ? c.task_kinds.filter(x => x !== k) : [...(c.task_kinds || []), k])}>${l}</button>`; })}</div></div>`
        : html`<p class="muted small" style="margin:8px 0 0">الأحداث المحتسبة: ${usedBy(c.key).join('، ') || 'لا يوجد — اربط أنواع الأحداث بهذه الفئة من «أنواع الأحداث»'}</p>`}
        <div class="row" style="margin-top:8px"><span class="muted small">المفتاح: ${c.key}</span><span class="grow"></span><button class="btn sm ghost" onClick=${() => setD({ ...d, categories: d.categories.filter((_, j) => j !== i) })}><${Icon} name="trash" size=${14} /> حذف الفئة</button></div></div>`)}
      <button class="btn soft sm" style="margin-top:10px" onClick=${() => setD({ ...d, categories: [...d.categories, { key: 'c' + Math.random().toString(36).slice(2, 7), name: 'فئة جديدة', weight: 0, method: 'ratio', task_kinds: [] }] })}><${Icon} name="plus" size=${16} /> فئة</button>
      ${!val.ok ? html`<div class="error" style="margin-top:10px">${val.errors.join(' • ')}</div>` : null}</div>
    <div class="grid-2">
      <div class="card"><h2>الاختبارات الشهرية</h2><div class="form-grid">
        <${Field} label="طريقة التحويل"><select value=${d.monthly.method} onChange=${e => setD({ ...d, monthly: { ...d.monthly, method: e.target.value } })}><option value="avg">المتوسط</option><option value="best">الأفضل N من M</option></select></${Field}>
        ${d.monthly.method === 'best' ? html`<${Field} label="N (عدد الأفضل)"><input type="number" min="1" value=${d.monthly.n} onInput=${e => setD({ ...d, monthly: { ...d.monthly, n: +e.target.value } })} /></${Field}>` : null}
        <${Field} label="الدرجة من"><input type="number" min="1" value=${d.monthly.outOf} onInput=${e => setD({ ...d, monthly: { ...d.monthly, outOf: +e.target.value } })} /></${Field}></div></div>
      <div class="card"><h2>خيارات الحساب</h2><div class="form-grid">
        <${Field} label="التقريب"><select value=${d.options.rounding} onChange=${e => setD({ ...d, options: { ...d.options, rounding: +e.target.value } })}><option value="0">بلا تقريب (منزلتان)</option><option value="0.25">لأقرب ربع</option><option value="0.5">لأقرب نصف</option><option value="1">لأقرب عدد صحيح</option></select></${Field}>
        <${Field} label="المهمة غير المرصودة"><select value=${d.options.missing} onChange=${e => setD({ ...d, options: { ...d.options, missing: e.target.value } })}><option value="exclude">خارج المقام حتى تُرصد</option><option value="zero">تُحتسب صفراً</option></select></${Field}>
        ${['partial', 'late'].map(k => html`<${Field} label=${`قيمة الواجب «${k === 'partial' ? 'ناقص' : 'متأخر'}» من 1`}><input type="number" step="0.05" min="0" max="1" value=${d.options.hw?.[k]} onInput=${e => setD({ ...d, options: { ...d.options, hw: { ...d.options.hw, [k]: +e.target.value } } })} /></${Field}>`)}</div></div>
    </div>
    <div class="row"><${Btn} cls="primary lg" disabled=${!val.ok} onClick=${doSave}><${Icon} name="check" /> حفظ التوزيع</${Btn}>${draft ? html`<button class="btn ghost" onClick=${() => setDraft(null)}>تجاهل التغييرات</button>` : null}</div>
  </div>`;
}

// ---------- النماذج ----------
function FormsTab({ w }) {
  const reasons = w.options?.referralReasons?.length ? w.options.referralReasons : DEFAULT_REFERRAL_REASONS;
  const tpls = w.options?.parentTemplates?.length ? w.options.parentTemplates : DEFAULT_PARENT_TEMPLATES;
  const setOpt = (k, v) => upd(w, { options: { ...w.options, [k]: v } });
  const addReason = async () => { const v = await formDialog({ title: 'سبب إحالة', fields: [{ name: 'r', label: 'السبب', required: true, full: true }] }); if (v) setOpt('referralReasons', [...reasons, v.r.trim()]); };
  const editTpl = async (i = null) => {
    const t = i == null ? { title: '', text: '' } : tpls[i];
    const v = await formDialog({ title: i == null ? 'قالب رسالة جديد' : 'تعديل القالب', fields: [{ name: 'title', label: 'العنوان', value: t.title, required: true, full: true }, { name: 'text', label: 'النص', type: 'textarea', value: t.text, required: true }] });
    if (!v) return;
    setOpt('parentTemplates', i == null ? [...tpls, v] : tpls.map((x, j) => j === i ? v : x));
  };
  return html`<div class="grid-2">
    <div class="card stack"><h2>أسباب الإحالة</h2>
      <div class="chips">${reasons.map(r => html`<span class="chip">${r} <button class="icon-btn" style="width:22px;height:22px" aria-label="حذف" onClick=${() => setOpt('referralReasons', reasons.filter(x => x !== r))}>×</button></span>`)}</div>
      <div class="row"><button class="btn sm soft" onClick=${addReason}><${Icon} name="plus" size=${16} /> سبب</button><button class="btn sm ghost" onClick=${() => setOpt('referralReasons', [])}>الافتراضي</button></div>
      <p class="muted small" style="margin:0">أسماء الوكيل والمرشد والمدير تُؤخذ من «المدرسة».</p></div>
    <div class="card stack"><h2>قوالب رسالة ولي الأمر</h2>
      <div class="list">${tpls.map((t, i) => html`<div class="li"><div class="grow"><div class="main-t">${t.title}</div><div class="sub-t">${t.text.slice(0, 90)}${t.text.length > 90 ? '…' : ''}</div></div><button class="icon-btn" onClick=${() => editTpl(i)}><${Icon} name="edit" size=${16} /></button><button class="icon-btn" onClick=${() => setOpt('parentTemplates', tpls.filter((_, j) => j !== i))}><${Icon} name="trash" size=${16} /></button></div>`)}</div>
      <div class="row"><button class="btn sm soft" onClick=${() => editTpl()}><${Icon} name="plus" size=${16} /> قالب</button><button class="btn sm ghost" onClick=${() => setOpt('parentTemplates', [])}>الافتراضي</button></div></div>
  </div>`;
}

// ---------- الاختيار العادل ----------
function PickerTab({ w }) {
  const p = { retryFactor: 0.5, volunteerConsumes: false, staleDays: 14, ...(w.options?.picker || {}) };
  const setP = (k, v) => upd(w, { options: { ...w.options, picker: { ...p, [k]: v } } });
  const pinned = w.options?.quickTypes || [];
  const types = eventTypes().filter(t => !['late', 'absent_unexcused', 'absent_excused'].includes(t.sys));
  const togglePin = id => upd(w, { options: { ...w.options, quickTypes: pinned.includes(id) ? pinned.filter(x => x !== id) : [...pinned, id] } });
  return html`<div class="grid-2">
    <div class="card stack"><h2>الاختيار العشوائي العادل</h2>
      <${Field} label="معامل نقاط المحاولة الثانية" hint="مثال 0.5 = نصف نقاط الإجابة"><input type="number" step="0.05" min="0" max="1" value=${p.retryFactor} onChange=${e => setP('retryFactor', +e.target.value)} /></${Field}>
      <label class="check"><input type="checkbox" checked=${p.volunteerConsumes} onChange=${e => setP('volunteerConsumes', e.target.checked)} /> المتطوع يستهلك دوره في الدورة</label>
      <${Field} label="تنبيه «لم يُسأل منذ مدة» بعد (يوم)"><input type="number" min="1" value=${p.staleDays} onChange=${e => setP('staleDays', +e.target.value)} /></${Field}>
      <p class="muted small" style="margin:0">العشوائية آمنة (crypto.getRandomValues) والترجيح لمن سُئل أقل ومن طال انتظاره. لا يتكرر طالب حتى يُسأل كل من في الدورة.</p></div>
    <div class="card"><h2>أزرار الأحداث السريعة</h2><p class="muted small" style="margin-top:0">الافتراضي: الأكثر استخداماً أولاً. ثبّت أنواعاً لتظهر أولاً بترتيب التثبيت.</p>
      <div class="chips">${types.map(t => { const i = pinned.indexOf(t.id); return html`<button class=${'chip' + (i >= 0 ? ' on' : '')} onClick=${() => togglePin(t.id)}>${i >= 0 ? `${i + 1}. ` : ''}${t.icon} ${t.name}</button>`; })}</div></div>
  </div>`;
}

// ---------- المظهر ----------
function DisplayTab({ w }) {
  const ui = getUI();
  const presets = ['#0f8b8d', '#1d4ed8', '#7c3aed', '#0e7490', '#15803d', '#b45309', '#be123c'];
  return html`<div class="grid-2">
    <div class="card stack"><h2>المظهر (هذا الجهاز)</h2>
      <div class="chips">${[['auto', 'تلقائي'], ['light', 'فاتح'], ['dark', 'داكن']].map(([k, l]) => html`<button class=${'chip' + ((ui.theme || 'auto') === k ? ' on' : '')} onClick=${() => setUI({ theme: k })}>${l}</button>`)}</div>
      <div><div class="section-title">اللون الرئيسي</div><div class="row">${presets.map(c => html`<button aria-label=${c} onClick=${() => setUI({ primary: c })} style=${`width:38px;height:38px;border-radius:12px;border:3px solid ${(ui.primary || '#0f8b8d') === c ? 'var(--ink)' : 'transparent'};background:${c};cursor:pointer`}></button>`)}<input type="color" value=${ui.primary || '#0f8b8d'} onInput=${e => setUI({ primary: e.target.value })} /></div></div></div>
    <div class="card stack"><h2>التواريخ</h2>
      <div class="chips">${[['both', 'ميلادي وهجري'], ['g', 'ميلادي فقط'], ['h', 'هجري فقط']].map(([k, l]) => html`<button class=${'chip' + ((w.options?.dateMode || 'both') === k ? ' on' : '')} onClick=${() => upd(w, { options: { ...w.options, dateMode: k } })}>${l}</button>`)}</div>
      <p class="muted small" style="margin:0">الهجري بتقويم أم القرى، والتوقيت دائماً بتوقيت الرياض.</p></div>
  </div>`;
}

// ---------- الحساب ----------
function AccountTab() {
  if (SYNC.mode === 'demo') return html`<div class="card stack"><h2>الوضع التجريبي</h2><p>التطبيق غير مربوط بخادم. كل البيانات على هذا الجهاز فقط (IndexedDB).</p>
    <p>لتفعيل المزامنة والحساب: أنشئ مشروع Supabase مجانياً، شغّل <code>schema.sql</code>، ثم ضع Project URL و anon key في <code>config.js</code>. التفاصيل في README.</p>
    <p class="muted small">عند ربط الحساب لاحقاً سيسألك التطبيق: رفع بياناتك المحلية إلى حسابك أم البدء من جديد.</p></div>`;
  return html`<div class="card stack"><h2>الحساب والمزامنة</h2>
    <dl class="kv"><dt>البريد</dt><dd>${SYNC.user?.email || S.user || '—'}</dd><dt>بانتظار الإرسال</dt><dd>${S.pending}</dd><dt>آخر مزامنة</dt><dd>${SYNC.lastSync ? fmtDateTime(SYNC.lastSync) : '—'}</dd>${SYNC.error ? html`<dt>آخر خطأ</dt><dd class="error">${SYNC.error}</dd>` : null}</dl>
    <div class="row"><${Btn} cls="primary" onClick=${() => syncNow().then(() => toast('تمت المزامنة', 'ok'))}>مزامنة الآن</${Btn}>
      <${Btn} cls="ghost" onClick=${async () => { if (S.pending && !await confirmDialog({ title: 'تسجيل الخروج', message: `يوجد ${S.pending} سجل لم يُرسَل بعد وسيبقى على الجهاز حتى تدخل مجدداً.`, okText: 'خروج' })) return; await signOut(); }}><${Icon} name="logout" /> تسجيل الخروج</${Btn}></div></div>`;
}

// ---------- النسخ الاحتياطي ----------
function BackupTab({ w }) {
  const last = localStorage.getItem('daftar-last-backup');
  const restore = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (!await confirmDialog({ title: 'استعادة نسخة احتياطية', message: 'ستُستبدل كل البيانات على هذا الجهاز بمحتوى النسخة، ثم تُرفع للخادم إن كان الحساب مربوطاً.', danger: true, okText: 'استعادة' })) return;
    try { await restoreJSON(f); toast('تمت الاستعادة', 'ok'); go('#/today'); } catch (err) { toast(err.message, 'err', 6000); }
  };
  const delYear = async () => {
    if (!await confirmDialog({ title: 'حذف بيانات سنة كاملة', message: `سيُحذف كل شيء في «${w.name}»: الفصول والطلاب والأحداث والدرجات، من الجهاز والخادم. خذ نسخة احتياطية أولاً.`, danger: true, okText: 'متابعة' })) return;
    if (!await confirmDialog({ title: 'تأكيد نهائي', message: 'لا يمكن التراجع.', danger: true, okText: 'حذف نهائي', typeToConfirm: w.name.trim() })) return;
    await deleteWorkspaceData(w.id); toast('حُذفت بيانات السنة'); go('#/today');
  };
  return html`<div class="grid-2">
    <div class="card stack"><h2><${Icon} name="archive" /> نسخة احتياطية كاملة</h2><p class="muted" style="margin:0">${last ? `آخر نسخة: ${fmtDateTime(last)}` : 'لم تأخذ نسخة بعد.'} يذكّرك التطبيق أسبوعياً.</p>
      <div class="row"><${Btn} cls="primary" onClick=${exportJSON}><${Icon} name="download" /> نسخة JSON (للاستعادة)</${Btn}><${Btn} onClick=${exportExcel}><${Icon} name="download" /> نسخة Excel (للقراءة)</${Btn}></div>
      <label class="btn ghost" style="justify-self:start"><${Icon} name="upload" /> استعادة من ملف JSON<input type="file" accept=".json,application/json" hidden onChange=${restore} /></label></div>
    <div class="card stack"><h2 style="color:var(--neg)"><${Icon} name="trash" /> حذف بيانات السنة</h2><p class="muted" style="margin:0">لحذف طالب نهائياً افتح بطاقته ← «التسجيل والنقل».</p>
      <button class="btn danger" style="justify-self:start" onClick=${delYear}>حذف «${w.name}» نهائياً</button></div>
  </div>`;
}

// ---------- سجل التدقيق ----------
function AuditTab() {
  const rows = ws('audit').sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return html`<div class="card">${rows.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>متى</th><th>من</th><th>الإجراء</th><th>التفاصيل</th><th>السبب</th></tr></thead>
    <tbody>${rows.slice(0, 500).map(r => html`<tr><td class="small" style="white-space:nowrap">${fmtDateTime(r.at)}</td><td class="small">${r.by}</td><td><b>${r.action}</b></td><td class="small">${r.details}</td><td class="small">${r.reason || '—'}</td></tr>`)}</tbody></table></div>`
    : html`<${Empty} icon="file" title="لا توجد إجراءات مسجلة بعد" />`}</div>`;
}

// ---------- مساحات العمل ----------
function WorkspacesTab({ w }) {
  const list = all('workspaces').sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0));
  return html`<div class="stack">
    <div class="card"><h2>مساحات العمل (مدرسة + سنة)</h2><div class="list">${list.map(x => html`<div class=${'li' + (x.archived ? ' voided' : '')}><span class="hexmark" style="width:40px;height:40px"><${Icon} name="hex" /></span>
      <div class="grow"><div class="main-t">${x.name} ${x.id === w.id ? html`<span class="badge pri">الحالية</span>` : null} ${x.archived ? html`<span class="badge">مؤرشفة</span>` : null}</div><div class="sub-t">${x.identity?.school || ''}</div></div>
      ${x.id !== w.id && !x.archived ? html`<button class="btn sm" onClick=${() => { setWorkspace(x.id); emit(); go('#/today'); }}>التبديل إليها</button>` : null}
      ${x.id !== w.id ? html`<button class="btn sm ghost" onClick=${async () => { await patch('workspaces', x.id, { archived: !x.archived }); await audit(x.archived ? 'إلغاء أرشفة' : 'أرشفة سنة', x.name); }}>${x.archived ? 'إلغاء الأرشفة' : 'أرشفة'}</button>` : null}</div>`)}</div></div>
    <div class="card"><${WorkspaceSetup} /></div></div>`;
}

export function WorkspaceSetup({ first = false }) {
  const others = all('workspaces');
  const [v, setV] = useState({ school: '', year: '', copyFrom: '', events: true, schemes: true, identity: true, timetable: false, day: true });
  const create = async () => {
    if (!v.school.trim() || !v.year.trim()) return toast('اكتب اسم المدرسة والسنة', 'warn');
    const nw = await createWorkspace({ school: v.school.trim(), year: v.year.trim(), copyFrom: v.copyFrom || null, copy: v });
    setWorkspace(nw.id); emit(); toast('أُنشئت مساحة العمل', 'ok'); go('#/settings/school');
  };
  const C = (k, l) => html`<label class="check"><input type="checkbox" checked=${v[k]} onChange=${e => setV({ ...v, [k]: e.target.checked })} /> ${l}</label>`;
  return html`<div class="stack">${first ? html`<div style="text-align:center"><span class="hexmark" style="width:70px;height:70px"><${Icon} name="hex" size=${30} /></span><h1 style="margin-top:10px">مرحباً بك في دفتر المعلم</h1><p class="muted">ابدأ بإنشاء مساحة عمل: مدرسة + سنة دراسية.</p></div>` : html`<h2>مساحة عمل جديدة</h2>`}
    <div class="form-grid"><${Field} label="اسم المدرسة"><input value=${v.school} onInput=${e => setV({ ...v, school: e.target.value })} /></${Field}><${Field} label="السنة الدراسية"><input value=${v.year} placeholder="1448هـ" onInput=${e => setV({ ...v, year: e.target.value })} /></${Field}>
      ${others.length ? html`<${Field} label="نسخ الإعدادات من سنة سابقة"><select value=${v.copyFrom} onChange=${e => setV({ ...v, copyFrom: e.target.value })}><option value="">لا — ابدأ بالاقتراحات</option>${others.map(o => html`<option value=${o.id}>${o.name}</option>`)}</select></${Field}>` : null}</div>
    ${v.copyFrom ? html`<div class="row">${C('events', 'أنواع الأحداث')}${C('schemes', 'توزيع الدرجات')}${C('identity', 'ترويسة الطباعة والشعارات')}${C('day', 'أوقات الحصص')}${C('timetable', 'الجدول (مع الفصول بلا طلاب)')}</div>` : null}
    <${Btn} cls="primary lg" onClick=${create}><${Icon} name="plus" /> إنشاء</${Btn}></div>`;
}
