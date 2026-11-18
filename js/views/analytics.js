// تحليل الدرجات: مؤشرات، توزيع المستويات، متوسط كل جانب من الدرجة، أداء الاختبارات، الغياب مقابل الدرجة، مقارنة الفصول
import { html, useState } from '../lib.js';
import { ws, all, get, workspace, classes, className } from '../store.js';
import { useStore, Icon, Btn, Empty, toast } from '../ui.js';
import { classGradeRows } from '../gradeutil.js';
import { currentTerm, termRange, evalPeriods, evalRange, defaultPeriod, TERM_LABEL } from '../calendar.js';
import { taskMode, TASK_KINDS } from '../grading.js';
import { printHTML, header } from '../print.js';
import { vbars, hbars, linechart, scatter } from '../charts.js';
import { formatName } from '../display.js';
import { todayISO, fmtShort, getXLSX, escapeHTML as e } from '../utils.js';

export const LEVELS = [
  { name: 'ممتاز', min: 90 }, { name: 'جيد جداً', min: 80 }, { name: 'جيد', min: 70 },
  { name: 'مقبول', min: 60 }, { name: 'ضعيف', min: 50 }, { name: 'دون 50', min: -1, cls: 'crit' },
];
export const levelOf = p => LEVELS.find(l => p >= l.min) || LEVELS[LEVELS.length - 1];
const MEASURE = { grand: 'المجموع (الأدائية + الفترة)', perf: 'الأدائية فقط', monthly: 'اختبارات الفترة فقط' };
const r1 = n => Math.round(n * 10) / 10;
const nStu = n => (n === 1 ? 'طالب واحد' : n === 2 ? 'طالبان' : n <= 10 ? `${n} طلاب` : `${n} طالباً`);
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) : 0; };
const pearson = (xs, ys) => { const n = xs.length; if (n < 5) return null; const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += (xs[i] - mx) * (ys[i] - my); b += (xs[i] - mx) ** 2; c += (ys[i] - my) ** 2; } return b && c ? a / Math.sqrt(b * c) : null; };

export function analyze({ classIds, term, pid = null, measure = 'grand' }) {
  const w = workspace(); const rg = evalRange(w, term, pid); if (!rg) return null;
  const end = rg.end < todayISO() ? rg.end : todayISO();
  const students = [];
  for (const cid of classIds) {
    const c = get('classes', cid); if (!c) continue;
    for (const x of classGradeRows(cid, term, pid)) {
      if (!x.active || !x.g) continue;
      const g = x.g; const perfMax = g.categories.reduce((a, k) => a + (+k.weight || 0), 0) || 40;
      const mo = g.monthly?.final; const moOf = +g.monthly?.weight || 20;
      const pct = measure === 'perf' ? g.total / perfMax * 100 : measure === 'monthly' ? (mo == null ? null : mo / moOf * 100) : (g.total + (mo ?? 0)) / (perfMax + (mo == null ? 0 : moOf)) * 100;
      if (pct == null) continue;
      const att = all('attendance', a => a.student_id === x.student.id && a.class_id === cid && a.date >= rg.start && a.date <= end);
      const cats = g.categories.map(k => ({ name: k.name, pct: k.weight ? k.final / k.weight * 100 : null }));
      if (mo != null) cats.push({ name: 'اختبارات الفترة', pct: mo / moOf * 100 });
      const weak = cats.filter(k => k.pct != null).sort((a, b) => a.pct - b.pct)[0];
      students.push({ st: x.student, c, pct, total: g.total, perfMax, mo, moOf, cats, weak,
        absent: att.filter(a => a.status.startsWith('absent')).length, late: att.filter(a => a.status === 'late').length });
    }
  }
  const P = students.map(s => s.pct);
  const stats = { n: P.length, mean: mean(P), median: median(P), max: P.length ? Math.max(...P) : null, min: P.length ? Math.min(...P) : null, sd: sd(P),
    pass: P.filter(p => p >= 50).length, excel: P.filter(p => p >= 90).length };
  const levels = LEVELS.map(l => ({ ...l, n: students.filter(s => levelOf(s.pct) === l).length }));
  const catNames = [...new Set(students.flatMap(s => s.cats.map(k => k.name)))];
  const catAvg = catNames.map(name => { const v = students.map(s => s.cats.find(k => k.name === name)?.pct).filter(v => v != null); return { name, avg: mean(v), below: v.filter(x => x < 50).length, n: v.length }; });
  // الاختبارات والمهام بالدرجات
  const idset = new Set(classIds);
  const tasks = ws('tasks', t => !t.deleted && t.kind !== 'final' && taskMode(t) !== 'status' && (t.class_ids || []).some(c => idset.has(c)) && t.date >= rg.start && t.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  const sids = new Set(students.map(s => s.st.id));
  const taskStats = tasks.map(t => {
    const v = all('task_results', r => r.task_id === t.id && sids.has(r.student_id) && r.score != null && r.score !== '' && r.status !== 'excused').map(r => +r.score / (+t.max_score || 1) * 100);
    return { t, n: v.length, avg: mean(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null, below: v.filter(x => x < 50).length };
  }).filter(x => x.n);
  const byClass = classIds.map(cid => { const s = students.filter(x => x.c.id === cid); const p = s.map(x => x.pct); return { c: get('classes', cid), n: s.length, avg: mean(p), pass: p.filter(x => x >= 50).length, excel: p.filter(x => x >= 90).length }; }).filter(x => x.n);
  const corr = pearson(students.map(s => s.absent), P);
  return { rg, students, stats, levels, catAvg, taskStats, byClass, corr };
}

function insights(A, compare) {
  const out = []; const s = A.stats; if (!s.n) return out;
  out.push(`متوسط ${compare ? 'الطلاب' : 'الفصل'} ${r1(s.mean)}% (مستوى «${levelOf(s.mean).name}»)، والوسيط ${r1(s.median)}%، والانحراف المعياري ${r1(s.sd)} ${s.sd > 18 ? '— تفاوت كبير بين الطلاب' : s.sd < 8 ? '— مستويات متقاربة' : ''}.`);
  out.push(`نسبة النجاح ${r1(s.pass / s.n * 100)}% (${s.pass} من ${s.n})، ونسبة التفوق (90% فأعلى) ${r1(s.excel / s.n * 100)}%.`);
  const cats = A.catAvg.filter(k => k.avg != null).sort((a, b) => a.avg - b.avg);
  if (cats.length > 1) out.push(`أضعف جانب: «${cats[0].name}» بمتوسط ${r1(cats[0].avg)}%${cats[0].below ? ` و${nStu(cats[0].below)} دون 50% فيه` : ''}، وأقوى جانب: «${cats.at(-1).name}» ${r1(cats.at(-1).avg)}%.`);
  const low = A.students.filter(x => x.pct < 50);
  if (low.length) out.push(`${nStu(low.length)} دون 50% ${low.length === 1 ? 'يحتاج' : 'يحتاجون'} خطة علاجية — أكثر ما يُضعفهم: ${[...low.reduce((m, x) => m.set(x.weak?.name, (m.get(x.weak?.name) || 0) + 1), new Map())].filter(([k]) => k).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `«${k}» (${n})`).join(' و')}.`);
  const tw = [...A.taskStats].sort((a, b) => a.avg - b.avg)[0];
  if (tw && A.taskStats.length > 1) out.push(`أصعب اختبار/مهمة: «${tw.t.title}» بمتوسط ${r1(tw.avg)}%${tw.below ? ` (${tw.below} دون 50%)` : ''} — قد يحتاج موضوعه إعادة شرح.`);
  if (A.corr != null) out.push(A.corr <= -0.4 ? `علاقة واضحة بين الغياب وانخفاض الدرجة (معامل الارتباط ${r1(A.corr)}).` : A.corr <= -0.2 ? `علاقة ضعيفة بين الغياب وانخفاض الدرجة (معامل الارتباط ${r1(A.corr)}).` : `لا تظهر علاقة واضحة بين الغياب والدرجة (معامل الارتباط ${r1(A.corr)}).`);
  if (compare && A.byClass.length > 1) { const b = [...A.byClass].sort((a, c) => c.avg - a.avg); out.push(`أعلى فصل: ${className(b[0].c)} (${r1(b[0].avg)}%)، وأدناها: ${className(b.at(-1).c)} (${r1(b.at(-1).avg)}%).`); }
  return out;
}

const charts = (A, compare) => ({
  levels: vbars(A.levels.map(l => ({ label: l.name, value: l.n, cls: l.cls, sub: A.stats.n ? `${Math.round(l.n / A.stats.n * 100)}%` : '', tip: `${l.name}: ${l.n} طالب` }))),
  cats: hbars(A.catAvg.filter(k => k.avg != null).map(k => ({ label: k.name, value: k.avg, cls: k.avg < 50 ? 'crit' : '', tip: `${k.name}: متوسط ${r1(k.avg)}%${k.below ? ` — ${nStu(k.below)} دون 50%` : ''}` }))),
  tasks: A.taskStats.length ? linechart(A.taskStats.map(x => ({ label: x.t.title, label2: fmtShort(x.t.date), value: x.avg, lo: x.min, hi: x.max, tip: `${x.t.title} (${TASK_KINDS[x.t.kind]}) — المتوسط ${r1(x.avg)}% • الأدنى ${r1(x.min)}% • الأعلى ${r1(x.max)}% • ${x.n} طالب${x.below ? ` • ${x.below} دون 50%` : ''}` })), { ref: 50 }) : '',
  scatter: scatter(A.students.map(s => ({ x: s.absent, y: s.pct, cls: s.pct < 50 ? 'crit' : '', tip: `${s.st.full_name}: ${r1(s.pct)}% — غياب ${s.absent}` })), { xLabel: 'عدد مرات الغياب', yLabel: 'الدرجة %' }),
  classes: compare && A.byClass.length > 1 ? vbars(A.byClass.map(b => ({ label: className(b.c), value: b.avg, unit: '%', label2: `نجاح ${Math.round(b.pass / b.n * 100)}%`, tip: `${className(b.c)}: المتوسط ${r1(b.avg)}% • ${b.n} طالب • نجاح ${b.pass} • تفوق ${b.excel}` })), { max: 100, unit: '%' }) : '',
});

function reportHTML(A, { title, meta, compare }) {
  const C = charts(A, compare); const s = A.stats; const ins = insights(A, compare);
  const low = A.students.filter(x => x.pct < 60).sort((a, b) => a.pct - b.pct);
  const top = [...A.students].sort((a, b) => b.pct - a.pct).slice(0, 10);
  const kpi = [['عدد الطلاب', s.n], ['المتوسط', r1(s.mean) + '%'], ['الوسيط', r1(s.median) + '%'], ['أعلى', r1(s.max) + '%'], ['أدنى', r1(s.min) + '%'], ['الانحراف المعياري', r1(s.sd)], ['النجاح', Math.round(s.pass / s.n * 100) + '%'], ['التفوق', Math.round(s.excel / s.n * 100) + '%']];
  return `<section class="pr-page rp-page an-print">${header(title, meta)}
    <div class="an-kpis">${kpi.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
    <div class="an-ins"><b>قراءة سريعة</b><ul>${ins.map(t => `<li>${e(t)}</li>`).join('')}</ul></div>
    <div class="an-two"><div><h3>توزيع الطلاب على المستويات</h3>${C.levels}</div><div><h3>متوسط كل جانب من الدرجة (%)</h3>${C.cats}</div></div>
    ${C.classes ? `<h3>مقارنة الفصول (المتوسط %)</h3>${C.classes}` : ''}
    ${C.tasks ? `<h3>أداء الطلاب في الاختبارات والمهام (المتوسط، والخط العمودي = من الأدنى إلى الأعلى)</h3>${C.tasks}` : ''}
    <div class="an-two"><div><h3>الغياب مقابل الدرجة</h3>${C.scatter}</div><div><h3>الأعلى درجة</h3><table class="pr"><thead><tr><th>#</th><th>الطالب</th>${compare ? '<th>الفصل</th>' : ''}<th>%</th></tr></thead><tbody>${top.map((x, i) => `<tr><td>${i + 1}</td><td class="nm">${e(formatName(x.st.full_name, 3))}</td>${compare ? `<td>${e(className(x.c))}</td>` : ''}<td>${r1(x.pct)}</td></tr>`).join('')}</tbody></table></div></div>
    <h3>طلاب يحتاجون دعماً (دون 60%)</h3>
    ${low.length ? `<table class="pr"><thead><tr><th>#</th><th>الطالب</th>${compare ? '<th>الفصل</th>' : ''}<th>%</th><th>المستوى</th><th>أضعف جانب</th><th>الغياب</th></tr></thead><tbody>${low.map((x, i) => `<tr><td>${i + 1}</td><td class="nm">${e(x.st.full_name)}</td>${compare ? `<td>${e(className(x.c))}</td>` : ''}<td>${r1(x.pct)}</td><td>${levelOf(x.pct).name}</td><td>${e(x.weak ? `${x.weak.name} (${r1(x.weak.pct)}%)` : '—')}</td><td>${x.absent}</td></tr>`).join('')}</tbody></table>` : '<p>لا يوجد طلاب دون 60%.</p>'}
    <div class="rp-note">النسب محسوبة من «${e(meta.find(m => m[0] === 'المقياس')?.[1] || '')}». طُبع في ${fmtShort(todayISO())}.</div></section>`;
}

export function AnalyticsPage({ q = {} }) {
  useStore();
  const w = workspace(); const cls = classes(); const today = todayISO();
  const [cid, setCid] = useState(q.class || cls[0]?.id || 'all');
  const [term, setTerm0] = useState(+q.term || currentTerm(w, today) || 1);
  const [pid, setPid] = useState(null);
  const [measure, setMeasure] = useState('grand');
  const setTerm = t => { setTerm0(t); setPid(null); };
  if (!cls.length) return html`<div class="page"><${Empty} icon="users" title="أضف فصلاً أولاً" /></div>`;
  const compare = cid === 'all' || cid.startsWith('g:');
  const ids = cid === 'all' ? cls.map(c => c.id) : cid.startsWith('g:') ? cls.filter(c => String(c.grade) === cid.slice(2)).map(c => c.id) : [cid];
  const A = analyze({ classIds: ids, term, pid, measure });
  const periods = evalPeriods(w, term);
  const grades = [...new Set(cls.map(c => c.grade))];
  const scopeLabel = cid === 'all' ? 'كل الفصول' : cid.startsWith('g:') ? `كل فصول ${cls.find(c => String(c.grade) === cid.slice(2)) ? className(cls.find(c => String(c.grade) === cid.slice(2))).split('/')[0].trim() : ''}` : className(get('classes', cid));
  const meta = A ? [['النطاق', scopeLabel], ['الفصل الدراسي', TERM_LABEL[term]], ['الفترة', A.rg.label || A.rg.short || 'الفصل كاملاً'], ['المقياس', MEASURE[measure]]] : [];
  const C = A && A.stats.n ? charts(A, compare) : null;
  const doPrint = () => printHTML(reportHTML(A, { title: 'تحليل درجات الطلاب', meta, compare }));
  const doExcel = async () => {
    const XLSX = await getXLSX(); const names = A.catAvg.map(k => k.name);
    const rows = [['الطالب', 'الفصل', 'النسبة %', 'المستوى', 'الأدائية', 'اختبارات الفترة', ...names.map(n => n + ' %'), 'الغياب', 'التأخر', 'أضعف جانب'],
      ...[...A.students].sort((a, b) => b.pct - a.pct).map(x => [x.st.full_name, className(x.c), r1(x.pct), levelOf(x.pct).name, r1(x.total), x.mo == null ? '' : r1(x.mo), ...names.map(n => { const k = x.cats.find(y => y.name === n); return k?.pct == null ? '' : r1(k.pct); }), x.absent, x.late, x.weak?.name || ''])];
    const sh = XLSX.utils.aoa_to_sheet(rows); sh['!cols'] = [{ wch: 34 }, { wch: 14 }, ...rows[0].slice(2).map(() => ({ wch: 12 }))];
    const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, sh, 'التحليل');
    XLSX.writeFile(wb, `تحليل-الدرجات-${scopeLabel}-ف${term}.xlsx`.replace(/[\\/:*?"<>|]/g, '-'));
  };
  const s = A?.stats;
  const low = A ? A.students.filter(x => x.pct < 60).sort((a, b) => a.pct - b.pct) : [];
  const top = A ? [...A.students].sort((a, b) => b.pct - a.pct).slice(0, 10) : [];
  return html`<div class="page wide">
    <div class="page-head"><div><h1>تحليل الدرجات</h1><div class="sub">مستويات الطلاب، نقاط القوة والضعف، أداء الاختبارات، وأثر الغياب — لفصل أو للمقارنة بين الفصول.</div></div>
      <div class="actions">${s?.n ? html`<${Btn} onClick=${doExcel}><${Icon} name="download" /> Excel</${Btn}><${Btn} cls="primary" onClick=${doPrint}><${Icon} name="print" /> طباعة التقرير (PDF)</${Btn}>` : null}</div></div>
    <div class="card" style="margin-bottom:12px"><div class="row">
      <select style="max-width:230px" value=${cid} onChange=${ev => setCid(ev.target.value)}>
        <optgroup label="فصل واحد">${cls.map(c => html`<option value=${c.id}>${className(c)}</option>`)}</optgroup>
        <optgroup label="مقارنة">${grades.length > 1 ? grades.map(g => html`<option value=${'g:' + g}>كل فصول ${className(cls.find(c => c.grade === g)).split('/')[0].trim()}</option>`) : null}<option value="all">كل الفصول</option></optgroup></select>
      <div class="chips">${[1, 2].map(t => html`<button class=${'chip' + (term === t ? ' on' : '')} onClick=${() => setTerm(t)}>${TERM_LABEL[t]}</button>`)}</div>
      ${periods.length ? html`<div class="chips"><button class=${'chip' + (!pid ? ' on' : '')} onClick=${() => setPid(null)}>الفصل كاملاً</button>${periods.map(p => html`<button class=${'chip' + (pid === p.id ? ' on' : '')} onClick=${() => setPid(p.id)}>${p.label}</button>`)}</div>` : null}
      <span class="grow"></span>
      <select style="width:auto" value=${measure} onChange=${ev => setMeasure(ev.target.value)}>${Object.entries(MEASURE).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></div></div>
    ${!A ? html`<div class="notice">حدد تواريخ الفصل الدراسي من الإعدادات ← التقويم.</div>` : !s.n ? html`<div class="card"><${Empty} icon="grades" title="لا توجد درجات كافية للتحليل">${measure === 'monthly' ? 'لم تُرصد اختبارات فترة بعد.' : 'ارصد المشاركات والواجبات والاختبارات أولاً.'}</${Empty}></div>` : html`
    <div class="stats an-stats">
      ${[['عدد الطلاب', s.n], ['المتوسط', r1(s.mean) + '%'], ['الوسيط', r1(s.median) + '%'], ['أعلى درجة', r1(s.max) + '%'], ['أدنى درجة', r1(s.min) + '%'], ['الانحراف المعياري', r1(s.sd)], ['نسبة النجاح', Math.round(s.pass / s.n * 100) + '%'], ['نسبة التفوق', Math.round(s.excel / s.n * 100) + '%']].map(([k, v]) => html`<div class="stat"><b>${v}</b><span>${k}</span></div>`)}</div>
    <div class="card an-ins"><h2 style="margin:0 0 6px"><${Icon} name="bolt" /> قراءة سريعة</h2><ul>${insights(A, compare).map(t => html`<li>${t}</li>`)}</ul></div>
    <div class="grid-2 an-grid">
      <div class="card"><h2>توزيع الطلاب على المستويات</h2><div class="vz-box" dangerouslySetInnerHTML=${{ __html: C.levels }}></div><p class="muted small">ممتاز 90+ • جيد جداً 80+ • جيد 70+ • مقبول 60+ • ضعيف 50+</p></div>
      <div class="card"><h2>متوسط كل جانب من الدرجة</h2><div class="vz-box" dangerouslySetInnerHTML=${{ __html: C.cats }}></div><p class="muted small">النسبة من وزن كل جانب. الأحمر = متوسطه دون 50%.</p></div>
      ${C.classes ? html`<div class="card span-2"><h2>مقارنة الفصول</h2><div class="vz-box" dangerouslySetInnerHTML=${{ __html: C.classes }}></div></div>` : null}
      ${C.tasks ? html`<div class="card span-2"><h2>أداء الطلاب في الاختبارات والمهام</h2><div class="vz-box scroll" dangerouslySetInnerHTML=${{ __html: C.tasks }}></div><p class="muted small">النقطة = المتوسط، والخط العمودي = من أدنى إلى أعلى درجة، والخط المتقطع = 50%. مرّر على النقطة للتفاصيل.</p></div>` : null}
      <div class="card"><h2>الغياب مقابل الدرجة</h2><div class="vz-box" dangerouslySetInnerHTML=${{ __html: C.scatter }}></div><p class="muted small">كل نقطة طالب. ${A.corr != null ? `معامل الارتباط ${r1(A.corr)}.` : ''}</p></div>
      <div class="card"><h2>الأعلى درجة</h2><table class="tbl"><tbody>${top.map((x, i) => html`<tr><td class="num">${i + 1}</td><td><a href=${'#/student/' + x.st.id}>${formatName(x.st.full_name, 3)}</a>${compare ? html` <span class="muted small">${className(x.c)}</span>` : null}</td><td class="num"><b>${r1(x.pct)}%</b></td><td><span class="badge pos">${levelOf(x.pct).name}</span></td></tr>`)}</tbody></table></div>
    </div>
    <div class="card" style="margin-top:14px"><h2>طلاب يحتاجون دعماً <span class="badge neg">${low.length}</span></h2>
      ${low.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>الطالب</th>${compare ? html`<th>الفصل</th>` : null}<th class="num">%</th><th>المستوى</th><th>أضعف جانب</th><th class="num">الغياب</th></tr></thead><tbody>
        ${low.map((x, i) => html`<tr><td class="num">${i + 1}</td><td><a href=${'#/student/' + x.st.id}>${x.st.full_name}</a></td>${compare ? html`<td>${className(x.c)}</td>` : null}<td class="num"><b>${r1(x.pct)}</b></td><td><span class=${'badge ' + (x.pct < 50 ? 'neg' : 'warn')}>${levelOf(x.pct).name}</span></td><td>${x.weak ? `${x.weak.name} (${r1(x.weak.pct)}%)` : '—'}</td><td class="num">${x.absent}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">لا يوجد طلاب دون 60% 🎉</p>`}</div>`}
  </div>`;
}
