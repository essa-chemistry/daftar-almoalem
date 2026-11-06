// الخطة السنوية: الدروس (مع أسابيعها وتواريخها)، توزيعها على الحصص الفعلية لكل شعبة، ومتابعة التقدم
// التوزيع محسوب دائماً من التقويم والجدول والاستثناءات، فيُعاد تلقائياً عند إلغاء حصة أو إضافة إجازة
// أنواع الصفوف: lesson = درس بعدد حصص، activity = مراجعة/اختبارات (بلا عدد محدد)، break = إجازة
import { ws, get, calCtx, workspace } from './store.js';
import { meetingsRange, isHeldStatus, termRange, holidayOn, isWorkday } from './calendar.js';
import { todayISO, nowMinutes, parseHM, addDays, weekStart, normDigits, normAr, isISO } from './utils.js';

export const KIND_LABEL = { lesson: 'درس', activity: 'مراجعة/تقويم', break: 'إجازة' };
export const kindOf = l => l.kind || 'lesson';
export const lessonsFor = (grade, term) => ws('plan_lessons', l => +l.grade === +grade && +l.term === +term).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const weekNums = s => (normDigits(s).match(/\d+/g) || []).map(Number).filter(n => n > 0 && n < 60);

// ---------- أسابيع الدراسة: تبدأ بالأحد، والأسبوع الذي كله إجازة لا يُعد ----------
export function studyWeeks(w, term) {
  const r = termRange(w, term); if (!r) return [];
  const out = []; let n = 0;
  for (let s = weekStart(r.start); s <= r.end; s = addDays(s, 7)) {
    const days = []; for (let i = 0; i < 7; i++) { const d = addDays(s, i); if (d >= r.start && d <= r.end && isWorkday(w, d)) days.push(d); }
    if (!days.length) continue;
    const off = days.every(d => { const h = holidayOn(w, d); return h && h.kind !== 'exams'; });
    if (off) { out.push({ n: null, from: s, start: days[0], end: days[days.length - 1], off: holidayOn(w, days[0]) }); continue; }
    out.push({ n: ++n, from: s, start: days[0], end: days[days.length - 1] });
  }
  return out;
}
export const weekOfDate = (weeks, d) => weeks.find(x => d >= x.from && d <= addDays(x.from, 6)) || null;

// المدى المخطط للدرس: من تواريخه إن وُجدت، وإلا من أرقام أسابيعه
export function plannedRange(l, weeks) {
  if (l.start) return { start: l.start, end: l.end || l.start };
  const ns = weekNums(l.weeks); if (!ns.length) return null;
  const a = weeks.find(x => x.n === Math.min(...ns)), b = weeks.find(x => x.n === Math.max(...ns));
  if (!a) return null;
  return { start: a.start, end: (b || a).end };
}

// كل درس يُفرد إلى وحدات بعدد حصصه المخططة
export function units(grade, term) {
  const out = [];
  for (const l of lessonsFor(grade, term)) {
    if (kindOf(l) !== 'lesson') continue;
    const of = Math.max(1, +l.periods || 1);
    for (let k = 1; k <= of; k++) out.push({ lesson: l, k, of });
  }
  return out;
}
export const planMode = () => workspace()?.plan_mode || 'weeks';

// الحصص المتاحة: الجدول بعد استبعاد الإجازات والاختبارات والحصص الملغاة وغياب المعلم (+ الحصص الإضافية)
export function availableMeetings(classId, term) {
  const r = termRange(workspace(), term); if (!r) return [];
  return meetingsRange(calCtx(), classId, r.start, r.end).filter(m => isHeldStatus(m.status));
}
// التوزيع: «حسب الأسابيع» لا يبدأ الدرس قبل أسبوعه في الخطة (فتبقى حصص احتياطية إن سبقت الشعبة)، و«متتابع» يملأ كل حصة
export function distribution(classId, term) {
  const c = get('classes', classId); if (!c) return { meetings: [], units: [], rows: [], weeks: [] };
  const w = workspace(); const weeks = studyWeeks(w, term);
  const ms = availableMeetings(classId, term), us = units(c.grade, term);
  const byWeeks = planMode() === 'weeks';
  const anchors = new Map(); if (byWeeks) for (const l of lessonsFor(c.grade, term)) { const r = plannedRange(l, weeks); if (r) anchors.set(l.id, r.start); }
  const rows = ms.map(m => ({ ...m, unit: null, activity: null }));
  let i = 0, unassigned = 0;
  for (const u of us) {
    const a = anchors.get(u.lesson.id);
    while (a && i < rows.length && rows[i].date < a) i++;
    if (i >= rows.length) { unassigned++; continue; }
    rows[i++].unit = u;
  }
  // الحصص الحرة: إن وقعت في مدى نشاط (مراجعة/اختبار) يُكتب اسمه
  const acts = lessonsFor(c.grade, term).filter(l => kindOf(l) === 'activity').map(l => ({ l, r: plannedRange(l, weeks) })).filter(x => x.r);
  for (const r of rows) if (!r.unit) r.activity = acts.find(x => r.date >= x.r.start && r.date <= x.r.end)?.l || null;
  return { meetings: ms, units: us, rows, weeks, unassigned };
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
// موضع الشعبة في الخطة: يُحسب بالمرور على الحصص بترتيبها؛ plan_at في حصة = «الدرس في هذه الحصة» كما حدده المعلم
// ثم «تم الشرح» يقدّم الموضع بعدد حصصه. at = الموضع عند بداية كل حصة
export function planPositions(classId, term) {
  const ss = sessionsOf(classId, term).sort((a, b) => a.date.localeCompare(b.date) || (a.period || 99) - (b.period || 99) || (a.created_at || '').localeCompare(b.created_at || ''));
  // موضع حدده المعلم من صفحة الخطة: يُعامل كحصة افتراضية في نهاية يوم التحديد
  const set = get('classes', classId)?.plan_set?.[term];
  if (set) { const i = ss.findIndex(x => x.date > set.date); ss.splice(i < 0 ? ss.length : i, 0, { id: '__set', plan_at: set.pos }); }
  let pos = 0, anchored = false; const at = new Map();
  for (const s of ss) {
    if (s.plan_at != null) { pos = Math.max(0, +s.plan_at); anchored = true; }
    at.set(s.id, pos);
    if (s.plan_done) pos += Math.max(1, +s.plan_units || 1);
  }
  return { done: pos, at, anchored };
}
export const doneUnits = (classId, term) => planPositions(classId, term).done;
export function progress(classId, term) {
  const { meetings, units: us, rows, unassigned = 0 } = distribution(classId, term);
  const today = todayISO(), now = nowMinutes();
  const pp = planPositions(classId, term); const done = pp.done; const tracked = pp.anchored || done > 0;
  const plannedSoFar = rows.filter(r => r.unit && passed(r, today, now)).length;
  const diff = Math.min(done, us.length) - plannedSoFar; // موجب = متقدم، سالب = متأخر
  return {
    total: us.length, available: meetings.length, done: Math.min(done, us.length), plannedSoFar, diff,
    next: us[Math.min(done, us.length)] || null, tracked, status: !us.length ? 'none' : !tracked ? 'untracked' : diff >= 1 ? 'ahead' : diff <= -1 ? 'behind' : 'ontrack',
    shortfall: unassigned, // عدد الحصص التي لم تجد حصة متاحة
    spare: rows.filter(r => !r.unit).length,
  };
}
// الدرس المخطط لحصة معينة
export function plannedFor(classId, term, date, period) {
  const { rows } = distribution(classId, term);
  if (period) return rows.find(r => r.date === date && r.period === period)?.unit || null;
  // حصة يدوية: أول درس مخطط من هذا اليوم فصاعداً
  return rows.find(r => r.date >= date && r.unit)?.unit || null;
}
// رقم الوحدة (0..) لدرس/جزء معين في قائمة الوحدات
export const unitIndexOf = (us, u) => (u ? us.findIndex(x => x.lesson.id === u.lesson.id && x.k === u.k) : -1);
// ملخص لكل درس: أول وآخر حصة مخططة
export function lessonSpans(classId, term) {
  const { rows } = distribution(classId, term); const m = new Map();
  for (const r of rows) if (r.unit) { const id = r.unit.lesson.id; const o = m.get(id) || { first: r, last: r, n: 0 }; o.last = r; o.n++; m.set(id, o); }
  return m;
}
// حالة تنفيذ كل درس لشعبة: عدد حصصه المنفذة (الوحدات تُنفَّذ بالترتيب)
export function lessonDone(classId, term) {
  const c = get('classes', classId); const done = doneUnits(classId, term); const m = new Map();
  units(c.grade, term).forEach((u, i) => { const o = m.get(u.lesson.id) || { done: 0, of: u.of }; if (i < done) o.done++; m.set(u.lesson.id, o); });
  return m;
}

// ---------- التاريخ الهجري ----------
const hParts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
function hOf(iso) { const o = {}; for (const p of hParts.formatToParts(new Date(iso + 'T00:00:00Z'))) o[p.type] = +String(p.value).replace(/\D/g, '') || o[p.type]; return o; }
export const fmtH = iso => { if (!iso) return ''; const h = hOf(iso); return `${h.year}/${String(h.month).padStart(2, '0')}/${String(h.day).padStart(2, '0')}`; };
export function hijriToISO(y, m, d) {
  const approx = Math.round((y - 1) * 354.36707 + (m - 1) * 29.5306 + d - 1);
  const base = new Date(Date.UTC(622, 6, 19) + approx * 86400000).toISOString().slice(0, 10);
  for (let k = 0; k <= 40; k++) for (const s of [k, -k]) { const c = addDays(base, s); const h = hOf(c); if (h.year === y && h.month === m && h.day === d) return c; }
  return null;
}
// قراءة تاريخ من خلية Excel: رقم تسلسلي، أو نص ميلادي، أو نص هجري (14xx)
export function parseDateCell(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  if (typeof v === 'number') { if (v < 20000 || v > 80000) return null; return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10); }
  const s = normDigits(String(v)).trim(); const n = s.match(/\d+/g); if (!n || n.length < 3) return null;
  let [a, b, c] = n.map(Number);
  if (a >= 1300 && a < 1600) return hijriToISO(a, b, c);
  if (c >= 1300 && c < 1600) return hijriToISO(c, b, a);
  const pad = x => String(x).padStart(2, '0');
  if (a > 1900) return `${a}-${pad(b)}-${pad(c)}`;
  if (c > 1900) { if (b > 12) [a, b] = [b, a]; return `${c}-${pad(b)}-${pad(a)}`; }
  return null;
}

// ---------- قراءة ملف الخطة ----------
export const TEMPLATE_HEAD = ['الوحدة', 'الدرس', 'عدد الحصص', 'الأسبوع / الأسابيع', 'البداية هجري', 'النهاية هجري', 'البداية ميلادي', 'النهاية ميلادي', 'ملاحظات'];
export function parsePlanRows(rows) {
  const hi = rows.slice(0, 12).findIndex(r => r.some(c => normAr(c).includes('درس') || normAr(c) === 'lesson'));
  if (hi < 0) throw new Error('لم أجد صف العناوين (يجب أن يحتوي عمود «الدرس»)');
  const head = rows[hi].map(h => normAr(h));
  const col = (keys, not = []) => head.findIndex(h => keys.some(k => h.includes(k)) && !not.some(k => h.includes(k)));
  const C = {
    unit: col(['وحده', 'unit']), title: col(['درس', 'موضوع', 'lesson']), periods: col(['حصص', 'periods']),
    weeks: col(['اسبوع', 'week']), hs: col(['بدايه'], ['ميلادي']), he: col(['نهايه'], ['ميلادي']),
    gs: col(['بدايه ميلادي', 'من ميلادي', 'start']), ge: col(['نهايه ميلادي', 'الي ميلادي', 'end']), notes: col(['ملاحظ', 'note']),
  };
  const hasHijriHead = i => i >= 0 && head[i].includes('هجري');
  const val = (r, i) => (i >= 0 ? r[i] : '');
  const txt = v => String(v ?? '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const items = [];
  for (const r of rows.slice(hi + 1)) {
    const title = txt(val(r, C.title)); if (!title) continue;
    const unit = txt(val(r, C.unit));
    const pRaw = val(r, C.periods); const pNum = +normDigits(pRaw);
    const pTxt = txt(pRaw);
    let periods = C.periods < 0 || pTxt === '' ? 1 : Number.isFinite(pNum) && /\d/.test(normDigits(pTxt)) ? Math.max(0, Math.round(pNum)) : null;
    const isBreak = normAr(unit + ' ' + title).includes('اجازه') || periods === 0;
    const kind = isBreak ? 'break' : periods == null ? 'activity' : 'lesson';
    let start = parseDateCell(val(r, C.gs)), end = parseDateCell(val(r, C.ge));
    if (!start && hasHijriHead(C.hs)) start = parseDateCell(val(r, C.hs));
    if (!end && hasHijriHead(C.he)) end = parseDateCell(val(r, C.he));
    items.push({ unit, title, kind, periods: kind === 'lesson' ? Math.max(1, periods || 1) : null, weeks: txt(val(r, C.weeks)), start: start || null, end: end || start || null, notes: txt(val(r, C.notes)) });
  }
  if (!items.length) throw new Error('الملف لا يحتوي دروساً تحت صف العناوين');
  return items;
}
export { isISO };
