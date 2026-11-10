// =====================================================================
// محرك الدرجات — وحدة نقية واحدة تُستخدم في كل مكان (حتى بلا إنترنت)
// المدخلات بيانات خام، والمخرجات درجة مقترحة/معتمدة لكل فئة مع شرح عربي
// =====================================================================

export const TASK_KINDS = {
  homework: 'واجب', worksheet: 'ورقة عمل مختبر', quiz: 'اختبار قصير',
  performance: 'مهمة أدائية/مختبر', project: 'مشروع', monthly: 'اختبار فترة (شهري)', final: 'اختبار نهائي (للعرض فقط)',
};
export const HW_STATUS = { done: 'تم', partial: 'ناقص', none: 'لم يحل', late: 'متأخر', excused: 'معذور' };
export const METHODS = { ratio: 'نسبة', target: 'هدف', deduct: 'خصم' };
export const ATT_STATUS = { present: 'حاضر', late: 'متأخر', absent_excused: 'غائب بعذر', absent_unexcused: 'غائب بدون عذر' };

export const taskMode = t => t.mode || (t.kind === 'homework' ? 'status' : 'score');

export function defaultScheme() {
  return {
    categories: [
      { key: 'participation', name: 'المشاركة', weight: 10, method: 'target', target: 15, task_kinds: [] },
      { key: 'homework', name: 'الواجبات', weight: 8, method: 'ratio', task_kinds: ['homework'] },
      { key: 'lab', name: 'أوراق العمل والمهارات المخبرية', weight: 10, method: 'ratio', task_kinds: ['worksheet', 'performance', 'project'] },
      { key: 'quizzes', name: 'الاختبارات القصيرة', weight: 6, method: 'ratio', task_kinds: ['quiz'] },
      { key: 'behavior', name: 'السلوك والانضباط', weight: 6, method: 'deduct', task_kinds: [] },
    ],
    monthly: { method: 'avg', n: 2, outOf: 20 },
    options: { rounding: 0.5, hw: { done: 1, partial: 0.5, none: 0, late: 0.5 }, missing: 'exclude' },
  };
}

export function validateScheme(s) {
  const errors = [];
  const sum = (s.categories || []).reduce((a, c) => a + (+c.weight || 0), 0);
  if (Math.abs(sum - 40) > 1e-9) errors.push(`مجموع الأوزان ${fmt(sum)} والمطلوب 40 بالضبط`);
  const keys = new Set();
  for (const c of s.categories || []) {
    if (!c.name) errors.push('فئة بلا اسم');
    if (keys.has(c.key)) errors.push(`مفتاح مكرر: ${c.key}`); keys.add(c.key);
    if (!(+c.weight > 0)) errors.push(`وزن «${c.name}» يجب أن يكون أكبر من صفر`);
    if (c.method === 'target' && !(+c.target > 0)) errors.push(`حدد هدف النقاط لفئة «${c.name}»`);
  }
  return { ok: !errors.length, sum, errors };
}

const fmt = n => (n == null || isNaN(n)) ? '—' : String(Math.round(n * 100) / 100);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const roundStep = (x, step) => (x == null) ? x : (step ? Math.round(x / step + 1e-9) * step : Math.round(x * 100) / 100);
const sum = arr => arr.reduce((a, b) => a + b, 0);
const latest = arr => arr.slice().sort((a, b) => String(a.created_at || a.at || '').localeCompare(String(b.created_at || b.at || ''))).pop() || null;

export const OCC_STATUS = { applied: 'محتسب', warning: 'تنبيه أول بلا خصم', capped: 'تجاوز سقف الحصة (غير محتسب)' };

/**
 * حساب درجة طالب في فصل وفصل دراسي
 * inp: { term:{start,end}, today, enrollments, sessions, plannedSessions, attendance, events,
 *        eventTypes, tasks, results, scheme, overrides }
 */
export function computeStudent(inp) {
  const {
    term, today, enrollments = [], sessions = [], plannedSessions = 0, attendance = [],
    events = [], eventTypes = [], tasks = [], results = [], overrides = [],
  } = inp;
  const scheme = inp.scheme || defaultScheme();
  const opt = { ...defaultScheme().options, ...(scheme.options || {}) };
  opt.hw = { ...defaultScheme().options.hw, ...(scheme.options?.hw || {}) };
  const R = x => roundStep(x, +opt.rounding || 0);

  const cutoff = today && today < term.end ? today : term.end;
  const inTerm = d => d >= term.start && d <= cutoff;
  const enrolled = d => enrollments.some(e => !e.deleted && e.start_date <= d && (!e.end_date || d <= e.end_date));
  const inPeriod = d => inTerm(d) && enrolled(d);
  const hasPeriod = enrollments.some(e => !e.deleted && e.start_date <= cutoff && (!e.end_date || e.end_date >= term.start));

  // ---------- الحضور ----------
  const held = sessions.filter(s => !s.deleted && inTerm(s.date));
  const mine = held.filter(s => enrolled(s.date));
  const attBySession = new Map(attendance.filter(a => !a.deleted).map(a => [a.session_id, a]));
  const att = { present: 0, late: 0, absent_excused: 0, absent_unexcused: 0, sessions: mine.length, classSessions: held.length };
  for (const s of mine) { const st = attBySession.get(s.id)?.status || 'present'; att[st] = (att[st] || 0) + 1; }
  const presentCount = att.present + att.late;

  // ---------- الأحداث (مع المشتقة من الحضور) ----------
  const typeById = new Map(eventTypes.map(t => [t.id, t]));
  const typeBySys = new Map(eventTypes.filter(t => t.sys).map(t => [t.sys, t]));
  const sessionById = new Map(sessions.map(s => [s.id, s]));
  const occ = [];
  for (const ev of events) {
    if (ev.voided || ev.deleted || !inPeriod(ev.date)) continue;
    const t = typeById.get(ev.type_id); if (!t) continue;
    occ.push({ id: ev.id, type: t, date: ev.date, session_id: ev.session_id, period: sessionById.get(ev.session_id)?.period ?? null, factor: ev.factor ?? 1, at: ev.created_at || '', note: ev.note });
  }
  for (const s of mine) {
    const a = attBySession.get(s.id);
    if (!a || a.status === 'present') continue;
    const t = typeBySys.get(a.status); if (!t) continue;
    occ.push({ id: 'att:' + a.id, type: t, date: s.date, session_id: s.id, period: s.period ?? null, factor: 1, at: '', derived: true, late_minutes: a.late_minutes });
  }
  occ.sort((a, b) => a.date.localeCompare(b.date) || (a.period ?? 0) - (b.period ?? 0) || String(a.at).localeCompare(String(b.at)));
  const perType = new Map(), perSession = new Map();
  for (const o of occ) {
    const t = o.type, cap = +t.cap || 0, free = +t.free || 0;
    const sk = t.id + '|' + (o.session_id || o.date);
    const sc = perSession.get(sk) || 0;
    if (cap > 0 && sc >= cap) { o.status = 'capped'; o.points = 0; continue; }
    perSession.set(sk, sc + 1);
    const pts = (+t.points || 0) * o.factor;
    const c = (perType.get(t.id) || 0) + 1; perType.set(t.id, c);
    if (free > 0 && pts < 0 && c <= free) { o.status = 'warning'; o.points = 0; continue; }
    o.status = 'applied'; o.points = pts;
  }

  // ---------- نتيجة مهمة (مع الاختبار التعويضي) ----------
  const resByTask = new Map(results.filter(r => !r.deleted).map(r => [r.task_id, r]));
  const absentExcusedOn = d => attendance.some(a => !a.deleted && a.date === d && a.status === 'absent_excused');
  const hasValue = r => r && (r.status || (r.score != null && r.score !== ''));
  function evalTask(t) {
    let r = resByTask.get(t.id), makeup = false;
    for (const m of tasks.filter(m => m.makeup_of === t.id && !m.deleted)) {
      const mr = resByTask.get(m.id);
      if (hasValue(mr) && mr.status !== 'excused') { r = mr; makeup = true; }
    }
    const max = +t.max_score || 1;
    const base = { task: t, max, makeup, date: t.date, title: t.title };
    if (!hasValue(r)) {
      if (absentExcusedOn(t.date)) return { ...base, excluded: 'غائب بعذر' };
      if (opt.missing === 'zero') return { ...base, earned: 0, note: 'لم تُرصد (احتُسبت صفراً)' };
      return { ...base, excluded: 'لم تُرصد بعد' };
    }
    if (r.status === 'excused') return { ...base, excluded: 'معذور' };
    if (taskMode(t) === 'status') {
      const f = opt.hw[r.status] ?? 0;
      return { ...base, earned: f * max, status: r.status, note: HW_STATUS[r.status] };
    }
    return { ...base, earned: clamp(+r.score || 0, 0, max), score: +r.score };
  }

  // ---------- الفئات ----------
  const categories = scheme.categories.map(cat => {
    const ov = latest(overrides.filter(o => !o.deleted && o.category === cat.key));
    let res;
    if (!hasPeriod) res = { value: null, text: 'لم يكن الطالب مسجلاً في الفصل خلال هذا الفصل الدراسي', items: [] };
    else if (cat.method === 'target') res = byTarget(cat);
    else if (cat.method === 'deduct') res = byDeduct(cat);
    else res = byRatio(cat);
    const suggested = res.value == null ? null : R(clamp(res.value, 0, +cat.weight));
    return {
      key: cat.key, name: cat.name, weight: +cat.weight, method: cat.method,
      suggested, final: ov ? +ov.value : suggested, override: ov, text: res.text, items: res.items || [], raw: res.value,
    };
  });

  function byTarget(cat) {
    const items = occ.filter(o => o.type.category === cat.key);
    const pts = sum(items.filter(o => o.status === 'applied').map(o => o.points));
    const denom = Math.max(+plannedSessions || 0, held.length);
    if (!mine.length || !denom) return { value: null, text: 'لا توجد حصص منعقدة بعد خلال فترة تسجيل الطالب', items };
    if (!presentCount) return { value: null, text: 'لم يحضر الطالب أي حصة بعد، فلا يمكن حساب الهدف', items };
    const eff = (+cat.target) * presentCount / denom;
    const value = clamp(pts / eff * cat.weight, 0, +cat.weight);
    let text = `جمع ${fmt(pts)} نقطة من هدف ${fmt(eff)} فتساوي ${fmt(R(value))} من ${cat.weight}`;
    text += ` — الهدف ${fmt(cat.target)} نقطة للفصل الدراسي كاملاً (${denom} حصة)، وقُسِّم بنسبة ما حضره: ${presentCount} حصة`;
    if (pts > eff) text += '، ولا تتجاوز الدرجة الوزن';
    return { value, text, items };
  }
  function byDeduct(cat) {
    const items = occ.filter(o => o.type.category === cat.key);
    const ap = items.filter(o => o.status === 'applied');
    const neg = sum(ap.filter(o => o.points < 0).map(o => o.points));
    const pos = sum(ap.filter(o => o.points > 0).map(o => o.points));
    const rawV = +cat.weight + neg + pos;
    const value = clamp(rawV, 0, +cat.weight);
    let text = `بدأ بـ ${cat.weight} درجات`;
    text += neg ? ` ثم خُصم ${fmt(-neg)}` : ' ولم يُخصم منه شيء';
    if (pos) text += ` وأُعيد ${fmt(pos)} للتميّز`;
    text += ` فتساوي ${fmt(R(value))} من ${cat.weight}`;
    if (rawV < 0) text += ' (الحد الأدنى صفر)';
    if (rawV > +cat.weight) text += ' (الاستعادة لا تتجاوز الوزن)';
    const warned = items.filter(o => o.status === 'warning').length, capped = items.filter(o => o.status === 'capped').length;
    if (warned) text += ` — ${warned} تنبيه أول بلا خصم`;
    if (capped) text += ` — ${capped} تكرار في الحصة نفسها لم يُحتسب بسبب السقف`;
    return { value, text, items };
  }
  function byRatio(cat) {
    const kinds = cat.task_kinds || [];
    const ts = tasks.filter(t => !t.deleted && kinds.includes(t.kind) && !t.makeup_of && inPeriod(t.date))
      .sort((a, b) => a.date.localeCompare(b.date));
    const items = ts.map(evalTask);
    const counted = items.filter(i => !i.excluded);
    const earned = sum(counted.map(i => i.earned)), possible = sum(counted.map(i => i.max));
    if (!possible) return { value: null, text: ts.length ? 'لا توجد نتائج مرصودة محتسبة بعد' : 'لا توجد مهام من هذا النوع خلال فترة تسجيل الطالب', items };
    const value = earned / possible * cat.weight;
    let text = `حصل على ${fmt(earned)} من ${fmt(possible)} في ${counted.length} مهمة، أي ${fmt(earned / possible * 100)}٪ فتساوي ${fmt(R(value))} من ${cat.weight}`;
    const ex = items.length - counted.length;
    if (ex) text += ` — ${ex} مهمة خارج المقام (معذور/غائب بعذر/لم تُرصد)`;
    return { value, text, items };
  }

  // ---------- الاختبارات الشهرية ----------
  const mcfg = { method: 'avg', n: 2, outOf: 20, ...(scheme.monthly || {}) };
  const mTasks = tasks.filter(t => !t.deleted && t.kind === 'monthly' && !t.makeup_of && inPeriod(t.date)).sort((a, b) => a.date.localeCompare(b.date));
  const mItems = mTasks.map(evalTask).map(i => ({ ...i, pct: i.excluded ? null : i.earned / i.max }));
  const pcts = mItems.filter(i => i.pct != null).map(i => i.pct);
  let mVal = null, mText = 'لا توجد اختبارات شهرية مرصودة بعد';
  if (pcts.length) {
    let used = pcts;
    if (mcfg.method === 'best') used = pcts.slice().sort((a, b) => b - a).slice(0, Math.max(1, +mcfg.n || 1));
    mVal = sum(used) / used.length * mcfg.outOf;
    mText = mcfg.method === 'best'
      ? `أفضل ${used.length} من ${pcts.length} اختبار، متوسطها ${fmt(sum(used) / used.length * 100)}٪ فتساوي ${fmt(R(mVal))} من ${mcfg.outOf}`
      : `متوسط ${pcts.length} اختبار = ${fmt(sum(pcts) / pcts.length * 100)}٪ فتساوي ${fmt(R(mVal))} من ${mcfg.outOf}`;
  }
  const mOv = latest(overrides.filter(o => !o.deleted && o.category === 'monthly'));
  const mSug = mVal == null ? null : R(clamp(mVal, 0, mcfg.outOf));
  const monthly = { key: 'monthly', name: 'الاختبارات الشهرية', weight: mcfg.outOf, suggested: mSug, final: mOv ? +mOv.value : mSug, override: mOv, text: mText, items: mItems };

  const finals = tasks.filter(t => !t.deleted && t.kind === 'final' && inPeriod(t.date)).map(evalTask);

  const total = sum(categories.map(c => c.final ?? 0));
  const complete = categories.every(c => c.final != null);
  // ملخص عدّي لأنواع الأحداث (للتقارير)
  const counts = {};
  for (const o of occ) counts[o.type.id] = (counts[o.type.id] || 0) + 1;

  return {
    categories, total: roundStep(total, 0), complete, monthly, finals, attendance: att,
    occurrences: occ, counts, grand: roundStep(total + (monthly.final ?? 0), 0),
  };
}
