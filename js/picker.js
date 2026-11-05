// الاختيار العشوائي العادل — دورة محفوظة لكل فصل عبر الحصص والأيام
// قواعد: لا يتكرر طالب حتى يُسأل كل من في الدورة؛ من غاب يبقى دوره (owed)؛
// ترجيح لمن سُئل أقل ومن طال انتظاره؛ لا يُسأل مرتين في الحصة ما دام غيره متاحاً.
import { weightedPick, daysBetween } from './utils.js';

/**
 * @param {object} p
 *  candidates: معرفات الطلاب الحاضرين غير المعفيين
 *  members:    كل الطلاب النشطين في الفصل (لحساب من بقي له دور)
 *  picks:      سجل الاختيارات للفصل (غير المحذوفة)
 *  state:      { cycle_no, owed:[] }
 *  sessionId, today, exclude: معرفات تُستبعد مؤقتاً (مثل من لم يجب للتو)
 * @returns { studentId, state, rollover }
 */
export function choose({ candidates, members, picks, state, sessionId, today, exclude = [] }) {
  let st = { cycle_no: 1, owed: [], ...(state || {}) };
  let rollover = false;
  const pool0 = candidates.filter(id => !exclude.includes(id));
  if (!pool0.length) return { studentId: null, state: st, rollover };

  const consumedInCycle = new Set(picks.filter(p => p.consumed && p.cycle_no === st.cycle_no).map(p => p.student_id));
  let pool = pool0.filter(id => !consumedInCycle.has(id));
  if (!pool.length) {
    // انتهت الدورة لكل الحاضرين: دورة جديدة، ومن لم يُسأل فيها (غائب) يبقى له دوره
    const owed = members.filter(id => !consumedInCycle.has(id));
    st = { cycle_no: st.cycle_no + 1, owed: [...new Set([...(st.owed || []).filter(id => !consumedInCycle.has(id)), ...owed])] };
    rollover = true;
    pool = pool0;
  }
  // لا يُسأل مرتين في الحصة ما دام غيره متاحاً
  const askedNow = new Set(picks.filter(p => p.session_id === sessionId).map(p => p.student_id));
  const fresh = pool.filter(id => !askedNow.has(id));
  if (fresh.length) pool = fresh;

  const stats = pickStats(picks);
  const owed = new Set(st.owed || []);
  const id = weightedPick(pool, sid => weightOf(stats.get(sid), today, owed.has(sid)));
  return { studentId: id, state: st, rollover };
}

export function weightOf(s, today, isOwed) {
  const n = s?.chances || 0;
  const days = s?.last ? Math.max(0, daysBetween(s.last, today)) : 30;
  let w = (1 + Math.min(days, 30) / 5) / (1 + n * 0.35);
  if (isOwed) w *= 3;
  return w;
}

// إحصاءات العدالة: عدد الفرص، عدد الإجابات، آخر سؤال
export function pickStats(picks) {
  const m = new Map();
  for (const p of picks) {
    if (!p.consumed && !p.volunteer) continue;
    const s = m.get(p.student_id) || { chances: 0, answers: 0, correct: 0, last: null, volunteer: 0 };
    if (p.volunteer) s.volunteer++; else s.chances++;
    if (['correct', 'partial', 'wrong'].includes(p.outcome)) s.answers++;
    if (p.outcome === 'correct') s.correct++;
    if (!s.last || p.date > s.last) s.last = p.date;
    m.set(p.student_id, s);
  }
  return m;
}
