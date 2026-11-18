// ربط محرك الدرجات بالمخزن: يجمع مدخلات الطالب ثم يستدعي grading.js
import { S, all, ws, get, workspace, calCtx, roster } from './store.js';
import { computeStudent, defaultScheme } from './grading.js';
import { evalRange, plannedCount } from './calendar.js';
import { todayISO } from './utils.js';

export function schemeFor(grade, term) {
  const s = ws('grade_schemes', x => +x.grade === +grade && +x.term === +term)[0];
  return s ? { id: s.id, categories: s.categories, monthly: s.monthly, options: s.options } : { ...defaultScheme(), id: null };
}

const plannedCache = new Map();
export function plannedFor(classId, term) {
  const k = `${S.version}|${classId}|${term}`;
  if (!plannedCache.has(k)) { if (plannedCache.size > 200) plannedCache.clear(); plannedCache.set(k, plannedCount(calCtx(), classId, term)); }
  return plannedCache.get(k);
}

// pid: فترة التقويم (null = الفصل الدراسي كاملاً). هدف المشاركة يبقى للفصل كاملاً ويُقسَّم بنسبة ما حضره الطالب في الفترة
// الفصول التي تُحتسب بيانات الطالب منها في هذا الفصل: الفصل نفسه + الفصول التي نُقل منها «مع بياناته»
export function carriedClassIds(studentId, classId) {
  const ids = new Set([classId]); const queue = [classId];
  while (queue.length) {
    const c = queue.shift();
    for (const e of all('enrollments', x => x.student_id === studentId && x.class_id === c && x.carry && x.from_class_id))
      if (!ids.has(e.from_class_id)) { ids.add(e.from_class_id); queue.push(e.from_class_id); }
  }
  return ids;
}
export function gradeStudent(studentId, classId, term, { today = todayISO(), pid = null } = {}) {
  const w = workspace(); const cls = get('classes', classId);
  const r = evalRange(w, term, pid);
  if (!r || !cls) return null;
  const ids = carriedClassIds(studentId, classId);
  const sessions = ws('sessions', s => ids.has(s.class_id));
  return computeStudent({
    term: { start: r.start, end: r.end }, today,
    enrollments: all('enrollments', e => e.student_id === studentId && ids.has(e.class_id)),
    sessions, plannedSessions: plannedFor(classId, term),
    attendance: all('attendance', a => a.student_id === studentId && ids.has(a.class_id)),
    events: all('events', e => e.student_id === studentId && ids.has(e.class_id)),
    eventTypes: ws('event_types'),
    tasks: ws('tasks', t => (t.class_ids || []).some(c => ids.has(c))),
    results: all('task_results', x => x.student_id === studentId),
    scheme: schemeFor(cls.grade, term),
    overrides: all('grade_overrides', o => o.student_id === studentId && o.class_id === classId && +o.term === +term && (o.period || null) === r.pid),
  });
}

// كل طلاب الفصل الذين كانوا مسجلين في أي وقت خلال الفصل الدراسي
export function classGradeRows(classId, term, pid = null) {
  const w = workspace(); const r = evalRange(w, term, pid); if (!r) return [];
  const ids = new Set(all('enrollments', e => e.class_id === classId && e.start_date <= r.end && (!e.end_date || e.end_date >= r.start)).map(e => e.student_id));
  const list = roster(classId, todayISO(), { includeLeft: true }).filter(x => ids.has(x.student.id));
  for (const id of ids) if (!list.some(x => x.student.id === id)) { const s = get('students', id); if (s) list.push({ student: s, active: false }); }
  return list.map(x => ({ ...x, g: gradeStudent(x.student.id, classId, term, { pid: r.pid }) }));
}
export const lockFor = (classId, term, pid = null) => ws('grade_locks', l => l.class_id === classId && +l.term === +term && (l.period || null) === (pid || null) && l.active !== false)[0] || null;
export { evalRange };
