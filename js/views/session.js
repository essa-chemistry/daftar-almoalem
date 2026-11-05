// شاشة الحصة: الحضور، شبكة الطلاب، الأحداث السريعة، الاختيار العادل، وضع الواجب، الملاحظات
import { html, render, useState, useEffect, useRef, useMemo } from '../lib.js';
import { S, get, ws, all, save, patch, purge, workspace, roster, className, sessionAttendance, sessionEvents, eventTypes, typeBySys, privateOf } from '../store.js';
import { useStore, Icon, Avatar, Btn, openModal, ModalHead, toast, formDialog, confirmDialog, go, useLongPress, Empty } from '../ui.js';
import { setAttendance, addEvent, voidEvent, openSession } from '../ops.js';
import { choose } from '../picker.js';
import { periodInfo, termOf } from '../calendar.js';
import { plannedFor, progress } from '../plan.js';
import { statusText, statusCls } from './plan.js';
import { SeatGrid, seatMapOf } from './seatmap.js';
import { printHTML, sessionSheet } from '../print.js';
import { todayISO, nowMinutes, parseHM, fmtDateLong, shortName, normAr, fmtNum } from '../utils.js';
import { HW_STATUS, taskMode } from '../grading.js';
import { NOTE_KINDS } from '../defaults.js';

const ATT_NEXT = { present: 'absent_unexcused', absent_unexcused: 'absent_excused', absent_excused: 'late', late: 'present' };
const ATT_LABEL = { present: 'حاضر', late: 'متأخر', absent_excused: 'غائب بعذر', absent_unexcused: 'غائب بدون عذر' };
const undoStacks = new Map(); // سجل التراجع لكل حصة (يبقى أثناء التنقل)

function useSessionData(id) {
  const s = get('sessions', id);
  if (!s) return null;
  const cls = get('classes', s.class_id);
  const list = roster(s.class_id, s.date);
  const att = sessionAttendance(s.id);
  const evs = sessionEvents(s.id);
  const statusOf = sid => att.get(sid)?.status || 'present';
  const present = list.filter(x => !statusOf(x.student.id).startsWith('absent')).map(x => x.student.id);
  return { s, cls, list, att, evs, statusOf, present };
}

export function SessionPage({ id }) {
  useStore();
  const d = useSessionData(id);
  const [mode, setMode] = useState('grid'); // grid | attendance | homework
  const [layout, setLayout] = useState(() => { try { return localStorage.getItem('daftar-layout') || 'grid'; } catch { return 'grid'; } });
  const [q, setQ] = useState('');
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 15000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const onKey = e => {
      if (e.target.closest('input,textarea,select') || document.querySelector('.modal-back')) return;
      if (e.code === 'Space' || e.key === 'p' || e.key === 'ج') { e.preventDefault(); openPicker(id); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [id]);
  if (!d) return html`<div class="page"><${Empty} title="الحصة غير موجودة"><a class="btn" href="#/today">العودة لليوم</a></${Empty}></div>`;
  const { s, cls, list, evs, statusOf, present } = d;
  const w = workspace(); const per = periodInfo(w, s.period);
  const remaining = s.date === todayISO() && per ? parseHM(per.end) - nowMinutes() : null;
  const counts = { present: 0, late: 0, absent_excused: 0, absent_unexcused: 0 };
  for (const x of list) counts[statusOf(x.student.id)]++;
  const shown = q ? list.filter(x => normAr(x.student.full_name).includes(normAr(q)) || String(x.student.seat_no) === q) : list;
  const exempt = new Set(s.exempt || []);

  const tapTile = async x => {
    if (mode === 'attendance') {
      const cur = sessionAttendance(s.id).get(x.student.id)?.status || 'present'; // قراءة حديثة لتجنب اللمسات السريعة
      await setAttendance(s, x.student.id, ATT_NEXT[cur]);
    } else openStudentSheet(s.id, x.student.id);
  };
  return html`<div class="page">
    <div class="sess-head">
      <a class="icon-btn" href="#/today" title="رجوع"><${Icon} name="back" /></a>
      <div class="grow"><h1>${className(cls)}</h1><div class="muted small">${fmtDateLong(s.date)} ${s.period ? `• الحصة ${s.period}` : '• حصة يدوية'} ${per ? `(${per.start}–${per.end})` : ''} ${s.status === 'closed' ? html`<span class="badge">منتهية</span>` : null}</div></div>
      ${remaining != null && remaining > 0 && remaining < 120 ? html`<span class=${'timer' + (remaining <= 5 ? ' low' : '')}><${Icon} name="clock" size=${16} /> ${remaining} دقيقة</span>` : null}
      <button class="btn sm ghost" onClick=${() => printHTML(sessionSheet({ classId: s.class_id, date: s.date, period: s.period }))}><${Icon} name="print" size=${16} /> كشف الحصة</button>
      <${Btn} cls="sm deep" onClick=${() => endSession(s.id)}><${Icon} name="stop" size=${16} /> إنهاء الحصة</${Btn}>
    </div>
    <${PlanBar} s=${s} />
    <div class="sess-bar">
      <button class="btn primary pick-btn" onClick=${() => openPicker(s.id)}><${Icon} name="shuffle" /> اختر طالباً <span class="kbd" style="color:#fff;opacity:.8">مسافة</span></button>
      <button class=${'btn ' + (mode === 'attendance' ? 'deep' : '')} onClick=${() => setMode(mode === 'attendance' ? 'grid' : 'attendance')}><${Icon} name="check" /> الحضور</button>
      <button class=${'btn ' + (mode === 'homework' ? 'deep' : '')} onClick=${() => setMode(mode === 'homework' ? 'grid' : 'homework')}><${Icon} name="tasks" /> الواجب</button>
      <button class="btn" onClick=${() => quickNote(s, null)}><${Icon} name="mic" /> ملاحظة</button>
      <button class="btn" onClick=${() => openPicker(s.id, true)} title="وضع العرض أمام الطلاب"><${Icon} name="screen" /> عرض</button>
    </div>
    <div class="att-strip">
      <span class="badge pos">حاضر ${counts.present + counts.late}</span>
      ${counts.late ? html`<span class="badge warn">متأخر ${counts.late}</span>` : null}
      ${counts.absent_unexcused ? html`<span class="badge neg">غائب بدون عذر ${counts.absent_unexcused}</span>` : null}
      ${counts.absent_excused ? html`<span class="badge">غائب بعذر ${counts.absent_excused}</span>` : null}
      <span class="badge pri">أحداث ${evs.length}</span>
      ${mode === 'attendance' ? html`<span class="info small" style="padding:3px 10px">وضع الحضور: كل لمسة تغيّر الحالة (حاضر ← غائب بدون عذر ← بعذر ← متأخر)</span>` : null}
      <span class="grow"></span>
      ${seatMapOf(cls) ? html`<div class="chips"><button class=${'chip' + (layout === 'grid' ? ' on' : '')} onClick=${() => { setLayout('grid'); try { localStorage.setItem('daftar-layout', 'grid'); } catch { } }}>شبكة</button><button class=${'chip' + (layout === 'seats' ? ' on' : '')} onClick=${() => { setLayout('seats'); try { localStorage.setItem('daftar-layout', 'seats'); } catch { } }}>المقاعد</button></div>` : null}
      <div class="search" style="min-width:180px"><${Icon} name="search" size=${18} /><input placeholder="بحث بالاسم أو الرقم" value=${q} onInput=${e => setQ(e.target.value)} /></div>
    </div>
    ${mode === 'homework' ? html`<${HomeworkMode} s=${s} list=${list} statusOf=${statusOf} />` : html`
    ${layout === 'seats' && seatMapOf(cls) && !q ? html`<${SeatGrid} c=${cls} list=${list} renderTile=${x => html`<${Tile} key=${x.student.id} x=${x} st=${statusOf(x.student.id)} evs=${evs.filter(e => e.student_id === x.student.id)} exempt=${exempt.has(x.student.id)} onTap=${() => tapTile(x)} onLong=${() => quickNote(s, x.student.id)} />`} />`
    : html`<div class="sgrid">${shown.map(x => html`<${Tile} key=${x.student.id} x=${x} st=${statusOf(x.student.id)} evs=${evs.filter(e => e.student_id === x.student.id)} exempt=${exempt.has(x.student.id)} onTap=${() => tapTile(x)} onLong=${() => quickNote(s, x.student.id)} />`)}</div>`}
    ${!list.length ? html`<${Empty} icon="users" title="لا يوجد طلاب في هذا الفصل بتاريخ الحصة"><a class="btn soft" href=${'#/class/' + s.class_id}>إدارة الفصل</a></${Empty}>` : null}`}
  </div>`;
}

function Tile({ x, st, evs, exempt, onTap, onLong }) {
  const lp = useLongPress(onLong, onTap);
  const pv = privateOf(x.student.id);
  const marks = evs.map(e => { const t = get('event_types', e.type_id); return t ? { code: t.code || t.icon, v: t.valence, id: e.id } : null; }).filter(Boolean);
  const cls = 'stile' + (st.startsWith('absent') ? ' absent' : st === 'late' ? ' late' : '') + (exempt ? ' exempt' : '');
  return html`<div class=${cls} ...${lp} role="button" tabindex="0" onKeyDown=${e => e.key === 'Enter' && onTap()}>
    <span class="seat">${x.student.seat_no || ''}</span>${pv.starred ? html`<span class="star">★</span>` : null}
    <${Avatar} student=${x.student} size=${58} health=${true} />
    <span class="nm">${shortName(x.student.full_name)}</span>
    <span class="marks">${st !== 'present' ? html`<span class=${'mk ' + (st === 'absent_excused' ? 'neu' : 'neg')}>${{ late: 'ت', absent_excused: 'ع', absent_unexcused: 'غ' }[st]}</span>` : null}${marks.slice(0, 6).map(m => html`<span class=${'mk ' + m.v}>${m.code}</span>`)}${marks.length > 6 ? html`<span class="mk neu">+${marks.length - 6}</span>` : null}${exempt ? html`<span class="mk neu" title="معفى من الأسئلة اليوم">⊝</span>` : null}</span>
  </div>`;
}

// ---------- لوحة الطالب ----------
function openStudentSheet(sessionId, studentId) {
  openModal(close => html`<${StudentSheet} sessionId=${sessionId} studentId=${studentId} close=${close} />`, { size: 'lg' });
}
function quickTypes() {
  const w = workspace(); const pinned = w.options?.quickTypes || [];
  const usage = {}; for (const e of ws('events')) usage[e.type_id] = (usage[e.type_id] || 0) + 1;
  return eventTypes().filter(t => !['late', 'absent_unexcused', 'absent_excused'].includes(t.sys))
    .sort((a, b) => {
      const pa = pinned.indexOf(a.id), pb = pinned.indexOf(b.id);
      if (pa !== -1 || pb !== -1) return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
      return (usage[b.id] || 0) - (usage[a.id] || 0) || (a.order ?? 0) - (b.order ?? 0);
    });
}
function StudentSheet({ sessionId, studentId, close }) {
  useStore();
  const s = get('sessions', sessionId); const st = get('students', studentId);
  if (!s || !st) return null;
  const a = sessionAttendance(s.id).get(studentId); const status = a?.status || 'present';
  const evs = sessionEvents(s.id).filter(e => e.student_id === studentId);
  const pv = privateOf(studentId);
  const exempt = (s.exempt || []).includes(studentId);
  const add = async t => {
    await addEvent(s, studentId, t.id);
    navigator.vibrate?.(15);
    toast(`${t.icon || ''} ${t.name} — ${shortName(st.full_name)}`, t.valence === 'neg' ? 'warn' : 'ok', 1800);
  };
  const setAtt = async v => {
    if (v === 'late') {
      const r = await formDialog({ title: 'تأخر عن الدخول', fields: [{ name: 'm', label: 'عدد الدقائق (اختياري)', type: 'number', inputmode: 'numeric', value: a?.late_minutes || '' }], okText: 'تسجيل' });
      if (!r) return; return setAttendance(s, studentId, 'late', r.m ? +r.m : null);
    }
    return setAttendance(s, studentId, v);
  };
  return html`<${ModalHead} title=${html`<span class="row"><${Avatar} student=${st} size=${42} /> <span>${st.full_name}<div class="muted small">رقم ${st.seat_no || '—'}</div></span></span>`} close=${close}>
    <a class="btn sm ghost" href=${'#/student/' + studentId} onClick=${close}>الملف</a></${ModalHead}>
    <div class="modal-body stack">
      ${(pv.health || []).length || pv.health_note ? html`<div class="error small">⚕ تنبيه صحي: ${[...(pv.health || []), pv.health_note].filter(Boolean).join('، ')}</div>` : null}
      <div><div class="section-title">الحضور</div><div class="att-btns">${['present', 'late', 'absent_excused', 'absent_unexcused'].map(k => html`<${Btn} cls=${status === k ? 'on' : ''} onClick=${() => setAtt(k)}>${ATT_LABEL[k]}${k === 'late' && a?.late_minutes ? ` (${a.late_minutes}د)` : ''}</${Btn}>`)}</div></div>
      <label class="check"><input type="checkbox" checked=${exempt} onChange=${e => patch('sessions', s.id, { exempt: e.target.checked ? [...(s.exempt || []), studentId] : (s.exempt || []).filter(x => x !== studentId) })} /> إعفاء من الأسئلة اليوم (مريض/متعب) — لا يضر بعدالته</label>
      <div><div class="section-title">تسجيل حدث</div>
        <div class="ev-grid">${quickTypes().map(t => html`<${Btn} key=${t.id} cls=${'ev-btn ' + t.valence} onClick=${() => add(t)}><span class="e-ic">${t.icon || t.code}</span><span>${t.name}</span><span class="e-pt">${t.points > 0 ? '+' : ''}${fmtNum(t.points)}</span></${Btn}>`)}</div></div>
      <div><div class="section-title">ما سُجّل في هذه الحصة</div>
        ${evs.length ? html`<div class="timeline">${evs.map(e => { const t = get('event_types', e.type_id); return html`<div class="tl-item"><span class=${'mk ' + (t?.valence || 'neu')}>${t?.code || '•'}</span><span class="grow">${t?.name || 'نوع محذوف'}${e.factor && e.factor !== 1 ? ` (×${e.factor})` : ''}${e.volunteer ? ' — متطوع' : ''}</span>
          <button class="btn sm danger-soft" onClick=${async () => {
            const r = await formDialog({ title: 'إلغاء حدث', fields: [{ name: 'reason', label: 'سبب الإلغاء', required: true, value: 'سُجّل بالخطأ' }], okText: 'إلغاء الحدث' });
            if (r) { await voidEvent(e.id, r.reason); toast('أُلغي الحدث'); }
          }}>إلغاء</button></div>`; })}</div>` : html`<p class="muted small">لا شيء بعد.</p>`}</div>
    </div>
    <div class="modal-foot"><button class="btn" onClick=${() => quickNote(s, studentId)}><${Icon} name="note" /> ملاحظة خاصة</button><button class="btn primary" onClick=${close}>تم</button></div>`;
}

// ---------- ملاحظة سريعة (نصية أو صوتية) ----------
export function quickNote(session, studentId) {
  openModal(close => html`<${NoteDialog} session=${session} studentId=${studentId} close=${close} />`, { size: 'sm' });
}
function NoteDialog({ session, studentId, close }) {
  const [text, setText] = useState(''); const [kind, setKind] = useState('general'); const [who, setWho] = useState(studentId || '');
  const [rec, setRec] = useState(false); const recRef = useRef(null);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const list = session ? roster(session.class_id, session.date) : [];
  const mic = () => {
    if (rec) { recRef.current?.stop(); return; }
    const r = new SR(); r.lang = 'ar-SA'; r.interimResults = false; r.continuous = true;
    r.onresult = ev => { const t = [...ev.results].slice(ev.resultIndex).map(x => x[0].transcript).join(' '); setText(v => (v ? v + ' ' : '') + t); };
    r.onend = () => setRec(false); r.onerror = e => { setRec(false); toast('تعذر التعرف على الصوت: ' + (e.error || ''), 'warn'); };
    recRef.current = r; r.start(); setRec(true);
  };
  useEffect(() => () => recRef.current?.stop(), []);
  const saveNote = async () => {
    if (!text.trim()) return toast('اكتب الملاحظة أولاً', 'warn');
    await save('notes', { student_id: who || null, session_id: session?.id || null, class_id: session?.class_id || null, date: session?.date || todayISO(), kind, text: text.trim() });
    toast('حُفظت الملاحظة', 'ok'); close();
  };
  return html`<${ModalHead} title="ملاحظة سريعة" close=${close} />
    <div class="modal-body stack">
      <label class="field"><span>مرتبطة بـ</span><select value=${who} onChange=${e => setWho(e.target.value)}><option value="">الحصة كلها</option>${list.map(x => html`<option value=${x.student.id}>${x.student.full_name}</option>`)}</select></label>
      <div class="chips">${Object.entries(NOTE_KINDS).map(([k, v]) => html`<button class=${'chip' + (kind === k ? ' on' : '')} onClick=${() => setKind(k)}>${v}</button>`)}</div>
      <label class="field"><span>النص (خاص بالمعلم ولا يظهر للطالب)</span><textarea rows="4" value=${text} onInput=${e => setText(e.target.value)} autofocus></textarea></label>
      ${SR ? html`<button class=${'btn ' + (rec ? 'danger' : 'soft')} onClick=${mic}><${Icon} name="mic" /> ${rec ? 'إيقاف التسجيل الصوتي' : 'إملاء صوتي بالعربية'}</button>` : html`<p class="muted small">الإملاء الصوتي غير مدعوم في هذا المتصفح.</p>`}
    </div>
    <div class="modal-foot"><button class="btn ghost" onClick=${close}>إلغاء</button><${Btn} cls="primary" onClick=${saveNote}>حفظ</${Btn}></div>`;
}

// ---------- وضع الواجب ----------
function HomeworkMode({ s, list, statusOf }) {
  useStore();
  const tasks = ws('tasks', t => t.kind === 'homework' && (t.class_ids || []).includes(s.class_id)).sort((a, b) => b.date.localeCompare(a.date));
  const [taskId, setTaskId] = useState(() => (tasks.find(t => t.due_date === s.date) || tasks[0])?.id || '');
  const t = get('tasks', taskId);
  const res = new Map(all('task_results', r => r.task_id === taskId).map(r => [r.student_id, r]));
  const newHw = async () => {
    const v = await formDialog({ title: 'واجب جديد', fields: [{ name: 'title', label: 'العنوان', required: true, full: true }, { name: 'date', label: 'تاريخ الإسناد', type: 'date', value: s.date }, { name: 'due', label: 'موعد التسليم', type: 'date', value: s.date }] });
    if (!v) return;
    const nt = await save('tasks', { kind: 'homework', title: v.title, date: v.date, due_date: v.due, max_score: 1, class_ids: [s.class_id] });
    setTaskId(nt.id);
  };
  const set = async (sid, st) => {
    const r = res.get(sid);
    if (r) await patch('task_results', r.id, { status: r.status === st ? null : st });
    else await save('task_results', { task_id: taskId, student_id: sid, status: st });
  };
  const allDone = async () => { for (const x of list) if (!res.get(x.student.id)?.status && !statusOf(x.student.id).startsWith('absent')) await set(x.student.id, 'done'); };
  return html`<div class="card">
    <div class="row" style="margin-bottom:12px">
      <select style="max-width:420px" value=${taskId} onChange=${e => setTaskId(e.target.value)}>${!tasks.length ? html`<option value="">لا توجد واجبات</option>` : null}${tasks.map(t => html`<option value=${t.id}>${t.title} — ${t.due_date || t.date}</option>`)}</select>
      <button class="btn soft" onClick=${newHw}><${Icon} name="plus" /> واجب جديد</button>
      ${t ? html`<${Btn} cls="ghost" onClick=${allDone}>الباقون «تم»</${Btn}>` : null}
    </div>
    ${t ? list.map(x => { const r = res.get(x.student.id); const absent = statusOf(x.student.id).startsWith('absent'); return html`<div class="hw-row" key=${x.student.id}>
      <${Avatar} student=${x.student} size=${38} /><div><b>${x.student.full_name}</b>${absent ? html` <span class="badge neg">غائب</span>` : null}</div>
      <div class="hw-btns">${Object.entries(HW_STATUS).map(([k, v]) => html`<button class=${(r?.status === k ? 'on ' : '') + k} onClick=${() => set(x.student.id, k)}>${v}</button>`)}</div></div>`; })
    : html`<${Empty} icon="tasks" title="اختر واجباً أو أنشئ واجباً جديداً" />`}
  </div>`;
}

// ---------- إنهاء الحصة ----------
function endSession(id) {
  openModal(close => html`<${EndDialog} id=${id} close=${close} />`, { size: 'sm' });
}
function EndDialog({ id, close }) {
  const d = useSessionData(id); if (!d) return null;
  const { s, list, evs, statusOf } = d;
  const picks = ws('picks', p => p.session_id === s.id);
  const c = { present: 0, late: 0, absent_excused: 0, absent_unexcused: 0 };
  for (const x of list) c[statusOf(x.student.id)]++;
  const posN = evs.filter(e => get('event_types', e.type_id)?.valence === 'pos').length;
  const nothing = list.filter(x => !statusOf(x.student.id).startsWith('absent') && !evs.some(e => e.student_id === x.student.id) && !picks.some(p => p.student_id === x.student.id));
  return html`<${ModalHead} title="ملخص الحصة" close=${close} />
    <div class="modal-body stack">
      <div class="stats"><div class="stat"><b>${c.present + c.late}</b><span>حاضر</span></div><div class="stat"><b>${c.absent_excused + c.absent_unexcused}</b><span>غائب</span></div><div class="stat"><b>${c.late}</b><span>متأخر</span></div><div class="stat"><b>${posN}</b><span>مشاركات إيجابية</span></div></div>
      ${nothing.length ? html`<div class="notice">لم يُسجَّل شيء لـ ${nothing.length} طالب: ${nothing.map(x => shortName(x.student.full_name)).join('، ')}</div>` : html`<div class="info">سُجّل شيء لكل الطلاب الحاضرين 👏</div>`}
    </div>
    <div class="modal-foot"><button class="btn ghost" onClick=${close}>متابعة الحصة</button>
      <${Btn} cls="primary" onClick=${async () => { await patch('sessions', s.id, { status: 'closed', ended_at: new Date().toISOString() }); close(); toast('انتهت الحصة', 'ok'); go('#/today'); }}>إنهاء الحصة</${Btn}></div>`;
}

// ---------- الاختيار العشوائي العادل ----------
export function openPicker(sessionId, presentMode = false) {
  if (document.querySelector('.picker-open')) return;
  openModal(close => html`<${Picker} sessionId=${sessionId} close=${close} startPresent=${presentMode} />`, { size: 'sm', locked: false });
}
function Picker({ sessionId, close, startPresent, win = null, floating = false }) {
  useStore();
  const d = useSessionData(sessionId);
  const [phase, setPhase] = useState('idle'); // idle | shuffling | picked | volunteer | volAnswer | done
  const [cur, setCur] = useState(null); // { sid, attempt }
  const [vol, setVol] = useState(null);
  const [flash, setFlash] = useState('');
  const [present, setPresent] = useState(!!startPresent);
  const [last, setLast] = useState(null);
  const busy = useRef(false);
  if (!undoStacks.has(sessionId)) undoStacks.set(sessionId, []);
  const stack = undoStacks.get(sessionId);
  if (!d) return null;
  const { s, cls, list, present: presentIds } = d;
  const w = workspace(); const opts = { retryFactor: 0.5, volunteerConsumes: false, ...(w.options?.picker || {}) };
  const exempt = new Set(s.exempt || []);
  const candidates = presentIds.filter(id => !exempt.has(id));
  const stu = id => get('students', id);

  const draw = async (exclude = []) => {
    if (busy.current) return; busy.current = true;
    try {
      const picks = ws('picks', p => p.class_id === cls.id);
      const stRow = get('picker_state', cls.id);
      const res = choose({ candidates, members: list.map(x => x.student.id), picks, state: stRow, sessionId: s.id, today: s.date, exclude });
      if (!res.studentId) { toast('لا يوجد طلاب متاحون للاختيار', 'warn'); setPhase('idle'); return; }
      if (res.rollover) {
        stack.push({ label: 'بداية دورة جديدة', rows: [], prevState: stRow ? { ...stRow } : null, stateOnly: true });
        await save('picker_state', { ...(stRow || {}), id: cls.id, class_id: cls.id, ...res.state });
        toast(`بدأت الدورة رقم ${res.state.cycle_no} — سُئل الجميع في الدورة السابقة`, 'ok');
      }
      // حركة خلط قصيرة
      setPhase('shuffling');
      const names = candidates.map(id => shortName(stu(id)?.full_name));
      const t0 = Date.now();
      await new Promise(r => { const iv = setInterval(() => { setFlash(names[Math.floor(Math.random() * names.length)] || ''); if (Date.now() - t0 > 650) { clearInterval(iv); r(); } }, 70); });
      setCur({ sid: res.studentId, attempt: 1, exclude }); setPhase('picked');
    } finally { busy.current = false; }
  };
  const type = sys => typeBySys(sys);
  const record = async (outcome, sid, { factor = 1, volunteer = false, consumed = true, note } = {}) => {
    const sys = { correct: 'answer_correct', partial: 'answer_partial', wrong: 'answer_wrong', no_answer: 'no_answer' }[outcome];
    const t = type(sys);
    const rows = [];
    if (t) rows.push({ t: 'events', id: (await addEvent(s, sid, t.id, { factor: factor === 1 ? undefined : factor, volunteer: volunteer || undefined, note })).id });
    const stRow = get('picker_state', cls.id);
    const p = await save('picks', { class_id: cls.id, session_id: s.id, student_id: sid, date: s.date, at: new Date().toISOString(), outcome, consumed, volunteer, cycle_no: stRow?.cycle_no || 1 });
    rows.push({ t: 'picks', id: p.id });
    return rows;
  };
  const finish = (label, rows) => { stack.push({ label, rows }); setLast(label); setPhase('done'); setCur(null); setVol(null); };
  const answer = async outcome => {
    if (!cur || busy.current) return; busy.current = true;
    try {
      const factor = cur.attempt === 2 ? +opts.retryFactor : 1;
      const rows = [...(cur.preRows || []), ...await record(outcome, cur.sid, { factor })];
      finish(`${{ correct: '✓ صحيحة', partial: '◐ شبه صحيحة', wrong: '✗ خاطئة' }[outcome]} — ${shortName(stu(cur.sid).full_name)}${cur.attempt === 2 ? ' (محاولة ثانية)' : ''}`, rows);
    } finally { busy.current = false; }
  };
  const retry = async () => {
    if (!cur || cur.attempt === 2 || busy.current) return; busy.current = true;
    try {
      const t = type('answer_wrong');
      const ev = t ? await addEvent(s, cur.sid, t.id, { note: 'محاولة أولى' }) : null;
      setCur({ ...cur, attempt: 2, preRows: ev ? [{ t: 'events', id: ev.id }] : [] });
    } finally { busy.current = false; }
  };
  const noAnswer = async () => {
    if (!cur || busy.current) return; busy.current = true;
    let rows;
    try { rows = [...(cur.preRows || []), ...await record('no_answer', cur.sid)]; } finally { busy.current = false; }
    stack.push({ label: `⊘ لم يجب — ${shortName(stu(cur.sid).full_name)}`, rows });
    const ex = [...(cur.exclude || []), cur.sid];
    setPhase('shuffling'); setCur(null); await draw(ex);
  };
  const volunteerAnswer = async outcome => {
    if (!vol || busy.current) return; busy.current = true;
    try {
      const rows = [...(cur?.preRows || []), ...await record(outcome, vol, { volunteer: true, consumed: !!opts.volunteerConsumes })];
      finish(`🙋 متطوع: ${shortName(stu(vol).full_name)} — ${{ correct: 'صحيحة', partial: 'شبه صحيحة', wrong: 'خاطئة' }[outcome]}`, rows);
    } finally { busy.current = false; }
  };
  const skip = () => {
    if (cur?.preRows?.length) { stack.push({ label: 'محاولة أولى', rows: cur.preRows }); }
    setCur(null); setPhase('idle'); setLast('∅ تُجوِز بدون علامة');
  };
  const undo = async () => {
    const it = stack.pop(); if (!it) return toast('لا يوجد ما يُتراجع عنه');
    const byT = {}; for (const r of it.rows) (byT[r.t] = byT[r.t] || []).push(r.id);
    for (const [t, ids] of Object.entries(byT)) await purge(t, ids);
    if (it.stateOnly) { if (it.prevState) await save('picker_state', it.prevState); else await purge('picker_state', [cls.id]); }
    setCur(null); setVol(null); setPhase('idle'); setLast(null);
    toast('تراجع: ' + it.label);
  };

  useEffect(() => {
    const onKey = e => {
      if (e.target.closest('input,textarea,select')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); return undo(); }
      if (phase === 'picked' && cur) {
        if (k === '1') return answer('correct'); if (k === '2') return answer('partial'); if (k === '3') return answer('wrong');
        if (k === 'r' || k === 'ق') return retry(); if (k === 'n' || k === 'ى') return noAnswer(); if (k === 'v' || k === 'ر') return setPhase('volunteer'); if (k === 's' || k === 'س') return skip();
      }
      if (phase === 'volAnswer') { if (k === '1') return volunteerAnswer('correct'); if (k === '2') return volunteerAnswer('partial'); if (k === '3') return volunteerAnswer('wrong'); }
      if ((e.code === 'Space' || k === 'enter') && ['idle', 'done'].includes(phase)) { e.preventDefault(); return draw(); }
      if (k === 'f' || k === 'ب') setPresent(p => !p);
    };
    const W = win || window;
    W.addEventListener('keydown', onKey); return () => W.removeEventListener('keydown', onKey);
  });
  useEffect(() => { draw(); }, []);

  const P = cur ? stu(cur.sid) : null;
  const card = phase === 'shuffling' ? html`<div class="shuffle-name">${flash}</div>`
    : phase === 'picked' && P ? html`<div class="pop-in"><${Avatar} student=${P} size=${132} cls="big-av" /><div class="pname">${P.full_name}</div><div class="pseat">رقم ${P.seat_no || '—'}</div>${cur.attempt === 2 ? html`<span class="badge warn attempt">محاولة ثانية — نقاط × ${opts.retryFactor}</span>` : null}</div>`
    : phase === 'volAnswer' && vol ? html`<div class="pop-in"><${Avatar} student=${stu(vol)} size=${120} cls="big-av" /><div class="pname">${stu(vol).full_name}</div><div class="pseat">🙋 متطوع</div></div>`
    : html`<div class="empty" style="padding:20px"><span class="hexmark"><${Icon} name="shuffle" size=${26} /></span><h4>${last || 'جاهز للاختيار'}</h4><span class="small">الحاضرون المتاحون: ${candidates.length}</span></div>`;

  if (present) return html`<div class="present picker-open" onClick=${e => e.target === e.currentTarget && ['idle', 'done'].includes(phase) && draw()}>
    <div class="hexes">${[[8, 12], [78, 8], [15, 70], [85, 62], [45, 85]].map(([x, y]) => html`<span style=${`left:${x}%;top:${y}%`}></span>`)}</div>
    <div>${phase === 'shuffling' ? html`<div class="pname" style="opacity:.6">${flash}</div>` : (phase === 'picked' && P) ? html`<div class="pop-in"><${Avatar} student=${P} size=${220} /><div class="pname" style="margin-top:18px">${P.full_name}</div><div class="pseat">رقم ${P.seat_no || ''}</div></div>` : (phase === 'volAnswer' && vol) ? html`<div class="pop-in"><${Avatar} student=${stu(vol)} size=${200} /><div class="pname" style="margin-top:18px">${stu(vol).full_name}</div></div>` : html`<div class="pname" style="opacity:.75">اضغط للاختيار</div>`}</div>
    <div class="p-tools"><button class="btn lg" onClick=${() => draw()}><${Icon} name="shuffle" /> اختر</button><button class="btn lg" onClick=${() => { setPresent(false); document.fullscreenElement && document.exitFullscreen?.(); }}>إغلاق العرض</button></div>
  </div>`;

  return html`<div class=${'picker-open' + (floating ? ' floating-picker' : '')}><${ModalHead} title=${(floating ? '' : 'اختيار عادل — ') + className(cls)} close=${close}>
      ${!floating ? html`<button class="icon-btn" title="نافذة عائمة فوق شاشة الدرس" onClick=${async () => { if (await openFloatingPicker(s.id)) close(); }}><${Icon} name="pip" /></button>
      <button class="icon-btn" title="وضع العرض أمام الطلاب (F)" onClick=${() => { setPresent(true); document.documentElement.requestFullscreen?.().catch(() => {}); }}><${Icon} name="screen" /></button>` : null}</${ModalHead}>
    <div class="modal-body picker">
      ${phase === 'volunteer' ? html`<div><h4 style="margin-bottom:10px">من أجاب؟</h4><div class="sgrid" style="grid-template-columns:repeat(auto-fill,minmax(96px,1fr))">${candidates.map(id => html`<div class="stile" onClick=${() => { setVol(id); setPhase('volAnswer'); }}><${Avatar} student=${stu(id)} size=${46} /><span class="nm small">${shortName(stu(id).full_name)}</span></div>`)}</div><button class="btn ghost block" style="margin-top:10px" onClick=${() => setPhase('picked')}>رجوع</button></div>` : card}
      ${phase === 'picked' && cur ? html`
        <div class="outcomes"><button class="btn ok" onClick=${() => answer('correct')}><span class="sym">✓</span>صحيحة<span class="kbd">1</span></button><button class="btn half" onClick=${() => answer('partial')}><span class="sym">◐</span>شبه صحيحة<span class="kbd">2</span></button><button class="btn no" onClick=${() => answer('wrong')}><span class="sym">✗</span>خاطئة<span class="kbd">3</span></button></div>
        <div class="outcomes-2">
          <button class="btn" disabled=${cur.attempt === 2} onClick=${retry}>↻ محاولة ثانية<span class="kbd">R</span></button>
          <button class="btn" onClick=${noAnswer}>⊘ لم يجب، غيره<span class="kbd">N</span></button>
          <button class="btn" onClick=${() => setPhase('volunteer')}>🙋 أجاب متطوع<span class="kbd">V</span></button>
          <button class="btn" onClick=${skip}>∅ بدون علامة<span class="kbd">S</span></button>
        </div>` : null}
      ${phase === 'volAnswer' ? html`<div class="outcomes"><button class="btn ok" onClick=${() => volunteerAnswer('correct')}><span class="sym">✓</span>صحيحة</button><button class="btn half" onClick=${() => volunteerAnswer('partial')}><span class="sym">◐</span>شبه صحيحة</button><button class="btn no" onClick=${() => volunteerAnswer('wrong')}><span class="sym">✗</span>خاطئة</button></div>` : null}
      ${['idle', 'done'].includes(phase) ? html`<button class="btn primary xl block" style="margin-top:14px" onClick=${() => draw()}><${Icon} name="shuffle" /> اختر ${phase === 'done' ? 'التالي' : 'طالباً'}</button>` : null}
    </div>
    <div class="modal-foot" style="justify-content:space-between">
      <button class="btn sm" disabled=${!stack.length} onClick=${undo}><${Icon} name="undo" size=${16} /> تراجع ${stack.length ? `(${stack.length})` : ''}</button>
      <span class="muted small">الدورة ${get('picker_state', cls.id)?.cycle_no || 1}</span>
      <button class="btn sm ghost" onClick=${close}>إغلاق</button>
    </div></div>`;
}
export { openSession };

// ---------- النافذة العائمة (Document Picture-in-Picture أو نافذة صغيرة مستقلة) ----------
export async function openFloatingPicker(sessionId) {
  let win = null;
  try { if (window.documentPictureInPicture) win = await window.documentPictureInPicture.requestWindow({ width: 380, height: 620 }); } catch { win = null; }
  if (!win) win = window.open('', 'daftar-picker', 'popup,width=400,height=660');
  if (!win) { toast('تعذر فتح النافذة العائمة — اسمح بالنوافذ المنبثقة لهذا الموقع', 'warn', 5000); return false; }
  const d = win.document;
  d.documentElement.lang = 'ar'; d.documentElement.dir = 'rtl';
  const th = document.documentElement.dataset.theme; if (th) d.documentElement.dataset.theme = th;
  d.documentElement.style.cssText = document.documentElement.style.cssText;
  d.title = 'اختيار عادل — دفتر المعلم';
  d.head.querySelectorAll('link,style').forEach(n => n.remove());
  for (const n of document.querySelectorAll('link[rel=stylesheet], style')) { const c = n.cloneNode(true); if (n.href) c.href = n.href; d.head.appendChild(c); }
  d.body.innerHTML = ''; d.body.className = 'floating';
  const root = d.createElement('div'); d.body.appendChild(root);
  render(html`<${Picker} sessionId=${sessionId} close=${() => win.close()} win=${win} floating=${true} />`, root);
  win.addEventListener('pagehide', () => render(null, root));
  win.focus?.();
  return true;
}

// ---------- الخطة: الدرس المخطط لهذه الحصة وزر «تم الشرح» ----------
function PlanBar({ s }) {
  const w = workspace(); const term = termOf(w, s.date);
  if (!term) return null;
  const prog = progress(s.class_id, term);
  if (!prog.total) return null;
  const planned = s.period ? plannedFor(s.class_id, term, s.date, s.period) : null;
  const n = Math.max(1, +s.plan_units || 1);
  const toggle = () => patch('sessions', s.id, { plan_done: !s.plan_done, plan_units: n, plan_lesson_id: !s.plan_done ? prog.next?.lesson.id || null : null });
  return html`<div class="plan-bar">
    <span>📘 المخطط لهذه الحصة: <b>${planned ? planned.lesson.title : '—'}</b>${planned && planned.of > 1 ? html` <span class="muted small">(${planned.k}/${planned.of})</span>` : null}</span>
    ${prog.next && (!planned || prog.next.lesson.id !== planned.lesson.id) ? html`<span>التالي فعلياً: <b>${prog.next.lesson.title}</b></span>` : null}
    <span class=${'badge ' + statusCls(prog)}>${statusText(prog)}</span>
    <span class="grow"></span>
    ${s.plan_done ? html`<select style="width:auto;min-height:36px" value=${n} onChange=${e => patch('sessions', s.id, { plan_units: +e.target.value })}>${[1, 2, 3].map(k => html`<option value=${k}>${k === 1 ? 'حصة واحدة' : k + ' حصص من الخطة'}</option>`)}</select>` : null}
    <button class=${'btn sm ' + (s.plan_done ? 'primary' : 'soft')} onClick=${toggle}>${s.plan_done ? '✓ تم الشرح' : 'تم الشرح'}</button>
  </div>`;
}
