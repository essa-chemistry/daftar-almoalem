// المرحلة 3 — خريطة المقاعد: محرر بالسحب أو باللمس، ترتيب تلقائي، طباعة، وعرض في شاشة الحصة
import { html, useState } from '../lib.js';
import { get, patch, roster, className, workspace } from '../store.js';
import { useStore, Icon, Btn, Avatar, toast, confirmDialog } from '../ui.js';
import { printHTML, header } from '../print.js';
import { todayISO, shortName, randFloat, escapeHTML as e, colorFor, initial } from '../utils.js';

export const seatMapOf = c => c?.seat_map && c.seat_map.rows ? c.seat_map : null;
const key = (r, c) => `${r}-${c}`;

export function arrange(list, rows, cols, how, keepAisles = {}) {
  let order = [...list];
  if (how === 'alpha') order.sort((a, b) => a.student.full_name.localeCompare(b.student.full_name, 'ar'));
  else if (how === 'random') for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(randFloat() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  else order.sort((a, b) => (+a.student.seat_no || 999) - (+b.student.seat_no || 999));
  const cells = {}; let i = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = key(r, c);
    if (keepAisles[k] === 'x') { cells[k] = 'x'; continue; }
    if (i < order.length) cells[k] = order[i++].student.id;
  }
  return cells;
}

export function SeatEditor({ c }) {
  useStore();
  const list = roster(c.id, todayISO());
  const map = seatMapOf(c) || { rows: Math.ceil(Math.max(1, list.length) / 6), cols: 6, cells: {} };
  const [sel, setSel] = useState(null); // { id, from }
  const [aisleMode, setAisleMode] = useState(false);
  const ids = new Set(list.map(x => x.student.id));
  const cells = Object.fromEntries(Object.entries(map.cells || {}).filter(([, v]) => v === 'x' || ids.has(v)));
  const seated = new Set(Object.values(cells));
  const tray = list.filter(x => !seated.has(x.student.id));
  const saveMap = m => patch('classes', c.id, { seat_map: m });
  const place = (id, toKey, fromKey) => {
    const next = { ...cells };
    const occupant = next[toKey];
    if (occupant === 'x') return toast('هذا ممر — ألغِ وضع الممر أولاً', 'warn');
    if (fromKey) { if (occupant) next[fromKey] = occupant; else delete next[fromKey]; }
    else if (occupant) { /* القادم من القائمة يُخرج صاحب المقعد إلى القائمة */ }
    for (const [k, v] of Object.entries(next)) if (v === id && k !== toKey) delete next[k];
    next[toKey] = id;
    saveMap({ ...map, cells: next }); setSel(null);
  };
  const tapCell = (k) => {
    if (aisleMode) { const next = { ...cells }; if (next[k] === 'x') delete next[k]; else if (!next[k]) next[k] = 'x'; else return toast('أفرغ المقعد أولاً', 'warn'); return saveMap({ ...map, cells: next }); }
    const v = cells[k];
    if (sel) { if (sel.from === k) return setSel(null); return place(sel.id, k, sel.from); }
    if (v && v !== 'x') setSel({ id: v, from: k });
  };
  const resize = (rows, cols) => saveMap({ ...map, rows: Math.max(1, Math.min(12, rows)), cols: Math.max(1, Math.min(12, cols)), cells: Object.fromEntries(Object.entries(cells).filter(([k]) => { const [r, cc] = k.split('-').map(Number); return r < rows && cc < cols; })) });
  const auto = async how => {
    if (seated.size && !await confirmDialog({ title: 'ترتيب تلقائي', message: 'سيُعاد توزيع كل الطلاب على المقاعد (تبقى الممرات).', okText: 'ترتيب' })) return;
    const aisles = Object.fromEntries(Object.entries(cells).filter(([, v]) => v === 'x'));
    const free = map.rows * map.cols - Object.keys(aisles).length;
    let rows = map.rows; if (free < list.length) rows = Math.ceil((list.length + Object.keys(aisles).length) / map.cols);
    saveMap({ ...map, rows, cells: arrange(list, rows, map.cols, how, aisles) });
  };
  const onDrop = (ev, k) => { ev.preventDefault(); const d = JSON.parse(ev.dataTransfer.getData('text/plain') || '{}'); if (d.id) place(d.id, k, d.from || null); };
  const drag = (id, from) => ({ draggable: true, onDragStart: ev => ev.dataTransfer.setData('text/plain', JSON.stringify({ id, from })) });
  return html`<div class="card stack">
    <div class="row">
      <label class="row small">صفوف <input type="number" min="1" max="12" style="width:70px" value=${map.rows} onChange=${ev => resize(+ev.target.value, map.cols)} /></label>
      <label class="row small">أعمدة <input type="number" min="1" max="12" style="width:70px" value=${map.cols} onChange=${ev => resize(map.rows, +ev.target.value)} /></label>
      <button class=${'btn sm ' + (aisleMode ? 'deep' : '')} onClick=${() => { setAisleMode(!aisleMode); setSel(null); }}>${aisleMode ? 'إنهاء تحديد الممرات' : 'تحديد ممر/مقعد معطل'}</button>
      <span class="grow"></span>
      <button class="btn sm" onClick=${() => auto('seat')}>ترتيب بالرقم</button><button class="btn sm" onClick=${() => auto('alpha')}>أبجدي</button><button class="btn sm" onClick=${() => auto('random')}>عشوائي</button>
      <button class="btn sm ghost" onClick=${() => saveMap({ ...map, cells: Object.fromEntries(Object.entries(cells).filter(([, v]) => v === 'x')) })}>إفراغ</button>
      <button class="btn sm" onClick=${() => printHTML(seatPrint(c), { landscape: true })}><${Icon} name="print" size=${16} /> طباعة</button></div>
    <p class="muted small" style="margin:0">${aisleMode ? 'اضغط خانة فارغة لجعلها ممراً، واضغطها مجدداً لإلغائه.' : sel ? `اختر مقعداً لـ ${shortName(get('students', sel.id)?.full_name)} (يُبدَّل مع صاحبه إن وُجد).` : 'اسحب الطالب إلى مقعد، أو المسه ثم المس المقعد.'}</p>
    <div class="seat-board">السبورة</div>
    <div class="seat-grid" style=${`grid-template-columns:repeat(${map.cols},minmax(0,1fr))`}>
      ${Array.from({ length: map.rows * map.cols }, (_, i) => { const r = Math.floor(i / map.cols), cc = i % map.cols, k = key(r, cc), v = cells[k]; const st = v && v !== 'x' ? get('students', v) : null;
        return html`<div class=${'seatcell' + (v === 'x' ? ' aisle' : '') + (st ? ' taken' : '') + (sel?.from === k ? ' sel' : '')} onClick=${() => tapCell(k)} onDragOver=${ev => ev.preventDefault()} onDrop=${ev => onDrop(ev, k)} ...${st ? drag(st.id, k) : {}}>
          ${st ? html`<${Avatar} student=${st} size=${40} /><span class="nm">${shortName(st.full_name)}</span>` : v === 'x' ? html`<span class="muted small">ممر</span>` : html`<span class="muted small">فارغ</span>`}</div>`; })}
    </div>
    ${tray.length ? html`<div><div class="section-title">بلا مقعد (${tray.length})</div><div class="chips">${tray.map(x => html`<button class=${'chip' + (sel?.id === x.student.id ? ' on' : '')} ...${drag(x.student.id, null)} onClick=${() => setSel(sel?.id === x.student.id ? null : { id: x.student.id, from: null })}>${shortName(x.student.full_name)}</button>`)}</div></div>` : null}
  </div>`;
}

// شبكة المقاعد داخل شاشة الحصة (تعرض البطاقات في أماكنها)
export function SeatGrid({ c, list, renderTile }) {
  const map = seatMapOf(c);
  const byId = new Map(list.map(x => [x.student.id, x]));
  const placed = new Set();
  const cellsEls = Array.from({ length: map.rows * map.cols }, (_, i) => {
    const k = key(Math.floor(i / map.cols), i % map.cols); const v = map.cells?.[k]; const x = v && v !== 'x' ? byId.get(v) : null;
    if (x) placed.add(x.student.id);
    return x ? html`<div key=${k}>${renderTile(x)}</div>` : html`<div key=${k} class=${'seat-empty' + (v === 'x' ? ' aisle' : '')}></div>`;
  });
  const rest = list.filter(x => !placed.has(x.student.id));
  return html`<div><div class="seat-board">السبورة</div>
    <div class="seat-grid live" style=${`grid-template-columns:repeat(${map.cols},minmax(0,1fr))`}>${cellsEls}</div>
    ${rest.length ? html`<div class="section-title" style="margin-top:12px">بلا مقعد</div><div class="sgrid">${rest.map(x => renderTile(x))}</div>` : null}</div>`;
}

export function seatPrint(c) {
  const map = seatMapOf(c); if (!map) return '<p>لا توجد خريطة مقاعد</p>';
  const cells = Array.from({ length: map.rows * map.cols }, (_, i) => {
    const v = map.cells?.[key(Math.floor(i / map.cols), i % map.cols)];
    if (v === 'x') return '<div class="sp aisle"></div>';
    const st = v ? get('students', v) : null; if (!st) return '<div class="sp"></div>';
    const ph = get('student_photos', st.id)?.status === 'approved' ? get('student_photos', st.id).data : null;
    return `<div class="sp">${ph ? `<img src="${ph}" alt="">` : `<span style="display:inline-grid;place-items:center;width:13mm;height:13mm;border-radius:50%;background:${colorFor(st.id)};color:#fff;font-weight:800">${e(initial(st.full_name))}</span>`}<b>${e(st.full_name)}</b>${st.seat_no ? `<span>رقم ${e(st.seat_no)}</span>` : ''}</div>`;
  }).join('');
  return `<section class="pr-page">${header('خريطة المقاعد', [['الفصل', className(c)], ['المادة', workspace()?.identity?.subject]])}
    <div class="seat-board">السبورة</div><div class="seat-print" style="grid-template-columns:repeat(${map.cols},1fr)">${cells}</div></section>`;
}
export { Btn };
