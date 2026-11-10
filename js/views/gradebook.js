// دفتر الدرجات: جدول (الطلاب × المهام) لإدخال درجات الواجبات والاختبارات القصيرة واختبارات الفترة
// تعبئة عمود كامل من رأسه، استيراد/تصدير Excel، وتظهر الدرجة المحتسبة في الحساب النهائي بجانب كل طالب
import { html, useState, useRef, useEffect } from '../lib.js';
import { ws, get, all, save, saveMany, patch, purge, audit, classes, className, roster, enrollmentsOf, isEnrolledOn, workspace } from '../store.js';
import { useStore, Icon, Btn, Empty, toast, formDialog, openModal, ModalHead, confirmDialog, go } from '../ui.js';
import { TASK_KINDS, HW_STATUS, METHODS, taskMode, defaultScheme } from '../grading.js';
import { gradeStudent, schemeFor } from '../gradeutil.js';
import { termRange, currentTerm, TERM_LABEL } from '../calendar.js';
import { fmtH } from '../plan.js';
import { printHTML, header } from '../print.js';
import { taskDialog } from './tasks.js';
import { todayISO, fmtShort, normDigits, normAr, getXLSX, escapeHTML as e } from '../utils.js';

export const GROUPS = {
  all: { label: 'الكل', kinds: null },
  homework: { label: 'الواجبات', kinds: ['homework'] },
  quiz: { label: 'الاختبارات القصيرة', kinds: ['quiz'] },
  lab: { label: 'أوراق العمل والمهام والمشاريع', kinds: ['worksheet', 'performance', 'project'] },
  monthly: { label: 'اختبارات الفترة (الشهرية)', kinds: ['monthly'] },
};
const EXCUSED = ['ع', 'عذر', 'معذور', 'excused'];
const fmtN = n => (n == null || n === '' ? '' : String(Math.round(+n * 100) / 100));
const stripMax = t => normDigits(String(t)).replace(/\s*[(（]?\s*(?:من|\/)\s*\d+(?:\.\d+)?\s*[)）]?\s*$/, '').trim() || String(t);
const hd = iso => { const [, m, d] = fmtH(iso).split('/'); return `${+d}/${+m}`; };

// قراءة قيمة خلية (من الإدخال أو من Excel) إلى نتيجة
export function parseCell(raw, t) {
  const s = normDigits(String(raw ?? '')).trim();
  if (s === '') return { clear: true };
  const n = normAr(s);
  if (EXCUSED.some(x => n === normAr(x))) return { status: 'excused', score: null };
  if (taskMode(t) === 'status') {
    const hit = Object.entries(HW_STATUS).find(([k, v]) => n === normAr(v) || n === k);
    if (hit) return { status: hit[0], score: null };
    const num = +s; if (!isNaN(num)) { const max = +t.max_score || 1; return { status: num >= max ? 'done' : num <= 0 ? 'none' : 'partial', score: null }; }
    return { error: `«${s}» ليست حالة معروفة (${Object.values(HW_STATUS).join('، ')})` };
  }
  const num = +s.replace('٫', '.').replace(',', '.');
  if (isNaN(num)) return { error: `«${s}» ليست درجة` };
  if (num < 0 || num > +t.max_score) return { error: `${s} خارج المدى 0–${t.max_score}` };
  return { score: num, status: null };
}
const cellText = (r, t) => !r ? '' : r.status === 'excused' ? 'ع' : taskMode(t) === 'status' ? (r.status ? HW_STATUS[r.status] : '') : fmtN(r.score);

// تظليل صف الطالب وعمود المهمة (مرور الفأرة خفيف، والخلية النشطة أوضح)
const HL = { hover: null, focus: null };
function hlStyle() {
  let el = document.getElementById('gb-hl');
  if (!el) { el = document.createElement('style'); el.id = 'gb-hl'; document.head.appendChild(el); }
  const rule = (p, cls) => p ? `.gb-grid tbody tr:nth-child(${p.r}) > td { background-color: var(--${cls}-row); }
    .gb-grid tbody tr:nth-child(${p.r}) > td.pname { color: var(--primary-strong); font-weight: 800; }
    .gb-grid tbody tr > td:nth-child(${p.c}) { background-color: var(--${cls}-row); }
    .gb-grid thead tr > th:nth-child(${p.c}) { background-color: var(--${cls}-head); }
    .gb-grid tbody tr:nth-child(${p.r}) > td:nth-child(${p.c}) { background-color: var(--${cls}-cell); }` : '';
  el.textContent = rule(HL.hover, 'hl') + rule(HL.focus, 'fc');
}
const cellPos = td => (td && td.closest('tbody') && td.cellIndex > 1 ? { r: td.parentElement.sectionRowIndex + 1, c: td.cellIndex + 1 } : null);
const gridHandlers = {
  onMouseOver: ev => { const p = cellPos(ev.target.closest('td')); if (JSON.stringify(p) !== JSON.stringify(HL.hover)) { HL.hover = p; hlStyle(); } },
  onMouseLeave: () => { HL.hover = null; hlStyle(); },
};
const setFocusHL = el => { HL.focus = cellPos(el?.closest('td')); hlStyle(); };

// ---------- البيانات ----------
function sheetData(cid, term, group) {
  const w = workspace(); const r = termRange(w, term);
  if (!r) return { r: null, tasks: [], rows: [], res: new Map() };
  const kinds = GROUPS[group]?.kinds;
  const tasks = ws('tasks', t => !t.deleted && (t.class_ids || []).includes(cid) && t.date >= r.start && t.date <= r.end && (!kinds || kinds.includes(t.kind)) && t.kind !== 'final')
    .sort((a, b) => a.date.localeCompare(b.date) || (a.makeup_of ? 1 : 0) - (b.makeup_of ? 1 : 0) || (a.created_at || '').localeCompare(b.created_at || ''));
  const end = r.end < todayISO() ? r.end : todayISO();
  const rows = roster(cid, end, { includeLeft: true }).filter(x => enrollmentsOf(x.student.id).some(en => en.class_id === cid && en.start_date <= r.end && (!en.end_date || en.end_date >= r.start)));
  const ids = new Set(tasks.map(t => t.id));
  const res = new Map(all('task_results', x => ids.has(x.task_id) && !x.deleted).map(x => [`${x.task_id}|${x.student_id}`, x]));
  return { r, tasks, rows, res };
}
// أعمدة الدرجة المحتسبة المرتبطة بالمجموعة المعروضة
function summaryCols(group, cid, term) {
  const sc = schemeFor(get('classes', cid)?.grade, term) || defaultScheme();
  const kinds = GROUPS[group]?.kinds;
  const cats = (sc.categories || []).filter(c => (c.task_kinds || []).length && (!kinds || c.task_kinds.some(k => kinds.includes(k))));
  const out = cats.map(c => ({ key: c.key, name: c.name, of: c.weight, get: g => g.categories.find(x => x.key === c.key)?.final }));
  if (!kinds || kinds.includes('monthly')) out.push({ key: 'monthly', name: 'اختبارات الفترة (المتوسط)', of: (sc.monthly || defaultScheme().monthly).outOf, get: g => g.monthly.final });
  return out;
}
const enrolledOn = (sid, cid, d) => enrollmentsOf(sid).some(en => en.class_id === cid && isEnrolledOn(en, d));

async function setResult(t, sid, p, existing) {
  if (p.clear) { if (existing) await patch('task_results', existing.id, { score: null, status: null }); return; }
  if (existing) await patch('task_results', existing.id, { score: p.score ?? null, status: p.status ?? null });
  else await save('task_results', { task_id: t.id, student_id: sid, score: p.score ?? null, status: p.status ?? null });
}

// ---------- تعبئة عمود كامل ----------
async function fillColumn(t, cid, rows, res) {
  const mode = taskMode(t);
  const absent = new Set(all('attendance', a => a.class_id === cid && a.date === t.date && a.status.startsWith('absent')).map(a => a.student_id));
  const v = await formDialog({ title: `تعبئة العمود: ${t.title}`, okText: 'تعبئة', fields: [
    mode === 'status'
      ? { name: 'val', label: 'الحالة', type: 'select', value: 'done', options: [...Object.entries(HW_STATUS).map(([value, label]) => ({ value, label })), { value: '__clear', label: 'مسح العمود' }] }
      : { name: 'val', label: `الدرجة (من ${t.max_score}) — اكتب «ع» لمعذور، أو اتركها فارغة لمسح العمود`, value: String(t.max_score), full: true },
    { name: 'scope', label: 'على من؟', type: 'select', value: 'empty', options: [{ value: 'empty', label: 'الخانات الفارغة فقط' }, { value: 'all', label: 'جميع الطلاب (يستبدل الموجود)' }] },
    { name: 'skip', label: 'الغائبون يوم المهمة', type: 'select', value: 'skip', options: [{ value: 'skip', label: 'تُترك خاناتهم كما هي' }, { value: 'include', label: 'تُعبأ مثل غيرهم' }] },
  ] });
  if (!v) return;
  let p;
  if (mode === 'status') p = v.val === '__clear' ? { clear: true } : { status: v.val, score: null };
  else { p = parseCell(v.val, t); if (p.error) return toast(p.error, 'err'); }
  let n = 0;
  for (const x of rows) {
    const sid = x.student.id; if (!enrolledOn(sid, cid, t.date)) continue;
    if (v.skip === 'skip' && absent.has(sid)) continue;
    const ex = res.get(`${t.id}|${sid}`);
    const has = ex && (ex.status || (ex.score != null && ex.score !== ''));
    if (v.scope === 'empty' && has && !p.clear) continue;
    await setResult(t, sid, p, ex); n++;
  }
  await audit('تعبئة عمود في دفتر الدرجات', `${t.title} — ${className(get('classes', cid))}: ${n} طالب`);
  toast(`عُبئ ${n} طالب`, 'ok');
}

// ---------- Excel ----------
async function exportExcel(cid, term, group, data) {
  const XLSX = await getXLSX(); const { tasks, rows, res } = data;
  const aoa = [
    ['المعرف', '', '', ...tasks.map(t => t.id)],
    ['', 'م', 'اسم الطالب', ...tasks.map(t => t.title)],
    ['', '', 'الدرجة العظمى', ...tasks.map(t => (taskMode(t) === 'status' ? 'حالات' : +t.max_score))],
    ['', '', 'النوع', ...tasks.map(t => TASK_KINDS[t.kind])],
    ['', '', 'التاريخ', ...tasks.map(t => t.date)],
    ...rows.map((x, i) => [x.student.id, x.student.seat_no || i + 1, x.student.full_name, ...tasks.map(t => { const r = res.get(`${t.id}|${x.student.id}`); const c = cellText(r, t); return c !== '' && !isNaN(+c) ? +c : c; })]),
  ];
  const sh = XLSX.utils.aoa_to_sheet(aoa);
  sh['!cols'] = [{ hidden: true, wch: 4 }, { wch: 5 }, { wch: 34 }, ...tasks.map(() => ({ wch: 14 })), { wch: 14 }, { wch: 14 }];
  sh['!rows'] = [{ hidden: true }];
  const help = XLSX.utils.aoa_to_sheet([['طريقة التعبئة'],
    ['• اكتب الدرجة تحت كل اختبار. «ع» = معذور (لا يدخل في المقام). للواجب بالحالات: تم / ناقص / لم يحل / متأخر / معذور.'],
    ['• لإضافة اختبار جديد: أضف عموداً بعد آخر عمود، واكتب عنوانه في صف العناوين، ودرجته العظمى في الصف الذي تحته، والتاريخ (اختياري).'],
    ['• لا تغيّر ترتيب الصفوف الأولى ولا تحذف العمود المخفي الأول (يربط كل صف بطالبه).'],
    ['• ويقبل الرفع أيضاً أي ملف فيه عمود «اسم الطالب» وأعمدة بعناوين الاختبارات.']]);
  help['!cols'] = [{ wch: 110 }];
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, sh, 'الدرجات'); XLSX.utils.book_append_sheet(wb, help, 'تعليمات');
  XLSX.writeFile(wb, `درجات-${className(get('classes', cid))}-ف${term}-${GROUPS[group].label}.xlsx`.replace(/[\\/:*?"<>|]/g, '-'));
}

// قراءة الملف: قالب التطبيق (بمعرفات مخفية) أو أي ملف بعمود اسم الطالب
export function parseGradeSheet(rows, data, cid) {
  const { tasks, rows: students } = data;
  const txt = v => String(v ?? '').trim();
  let idRow = -1, titleRow, maxRow = -1, kindRow = -1, dateRow = -1, nameCol, idCol = -1, seatCol = -1, start;
  if (txt(rows[0]?.[0]) === 'المعرف') { idRow = 0; titleRow = 1; maxRow = 2; kindRow = 3; dateRow = 4; start = 5; idCol = 0; seatCol = 1; nameCol = 2; }
  else {
    titleRow = rows.slice(0, 12).findIndex(r => r.some(c => /اسم|الطالب/.test(txt(c))));
    if (titleRow < 0) throw new Error('لم أجد عمود «اسم الطالب» في الملف');
    nameCol = rows[titleRow].findIndex(c => /اسم|الطالب/.test(txt(c)));
    seatCol = rows[titleRow].findIndex((c, i) => i !== nameCol && /^(م|رقم|الرقم|رقم المقعد)$/.test(txt(c)));
    const next = rows[titleRow + 1] || [];
    if (normAr(txt(next[nameCol])).includes('العظمي') || next.some((c, i) => i !== nameCol && /العظمى|من$/.test(txt(c)))) { maxRow = titleRow + 1; start = titleRow + 2; } else start = titleRow + 1;
  }
  const head = rows[titleRow];
  const skipCol = i => i === nameCol || i === idCol || i === seatCol || /سجل|هوية|جوال|ملاحظ|المجموع|المعدل|المتوسط|النسبة/.test(txt(head[i]));
  const cols = [];
  for (let i = 0; i < head.length; i++) {
    if (skipCol(i)) continue; const title = txt(head[i]); if (!title) continue;
    const id = idRow >= 0 ? txt(rows[idRow][i]) : '';
    let t = (id && tasks.find(x => x.id === id)) || tasks.find(x => normAr(x.title) === normAr(title) || normAr(x.title) === normAr(stripMax(title)));
    let max = maxRow >= 0 ? +normDigits(txt(rows[maxRow][i])) : NaN;
    if (isNaN(max)) { const m = normDigits(title).match(/(?:من|\/)\s*(\d+(?:\.\d+)?)/); max = m ? +m[1] : NaN; }
    const date = dateRow >= 0 ? txt(rows[dateRow][i]) : '';
    const kindTxt = kindRow >= 0 ? txt(rows[kindRow][i]) : '';
    const kind = Object.entries(TASK_KINDS).find(([, l]) => l === kindTxt)?.[0] || null;
    cols.push({ i, title, task: t || null, max: isNaN(max) ? null : max, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, kind, mode: txt(rows[maxRow]?.[i]) === 'حالات' ? 'status' : null });
  }
  const byId = new Map(students.map(x => [x.student.id, x.student]));
  const byName = new Map(students.map(x => [normAr(x.student.full_name).replace(/\s+/g, ' '), x.student]));
  const out = [], unmatched = [];
  for (const r of rows.slice(start)) {
    const name = txt(r[nameCol]); if (!name && !(idCol >= 0 && txt(r[idCol]))) continue;
    let st = idCol >= 0 ? byId.get(txt(r[idCol])) : null;
    if (!st) st = byName.get(normAr(name).replace(/\s+/g, ' '));
    if (!st) { const cand = students.filter(x => { const a = normAr(x.student.full_name), b = normAr(name); return b.length > 5 && (a.startsWith(b) || b.startsWith(a)); }); if (cand.length === 1) st = cand[0].student; }
    if (!st && seatCol >= 0) { const sn = +normDigits(txt(r[seatCol])); const c = students.filter(x => +x.student.seat_no === sn); if (sn && c.length === 1 && !name) st = c[0].student; }
    if (!st) { unmatched.push(name); continue; }
    out.push({ st, vals: cols.map(c => r[c.i]) });
  }
  return { cols, rows: out, unmatched };
}

function ImportDialog({ parsed, cid, term, group, close, done }) {
  const nw = parsed.cols.filter(c => !c.task);
  const defKind = GROUPS[group]?.kinds?.[0] || 'quiz';
  const [kind, setKind] = useState(defKind);
  const [replace, setReplace] = useState(true);
  const r = termRange(workspace(), term);
  const virt = c => c.task || { id: 'new' + c.i, title: c.title, max_score: c.max ?? (kind === 'monthly' ? 20 : 10), mode: c.mode || undefined, kind: c.kind || kind };
  let ok = 0, bad = [];
  for (const row of parsed.rows) parsed.cols.forEach((c, j) => { const p = parseCell(row.vals[j], virt(c)); if (p.error) bad.push(`${row.st.full_name.split(' ')[0]} / ${c.title}: ${p.error}`); else if (!p.clear) ok++; });
  return html`<${ModalHead} title="رفع الدرجات من Excel" close=${close} />
    <div class="modal-body stack">
      <div class="chips"><span class="badge pri">${parsed.cols.length} عمود درجات</span><span class="badge pos">${parsed.rows.length} طالب</span><span class="badge">${ok} درجة</span>${parsed.unmatched.length ? html`<span class="badge neg">${parsed.unmatched.length} اسم غير مطابق</span>` : null}</div>
      <div class="table-wrap" style="max-height:26vh"><table class="tbl small"><thead><tr><th>العمود</th><th>يُرصد في</th><th class="num">من</th></tr></thead><tbody>
        ${parsed.cols.map(c => html`<tr><td>${c.title}</td><td>${c.task ? html`<span class="badge pos">${c.task.title}</span>` : html`<span class="badge warn">مهمة جديدة</span>`}</td><td class="num">${c.task ? c.task.max_score : c.max ?? (kind === 'monthly' ? 20 : 10)}</td></tr>`)}</tbody></table></div>
      ${nw.length ? html`<label class="field"><span class="small">نوع المهام الجديدة (${nw.length})</span><select value=${kind} onChange=${ev => setKind(ev.target.value)}>${Object.entries(TASK_KINDS).filter(([k]) => k !== 'final').map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
        <span class="muted small">تاريخها: ${r ? 'من صف التاريخ إن وُجد، وإلا اليوم' : ''}. والدرجة العظمى من صف «الدرجة العظمى» أو من العنوان (مثل «اختبار 1 من 15»)، وإلا ${kind === 'monthly' ? 20 : 10}.</span></label>` : null}
      <label class="check"><input type="checkbox" checked=${replace} onChange=${ev => setReplace(ev.target.checked)} /> استبدال الدرجات الموجودة بما في الملف (وإلا تُعبأ الخانات الفارغة فقط)</label>
      ${parsed.unmatched.length ? html`<div class="notice small">أسماء لم تُطابق طالباً في الفصل (لن تُرصد): ${parsed.unmatched.slice(0, 12).join('، ')}${parsed.unmatched.length > 12 ? '…' : ''}</div>` : null}
      ${bad.length ? html`<div class="error small">${bad.length} قيمة غير صالحة ستُتجاهل: ${bad.slice(0, 6).join(' • ')}${bad.length > 6 ? '…' : ''}</div>` : null}
    </div>
    <div class="modal-foot"><button class="btn ghost" onClick=${close}>إلغاء</button><button class="btn primary" disabled=${!ok && !nw.length} onClick=${() => done({ kind, replace })}>رصد الدرجات</button></div>`;
}

async function importExcel(file, cid, term, group, data) {
  const XLSX = await getXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sn = wb.SheetNames.find(n => n.includes('الدرجات')) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: true });
  const parsed = parseGradeSheet(rows, data, cid);
  if (!parsed.cols.length) throw new Error('لم أجد أعمدة درجات بجانب عمود الاسم');
  const opt = await new Promise(res => { let fired = false; openModal(cl => html`<${ImportDialog} parsed=${parsed} cid=${cid} term=${term} group=${group} close=${cl} done=${v => { fired = true; cl(); res(v); }} />`, { size: 'lg', onClose: () => { if (!fired) res(null); } }); });
  if (!opt) return;
  const r = termRange(workspace(), term); const today = todayISO();
  const dflt = r ? (today < r.start ? r.start : today > r.end ? r.end : today) : today;
  for (const c of parsed.cols) if (!c.task) {
    const k = c.kind || opt.kind;
    c.task = await save('tasks', { kind: k, title: stripMax(c.title), date: c.date || dflt, due_date: c.date || dflt, max_score: c.max ?? (k === 'monthly' ? 20 : 10), mode: c.mode || undefined, class_ids: [cid] });
  }
  const existing = new Map(all('task_results', x => parsed.cols.some(c => c.task.id === x.task_id)).map(x => [`${x.task_id}|${x.student_id}`, x]));
  const batch = []; let n = 0, skipped = 0;
  for (const row of parsed.rows) parsed.cols.forEach((c, j) => {
    const p = parseCell(row.vals[j], c.task); if (p.error || p.clear) return;
    const ex = existing.get(`${c.task.id}|${row.st.id}`);
    const has = ex && (ex.status || (ex.score != null && ex.score !== ''));
    if (has && !opt.replace) { skipped++; return; }
    batch.push({ ...(ex || { task_id: c.task.id, student_id: row.st.id }), score: p.score ?? null, status: p.status ?? null }); n++;
  });
  if (batch.length) await saveMany('task_results', batch);
  await audit('رفع درجات من Excel', `${className(get('classes', cid))}: ${n} درجة في ${parsed.cols.length} عمود`);
  toast(`رُصدت ${n} درجة${skipped ? ` (تُرك ${skipped} موجود)` : ''}`, 'ok', 4000);
}

// ---------- طباعة ----------
function gradebookSheet(cid, term, group, data) {
  const { tasks, rows, res } = data; const sums = summaryCols(group, cid, term);
  const gs = new Map(rows.map(x => [x.student.id, gradeStudent(x.student.id, cid, term)]));
  return `<section class="pr-page">${header('سجل الدرجات — ' + GROUPS[group].label, [['الفصل', className(get('classes', cid))], ['الفصل الدراسي', TERM_LABEL[term]], ['عدد المهام', String(tasks.length)]])}
    <table class="pr gb"><thead><tr><th>م</th><th>اسم الطالب</th>${tasks.map(t => `<th class="v"><div>${e(t.title)}</div><small>${fmtShort(t.date)} • ${taskMode(t) === 'status' ? 'حالات' : 'من ' + t.max_score}</small></th>`).join('')}${sums.map(s => `<th class="v sum"><div>${e(s.name)}</div><small>من ${s.of}</small></th>`).join('')}</tr></thead>
    <tbody>${rows.map((x, i) => `<tr><td>${x.student.seat_no || i + 1}</td><td class="nm">${e(x.student.full_name)}</td>${tasks.map(t => `<td>${e(cellText(res.get(`${t.id}|${x.student.id}`), t))}</td>`).join('')}${sums.map(s => { const v = gs.get(x.student.id) ? s.get(gs.get(x.student.id)) : null; return `<td class="sum">${v == null ? '—' : fmtN(v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>
    <div class="pr-small" style="margin-top:4px">«ع» = معذور (لا يدخل في المقام). الأعمدة الأخيرة هي الدرجة المحتسبة في الحساب النهائي.</div>
    <div class="pr-foot" style="margin-top:12px"><div>المعلم: ${e(workspace()?.identity?.teacher || '')} — التوقيع: ............</div><div>اعتماد المدير: ............</div></div></section>`;
}

// ---------- تنبيه: فئة مهام محسوبة بطريقة لا تقرأ درجات المهام ----------
const KIND_GUESS = { homework: ['homework'], lab: ['worksheet', 'performance', 'project'], quizzes: ['quiz'] };
function guessKinds(c) {
  if ((c.task_kinds || []).length) return c.task_kinds;
  if (KIND_GUESS[c.key]) return KIND_GUESS[c.key];
  const n = normAr(c.name || '');
  if (n.includes('واجب')) return ['homework'];
  if (n.includes('اختبار') && n.includes('قصير')) return ['quiz'];
  if (/مختبر|ورق|عمل|مشروع|اداء/.test(n)) return ['worksheet', 'performance', 'project'];
  return [];
}
export function schemeIssues(cid, term) {
  const c = get('classes', cid); if (!c) return [];
  const sc = schemeFor(c.grade, term); const r = termRange(workspace(), term); if (!sc || !r) return [];
  const kinds = new Set(ws('tasks', t => !t.deleted && (t.class_ids || []).includes(cid) && t.date >= r.start && t.date <= r.end).map(t => t.kind));
  return (sc.categories || []).filter(x => x.method !== 'ratio').map(x => ({ cat: x, kinds: guessKinds(x) })).filter(x => x.kinds.some(k => kinds.has(k)));
}
export function SchemeFix({ cid, term }) {
  useStore();
  const iss = schemeIssues(cid, term); if (!iss.length) return null;
  const c = get('classes', cid);
  const fix = async () => {
    const sc = schemeFor(c.grade, term); const ex = ws('grade_schemes', x => +x.grade === +c.grade && +x.term === +term)[0];
    const cats = sc.categories.map(x => { const f = iss.find(y => y.cat.key === x.key); return f ? { ...x, method: 'ratio', task_kinds: f.kinds } : x; });
    await save('grade_schemes', { ...(ex || {}), grade: +c.grade, term: +term, categories: cats, monthly: sc.monthly || defaultScheme().monthly, options: sc.options || defaultScheme().options });
    await audit('تعديل توزيع الدرجات', `${iss.map(x => x.cat.name).join('، ')} ← تُحسب من درجات المهام (نسبة)`);
    toast('صارت تُحسب من درجات المهام', 'ok');
  };
  return html`<div class="notice row" style="margin-bottom:12px;gap:10px"><span class="grow">⚠ ${iss.map(x => html`<b>«${x.cat.name}»</b> `)}طريقة حسابها في توزيع الدرجات «${METHODS[iss[0].cat.method] || iss[0].cat.method}» (من نقاط أحداث الحصة)، لذلك <b>لا تدخل فيها الدرجات التي ترصدها للمهام</b>. حوّلها إلى «نسبة» لتُحسب من درجات الواجبات والاختبارات.</span>
    <button class="btn primary sm" onClick=${fix}>احسبها من درجات المهام</button><a class="btn ghost sm" href="#/settings/grading">توزيع الدرجات</a></div>`;
}

// ---------- الصفحة ----------
export function GradebookPage({ q = {} }) {
  useStore();
  const cls = classes(); const w = workspace();
  const [cid, setCid] = useState(q.class && get('classes', q.class) ? q.class : cls[0]?.id);
  const [term, setTerm] = useState(+q.term || currentTerm(w, todayISO()) || 1);
  const [group, setGroup] = useState(GROUPS[q.g] ? q.g : 'all');
  const [edit, setEdit] = useState({});
  const inputs = useRef({});
  useEffect(() => () => { HL.hover = HL.focus = null; hlStyle(); }, []);
  if (!cls.length) return html`<div class="page"><${Empty} icon="users" title="أضف فصلاً أولاً" /></div>`;
  const data = sheetData(cid, term, group); const { r, tasks, rows, res } = data;
  const sums = summaryCols(group, cid, term);
  const today = todayISO();
  const add = async () => {
    const kind = GROUPS[group]?.kinds?.[0] || 'quiz';
    const t = await taskDialog(null, cid, { kind, date: !r ? today : today < r.start ? r.start : today > r.end ? r.end : today });
    if (t) toast('أُضيف عمود: ' + t.title, 'ok');
  };
  const commit = async (t, sid, raw) => {
    const k = `${t.id}|${sid}`; const ex = res.get(k);
    const p = parseCell(raw, t);
    if (p.error) { toast(p.error, 'err', 3500); return false; }
    if (cellText(ex, t) !== String(raw).trim()) await setResult(t, sid, p, ex);
    setEdit(o => { const n = { ...o }; delete n[k]; return n; });
    return true;
  };
  const move = (ri, ci, dr, dc) => { const el = inputs.current[`${ri + dr}|${ci + dc}`]; if (el) { el.focus(); el.select?.(); } };
  const onFile = async ev => { const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; try { await importExcel(f, cid, term, group, data); } catch (err) { toast(err.message, 'err', 6000); } };
  const gs = new Map(rows.map(x => [x.student.id, gradeStudent(x.student.id, cid, term)]));
  return html`<div class="page wide">
    <div class="page-head"><div><h1>دفتر الدرجات</h1><div class="sub">أدخل درجات الواجبات والاختبارات القصيرة واختبارات الفترة لكل الطلاب في جدول واحد، وتُحتسب مباشرة في الدرجة النهائية.</div></div>
      <div class="actions">
        <${Btn} onClick=${() => exportExcel(cid, term, group, data)}><${Icon} name="download" /> تنزيل Excel</${Btn}>
        <label class="btn"><${Icon} name="upload" /> رفع من Excel<input type="file" hidden accept=".xlsx,.xls,.csv" onChange=${onFile} /></label>
        <${Btn} onClick=${() => printHTML(gradebookSheet(cid, term, group, data), { landscape: true })}><${Icon} name="print" /> طباعة</${Btn}>
        <${Btn} cls="primary" onClick=${add}><${Icon} name="plus" /> ${group === 'monthly' ? 'اختبار فترة' : group === 'homework' ? 'واجب' : group === 'quiz' ? 'اختبار قصير' : 'مهمة / اختبار'}</${Btn}></div></div>
    <div class="card" style="margin-bottom:12px"><div class="row">
      <select style="max-width:220px" value=${cid} onChange=${ev => setCid(ev.target.value)}>${cls.map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select>
      <div class="chips">${[1, 2].map(t => html`<button class=${'chip' + (term === t ? ' on' : '')} onClick=${() => setTerm(t)}>${TERM_LABEL[t]}</button>`)}</div>
      <span class="grow"></span>
      <div class="chips">${Object.entries(GROUPS).map(([k, g]) => html`<button class=${'chip' + (group === k ? ' on' : '')} onClick=${() => setGroup(k)}>${g.label}</button>`)}</div></div>
      <p class="muted small" style="margin:8px 0 0">اكتب الدرجة واضغط Enter للطالب التالي (الأسهم للتنقل). «ع» = معذور. زر <b>⇣ تعبئة</b> في رأس العمود يرصد الدرجة نفسها لكل الطلاب. الأعمدة الملونة في الآخر = الدرجة المحتسبة في الحساب النهائي${sums.some(s => s.key === 'monthly') ? '، واختبارات الفترة تُحتسب بمتوسطها' : ''}.</p></div>
    <${SchemeFix} cid=${cid} term=${term} />
    ${!r ? html`<div class="notice">حدد تواريخ الفصل الدراسي من الإعدادات ← التقويم.</div>` : !tasks.length ? html`<div class="card"><${Empty} icon="tasks" title=${'لا توجد ' + (group === 'all' ? 'مهام' : GROUPS[group].label) + ' في ' + TERM_LABEL[term]}>
        أضف عموداً بالزر أعلاه، أو ارفع ملف Excel فيه عمود «اسم الطالب» وأعمدة بعناوين الاختبارات.
        <div class="row" style="justify-content:center;margin-top:10px"><${Btn} cls="primary" onClick=${add}><${Icon} name="plus" /> إضافة</${Btn}><${Btn} onClick=${() => exportExcel(cid, term, group, data)}><${Icon} name="download" /> نموذج Excel بأسماء الطلاب</${Btn}></div></${Empty}></div>`
    : html`<div class="table-wrap gb-wrap" ...${gridHandlers}><table class="tbl gb-grid">
      <thead><tr><th>م</th><th class="pname">الطالب</th>
        ${tasks.map(t => html`<th class=${'gb-h k-' + t.kind}>
          <a class="gb-t" href=${`#/task/${t.id}?class=${cid}`} title=${t.title}>${t.title}</a>
          <div class="gb-m">${TASK_KINDS[t.kind]}${t.makeup_of ? ' • تعويضي' : ''}</div>
          <div class="gb-m">${fmtShort(t.date)} | ${hd(t.date)}هـ • ${taskMode(t) === 'status' ? 'حالات' : 'من ' + t.max_score}</div>
          <button class="btn sm soft gb-fill" onClick=${() => fillColumn(t, cid, rows, res)} title="رصد نفس الدرجة لجميع الطلاب">⇣ تعبئة</button></th>`)}
        ${sums.map(s => html`<th class="gb-sum"><div>${s.name}</div><div class="gb-m">من ${s.of}</div></th>`)}</tr></thead>
      <tbody>${rows.map((x, ri) => { const sid = x.student.id; const g = gs.get(sid);
        return html`<tr key=${sid}><td class="num">${x.student.seat_no || ri + 1}</td><td class="pname"><a href=${`#/student/${sid}`}>${x.student.full_name}</a></td>
          ${tasks.map((t, ci) => { const k = `${t.id}|${sid}`; const ex = res.get(k);
            if (!enrolledOn(sid, cid, t.date)) return html`<td class="gb-c shaded" title="غير مسجل في الفصل بتاريخ المهمة"></td>`;
            const v = k in edit ? edit[k] : cellText(ex, t);
            const p = k in edit ? parseCell(v, t) : null;
            const ref = el => { inputs.current[`${ri}|${ci}`] = el; };
            const onFocus = ev => setFocusHL(ev.target), onBlur = ev => { setFocusHL(null); if (k in edit) commit(t, sid, ev.target.value); };
            const keys = ev => {
              if (ev.key === 'Enter' || ev.key === 'ArrowDown') { ev.preventDefault(); ev.target.blur(); move(ri, ci, 1, 0); }
              else if (ev.key === 'ArrowUp') { ev.preventDefault(); ev.target.blur(); move(ri, ci, -1, 0); }
              else if (ev.key === 'Escape') { setEdit(o => { const n = { ...o }; delete n[k]; return n; }); }
            };
            return html`<td class="gb-c">${taskMode(t) === 'status'
              ? html`<select class=${'gb-in st-' + (ex?.status || '')} ref=${ref} value=${ex?.status || ''} onFocus=${onFocus} onBlur=${() => setFocusHL(null)} onKeyDown=${ev => { if (ev.key === 'Enter') { ev.preventDefault(); move(ri, ci, 1, 0); } }}
                  onChange=${ev => setResult(t, sid, ev.target.value ? { status: ev.target.value, score: null } : { clear: true }, ex)}><option value="">—</option>${Object.entries(HW_STATUS).map(([s, l]) => html`<option value=${s}>${l}</option>`)}</select>`
              : html`<input class=${'gb-in' + (p?.error ? ' bad' : ex?.status === 'excused' ? ' exc' : '')} ref=${ref} inputmode="decimal" value=${v} placeholder="—"
                  onFocus=${onFocus} onBlur=${onBlur} onKeyDown=${keys} onInput=${ev => { const val = ev.target.value; setEdit(o => ({ ...o, [k]: val })); }} />`}</td>`; })}
          ${sums.map(s => { const val = g ? s.get(g) : null; return html`<td class="gb-sum num"><b>${val == null ? '—' : fmtN(val)}</b></td>`; })}</tr>`; })}</tbody>
    </table></div>`}
  </div>`;
}
