// حالات اختبار محرك الدرجات — تُشغَّل من tests.html (أو من Node)
import { computeStudent, defaultScheme, validateScheme } from './grading.js';

const TERM = { start: '2026-09-01', end: '2026-12-31' };
const TODAY = '2026-12-31';
const TYPES = [
  { id: 'tc', name: 'إجابة صحيحة', points: 1, category: 'participation', sys: 'answer_correct', cap: 0, free: 0 },
  { id: 'tsl', name: 'نوم', points: -1, category: 'behavior', cap: 1, free: 0 },
  { id: 'tch', name: 'هذرة', points: -0.5, category: 'behavior', cap: 1, free: 1 },
  { id: 'tex', name: 'تميز سلوكي', points: 0.5, category: 'behavior', cap: 1, free: 0 },
  { id: 'tla', name: 'تأخر', points: -0.5, category: 'behavior', cap: 1, sys: 'late' },
  { id: 'tau', name: 'غياب بدون عذر', points: -1, category: 'behavior', cap: 1, sys: 'absent_unexcused' },
  { id: 'tae', name: 'غياب بعذر', points: 0, category: '', cap: 1, sys: 'absent_excused' },
];
const D = i => { const d = new Date(Date.UTC(2026, 8, 1 + i * 7)); return d.toISOString().slice(0, 10); };
const SESSIONS = Array.from({ length: 10 }, (_, i) => ({ id: 's' + (i + 1), date: D(i), period: 1 }));
let n = 0;
const ev = (type, si, extra = {}) => ({ id: 'e' + (++n), type_id: type, session_id: 's' + si, date: D(si - 1), created_at: String(n).padStart(4, '0'), ...extra });
const att = (si, status) => ({ id: 'a' + si + status, session_id: 's' + si, date: D(si - 1), status });
const ENR_ALL = [{ start_date: '2026-08-25', end_date: null }];
const base = o => computeStudent({ term: TERM, today: TODAY, enrollments: ENR_ALL, sessions: SESSIONS, plannedSessions: 10, eventTypes: TYPES, scheme: defaultScheme(), ...o });
const cat = (r, k) => r.categories.find(c => c.key === k);

export const CASES = [
  ['المشاركة: 15 نقطة من هدف 15 = الدرجة كاملة 10', () => {
    const r = base({ events: Array.from({ length: 15 }, (_, i) => ev('tc', (i % 10) + 1)) });
    return [cat(r, 'participation').final, 10];
  }],
  ['مثال المواصفات: 9 نقاط من هدف 12 (حضر 8 من 10) = 7.5 من 10', () => {
    const r = base({ events: Array.from({ length: 9 }, (_, i) => ev('tc', (i % 8) + 1)), attendance: [att(9, 'absent_excused'), att(10, 'absent_excused')] });
    return [cat(r, 'participation').final, 7.5];
  }],
  ['ملتحق متأخراً: يُقسَّم الهدف على فترته فقط (5 نقاط من هدف 7.5 ≈ 6.5)', () => {
    const r = base({ enrollments: [{ start_date: D(5), end_date: null }], events: [6, 7, 8, 9, 10].map(i => ev('tc', i)) });
    return [cat(r, 'participation').final, 6.5];
  }],
  ['ملتحق متأخراً: لا تُحتسب عليه المهام السابقة لالتحاقه', () => {
    const tasks = [{ id: 't1', kind: 'homework', date: D(1), max_score: 1 }, { id: 't2', kind: 'homework', date: D(7), max_score: 1 }];
    const r = base({ enrollments: [{ start_date: D(5), end_date: null }], tasks, results: [{ task_id: 't2', status: 'done' }] });
    return [cat(r, 'homework').final, 8];
  }],
  ['منسحب: الأحداث بعد تاريخ انسحابه لا تُحتسب', () => {
    const r = base({ enrollments: [{ start_date: '2026-08-25', end_date: D(3) }], events: [ev('tsl', 2), ev('tsl', 7), ev('tsl', 8)] });
    return [cat(r, 'behavior').final, 5];
  }],
  ['غياب بعذر: لا يخصم، والمهمة في يومه خارج المقام', () => {
    const tasks = [{ id: 'q1', kind: 'quiz', date: D(2), max_score: 10 }, { id: 'q2', kind: 'quiz', date: D(4), max_score: 10 }];
    const r = base({ attendance: [att(3, 'absent_excused')], tasks, results: [{ task_id: 'q2', score: 9 }] });
    return [[cat(r, 'behavior').final, cat(r, 'quizzes').final], [6, 5.5]];
  }],
  ['غياب بدون عذر وتأخر: يُخصمان من السلوك تلقائياً من الحضور', () => {
    const r = base({ attendance: [att(1, 'absent_unexcused'), att(2, 'late')] });
    return [cat(r, 'behavior').final, 4.5];
  }],
  ['سقف الخصم: نومان في الحصة نفسها يُخصمان مرة واحدة', () => {
    const r = base({ events: [ev('tsl', 3), ev('tsl', 3)] });
    return [cat(r, 'behavior').final, 5];
  }],
  ['تنبيه أول بلا خصم: الهذرة الأولى تنبيه والثانية تُخصم', () => {
    const r = base({ events: [ev('tch', 1), ev('tch', 2)] });
    const items = cat(r, 'behavior').items.map(o => o.status);
    return [[cat(r, 'behavior').final, items.join(',')], [5.5, 'warning,applied']];
  }],
  ['تعديل يدوي: المعتمدة = قيمة التعديل والمقترحة كما هي', () => {
    const r = base({ events: [ev('tsl', 1)], overrides: [{ category: 'behavior', value: 6, reason: 'تحسن واضح', created_at: '2026-12-01' }] });
    const c = cat(r, 'behavior');
    return [[c.suggested, c.final, !!c.override], [5, 6, true]];
  }],
  ['حد الصفر: لا تنزل فئة الخصم تحت الصفر', () => {
    const r = base({ events: [1, 2, 3, 4, 5, 6, 7, 8].map(i => ev('tsl', i)) });
    return [cat(r, 'behavior').final, 0];
  }],
  ['حد الوزن: المشاركة والتميّز لا يتجاوزان الوزن', () => {
    const r = base({ events: [...Array.from({ length: 40 }, (_, i) => ev('tc', (i % 10) + 1)), ev('tex', 1), ev('tex', 2)] });
    return [[cat(r, 'participation').final, cat(r, 'behavior').final], [10, 6]];
  }],
  ['الواجبات بالحالات: تم + ناقص + لم يحل + متأخر، والمعذور خارج المقام = 4 من 8', () => {
    const tasks = ['done', 'partial', 'none', 'late', 'excused'].map((s, i) => ({ id: 'h' + i, kind: 'homework', date: D(i), max_score: 1 }));
    const results = ['done', 'partial', 'none', 'late', 'excused'].map((s, i) => ({ task_id: 'h' + i, status: s }));
    const r = base({ tasks, results });
    return [cat(r, 'homework').final, 4];
  }],
  ['الشهري: أفضل 2 من 3 (10، 18، 16 من 20) = 17 من 20', () => {
    const tasks = [10, 18, 16].map((s, i) => ({ id: 'm' + i, kind: 'monthly', date: D(i * 3), max_score: 20 }));
    const results = [10, 18, 16].map((s, i) => ({ task_id: 'm' + i, score: s }));
    const scheme = { ...defaultScheme(), monthly: { method: 'best', n: 2, outOf: 20 } };
    const r = base({ tasks, results, scheme });
    return [r.monthly.final, 17];
  }],
  ['اختبار تعويضي: تحل نتيجته محل الأصلي', () => {
    const tasks = [{ id: 'm1', kind: 'monthly', date: D(2), max_score: 20 }, { id: 'm1b', kind: 'monthly', date: D(4), max_score: 20, makeup_of: 'm1' }];
    const r = base({ tasks, results: [{ task_id: 'm1b', score: 15 }] });
    return [r.monthly.final, 15];
  }],
  ['حدث مُلغى لا يؤثر', () => {
    const r = base({ events: [ev('tsl', 1, { voided: true, void_reason: 'خطأ' })] });
    return [cat(r, 'behavior').final, 6];
  }],
  ['التحقق من مجموع التوزيع = 40', () => {
    const bad = { categories: [{ key: 'a', name: 'أ', weight: 30, method: 'ratio' }] };
    return [[validateScheme(defaultScheme()).ok, validateScheme(bad).ok], [true, false]];
  }],
];

export function runTests() {
  return CASES.map(([name, fn]) => {
    try {
      const [got, want] = fn();
      return { name, ok: JSON.stringify(got) === JSON.stringify(want), got, want };
    } catch (e) { return { name, ok: false, got: 'خطأ: ' + e.message, want: '' }; }
  });
}
