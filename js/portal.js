// المرحلة 3 — بوابة الطالب (جهة المعلم): الإعدادات، لقطات الدرجات، الرموز، المعاينة المحلية
// الفلترة الرسمية تتم على الخادم داخل tr_portal_me؛ هذه نسخة مطابقة للمعاينة فقط.
import { S, get, all, ws, save, workspace, classOf, lastClassOf, className, enrollmentsOf, roster, classes } from './store.js';
import { SYNC, client } from './sync.js';
import { classGradeRows, lockFor } from './gradeutil.js';
import { termRange, currentTerm } from './calendar.js';
import { randomDigits, todayISO, escapeHTML as e, loadScript } from './utils.js';
import { header } from './print.js';

export const SHOW_KEYS = {
  absence: 'الغياب', late: 'التأخر', behavior: 'السلوك', sleep: 'النوم في الحصة', participation: 'المشاركة',
  homework: 'الواجبات', tests: 'درجات الاختبارات والمهام', grade: 'الدرجة الأدائية', breakdown: 'تفصيل الدرجة',
};
const DEFAULT_SHOW = Object.fromEntries(Object.keys(SHOW_KEYS).map(k => [k, true]));

export function portalCfg(w, classId) {
  const base = w?.portal || {};
  const cl = base.classes?.[classId] || {};
  return {
    enabled: !!base.enabled, paused: !!base.paused || !!cl.paused, require_code: base.require_code !== false,
    grades_after: base.grades_after || null, show: { ...DEFAULT_SHOW, ...(base.show || {}), ...(cl.show || {}) },
  };
}
export function typeGroup(t) {
  if (t.portal_group) return t.portal_group;
  if ((t.name || '').includes('نوم')) return 'sleep';
  if (t.valence === 'neg') return 'behavior';
  if (t.category === 'participation' || t.valence === 'pos') return 'participation';
  return 'other';
}
export const studentPortalUrl = () => new URL('student.html', location.href).href.split('#')[0];

// ---------- لقطة الدرجة المنشورة للبوابة ----------
function snapshotOf(x, lock) {
  const sv = lock?.snapshot?.students?.find(s => s.student_id === x.student.id);
  if (sv) return { total: sv.total, monthly: sv.monthly, grand: sv.grand, approved: true, categories: sv.categories.map(c => ({ name: c.name, weight: c.weight, final: c.final, text: c.text || '' })) };
  const g = x.g;
  return { total: g.total, monthly: g.monthly.final, monthly_of: g.monthly.weight, grand: g.grand, approved: false, categories: g.categories.map(c => ({ name: c.name, weight: c.weight, final: c.final, text: c.text })) };
}
export async function publishSnapshots() {
  const w = workspace(); if (!w) return 0;
  const today = todayISO(); let n = 0;
  const existing = new Map(ws('portal_snapshots').map(r => [`${r.student_id}|${r.class_id}|${r.term}`, r]));
  for (const c of classes()) for (const term of [1, 2]) {
    const r = termRange(w, term); if (!r || r.start > today) continue;
    const lock = lockFor(c.id, term);
    for (const x of classGradeRows(c.id, term)) {
      const result = snapshotOf(x, lock);
      const k = `${x.student.id}|${c.id}|${term}`; const old = existing.get(k);
      if (old && JSON.stringify(old.result) === JSON.stringify(result)) continue;
      await save('portal_snapshots', { ...(old || {}), student_id: x.student.id, class_id: c.id, term, result });
      n++;
    }
  }
  return n;
}

// ---------- معاينة محلية لما يراه الطالب ----------
export function buildPortalData(studentId) {
  const w = workspace(); const st = get('students', studentId); if (!st) return null;
  const cls = classOf(studentId) || lastClassOf(studentId);
  const cfg = portalCfg(w, cls?.id); const sh = cfg.show; const today = todayISO();
  const gradesOk = !cfg.grades_after || cfg.grades_after <= today;
  const enr = enrollmentsOf(studentId);
  const inEnr = (classId, d) => enr.some(e => e.class_id === classId && e.start_date <= d && (!e.end_date || d <= e.end_date));
  const out = {
    ok: true, preview: true, show: sh, grades_visible: gradesOk, grades_after: cfg.grades_after, cfg,
    student: { name: st.full_name, seat_no: st.seat_no, class: className(cls), school: w.identity?.school, subject: w.identity?.subject, teacher: w.identity?.teacher },
    photo: get('student_photos', studentId)?.status === 'approved' ? get('student_photos', studentId).data : null,
    photo_request: ws('photo_requests', r => r.student_id === studentId).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]?.status || null,
  };
  if (sh.absence || sh.late) {
    const att = all('attendance', a => a.student_id === studentId);
    out.attendance = {
      sessions: ws('sessions', s => inEnr(s.class_id, s.date) && s.date <= today).length,
      absent_excused: sh.absence ? att.filter(a => a.status === 'absent_excused').length : null,
      absent_unexcused: sh.absence ? att.filter(a => a.status === 'absent_unexcused').length : null,
      late: sh.late ? att.filter(a => a.status === 'late').length : null,
      list: att.filter(a => (a.status.startsWith('absent') && sh.absence) || (a.status === 'late' && sh.late)).sort((a, b) => b.date.localeCompare(a.date)).map(a => ({ date: a.date, status: a.status })),
    };
  }
  const types = new Map(ws('event_types').map(t => [t.id, t]));
  out.events = all('events', e => e.student_id === studentId && !e.voided).map(e => ({ e, t: types.get(e.type_id) }))
    .filter(({ t }) => t && t.visible !== false && !['late', 'absent_unexcused', 'absent_excused'].includes(t.sys) && ['participation', 'behavior', 'sleep'].includes(typeGroup(t)) && sh[typeGroup(t)])
    .sort((a, b) => b.e.date.localeCompare(a.e.date)).slice(0, 400)
    .map(({ e, t }) => ({ date: e.date, name: t.name, valence: t.valence, group: typeGroup(t), icon: t.icon }));
  const res = new Map(all('task_results', r => r.student_id === studentId).map(r => [r.task_id, r]));
  const myTasks = ws('tasks', t => t.date <= today && (t.class_ids || []).some(c => inEnr(c, t.date)));
  if (sh.homework) out.homework = myTasks.filter(t => t.kind === 'homework').sort((a, b) => b.date.localeCompare(a.date)).map(t => ({ title: t.title, date: t.date, status: res.get(t.id)?.status || null }));
  if (sh.tests) out.tests = myTasks.filter(t => ['quiz', 'monthly', 'final', 'worksheet', 'performance', 'project'].includes(t.kind)).sort((a, b) => b.date.localeCompare(a.date))
    .map(t => ({ title: t.title, kind: t.kind, date: t.date, max: t.max_score, score: res.get(t.id)?.score ?? null, status: res.get(t.id)?.status || null }));
  if (sh.grade && gradesOk) out.grades = ws('portal_snapshots', g => g.student_id === studentId).sort((a, b) => a.term - b.term)
    .map(g => ({ term: g.term, class: className(get('classes', g.class_id)), ...g.result, categories: sh.breakdown ? g.result.categories : null }));
  return out;
}

// ---------- الرموز (تتطلب الاتصال: لا يُحفظ الرمز إلا كبصمة على الخادم) ----------
function needOnline() {
  if (SYNC.mode !== 'cloud') throw new Error('رموز الدخول تتطلب ربط التطبيق بـ Supabase (الوضع التجريبي لا يملك خادماً)');
  if (!navigator.onLine || !client() || !SYNC.user) throw new Error('يلزم الاتصال بالإنترنت وتسجيل الدخول لتوليد الرموز');
}
export async function generateCodes(studentIds) {
  needOnline();
  const out = [];
  for (const id of studentIds) {
    const code = randomDigits(6);
    const { error } = await client().rpc('tr_portal_set_code', { p_student_id: id, p_code: code });
    if (error) throw new Error(`${get('students', id)?.full_name}: ${error.message}`);
    out.push({ id, code });
  }
  return out;
}
export async function accessStatus(ids) {
  if (SYNC.mode !== 'cloud' || !navigator.onLine || !client() || !SYNC.user || !ids.length) return null;
  const { data, error } = await client().rpc('tr_portal_status', { p_ids: ids });
  if (error) throw new Error(/does not exist|Could not find/.test(error.message) ? 'شغّل phase3.sql في Supabase أولاً' : error.message);
  return new Map(data.map(r => [r.student_id, r]));
}
export async function unlockStudent(id) {
  needOnline();
  const { error } = await client().rpc('tr_portal_unlock', { p_student_id: id });
  if (error) throw new Error(error.message);
}

// ---------- قصاصات الرموز للطباعة ----------
export async function loadQR() {
  await loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js');
  return window.qrcode;
}
export async function slipsSheet(items) {
  const url = studentPortalUrl(); let qrSvg = '';
  try { const qrcode = await loadQR(); const q = qrcode(0, 'M'); q.addData(url); q.make(); qrSvg = q.createSvgTag({ cellSize: 2, margin: 0, scalable: true }); } catch { qrSvg = ''; }
  const w = workspace(); const req = portalCfg(w, null).require_code;
  const pages = [];
  for (let i = 0; i < items.length; i += 10) pages.push(items.slice(i, i + 10));
  return pages.map(pg => `<section class="pr-page">${header('رموز دخول بوابة الطالب')}
    <div class="slips">${pg.map(({ student, code }) => `<div class="slip">
      <div class="slip-txt"><b>${e(student.full_name)}</b><div>${e(className(classOf(student.id) || lastClassOf(student.id)))}</div>
      <div>الرابط: <span class="ltr">${e(url)}</span></div>
      <div>الدخول: رقم السجل المدني + الرمز</div>
      ${req ? `<div class="slip-code">${e(code)}</div><div class="pr-small">يمكنك تغييره بعد الدخول. لا تشاركه مع أحد.</div>` : '<div class="pr-small">الدخول برقم السجل المدني فقط.</div>'}</div>
      <div class="slip-qr">${qrSvg}</div></div>`).join('')}</div></section>`).join('');
}
export { roster, S };
