// المهام والواجبات والاختبارات: القائمة، الإنشاء، شبكة الرصد السريع، الاختبار التعويضي
import { html, useState, useRef } from '../lib.js';
import { ws, get, all, save, patch, purge, audit, classes, className, roster } from '../store.js';
import { useStore, Icon, Btn, Tabs, Empty, go, formDialog, confirmDialog, toast, Avatar } from '../ui.js';
import { TASK_KINDS, HW_STATUS, taskMode } from '../grading.js';
import { todayISO, fmtDate, normDigits } from '../utils.js';
import { printHTML, taskSheet } from '../print.js';

export async function taskDialog(t = null, presetClass = null, preset = {}) {
  const cls = classes();
  if (!cls.length) { toast('أضف فصلاً أولاً', 'warn'); return null; }
  const v = await formDialog({ title: t ? 'تعديل المهمة' : 'مهمة جديدة', size: '', fields: [
    { name: 'kind', label: 'النوع', type: 'select', options: Object.entries(TASK_KINDS).map(([value, label]) => ({ value, label })), value: t?.kind || preset.kind || 'homework' },
    { name: 'title', label: 'العنوان', required: true, value: t?.title || '', full: true },
    { name: 'date', label: 'التاريخ', type: 'date', value: t?.date || preset.date || todayISO(), required: true },
    { name: 'due_date', label: 'موعد التسليم', type: 'date', value: t?.due_date || t?.date || preset.date || todayISO() },
    { name: 'max_score', label: 'الدرجة العظمى', type: 'number', step: '0.5', value: t?.max_score ?? '', hint: 'فارغة = تلقائي: الواجب بالحالات 1، اختبار الفترة 20، والباقي 10' },
    { name: 'mode', label: 'طريقة الرصد', type: 'select', options: [{ value: '', label: 'تلقائي (الواجب بالحالات، والباقي بالدرجة)' }, { value: 'status', label: 'حالات (تم/ناقص/لم يحل…)' }, { value: 'score', label: 'درجة رقمية' }], value: t?.mode || '' },
    { name: 'class_ids', label: 'الفصول', type: 'multi', options: cls.map(c => ({ value: c.id, label: className(c) })), value: t?.class_ids || (presetClass ? [presetClass] : [cls[0].id]) },
  ], validate: v => !v.class_ids.length ? 'اختر فصلاً واحداً على الأقل' : null });
  if (!v) return null;
  const max = v.max_score === '' ? (v.kind === 'monthly' ? 20 : (v.mode || (v.kind === 'homework' ? 'status' : 'score')) === 'status' ? 1 : 10) : +v.max_score;
  return save('tasks', { ...(t || {}), ...v, max_score: max, mode: v.mode || undefined });
}

export function TasksPage({ q = {} }) {
  useStore();
  const [cls, setCls] = useState(q.class || '');
  const [kind, setKind] = useState('');
  const list = ws('tasks', t => (!cls || (t.class_ids || []).includes(cls)) && (!kind || t.kind === kind)).sort((a, b) => b.date.localeCompare(a.date));
  const add = async () => { const t = await taskDialog(null, cls || null); if (t) go(`#/task/${t.id}?class=${t.class_ids[0]}`); };
  return html`<div class="page">
    <div class="page-head"><div><h1>المهام والاختبارات</h1><div class="sub">واجبات، أوراق عمل، اختبارات قصيرة، مهام أدائية، مشاريع، واختبارات شهرية</div></div>
      <div class="actions"><a class="btn" href=${'#/gradebook' + (cls ? '?class=' + cls : '')}><${Icon} name="grades" /> دفتر الدرجات (جدول)</a><${Btn} cls="primary" onClick=${add}><${Icon} name="plus" /> مهمة جديدة</${Btn}></div></div>
    <div class="row" style="margin-bottom:14px"><select style="max-width:220px" value=${cls} onChange=${e => setCls(e.target.value)}><option value="">كل الفصول</option>${classes().map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select>
      <div class="chips"><button class=${'chip' + (!kind ? ' on' : '')} onClick=${() => setKind('')}>الكل</button>${Object.entries(TASK_KINDS).map(([k, v]) => html`<button class=${'chip' + (kind === k ? ' on' : '')} onClick=${() => setKind(k)}>${v}</button>`)}</div></div>
    ${list.length ? html`<div class="list">${list.map(t => {
      const total = (t.class_ids || []).reduce((a, id) => a + roster(id, t.date).length, 0);
      const filled = all('task_results', r => r.task_id === t.id && (r.status || (r.score != null && r.score !== ''))).length;
      return html`<div class="li click" onClick=${() => go(`#/task/${t.id}?class=${(cls && t.class_ids.includes(cls)) ? cls : t.class_ids[0]}`)}>
        <span class="hexmark" style="width:44px;height:44px"><${Icon} name=${t.kind === 'monthly' ? 'grades' : 'tasks'} /></span>
        <div class="grow"><div class="main-t">${t.title} ${t.makeup_of ? html`<span class="badge warn">تعويضي</span>` : null}</div>
          <div class="sub-t">${TASK_KINDS[t.kind]} • ${fmtDate(t.date)} • ${(t.class_ids || []).map(id => className(get('classes', id))).join('، ')}${taskMode(t) === 'score' ? ` • من ${t.max_score}` : ''}</div></div>
        <span class=${'badge ' + (filled >= total && total ? 'pos' : filled ? 'warn' : '')}>رُصد ${filled}/${total}</span></div>`;
    })}</div>` : html`<div class="card"><${Empty} icon="tasks" title="لا توجد مهام"><button class="btn primary" onClick=${add}>إنشاء مهمة</button></${Empty}></div>`}
  </div>`;
}

export function TaskPage({ id, classId }) {
  useStore();
  const t = get('tasks', id);
  const inputs = useRef({});
  if (!t) return html`<div class="page"><${Empty} title="المهمة غير موجودة"><a class="btn" href="#/tasks">المهام</a></${Empty}></div>`;
  const cid = classId && t.class_ids.includes(classId) ? classId : t.class_ids[0];
  const list = roster(cid, t.date);
  const res = new Map(all('task_results', r => r.task_id === t.id).map(r => [r.student_id, r]));
  const absentOn = new Set(all('attendance', a => a.class_id === cid && a.date === t.date && a.status.startsWith('absent')).map(a => a.student_id));
  const mode = taskMode(t);
  const orig = t.makeup_of ? get('tasks', t.makeup_of) : null;
  const setRes = async (sid, changes) => {
    const r = res.get(sid);
    if (r) await patch('task_results', r.id, changes); else await save('task_results', { task_id: t.id, student_id: sid, ...changes });
  };
  const setScore = async (sid, val) => {
    const v = normDigits(val).trim();
    if (v === '') return setRes(sid, { score: null });
    const n = +v;
    if (isNaN(n) || n < 0 || n > +t.max_score) { toast(`الدرجة يجب أن تكون بين 0 و${t.max_score}`, 'err'); return; }
    await setRes(sid, { score: n, status: null });
  };
  const focusNext = i => { const next = inputs.current[i + 1]; if (next) { next.focus(); next.select(); } };
  const makeup = async () => {
    const v = await formDialog({ title: 'اختبار تعويضي', fields: [{ name: 'date', label: 'تاريخ التعويضي', type: 'date', value: todayISO(), required: true }] });
    if (!v) return;
    const m = await save('tasks', { kind: t.kind, title: 'تعويضي: ' + t.title, date: v.date, due_date: v.date, max_score: t.max_score, mode: t.mode, class_ids: t.class_ids, makeup_of: t.id });
    go(`#/task/${m.id}?class=${cid}`);
  };
  const del = async () => {
    if (!await confirmDialog({ title: 'حذف المهمة', message: `حذف «${t.title}» وكل نتائجها؟`, danger: true, okText: 'حذف' })) return;
    await purge('task_results', all('task_results', r => r.task_id === t.id).map(r => r.id)); await purge('tasks', [t.id]);
    await audit('حذف مهمة', t.title); go('#/tasks');
  };
  return html`<div class="page">
    <div class="page-head"><a class="icon-btn" href="#/tasks"><${Icon} name="back" /></a><div><h1>${t.title}</h1><div class="sub">${TASK_KINDS[t.kind]} • ${fmtDate(t.date)}${t.due_date && t.due_date !== t.date ? ` • التسليم ${fmtDate(t.due_date)}` : ''}${mode === 'score' ? ` • من ${t.max_score}` : ''}${orig ? ` • تعويضي عن «${orig.title}»` : ''}</div></div>
      <div class="actions"><button class="btn ghost sm" onClick=${() => taskDialog(t)}><${Icon} name="edit" size=${16} /> تعديل</button>
        ${!t.makeup_of && t.kind !== 'homework' ? html`<button class="btn sm" onClick=${makeup}>اختبار تعويضي</button>` : null}
        <button class="btn sm" onClick=${() => printHTML(taskSheet({ taskId: t.id, classId: cid }))}><${Icon} name="print" size=${16} /> طباعة الكشف</button>
        <button class="btn ghost sm" onClick=${del}><${Icon} name="trash" size=${16} /></button></div></div>
    ${t.class_ids.length > 1 ? html`<${Tabs} active=${cid} onChange=${c => go(`#/task/${t.id}?class=${c}`)} tabs=${t.class_ids.map(c => ({ key: c, label: className(get('classes', c)) }))} />` : null}
    ${orig ? html`<div class="info" style="margin-bottom:12px">أدخل درجات من اختبروا التعويضي فقط؛ تحل نتيجته محل الأصلي في الحساب.</div>` : null}
    <div class="card">
      ${mode === 'status' ? html`<div class="row" style="margin-bottom:10px"><${Btn} cls="sm soft" onClick=${async () => { for (const x of list) if (!res.get(x.student.id)?.status && !absentOn.has(x.student.id)) await setRes(x.student.id, { status: 'done' }); }}>الباقون «تم»</${Btn}><span class="muted small">المعذور والغائب بعذر لا يدخلان في المقام.</span></div>` : html`<p class="muted small" style="margin-top:0">اكتب الدرجة واضغط Enter للانتقال للطالب التالي. المعذور لا يدخل في المقام.</p>`}
      ${list.map((x, i) => { const r = res.get(x.student.id); return html`<div class="hw-row" key=${x.student.id}>
        <${Avatar} student=${x.student} size=${38} /><div><b>${x.student.seat_no ? x.student.seat_no + '. ' : ''}${x.student.full_name}</b> ${absentOn.has(x.student.id) ? html`<span class="badge neg">غائب يومها</span>` : null}</div>
        <div class="hw-btns">${mode === 'status'
          ? Object.entries(HW_STATUS).map(([k, v]) => html`<button class=${(r?.status === k ? 'on ' : '') + k} onClick=${() => setRes(x.student.id, { status: r?.status === k ? null : k })}>${v}</button>`)
          : html`<input class="score-in" inputmode="decimal" ref=${el => { inputs.current[i] = el; }} value=${r?.score ?? ''} placeholder="—" disabled=${r?.status === 'excused'}
              onChange=${e => setScore(x.student.id, e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') { e.target.blur(); focusNext(i); } }} />
            <span class="muted">/ ${t.max_score}</span>
            <button class=${(r?.status === 'excused' ? 'on ' : '') + 'excused'} onClick=${() => setRes(x.student.id, { status: r?.status === 'excused' ? null : 'excused', score: null })}>معذور</button>`}</div></div>`; })}
      ${!list.length ? html`<${Empty} icon="users" title="لا يوجد طلاب مسجلون في هذا الفصل بتاريخ المهمة" />` : null}
    </div></div>`;
}
