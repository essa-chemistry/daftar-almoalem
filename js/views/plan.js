// الخطة السنوية: نموذج Excel، الاستيراد، الدروس بأسابيعها وتواريخها، التوزيع على الحصص، التقدم، الطباعة والحذف
import { html, useState } from '../lib.js';
import { ws, get, save, saveMany, patch, purge, audit, classes, className, workspace } from '../store.js';
import { useStore, Icon, Btn, Empty, formDialog, confirmDialog, toast, openModal, ModalHead } from '../ui.js';
import { lessonsFor, progress, lessonSpans, lessonDone, kindOf, KIND_LABEL, studyWeeks, plannedRange, distribution, parsePlanRows, TEMPLATE_HEAD, fmtH, planMode, weekOfDate } from '../plan.js';
import { planSheet, distributionSheet } from '../planprint.js';
import { printHTML } from '../print.js';
import { currentTerm, termRange, TERM_LABEL, holidayOn } from '../calendar.js';
import { todayISO, getXLSX, normDigits, fmtShort, GRADE_NAMES, DAY_SHORT, dow, uuid } from '../utils.js';

export const statusText = p => p.status === 'none' ? 'لا توجد خطة' : p.diff === 0 ? 'وفق الخطة' : p.diff > 0 ? `متقدم ${p.diff} حصة` : `متأخر ${-p.diff} حصة`;
export const statusCls = p => p.status === 'behind' ? 'neg' : p.status === 'ahead' ? 'pri' : p.status === 'none' ? '' : 'pos';
const g = iso => (iso ? iso.split('-').reverse().join('/') : '');

// ---------- نموذج Excel (فارغ أو بالخطة الحالية) ----------
async function downloadTemplate(grade, term, withData) {
  const XLSX = await getXLSX(); const w = workspace(); const weeks = studyWeeks(w, term);
  const ls = withData ? lessonsFor(grade, term) : [];
  const rows = ls.map(l => { const r = plannedRange(l, weeks); const k = kindOf(l);
    return [l.unit || '', l.title, k === 'lesson' ? +l.periods || 1 : k === 'break' ? 0 : 'غير محدد', l.weeks || '', r ? fmtH(r.start) : '', r ? fmtH(r.end) : '', r ? r.start : '', r ? r.end : '', l.notes || '']; });
  const sh = XLSX.utils.aoa_to_sheet([TEMPLATE_HEAD, ...rows]);
  sh['!cols'] = [{ wch: 30 }, { wch: 46 }, { wch: 10 }, { wch: 16 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 24 }];
  const wk = XLSX.utils.aoa_to_sheet([['الأسبوع', 'من هجري', 'إلى هجري', 'من ميلادي', 'إلى ميلادي', 'ملاحظة'],
    ...weeks.map(x => [x.n ?? '—', fmtH(x.start), fmtH(x.end), x.start, x.end, x.off ? (x.off.label || 'إجازة') : ''])]);
  wk['!cols'] = [{ wch: 9 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 22 }];
  const help = XLSX.utils.aoa_to_sheet([['طريقة تعبئة نموذج الخطة'],
    ['• صف لكل درس بالترتيب. «الوحدة» تتكرر لكل دروسها.'],
    ['• «عدد الحصص»: رقم. اكتب 0 للإجازة، و«غير محدد» للمراجعة أو الاختبارات (لا تأخذ حصصاً من التوزيع).'],
    ['• «الأسبوع / الأسابيع»: رقم الأسبوع أو أكثر، مثل: 4، 5 — أرقام الأسابيع وتواريخها في الورقة «الأسابيع».'],
    ['• التواريخ اختيارية: هجري (1448/03/10) أو ميلادي (2026-08-23). إن كُتبت تُستخدم بدل رقم الأسبوع.'],
    ['• عند الرفع: لا يبدأ الدرس قبل أسبوعه، ويوزَّع على حصص كل شعبة الفعلية بعد الإجازات والحصص الملغاة.'],
    ['• الأعمدة الإلزامية: الدرس فقط. وأي ملف بالأعمدة نفسها يصلح (حتى لو اختلف ترتيبها).']]);
  help['!cols'] = [{ wch: 100 }];
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, sh, 'الخطة'); XLSX.utils.book_append_sheet(wb, wk, 'الأسابيع'); XLSX.utils.book_append_sheet(wb, help, 'تعليمات');
  XLSX.writeFile(wb, `${withData ? 'خطة' : 'نموذج-خطة'}-${GRADE_NAMES[grade] || grade}-ف${term}.xlsx`);
}

// ---------- معاينة الاستيراد ----------
function ImportPreview({ items, grade, term, existing, close, done }) {
  const w = workspace(); const r = termRange(w, term);
  const brks = items.filter(x => x.kind === 'break' && x.start && !holidayOn(w, x.start));
  const [addHol, setAddHol] = useState(brks.length > 0);
  const out = r ? items.filter(x => x.kind !== 'break' && x.start && (x.start < r.start || x.start > r.end)).length : 0;
  const nL = items.filter(x => x.kind === 'lesson'); const per = nL.reduce((a, x) => a + x.periods, 0);
  return html`<${ModalHead} title="استيراد الخطة" close=${close} />
    <div class="modal-body stack">
      <div class="info">إلى: <b>${GRADE_NAMES[grade] || grade} — ${TERM_LABEL[term]}</b></div>
      <div class="chips"><span class="badge pri">${nL.length} درس • ${per} حصة</span><span class="badge warn">${items.filter(x => x.kind === 'activity').length} مراجعة/تقويم</span><span class="badge">${items.filter(x => x.kind === 'break').length} إجازة</span>
        <span class="badge">${items.filter(x => x.weeks || x.start).length} صف بأسبوع أو تاريخ</span></div>
      ${out ? html`<div class="notice small">${out} صف تاريخه خارج ${TERM_LABEL[term]} في التقويم — تأكد أنك اخترت الفصل الدراسي الصحيح.</div>` : null}
      <div class="table-wrap" style="max-height:38vh"><table class="tbl small"><thead><tr><th>الدرس</th><th class="num">الحصص</th><th>الأسبوع</th><th>من</th></tr></thead><tbody>
        ${items.slice(0, 60).map(x => html`<tr><td>${x.title} ${x.kind !== 'lesson' ? html`<span class=${'badge ' + (x.kind === 'break' ? '' : 'warn')}>${KIND_LABEL[x.kind]}</span>` : null}</td><td class="num">${x.kind === 'lesson' ? x.periods : '—'}</td><td>${x.weeks}</td><td class="nowrap">${x.start ? fmtH(x.start) : ''}</td></tr>`)}</tbody></table></div>
      ${brks.length ? html`<label class="check"><input type="checkbox" checked=${addHol} onChange=${e => setAddHol(e.target.checked)} /> إضافة الإجازات الواردة في الملف إلى التقويم (${brks.map(x => x.title).join('، ')}) حتى لا تُوزَّع عليها دروس</label>` : null}
      ${existing ? html`<div class="notice small">يوجد حالياً ${existing} صف في هذه الخطة.</div>` : null}
    </div>
    <div class="modal-foot"><button class="btn ghost" onClick=${close}>إلغاء</button>
      ${existing ? html`<button class="btn" onClick=${() => done({ mode: 'append', addHol })}>إضافة في آخر الخطة</button>` : null}
      <button class="btn primary" onClick=${() => done({ mode: 'replace', addHol })}>${existing ? 'استبدال الخطة الحالية' : 'استيراد'}</button></div>`;
}

export function PlanPage() {
  useStore();
  const w = workspace();
  const grades = [...new Set(classes().map(c => +c.grade))].sort();
  const [grade, setGrade] = useState(grades[0] || 1);
  const [term, setTerm] = useState(currentTerm(w, todayISO()));
  const [open, setOpen] = useState(null);
  const lessons = lessonsFor(grade, term);
  const total = lessons.filter(l => kindOf(l) === 'lesson').reduce((a, l) => a + (+l.periods || 1), 0);
  const nLessons = lessons.filter(l => kindOf(l) === 'lesson').length;
  const cls = classes().filter(c => +c.grade === +grade);
  const r = termRange(w, term);
  const weeks = studyWeeks(w, term);
  const mode = planMode();

  const add = async () => {
    const v = await formDialog({ title: 'صف جديد في الخطة', fields: [
      { name: 'kind', label: 'النوع', type: 'select', value: 'lesson', options: Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })) },
      { name: 'unit', label: 'الوحدة', value: lessons[lessons.length - 1]?.unit || '' },
      { name: 'title', label: 'الدرس / العنوان', required: true, full: true },
      { name: 'periods', label: 'عدد الحصص (للدرس)', type: 'number', min: 1, value: 1 },
      { name: 'weeks', label: 'الأسبوع / الأسابيع', placeholder: 'مثال: 4، 5' },
    ] });
    if (v) await save('plan_lessons', { grade: +grade, term: +term, kind: v.kind, unit: v.unit, title: v.title, periods: v.kind === 'lesson' ? Math.max(1, +v.periods || 1) : null, weeks: v.weeks, start: null, end: null, notes: '', order: lessons.length });
  };
  const setL = (l, k, v) => patch('plan_lessons', l.id, { [k]: k === 'periods' ? Math.max(1, +normDigits(v) || 1) : k === 'kind' ? v : (k === 'start' || k === 'end') ? (v || null) : v, ...(k === 'kind' ? { periods: v === 'lesson' ? (+l.periods || 1) : null } : {}) });
  const move = async (i, d) => { const j = i + d; if (j < 0 || j >= lessons.length) return; await saveMany('plan_lessons', lessons.map((l, k) => ({ ...l, order: k === i ? j : k === j ? i : k }))); };
  const importX = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const XLSX = await getXLSX();
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const sheet = wb.SheetNames.find(n => n.includes('خطة') || n.includes('الخطة')) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '', raw: true }).filter(x => x.some(c => String(c).trim()));
      const items = parsePlanRows(rows);
      const res = await new Promise(res => { let ok = false; const close = openModal(cl => html`<${ImportPreview} items=${items} grade=${grade} term=${term} existing=${lessons.length} close=${cl} done=${v => { ok = true; cl(); res(v); }} />`, { size: 'lg', onClose: () => { if (!ok) res(null); } }); });
      if (!res) return;
      if (res.mode === 'replace' && lessons.length) await purge('plan_lessons', lessons.map(l => l.id));
      const start = res.mode === 'replace' ? 0 : lessons.length;
      await saveMany('plan_lessons', items.map((x, i) => ({ grade: +grade, term: +term, ...x, order: start + i })));
      if (res.addHol) {
        const cal = workspace().calendar || {}; const add = items.filter(x => x.kind === 'break' && x.start && !holidayOn(workspace(), x.start));
        await patch('workspaces', w.id, { calendar: { ...cal, holidays: [...(cal.holidays || []), ...add.map(x => ({ id: uuid(), kind: 'holiday', label: x.title, from: x.start, to: x.end || x.start }))].sort((a, b) => a.from.localeCompare(b.from)) } });
      }
      await audit('استيراد الخطة السنوية', `${GRADE_NAMES[grade]} ف${term}: ${items.length} صف${res.mode === 'append' ? ' (إضافة)' : ''}`);
      toast(`استُوردت الخطة: ${items.length} صف`, 'ok');
    } catch (err) { toast(err.message, 'err', 6000); }
  };
  const delPlan = async () => {
    if (!(await confirmDialog({ title: 'حذف الخطة', message: `سيُحذف كل ما في خطة ${GRADE_NAMES[grade] || grade} — ${TERM_LABEL[term]} (${lessons.length} صف).\nلا يتأثر ما سجّلته في الحصص من «تم الشرح»، فيستمر العدّ عند رفع خطة جديدة.\nيُنصح بتنزيل نسخة Excel منها أولاً.`, okText: 'حذف الخطة', danger: true, typeToConfirm: 'حذف' }))) return;
    await purge('plan_lessons', lessons.map(l => l.id));
    await audit('حذف الخطة السنوية', `${GRADE_NAMES[grade]} ف${term}: ${lessons.length} صف`);
    toast('حُذفت الخطة — يمكنك رفع خطة جديدة', 'ok');
  };
  const printDlg = async () => {
    const v = await formDialog({ title: 'طباعة الخطة', okText: 'طباعة', fields: [
      { name: 'type', label: 'ماذا تطبع؟', type: 'select', value: 'plan', options: [{ value: 'plan', label: 'الخطة (الدروس بأسابيعها وتواريخها)' }, { value: 'dist', label: 'التوزيع على حصص الشعبة أسبوعاً بأسبوع' }] },
      { name: 'cls', label: 'الشعبة', type: 'select', value: cls.length ? 'all' : '', options: [{ value: '', label: 'بدون شعبة (الخطة فقط)' }, ...(cls.length > 1 ? [{ value: 'all', label: 'كل الشعب (صفحة لكل شعبة)' }] : []), ...cls.map(c => ({ value: c.id, label: className(c) }))], hint: 'مع الشعبة تُضاف حصصها الفعلية وحالة التنفيذ' },
    ], validate: x => (x.type === 'dist' && !x.cls ? 'التوزيع على الحصص يحتاج اختيار شعبة' : null) });
    if (!v) return;
    const ids = v.cls === 'all' ? cls.map(c => c.id) : v.cls ? [v.cls] : [null];
    printHTML(ids.map(id => (v.type === 'plan' ? planSheet({ grade, term, classId: id }) : distributionSheet({ classId: id, term }))).join(''), { landscape: v.type === 'plan' });
  };

  return html`<div class="page">
    <div class="page-head"><div><h1>الخطة السنوية</h1><div class="sub">ارفع خطتك بأسابيعها، وتُوزَّع الدروس تلقائياً على الحصص الفعلية لكل شعبة بعد استبعاد الإجازات والحصص الملغاة وغياب المعلم، ويُعاد التوزيع عند أي تغيير.</div></div>
      <div class="actions">
        <${Btn} onClick=${() => downloadTemplate(grade, term, false)}><${Icon} name="download" /> نموذج Excel</${Btn}>
        <label class="btn"><${Icon} name="upload" /> رفع الخطة<input type="file" hidden accept=".xlsx,.xls,.csv" onChange=${importX} /></label>
        ${lessons.length ? html`<${Btn} onClick=${printDlg}><${Icon} name="print" /> طباعة</${Btn}>` : null}
        <${Btn} cls="primary" onClick=${add}><${Icon} name="plus" /> درس</${Btn}></div></div>
    <div class="row" style="margin-bottom:14px"><div class="chips">${(grades.length ? grades : [1, 2, 3]).map(x => html`<button class=${'chip' + (+grade === x ? ' on' : '')} onClick=${() => { setGrade(x); setOpen(null); }}>${GRADE_NAMES[x] || x}</button>`)}</div><span class="grow"></span>
      <div class="chips">${[1, 2].map(t => html`<button class=${'chip' + (term === t ? ' on' : '')} onClick=${() => { setTerm(t); setOpen(null); }}>${TERM_LABEL[t]}</button>`)}</div></div>
    ${!r ? html`<div class="notice" style="margin-bottom:12px">حدد تواريخ الفصل الدراسي من الإعدادات ← التقويم.</div>` : null}
    ${lessons.length ? html`<div class="card row" style="margin-bottom:14px;gap:10px">
      <span class="small"><b>طريقة التوزيع:</b></span>
      <div class="chips"><button class=${'chip' + (mode === 'weeks' ? ' on' : '')} onClick=${() => patch('workspaces', w.id, { plan_mode: 'weeks' })}>حسب أسابيع الخطة</button>
        <button class=${'chip' + (mode === 'seq' ? ' on' : '')} onClick=${() => patch('workspaces', w.id, { plan_mode: 'seq' })}>متتابع على كل الحصص</button></div>
      <span class="muted small grow">${mode === 'weeks' ? 'لا يبدأ الدرس قبل أسبوعه في الخطة؛ وإن سبقت الشعبة تبقى حصص احتياطية للمراجعة.' : 'تُملأ الحصص بالترتيب دون النظر لأرقام الأسابيع.'}</span>
      <${Btn} cls="ghost sm" onClick=${() => downloadTemplate(grade, term, true)}><${Icon} name="download" size=${16} /> تنزيل الخطة Excel</${Btn}>
      <${Btn} cls="danger-soft sm" onClick=${delPlan}><${Icon} name="trash" size=${16} /> حذف الخطة</${Btn}></div>` : null}
    ${cls.length && nLessons ? html`<div class="grid-2" style="margin-bottom:16px">${cls.map(c => { const p = progress(c.id, term); return html`<div class="card stack">
      <div class="row"><h2 style="margin:0">${className(c)}</h2><span class="grow"></span><span class=${'badge ' + statusCls(p)}>${statusText(p)}</span></div>
      <div class="g-bar" style="position:relative"><i style=${`width:${p.total ? p.done / p.total * 100 : 0}%`}></i></div>
      <div class="small muted">شُرح ${p.done} من ${p.total} حصة مخططة • المفترض حتى الآن ${p.plannedSoFar} • المتاح في الفصل ${p.available}${p.spare ? ` • احتياطي ${p.spare}` : ''}</div>
      ${p.next ? html`<div><span class="muted small">التالي فعلياً:</span> <b>${p.next.lesson.title}</b> ${p.next.of > 1 ? html`<span class="muted small">(${p.next.k} من ${p.next.of})</span>` : null}</div>` : html`<div class="info small">اكتملت الخطة 🎉</div>`}
      ${p.shortfall > 0 ? html`<div class="notice small">${p.shortfall} حصة من الخطة لم تجد حصة متاحة قبل نهاية الفصل الدراسي.</div>` : null}
      <div class="row"><button class="btn sm ghost" onClick=${() => setOpen(open === c.id ? null : c.id)}>${open === c.id ? 'إخفاء' : 'عرض'} التوزيع على الحصص</button>
        <button class="btn sm ghost" onClick=${() => printHTML(distributionSheet({ classId: c.id, term }))}><${Icon} name="print" size=${16} /> طباعة التوزيع</button></div>
    </div>`; })}</div>` : null}
    ${open ? html`<${DistView} classId=${open} term=${term} lessons=${lessons} weeks=${weeks} />` : null}
    <div class="card"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">خطة ${GRADE_NAMES[grade] || grade} — ${TERM_LABEL[term]}</h2><span class="badge pri">${nLessons} درس • ${total} حصة</span></div>
      ${lessons.length ? html`<div class="table-wrap"><table class="tbl plan-tbl"><thead><tr><th>#</th><th>الوحدة</th><th>الدرس</th><th>النوع</th><th class="num">الحصص</th><th>الأسبوع</th><th>البداية</th><th>النهاية</th><th></th></tr></thead><tbody>
        ${lessons.map((l, i) => { const k = kindOf(l); const pr = plannedRange(l, weeks); return html`<tr key=${l.id} class=${'pk-' + k}><td class="num">${i + 1}</td>
          <td><input value=${l.unit || ''} onChange=${e => setL(l, 'unit', e.target.value)} style="min-width:140px" /></td>
          <td><input value=${l.title} onChange=${e => setL(l, 'title', e.target.value)} style="min-width:240px" /></td>
          <td><select value=${k} onChange=${e => setL(l, 'kind', e.target.value)} style="width:auto;min-width:96px">${Object.entries(KIND_LABEL).map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></td>
          <td class="num">${k === 'lesson' ? html`<input type="number" min="1" value=${l.periods} onChange=${e => setL(l, 'periods', e.target.value)} style="width:64px;text-align:center" />` : html`<span class="muted">—</span>`}</td>
          <td><input value=${l.weeks || ''} onChange=${e => setL(l, 'weeks', e.target.value)} style="width:84px;text-align:center" placeholder="مثال 4، 5" /></td>
          <td><input type="date" value=${l.start || ''} onChange=${e => setL(l, 'start', e.target.value)} style="width:140px" />${pr ? html`<div class="muted small">${fmtH(pr.start)}${l.start ? '' : ' (من الأسبوع)'}</div>` : null}</td>
          <td><input type="date" value=${l.end || ''} onChange=${e => setL(l, 'end', e.target.value)} style="width:140px" />${pr ? html`<div class="muted small">${fmtH(pr.end)}</div>` : null}</td>
          <td style="white-space:nowrap"><button class="icon-btn" onClick=${() => move(i, -1)}>▲</button><button class="icon-btn" onClick=${() => move(i, 1)}>▼</button><button class="icon-btn" onClick=${async () => { if (await confirmDialog({ title: 'حذف الصف', message: l.title, danger: true, okText: 'حذف' })) await purge('plan_lessons', [l.id]); }}><${Icon} name="trash" size=${16} /></button></td></tr>`; })}
      </tbody></table></div>` : html`<${Empty} icon="calendar" title="لا توجد خطة بعد">
          نزّل <b>نموذج Excel</b> واملأه (الوحدة، الدرس، عدد الحصص، الأسبوع، والتواريخ اختيارية)، ثم اضغط <b>رفع الخطة</b>. ويقبل أيضاً ملف خطتك الحالي إن كانت أعمدته بهذه الأسماء.
          <div class="row" style="justify-content:center;margin-top:12px"><${Btn} cls="primary" onClick=${() => downloadTemplate(grade, term, false)}><${Icon} name="download" /> تنزيل النموذج</${Btn}></div></${Empty}>`}
      <p class="muted small">في شاشة الحصة يظهر الدرس المخطط لذلك اليوم وزر «تم الشرح»؛ كل ضغطة تقدّم الشعبة حصة في الخطة.</p></div>
  </div>`;
}

function DistView({ classId, term, lessons, weeks }) {
  const [view, setView] = useState('lessons');
  const sp = lessonSpans(classId, term); const dn = lessonDone(classId, term);
  const today = todayISO();
  const fmt = m => m ? `${DAY_SHORT[dow(m.date)]} ${fmtShort(m.date)} ح${m.period}` : '—';
  const { rows } = view === 'weeks' ? distribution(classId, term) : { rows: [] };
  const groups = []; for (const r of rows) { const wk = weekOfDate(weeks, r.date); const key = wk?.from || r.date; let gp = groups[groups.length - 1]; if (!gp || gp.key !== key) groups.push(gp = { key, wk, rows: [] }); gp.rows.push(r); }
  return html`<div class="card" style="margin-bottom:16px"><div class="row" style="margin-bottom:8px"><h2 style="margin:0">التوزيع على الحصص — ${className(get('classes', classId))}</h2><span class="grow"></span>
    <div class="chips"><button class=${'chip' + (view === 'lessons' ? ' on' : '')} onClick=${() => setView('lessons')}>حسب الدروس</button><button class=${'chip' + (view === 'weeks' ? ' on' : '')} onClick=${() => setView('weeks')}>حسب الأسابيع</button></div></div>
    ${view === 'lessons' ? html`<div class="table-wrap"><table class="tbl nowrap"><thead><tr><th>الدرس</th><th class="num">الحصص</th><th>أسبوع الخطة</th><th>من</th><th>إلى</th><th>التنفيذ</th></tr></thead><tbody>
      ${lessons.map(l => { const k = kindOf(l); const s = sp.get(l.id); const d = dn.get(l.id); const now = s && s.first.date <= today && s.last.date >= today;
        if (k !== 'lesson') { const pr = plannedRange(l, weeks); return html`<tr class=${'pk-' + k}><td>${l.title} <span class="badge">${KIND_LABEL[k]}</span></td><td class="num">—</td><td>${l.weeks || ''}</td><td>${pr ? g(pr.start) : ''}</td><td>${pr ? g(pr.end) : ''}</td><td></td></tr>`; }
        return html`<tr style=${now ? 'background:var(--primary-soft)' : ''}><td>${l.unit ? html`<span class="muted small">${l.unit} — </span>` : null}${l.title}</td><td class="num">${s?.n || 0}${s && s.n < l.periods ? html` <span class="badge neg">ناقص ${l.periods - s.n}</span>` : null}</td><td>${l.weeks || ''}</td><td>${fmt(s?.first)}</td><td>${fmt(s?.last)}</td>
          <td>${d?.done >= d?.of ? html`<span class="badge pos">✓ تم</span>` : d?.done ? html`<span class="badge pri">${d.done}/${d.of}</span>` : ''}</td></tr>`; })}
    </tbody></table></div>` : html`<div class="table-wrap"><table class="tbl nowrap"><thead><tr><th>الأسبوع</th><th>اليوم</th><th>التاريخ</th><th>الحصة</th><th>الدرس</th></tr></thead><tbody>
      ${groups.map(gp => gp.rows.map((r, j) => html`<tr class=${j === 0 ? 'wk-top' : ''} style=${r.date === today ? 'background:var(--primary-soft)' : ''}>${j === 0 ? html`<td rowspan=${gp.rows.length}><b>${gp.wk?.n ? 'الأسبوع ' + gp.wk.n : '—'}</b></td>` : null}
        <td>${DAY_SHORT[dow(r.date)]}</td><td>${fmtShort(r.date)} <span class="muted small">${fmtH(r.date).slice(5)}</span></td><td class="num">${r.period}</td>
        <td>${r.unit ? html`${r.unit.lesson.title}${r.unit.of > 1 ? html` <span class="muted small">(${r.unit.k}/${r.unit.of})</span>` : null}` : r.activity ? html`<i>${r.activity.title}</i>` : html`<span class="muted">حصة احتياطية</span>`}</td></tr>`))}
    </tbody></table></div>`}</div>`;
}
