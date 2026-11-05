// بطاقة الطالب: البيانات، التنبيهات الصحية، الوسوم، الملاحظات الخاصة، التواصل، السجل، دورة الحياة
import { html, useState } from '../lib.js';
import { get, all, ws, save, patch, purge, audit, classes, className, enrollmentsOf, classOf, lastClassOf, privateOf, photoOf, roster } from '../store.js';
import { useStore, Icon, Avatar, Btn, Tabs, Empty, go, formDialog, confirmDialog, toast } from '../ui.js';
import { setNid, transferStudent, withdrawStudent, reinstateStudent, mergeStudents, purgeStudent, voidEvent } from '../ops.js';
import { HEALTH_FLAGS, TEACHER_TAGS, NOTE_KINDS, CONTACT_METHODS } from '../defaults.js';
import { todayISO, fmtDate, compressImage, fmtNum } from '../utils.js';
import { currentTerm } from '../calendar.js';
import { ATT_STATUS } from '../grading.js';
import { workspace } from '../store.js';
import { ReferralsList } from './forms.js';

export function StudentPage({ id, tab = 'profile' }) {
  useStore();
  const st = get('students', id);
  if (!st) return html`<div class="page"><${Empty} title="الطالب غير موجود"><a class="btn" href="#/classes">الفصول</a></${Empty}></div>`;
  const cls = classOf(id) || lastClassOf(id);
  const active = !!classOf(id);
  const pv = privateOf(id);
  const setTab = t => go(`#/student/${id}?tab=${t}`);
  const notesN = all('notes', n => n.student_id === id).length;
  return html`<div class="page">
    <div class="page-head"><a class="icon-btn" href=${cls ? '#/class/' + cls.id : '#/classes'}><${Icon} name="back" /></a>
      <${Avatar} student=${st} size=${64} health=${true} />
      <div><h1>${st.full_name} ${pv.starred ? html`<span style="color:#eab308">★</span>` : null}</h1>
        <div class="sub">${className(cls)} • رقم ${st.seat_no || '—'} ${!active ? html` • <span class="badge neg">${st.status === 'withdrawn' ? 'منسحب' : 'غير مسجل حالياً'}</span>` : null}</div></div>
      <div class="actions">
        <button class="btn ghost" onClick=${() => patch('student_private', id, { ...pv, starred: !pv.starred })}><${Icon} name="star" /> ${pv.starred ? 'إلغاء المتابعة' : 'متابعة'}</button>
        ${cls ? html`<a class="btn soft" href=${`#/grade/${cls.id}/${currentTerm(workspace(), todayISO())}/${id}`}><${Icon} name="grades" /> شرح الدرجة</a>` : null}
        <a class="btn" href=${'#/form/parent?student=' + id}><${Icon} name="users" /> تقرير ولي الأمر</a>
        <a class="btn" href=${'#/form/behavior?student=' + id}><${Icon} name="alert" /> رصد مشكلة سلوكية</a>
        <a class="btn" href=${'#/form/referral?student=' + id}><${Icon} name="file" /> إحالة</a>
      </div></div>
    <${Tabs} active=${tab} onChange=${setTab} tabs=${[{ key: 'profile', label: 'البيانات' }, { key: 'notes', label: 'ملاحظات خاصة', badge: notesN || null }, { key: 'contacts', label: 'التواصل مع ولي الأمر' }, { key: 'log', label: 'السجل' }, { key: 'life', label: 'التسجيل والنقل' }, { key: 'ref', label: 'الإحالات', badge: ws('referrals', r => r.student_id === id && r.status !== 'resolved').length || null }]} />
    ${tab === 'profile' ? html`<${Profile} st=${st} pv=${pv} />` : null}
    ${tab === 'notes' ? html`<${Notes} st=${st} />` : null}
    ${tab === 'contacts' ? html`<${Contacts} st=${st} />` : null}
    ${tab === 'log' ? html`<${Log} st=${st} />` : null}
    ${tab === 'life' ? html`<${Life} st=${st} />` : null}
    ${tab === 'ref' ? html`<div class="card"><div class="row" style="margin-bottom:12px"><h2 style="margin:0">الإحالات</h2><span class="grow"></span><a class="btn primary sm" href=${'#/form/referral?student=' + id}><${Icon} name="plus" size=${16} /> إحالة جديدة</a></div><${ReferralsList} studentId=${id} /></div>` : null}
  </div>`;
}

function Profile({ st, pv }) {
  const savePv = changes => save('student_private', { ...pv, id: st.id, student_id: st.id, ...changes });
  const editBasic = async () => {
    const v = await formDialog({ title: 'تعديل البيانات', fields: [
      { name: 'full_name', label: 'الاسم الكامل', value: st.full_name, required: true, full: true },
      { name: 'seat_no', label: 'رقم المقعد', type: 'number', value: st.seat_no },
      { name: 'guardian_phone', label: 'جوال ولي الأمر', value: st.guardian_phone || '', inputmode: 'tel' },
    ] });
    if (v) await patch('students', st.id, { full_name: v.full_name.trim(), seat_no: +v.seat_no || null, guardian_phone: v.guardian_phone });
  };
  const editNid = async () => {
    const v = await formDialog({ title: 'السجل المدني', fields: [{ name: 'nid', label: 'رقم السجل المدني (10 أرقام)', inputmode: 'numeric', required: true, hint: 'يُستخدم لحظة الحفظ فقط: يُحفظ على الخادم كبصمة مشفرة (HMAC) وتبقى آخر 4 أرقام للعرض' }] });
    if (v) { await setNid(st.id, v.nid); toast('حُفظ', 'ok'); }
  };
  const upload = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const data = await compressImage(f, { maxDim: 400, maxBytes: 60000 }); await save('student_photos', { id: st.id, student_id: st.id, data, status: 'approved', source: 'teacher' }); toast('حُفظت الصورة', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  };
  const photo = photoOf(st.id);
  return html`<div class="grid-2">
    <div class="card"><h2><${Icon} name="users" /> البيانات الأساسية</h2>
      <dl class="kv"><dt>الاسم</dt><dd>${st.full_name}</dd><dt>السجل المدني</dt><dd class="ltr" style="text-align:right">${st.id_last4 ? '•••••• ' + st.id_last4 : '—'}</dd>
        <dt>رقم المقعد</dt><dd>${st.seat_no || '—'}</dd><dt>جوال ولي الأمر</dt><dd>${st.guardian_phone ? html`<a href=${'tel:' + st.guardian_phone} class="ltr">${st.guardian_phone}</a>` : '—'}</dd>
        ${st.join_note ? html`<dt>ملاحظة الالتحاق</dt><dd>${st.join_note}</dd>` : null}</dl>
      <div class="row" style="margin-top:14px"><button class="btn sm" onClick=${editBasic}><${Icon} name="edit" size=${16} /> تعديل</button><button class="btn sm" onClick=${editNid}>تحديث السجل المدني</button>
        <label class="btn sm"><${Icon} name="upload" size=${16} /> ${photo ? 'تغيير الصورة' : 'رفع صورة'}<input type="file" accept="image/*" hidden onChange=${upload} /></label>
        ${photo ? html`<button class="btn sm ghost" onClick=${() => purge('student_photos', [st.id])}>حذف الصورة</button>` : null}</div>
    </div>
    <div class="card"><h2><${Icon} name="heart" /> تنبيهات صحية <span class="badge">خاصة بالمعلم</span></h2>
      <div class="chips">${HEALTH_FLAGS.map(h => { const on = (pv.health || []).includes(h); return html`<button class=${'chip' + (on ? ' on' : '')} style=${on ? 'background:var(--neg)' : ''} onClick=${() => savePv({ health: on ? pv.health.filter(x => x !== h) : [...(pv.health || []), h] })}>${h}</button>`; })}</div>
      <label class="field" style="margin-top:10px"><span>تفاصيل (نص حر)</span><textarea rows="2" value=${pv.health_note || ''} onChange=${e => savePv({ health_note: e.target.value })} placeholder="مثال: يحمل بخاخاً، يُراعى في المختبر…"></textarea></label>
      <h3 style="margin-top:16px">وسوم المعلم</h3>
      <div class="chips">${[...new Set([...TEACHER_TAGS, ...(pv.tags || [])])].map(t => { const on = (pv.tags || []).includes(t); return html`<button class=${'chip' + (on ? ' on' : '')} onClick=${() => savePv({ tags: on ? pv.tags.filter(x => x !== t) : [...(pv.tags || []), t] })}>${t}</button>`; })}
        <button class="chip" onClick=${async () => { const v = await formDialog({ title: 'وسم جديد', fields: [{ name: 't', label: 'الوسم', required: true }] }); if (v) savePv({ tags: [...(pv.tags || []), v.t.trim()] }); }}>+ وسم</button></div>
      <p class="muted small" style="margin-top:10px">التنبيهات الصحية والوسوم والملاحظات الخاصة لا تظهر للطالب ولا في وضع العرض ولا في أي تقرير.</p>
    </div>
  </div>`;
}

function Notes({ st }) {
  useStore();
  const notes = all('notes', n => n.student_id === st.id).sort((a, b) => (b.date + b.created_at).localeCompare(a.date + a.created_at));
  const [kind, setKind] = useState('');
  const add = async (n = null) => {
    const v = await formDialog({ title: n ? 'تعديل ملاحظة' : 'ملاحظة خاصة جديدة', fields: [
      { name: 'kind', label: 'النوع', type: 'select', options: Object.entries(NOTE_KINDS).map(([value, label]) => ({ value, label })), value: n?.kind || 'general' },
      { name: 'date', label: 'التاريخ', type: 'date', value: n?.date || todayISO() },
      { name: 'text', label: 'النص', type: 'textarea', value: n?.text || '', required: true },
    ] });
    if (!v) return;
    await save('notes', { ...(n || {}), student_id: st.id, ...v });
  };
  const shown = kind ? notes.filter(n => n.kind === kind) : notes;
  return html`<div class="card">
    <div class="row" style="margin-bottom:12px"><div class="chips"><button class=${'chip' + (!kind ? ' on' : '')} onClick=${() => setKind('')}>الكل</button>${Object.entries(NOTE_KINDS).map(([k, v]) => html`<button class=${'chip' + (kind === k ? ' on' : '')} onClick=${() => setKind(k)}>${v}</button>`)}</div><span class="grow"></span><button class="btn primary sm" onClick=${() => add()}><${Icon} name="plus" size=${16} /> ملاحظة</button></div>
    ${shown.length ? html`<div class="timeline">${shown.map(n => html`<div class="tl-item"><span class="when">${fmtDate(n.date, 'g')}</span><span class="badge">${NOTE_KINDS[n.kind] || 'عام'}</span>
      <span class=${'grow' + (n.done ? ' voided' : '')}>${n.text}</span>
      ${n.kind === 'reminder' ? html`<button class="btn sm ghost" onClick=${() => patch('notes', n.id, { done: !n.done })}>${n.done ? 'إعادة' : 'تم'}</button>` : null}
      <button class="icon-btn" onClick=${() => add(n)}><${Icon} name="edit" size=${16} /></button>
      <button class="icon-btn" onClick=${async () => { if (await confirmDialog({ title: 'حذف الملاحظة', message: n.text, danger: true, okText: 'حذف' })) await purge('notes', [n.id]); }}><${Icon} name="trash" size=${16} /></button></div>`)}</div>`
    : html`<${Empty} icon="note" title="لا توجد ملاحظات" />`}</div>`;
}

function Contacts({ st }) {
  useStore();
  const list = all('contacts', c => c.student_id === st.id).sort((a, b) => b.date.localeCompare(a.date));
  const add = async (c = null) => {
    const v = await formDialog({ title: 'تسجيل تواصل مع ولي الأمر', fields: [
      { name: 'date', label: 'التاريخ', type: 'date', value: c?.date || todayISO(), required: true },
      { name: 'method', label: 'الوسيلة', type: 'select', options: CONTACT_METHODS, value: c?.method || CONTACT_METHODS[0] },
      { name: 'summary', label: 'الملخص', type: 'textarea', value: c?.summary || '', required: true },
    ] });
    if (v) await save('contacts', { ...(c || {}), student_id: st.id, ...v });
  };
  return html`<div class="card"><div class="row" style="margin-bottom:12px"><span class="muted">جوال ولي الأمر: ${st.guardian_phone ? html`<a class="ltr" href=${'tel:' + st.guardian_phone}>${st.guardian_phone}</a>` : '—'}</span><span class="grow"></span><button class="btn primary sm" onClick=${() => add()}><${Icon} name="plus" size=${16} /> تواصل</button></div>
    ${list.length ? html`<div class="timeline">${list.map(c => html`<div class="tl-item"><span class="when">${fmtDate(c.date, 'g')}</span><span class="badge pri">${c.method}</span><span class="grow">${c.summary}</span><button class="icon-btn" onClick=${() => add(c)}><${Icon} name="edit" size=${16} /></button></div>`)}</div>` : html`<${Empty} icon="phone" title="لا يوجد تواصل مسجل" />`}</div>`;
}

function Log({ st }) {
  useStore();
  const [showVoided, setShowVoided] = useState(false);
  const evs = all('events', e => e.student_id === st.id && (showVoided || !e.voided)).sort((a, b) => (b.date + (b.created_at || '')).localeCompare(a.date + (a.created_at || '')));
  const att = all('attendance', a => a.student_id === st.id && a.status !== 'present').sort((a, b) => b.date.localeCompare(a.date));
  const doVoid = async e => {
    const r = await formDialog({ title: 'إلغاء حدث', fields: [{ name: 'reason', label: 'السبب (إلزامي)', required: true }], okText: 'إلغاء الحدث' });
    if (r) { await voidEvent(e.id, r.reason); toast('أُلغي الحدث وسُجّل في سجل التدقيق'); }
  };
  return html`<div class="grid-2">
    <div class="card"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">الأحداث</h2><span class="grow"></span><label class="check small"><input type="checkbox" checked=${showVoided} onChange=${e => setShowVoided(e.target.checked)} /> إظهار الملغاة</label></div>
      ${evs.length ? html`<div class="timeline">${evs.slice(0, 200).map(e => { const t = get('event_types', e.type_id); const s = e.session_id ? get('sessions', e.session_id) : null; return html`<div class=${'tl-item' + (e.voided ? ' voided' : '')}>
        <span class="when">${fmtDate(e.date, 'g')}${s?.period ? ` ح${s.period}` : ''}</span><span class=${'mk ' + (t?.valence || 'neu')}>${t?.code || '•'}</span>
        <span class="grow">${t?.name || '—'} <span class="muted small">${t ? `(${t.points > 0 ? '+' : ''}${fmtNum(t.points * (e.factor ?? 1))})` : ''} ${className(get('classes', e.class_id))}</span>${e.voided ? html`<div class="small">أُلغي: ${e.void_reason}</div>` : null}</span>
        ${!e.voided ? html`<button class="btn sm danger-soft" onClick=${() => doVoid(e)}>إلغاء</button>` : null}</div>`; })}</div>` : html`<${Empty} title="لا أحداث" />`}</div>
    <div class="card"><h2>الغياب والتأخر</h2>
      ${att.length ? html`<div class="timeline">${att.map(a => { const s = get('sessions', a.session_id); return html`<div class="tl-item"><span class="when">${fmtDate(a.date, 'g')}${s?.period ? ` ح${s.period}` : ''}</span><span class=${'badge ' + (a.status === 'absent_unexcused' ? 'neg' : a.status === 'late' ? 'warn' : '')}>${ATT_STATUS[a.status]}${a.late_minutes ? ` ${a.late_minutes} د` : ''}</span><span class="grow muted small">${className(get('classes', a.class_id))}</span></div>`; })}</div>` : html`<${Empty} icon="check" title="لا غياب ولا تأخر" />`}</div>
  </div>`;
}

function Life({ st }) {
  useStore();
  const es = enrollmentsOf(st.id);
  const cur = classOf(st.id);
  const transfer = async () => {
    const opts = classes().filter(c => c.id !== cur?.id);
    if (!opts.length) return toast('لا يوجد فصل آخر', 'warn');
    const v = await formDialog({ title: 'نقل إلى شعبة أخرى', fields: [{ name: 'to', label: 'الفصل الجديد', type: 'select', options: opts.map(c => ({ value: c.id, label: className(c) })), value: opts[0].id }, { name: 'date', label: 'تاريخ السريان', type: 'date', value: todayISO(), required: true }] });
    if (v) { await transferStudent(st.id, v.to, v.date); toast('تم النقل مع حفظ التاريخ', 'ok'); }
  };
  const withdraw = async () => {
    const v = await formDialog({ title: 'انسحاب الطالب', fields: [{ name: 'date', label: 'تاريخ الانسحاب', type: 'date', value: todayISO(), required: true }, { name: 'reason', label: 'السبب', required: true, full: true }] });
    if (v) { await withdrawStudent(st.id, v.date, v.reason); toast('سُجّل الانسحاب — تبقى بياناته ويمكن إعادته', 'ok'); }
  };
  const reinstate = async () => {
    const last = lastClassOf(st.id);
    const v = await formDialog({ title: 'إعادة الطالب', fields: [{ name: 'cls', label: 'الفصل', type: 'select', options: classes().map(c => ({ value: c.id, label: className(c) })), value: last?.id }, { name: 'date', label: 'تاريخ العودة', type: 'date', value: todayISO(), required: true }] });
    if (v) { await reinstateStudent(st.id, v.cls, v.date); toast('أُعيد الطالب', 'ok'); }
  };
  const merge = async () => {
    const others = ws('students', s => s.id !== st.id).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
    const v = await formDialog({ title: 'دمج سجل مكرر في هذا الطالب', fields: [{ name: 'dup', label: 'السجل المكرر (سيُدمج ثم يُحذف)', type: 'select', options: others.map(s => ({ value: s.id, label: `${s.full_name} — ${className(lastClassOf(s.id))}` })), value: others[0]?.id }] });
    if (!v) return;
    const dup = get('students', v.dup);
    if (await confirmDialog({ title: 'تأكيد الدمج', message: `ستُنقل كل أحداث وحضور ودرجات «${dup.full_name}» إلى «${st.full_name}» ثم يُحذف السجل المكرر.`, okText: 'دمج' })) { await mergeStudents(st.id, v.dup); toast('تم الدمج', 'ok'); }
  };
  const del = async () => {
    if (!await confirmDialog({ title: 'حذف الطالب نهائياً', message: 'سيُحذف الطالب وكل أحداثه وحضوره ودرجاته وملاحظاته من الجهاز والخادم. لا يمكن التراجع.', danger: true, okText: 'متابعة' })) return;
    if (!await confirmDialog({ title: 'تأكيد نهائي', message: 'اكتب اسم الطالب للتأكيد.', danger: true, okText: 'حذف نهائي', typeToConfirm: st.full_name.trim() })) return;
    const back = lastClassOf(st.id);
    await purgeStudent(st.id); toast('حُذف الطالب نهائياً'); go(back ? '#/class/' + back.id : '#/classes');
  };
  return html`<div class="grid-2">
    <div class="card"><h2>سجل التسجيل في الفصول</h2>
      <div class="timeline">${es.map(e => html`<div class="tl-item"><span class="grow"><b>${className(get('classes', e.class_id))}</b><div class="small muted">من ${fmtDate(e.start_date)} ${e.end_date ? `إلى ${fmtDate(e.end_date)}` : '— حتى الآن'} ${e.end_reason ? `(${e.end_reason})` : ''}</div></span></div>`)}</div>
      ${st.status === 'withdrawn' ? html`<div class="notice" style="margin-top:10px">منسحب بتاريخ ${fmtDate(st.withdraw_date)} — ${st.withdraw_reason || ''}</div>` : null}
      <p class="muted small" style="margin-top:10px">كل الحسابات والتقارير تحتسب فقط الفترة التي كان فيها الطالب مسجلاً في الفصل.</p></div>
    <div class="card stack"><h2>إجراءات</h2>
      ${cur ? html`<button class="btn" onClick=${transfer}><${Icon} name="swap" /> نقل إلى شعبة أخرى بتاريخ سريان</button><button class="btn" onClick=${withdraw}><${Icon} name="logout" /> انسحاب بتاريخ وسبب</button>`
      : html`<button class="btn primary" onClick=${reinstate}><${Icon} name="undo" /> إعادة الطالب</button>`}
      <button class="btn" onClick=${merge}><${Icon} name="users" /> دمج سجل مكرر</button>
      <button class="btn danger-soft" onClick=${del}><${Icon} name="trash" /> حذف نهائي</button></div>
  </div>`;
}
