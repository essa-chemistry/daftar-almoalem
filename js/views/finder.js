// البحث السريع عن طالب في كل الفصول: اكتب جزءاً من الاسم (أو رقم المقعد) ويظهر فصله ومعلوماته
import { html, useState, useEffect, useRef } from '../lib.js';
import { ws, all, get, workspace, classOf, lastClassOf, className, privateOf, enrollmentsOf } from '../store.js';
import { useStore, Icon, Avatar, openModal, ModalHead, go } from '../ui.js';
import { gradeStudent } from '../gradeutil.js';
import { currentTerm, termRange, TERM_LABEL } from '../calendar.js';
import { todayISO, normAr, normDigits, fmtShort } from '../utils.js';

const SKIP = new Set(['بن', 'ابن', 'بنت', 'ال']);
const tokens = q => normAr(normDigits(q)).split(/\s+/).filter(t => t && !SKIP.has(t));
const fmtN = n => (n == null ? '—' : String(Math.round(n * 100) / 100));

export function findStudents(q, { includeLeft = true } = {}) {
  const ts = tokens(q); if (!ts.length) return [];
  const out = [];
  for (const st of ws('students')) {
    const name = normAr(st.full_name || ''); const words = name.split(/\s+/);
    const num = ts.length === 1 && /^\d+$/.test(ts[0]) && String(st.seat_no) === ts[0];
    if (!num && !ts.every(t => name.includes(t))) continue;
    const c = classOf(st.id) || (includeLeft ? lastClassOf(st.id) : null);
    if (!c && !includeLeft) continue;
    // الترتيب: تطابق أول الاسم، ثم بداية كلمة، ثم أي موضع
    const score = (words[0]?.startsWith(ts[0]) ? 0 : 2) + (ts.every(t => words.some(w => w.startsWith(t))) ? 0 : 1) + (classOf(st.id) ? 0 : 3);
    out.push({ st, c, active: !!classOf(st.id), score });
  }
  return out.sort((a, b) => a.score - b.score || String(a.st.full_name).localeCompare(String(b.st.full_name), 'ar')).slice(0, 30);
}

// ملخص الطالب في الفصل الدراسي الحالي
function summary(st, c) {
  const w = workspace(); const today = todayISO(); const term = currentTerm(w, today) || 1; const r = termRange(w, term);
  const inT = d => !r || (d >= r.start && d <= r.end);
  const att = all('attendance', a => a.student_id === st.id && inT(a.date));
  const types = new Map(ws('event_types').map(t => [t.id, t]));
  const evs = all('events', e => e.student_id === st.id && !e.voided && inT(e.date));
  let g = null; try { g = c ? gradeStudent(st.id, c.id, term) : null; } catch { g = null; }
  const notes = all('notes', n => n.student_id === st.id && !n.deleted);
  return {
    term, absent: att.filter(a => a.status === 'absent_unexcused').length, excused: att.filter(a => a.status === 'absent_excused').length, late: att.filter(a => a.status === 'late').length,
    pos: evs.filter(e => types.get(e.type_id)?.valence === 'pos').length, neg: evs.filter(e => types.get(e.type_id)?.valence === 'neg' && !types.get(e.type_id)?.sys?.startsWith?.('absent') && types.get(e.type_id)?.sys !== 'late').length,
    g, notes: notes.length, lastNote: notes.sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] || null,
    refs: ws('referrals', x => x.student_id === st.id && x.status !== 'resolved').length,
  };
}

function Finder({ close, initial = '' }) {
  useStore();
  const [q, setQ] = useState(initial); const [sel, setSel] = useState(0);
  const inp = useRef(null);
  useEffect(() => { setTimeout(() => inp.current?.focus(), 30); }, []);
  const res = findStudents(q);
  const cur = res[Math.min(sel, res.length - 1)];
  const open = (x, path = '') => { close(); go(`#/student/${x.st.id}${path}`); };
  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, res.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter' && cur) { e.preventDefault(); open(cur); }
  };
  const s = cur ? summary(cur.st, cur.c) : null; const pv = cur ? privateOf(cur.st.id) : null;
  return html`<${ModalHead} title="البحث عن طالب" close=${close} />
    <div class="modal-body finder">
      <div class="search big"><${Icon} name="search" size=${20} /><input ref=${inp} value=${q} placeholder="اكتب جزءاً من الاسم، مثل: حسين الدويل — أو رقم المقعد" onInput=${e => { setQ(e.target.value); setSel(0); }} onKeyDown=${onKey} /></div>
      ${!q.trim() ? html`<p class="muted small" style="margin:10px 2px">يبحث في كل الفصول، ويكفي جزء من الاسم الأول والعائلة. الأسهم ↑↓ للتنقل و Enter لفتح ملف الطالب.</p>`
      : !res.length ? html`<p class="muted" style="margin:16px 2px">لا يوجد طالب بهذا الاسم.</p>`
      : html`<div class="finder-grid">
        <div class="finder-list">${res.map((x, i) => html`<button class=${'f-item' + (x === cur ? ' on' : '')} onMouseEnter=${() => setSel(i)} onClick=${() => open(x)}>
            <span class="f-nm">${x.st.full_name}</span><span class=${'badge ' + (x.active ? 'pri' : '')}>${x.c ? className(x.c) : 'بلا فصل'}${x.active ? '' : ' (سابقاً)'}</span></button>`)}</div>
        ${cur ? html`<div class="finder-card">
          <div class="row" style="gap:12px;align-items:center"><${Avatar} student=${cur.st} size=${56} health=${true} /><div><h3 style="margin:0">${cur.st.full_name}</h3>
            <div class="muted small">${cur.c ? className(cur.c) : 'غير مسجل في فصل'}${cur.st.seat_no ? ' • رقم ' + cur.st.seat_no : ''}${cur.active ? '' : ' • منسحب/منقول'}</div></div></div>
          <div class="f-stats">
            <div><b class="neg">${s.absent}</b><span>غياب</span></div><div><b>${s.excused}</b><span>بعذر</span></div><div><b class="warn">${s.late}</b><span>تأخر</span></div>
            <div><b class="pos">${s.pos}</b><span>إيجابي</span></div><div><b class="neg">${s.neg}</b><span>سلبي</span></div>
            <div><b class="pri">${s.g ? fmtN(s.g.total) : '—'}</b><span>الأدائية /${s.g ? s.g.categories.reduce((a, c) => a + (+c.weight || 0), 0) : 40}</span></div>
          </div>
          <div class="muted small">إحصاءات ${TERM_LABEL[s.term]}${s.g?.monthly?.final != null ? ` • اختبارات الفترة ${fmtN(s.g.monthly.final)} من ${s.g.monthly.weight}` : ''}</div>
          ${cur.st.guardian_phone ? html`<div class="small">جوال ولي الأمر: <a class="ltr" href=${'tel:' + cur.st.guardian_phone}>${cur.st.guardian_phone}</a></div>` : null}
          ${(pv.tags || []).length || (pv.health || []).length ? html`<div class="chips">${(pv.health || []).map(h => html`<span class="chip" style="background:var(--neg);color:#fff">${h}</span>`)}${(pv.tags || []).map(t => html`<span class="chip on">${t}</span>`)}</div>` : null}
          ${s.lastNote ? html`<div class="small"><span class="muted">آخر ملاحظة (${fmtShort(s.lastNote.date)}):</span> ${s.lastNote.text}${s.notes > 1 ? html` <span class="muted">(+${s.notes - 1})</span>` : null}</div>` : null}
          ${s.refs ? html`<div class="notice small">${s.refs} إحالة مفتوحة</div>` : null}
          <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">
            <button class="btn primary sm" onClick=${() => open(cur)}><${Icon} name="users" size=${15} /> ملف الطالب</button>
            ${cur.c ? html`<button class="btn sm" onClick=${() => { close(); go(`#/grade/${cur.c.id}/${s.term}/${cur.st.id}`); }}><${Icon} name="grades" size=${15} /> شرح الدرجة</button>
            <button class="btn sm" onClick=${() => { close(); go(`#/class/${cur.c.id}`); }}>فتح الفصل</button>` : null}
            <button class="btn sm ghost" onClick=${() => open(cur, '?tab=notes')}>الملاحظات</button>
          </div></div>` : null}
      </div>`}
    </div>`;
}

export const openFinder = (initial = '') => openModal(close => html`<${Finder} close=${close} initial=${initial} />`, { size: 'lg' });

// اختصار: «/» أو Ctrl+K من أي صفحة (خارج خانات الكتابة)
let bound = false;
export function bindFinderKeys() {
  if (bound) return; bound = true;
  addEventListener('keydown', e => {
    const t = e.target; const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); if (!document.querySelector('.modal .finder')) openFinder(); }
  });
}
