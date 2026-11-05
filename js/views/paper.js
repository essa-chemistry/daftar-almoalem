// المرحلة 2 — الإدخال السريع من الكشف الورقي: نفس شكل كشف المتابعة، تُكتب الرموز في الخلايا فتتحول لأحداث بتاريخ الحصة
import { html, useState, useRef } from '../lib.js';
import { get, all, save, audit, classes, className, roster, calCtx, findSession, sessionAttendance, sessionEvents, eventTypes, enrollmentsOf, isEnrolledOn } from '../store.js';
import { useStore, Icon, Btn, Empty, toast } from '../ui.js';
import { meetingsRange, isHeldStatus } from '../calendar.js';
import { timetables } from '../store.js';
import { setAttendance, addEvent } from '../ops.js';
import { todayISO, weekStart, addDays, DAY_SHORT, dow, fmtShort, normDigits } from '../utils.js';

const ATT_SYS = { absent_unexcused: 1, absent_excused: 1, late: 1 };

// خريطة الرموز من أنواع الأحداث (يعدّلها المعلم من الإعدادات)
export function codeMap() {
  const m = new Map();
  for (const t of eventTypes()) if (t.code) m.set(t.code.trim(), { t, att: ATT_SYS[t.sys] ? t.sys : null });
  return m;
}
// تحليل نص الخلية: «2ص ن» = إجابتان صحيحتان + نوم
export function parseCodes(str, map) {
  const codes = [...map.keys()].sort((a, b) => b.length - a.length);
  const s = normDigits(String(str || '')).replace(/[\s,،+✓.\-]/g, '');
  const items = [], bad = [];
  let i = 0;
  while (i < s.length) {
    let n = '';
    while (i < s.length && /\d/.test(s[i])) n += s[i++];
    if (i >= s.length) { if (n) bad.push(n); break; }
    const c = codes.find(c => s.startsWith(c, i));
    if (!c) { bad.push(s[i]); i++; continue; }
    items.push({ code: c, n: Math.max(1, +n || 1), ...map.get(c) });
    i += c.length;
  }
  return { items, bad };
}
// إكمال تلقائي: إن كان آخر ما كُتب بداية لرمز واحد فقط يُكمَل
function autocomplete(val, map) {
  const codes = [...map.keys()];
  for (let k = Math.min(2, val.length); k >= 1; k--) {
    const tail = val.slice(-k);
    if (codes.includes(tail)) return val;
    const m = codes.filter(c => c.length > k && c.startsWith(tail));
    if (m.length === 1) return val.slice(0, -k) + m[0];
  }
  return val;
}

export function PaperEntryPage({ q = {} }) {
  useStore();
  const today = todayISO();
  const cls = classes();
  const [cid, setCid] = useState(q.class || cls[0]?.id || '');
  const [from, setFrom] = useState(weekStart(q.from || addDays(today, -7)));
  const [weeks, setWeeks] = useState(+q.weeks || 1);
  const [vals, setVals] = useState({});
  const [focus, setFocus] = useState(null);
  const inputs = useRef({});
  if (!cls.length) return html`<div class="page"><${Empty} title="لا توجد فصول" /></div>`;
  const to = addDays(from, 7 * weeks - 1);
  const map = codeMap();
  const ms = meetingsRange(calCtx(), cid, from, to);
  const rows = roster(cid, to, { includeLeft: true }).filter(x => enrollmentsOf(x.student.id).some(e => e.class_id === cid && e.start_date <= to && (!e.end_date || e.end_date >= from)));
  const key = (m, sid) => `${m.date}|${m.period}|${sid}`;
  const recorded = (m, sid) => {
    const s = findSession(cid, m.date, m.period); if (!s) return '';
    const a = sessionAttendance(s.id).get(sid);
    const out = [];
    if (a && ATT_SYS[a.status]) out.push(eventTypes().find(t => t.sys === a.status)?.code || '');
    for (const ev of sessionEvents(s.id).filter(e => e.student_id === sid)) out.push(get('event_types', ev.type_id)?.code || '');
    return out.join('');
  };
  const filled = Object.entries(vals).filter(([, v]) => v.trim());
  // لماذا الخلايا مظللة؟ (حصص لم تأتِ بعد، أو قبل تاريخ تسجيل الطالب)
  const heldPast = ms.filter(m => isHeldStatus(m.status) && m.date <= today);
  const future = ms.filter(m => isHeldStatus(m.status) && m.date > today).length;
  const nowRoster = roster(cid, today);
  const lateStart = nowRoster.map(x => enrollmentsOf(x.student.id).filter(e => e.class_id === cid).map(e => e.start_date).sort()[0]).filter(d => d && d > from);
  const lateDate = lateStart.length ? lateStart.sort()[lateStart.length - 1] : null;
  const errors = filled.filter(([, v]) => parseCodes(v, map).bad.length);
  const setV = (k, v) => setVals(o => ({ ...o, [k]: v }));
  const insert = code => {
    if (!focus) return toast('اختر خلية أولاً', 'warn');
    setV(focus, (vals[focus] || '') + code);
    setTimeout(() => inputs.current[focus]?.focus(), 0);
  };
  const move = (k, d) => {
    const [date, period, sid] = k.split('|');
    const i = rows.findIndex(x => x.student.id === sid);
    for (let j = i + d; j >= 0 && j < rows.length; j += d) {
      const nk = `${date}|${period}|${rows[j].student.id}`;
      if (inputs.current[nk]) { inputs.current[nk].focus(); return; }
    }
  };
  const doSave = async () => {
    if (!filled.length) return toast('لا توجد رموز مكتوبة', 'warn');
    if (errors.length) return toast(`رموز غير معروفة في ${errors.length} خلية (ملوّنة بالأحمر)`, 'err');
    let nEv = 0, nAtt = 0; const sess = new Set();
    for (const [k, v] of filled) {
      const [date, period, sid] = k.split('|');
      let s = findSession(cid, date, +period);
      if (!s) s = await save('sessions', { class_id: cid, date, period: +period, status: 'closed', manual: false, from_paper: true, exempt: [], started_at: null });
      sess.add(s.id);
      for (const it of parseCodes(v, map).items) {
        if (it.att) { await setAttendance(s, sid, it.att); nAtt++; }
        else for (let n = 0; n < it.n; n++) { await addEvent(s, sid, it.t.id, { from_paper: true }); nEv++; }
      }
    }
    await audit('إدخال من الكشف الورقي', `${className(get('classes', cid))}: ${nEv} حدث و${nAtt} حضور في ${sess.size} حصة`);
    setVals({}); toast(`سُجّل ${nEv} حدثاً و${nAtt} حالة حضور في ${sess.size} حصة`, 'ok', 4500);
  };
  // تجميع بالأسبوع
  const wk = []; for (const m of ms) { const s0 = weekStart(m.date); let g = wk.find(x => x.s === s0); if (!g) wk.push(g = { s: s0, items: [] }); g.items.push(m); }
  const cols = wk.flatMap((g, gi) => g.items.map((m, i) => ({ ...m, first: i === 0, gi })));
  const fParse = focus && vals[focus] ? parseCodes(vals[focus], map) : null;
  return html`<div class="page">
    <div class="page-head"><a class="icon-btn" href="#/print"><${Icon} name="back" /></a><div><h1>الإدخال من الكشف الورقي</h1><div class="sub">اكتب الرموز كما في الكشف المطبوع؛ تتحول إلى أحداث بتاريخ الحصة الصحيح. مثال: «2ص ن» = إجابتان صحيحتان ونوم.</div></div>
      <div class="actions"><${Btn} cls="primary" disabled=${!filled.length} onClick=${doSave}><${Icon} name="check" /> حفظ ${filled.length ? `(${filled.length} خلية)` : ''}</${Btn}></div></div>
    ${ms.length && !heldPast.length && future ? html`<div class="notice" style="margin-bottom:12px">هذه الفترة لم تأتِ بعد، والإدخال متاح فقط للحصص التي انعقدت. اضغط «الأسبوع السابق».</div>` : null}
    ${heldPast.length && lateDate && lateStart.length >= nowRoster.length / 2 ? html`<div class="notice" style="margin-bottom:12px">أغلب الطلاب مسجلون في الفصل من ${fmtShort(lateDate)} فقط، فالخلايا قبل هذا التاريخ مظللة. إن كانوا معك من بداية الفصل الدراسي فعدّل التاريخ من <a href=${'#/class/' + cid}>صفحة الفصل ← «تاريخ التحاق الطلاب»</a>.</div>` : null}
    <div class="card" style="margin-bottom:12px"><div class="row">
      <select style="max-width:220px" value=${cid} onChange=${e => { setCid(e.target.value); setVals({}); }}>${cls.map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select>
      <label class="row small">أسبوع يبدأ <input type="date" style="width:170px" value=${from} onChange=${e => { setFrom(weekStart(e.target.value)); setVals({}); }} /></label>
      <button class="btn sm" onClick=${() => { setFrom(addDays(from, -7)); setVals({}); }}>الأسبوع السابق</button><button class="btn sm" onClick=${() => { setFrom(addDays(from, 7)); setVals({}); }}>التالي</button>
      <label class="row small">عدد الأسابيع <select style="width:80px" value=${weeks} onChange=${e => setWeeks(+e.target.value)}>${[1, 2, 3, 4].map(n => html`<option value=${n}>${n}</option>`)}</select></label></div>
      <div class="chips" style="margin-top:10px">${[...map.entries()].map(([c, x]) => html`<button class=${'chip'} onMouseDown=${e => e.preventDefault()} onClick=${() => insert(c)} title=${x.t.name}><b>${c}</b> ${x.t.name}</button>`)}</div>
      ${fParse ? html`<div class=${fParse.bad.length ? 'error small' : 'info small'} style="margin-top:8px">${fParse.items.map(i => `${i.n > 1 ? i.n + '× ' : ''}${i.t.name}`).join('، ') || '—'}${fParse.bad.length ? ` — غير معروف: ${fParse.bad.join(' ')}` : ''}</div>` : null}
    </div>
    ${!cols.length ? html`<div class="card"><${Empty} icon="calendar" title="لا توجد حصص لهذا الفصل في هذه الفترة">${timetables()[0] && timetables()[0].effective_from > from ? html`<span>الجدول الأسبوعي ساري من ${fmtShort(timetables()[0].effective_from)} فقط، فلا تظهر حصص قبله. عدّل تاريخه من <a href="#/settings/timetable">الإعدادات ← الجدول ← «تعديل تاريخ السريان»</a> إلى بداية الفصل الدراسي.</span>` : !timetables().length ? html`<span>لم يُضبط الجدول الأسبوعي بعد. <a href="#/settings/timetable">اضبطه من الإعدادات</a>.</span>` : html`<span>تحقق من أن الأسبوع داخل تواريخ الفصل الدراسي، ومن أن الفصل له حصص في الجدول.</span>`}</${Empty}></div>` : html`
    <div class="table-wrap"><table class="tbl paper-grid">
      <thead><tr><th rowspan="2">م</th><th rowspan="2">الطالب</th>${wk.map((g, i) => html`<th colspan=${g.items.length} class="wk-h">الأسبوع ${fmtShort(g.s)}</th>`)}</tr>
        <tr>${cols.map(m => html`<th class=${'num' + (m.first ? ' wk-sep' : '') + (isHeldStatus(m.status) ? '' : ' shaded')}>${DAY_SHORT[dow(m.date)]}<br />${fmtShort(m.date)}<br />ح${m.period}</th>`)}</tr></thead>
      <tbody>${rows.map((x, ri) => html`<tr><td class="num">${x.student.seat_no || ri + 1}</td><td style="white-space:nowrap">${x.student.full_name}</td>
        ${cols.map(m => {
          const enr = enrollmentsOf(x.student.id).some(e => e.class_id === cid && isEnrolledOn(e, m.date));
          const ok = enr && isHeldStatus(m.status) && m.date <= today;
          const k = key(m, x.student.id); const v = vals[k] || '';
          const bad = v && parseCodes(v, map).bad.length;
          const rec = ok ? recorded(m, x.student.id) : '';
          return html`<td class=${'pcell' + (m.first ? ' wk-sep' : '') + (ok ? '' : ' shaded')}>${ok ? html`${rec ? html`<span class="rec" title="مسجّل سابقاً">${rec}</span>` : null}<input class=${bad ? 'bad' : v ? 'good' : ''} value=${v} ref=${el => { inputs.current[k] = el; }}
            onFocus=${() => setFocus(k)} onInput=${e => setV(k, autocomplete(e.target.value, map))}
            onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); move(k, e.shiftKey ? -1 : 1); } }} />` : null}</td>`;
        })}</tr>`)}</tbody></table></div>
    <p class="muted small">الرمادي الصغير = ما سُجّل سابقاً في الحصة (لا يتكرر، والمكتوب يُضاف إليه). الخلايا المظللة: إجازة أو حصة ملغاة أو غير مسجل أو تاريخ لاحق. Enter ينقلك للطالب التالي.</p>`}
  </div>`;
}
