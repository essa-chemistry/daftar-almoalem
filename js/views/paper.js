// المرحلة 2 — الإدخال السريع من الكشف الورقي: نفس شكل كشف المتابعة، تُكتب الرموز في الخلايا فتتحول لأحداث بتاريخ الحصة
import { html, useState, useRef, useEffect } from '../lib.js';
import { ws, get, all, save, patch, audit, classes, className, roster, calCtx, findSession, sessionAttendance, sessionEvents, eventTypes, enrollmentsOf, isEnrolledOn } from '../store.js';
import { useStore, Icon, Btn, Empty, toast } from '../ui.js';
import { meetingsRange, isHeldStatus, TERM_LABEL } from '../calendar.js';
import { studyWeeks, weekOfDate, fmtH } from '../plan.js';
import { printHTML, weeklySheet, paperColumns } from '../print.js';
import { termRange, currentTerm } from '../calendar.js';
import { workspace } from '../store.js';
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
  // الفواصل تُتجاهل، إلا إن كان أحدها رمزاً معتمداً (مثل ✓ للإجابة الصحيحة)
  const used = new Set(codes.join(''));
  const s = [...normDigits(String(str || ''))].filter(ch => !(/\s/.test(ch) || (',،+.-✓'.includes(ch) && !used.has(ch)))).join('');
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

const sessOf = (classId, date, period) => (String(period).startsWith('m') ? get('sessions', String(period).slice(1)) : findSession(classId, date, +period));
const colLabel = m => m.label || `ح${m.period}`;
// ما سُجّل في خلية (حصة × طالب): حالة الحضور + الأحداث ذات الرموز (دون أحداث الحضور النظامية)
export function cellState(classId, date, period, sid) {
  const s = sessOf(classId, date, period); if (!s || s.deleted) return { s: null, att: null, evs: [], codes: '' };
  const a = sessionAttendance(s.id).get(sid);
  const att = a && ATT_SYS[a.status] ? a.status : null;
  const evs = sessionEvents(s.id).filter(e => e.student_id === sid).map(ev => ({ ev, t: get('event_types', ev.type_id) }))
    .filter(x => x.t?.code && !ATT_SYS[x.t.sys]);
  const parts = [];
  if (att) parts.push(eventTypes().find(t => t.sys === att)?.code || '');
  const cnt = new Map(); for (const x of evs) cnt.set(x.t.code, (cnt.get(x.t.code) || 0) + 1);
  for (const [c, n] of cnt) parts.push((n > 1 ? n : '') + c);
  return { s, att, evs, codes: parts.join(' ') };
}
// صيغة موحدة للمقارنة: «ص ص ن» = «2ص ن»
const canon = (str, map) => { const { items, bad } = parseCodes(str, map); const m = new Map(); for (const i of items) m.set(i.att ? '@' + i.att : i.code, (m.get(i.att ? '@' + i.att : i.code) || 0) + (i.att ? 0 : i.n)); return [...m.entries()].sort().map(([k, n]) => k + n).join('|') + (bad.length ? '!' : ''); };

// تظليل الصف والعمود: عند مرور الفأرة (خفيف) وللخلية النشطة (أوضح) حتى لا يُخطأ الطالب أو الحصة
const HL = { hover: null, focus: null };
function hlStyle() {
  let el = document.getElementById('paper-hl');
  if (!el) { el = document.createElement('style'); el.id = 'paper-hl'; document.head.appendChild(el); }
  const rule = (p, cls) => p ? `.paper-grid tbody tr:nth-child(${p.r}) > td { background-color: var(--${cls}-row); }
    .paper-grid tbody tr:nth-child(${p.r}) > td.pname { color: var(--primary-strong); font-weight: 800; }
    .paper-grid tbody tr > td:nth-child(${p.c}) { background-color: var(--${cls}-row); }
    .paper-grid thead tr:nth-child(2) > th:nth-child(${p.c - 2}) { background-color: var(--${cls}-head); }
    .paper-grid tbody tr:nth-child(${p.r}) > td:nth-child(${p.c}) { background-color: var(--${cls}-cell); }` : '';
  el.textContent = rule(HL.hover, 'hl') + rule(HL.focus, 'fc');
}
const cellPos = td => (td && td.closest('tbody') && td.cellIndex > 1 ? { r: td.parentElement.sectionRowIndex + 1, c: td.cellIndex + 1 } : null);
const gridHandlers = {
  onMouseOver: e => { const p = cellPos(e.target.closest('td')); if (JSON.stringify(p) !== JSON.stringify(HL.hover)) { HL.hover = p; hlStyle(); } },
  onMouseLeave: () => { HL.hover = null; hlStyle(); },
};
export const setFocusHL = el => { HL.focus = cellPos(el?.closest('td')); hlStyle(); };

export function PaperEntryPage({ q = {} }) {
  useStore();
  const today = todayISO();
  const cls = classes();
  const [cid, setCid] = useState(q.class || cls[0]?.id || '');
  const [from, setFrom] = useState(weekStart(q.from || addDays(today, -7)));
  const [weeks, setWeeks] = useState(+q.weeks || 1);
  const [vals, setVals] = useState({});
  const [focus, setFocus] = useState(null);
  const [mode, setMode] = useState(q.view ? 'view' : 'edit');
  const [span, setSpan] = useState('term');
  const pendingFocus = useRef(null);
  useEffect(() => { const k = pendingFocus.current; if (k && inputs.current[k]) { pendingFocus.current = null; inputs.current[k].focus(); inputs.current[k].scrollIntoView({ block: 'center', inline: 'center' }); } });
  const inputs = useRef({});
  const pageRef = useRef(null); const barRef = useRef(null);
  // ارتفاع شريط الرموز المثبّت ← ليملأ الجدول باقي الشاشة ويبقى رأسه ظاهراً
  useEffect(() => {
    const bar = barRef.current, pg = pageRef.current; if (!bar || !pg || !window.ResizeObserver) return;
    const ro = new ResizeObserver(() => pg.style.setProperty('--pbar', bar.offsetHeight + 'px'));
    ro.observe(bar); return () => ro.disconnect();
  }, [cls.length, mode]);
  if (!cls.length) return html`<div class="page"><${Empty} title="لا توجد فصول" /></div>`;
  const to = addDays(from, 7 * weeks - 1);
  const map = codeMap();
  const ms = paperColumns(cid, from, to);
  const rows = roster(cid, to, { includeLeft: true }).filter(x => enrollmentsOf(x.student.id).some(e => e.class_id === cid && e.start_date <= to && (!e.end_date || e.end_date >= from)));
  const key = (m, sid) => `${m.date}|${m.period}|${sid}`;
  const recCache = new Map();
  const recOf = k => { if (!recCache.has(k)) { const [date, period, sid] = k.split('|'); recCache.set(k, cellState(cid, date, period, sid).codes); } return recCache.get(k); };
  const valOf = k => (vals[k] ?? recOf(k));
  // الخلايا المعدّلة فقط (إضافة أو تعديل أو حذف ما سُجّل)
  const filled = Object.entries(vals).filter(([k, v]) => canon(v, map) !== canon(recOf(k), map));
  // لماذا الخلايا مظللة؟ (حصص لم تأتِ بعد، أو قبل تاريخ تسجيل الطالب)
  const heldPast = ms.filter(m => isHeldStatus(m.status) && m.date <= today);
  const future = ms.filter(m => isHeldStatus(m.status) && m.date > today).length;
  const nowRoster = roster(cid, today);
  const lateStart = nowRoster.map(x => enrollmentsOf(x.student.id).filter(e => e.class_id === cid).map(e => e.start_date).sort()[0]).filter(d => d && d > from);
  const lateDate = lateStart.length ? lateStart.sort()[lateStart.length - 1] : null;
  const errors = filled.filter(([, v]) => parseCodes(v, map).bad.length);
  const nDel = filled.filter(([k, v]) => !v.trim() && recOf(k)).length;
  const setV = (k, v) => setVals(o => ({ ...o, [k]: v }));
  const insert = code => {
    if (!focus) return toast('اختر خلية أولاً', 'warn');
    const cur = valOf(focus); setV(focus, cur + (cur && !cur.endsWith(' ') ? ' ' : '') + code);
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
    if (!filled.length) return toast('لا توجد تغييرات', 'warn');
    if (errors.length) return toast(`رموز غير معروفة في ${errors.length} خلية (ملوّنة بالأحمر)`, 'err');
    let nAdd = 0, nVoid = 0, nAtt = 0; const sess = new Set();
    for (const [k, v] of filled) {
      const [date, period, sid] = k.split('|');
      const items = parseCodes(v, map).items;
      const st = cellState(cid, date, period, sid);
      let s = st.s;
      if (!s) s = await save('sessions', { class_id: cid, date, period: +period, status: 'closed', manual: false, from_paper: true, exempt: [], started_at: null });
      sess.add(s.id);
      const wantAtt = [...items].reverse().find(i => i.att)?.att || null;
      if (wantAtt !== st.att) { await setAttendance(s, sid, wantAtt || 'present'); nAtt++; }
      const want = new Map(); for (const i of items) if (!i.att) want.set(i.t.id, (want.get(i.t.id) || 0) + i.n);
      const have = new Map(); for (const x of st.evs) { const a = have.get(x.t.id) || []; a.push(x.ev); have.set(x.t.id, a); }
      for (const tid of new Set([...want.keys(), ...have.keys()])) {
        const w = want.get(tid) || 0, h = have.get(tid) || [];
        for (let n = h.length; n < w; n++) { await addEvent(s, sid, tid, { from_paper: true }); nAdd++; }
        for (const ev of h.slice(w).reverse()) { await patch('events', ev.id, { voided: true, void_reason: 'تعديل من الكشف الورقي', voided_at: new Date().toISOString() }); nVoid++; }
      }
    }
    await audit('إدخال/تعديل من الكشف الورقي', `${className(get('classes', cid))}: أُضيف ${nAdd} حدث، وأُلغي ${nVoid}، و${nAtt} تعديل حضور في ${sess.size} حصة`);
    setVals({}); toast(`حُفظ: ${nAdd} إضافة${nVoid ? `، ${nVoid} حذف` : ''}${nAtt ? `، ${nAtt} حضور` : ''} في ${sess.size} حصة`, 'ok', 4500);
  };
  // تجميع بالأسبوع
  const wk = []; for (const m of ms) { const s0 = weekStart(m.date); let g = wk.find(x => x.s === s0); if (!g) wk.push(g = { s: s0, items: [] }); g.items.push(m); }
  const cols = wk.flatMap((g, gi) => g.items.map((m, i) => ({ ...m, first: i === 0, gi })));
  const W = workspace();
  const weeksOf = { 1: studyWeeks(W, 1), 2: studyWeeks(W, 2) };
  const allWeeks = [...weeksOf[1], ...weeksOf[2]];
  const curWk = allWeeks.find(x => x.from === from);
  const hd = iso => { const [, m, d] = fmtH(iso).split('/'); return `${+d}/${+m}`; };
  const wkLabel = x => `${x.n ? 'الأسبوع ' + x.n : 'إجازة' + (x.off?.label ? ': ' + x.off.label : '')} — ${fmtShort(x.start)}–${fmtShort(x.end)} | ${hd(x.start)}–${hd(x.end)}هـ`;
  const wkName = s0 => { const x = allWeeks.find(y => y.from === s0); return x ? (x.n ? `الأسبوع ${x.n}` : 'إجازة') : `أسبوع ${fmtShort(s0)}`; };
  const fParse = focus && vals[focus] ? parseCodes(vals[focus], map) : null;
  const focusLabel = (() => {
    if (!focus) return '';
    const [date, period, sid] = focus.split('|');
    const st = rows.find(x => x.student.id === sid)?.student; if (!st) return '';
    return `${st.full_name} — ${DAY_SHORT[dow(date)]} ${fmtShort(date)} ${String(period).startsWith("m") ? "حصة يدوية" : "ح" + period}`;
  })();
  return html`<div class="page paper-page" ref=${pageRef}>
    <div class="page-head"><a class="icon-btn" href="#/print"><${Icon} name="back" /></a><div><h1>الإدخال من الكشف الورقي</h1><div class="sub">اكتب الرموز كما في الكشف المطبوع؛ تتحول إلى أحداث بتاريخ الحصة الصحيح. مثال: «2ص ن» = إجابتان صحيحتان ونوم.</div></div>
      <div class="actions"><div class="chips"><button class=${'chip' + (mode === 'edit' ? ' on' : '')} onClick=${() => setMode('edit')}>إدخال وتعديل</button><button class=${'chip' + (mode === 'view' ? ' on' : '')} onClick=${() => { if (filled.length && !confirm('لديك تغييرات غير محفوظة ستبقى في الخانات. متابعة؟')) return; setMode('view'); }}>عرض الكشف كاملاً</button></div>
        ${mode === 'edit' ? html`<${Btn} cls="primary" disabled=${!filled.length} onClick=${doSave}><${Icon} name="check" /> حفظ ${filled.length ? `(${filled.length} خلية${nDel ? `، منها ${nDel} حذف` : ''})` : ''}</${Btn}>` : null}</div></div>
    ${mode === 'view' ? html`<${FullSheet} cid=${cid} setCid=${setCid} from=${from} weeks=${weeks} span=${span} setSpan=${setSpan} openCell=${(m, sid) => { setFrom(weekStart(m.date)); setWeeks(1); setMode('edit'); pendingFocus.current = `${m.date}|${m.period}|${sid}`; }} />` : html`
    ${ms.length && !heldPast.length && future ? html`<div class="notice" style="margin-bottom:12px">هذه الفترة لم تأتِ بعد، والإدخال متاح فقط للحصص التي انعقدت. اضغط «الأسبوع السابق».</div>` : null}
    ${heldPast.length && lateDate && lateStart.length >= nowRoster.length / 2 ? html`<div class="notice" style="margin-bottom:12px">أغلب الطلاب مسجلون في الفصل من ${fmtShort(lateDate)} فقط، فالخلايا قبل هذا التاريخ مظللة. إن كانوا معك من بداية الفصل الدراسي فعدّل التاريخ من <a href=${'#/class/' + cid}>صفحة الفصل ← «تاريخ التحاق الطلاب»</a>.</div>` : null}
    <div class="card" style="margin-bottom:12px"><div class="row">
      <select style="max-width:220px" value=${cid} onChange=${e => { setCid(e.target.value); setVals({}); }}>${cls.map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select>
      <label class="row small">الأسبوع <select class="wk-sel" value=${from} onChange=${e => { setFrom(e.target.value); setVals({}); }}>
        ${!curWk ? html`<option value=${from}>خارج الفصل الدراسي — ${fmtShort(from)}</option>` : null}
        ${[1, 2].map(t => { const list = weeksOf[t]; return list.length ? html`<optgroup label=${TERM_LABEL[t]}>${list.map(x => html`<option value=${x.from}>${wkLabel(x)}</option>`)}</optgroup>` : null; })}
      </select></label>
      <label class="row small muted">أو بالتاريخ <input type="date" style="width:150px" value=${from} onChange=${e => { if (e.target.value) { setFrom(weekStart(e.target.value)); setVals({}); } }} /></label>
      <button class="btn sm" onClick=${() => { setFrom(addDays(from, -7)); setVals({}); }}>الأسبوع السابق</button><button class="btn sm" onClick=${() => { setFrom(addDays(from, 7)); setVals({}); }}>التالي</button>
      <label class="row small">عدد الأسابيع <select style="width:80px" value=${weeks} onChange=${e => setWeeks(+e.target.value)}>${[1, 2, 3, 4].map(n => html`<option value=${n}>${n}</option>`)}</select></label></div>
      <p class="muted small" style="margin:8px 0 0">كل خلية تعرض ما سُجّل فيها؛ عدّله أو امسحه أو أضف إليه ثم احفظ (الأخضر = معدّل، الأحمر المتقطع = سيُحذف). الخلايا المظللة: إجازة أو حصة ملغاة أو طالب غير مسجل أو تاريخ لاحق. Enter ينقلك للطالب التالي.</p>
    </div>
    <div class="paper-bar" ref=${barRef}>
      <div class="chips paper-chips">${[...map.entries()].map(([c, x]) => html`<button class=${'chip'} onMouseDown=${e => e.preventDefault()} onClick=${() => insert(c)} title=${x.t.name}><b>${c}</b> ${x.t.name}</button>`)}</div>
      <div class="paper-status">
        <div class=${'small ' + (fParse?.bad.length ? 'error' : 'info')}>${focusLabel ? html`<b>${focusLabel}</b>: ` : null}${fParse ? html`${fParse.items.map(i => `${i.n > 1 ? i.n + '× ' : ''}${i.t.name}`).join('، ') || '—'}${fParse.bad.length ? ` — غير معروف: ${fParse.bad.join(' ')}` : ''}` : focusLabel ? '—' : 'اختر خلية ثم اكتب الرمز أو اضغطه من الأعلى'}</div>
        ${focus && focus in vals && canon(vals[focus], map) !== canon(recOf(focus), map) ? html`<button class="btn sm ghost" onMouseDown=${e => e.preventDefault()} onClick=${() => { setVals(o => { const n = { ...o }; delete n[focus]; return n; }); }} title=${'المسجّل: ' + (recOf(focus) || 'فارغ')}>↶ تراجع عن الخلية</button>` : null}
        <${Btn} cls="primary sm" disabled=${!filled.length} onClick=${doSave}><${Icon} name="check" /> حفظ ${filled.length ? `(${filled.length})` : ''}</${Btn}>
      </div>
    </div>
    ${!cols.length ? html`<div class="card"><${Empty} icon="calendar" title="لا توجد حصص لهذا الفصل في هذه الفترة">${timetables()[0] && timetables()[0].effective_from > from ? html`<span>الجدول الأسبوعي ساري من ${fmtShort(timetables()[0].effective_from)} فقط، فلا تظهر حصص قبله. عدّل تاريخه من <a href="#/settings/timetable">الإعدادات ← الجدول ← «تعديل تاريخ السريان»</a> إلى بداية الفصل الدراسي.</span>` : !timetables().length ? html`<span>لم يُضبط الجدول الأسبوعي بعد. <a href="#/settings/timetable">اضبطه من الإعدادات</a>.</span>` : html`<span>تحقق من أن الأسبوع داخل تواريخ الفصل الدراسي، ومن أن الفصل له حصص في الجدول.</span>`}</${Empty}></div>` : html`
    <div class="table-wrap paper-wrap" ...${gridHandlers}><table class="tbl paper-grid">
      <thead><tr><th rowspan="2">م</th><th rowspan="2" class="pname">الطالب</th>${wk.map((g, i) => html`<th colspan=${g.items.length} class="wk-h">${wkName(g.s)} <span class="wk-d">${fmtShort(g.s)} | ${hd(g.s)}هـ</span></th>`)}</tr>
        <tr>${cols.map(m => html`<th class=${'num' + (m.first ? ' wk-sep' : '') + (isHeldStatus(m.status) ? '' : ' shaded')}>${DAY_SHORT[dow(m.date)]}<br />${fmtShort(m.date)}<br /><span class="hj">${hd(m.date)}هـ</span><br />${colLabel(m)}</th>`)}</tr></thead>
      <tbody>${rows.map((x, ri) => html`<tr><td class="num">${x.student.seat_no || ri + 1}</td><td class="pname">${x.student.full_name}</td>
        ${cols.map(m => {
          const enr = enrollmentsOf(x.student.id).some(e => e.class_id === cid && isEnrolledOn(e, m.date));
          const ok = enr && isHeldStatus(m.status) && m.date <= today;
          const k = key(m, x.student.id);
          const rec = ok ? recOf(k) : ''; const v = ok ? valOf(k) : '';
          const changed = k in vals && canon(v, map) !== canon(rec, map);
          const bad = v && parseCodes(v, map).bad.length;
          return html`<td class=${'pcell' + (m.first ? ' wk-sep' : '') + (ok ? '' : ' shaded')}>${ok ? html`<input class=${bad ? 'bad' : changed && !v.trim() ? 'del' : changed ? 'good' : rec ? 'has' : ''} value=${v} ref=${el => { inputs.current[k] = el; }} title=${changed && rec ? 'كان: ' + rec : ''}
            onFocus=${e => { setFocus(k); setFocusHL(e.target); }} onBlur=${() => setFocusHL(null)} onInput=${e => setV(k, autocomplete(e.target.value, map))}
            onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); move(k, e.shiftKey ? -1 : 1); } }} />` : null}</td>`;
        })}</tr>`)}</tbody></table></div>`}
    `}
  </div>`;
}

// ---------- عرض الكشف كاملاً (للقراءة والطباعة) ----------
function FullSheet({ cid, setCid, from, weeks, span, setSpan, openCell }) {
  const W = workspace(); const today = todayISO(); const map = codeMap();
  const cls = classes();
  const t = span === 'weeks' ? null : +span || currentTerm(W, today);
  const r = t ? termRange(W, t) : null;
  const a = r ? r.start : from, b = r ? r.end : addDays(from, 7 * weeks - 1);
  const ms = paperColumns(cid, a, b);
  const rows = roster(cid, b, { includeLeft: true }).filter(x => enrollmentsOf(x.student.id).some(e => e.class_id === cid && e.start_date <= b && (!e.end_date || e.end_date >= a)));
  const allW = [...studyWeeks(W, 1), ...studyWeeks(W, 2)];
  const hd = iso => { const [, mm, d] = fmtH(iso).split('/'); return `${+d}/${+mm}`; };
  const wk = []; for (const m of ms) { const s0 = weekStart(m.date); let g = wk.find(x => x.s === s0); if (!g) wk.push(g = { s: s0, items: [] }); g.items.push(m); }
  const cols = wk.flatMap(g => g.items.map((m, i) => ({ ...m, first: i === 0 })));
  const posT = new Set(eventTypes().filter(x => x.valence === 'pos').map(x => x.id)), negT = new Set(eventTypes().filter(x => x.valence === 'neg' && !ATT_SYS[x.sys]).map(x => x.id));
  const doPrint = () => { const h = weeklySheet({ classId: cid, from: a, to: b, prefill: true, extraRows: 0 }); if (!h) return toast('لا توجد حصص في هذه الفترة', 'warn'); printHTML(h, { landscape: true }); };
  return html`<div class="card" style="margin-bottom:12px"><div class="row">
      <select style="max-width:220px" value=${cid} onChange=${e => setCid(e.target.value)}>${cls.map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select>
      <div class="chips"><button class=${'chip' + (span === 'term' ? ' on' : '')} onClick=${() => setSpan('term')}>الفصل الدراسي الحالي</button>
        ${[1, 2].map(x => html`<button class=${'chip' + (span === String(x) ? ' on' : '')} onClick=${() => setSpan(String(x))}>${TERM_LABEL[x]}</button>`)}
        <button class=${'chip' + (span === 'weeks' ? ' on' : '')} onClick=${() => setSpan('weeks')}>الأسابيع المختارة في الإدخال</button></div>
      <span class="grow"></span>
      <${Btn} cls="primary" onClick=${doPrint}><${Icon} name="print" /> طباعة الكشف</${Btn}></div>
      <p class="muted small" style="margin:8px 0 0">${fmtShort(a)} — ${fmtShort(b)} • ${cols.filter(m => isHeldStatus(m.status)).length} حصة • اضغط أي خلية لتعديلها. الطباعة A4 أفقي بنفس شكل الكشف الورقي مع ما سُجّل.</p></div>
    ${!cols.length ? html`<div class="card"><${Empty} icon="calendar" title="لا توجد حصص في هذه الفترة" /></div>` : html`
    <div class="table-wrap paper-wrap full-wrap" ...${gridHandlers}><table class="tbl paper-grid full-grid">
      <thead><tr><th rowspan="2">م</th><th rowspan="2" class="pname">الطالب</th>${wk.map(g => { const x = allW.find(y => y.from === g.s); return html`<th colspan=${g.items.length} class="wk-h">${x?.n ? 'أسبوع ' + x.n : fmtShort(g.s)}</th>`; })}<th rowspan="2" class="sum">غياب</th><th rowspan="2" class="sum">تأخر</th><th rowspan="2" class="sum">إيجابي</th><th rowspan="2" class="sum">سلبي</th></tr>
        <tr>${cols.map(m => html`<th class=${'num' + (m.first ? ' wk-sep' : '') + (isHeldStatus(m.status) ? '' : ' shaded')} title=${`${DAY_SHORT[dow(m.date)]} ${fmtShort(m.date)} (${hd(m.date)}هـ) ${colLabel(m)}`}>${DAY_SHORT[dow(m.date)].slice(0, 2)}<br />${fmtShort(m.date)}<br /><span class="hj">${hd(m.date)}</span>${m.manual ? html`<br /><span class="hj">${colLabel(m)}</span>` : null}</th>`)}</tr></thead>
      <tbody>${rows.map((x, ri) => { const sid = x.student.id; let ab = 0, la = 0, po = 0, ne = 0;
        const tds = cols.map(m => {
          const enr = enrollmentsOf(sid).some(e => e.class_id === cid && isEnrolledOn(e, m.date));
          const ok = enr && isHeldStatus(m.status) && m.date <= today;
          if (!ok) return html`<td class=${'fcell shaded' + (m.first ? ' wk-sep' : '')}></td>`;
          const st = cellState(cid, m.date, m.period, sid);
          if (st.att === 'late') la++; else if (st.att) ab++;
          for (const y of st.evs) { if (posT.has(y.t.id)) po++; else if (negT.has(y.t.id)) ne++; }
          return html`<td class=${'fcell' + (m.first ? ' wk-sep' : '') + (st.att && st.att !== 'late' ? ' ab' : '')} onClick=${() => openCell(m, sid)}>${st.codes}</td>`;
        });
        return html`<tr><td class="num">${x.student.seat_no || ri + 1}</td><td class="pname">${x.student.full_name}</td>${tds}<td class="sum">${ab || ''}</td><td class="sum">${la || ''}</td><td class="sum pos">${po || ''}</td><td class="sum neg">${ne || ''}</td></tr>`; })}</tbody></table></div>`}
    <p class="muted small">مفتاح الرموز: ${[...map.entries()].map(([c, y]) => `${c} ${y.t.name}`).join(' • ')}</p>`;
}
