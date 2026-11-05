// الفصول: قائمة الفصول، شاشة الفصل (الطلاب، المقاعد، العدالة)، إضافة طالب
import { html, useState } from '../lib.js';
import { ws, get, all, roster, classes, className, privateOf, patch, purge, audit, searchStudents, workspace } from '../store.js';
import { useStore, Icon, Avatar, Btn, Tabs, Empty, go, formDialog, confirmDialog, toast } from '../ui.js';
import { ensureClass, addStudent, nextSeat, openSession, gradeLabel } from '../ops.js';
import { pickStats } from '../picker.js';
import { todayISO, daysBetween, fmtDate, shortName, GRADE_NAMES } from '../utils.js';

export function ClassesPage() {
  useStore();
  const cls = classes(); const today = todayISO();
  const addClass = async () => {
    const v = await formDialog({ title: 'فصل جديد', fields: [
      { name: 'grade', label: 'الصف', type: 'select', options: Object.entries(GRADE_NAMES).map(([k, l]) => ({ value: k, label: l })), value: '1' },
      { name: 'section', label: 'الشعبة', required: true, value: '1' },
    ] });
    if (!v) return;
    if (ws('classes', c => +c.grade === +v.grade && String(c.section) === String(v.section).trim()).length) return toast('هذا الفصل موجود', 'warn');
    await ensureClass(v.grade, v.section); toast('أُضيف الفصل', 'ok');
  };
  return html`<div class="page">
    <div class="page-head"><div><h1>الفصول والطلاب</h1><div class="sub">${cls.length} فصل • ${new Set(cls.flatMap(c => roster(c.id, today).map(x => x.student.id))).size} طالب نشط</div></div>
      <div class="actions"><a class="btn soft" href="#/import"><${Icon} name="upload" /> استيراد من Excel</a><${Btn} cls="primary" onClick=${addClass}><${Icon} name="plus" /> فصل جديد</${Btn}></div></div>
    ${cls.length ? html`<div class="grid-3">${cls.map(c => {
      const r = roster(c.id, today);
      return html`<div class="card li click" style="display:grid;gap:10px" onClick=${() => go('#/class/' + c.id)}>
        <div class="row"><span class="hexmark" style="width:48px;height:48px;font-weight:800">${c.section}</span><div class="grow"><div class="main-t" style="font-size:1.1rem">${className(c)}</div><div class="sub-t">${r.length} طالب نشط</div></div></div>
        <div class="row" style="gap:-6px">${r.slice(0, 8).map(x => html`<${Avatar} student=${x.student} size=${30} />`)}${r.length > 8 ? html`<span class="badge">+${r.length - 8}</span>` : null}</div>
      </div>`;
    })}</div>` : html`<div class="card"><${Empty} icon="users" title="لا توجد فصول بعد">استورد طلابك من ملف Excel فتُنشأ الفصول تلقائياً، أو أضف فصلاً يدوياً.<div class="row" style="justify-content:center"><a class="btn primary" href="#/import">استيراد من Excel</a></div></${Empty}></div>`}
  </div>`;
}

export function ClassPage({ id, tab = 'students' }) {
  useStore();
  const c = get('classes', id);
  const [q, setQ] = useState('');
  const [showLeft, setShowLeft] = useState(false);
  if (!c) return html`<div class="page"><${Empty} title="الفصل غير موجود" /></div>`;
  const today = todayISO();
  const list = roster(c.id, today, { includeLeft: showLeft });
  const shown = searchStudents(q, list);
  const setTab = t => go(`#/class/${id}?tab=${t}`);
  const add = () => addStudentDialog(c.id);
  const edit = async () => {
    const v = await formDialog({ title: 'تعديل الفصل', fields: [
      { name: 'grade', label: 'الصف', type: 'select', options: Object.entries(GRADE_NAMES).map(([k, l]) => ({ value: k, label: l })), value: String(c.grade) },
      { name: 'section', label: 'الشعبة', required: true, value: c.section },
      { name: 'name', label: 'الاسم المعروض', value: c.name, full: true },
    ] });
    if (!v) return;
    await patch('classes', c.id, { grade: +v.grade, section: v.section, grade_label: gradeLabel(+v.grade), name: v.name || `${gradeLabel(+v.grade)} / ${v.section}` });
  };
  const del = async () => {
    if (all('enrollments', e => e.class_id === c.id).length) return toast('لا يمكن حذف فصل فيه طلاب. انقل الطلاب أولاً.', 'warn');
    if (!await confirmDialog({ title: 'حذف الفصل', message: `حذف ${className(c)}؟`, danger: true, okText: 'حذف' })) return;
    await purge('classes', [c.id]); await audit('حذف فصل', className(c)); go('#/classes');
  };
  return html`<div class="page">
    <div class="page-head"><a class="icon-btn" href="#/classes"><${Icon} name="back" /></a><div><h1>${className(c)}</h1><div class="sub">${roster(c.id, today).length} طالب نشط</div></div>
      <div class="actions"><button class="btn ghost sm" onClick=${edit}><${Icon} name="edit" size=${16} /> تعديل</button><button class="btn ghost sm" onClick=${del}><${Icon} name="trash" size=${16} /></button>
      <a class="btn" href=${`#/print?class=${c.id}`}><${Icon} name="print" /> كشف المتابعة</a>
      <${Btn} cls="soft" onClick=${async () => { const s = await openSession({ classId: c.id, date: today, period: null, manual: true }); go('#/session/' + s.id); }}><${Icon} name="play" /> حصة يدوية</${Btn}>
      <${Btn} cls="primary" onClick=${add}><${Icon} name="plus" /> طالب</${Btn}></div></div>
    <${Tabs} active=${tab} onChange=${setTab} tabs=${[{ key: 'students', label: 'الطلاب' }, { key: 'seats', label: 'المقاعد' }, { key: 'fair', label: 'لوحة العدالة' }]} />
    ${tab === 'students' ? html`
      <div class="row" style="margin-bottom:12px"><div class="search grow" style="max-width:420px"><${Icon} name="search" size=${18} /><input placeholder="ابحث بجزء من الاسم أو بالرقم" value=${q} onInput=${e => setQ(e.target.value)} /></div>
        <label class="check small"><input type="checkbox" checked=${showLeft} onChange=${e => setShowLeft(e.target.checked)} /> إظهار المنسحبين والمنقولين</label></div>
      ${shown.length ? html`<div class="sgrid">${shown.map(x => {
        const pv = privateOf(x.student.id);
        return html`<div class=${'stile' + (x.active ? '' : ' left')} onClick=${() => go('#/student/' + x.student.id)}>
          <span class="seat">${x.student.seat_no || ''}</span>${pv.starred ? html`<span class="star">★</span>` : null}
          <${Avatar} student=${x.student} size=${62} health=${true} /><span class="nm">${x.student.full_name}</span>
          <span class="marks">${(pv.tags || []).slice(0, 2).map(t => html`<span class="badge pri">${t}</span>`)}</span></div>`;
      })}</div>` : html`<${Empty} icon="users" title=${q ? 'لا نتائج' : 'لا يوجد طلاب'}>${!q ? html`<button class="btn primary" onClick=${add}>إضافة طالب</button>` : null}</${Empty}>`}` : null}
    ${tab === 'seats' ? html`<${Seats} c=${c} list=${roster(c.id, today)} />` : null}
    ${tab === 'fair' ? html`<${Fairness} c=${c} />` : null}
  </div>`;
}

function Seats({ c, list }) {
  const [cols, setCols] = useState(c.seat_cols || 6);
  const max = Math.max(list.length, ...list.map(x => +x.student.seat_no || 0));
  const bySeat = new Map(list.map(x => [+x.student.seat_no, x]));
  const change = async x => {
    const v = await formDialog({ title: `رقم مقعد ${x.student.full_name}`, fields: [{ name: 'n', label: 'الرقم', type: 'number', value: x.student.seat_no, required: true }] });
    if (!v) return;
    const other = bySeat.get(+v.n);
    if (other && other.student.id !== x.student.id) await patch('students', other.student.id, { seat_no: x.student.seat_no });
    await patch('students', x.student.id, { seat_no: +v.n });
  };
  return html`<div class="card">
    <div class="row" style="margin-bottom:12px"><span class="muted">عرض مبسّط مرتب بالرقم — اضغط طالباً لتغيير رقمه (يُبدَّل مع صاحب الرقم).</span><span class="grow"></span>
      <label class="row small">أعمدة <input type="number" min="2" max="10" style="width:70px" value=${cols} onChange=${e => { setCols(+e.target.value); patch('classes', c.id, { seat_cols: +e.target.value }); }} /></label></div>
    <div style="text-align:center;margin-bottom:10px"><span class="badge pri">السبورة</span></div>
    <div style=${`display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:8px`}>
      ${Array.from({ length: Math.ceil(max / cols) * cols }, (_, i) => { const x = bySeat.get(i + 1); return x
        ? html`<div class="stile" style="padding:8px 4px" onClick=${() => change(x)}><span class="seat">${i + 1}</span><${Avatar} student=${x.student} size=${38} /><span class="nm small">${shortName(x.student.full_name)}</span></div>`
        : html`<div class="stile" style="opacity:.35;padding:8px 4px;cursor:default"><span class="seat">${i + 1}</span><span class="small muted" style="margin-top:22px">فارغ</span></div>`; })}
    </div></div>`;
}

function Fairness({ c }) {
  const today = todayISO();
  const stale = +(workspace()?.options?.picker?.staleDays || 14);
  const picks = ws('picks', p => p.class_id === c.id);
  const st = pickStats(picks);
  const stRow = get('picker_state', c.id);
  const cycle = stRow?.cycle_no || 1;
  const inCycle = new Set(picks.filter(p => p.consumed && p.cycle_no === cycle).map(p => p.student_id));
  const rows = roster(c.id, today).map(x => ({ x, s: st.get(x.student.id) || { chances: 0, answers: 0, correct: 0, volunteer: 0, last: null } }))
    .sort((a, b) => (a.s.last || '').localeCompare(b.s.last || '') || a.s.chances - b.s.chances);
  const owed = new Set(stRow?.owed || []);
  return html`<div class="card">
    <div class="row" style="margin-bottom:10px"><b>الدورة الحالية: ${cycle}</b><span class="badge pos">سُئل ${inCycle.size} من ${rows.length}</span><span class="muted small">الأقل سؤالاً والأقدم أولاً. يُميَّز من لم يُسأل منذ ${stale} يوماً.</span></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>الطالب</th><th class="num">الفرص</th><th class="num">أجاب</th><th class="num">صحيحة</th><th class="num">تطوع</th><th>آخر سؤال</th><th>في الدورة</th></tr></thead>
    <tbody>${rows.map(({ x, s }) => { const days = s.last ? daysBetween(s.last, today) : null; const old = days == null || days >= stale; return html`<tr class="click" onClick=${() => go('#/student/' + x.student.id)}>
      <td><span class="row" style="flex-wrap:nowrap"><${Avatar} student=${x.student} size=${32} /> ${x.student.full_name}</span></td>
      <td class="num">${s.chances}</td><td class="num">${s.answers}</td><td class="num">${s.correct}</td><td class="num">${s.volunteer}</td>
      <td>${s.last ? html`<span class=${old ? 'badge neg' : ''}>${fmtDate(s.last, 'g')} (قبل ${days} يوم)</span>` : html`<span class="badge neg">لم يُسأل بعد</span>`}</td>
      <td>${inCycle.has(x.student.id) ? html`<span class="badge pos">✓ سُئل</span>` : owed.has(x.student.id) ? html`<span class="badge warn">له دور مؤجل</span>` : html`<span class="badge">ينتظر</span>`}</td></tr>`; })}</tbody></table></div></div>`;
}

export async function addStudentDialog(classId) {
  const v = await formDialog({ title: 'إضافة طالب', size: '', fields: [
    { name: 'full_name', label: 'الاسم الكامل', required: true, full: true },
    { name: 'nid', label: 'السجل المدني (اختياري)', inputmode: 'numeric', hint: 'لا يُحفظ كاملاً؛ تُحفظ آخر 4 أرقام فقط' },
    { name: 'seat_no', label: 'رقم المقعد', type: 'number', value: nextSeat(classId) },
    { name: 'guardian_phone', label: 'جوال ولي الأمر', inputmode: 'tel' },
    { name: 'start_date', label: 'تاريخ الالتحاق بالفصل', type: 'date', value: todayISO(), required: true },
    { name: 'note', label: 'ملاحظة الالتحاق', placeholder: 'ملتحق من مدرسة أخرى…', full: true },
  ] });
  if (!v) return;
  const st = await addStudent({ ...v, classId });
  toast('أُضيف ' + st.full_name, 'ok');
}
