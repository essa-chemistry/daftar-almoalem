// استيراد الطلاب من Excel/CSV: ربط الأعمدة، معاينة، كشف الأخطاء والتكرار، تحديث/تخطي
import { html, useState } from '../lib.js';
import { ws, get, all, classes, className, patch, audit, workspace } from '../store.js';
import { useStore, Icon, Btn, Empty, toast, go } from '../ui.js';
import { ensureClass, addStudent, setNid, normNid, gradeLabel } from '../ops.js';
import { getXLSX, normAr, normDigits, todayISO, GRADE_NAMES } from '../utils.js';
import { termRange } from '../calendar.js';

const FIELDS = [
  { k: 'name', label: 'الاسم', req: true, keys: ['اسم', 'الاسم', 'name', 'الطالب'] },
  { k: 'nid', label: 'السجل المدني', keys: ['سجل', 'هوي', 'مدني', 'رقم الهوية', 'id', 'national'] },
  { k: 'grade', label: 'الصف', keys: ['صف', 'المرحلة', 'grade', 'المستوى'] },
  { k: 'section', label: 'الشعبة', keys: ['شعب', 'فصل', 'section', 'class'] },
  { k: 'phone', label: 'جوال ولي الأمر', keys: ['جوال', 'هاتف', 'ولي', 'phone', 'mobile'] },
];
export function parseGrade(v) {
  const s = normAr(normDigits(v));
  if (!s) return null;
  if (/ثالث|^3|\b3\b|ثلاث/.test(s)) return 3;
  if (/ثاني|^2|\b2\b/.test(s)) return 2;
  if (/اول|^1|\b1\b/.test(s)) return 1;
  const n = parseInt(s, 10); return n >= 1 && n <= 3 ? n : null;
}
const isEmptyRow = r => !r || r.every(c => String(c ?? '').trim() === '');

export function ImportPage() {
  useStore();
  const [sheet, setSheet] = useState(null); // { names, rows (arrays), headerRow, wb }
  const [map, setMap] = useState({});
  const [defs, setDefs] = useState({ grade: '1', section: '1' });
  const [mode, setMode] = useState('update');
  const [startMode, setStartMode] = useState('term');
  const [done, setDone] = useState(null);

  const onFile = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const XLSX = await getXLSX();
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', codepage: 65001 });
      loadSheet(XLSX, wb, wb.SheetNames[0]);
    } catch (err) { toast(err.message || 'تعذر قراءة الملف', 'err', 5000); }
  };
  const loadSheet = (XLSX, wb, name) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false }).filter(r => !isEmptyRow(r));
    const headerRow = Math.max(0, rows.findIndex(r => r.filter(c => String(c).trim()).length >= 2));
    const head = (rows[headerRow] || []).map(h => normAr(h));
    const m = {};
    for (const f of FIELDS) {
      const i = head.findIndex((h, idx) => !Object.values(m).includes(idx) && f.keys.some(k => h.includes(normAr(k))));
      m[f.k] = i >= 0 ? i : '';
    }
    setSheet({ XLSX, wb, name, rows, headerRow }); setMap(m); setDone(null);
  };

  if (done) return html`<div class="page"><div class="card"><${Empty} icon="check" title="اكتمل الاستيراد">
    أُضيف ${done.added} طالباً، وحُدّث ${done.updated}، وتُخطّي ${done.skipped}. ${done.classes ? `أُنشئ ${done.classes} فصل.` : ''}
    <div class="row" style="justify-content:center"><a class="btn primary" href="#/classes">عرض الفصول</a><button class="btn" onClick=${() => { setSheet(null); setDone(null); }}>استيراد ملف آخر</button></div></${Empty}></div></div>`;

  // ---------- المعاينة ----------
  let preview = [];
  if (sheet) {
    const data = sheet.rows.slice(sheet.headerRow + 1);
    const seenNid = new Map(), seenName = new Map();
    const existing = ws('students');
    preview = data.map((r, i) => {
      const cell = k => map[k] === '' || map[k] == null ? '' : String(r[map[k]] ?? '').trim();
      const name = cell('name').replace(/\s+/g, ' ');
      const nid = normNid(cell('nid'));
      let gtxt = cell('grade'), stxt = cell('section');
      if (!stxt && /[\/\-]\s*\d+\s*$/.test(normDigits(gtxt))) { stxt = normDigits(gtxt).match(/(\d+)\s*$/)[1]; }
      const grade = map.grade === '' ? +defs.grade : parseGrade(gtxt);
      const section = map.section === '' && !stxt ? defs.section : normDigits(stxt).replace(/[^\d\p{L}]/gu, '') || defs.section;
      const errs = [], warns = [];
      if (!name) errs.push('الاسم فارغ');
      if (nid && nid.length !== 10) errs.push('السجل المدني ليس 10 أرقام');
      if (!grade) errs.push('تعذر تحديد الصف');
      const nk = normAr(name);
      if (nid && seenNid.has(nid)) errs.push(`مكرر في الملف (سطر ${seenNid.get(nid)})`);
      else if (nk && seenName.has(nk)) warns.push(`اسم مكرر في الملف (سطر ${seenName.get(nk)})`);
      if (nid) seenNid.set(nid, i + 1); if (nk) seenName.set(nk, i + 1);
      const match = existing.find(s => normAr(s.full_name) === nk && (!nid || !s.id_last4 || s.id_last4 === nid.slice(-4)));
      if (!match && nk && existing.some(s => normAr(s.full_name) === nk)) warns.push('اسم مطابق لطالب موجود بسجل مختلف — سيُضاف كطالب جديد');
      return { line: i + 1, name, nid, grade, section, phone: normDigits(cell('phone')), errs, warns, match };
    }).filter(p => p.name || p.nid);
  }
  const ok = preview.filter(p => !p.errs.length);
  const newClasses = new Set(ok.map(p => `${p.grade}|${p.section}`).filter(k => !ws('classes', c => `${c.grade}|${c.section}` === k).length));

  const run = async () => {
    const w = workspace(); const t1 = termRange(w, 1);
    const start = startMode === 'term' && t1 ? t1.start : todayISO();
    let added = 0, updated = 0, skipped = 0;
    for (const p of ok) {
      const c = await ensureClass(p.grade, p.section, gradeLabel(p.grade));
      if (p.match) {
        if (mode === 'skip') { skipped++; continue; }
        await patch('students', p.match.id, { full_name: p.name, guardian_phone: p.phone || p.match.guardian_phone });
        if (p.nid) await setNid(p.match.id, p.nid);
        const hasEnr = all('enrollments', e => e.student_id === p.match.id && e.class_id === c.id && !e.end_date).length;
        if (!hasEnr) await import('../ops.js').then(m => m.transferStudent(p.match.id, c.id, todayISO()));
        updated++;
      } else {
        await addStudent({ full_name: p.name, nid: p.nid, classId: c.id, start_date: start, guardian_phone: p.phone });
        added++;
      }
    }
    await audit('استيراد طلاب', `${added} جديد، ${updated} محدث، ${skipped} متخطى`);
    setDone({ added, updated, skipped, classes: newClasses.size });
  };

  const colOpts = sheet ? (sheet.rows[sheet.headerRow] || []).map((h, i) => ({ i, label: `${String.fromCharCode(65 + (i % 26))}: ${String(h).slice(0, 30) || '(بلا عنوان)'}` })) : [];
  return html`<div class="page">
    <div class="page-head"><a class="icon-btn" href="#/classes"><${Icon} name="back" /></a><div><h1>استيراد الطلاب</h1><div class="sub">من ملف Excel أو CSV (مثل تصدير نظام نور)</div></div></div>
    <div class="card stack">
      <label class="btn primary lg" style="justify-self:start"><${Icon} name="upload" /> اختر الملف<input type="file" hidden accept=".xlsx,.xls,.csv" onChange=${onFile} /></label>
      <p class="muted small" style="margin:0">الأعمدة المتوقعة: الاسم، السجل المدني، الصف، الشعبة، جوال ولي الأمر (اختياري). تُنشأ الفصول تلقائياً. <b>السجل المدني لا يُحفظ كاملاً</b>: تُحفظ آخر 4 أرقام، ويُرسل الرقم للخادم مرة واحدة ليحفظ بصمته المشفرة فقط.</p>
      ${sheet ? html`
        ${sheet.wb.SheetNames.length > 1 ? html`<label class="field" style="max-width:300px"><span>الورقة</span><select value=${sheet.name} onChange=${e => loadSheet(sheet.XLSX, sheet.wb, e.target.value)}>${sheet.wb.SheetNames.map(n => html`<option>${n}</option>`)}</select></label>` : null}
        <h3>ربط الأعمدة</h3>
        <div class="form-grid">${FIELDS.map(f => html`<label class="field"><span>${f.label}${f.req ? ' *' : ''}</span><select value=${map[f.k]} onChange=${e => setMap({ ...map, [f.k]: e.target.value === '' ? '' : +e.target.value })}><option value="">— غير موجود —</option>${colOpts.map(o => html`<option value=${o.i}>${o.label}</option>`)}</select></label>`)}</div>
        ${map.grade === '' || map.section === '' ? html`<div class="form-grid">
          ${map.grade === '' ? html`<label class="field"><span>الصف لكل الطلاب</span><select value=${defs.grade} onChange=${e => setDefs({ ...defs, grade: e.target.value })}>${Object.entries(GRADE_NAMES).map(([k, v]) => html`<option value=${k}>${v}</option>`)}</select></label>` : null}
          ${map.section === '' ? html`<label class="field"><span>الشعبة لكل الطلاب</span><input value=${defs.section} onInput=${e => setDefs({ ...defs, section: e.target.value })} /></label>` : null}</div>` : null}
        <div class="form-grid">
          <label class="field"><span>الطالب الموجود مسبقاً</span><select value=${mode} onChange=${e => setMode(e.target.value)}><option value="update">تحديث بياناته</option><option value="skip">تخطيه</option></select></label>
          <label class="field"><span>تاريخ التسجيل في الفصل</span><select value=${startMode} onChange=${e => setStartMode(e.target.value)}><option value="term">بداية الفصل الدراسي الأول</option><option value="today">اليوم (ملتحقون جدد)</option></select></label>
        </div>
        <div class="row"><span class="badge pos">صالح ${ok.length}</span><span class="badge neg">أخطاء ${preview.length - ok.length}</span><span class="badge pri">موجود مسبقاً ${ok.filter(p => p.match).length}</span>${newClasses.size ? html`<span class="badge warn">فصول جديدة ${newClasses.size}</span>` : null}</div>
        <div class="table-wrap" style="max-height:420px"><table class="tbl"><thead><tr><th>سطر</th><th>الاسم</th><th>السجل</th><th>الصف</th><th>الشعبة</th><th>الجوال</th><th>الحالة</th></tr></thead>
          <tbody>${preview.slice(0, 500).map(p => html`<tr><td class="num">${p.line}</td><td>${p.name}</td><td class="ltr">${p.nid ? '••••••' + p.nid.slice(-4) : '—'}</td><td>${p.grade ? GRADE_NAMES[p.grade] : '—'}</td><td>${p.section}</td><td class="ltr">${p.phone}</td>
            <td>${p.errs.length ? html`<span class="badge neg">${p.errs.join('، ')}</span>` : p.match ? html`<span class="badge pri">موجود — ${mode === 'skip' ? 'سيُتخطى' : 'سيُحدَّث'}</span>` : html`<span class="badge pos">جديد</span>`} ${p.warns.map(w => html`<span class="badge warn">${w}</span>`)}</td></tr>`)}</tbody></table></div>
        <div class="row"><${Btn} cls="primary lg" disabled=${!ok.length || map.name === ''} onClick=${run}><${Icon} name="check" /> استيراد ${ok.length} طالب</${Btn}><span class="muted small">الأسطر التي فيها أخطاء لن تُستورد.</span></div>
      ` : null}
    </div></div>`;
}
