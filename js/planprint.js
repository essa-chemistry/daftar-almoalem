// طباعة الخطة السنوية: (1) الخطة بأسابيعها وتواريخها مع تنفيذ الشعبة، (2) التوزيع على حصص الشعبة أسبوعاً بأسبوع
import { workspace, get, className } from './store.js';
import { header } from './print.js';
import { lessonsFor, kindOf, studyWeeks, plannedRange, lessonSpans, lessonDone, distribution, fmtH, doneUnits, weekOfDate, KIND_LABEL } from './plan.js';
import { TERM_LABEL } from './calendar.js';
import { escapeHTML as e, DAY_NAMES, GRADE_NAMES, fmtDate, todayISO } from './utils.js';

const g = iso => (iso ? iso.split('-').reverse().join('/') : '');
const both = iso => (iso ? `${fmtH(iso)}<br><span class="g">${g(iso)}</span>` : '');
const sign = () => `<div class="pr-foot" style="margin-top:14px"><div>المعلم: ${e(workspace()?.identity?.teacher || '')} — التوقيع: ............</div><div>مدير المدرسة / المشرف: ....................</div></div>`;

// ---------- الخطة ----------
export function planSheet({ grade, term, classId = null }) {
  const w = workspace(); const weeks = studyWeeks(w, term);
  const ls = lessonsFor(grade, term);
  const sp = classId ? lessonSpans(classId, term) : null; const dn = classId ? lessonDone(classId, term) : null;
  // دمج خلايا الوحدة المتتالية
  const span = ls.map((l, i) => { if (i && ls[i - 1].unit === l.unit) return 0; let j = i; while (j < ls.length && ls[j].unit === l.unit) j++; return j - i; });
  let n = 0;
  const body = ls.map((l, i) => {
    const k = kindOf(l); const r = plannedRange(l, weeks); const s = sp?.get(l.id); const d = dn?.get(l.id);
    const st = !d ? '' : d.done >= d.of ? '✓ تم' : d.done ? `جارٍ ${d.done}/${d.of}` : '';
    const fm = m => (m ? `${DAY_NAMES[new Date(m.date + 'T00:00:00Z').getUTCDay()].replace('ال', '')} ${fmtH(m.date).slice(5)} ح${m.period}` : '');
    return `<tr class="pk-${k}">${k === 'lesson' ? `<td>${++n}</td>` : '<td></td>'}
      ${span[i] ? `<td rowspan="${span[i]}" class="unit">${e(l.unit)}</td>` : ''}
      <td class="nm wrap">${e(l.title)}${k !== 'lesson' ? ` <small>(${KIND_LABEL[k]})</small>` : ''}</td>
      <td>${k === 'lesson' ? l.periods : k === 'break' ? '—' : 'غير محدد'}</td><td>${e(l.weeks || '')}</td>
      <td>${both(r?.start)}</td><td>${both(r?.end)}</td>
      ${classId ? `<td class="small">${s ? `${fm(s.first)}${s.n > 1 ? ' ← ' + fm(s.last) : ''}` : ''}</td><td>${st}</td>` : ''}
      <td></td></tr>`;
  }).join('');
  const total = ls.filter(l => kindOf(l) === 'lesson').reduce((a, l) => a + (+l.periods || 1), 0);
  const meta = [['الصف', GRADE_NAMES[grade] || grade], ['الفصل الدراسي', TERM_LABEL[term]], ['عدد الدروس', String(n)], ['عدد الحصص', String(total)]];
  if (classId) meta.push(['الشعبة', className(get('classes', classId))], ['المنفذ حتى الآن', `${Math.min(doneUnits(classId, term), total)} حصة`]);
  return `<section class="pr-page">${header('الخطة الفصلية لتوزيع المنهج' + (w.identity?.subject ? ' — ' + w.identity.subject : ''), meta)}
    <table class="pr plan"><colgroup><col style="width:8mm"><col style="width:${classId ? 34 : 42}mm"><col><col style="width:13mm"><col style="width:16mm"><col style="width:21mm"><col style="width:21mm">${classId ? '<col style="width:40mm"><col style="width:16mm">' : ''}<col style="width:${classId ? 22 : 34}mm"></colgroup>
    <thead><tr><th>م</th><th>الوحدة</th><th>الدرس</th><th>عدد الحصص</th><th>الأسبوع</th><th>البداية<br>هجري / ميلادي</th><th>النهاية<br>هجري / ميلادي</th>${classId ? '<th>الحصص الفعلية للشعبة</th><th>التنفيذ</th>' : ''}<th>ملاحظات</th></tr></thead>
    <tbody>${body}</tbody></table>${sign()}</section>`;
}

// ---------- التوزيع على حصص الشعبة ----------
export function distributionSheet({ classId, term }) {
  const w = workspace(); const c = get('classes', classId);
  const { rows, weeks, units } = distribution(classId, term);
  const done = doneUnits(classId, term); const unitIndex = new Map(units.map((u, i) => [u, i]));
  const breaks = lessonsFor(c.grade, term).filter(l => kindOf(l) === 'break').map(l => ({ l, r: plannedRange(l, weeks) })).filter(x => x.r);
  const groups = [];
  for (const r of rows) {
    const wk = weekOfDate(weeks, r.date);
    const key = wk ? wk.from : r.date;
    let gp = groups[groups.length - 1]; if (!gp || gp.key !== key) { gp = { key, wk, rows: [] }; groups.push(gp); }
    gp.rows.push(r);
  }
  // إجازات الخطة تُدرج بين الأسابيع
  const items = [];
  for (const gp of groups) {
    for (const b of breaks) if (!b.used && b.r.start < gp.rows[0].date) { items.push({ brk: b.l, r: b.r }); b.used = true; }
    items.push(gp);
  }
  for (const b of breaks) if (!b.used) items.push({ brk: b.l, r: b.r });
  const body = items.map(it => {
    if (it.brk) return `<tr class="pk-break"><td colspan="7">${e(it.brk.title)} — ${fmtH(it.r.start)} إلى ${fmtH(it.r.end)} (${g(it.r.start)} – ${g(it.r.end)})</td></tr>`;
    return it.rows.map((r, j) => {
      const ok = r.unit && unitIndex.get(r.unit) < done;
      const t = r.unit ? `${e(r.unit.lesson.title)}${r.unit.of > 1 ? ` <small>(${r.unit.k}/${r.unit.of})</small>` : ''}` : r.activity ? `<i>${e(r.activity.title)}</i>` : '<span class="muted">حصة احتياطية (مراجعة/تعزيز)</span>';
      return `<tr class="${j === 0 ? 'wk-first' : ''}">${j === 0 ? `<td rowspan="${it.rows.length}" class="wkc"><b>${it.wk?.n ? 'الأسبوع ' + it.wk.n : ''}</b><br><small>${it.wk ? `${fmtH(it.wk.start).slice(5)} – ${fmtH(it.wk.end).slice(5)}` : ''}</small></td>` : ''}
        <td>${DAY_NAMES[new Date(r.date + 'T00:00:00Z').getUTCDay()]}</td><td>${fmtH(r.date)}</td><td>${g(r.date)}</td><td>${r.period}</td>
        <td class="nm wrap">${t}</td><td>${ok ? '✓' : ''}</td></tr>`;
    }).join('');
  }).join('');
  const meta = [['الشعبة', className(c)], ['الفصل الدراسي', TERM_LABEL[term]], ['الحصص المتاحة', String(rows.length)], ['حصص الخطة', String(units.length)], ['المنفذ', `${Math.min(done, units.length)}`]];
  return `<section class="pr-page">${header('توزيع دروس الخطة على الحصص', meta)}
    <table class="pr plan dist"><colgroup><col style="width:22mm"><col style="width:17mm"><col style="width:21mm"><col style="width:21mm"><col style="width:10mm"><col><col style="width:12mm"></colgroup>
    <thead><tr><th>الأسبوع</th><th>اليوم</th><th>التاريخ هجري</th><th>ميلادي</th><th>الحصة</th><th>الدرس</th><th>تم</th></tr></thead>
    <tbody>${body || '<tr><td colspan="7">لا توجد حصص في هذا الفصل الدراسي — تحقق من الجدول والتقويم</td></tr>'}</tbody></table>
    <div class="pr-small" style="margin-top:4px">يُحسب التوزيع من الجدول بعد استبعاد الإجازات والحصص الملغاة وغياب المعلم. طُبع في ${e(fmtDate(todayISO()))}.</div>${sign()}</section>`;
}
