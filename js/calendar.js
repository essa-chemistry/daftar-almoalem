// التقويم: الفصول الدراسية، أيام الدوام، الإجازات، الجدول بنسخه المؤرخة، والاستثناءات
// دوال نقية تأخذ السياق { ws, timetables, exceptions }
import { dow, addDays, dateRange, parseHM } from './utils.js';

export const HOLIDAY_KINDS = { holiday: 'إجازة', exams: 'أسابيع اختبارات', off: 'تعطيل' };
export const EXC_KINDS = { cancel: 'حصة ملغاة', teacher_absent: 'غياب المعلم', extra: 'حصة انتظار/إضافية', swap: 'تبديل حصة' };

export function termRange(ws, term) {
  const t = ws?.calendar?.terms?.[term - 1];
  return t && t.start && t.end ? { start: t.start, end: t.end } : null;
}
export function termOf(ws, date) {
  for (const n of [1, 2]) { const r = termRange(ws, n); if (r && date >= r.start && date <= r.end) return n; }
  return null;
}
// الفصل الدراسي الأقرب لتاريخ اليوم (لعرض الدرجات افتراضياً)
export function currentTerm(ws, date) {
  const t = termOf(ws, date); if (t) return t;
  const r2 = termRange(ws, 2);
  return r2 && date > r2.start ? 2 : 1;
}
// ---------- فترات التقويم داخل الفصل الدراسي ----------
// كل فترة: { id, label, start, end, cumulative } — التراكمية تُحسب من بداية الفصل الدراسي حتى نهايتها
export const TERM_LABEL = { 1: 'الفصل الدراسي الأول', 2: 'الفصل الدراسي الثاني' };
export function evalPeriods(ws, term) {
  return (ws?.calendar?.terms?.[term - 1]?.periods || []).filter(p => p.start && p.end).sort((a, b) => a.start.localeCompare(b.start));
}
export function evalRange(ws, term, pid = null) {
  const r = termRange(ws, term); if (!r) return null;
  const p = pid ? evalPeriods(ws, term).find(x => x.id === pid) : null;
  if (!p) return { start: r.start, end: r.end, pid: null, label: TERM_LABEL[term], short: 'الفصل كاملاً' };
  return { start: p.cumulative ? r.start : p.start, end: p.end, pid: p.id, cumulative: !!p.cumulative, label: `${TERM_LABEL[term]} — ${p.label}`, short: p.label };
}
// الفترة الافتراضية: الجارية اليوم، وإلا آخر فترة انتهت، وإلا الأولى
export function defaultPeriod(ws, term, date) {
  const ps = evalPeriods(ws, term); if (!ps.length) return null;
  const cur = ps.find(p => date >= p.start && date <= p.end); if (cur) return cur.id;
  const past = ps.filter(p => p.end < date);
  return (past[past.length - 1] || ps[0]).id;
}
export const isWorkday = (ws, date) => (ws?.calendar?.workdays ?? [0, 1, 2, 3, 4]).includes(dow(date));
export function holidayOn(ws, date) {
  return (ws?.calendar?.holidays || []).find(h => date >= h.from && date <= (h.to || h.from)) || null;
}
export function inAnyTerm(ws, date) { return termOf(ws, date) != null; }

export function periodsOf(ws) { return ws?.day?.periods || []; }
export function periodInfo(ws, n) { return periodsOf(ws).find(p => p.n === n) || null; }
// الحصة الجارية حسب الوقت
export function periodAt(ws, minutes) {
  return periodsOf(ws).find(p => minutes >= parseHM(p.start) && minutes < parseHM(p.end)) || null;
}

export function timetableFor(timetables, date) {
  let v = null;
  for (const t of timetables) if (t.effective_from <= date && (!v || t.effective_from >= v.effective_from)) v = t;
  return v;
}

// حصص يوم معين (لكل الفصول أو لفصل محدد)
// status: normal | extra | moved | cancelled | teacher_absent | holiday
export function meetingsOn(ctx, date, classId = null) {
  const { ws, timetables, exceptions } = ctx;
  if (!isWorkday(ws, date)) return [];
  const tt = timetableFor(timetables, date);
  let list = (tt?.slots || []).filter(s => s.day === dow(date) && s.class_id)
    .map(s => ({ date, period: s.period, class_id: s.class_id, subject: s.subject || '', status: 'normal' }));
  const hol = holidayOn(ws, date);
  const outOfTerm = ws?.calendar?.terms?.some(t => t.start) && !inAnyTerm(ws, date);
  const exc = exceptions.filter(e => !e.deleted && e.date <= date && date <= (e.date_to || e.date));
  // إضافية
  for (const e of exc.filter(e => e.kind === 'extra' && e.date === date))
    list.push({ date, period: e.period, class_id: e.class_id, subject: e.subject || '', status: 'extra', reason: e.reason, exception_id: e.id });
  // تبديل ليوم واحد
  for (const e of exc.filter(e => e.kind === 'swap' && e.date === date)) {
    const m = list.find(m => m.period === e.period && (!e.class_id || m.class_id === e.class_id) && m.status === 'normal');
    if (m) { m.from_period = m.period; m.period = e.to_period; m.status = 'moved'; m.reason = e.reason; m.exception_id = e.id; }
  }
  // ملغاة
  for (const e of exc.filter(e => e.kind === 'cancel' && e.date === date))
    for (const m of list) if ((e.period == null || e.period === '' || m.period === +e.period) && (!e.class_id || m.class_id === e.class_id) && m.status !== 'extra') {
      m.status = 'cancelled'; m.reason = e.reason; m.exception_id = e.id;
    }
  // غياب المعلم
  const absent = exc.find(e => e.kind === 'teacher_absent');
  if (absent) for (const m of list) { m.status = 'teacher_absent'; m.reason = absent.reason; m.exception_id = absent.id; }
  if (hol) for (const m of list) { m.status = 'holiday'; m.reason = hol.label || HOLIDAY_KINDS[hol.kind]; }
  if (outOfTerm && !hol) list = [];
  if (classId) list = list.filter(m => m.class_id === classId);
  return list.sort((a, b) => a.period - b.period);
}
export const isHeldStatus = st => st === 'normal' || st === 'extra' || st === 'moved';

export function meetingsRange(ctx, classId, from, to) {
  const out = [];
  for (const d of dateRange(from, to)) out.push(...meetingsOn(ctx, d, classId));
  return out;
}
// عدد الحصص المخططة لفصل في فصل دراسي كامل (يُستخدم لتقسيم هدف المشاركة)
export function plannedCount(ctx, classId, term) {
  const r = termRange(ctx.ws, term); if (!r) return 0;
  return meetingsRange(ctx, classId, r.start, r.end).filter(m => isHeldStatus(m.status)).length;
}
// عدد الحصص الأسبوعية لكل صف من نسخة جدول
export function weeklyCounts(tt, classes) {
  const byClass = {}, byGrade = {};
  for (const s of tt?.slots || []) if (s.class_id) byClass[s.class_id] = (byClass[s.class_id] || 0) + 1;
  for (const c of classes) if (byClass[c.id]) {
    const k = c.grade_label || c.grade;
    byGrade[k] = Math.max(byGrade[k] || 0, byClass[c.id]);
  }
  return { byClass, byGrade };
}
// توليد حصص اليوم الدراسي من البداية والمدة والفسح
export function buildPeriods({ start = '07:00', count = 7, duration = 50, gap = 0, breaks = [] }) {
  const out = []; let t = parseHM(start);
  for (let n = 1; n <= count; n++) {
    const s = t, e = t + duration;
    out.push({ n, start: toHM(s), end: toHM(e) });
    t = e + gap;
    const b = breaks.find(b => +b.after === n);
    if (b) t += +b.minutes || 0;
  }
  return out;
}
const toHM = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export { addDays };
