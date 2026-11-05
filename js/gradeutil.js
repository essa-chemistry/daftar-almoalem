// ربط محرك الدرجات بالمخزن: يجمع مدخلات الطالب ثم يستدعي grading.js
import { S, all, ws, get, workspace, calCtx, roster } from './store.js';
import { computeStudent, defaultScheme } from './grading.js';
import { termRange, plannedCount } from './calendar.js';
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

export function gradeStudent(studentId, classId, term, { today = todayISO() } = {}) {
  const w = workspace(); const cls = get('classes', classId);
  const r = termRange(w, term);
  if (!r || !cls) return null;
  const sessions = ws('sessions', s => s.class_id === classId);
  return computeStudent({
    term: r, today,
    enrollments: all('enrollments', e => e.student_id === studentId && e.class_id === classId),
    sessions, plannedSessions: plannedFor(classId, term),
    attendance: all('attendance', a => a.student_id === studentId && a.class_id === classId),
    events: all('events', e => e.student_id === studentId && e.class_id === classId),
    eventTypes: ws('event_types'),
    tasks: ws('tasks', t => (t.class_ids || []).includes(classId)),
    results: all('task_results', x => x.student_id === studentId),
    scheme: schemeFor(cls.grade, term),
    overrides: all('grade_overrides', o => o.student_id === studentId && o.class_id === classId && +o.term === +term),
  });
}

// كل طلاب الفصل الذين كانوا مسجلين في أي وقت خلال الفصل الدراسي
export function classGradeRows(classId, term) {
  const w = workspace(); const r = termRange(w, term); if (!r) return [];
  const ids = new Set(all('enrollments', e => e.class_id === classId && e.start_date <= r.end && (!e.end_date || e.end_date >= r.start)).map(e => e.student_id));
  const list = roster(classId, todayISO(), { includeLeft: true }).filter(x => ids.has(x.student.id));
  for (const id of ids) if (!list.some(x => x.student.id === id)) { const s = get('students', id); if (s) list.push({ student: s, active: false }); }
  return list.map(x => ({ ...x, g: gradeStudent(x.student.id, classId, term) }));
}
export const lockFor = (classId, term) => ws('grade_locks', l => l.class_id === classId && +l.term === +term && l.active !== false)[0] || null;
