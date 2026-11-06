// المرحلة 2 — محررات النماذج قبل الطباعة: رصد مشكلة سلوكية، الإحالة وتتبعها، تقرير ولي الأمر
import { html, useState, useMemo } from '../lib.js';
import { S, get, all, ws, save, patch, audit, workspace, classes, className, roster, classOf, lastClassOf, eventTypes } from '../store.js';
import { useStore, Icon, Btn, Empty, go, formDialog, toast, Avatar } from '../ui.js';
import { printHTML } from '../print.js';
import { behaviorFormSheet, referralSheet, parentReportSheet } from '../forms.js';
import { gradeStudent } from '../gradeutil.js';
import { currentTerm, termRange, periodAt, evalPeriods, evalRange, defaultPeriod } from '../calendar.js';
import { REFERRAL_TO, REFERRAL_STATUS, RESPONSES, SEVERITIES, DEFAULT_REFERRAL_REASONS, DEFAULT_PARENT_TEMPLATES, severityOf } from '../defaults.js';
import { todayISO, addDays, fmtDate, fmtShort, nowMinutes, uuid } from '../utils.js';
import { taskMode } from '../grading.js';

const Paper = ({ htmlStr }) => html`<div class="paper-wrap"><div class="paper" dangerouslySetInnerHTML=${{ __html: htmlStr }}></div></div>`;
const Field = ({ label, children, full }) => html`<label class=${'field' + (full ? ' full' : '')}><span>${label}</span>${children}</label>`;
export const referralReasons = () => workspace()?.options?.referralReasons?.length ? workspace().options.referralReasons : DEFAULT_REFERRAL_REASONS;
export const parentTemplates = () => workspace()?.options?.parentTemplates?.length ? workspace().options.parentTemplates : DEFAULT_PARENT_TEMPLATES;

// اختيار طالب (فصل ثم طالب)
function StudentPicker({ value, onChange, includeLeft = true }) {
  const st = value ? get('students', value) : null;
  const [cid, setCid] = useState((st && (classOf(st.id) || lastClassOf(st.id))?.id) || classes()[0]?.id || '');
  const list = cid ? roster(cid, todayISO(), { includeLeft }) : [];
  return html`<div class="form-grid">
    <${Field} label="الفصل"><select value=${cid} onChange=${e => { setCid(e.target.value); onChange(''); }}>${classes().map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select></${Field}>
    <${Field} label="الطالب"><select value=${value || ''} onChange=${e => onChange(e.target.value)}><option value="">— اختر —</option>${list.map(x => html`<option value=${x.student.id}>${x.student.seat_no ? x.student.seat_no + '. ' : ''}${x.student.full_name}${x.active ? '' : ' (غير مسجل حالياً)'}</option>`)}</select></${Field}>
  </div>`;
}

// الأحداث السلبية للطالب (مع الغياب بدون عذر والتأخر من الحضور) — بلا أي ملاحظة خاصة
export function negativeIncidents(studentId, from, to) {
  const types = new Map(eventTypes({ activeOnly: false }).map(t => [t.id, t]));
  const bySys = new Map([...types.values()].filter(t => t.sys).map(t => [t.sys, t]));
  const out = [];
  for (const ev of all('events', e => e.student_id === studentId && !e.voided && e.date >= from && e.date <= to)) {
    const t = types.get(ev.type_id); if (!t || t.valence !== 'neg') continue;
    out.push({ id: ev.id, t, date: ev.date, period: get('sessions', ev.session_id)?.period || '', class_id: ev.class_id });
  }
  for (const a of all('attendance', a => a.student_id === studentId && a.date >= from && a.date <= to && ['late', 'absent_unexcused'].includes(a.status))) {
    const t = bySys.get(a.status); if (!t) continue;
    out.push({ id: 'att:' + a.id, t, date: a.date, period: get('sessions', a.session_id)?.period || '', class_id: a.class_id, minutes: a.late_minutes });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.period).localeCompare(String(b.period)));
}
// مدى الاستجابة من آخر إحالة مُعالجة بعد التاريخ
export function responseAfter(studentId, date) {
  const r = ws('referrals', r => r.student_id === studentId && r.status === 'resolved' && r.response && r.date >= date).sort((a, b) => a.date.localeCompare(b.date))[0];
  return r?.response || '';
}

// ---------- مركز النماذج (داخل صفحة الطباعة) ----------
export function FormsCenter() {
  useStore();
  const pending = ws('referrals', r => r.status !== 'resolved').length;
  return html`<div class="stack">
    <div class="grid-3">
      <a class="card li click" style="display:grid;gap:8px;text-decoration:none;color:inherit" href="#/form/behavior"><span class="hexmark"><${Icon} name="alert" /></span><b>نموذج رصد المعلم لمشكلة سلوكية</b><span class="muted small">على غرار النموذج الوزاري، يُعبّأ من السجل ويُعدَّل قبل الطباعة.</span></a>
      <a class="card li click" style="display:grid;gap:8px;text-decoration:none;color:inherit" href="#/form/referral"><span class="hexmark"><${Icon} name="file" /></span><b>نموذج إحالة طالب</b><span class="muted small">إلى الوكيل أو المرشد الطلابي أو المدير، مع تتبع الحالة.</span></a>
      <a class="card li click" style="display:grid;gap:8px;text-decoration:none;color:inherit" href="#/form/parent"><span class="hexmark"><${Icon} name="users" /></span><b>تقرير ولي الأمر</b><span class="muted small">أقسام تختارها ورسالة بقوالب جاهزة وطلب حضور اختياري.</span></a>
    </div>
    <div class="card"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">الإحالات</h2>${pending ? html`<span class="badge warn">${pending} بانتظار المعالجة</span>` : null}<span class="grow"></span><a class="btn primary sm" href="#/form/referral"><${Icon} name="plus" size=${16} /> إحالة جديدة</a></div>
      <${ReferralsList} /></div>
    <p class="muted small">كشف تفصيل الدرجة يُطبع من صفحة الدرجات ← اختر الطالب ← «كشف تفصيل الدرجة».</p>
  </div>`;
}

// ---------- قائمة الإحالات وتتبعها ----------
export async function changeReferralStatus(r) {
  const v = await formDialog({ title: 'تحديث حالة الإحالة', fields: [
    { name: 'status', label: 'الحالة', type: 'select', options: Object.entries(REFERRAL_STATUS).map(([value, label]) => ({ value, label })), value: r.status },
    { name: 'date', label: 'تاريخ التحديث', type: 'date', value: todayISO() },
    { name: 'response', label: 'مدى الاستجابة', type: 'select', options: [{ value: '', label: '—' }, ...RESPONSES], value: r.response || '' },
    { name: 'outcome', label: 'النتيجة / الإجراء الذي اتخذه المستلم', type: 'textarea', value: r.outcome || '' },
  ] });
  if (!v) return;
  const hist = [...(r.history || []), { status: v.status, date: v.date, at: new Date().toISOString() }];
  await patch('referrals', r.id, { status: v.status, response: v.response, outcome: v.outcome, history: hist, [`${v.status}_at`]: v.date });
  await audit('تحديث حالة إحالة', `${get('students', r.student_id)?.full_name} — ${REFERRAL_STATUS[v.status]}`, v.outcome || '');
  toast('حُدّثت الحالة', 'ok');
}
export function ReferralsList({ studentId = null }) {
  useStore();
  const [f, setF] = useState('open');
  const list = ws('referrals', r => (!studentId || r.student_id === studentId) && (f === 'all' || (f === 'open' ? r.status !== 'resolved' : r.status === 'resolved')))
    .sort((a, b) => b.date.localeCompare(a.date));
  const badge = s => html`<span class=${'badge ' + (s === 'resolved' ? 'pos' : s === 'received' ? 'pri' : 'warn')}>${REFERRAL_STATUS[s]}</span>`;
  return html`<div class="stack">
    <div class="chips">${[['open', 'قيد المتابعة'], ['done', 'عولجت'], ['all', 'الكل']].map(([k, l]) => html`<button class=${'chip' + (f === k ? ' on' : '')} onClick=${() => setF(k)}>${l}</button>`)}</div>
    ${list.length ? html`<div class="list">${list.map(r => { const st = get('students', r.student_id); const old = r.status !== 'resolved' && r.date <= addDays(todayISO(), -3); return html`<div class="li">
      ${st ? html`<${Avatar} student=${st} size=${38} />` : null}
      <div class="grow"><div class="main-t">${studentId ? '' : (st?.full_name || '—') + ' — '}إلى ${REFERRAL_TO[r.to_role] || ''}</div>
        <div class="sub-t">${fmtDate(r.date)} • ${(r.reasons || []).join('، ') || 'بلا سبب محدد'}${r.response ? ` • ${r.response}` : ''}${r.outcome ? ` • ${r.outcome}` : ''}</div></div>
      ${badge(r.status)}${old ? html`<span class="badge neg" title="مضى أكثر من 3 أيام">متأخرة الرد</span>` : null}
      <button class="btn sm" onClick=${() => changeReferralStatus(r)}>تحديث الحالة</button>
      <a class="btn sm ghost" href=${'#/form/referral?id=' + r.id}>فتح</a></div>`; })}</div>`
    : html`<${Empty} icon="file" title="لا توجد إحالات هنا" />`}</div>`;
}

// ---------- نموذج رصد مشكلة سلوكية ----------
export function BehaviorFormPage({ q = {} }) {
  useStore();
  const w = workspace(); const id = w.identity || {}; const today = todayISO();
  const t = currentTerm(w, today); const tr = termRange(w, t);
  const st0 = q.student ? get('students', q.student) : null;
  const cls0 = st0 ? (classOf(st0.id) || lastClassOf(st0.id)) : classes()[0];
  const [hdr, setHdr] = useState({ line1: id.country || 'المملكة العربية السعودية', line2: id.ministry || 'وزارة التعليم', region: id.region || '', school: id.school || '' });
  const [meta, setMeta] = useState({ subject: id.subject || '', cls: cls0 ? className(cls0) : '', teacher: id.teacher || '', date: today });
  const [rows, setRows] = useState([]);
  const [pick, setPick] = useState({ student: q.student || '', from: tr?.start || addDays(today, -30), to: today, grouped: false });
  const fill = () => {
    if (!pick.student) return toast('اختر الطالب أولاً', 'warn');
    const st = get('students', pick.student);
    const inc = negativeIncidents(pick.student, pick.from, pick.to);
    if (!inc.length) return toast('لا توجد مشكلات سلوكية مسجلة لهذا الطالب في الفترة', 'warn');
    // عدد التكرار تراكمي حتى تاريخ الواقعة (منذ بداية الفترة المختارة)
    const all0 = negativeIncidents(pick.student, pick.from, pick.to);
    const add = [];
    if (pick.grouped) {
      const g = new Map();
      for (const x of all0) { const k = x.t.id; const o = g.get(k) || { x, n: 0 }; o.n++; o.x = x; g.set(k, o); }
      for (const { x, n } of g.values()) add.push({ id: uuid(), name: st.full_name, problem: x.t.name, severity: severityOf(x.t), action: 'تنبيه شفهي', response: responseAfter(st.id, x.date), count: n, date: x.date, period: x.period });
    } else {
      const cnt = {};
      for (const x of all0) { cnt[x.t.id] = (cnt[x.t.id] || 0) + 1; add.push({ id: uuid(), name: st.full_name, problem: x.t.name + (x.minutes ? ` (${x.minutes} د)` : ''), severity: severityOf(x.t), action: 'تنبيه شفهي', response: responseAfter(st.id, x.date), count: cnt[x.t.id], date: x.date, period: x.period }); }
    }
    setRows(r => [...r, ...add]);
    if (!meta.cls) { const c = classOf(st.id) || lastClassOf(st.id); if (c) setMeta(m => ({ ...m, cls: className(c) })); }
    toast(`أُضيف ${add.length} صف`, 'ok');
  };
  const setRow = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const sheet = behaviorFormSheet({ hdr, subject: meta.subject, cls: meta.cls, rows, teacher: meta.teacher, date: meta.date });
  return html`<div class="page">
    <div class="page-head"><a class="icon-btn" href="#/print?tab=forms"><${Icon} name="back" /></a><div><h1>نموذج رصد المعلم لمشكلة سلوكية</h1><div class="sub">يُعبّأ تلقائياً من السجل، وكل حقل قابل للتعديل قبل الطباعة. لا تُدرج أي ملاحظة خاصة.</div></div>
      <div class="actions"><button class="btn primary" onClick=${() => printHTML(sheet)}><${Icon} name="print" /> طباعة</button></div></div>
    <div class="grid-2" style="align-items:start">
      <div class="stack">
        <div class="card stack"><h2>تعبئة من السجل</h2>
          <${StudentPicker} value=${pick.student} onChange=${v => setPick({ ...pick, student: v })} />
          <div class="form-grid"><${Field} label="من"><input type="date" value=${pick.from} onInput=${e => setPick({ ...pick, from: e.target.value })} /></${Field}><${Field} label="إلى"><input type="date" value=${pick.to} onInput=${e => setPick({ ...pick, to: e.target.value })} /></${Field}></div>
          <label class="check"><input type="checkbox" checked=${pick.grouped} onChange=${e => setPick({ ...pick, grouped: e.target.checked })} /> صف واحد لكل نوع مشكلة (مع إجمالي التكرار وآخر تاريخ)</label>
          <div class="row"><button class="btn soft" onClick=${fill}><${Icon} name="plus" /> إضافة الصفوف</button><button class="btn ghost" onClick=${() => setRows(r => [...r, { id: uuid(), name: '', problem: '', severity: 'بسيطة', action: '', response: '', count: '', date: today, period: '' }])}>صف فارغ</button>${rows.length ? html`<button class="btn ghost" onClick=${() => setRows([])}>مسح الكل</button>` : null}</div>
        </div>
        <div class="card"><h2>الترويسة والبيانات</h2><div class="form-grid">
          <${Field} label="السطر الأول (يمين)"><input value=${hdr.line1} onInput=${e => setHdr({ ...hdr, line1: e.target.value })} /></${Field}>
          <${Field} label="السطر الثاني"><input value=${hdr.line2} onInput=${e => setHdr({ ...hdr, line2: e.target.value })} /></${Field}>
          <${Field} label="المنطقة/المحافظة"><input value=${hdr.region} onInput=${e => setHdr({ ...hdr, region: e.target.value })} /></${Field}>
          <${Field} label="المدرسة"><input value=${hdr.school} onInput=${e => setHdr({ ...hdr, school: e.target.value })} /></${Field}>
          <${Field} label="المادة"><input value=${meta.subject} onInput=${e => setMeta({ ...meta, subject: e.target.value })} /></${Field}>
          <${Field} label="الصف"><input value=${meta.cls} onInput=${e => setMeta({ ...meta, cls: e.target.value })} /></${Field}>
          <${Field} label="اسم المعلم"><input value=${meta.teacher} onInput=${e => setMeta({ ...meta, teacher: e.target.value })} /></${Field}>
          <${Field} label="التاريخ"><input type="date" value=${meta.date} onInput=${e => setMeta({ ...meta, date: e.target.value })} /></${Field}></div>
          ${!w.logos?.ministry ? html`<p class="notice small" style="margin-bottom:0">لم يُرفع شعار الوزارة بعد — <a href="#/settings/school">ارفعه من الإعدادات</a>.</p>` : null}</div>
      </div>
      <div class="card"><h2>الصفوف (${rows.length}) — 5 في كل صفحة</h2>
        ${rows.length ? rows.map((r, i) => html`<div class="g-cat" key=${r.id}><div class="row" style="margin-bottom:6px"><b>${i + 1}</b><span class="grow"></span><button class="icon-btn" onClick=${() => setRows(rs => rs.filter((_, j) => j !== i))}><${Icon} name="trash" size=${16} /></button></div>
          <div class="form-grid">
            <${Field} label="اسم الطالب"><input value=${r.name} onInput=${e => setRow(i, 'name', e.target.value)} /></${Field}>
            <${Field} label="المشكلة السلوكية"><input value=${r.problem} onInput=${e => setRow(i, 'problem', e.target.value)} /></${Field}>
            <${Field} label="درجة المشكلة"><select value=${r.severity} onChange=${e => setRow(i, 'severity', e.target.value)}>${SEVERITIES.map(s => html`<option>${s}</option>`)}</select></${Field}>
            <${Field} label="الإجراء المتخذ"><input value=${r.action} onInput=${e => setRow(i, 'action', e.target.value)} /></${Field}>
            <${Field} label="مدى الاستجابة"><input list="resp-list" value=${r.response} onInput=${e => setRow(i, 'response', e.target.value)} /></${Field}>
            <${Field} label="عدد مرات التكرار"><input type="number" min="0" value=${r.count} onInput=${e => setRow(i, 'count', e.target.value)} /></${Field}>
            <${Field} label="التاريخ"><input type="date" value=${r.date} onInput=${e => setRow(i, 'date', e.target.value)} /></${Field}>
            <${Field} label="الحصة"><input value=${r.period} onInput=${e => setRow(i, 'period', e.target.value)} /></${Field}>
          </div></div>`) : html`<${Empty} icon="alert" title="لا صفوف بعد">اختر الطالب والفترة ثم «إضافة الصفوف».</${Empty}>`}
        <datalist id="resp-list">${RESPONSES.map(r => html`<option value=${r} />`)}</datalist>
      </div>
    </div>
    <div class="section-title" style="margin-top:18px">معاينة</div><${Paper} htmlStr=${sheet} />
  </div>`;
}

// ---------- نموذج إحالة طالب ----------
export function ReferralPage({ q = {} }) {
  useStore();
  const w = workspace(); const id = w.identity || {}; const today = todayISO();
  const existing = q.id ? get('referrals', q.id) : null;
  const [r, setR] = useState(() => existing ? { ...existing } : {
    student_id: q.student || '', to_role: 'deputy', date: today, period: periodAt(w, nowMinutes())?.n || '', subject: id.subject || '',
    reasons: [], description: '', severity: 'بسيطة', prior: [], prior_event_ids: [], requested: 'الاطلاع واتخاذ الإجراء المناسب وإفادتنا بالنتيجة.', status: 'sent',
  });
  const set = (k, v) => setR(x => ({ ...x, [k]: v }));
  const cur = r.id ? get('referrals', r.id) : null; // بعد الحفظ تظهر أدوات التتبع
  const st = r.student_id ? get('students', r.student_id) : null;
  const cls = st ? (classOf(st.id, r.date) || lastClassOf(st.id)) : null;
  const inc = st ? negativeIncidents(st.id, addDays(r.date, -90), r.date).reverse() : [];
  const contacts = st ? all('contacts', c => c.student_id === st.id).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const lineOf = x => `${fmtShort(x.date)}${x.period ? ` ح${x.period}` : ''}: ${x.t.name} — ${x.t.sys ? 'سُجّل في الحضور' : 'تنبيه الطالب'}`;
  const togglePrior = (key, text) => {
    const has = (r.prior_event_ids || []).includes(key);
    setR(x => ({ ...x, prior_event_ids: has ? x.prior_event_ids.filter(k => k !== key) : [...(x.prior_event_ids || []), key], prior: has ? x.prior.filter(p => p !== text) : [...(x.prior || []), text] }));
  };
  const reasonsAll = referralReasons();
  const toName = { deputy: id.deputy, counselor: id.counselor, principal: id.principal };
  const row = { ...r, class_id: cls?.id || r.class_id, to_name: toName[r.to_role] || '' };
  const sheet = st ? referralSheet({ ref: row, reasonsAll }) : '';
  const doSave = async () => {
    if (!st) { toast('اختر الطالب', 'warn'); return null; }
    if (!r.reasons.length && !r.description.trim()) { toast('حدد سبب الإحالة أو صف الواقعة', 'warn'); return null; }
    const saved = await save('referrals', { ...row, history: r.history || [{ status: 'sent', date: r.date, at: new Date().toISOString() }] });
    if (!r.id) await audit('إحالة طالب', `${st.full_name} إلى ${REFERRAL_TO[r.to_role]}`, r.reasons.join('، '));
    setR(saved); toast('حُفظت الإحالة', 'ok');
    if (!q.id) history.replaceState(null, '', '#/form/referral?id=' + saved.id);
    return saved;
  };
  return html`<div class="page">
    <div class="page-head"><a class="icon-btn" href="#/print?tab=forms"><${Icon} name="back" /></a><div><h1>${cur ? 'إحالة طالب' : 'إحالة جديدة'}</h1><div class="sub">لا تُدرج الملاحظات الخاصة تلقائياً؛ يُجلب «ما سبق اتخاذه» من الأحداث التي تختارها فقط.</div></div>
      <div class="actions">${cur ? html`<span class=${'badge ' + (cur.status === 'resolved' ? 'pos' : 'warn')}>${REFERRAL_STATUS[cur.status]}</span><button class="btn" onClick=${async () => { await changeReferralStatus(cur); setR({ ...get('referrals', cur.id) }); }}>تحديث الحالة</button>` : null}
        <${Btn} cls="" onClick=${doSave}>حفظ</${Btn}><${Btn} cls="primary" onClick=${async () => { const s = await doSave(); if (s) printHTML(referralSheet({ ref: s, reasonsAll })); }}><${Icon} name="print" /> حفظ وطباعة</${Btn}></div></div>
    <div class="grid-2" style="align-items:start">
      <div class="stack">
        <div class="card stack"><h2>الطالب والمستلم</h2>
          ${cur ? html`<div class="row"><${Avatar} student=${st} size=${40} /><b>${st?.full_name}</b><span class="muted">${className(cls)}</span></div>` : html`<${StudentPicker} value=${r.student_id} onChange=${v => set('student_id', v)} />`}
          <div class="chips">${Object.entries(REFERRAL_TO).map(([k, l]) => html`<button class=${'chip' + (r.to_role === k ? ' on' : '')} onClick=${() => set('to_role', k)}>${l}${toName[k] ? ` — ${toName[k]}` : ''}</button>`)}</div>
          ${!toName[r.to_role] ? html`<p class="muted small" style="margin:0">اسم ${REFERRAL_TO[r.to_role]} غير مسجل — أضفه من <a href="#/settings/school">الإعدادات ← المدرسة</a>.</p>` : null}
          <div class="form-grid"><${Field} label="التاريخ"><input type="date" value=${r.date} onInput=${e => set('date', e.target.value)} /></${Field}>
            <${Field} label="الحصة"><select value=${r.period} onChange=${e => set('period', e.target.value)}><option value="">—</option>${(w.day?.periods || []).map(p => html`<option value=${p.n}>${p.n}</option>`)}</select></${Field}>
            <${Field} label="المادة"><input value=${r.subject} onInput=${e => set('subject', e.target.value)} /></${Field}></div></div>
        <div class="card stack"><h2>سبب الإحالة ودرجة المشكلة</h2>
          <div class="chips">${reasonsAll.map(x => { const on = r.reasons.includes(x); return html`<button class=${'chip' + (on ? ' on' : '')} onClick=${() => set('reasons', on ? r.reasons.filter(y => y !== x) : [...r.reasons, x])}>${x}</button>`; })}</div>
          <div class="chips">${SEVERITIES.map(s => html`<button class=${'chip' + (r.severity === s ? ' on' : '')} onClick=${() => set('severity', s)}>${s}</button>`)}</div>
          <${Field} label="وصف الواقعة" full=${true}><textarea rows="3" value=${r.description} onInput=${e => set('description', e.target.value)}></textarea></${Field}>
          <${Field} label="المطلوب من المستلم" full=${true}><textarea rows="2" value=${r.requested} onInput=${e => set('requested', e.target.value)}></textarea></${Field}></div>
        <div class="card stack"><h2>ما سبق اتخاذه (اختر ما يُدرج)</h2>
          ${!st ? html`<p class="muted">اختر الطالب أولاً.</p>` : html`
            ${inc.length ? html`<div class="section-title">من الأحداث (آخر 90 يوماً)</div>${inc.slice(0, 30).map(x => { const tx = lineOf(x); return html`<label class="check small"><input type="checkbox" checked=${(r.prior_event_ids || []).includes(x.id)} onChange=${() => togglePrior(x.id, tx)} /> ${tx}</label>`; })}` : html`<p class="muted small">لا أحداث سلبية مسجلة.</p>`}
            ${contacts.length ? html`<div class="section-title">التواصل مع ولي الأمر</div>${contacts.slice(0, 10).map(c => { const tx = `${fmtShort(c.date)}: تواصل مع ولي الأمر (${c.method})`; return html`<label class="check small"><input type="checkbox" checked=${(r.prior_event_ids || []).includes('c:' + c.id)} onChange=${() => togglePrior('c:' + c.id, tx)} /> ${tx}</label>`; })}` : null}
            <${Field} label="إجراءات أخرى (سطر لكل إجراء)" full=${true}><textarea rows="2" value=${(r.prior_extra || '')} onInput=${e => { const extra = e.target.value; setR(x => ({ ...x, prior_extra: extra, prior: [...(x.prior || []).filter(p => !(x.prior_extra || '').split('\n').includes(p)), ...extra.split('\n').filter(Boolean)] })); }}></textarea></${Field}>`}
        </div>
      </div>
      <div>${st ? html`<div class="section-title">معاينة</div><${Paper} htmlStr=${sheet} />` : html`<div class="card"><${Empty} icon="file" title="اختر الطالب لعرض المعاينة" /></div>`}</div>
    </div></div>`;
}

// ---------- تقرير ولي الأمر ----------
function parentStats(stId, cls, term, pid = null) {
  const w = workspace(); const r = evalRange(w, term, pid); if (!r) return null;
  const inT = d => d >= r.start && d <= r.end;
  const types = new Map(eventTypes({ activeOnly: false }).map(t => [t.id, t]));
  const evs = all('events', e => e.student_id === stId && e.class_id === cls.id && !e.voided && inT(e.date));
  const positive = evs.filter(e => types.get(e.type_id)?.valence === 'pos').length;
  const correct = evs.filter(e => types.get(e.type_id)?.sys === 'answer_correct').length;
  const asked = all('picks', p => p.student_id === stId && p.class_id === cls.id && inT(p.date) && (p.consumed || p.volunteer)).length;
  const tasks = ws('tasks', t => (t.class_ids || []).includes(cls.id) && inT(t.date) && t.date <= todayISO());
  const res = new Map(all('task_results', x => x.student_id === stId).map(x => [x.task_id, x]));
  const hw = { total: 0, done: 0, partial: 0, late: 0, none: 0 };
  for (const t of tasks.filter(t => t.kind === 'homework' && taskMode(t) === 'status')) { const x = res.get(t.id); if (!x?.status || x.status === 'excused') continue; hw.total++; hw[x.status]++; }
  const tests = tasks.filter(t => ['quiz', 'monthly', 'final'].includes(t.kind) && !t.makeup_of).map(t => {
    const mk = tasks.find(m => m.makeup_of === t.id && res.get(m.id)?.score != null);
    const x = res.get(mk?.id) || res.get(t.id);
    return { title: t.title, date: t.date, max: t.max_score, earned: x?.score, excluded: x?.status === 'excused' ? 'معذور' : (x?.score == null ? 'لم تُرصد' : null) };
  });
  const beh = {};
  for (const e of evs) { const t = types.get(e.type_id); if (t?.valence === 'neg' && !t.sys) beh[t.name] = (beh[t.name] || 0) + 1; }
  return { positive, correct, asked, hw, tests, behavior: Object.entries(beh).map(([name, count]) => ({ name, count })) };
}
export function ParentReportPage({ q = {} }) {
  useStore();
  const w = workspace(); const today = todayISO();
  const [sid, setSid] = useState(q.student || '');
  const [term, setTerm0] = useState(currentTerm(w, today));
  const [pid, setPid] = useState(() => defaultPeriod(w, currentTerm(w, today), today));
  const setTerm = t => { setTerm0(t); setPid(defaultPeriod(w, t, today)); };
  const periods = evalPeriods(w, term); const P = pid && periods.some(p => p.id === pid) ? pid : null; const rng = evalRange(w, term, P);
  const [sec, setSec] = useState({ attendance: true, participation: true, homework: true, tests: true, behavior: true, grade: true, breakdown: true });
  const [message, setMessage] = useState('');
  const [request, setRequest] = useState({ on: false, date: addDays(today, 2), time: '09:00', purpose: '' });
  const [logIt, setLogIt] = useState(true);
  const st = sid ? get('students', sid) : null;
  const cls = st ? (classOf(st.id) || lastClassOf(st.id)) : null;
  const g = st && cls ? gradeStudent(st.id, cls.id, term, { pid: P }) : null;
  const stats = st && cls ? parentStats(st.id, cls, term, P) : null;
  const sheet = g && stats ? parentReportSheet({ st, cls, term, g, sections: sec, stats, message, request, label: rng?.label }) : '';
  const S_ = [['attendance', 'الحضور والغياب والتأخر'], ['participation', 'المشاركة'], ['homework', 'الواجبات'], ['tests', 'الاختبارات'], ['behavior', 'السلوك'], ['grade', 'الدرجة الأدائية'], ['breakdown', 'تفصيل الدرجة']];
  const doPrint = async () => {
    printHTML(sheet);
    if (logIt) await save('contacts', { student_id: st.id, date: today, method: 'خطاب', summary: `تقرير ولي الأمر (${rng?.label || ''})${request.on ? ' مع طلب حضور' : ''}` });
  };
  return html`<div class="page">
    <div class="page-head"><a class="icon-btn" href="#/print?tab=forms"><${Icon} name="back" /></a><div><h1>تقرير ولي الأمر</h1><div class="sub">لا يتضمن الملاحظات الخاصة ولا التنبيهات الصحية ولا أي مقارنة بطلاب آخرين.</div></div>
      <div class="actions"><${Btn} cls="primary" disabled=${!sheet} onClick=${doPrint}><${Icon} name="print" /> طباعة</${Btn}></div></div>
    <div class="grid-2" style="align-items:start">
      <div class="stack">
        <div class="card stack"><h2>الطالب</h2><${StudentPicker} value=${sid} onChange=${setSid} />
          <div class="chips">${[1, 2].map(t => html`<button class=${'chip' + (term === t ? ' on' : '')} onClick=${() => setTerm(t)}>الفصل الدراسي ${t === 1 ? 'الأول' : 'الثاني'}</button>`)}</div>
          ${periods.length ? html`<div class="chips">${periods.map(p => html`<button class=${'chip' + (P === p.id ? ' on' : '')} onClick=${() => setPid(p.id)}>${p.label}</button>`)}<button class=${'chip' + (!P ? ' on' : '')} onClick=${() => setPid(null)}>الفصل كاملاً</button></div>` : null}</div>
        <div class="card stack"><h2>أقسام التقرير</h2><div class="chips">${S_.map(([k, l]) => html`<button class=${'chip' + (sec[k] ? ' on' : '')} onClick=${() => setSec({ ...sec, [k]: !sec[k] })}>${l}</button>`)}</div></div>
        <div class="card stack"><h2>رسالة لولي الأمر</h2>
          <div class="chips">${parentTemplates().map(tp => html`<button class="chip" onClick=${() => setMessage(m => m ? m + '\n' + tp.text : tp.text)}>+ ${tp.title}</button>`)}</div>
          <textarea rows="5" value=${message} onInput=${e => setMessage(e.target.value)} placeholder="اكتب رسالتك أو اختر قالباً"></textarea>
          <label class="check"><input type="checkbox" checked=${request.on} onChange=${e => setRequest({ ...request, on: e.target.checked })} /> طلب حضور ولي الأمر</label>
          ${request.on ? html`<div class="form-grid"><${Field} label="اليوم"><input type="date" value=${request.date} onInput=${e => setRequest({ ...request, date: e.target.value })} /></${Field}><${Field} label="الساعة"><input type="time" value=${request.time} onInput=${e => setRequest({ ...request, time: e.target.value })} /></${Field}><${Field} label="الغرض" full=${true}><input value=${request.purpose} onInput=${e => setRequest({ ...request, purpose: e.target.value })} /></${Field}></div>` : null}
          <label class="check small"><input type="checkbox" checked=${logIt} onChange=${e => setLogIt(e.target.checked)} /> تسجيله في «سجل التواصل مع ولي الأمر» عند الطباعة</label></div>
      </div>
      <div>${sheet ? html`<div class="section-title">معاينة</div><${Paper} htmlStr=${sheet} />` : html`<div class="card"><${Empty} icon="users" title=${st && !termRange(w, term) ? 'حدد تواريخ الفصل الدراسي من الإعدادات' : 'اختر الطالب لعرض المعاينة'} /></div>`}</div>
    </div></div>`;
}
