// المخزن: كل بيانات الجهاز في الذاكرة + كتابة فورية في IndexedDB + صندوق الإرسال
import * as db from './db.js';
import { TABLES } from './db.js';
import { uuid, todayISO, normAr } from './utils.js';

export const S = {
  t: Object.fromEntries(TABLES.map(t => [t, new Map()])),
  wsId: null,
  version: 0,
  user: null,        // بريد المعلم عند الدخول
  pending: 0,        // عدد مدخلات الإرسال
};
const listeners = new Set();
let emitQueued = false;
export function emit() {
  if (emitQueued) return; emitQueued = true;
  queueMicrotask(() => { emitQueued = false; S.version++; listeners.forEach(f => f()); });
}
export const subscribe = f => { listeners.add(f); return () => listeners.delete(f); };
let onWrite = () => {};
export const setOnWrite = f => { onWrite = f; };

let seq = 0;
const outKey = (op, t, id) => `${op}:${t}:${id}`;
function outEntry(op, table, row_id, extra = {}) {
  const ts = Date.now();
  return { id: op === 'rpc' ? `r:${uuid()}` : outKey(op[0], table, row_id), op, table, row_id, ts, at: `${ts}.${++seq}`, ...extra };
}

export async function loadAll() {
  for (const t of TABLES) {
    const rows = await db.getAll(t);
    S.t[t] = new Map(rows.map(r => [r.id, r]));
  }
  S.pending = (await db.getAll('outbox')).length;
  emit();
}

// ---------- القراءة ----------
export const raw = (t, id) => S.t[t].get(id);
export function get(t, id) { const r = S.t[t].get(id); return r && !r.deleted ? r : null; }
export function all(t, pred) {
  const out = [];
  for (const r of S.t[t].values()) if (!r.deleted && (!pred || pred(r))) out.push(r);
  return out;
}
// صفوف مساحة العمل الحالية
export const ws = (t, pred) => all(t, r => r.workspace_id === S.wsId && (!pred || pred(r)));

// ---------- الكتابة ----------
function stamp(t, row) {
  const r = { ...row };
  if (!r.id) r.id = uuid();
  if (t !== 'workspaces' && !r.workspace_id) r.workspace_id = S.wsId;
  if (t === 'workspaces') r.workspace_id = r.id;
  r.client_updated_at = new Date().toISOString();
  if (!r.created_at) r.created_at = r.client_updated_at;
  return r;
}
export async function save(t, row) { return (await saveMany(t, [row]))[0]; }
export async function saveMany(t, rows) {
  if (!rows.length) return [];
  const stamped = rows.map(r => stamp(t, r));
  for (const r of stamped) S.t[t].set(r.id, r);
  const entries = stamped.map(r => outEntry('upsert', t, r.id));
  await db.writeWithOutbox(t, stamped, entries);
  S.pending += entries.length; emit(); onWrite();
  return stamped;
}
export const patch = (t, id, changes) => save(t, { ...S.t[t].get(id), ...changes });
// حذف ناعم (يُزامَن كتعديل)
export const remove = (t, id) => patch(t, id, { deleted: true });
export const removeMany = (t, ids) => saveMany(t, ids.map(id => ({ ...S.t[t].get(id), deleted: true })));
// حذف نهائي (محلياً وعلى الخادم)
export async function purge(t, ids) {
  ids = ids.filter(id => S.t[t].has(id));
  if (!ids.length) return;
  for (const id of ids) S.t[t].delete(id);
  const entries = ids.map(id => outEntry('delete', t, id));
  await db.writeWithOutbox(t, [], entries, ids);
  // لا داعي لإرسال تعديل لصف حُذف
  await db.deleteMany('outbox', ids.map(id => outKey('u', t, id)));
  S.pending = (await db.getAll('outbox')).length; emit(); onWrite();
}
// استدعاء دالة على الخادم لاحقاً (مثل حفظ بصمة السجل المدني)
export async function queueRpc(name, args, meta = {}) {
  const e = outEntry('rpc', null, null, { name, args, meta });
  await db.writeWithOutbox('outbox', [e], []);
  S.pending++; emit(); onWrite();
}
// دمج صفوف قادمة من الخادم دون إنشاء مدخلات إرسال
export async function mergeRemote(t, rows) {
  if (!rows.length) return;
  for (const r of rows) S.t[t].set(r.id, r);
  await db.putMany(t, rows); emit();
}

// ---------- سجل التدقيق ----------
export function audit(action, details = '', reason = '') {
  return save('audit', { action, details, reason, at: new Date().toISOString(), by: S.user || 'المعلم' });
}

// ---------- استعلامات شائعة ----------
export const workspace = () => get('workspaces', S.wsId);
export const classes = () => ws('classes').sort((a, b) => (a.grade - b.grade) || String(a.section).localeCompare(String(b.section), 'ar', { numeric: true }));
export const className = c => c ? (c.name || `${c.grade_label || ''} / ${c.section}`) : '—';

export function enrollmentsOf(studentId) {
  return all('enrollments', e => e.student_id === studentId).sort((a, b) => a.start_date.localeCompare(b.start_date));
}
export const isEnrolledOn = (e, date) => e.start_date <= date && (!e.end_date || date <= e.end_date);
export function classOf(studentId, date = todayISO()) {
  const e = enrollmentsOf(studentId).find(e => isEnrolledOn(e, date));
  return e ? get('classes', e.class_id) : null;
}
export function lastClassOf(studentId) {
  const es = enrollmentsOf(studentId);
  return es.length ? get('classes', es[es.length - 1].class_id) : null;
}
// طلاب الفصل في تاريخ معين، مرتبون بالرقم ثم الاسم
export function roster(classId, date = todayISO(), { includeLeft = false } = {}) {
  const map = new Map();
  for (const e of all('enrollments', e => e.class_id === classId)) {
    const s = get('students', e.student_id); if (!s) continue;
    const active = isEnrolledOn(e, date);
    if (!active && !includeLeft) continue;
    if (!active && e.start_date > date) continue;
    const prev = map.get(s.id);
    if (!prev || (active && !prev.active)) map.set(s.id, { student: s, enrollment: e, active });
  }
  return [...map.values()].sort(bySeat);
}
export function bySeat(a, b) {
  const sa = a.student || a, sb = b.student || b;
  const na = +sa.seat_no || 9999, nb = +sb.seat_no || 9999;
  return na - nb || String(sa.full_name).localeCompare(String(sb.full_name), 'ar');
}
export function searchStudents(q, list) {
  const n = normAr(q); if (!n) return list;
  return list.filter(x => normAr((x.student || x).full_name).includes(n) || String((x.student || x).seat_no) === n);
}
export const privateOf = id => get('student_private', id) || { id, student_id: id, health: [], health_note: '', tags: [], starred: false };
export function photoOf(studentId) {
  const p = get('student_photos', studentId);
  return p && p.status === 'approved' ? p.data : null;
}
export function eventTypes({ activeOnly = true } = {}) {
  return ws('event_types', t => !activeOnly || t.active !== false).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}
export const typeBySys = sys => ws('event_types').find(t => t.sys === sys);
export const sessionAttendance = sid => new Map(all('attendance', a => a.session_id === sid).map(a => [a.student_id, a]));
export const sessionEvents = sid => all('events', e => e.session_id === sid && !e.voided);
export function findSession(classId, date, period) {
  return ws('sessions', s => s.class_id === classId && s.date === date && (period == null || s.period === period))[0] || null;
}
export const timetables = () => ws('timetables').sort((a, b) => a.effective_from.localeCompare(b.effective_from));
export const exceptions = () => ws('exceptions');
export const calCtx = () => ({ ws: workspace(), timetables: timetables(), exceptions: exceptions() });
