// الدرجات: جدول الفصل، الاعتماد بلقطة، التصدير، وشاشة شرح الدرجة مع التعديل اليدوي
import { html, useState } from '../lib.js';
import { SchemeFix } from './gradebook.js';
import { ws, get, save, patch, audit, classes, className, workspace, S } from '../store.js';
import { useStore, Icon, Btn, Empty, go, formDialog, confirmDialog, toast, Avatar } from '../ui.js';
import { classGradeRows, gradeStudent, schemeFor, lockFor } from '../gradeutil.js';
import { currentTerm, termRange, evalPeriods, evalRange, defaultPeriod } from '../calendar.js';
import { METHODS, OCC_STATUS } from '../grading.js';
import { todayISO, fmtDate, fmtNum, getXLSX, fmtDateTime, fmtShort } from '../utils.js';
import { printHTML, gradeBreakdownSheet, classGradesSheet } from '../print.js';

function Cat({ k, override, removeOv }) {
  return html`<div class="g-cat">
    <div class="g-top"><b style="font-size:1.05rem">${k.name}</b>${METHODS[k.method] ? html`<span class="badge">${METHODS[k.method]}</span>` : null}${k.override ? html`<span class="badge warn">معدلة يدوياً</span>` : null}
      <span class="g-score">${k.final == null ? '—' : fmtNum(k.final)} <small>/ ${k.weight}</small></span></div>
    <div class="g-bar"><i style=${`width:${k.final == null ? 0 : Math.round(k.final / k.weight * 100)}%`}></i></div>
    <div class="g-text">${k.text}</div>
    ${k.override ? html`<div class="notice small" style="margin-top:8px">المقترحة ${fmtNum(k.suggested)} ← المعتمدة ${fmtNum(k.final)} — السبب: ${k.override.reason} <span class="muted">(${fmtDateTime(k.override.created_at)})</span></div>` : null}
    ${k.items.length ? html`<details style="margin-top:8px"><summary class="small" style="cursor:pointer">التفاصيل (${k.items.length})</summary><div class="g-items">${k.items.map(it => it.type
      ? html`<div><span class="muted small" style="min-width:90px">${fmtDate(it.date, 'g')}${it.period ? ` ح${it.period}` : ''}</span><span class=${'mk ' + (it.type.valence || 'neu')}>${it.type.code || '•'}</span><span class="grow">${it.type.name}${it.derived ? ' (من الحضور)' : ''}</span>
          <b class=${it.status !== 'applied' ? 'muted' : it.points < 0 ? '' : ''} style=${it.status === 'applied' ? `color:var(--${it.points < 0 ? 'neg' : it.points > 0 ? 'pos' : 'neu'})` : ''}>${it.status === 'applied' ? (it.points > 0 ? '+' : '') + fmtNum(it.points) : OCC_STATUS[it.status]}</b></div>`
      : html`<div><span class="muted small" style="min-width:90px">${fmtDate(it.date, 'g')}</span><span class="grow">${it.title}${it.makeup ? ' (تعويضي)' : ''}${it.note ? ` — ${it.note}` : ''}</span><b>${it.excluded ? html`<span class="muted">${it.excluded}</span>` : `${fmtNum(it.earned)} / ${it.max}`}</b></div>`)}</div></details>` : null}
    <div class="row" style="margin-top:10px"><button class="btn sm" onClick=${() => override(k)}><${Icon} name="edit" size=${16} /> تعديل يدوي</button>${k.override ? html`<button class="btn sm ghost" onClick=${() => removeOv(k)}>إلغاء التعديل</button>` : null}</div>
  </div>`;
}

const cell = (v, ov) => v == null ? html`<span class="null">—</span>` : html`<span class=${ov ? 'ov' : ''} title=${ov ? 'معدلة يدوياً: ' + ov.reason : ''}>${fmtNum(v)}${ov ? '*' : ''}</span>`;

export function GradesPage({ q = {} }) {
  useStore();
  const cls = classes(); const w = workspace();
  const [cid, setCid] = useState(q.class || cls[0]?.id || '');
  const [term, setTerm0] = useState(+q.term || currentTerm(w, todayISO()));
  const [pid, setPid] = useState(q.p !== undefined ? (q.p || null) : defaultPeriod(w, +q.term || currentTerm(w, todayISO()), todayISO()));
  const setTerm = t => { setTerm0(t); setPid(defaultPeriod(w, t, todayISO())); };
  const periods = evalPeriods(w, term);
  const pidOk = pid && periods.some(p => p.id === pid) ? pid : null;
  const rng = evalRange(w, term, pidOk);
  const pq = pidOk ? `?p=${pidOk}` : '';
  const c = get('classes', cid);
  if (!cls.length) return html`<div class="page"><div class="card"><${Empty} icon="grades" title="لا توجد فصول بعد" /></div></div>`;
  const r = termRange(w, term);
  const scheme = c ? schemeFor(c.grade, term) : null;
  const rows = c && r ? classGradeRows(c.id, term, pidOk) : [];
  const lock = c ? lockFor(c.id, term, pidOk) : null;
  const snap = lock ? new Map(lock.snapshot.students.map(s => [s.student_id, s])) : null;
  const incomplete = rows.filter(x => x.active && !x.g.complete).length;

  const approve = async () => {
    const msg = incomplete ? `\n\nتنبيه: ${incomplete} طالب لديهم فئات بلا بيانات (تُحسب صفراً في اللقطة).` : '';
    if (!await confirmDialog({ title: 'اعتماد الدرجات', message: `سيُقفل «${rng.label}» لهذا الفصل بلقطة محفوظة لدرجات ${rows.length} طالب.${msg}`, okText: 'اعتماد' })) return;
    const snapshot = { scheme: scheme.categories.map(c => ({ key: c.key, name: c.name, weight: c.weight })), students: rows.map(x => ({ student_id: x.student.id, name: x.student.full_name, seat_no: x.student.seat_no, categories: x.g.categories.map(c => ({ key: c.key, name: c.name, weight: c.weight, suggested: c.suggested, final: c.final, override: c.override ? c.override.reason : null, text: c.text })), total: x.g.total, monthly: x.g.monthly.final, grand: x.g.grand })) };
    await save('grade_locks', { class_id: c.id, term, period: pidOk, period_label: rng.label, range: { start: rng.start, end: rng.end }, active: true, snapshot, locked_at: new Date().toISOString(), by: S.user || 'المعلم' });
    if (workspace()?.portal?.enabled) import('../portal.js').then(m => m.publishSnapshots()).catch(() => {});
    await audit('اعتماد درجات الفصل', `${className(c)} — ${rng.label}`);
    toast('اعتُمدت الدرجات وحُفظت اللقطة', 'ok');
  };
  const unlock = async () => {
    const v = await formDialog({ title: 'فك الاعتماد', fields: [{ name: 'reason', label: 'السبب (إلزامي)', required: true, full: true }], okText: 'فك الاعتماد' });
    if (!v) return;
    await patch('grade_locks', lock.id, { active: false, unlocked_at: new Date().toISOString(), unlock_reason: v.reason });
    await audit('فك اعتماد الدرجات', `${className(c)} — ${rng.label}`, v.reason);
  };
  const exportXlsx = async () => {
    const XLSX = await getXLSX();
    const head = ['م', 'اسم الطالب', ...scheme.categories.map(c => `${c.name} (${c.weight})`), 'الأدائية (40)', `الشهري (${scheme.monthly?.outOf || 20})`, 'المجموع', 'الحالة'];
    const data = rows.map((x, i) => {
      const sv = snap?.get(x.student.id);
      const cats = sv ? sv.categories.map(c => c.final) : x.g.categories.map(c => c.final);
      return [x.student.seat_no || i + 1, x.student.full_name, ...cats.map(v => v ?? ''), sv ? sv.total : x.g.total, (sv ? sv.monthly : x.g.monthly.final) ?? '', sv ? sv.grand : x.g.grand, x.active ? '' : 'منسحب/منقول'];
    });
    const sh = XLSX.utils.aoa_to_sheet([head, ...data]);
    sh['!cols'] = [{ wch: 5 }, { wch: 32 }, ...head.slice(2).map(() => ({ wch: 14 }))];
    const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, sh, 'الدرجات');
    XLSX.writeFile(wb, `درجات ${className(c).replace(/\//g, '-')} ف${term}${pidOk ? ' ' + rng.short : ''}.xlsx`);
  };
  return html`<div class="page">
    <div class="page-head"><div><h1>الدرجات</h1><div class="sub">الدرجة الأدائية (40) والاختبارات الشهرية (${scheme?.monthly?.outOf || 20})</div></div>
      <div class="actions">${c ? html`<button class="btn" onClick=${() => printHTML(classGradesSheet({ cls: c, term, rows, scheme, label: rng?.label }))}><${Icon} name="print" /> طباعة</button><${Btn} cls="" onClick=${exportXlsx}><${Icon} name="download" /> Excel</${Btn}>
        ${lock ? html`<${Btn} cls="danger-soft" onClick=${unlock}>فك الاعتماد</${Btn}>` : html`<${Btn} cls="primary" onClick=${approve}><${Icon} name="check" /> اعتماد ${pidOk ? rng.short : 'درجات الفصل'}</${Btn}>`}` : null}</div></div>
    <div class="row" style="margin-bottom:14px"><select style="max-width:240px" value=${cid} onChange=${e => setCid(e.target.value)}>${cls.map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select>
      <div class="chips">${[1, 2].map(t => html`<button class=${'chip' + (term === t ? ' on' : '')} onClick=${() => setTerm(t)}>الفصل الدراسي ${t === 1 ? 'الأول' : 'الثاني'}</button>`)}</div>
      <a class="btn sm ghost" href="#/settings/grading">توزيع الدرجات</a><a class="btn sm soft" href=${`#/gradebook?class=${cid}&term=${term}`}>إدخال درجات الواجبات والاختبارات</a></div>
    ${periods.length ? html`<div class="row" style="margin:-4px 0 14px"><span class="muted small">فترة التقويم:</span><div class="chips">${periods.map(p => html`<button class=${'chip' + (pidOk === p.id ? ' on' : '')} onClick=${() => setPid(p.id)}>${p.label}${p.cumulative ? ' (تراكمي)' : ''}</button>`)}<button class=${'chip' + (!pidOk ? ' on' : '')} onClick=${() => setPid(null)}>الفصل كاملاً</button></div><a class="small" href="#/settings/calendar">ضبط الفترات</a></div>` : null}
    ${rng && periods.length ? html`<div class="info small" style="margin-bottom:12px">«${rng.short}»: يُحتسب من ${fmtDate(rng.start)} إلى ${fmtDate(rng.end)}${rng.cumulative ? ' (تراكمي من بداية الفصل الدراسي)' : ''}. هدف المشاركة يُقسَّم بنسبة الحصص التي حضرها الطالب في هذه المدة.</div>` : null}
    ${!r ? html`<div class="notice">حدد تاريخ بداية ونهاية الفصل الدراسي من الإعدادات ← التقويم.</div>` : null}
    ${lock ? html`<div class="locked-bar"><${Icon} name="check" /> معتمدة بتاريخ ${fmtDateTime(lock.locked_at)} — تُعرض قيم اللقطة المحفوظة. أي تعديل يتطلب فك الاعتماد.</div>` : incomplete ? html`<div class="notice" style="margin-bottom:12px">${incomplete} طالب لديهم فئات بلا بيانات بعد (—). المقترحة تتحدث تلقائياً مع كل حدث.</div>` : null}
    ${c ? html`<${SchemeFix} cid=${c.id} term=${term} />` : null}
    ${c && r ? html`<div class="table-wrap"><table class="tbl nowrap"><thead><tr><th>م</th><th>الطالب</th>${scheme.categories.map(k => html`<th class="num">${k.name}<br /><small>${k.weight} • ${METHODS[k.method]}</small></th>`)}<th class="num">الأدائية<br /><small>40</small></th><th class="num">الشهري<br /><small>${scheme.monthly?.outOf || 20}</small></th><th class="num">المجموع</th></tr></thead>
      <tbody>${rows.map((x, i) => { const sv = snap?.get(x.student.id); return html`<tr class=${'click' + (x.active ? '' : ' voided')} onClick=${() => go(`#/grade/${c.id}/${term}/${x.student.id}${pq}`)}>
        <td class="num">${x.student.seat_no || i + 1}</td><td><span class="row" style="flex-wrap:nowrap"><${Avatar} student=${x.student} size=${30} /> ${x.student.full_name}</span></td>
        ${sv ? sv.categories.map(k => html`<td class="num">${cell(k.final, k.override ? { reason: k.override } : null)}</td>`) : x.g.categories.map(k => html`<td class="num">${cell(k.final, k.override)}</td>`)}
        <td class="num"><b>${fmtNum(sv ? sv.total : x.g.total)}</b></td><td class="num">${cell(sv ? sv.monthly : x.g.monthly.final, sv ? null : x.g.monthly.override)}</td><td class="num"><b>${fmtNum(sv ? sv.grand : x.g.grand)}</b></td></tr>`; })}</tbody></table></div>
      <p class="muted small">* درجة معدلة يدوياً بسبب مسجّل. اضغط على أي طالب لعرض شرح درجته بالتفصيل.</p>` : null}
  </div>`;
}

export function GradeDetailPage({ classId, term, studentId, pid = null }) {
  useStore();
  const c = get('classes', classId); const st = get('students', studentId);
  const rng = evalRange(workspace(), term, pid); const P = rng?.pid || null; const pq = P ? `?p=${P}` : '';
  if (!c || !st) return html`<div class="page"><${Empty} title="غير موجود" /></div>`;
  const g = gradeStudent(studentId, classId, term, { pid: P });
  if (!g) return html`<div class="page"><div class="notice">حدد تواريخ الفصل الدراسي من الإعدادات ← التقويم.</div></div>`;
  const lock = lockFor(classId, term, P);
  const rows = classGradeRows(classId, term, P); const idx = rows.findIndex(x => x.student.id === studentId);
  const nav = d => { const n = rows[idx + d]; if (n) go(`#/grade/${classId}/${term}/${n.student.id}${pq}`); };
  const override = async cat => {
    if (lock) return toast('الدرجات معتمدة؛ فك الاعتماد أولاً من صفحة الدرجات', 'warn');
    const v = await formDialog({ title: `تعديل يدوي: ${cat.name}`, fields: [
      { name: 'value', label: `الدرجة المعتمدة (من ${cat.weight})`, type: 'number', step: '0.25', value: cat.final ?? cat.suggested ?? '', required: true },
      { name: 'reason', label: 'السبب (إلزامي ويُسجَّل)', type: 'textarea', required: true },
    ], validate: v => (+v.value < 0 || +v.value > cat.weight) ? `القيمة يجب أن تكون بين 0 و${cat.weight}` : null });
    if (!v) return;
    await save('grade_overrides', { class_id: classId, student_id: studentId, term, period: P, category: cat.key, value: +v.value, reason: v.reason, suggested_at_time: cat.suggested });
    await audit('تعديل درجة يدوياً', `${st.full_name} — ${rng.short} — ${cat.name}: ${fmtNum(cat.suggested)} ← ${v.value}`, v.reason);
    toast('حُفظ التعديل', 'ok');
  };
  const removeOv = async cat => {
    if (lock) return toast('الدرجات معتمدة؛ فك الاعتماد أولاً', 'warn');
    const v = await formDialog({ title: 'إلغاء التعديل اليدوي', fields: [{ name: 'reason', label: 'السبب', required: true }] });
    if (!v) return;
    for (const o of ws('grade_overrides', o => o.student_id === studentId && o.class_id === classId && +o.term === +term && (o.period || null) === P && o.category === cat.key)) await patch('grade_overrides', o.id, { deleted: true });
    await audit('إلغاء تعديل يدوي', `${st.full_name} — ${cat.name}`, v.reason);
  };
  const a = g.attendance;
  return html`<div class="page">
    <div class="page-head"><a class="icon-btn" href=${`#/grades?class=${classId}&term=${term}&p=${P || ''}`}><${Icon} name="back" /></a><${Avatar} student=${st} size=${56} />
      <div><h1>شرح الدرجة: ${st.full_name}</h1><div class="sub">${className(c)} • ${rng?.label || ''}${P ? ` (${fmtShort(rng.start)} – ${fmtShort(rng.end)})` : ''}</div></div>
      <div class="actions"><button class="btn sm" disabled=${idx <= 0} onClick=${() => nav(-1)}>السابق</button><button class="btn sm" disabled=${idx >= rows.length - 1} onClick=${() => nav(1)}>التالي</button>
        <button class="btn" onClick=${() => printHTML(gradeBreakdownSheet({ student: st, cls: c, term, g, label: rng?.label }))}><${Icon} name="print" /> كشف تفصيل الدرجة</button></div></div>
    ${lock ? html`<div class="locked-bar">الدرجات معتمدة — هذه الشاشة تعرض الحساب الحالي للمراجعة.</div>` : null}
    <div class="grid-2" style="margin-bottom:16px;grid-template-columns:auto 1fr">
      <div class="row" style="gap:14px"><span class="total-badge">${fmtNum(g.total)}<small>من 40</small></span><span class="total-badge" style="background:linear-gradient(135deg,#22c3b2,var(--primary))">${g.monthly.final == null ? '—' : fmtNum(g.monthly.final)}<small>الشهري</small></span></div>
      <div class="stats"><div class="stat"><b>${a.present + a.late}/${a.sessions}</b><span>حصص حضرها</span></div><div class="stat"><b>${a.late}</b><span>تأخر</span></div><div class="stat"><b>${a.absent_excused}</b><span>غياب بعذر</span></div><div class="stat"><b>${a.absent_unexcused}</b><span>غياب بدون عذر</span></div></div>
    </div>
    ${g.categories.map(k => html`<${Cat} k=${k} override=${override} removeOv=${removeOv} />`)}
    <div style="margin-top:10px"><${Cat} k=${{ ...g.monthly, method: '' }} override=${override} removeOv=${removeOv} /></div>
    ${g.finals.length ? html`<div class="card" style="margin-top:10px"><h3>الاختبار النهائي (للعرض فقط)</h3>${g.finals.map(f => html`<div>${f.title}: ${f.excluded ? f.excluded : `${fmtNum(f.earned)} / ${f.max}`}</div>`)}</div>` : null}
  </div>`;
}
