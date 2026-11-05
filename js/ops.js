// عمليات المجال: مساحات العمل، الطلاب ودورة حياتهم، الحصص والأحداث
import { S, get, all, ws, save, saveMany, patch, purge, queueRpc, audit, enrollmentsOf, isEnrolledOn, raw, findSession, typeBySys, sessionAttendance, workspace } from './store.js';
import { TABLES } from './db.js';
import { defaultEventTypes, defaultWorkspace } from './defaults.js';
import { defaultScheme } from './grading.js';
import { uuid, todayISO, addDays, normDigits, GRADE_NAMES } from './utils.js';
import { SYNC } from './sync.js';

// ---------- مساحات العمل ----------
export function setWorkspace(id) {
  S.wsId = id; localStorage.setItem('daftar-ws', id || '');
}
export async function createWorkspace({ school, year, copyFrom = null, copy = {} }) {
  const base = defaultWorkspace({ school, year });
  const src = copyFrom ? get('workspaces', copyFrom) : null;
  if (src && copy.identity) { base.identity = { ...src.identity }; base.logos = { ...src.logos }; base.identity.school = school || src.identity.school; }
  if (src && copy.day) { base.day = JSON.parse(JSON.stringify(src.day)); base.calendar.workdays = [...(src.calendar?.workdays || [0, 1, 2, 3, 4])]; }
  if (src) base.options = JSON.parse(JSON.stringify(src.options || base.options));
  base.name = `${school || src?.identity?.school || 'مدرسة'} — ${year}`;
  const w = await save('workspaces', base);
  const prev = S.wsId; S.wsId = w.id;
  // أنواع الأحداث
  const types = src && copy.events ? all('event_types', t => t.workspace_id === src.id).map(t => ({ ...t, id: uuid(), workspace_id: w.id, created_at: undefined })) : defaultEventTypes();
  await saveMany('event_types', types.map(t => ({ ...t, workspace_id: w.id })));
  // توزيع الدرجات
  if (src && copy.schemes) {
    await saveMany('grade_schemes', all('grade_schemes', g => g.workspace_id === src.id).map(g => ({ ...g, id: uuid(), workspace_id: w.id, created_at: undefined })));
  }
  // الجدول (ينسخ الفصول بلا طلاب ويربطها)
  if (src && copy.timetable) {
    const map = {};
    const cls = all('classes', c => c.workspace_id === src.id);
    const newCls = cls.map(c => { const id = uuid(); map[c.id] = id; return { ...c, id, workspace_id: w.id, created_at: undefined }; });
    await saveMany('classes', newCls);
    const tts = all('timetables', t => t.workspace_id === src.id).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
    if (tts[0]) await save('timetables', { workspace_id: w.id, effective_from: todayISO(), label: 'منسوخ من سنة سابقة', slots: tts[0].slots.map(s => ({ ...s, class_id: map[s.class_id] || '' })) });
  }
  S.wsId = prev;
  await audit('إنشاء مساحة عمل', w.name);
  return w;
}
export async function deleteWorkspaceData(wsId) {
  const w = get('workspaces', wsId);
  for (const t of TABLES) {
    if (t === 'workspaces') continue;
    const ids = [...S.t[t].values()].filter(r => r.workspace_id === wsId).map(r => r.id);
    await purge(t, ids);
  }
  await purge('workspaces', [wsId]);
  if (S.wsId === wsId) setWorkspace(all('workspaces')[0]?.id || null);
  await audit('حذف بيانات سنة كاملة', w?.name || wsId);
}

// ---------- الفصول ----------
export function gradeLabel(g) { return GRADE_NAMES[g] || `الصف ${g}`; }
export async function ensureClass(grade, section, gradeLabelText) {
  const g = +grade || 1, sec = String(section).trim() || '1';
  const found = ws('classes', c => +c.grade === g && String(c.section) === sec);
  if (found[0]) return found[0];
  const label = gradeLabelText || gradeLabel(g);
  return save('classes', { grade: g, section: sec, grade_label: label, name: `${label} / ${sec}`, subject: workspace()?.identity?.subject || 'كيمياء' });
}

// ---------- الطلاب ----------
export function normNid(n) { return normDigits(n).replace(/\D/g, ''); }
export async function setNid(studentId, nid) {
  const n = normNid(nid);
  if (!n) return;
  if (n.length !== 10) throw new Error('رقم السجل المدني يجب أن يتكون من 10 أرقام');
  await patch('students', studentId, { id_last4: n.slice(-4) });
  // الرقم الكامل لا يُحفظ في الطالب؛ يُرسل مرة واحدة للخادم ليحفظ بصمته فقط
  if (SYNC.mode === 'cloud') await queueRpc('tr_set_student_nid', { p_student_id: studentId, p_nid: n }, { student_id: studentId });
}
export async function addStudent({ full_name, nid, classId, start_date = todayISO(), seat_no, guardian_phone, note }) {
  if (!full_name?.trim()) throw new Error('اسم الطالب مطلوب');
  const st = await save('students', { full_name: full_name.trim(), seat_no: seat_no ? +normDigits(seat_no) : nextSeat(classId), guardian_phone: normDigits(guardian_phone || ''), status: 'active', join_note: note || '' });
  await save('enrollments', { student_id: st.id, class_id: classId, start_date, end_date: null });
  if (nid) await setNid(st.id, nid);
  return st;
}
export function nextSeat(classId) {
  const seats = all('enrollments', e => e.class_id === classId).map(e => +get('students', e.student_id)?.seat_no || 0);
  return (Math.max(0, ...seats) + 1);
}
export async function transferStudent(studentId, toClassId, date) {
  const es = enrollmentsOf(studentId);
  const cur = es.find(e => isEnrolledOn(e, date)) || es.find(e => !e.end_date);
  if (cur && cur.class_id === toClassId) throw new Error('الطالب مسجل في هذا الفصل بالفعل');
  if (cur) await patch('enrollments', cur.id, { end_date: addDays(date, -1), end_reason: 'انتقال' });
  await save('enrollments', { student_id: studentId, class_id: toClassId, start_date: date, end_date: null, from_class_id: cur?.class_id || null });
  await audit('نقل طالب', `${get('students', studentId)?.full_name} إلى ${get('classes', toClassId)?.name} من ${date}`);
}
export async function withdrawStudent(studentId, date, reason) {
  const es = enrollmentsOf(studentId).filter(e => !e.end_date || e.end_date >= date);
  for (const e of es) await patch('enrollments', e.id, { end_date: date < e.start_date ? e.start_date : date, end_reason: 'انسحاب' });
  await patch('students', studentId, { status: 'withdrawn', withdraw_date: date, withdraw_reason: reason });
  await audit('انسحاب طالب', `${get('students', studentId)?.full_name} بتاريخ ${date}`, reason);
}
export async function reinstateStudent(studentId, classId, date) {
  await save('enrollments', { student_id: studentId, class_id: classId, start_date: date, end_date: null });
  await patch('students', studentId, { status: 'active', withdraw_date: null, withdraw_reason: null });
  await audit('إعادة طالب', `${get('students', studentId)?.full_name} من ${date}`);
}
const STUDENT_TABLES = ['enrollments', 'notes', 'contacts', 'attendance', 'events', 'picks', 'task_results', 'grade_overrides'];
export async function mergeStudents(keepId, dupId) {
  const keep = get('students', keepId), dup = get('students', dupId);
  for (const t of STUDENT_TABLES) {
    let rows = all(t, r => r.student_id === dupId);
    if (t === 'task_results') {
      const have = new Set(all(t, r => r.student_id === keepId).map(r => r.task_id));
      const conflict = rows.filter(r => have.has(r.task_id));
      await purge(t, conflict.map(r => r.id));
      rows = rows.filter(r => !have.has(r.task_id));
    }
    await saveMany(t, rows.map(r => ({ ...r, student_id: keepId })));
  }
  const pk = get('student_private', keepId), pd = get('student_private', dupId);
  if (pd) {
    await save('student_private', { ...(pk || { id: keepId, student_id: keepId }), health: [...new Set([...(pk?.health || []), ...(pd.health || [])])], tags: [...new Set([...(pk?.tags || []), ...(pd.tags || [])])], health_note: [pk?.health_note, pd.health_note].filter(Boolean).join(' — '), starred: !!(pk?.starred || pd.starred) });
  }
  if (!get('student_photos', keepId) && get('student_photos', dupId)) await save('student_photos', { ...get('student_photos', dupId), id: keepId, student_id: keepId });
  const changes = {};
  for (const k of ['guardian_phone', 'id_last4', 'seat_no']) if (!keep[k] && dup[k]) changes[k] = dup[k];
  if (Object.keys(changes).length) await patch('students', keepId, changes);
  await purge('student_private', [dupId]); await purge('student_photos', [dupId]); await purge('students', [dupId]);
  await audit('دمج طالب مكرر', `${dup.full_name} ← ${keep.full_name}`);
}
export async function purgeStudent(id) {
  const name = get('students', id)?.full_name;
  for (const t of STUDENT_TABLES) await purge(t, all(t, r => r.student_id === id).map(r => r.id).concat([...S.t[t].values()].filter(r => r.deleted && r.student_id === id).map(r => r.id)));
  await purge('student_private', [id]); await purge('student_photos', [id]); await purge('students', [id]);
  await audit('حذف طالب نهائياً', name);
}

// ---------- الحصص ----------
export async function openSession({ classId, date = todayISO(), period = null, manual = false }) {
  const ex = period == null ? null : findSession(classId, date, +period);
  if (ex) { if (ex.status === 'closed') return patch('sessions', ex.id, { status: 'open' }); return ex; }
  return save('sessions', { class_id: classId, date, period: period == null ? null : +period, manual, status: 'open', started_at: new Date().toISOString(), exempt: [] });
}
export async function setAttendance(session, studentId, status, late_minutes = null) {
  const cur = sessionAttendance(session.id).get(studentId);
  if (cur) return patch('attendance', cur.id, { status, late_minutes });
  if (status === 'present') return null;
  return save('attendance', { session_id: session.id, student_id: studentId, class_id: session.class_id, date: session.date, status, late_minutes });
}
export function addEvent(session, studentId, typeId, extra = {}) {
  return save('events', { session_id: session?.id || null, class_id: session?.class_id || extra.class_id, student_id: studentId, type_id: typeId, date: session?.date || todayISO(), voided: false, ...extra });
}
export async function voidEvent(evId, reason) {
  const ev = get('events', evId);
  await patch('events', evId, { voided: true, void_reason: reason, voided_at: new Date().toISOString() });
  await audit('إلغاء حدث', `${get('event_types', ev.type_id)?.name} — ${get('students', ev.student_id)?.full_name} (${ev.date})`, reason);
}
export const sysType = typeBySys;
export { raw };
