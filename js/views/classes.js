// الفصول: قائمة الفصول، شاشة الفصل (الطلاب، المقاعد، العدالة)، إضافة طالب
import { html, useState } from '../lib.js';
import { ws, get, all, roster, classes, className, privateOf, patch, purge, audit, searchStudents, workspace } from '../store.js';
import { useStore, Icon, Avatar, Btn, Tabs, Empty, go, formDialog, confirmDialog, toast } from '../ui.js';
import { ensureClass, addStudent, nextSeat, openSession, gradeLabel } from '../ops.js';
import { pickStats } from '../picker.js';
import { todayISO, daysBetween, fmtDate, shortName, GRADE_NAMES, addDays, fmtNum } from '../utils.js';
import { termRange, currentTerm } from '../calendar.js';
import { SeatEditor } from './seatmap.js';

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
      <div class="actions"><a class="btn" href="#/portal"><${Icon} name="users" /> بوابة الطالب</a><a class="btn soft" href="#/import"><${Icon} name="upload" /> استيراد من Excel</a><${Btn} cls="primary" onClick=${addClass}><${Icon} name="plus" /> فصل جديد</${Btn}></div></div>
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
      <a class="btn" href=${`#/paper?class=${c.id}`}><${Icon} name="edit" /> إدخال من الكشف الورقي</a>
      <a class="btn" href=${`#/names?class=${c.id}`}><${Icon} name="eye" /> اختبر نفسك في الأسماء</a>
      <${Btn} cls="soft" onClick=${async () => { const s = await openSession({ classId: c.id, date: today, period: null, manual: true }); go('#/session/' + s.id); }}><${Icon} name="play" /> حصة يدوية</${Btn}>
      <${Btn} cls="primary" onClick=${add}><${Icon} name="plus" /> طالب</${Btn}></div></div>
    <${Tabs} active=${tab} onChange=${setTab} tabs=${[{ key: 'students', label: 'الطلاب' }, { key: 'seats', label: 'خريطة المقاعد' }, { key: 'fair', label: 'لوحة العدالة' }]} />
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
    ${tab === 'seats' ? html`<${SeatEditor} c=${c} />` : null}
    ${tab === 'fair' ? html`<${Fairness} c=${c} />` : null}
  </div>`;
}

// لوحة العدالة المتقدمة: التغطية، التوازن، توزيع النتائج، تغطية كل حصة
function Fairness({ c }) {
  const today = todayISO(); const w = workspace();
  const [range, setRange] = useState('term');
  const stale = +(w?.options?.picker?.staleDays || 14);
  const tr = termRange(w, currentTerm(w, today));
  const from = range === 'term' && tr ? tr.start : range === '30' ? addDays(today, -30) : '0000-01-01';
  const allPicks = ws('picks', p => p.class_id === c.id);
  const picks = allPicks.filter(p => p.date >= from);
  const stRow = get('picker_state', c.id);
  const cycle = stRow?.cycle_no || 1;
  const inCycle = new Set(allPicks.filter(p => p.consumed && p.cycle_no === cycle).map(p => p.student_id));
  const owed = new Set(stRow?.owed || []);
  const members = roster(c.id, today);
  const per = new Map(members.map(x => [x.student.id, { chances: 0, correct: 0, partial: 0, wrong: 0, no_answer: 0, volunteer: 0, last: null }]));
  for (const p of picks) {
    const o = per.get(p.student_id); if (!o) continue;
    if (p.volunteer) o.volunteer++; else if (p.consumed) o.chances++; else continue;
    if (o[p.outcome] != null) o[p.outcome]++;
    if (!o.last || p.date > o.last) o.last = p.date;
  }
  for (const p of allPicks) { const o = per.get(p.student_id); if (o && (!o.lastAll || p.date > o.lastAll)) o.lastAll = p.date; }
  const vals = [...per.values()].map(o => o.chances);
  const n = vals.length || 1, mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const sorted = [...vals].sort((a, b) => a - b); const total = sorted.reduce((a, b) => a + b, 0);
  const gini = total ? sorted.reduce((acc, v, i) => acc + (2 * (i + 1) - n - 1) * v, 0) / (n * total) : 0;
  const covered = vals.filter(v => v > 0).length;
  const max = Math.max(1, ...vals);
  const sessions = ws('sessions', s => s.class_id === c.id && s.date >= from).sort((a, b) => (b.date + (b.period || 0)).localeCompare(a.date + (a.period || 0))).slice(0, 12);
  const sessCov = sessions.map(s => {
    const att = all('attendance', a => a.session_id === s.id && a.status.startsWith('absent')).length;
    const present = Math.max(0, roster(c.id, s.date).length - att);
    const asked = new Set(allPicks.filter(p => p.session_id === s.id && !p.volunteer).map(p => p.student_id)).size;
    return { s, present, asked };
  });
  const rows = members.map(x => ({ x, o: per.get(x.student.id) })).sort((a, b) => a.o.chances - b.o.chances || (a.o.lastAll || '').localeCompare(b.o.lastAll || ''));
  const seg = (v, tot, color) => tot ? html`<i style=${`width:${v / tot * 100}%;background:${color}`}></i>` : null;
  return html`<div class="stack">
    <div class="row"><div class="chips">${[['term', 'الفصل الدراسي الحالي'], ['30', 'آخر 30 يوماً'], ['all', 'كل السنة']].map(([k, l]) => html`<button class=${'chip' + (range === k ? ' on' : '')} onClick=${() => setRange(k)}>${l}</button>`)}</div></div>
    <div class="stats">
      <div class="stat"><b>${covered}/${members.length}</b><span>سُئلوا مرة على الأقل</span></div>
      <div class="stat"><b>${fmtNum(mean, 1)}</b><span>متوسط الفرص للطالب</span></div>
      <div class="stat"><b>${vals.length ? Math.min(...vals) : 0}–${vals.length ? Math.max(...vals) : 0}</b><span>أقل وأكثر عدد فرص</span></div>
      <div class="stat"><b>${Math.round((1 - gini) * 100)}٪</b><span>مؤشر التوازن (100٪ = تساوٍ تام)</span></div>
      <div class="stat"><b>${cycle}</b><span>الدورة الحالية — سُئل ${inCycle.size} من ${members.length}</span></div>
    </div>
    <div class="card"><h2>الطلاب — الأقل فرصاً أولاً</h2>
      <div class="table-wrap"><table class="tbl nowrap"><thead><tr><th>الطالب</th><th style="min-width:180px">الفرص (الخط = المتوسط)</th><th style="min-width:140px">النتائج</th><th class="num">تطوع</th><th>آخر سؤال</th><th>الدورة</th></tr></thead>
      <tbody>${rows.map(({ x, o }) => { const days = o.lastAll ? daysBetween(o.lastAll, today) : null; const hi = o.chances > mean + 1.5 * sd && sd > 0; const ans = o.correct + o.partial + o.wrong + o.no_answer; return html`<tr class="click" onClick=${() => go('#/student/' + x.student.id)}>
        <td><span class="row" style="flex-wrap:nowrap"><${Avatar} student=${x.student} size=${30} /> ${x.student.full_name}</span></td>
        <td><div class="fbar"><i style=${`width:${o.chances / max * 100}%`}></i><span class="mean" style=${`inset-inline-start:${mean / max * 100}%`}></span></div><span class="small tnum">${o.chances}</span>${hi ? html` <span class="badge warn">يُسأل كثيراً</span>` : null}</td>
        <td><div class="sbar">${seg(o.correct, ans, 'var(--pos)')}${seg(o.partial, ans, 'var(--warn)')}${seg(o.wrong, ans, 'var(--neg)')}${seg(o.no_answer, ans, 'var(--neu)')}</div><span class="small muted tnum">✓${o.correct} ◐${o.partial} ✗${o.wrong} ⊘${o.no_answer}</span></td>
        <td class="num">${o.volunteer}</td>
        <td>${o.lastAll ? html`<span class=${days >= stale ? 'badge neg' : 'small'}>${fmtDate(o.lastAll, 'g')} (قبل ${days} يوم)</span>` : html`<span class="badge neg">لم يُسأل بعد</span>`}</td>
        <td>${inCycle.has(x.student.id) ? html`<span class="badge pos">✓ سُئل</span>` : owed.has(x.student.id) ? html`<span class="badge warn">دور مؤجل</span>` : html`<span class="badge">ينتظر</span>`}</td></tr>`; })}</tbody></table></div>
      <div class="row small muted" style="margin-top:8px"><span class="lg-dot" style="background:var(--pos)"></span>صحيحة<span class="lg-dot" style="background:var(--warn)"></span>شبه صحيحة<span class="lg-dot" style="background:var(--neg)"></span>خاطئة<span class="lg-dot" style="background:var(--neu)"></span>لم يجب</div></div>
    <div class="card"><h2>تغطية آخر الحصص</h2>${sessCov.length ? html`<div class="list">${sessCov.map(({ s, present, asked }) => html`<div class="row"><span class="small tnum" style="min-width:110px">${fmtDate(s.date, 'g')} ${s.period ? 'ح' + s.period : ''}</span><div class="fbar grow"><i style=${`width:${present ? asked / present * 100 : 0}%`}></i></div><span class="small tnum" style="min-width:90px">سُئل ${asked} من ${present}</span></div>`)}</div>` : html`<p class="muted">لا حصص في هذه الفترة.</p>`}</div>
  </div>`;
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
