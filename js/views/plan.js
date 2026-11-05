// المرحلة 3 — صفحة الخطة السنوية: الدروس، الاستيراد، التوزيع التلقائي، والتقدم لكل شعبة
import { html, useState } from '../lib.js';
import { ws, get, save, saveMany, patch, purge, audit, classes, className, workspace } from '../store.js';
import { useStore, Icon, Btn, Empty, formDialog, confirmDialog, toast } from '../ui.js';
import { lessonsFor, progress, lessonSpans } from '../plan.js';
import { currentTerm, termRange } from '../calendar.js';
import { todayISO, getXLSX, normAr, normDigits, fmtShort, GRADE_NAMES, DAY_SHORT, dow } from '../utils.js';

export const statusText = p => p.status === 'none' ? 'لا توجد خطة' : p.diff === 0 ? 'وفق الخطة' : p.diff > 0 ? `متقدم ${p.diff} حصة` : `متأخر ${-p.diff} حصة`;
export const statusCls = p => p.status === 'behind' ? 'neg' : p.status === 'ahead' ? 'pri' : p.status === 'none' ? '' : 'pos';

export function PlanPage() {
  useStore();
  const w = workspace();
  const grades = [...new Set(classes().map(c => +c.grade))].sort();
  const [grade, setGrade] = useState(grades[0] || 1);
  const [term, setTerm] = useState(currentTerm(w, todayISO()));
  const [open, setOpen] = useState(null);
  const lessons = lessonsFor(grade, term);
  const total = lessons.reduce((a, l) => a + (+l.periods || 1), 0);
  const cls = classes().filter(c => +c.grade === +grade);
  const r = termRange(w, term);

  const add = async () => {
    const v = await formDialog({ title: 'درس جديد', fields: [
      { name: 'unit', label: 'الوحدة', value: lessons[lessons.length - 1]?.unit || '' },
      { name: 'title', label: 'الدرس', required: true, full: true },
      { name: 'periods', label: 'عدد الحصص المخطط', type: 'number', min: 1, value: 1, required: true },
    ] });
    if (v) await save('plan_lessons', { grade: +grade, term: +term, unit: v.unit, title: v.title, periods: +v.periods || 1, order: lessons.length });
  };
  const setL = (l, k, v) => patch('plan_lessons', l.id, { [k]: k === 'periods' ? Math.max(1, +normDigits(v) || 1) : v });
  const move = async (i, d) => { const j = i + d; if (j < 0 || j >= lessons.length) return; await saveMany('plan_lessons', lessons.map((l, k) => ({ ...l, order: k === i ? j : k === j ? i : k }))); };
  const importX = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const XLSX = await getXLSX();
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false }).filter(x => x.some(c => String(c).trim()));
      const head = rows[0].map(h => normAr(h));
      const col = keys => head.findIndex(h => keys.some(k => h.includes(k)));
      const cu = col(['وحده', 'unit']), ct = col(['درس', 'موضوع', 'lesson']), cp = col(['حصص', 'عدد', 'periods']);
      if (ct < 0) throw new Error('لم أجد عمود «الدرس» في الصف الأول');
      const items = rows.slice(1).map(x => ({ unit: cu >= 0 ? String(x[cu]).trim() : '', title: String(x[ct]).trim(), periods: cp >= 0 ? Math.max(1, +normDigits(x[cp]) || 1) : 1 })).filter(x => x.title);
      if (!items.length) throw new Error('الملف لا يحتوي دروساً');
      let replace = false;
      if (lessons.length) replace = await confirmDialog({ title: 'استيراد الخطة', message: `يوجد ${lessons.length} درس. «استبدال» يحذفها ويضع ${items.length} درساً من الملف، و«إلغاء» يضيفها في آخر القائمة.`, okText: 'استبدال' });
      if (replace) await purge('plan_lessons', lessons.map(l => l.id));
      const start = replace ? 0 : lessons.length;
      await saveMany('plan_lessons', items.map((x, i) => ({ grade: +grade, term: +term, ...x, order: start + i })));
      await audit('استيراد الخطة السنوية', `${GRADE_NAMES[grade]} ف${term}: ${items.length} درس`);
      toast(`استُورد ${items.length} درساً`, 'ok');
    } catch (err) { toast(err.message, 'err', 5000); }
  };
  return html`<div class="page">
    <div class="page-head"><div><h1>الخطة السنوية</h1><div class="sub">تُوزَّع الدروس تلقائياً على الحصص الفعلية المتاحة بعد استبعاد الإجازات والاختبارات والحصص الملغاة وغياب المعلم، ويُعاد التوزيع عند أي تغيير.</div></div>
      <div class="actions"><label class="btn"><${Icon} name="upload" /> استيراد Excel<input type="file" hidden accept=".xlsx,.xls,.csv" onChange=${importX} /></label><${Btn} cls="primary" onClick=${add}><${Icon} name="plus" /> درس</${Btn}></div></div>
    <div class="row" style="margin-bottom:14px"><div class="chips">${(grades.length ? grades : [1, 2, 3]).map(g => html`<button class=${'chip' + (+grade === g ? ' on' : '')} onClick=${() => setGrade(g)}>${GRADE_NAMES[g] || g}</button>`)}</div><span class="grow"></span>
      <div class="chips">${[1, 2].map(t => html`<button class=${'chip' + (term === t ? ' on' : '')} onClick=${() => setTerm(t)}>الفصل الدراسي ${t === 1 ? 'الأول' : 'الثاني'}</button>`)}</div></div>
    ${!r ? html`<div class="notice" style="margin-bottom:12px">حدد تواريخ الفصل الدراسي من الإعدادات ← التقويم.</div>` : null}
    ${cls.length && lessons.length ? html`<div class="grid-2" style="margin-bottom:16px">${cls.map(c => { const p = progress(c.id, term); return html`<div class="card stack">
      <div class="row"><h2 style="margin:0">${className(c)}</h2><span class="grow"></span><span class=${'badge ' + statusCls(p)}>${statusText(p)}</span></div>
      <div class="g-bar" style="position:relative"><i style=${`width:${p.total ? p.done / p.total * 100 : 0}%`}></i></div>
      <div class="small muted">شُرح ${p.done} من ${p.total} حصة مخططة • المفترض حتى الآن ${p.plannedSoFar} • المتاح في الفصل ${p.available}</div>
      ${p.next ? html`<div><span class="muted small">التالي فعلياً:</span> <b>${p.next.lesson.title}</b> ${p.next.of > 1 ? html`<span class="muted small">(${p.next.k} من ${p.next.of})</span>` : null}</div>` : html`<div class="info small">اكتملت الخطة 🎉</div>`}
      ${p.shortfall > 0 ? html`<div class="notice small">الخطة تحتاج ${p.shortfall} حصة أكثر من المتاح في الفصل الدراسي.</div>` : null}
      <button class="btn sm ghost" style="justify-self:start" onClick=${() => setOpen(open === c.id ? null : c.id)}>${open === c.id ? 'إخفاء' : 'عرض'} التوزيع على الحصص</button>
    </div>`; })}</div>` : null}
    ${open ? html`<${DistTable} classId=${open} term=${term} lessons=${lessons} />` : null}
    <div class="card"><div class="row" style="margin-bottom:10px"><h2 style="margin:0">دروس ${GRADE_NAMES[grade] || grade} — الفصل ${term === 1 ? 'الأول' : 'الثاني'}</h2><span class="badge pri">${lessons.length} درس • ${total} حصة</span></div>
      ${lessons.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>الوحدة</th><th>الدرس</th><th class="num">الحصص</th><th></th></tr></thead><tbody>
        ${lessons.map((l, i) => html`<tr key=${l.id}><td class="num">${i + 1}</td>
          <td><input value=${l.unit || ''} onChange=${e => setL(l, 'unit', e.target.value)} style="min-width:120px" /></td>
          <td><input value=${l.title} onChange=${e => setL(l, 'title', e.target.value)} style="min-width:220px" /></td>
          <td class="num"><input type="number" min="1" value=${l.periods} onChange=${e => setL(l, 'periods', e.target.value)} style="width:72px;text-align:center" /></td>
          <td style="white-space:nowrap"><button class="icon-btn" onClick=${() => move(i, -1)}>▲</button><button class="icon-btn" onClick=${() => move(i, 1)}>▼</button><button class="icon-btn" onClick=${async () => { if (await confirmDialog({ title: 'حذف الدرس', message: l.title, danger: true, okText: 'حذف' })) await purge('plan_lessons', [l.id]); }}><${Icon} name="trash" size=${16} /></button></td></tr>`)}
      </tbody></table></div>` : html`<${Empty} icon="calendar" title="لا توجد دروس بعد">استورد ملف Excel بأعمدة (الوحدة، الدرس، عدد الحصص) أو أضف الدروس يدوياً.</${Empty}>`}
      <p class="muted small">في شاشة الحصة يظهر الدرس المخطط لذلك اليوم وزر «تم الشرح»؛ كل ضغطة تقدّم الشعبة حصة في الخطة.</p></div>
  </div>`;
}

function DistTable({ classId, term, lessons }) {
  const sp = lessonSpans(classId, term);
  const today = todayISO();
  return html`<div class="card" style="margin-bottom:16px"><h2>التوزيع على الحصص — ${className(get('classes', classId))}</h2>
    <div class="table-wrap"><table class="tbl nowrap"><thead><tr><th>الدرس</th><th class="num">الحصص</th><th>من</th><th>إلى</th></tr></thead><tbody>
      ${lessons.map(l => { const s = sp.get(l.id); const fmt = m => m ? `${DAY_SHORT[dow(m.date)]} ${fmtShort(m.date)} ح${m.period}` : '—'; const now = s && s.first.date <= today && s.last.date >= today; return html`<tr style=${now ? 'background:var(--primary-soft)' : ''}><td>${l.unit ? html`<span class="muted small">${l.unit} — </span>` : null}${l.title}</td><td class="num">${s?.n || 0}${s && s.n < l.periods ? html` <span class="badge neg">ناقص ${l.periods - s.n}</span>` : null}</td><td>${fmt(s?.first)}</td><td>${fmt(s?.last)}</td></tr>`; })}
    </tbody></table></div></div>`;
}
