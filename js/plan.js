// المرحلة 3 — الخطة السنوية: توزيع الدروس على الحصص الفعلية المتاحة ومتابعة التقدم لكل شعبة
// التوزيع محسوب دائماً من التقويم والجدول والاستثناءات، فيُعاد تلقائياً عند إلغاء حصة أو إضافة إجازة
import { ws, get, calCtx, workspace } from './store.js';
import { meetingsRange, isHeldStatus, termRange } from './calendar.js';
import { todayISO, nowMinutes, parseHM } from './utils.js';

export const lessonsFor = (grade, term) => ws('plan_lessons', l => +l.grade === +grade && +l.term === +term).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

// كل درس يُفرد إلى وحدات بعدد حصصه المخططة
export function units(grade, term) {
  const out = [];
  for (const l of lessonsFor(grade, term)) for (let k = 1; k <= Math.max(1, +l.periods || 1); k++) out.push({ lesson: l, k, of: Math.max(1, +l.periods || 1) });
  return out;
}
// الحصص المتاحة: الجدول بعد استبعاد الإجازات والاختبارات والحصص الملغاة وغياب المعلم (+ الحصص الإضافية)
export function availableMeetings(classId, term) {
  const r = termRange(workspace(), term); if (!r) return [];
  return meetingsRange(calCtx(), classId, r.start, r.end).filter(m => isHeldStatus(m.status));
}
export function distribution(classId, term) {
  const c = get('classes', classId); if (!c) return { meetings: [], units: [], rows: [] };
  const ms = availableMeetings(classId, term), us = units(c.grade, term);
  return { meetings: ms, units: us, rows: ms.map((m, i) => ({ ...m, unit: us[i] || null })) };
}
const sessionsOf = (classId, term) => {
  const r = termRange(workspace(), term); if (!r) return [];
  return ws('sessions', s => s.class_id === classId && s.date >= r.start && s.date <= r.end);
};
// هل انتهى وقت حصة اليوم؟
function passed(m, today, now) {
  if (m.date < today) return true;
  if (m.date > today) return false;
  const p = (workspace()?.day?.periods || []).find(x => x.n === m.period);
  return p ? now >= parseHM(p.end) : false;
}
export function progress(classId, term) {
  const { meetings, units: us } = distribution(classId, term);
  const today = todayISO(), now = nowMinutes();
  const done = sessionsOf(classId, term).reduce((a, s) => a + (s.plan_done ? Math.max(1, +s.plan_units || 1) : 0), 0);
  const plannedSoFar = Math.min(us.length, meetings.filter(m => passed(m, today, now)).length);
  const diff = done - plannedSoFar; // موجب = متقدم، سالب = متأخر
  return {
    total: us.length, available: meetings.length, done: Math.min(done, us.length), plannedSoFar, diff,
    next: us[Math.min(done, us.length)] || null, status: !us.length ? 'none' : diff >= 1 ? 'ahead' : diff <= -1 ? 'behind' : 'ontrack',
    shortfall: us.length - meetings.length, // موجب = الخطة أطول من الحصص المتاحة
  };
}
// الدرس المخطط لحصة معينة (حسب موقعها بين الحصص المتاحة)
export function plannedFor(classId, term, date, period) {
  const { rows } = distribution(classId, term);
  return rows.find(r => r.date === date && r.period === period)?.unit || null;
}
// ملخص لكل درس: أول وآخر حصة مخططة
export function lessonSpans(classId, term) {
  const { rows } = distribution(classId, term); const m = new Map();
  for (const r of rows) if (r.unit) { const id = r.unit.lesson.id; const o = m.get(id) || { first: r, last: r, n: 0 }; o.last = r; o.n++; m.set(id, o); }
  return m;
}
