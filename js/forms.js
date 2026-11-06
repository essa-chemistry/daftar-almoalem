// المرحلة 2 — مُنشئات الطباعة للنماذج: رصد مشكلة سلوكية، إحالة طالب، تقرير ولي الأمر
import { workspace, get, className } from './store.js';
import { header } from './print.js';
import { escapeHTML as e, fmtDate, fmtDateLong, fmtNum, todayISO } from './utils.js';
import { REFERRAL_TO, SEVERITIES, RESPONSES } from './defaults.js';
import { METHODS, ATT_STATUS } from './grading.js';

const dots = (v, w = 180) => v ? `<b>${e(v)}</b>` : `<span class="pr-dots" style="min-width:${w}px"></span>`;

// ---------- نموذج رصد المعلم لمشكلة سلوكية (على غرار النموذج الوزاري) ----------
export function behaviorFormSheet({ hdr, subject, cls, rows, teacher, date }) {
  const w = workspace() || {}; const lg = w.logos || {};
  const pages = [];
  const list = rows.length ? rows : [];
  for (let i = 0; i < Math.max(1, Math.ceil(list.length / 5)); i++) {
    const chunk = list.slice(i * 5, i * 5 + 5);
    while (chunk.length < 5) chunk.push(null);
    pages.push(chunk.map((r, j) => ({ r, n: i * 5 + j + 1 })));
  }
  return pages.map(pg => `<section class="pr-page pr-gov">
    <div class="pr-gov-head">
      <div class="r">${e(hdr.line1 || 'المملكة العربية السعودية')}<br>${e(hdr.line2 || 'وزارة التعليم')}</div>
      <div class="c">${lg.ministry ? `<img src="${lg.ministry}" alt="">` : ''}</div>
      <div class="l"><div>المنطقة/المحافظة: ${dots(hdr.region, 120)}</div><div>المدرسة: ${dots(hdr.school, 150)}</div></div>
    </div>
    <div class="pr-title" style="margin:26px 0 22px">نموذج رصد المعلم لمشكلة سلوكية</div>
    <div class="pr-line">المادة: ${dots(subject, 520)}</div>
    <div class="pr-line">الصف: ${dots(cls, 540)}</div>
    <table class="pr pr-beh"><colgroup><col style="width:6mm"><col style="width:32mm"><col style="width:30mm"><col style="width:16mm"><col style="width:28mm"><col style="width:24mm"><col style="width:18mm"><col style="width:20mm"><col style="width:14mm"></colgroup>
      <thead><tr><th>م</th><th>اسم الطالب / الطالبة</th><th>المشكلة السلوكية</th><th>درجة المشكلة</th><th>الإجراء المتخذ</th><th>مدى الاستجابة</th><th>عدد مرات تكرار المشكلة السلوكية</th><th>التاريخ</th><th>الحصة</th></tr></thead>
      <tbody>${pg.map(({ r, n }) => `<tr><td>${r ? n : ''}</td><td class="nm2">${e(r?.name || '')}</td><td>${e(r?.problem || '')}</td><td>${e(r?.severity || '')}</td><td>${e(r?.action || '')}</td><td>${e(r?.response || '')}</td><td>${e(r?.count ?? '')}</td><td>${e(r?.date ? fmtDate(r.date, 'g') : '')}${r?.date ? `<br><span class="pr-small">${e(fmtDate(r.date, 'h'))}</span>` : ''}</td><td>${e(r?.period || '')}</td></tr>`).join('')}</tbody></table>
    <div class="pr-sign-block"><div class="t">المعلم/المعلمة</div><div>الاسم: ${dots(teacher, 150)}</div><div>التوقيع: ${dots('', 150)}</div><div>التاريخ: ${dots(date ? fmtDate(date) : '', 150)}</div></div>
  </section>`).join('');
}

// ---------- نموذج إحالة طالب ----------
export function referralSheet({ ref, reasonsAll }) {
  const w = workspace() || {}; const id = w.identity || {};
  const st = get('students', ref.student_id); const cls = get('classes', ref.class_id);
  const toName = ref.to_name || { deputy: id.deputy, counselor: id.counselor, principal: id.principal }[ref.to_role] || '';
  const check = on => on ? '☑' : '☐';
  const reasons = [...new Set([...reasonsAll, ...(ref.reasons || [])])];
  return `<section class="pr-page">${header('نموذج إحالة طالب', [['التاريخ', fmtDateLong(ref.date)], ['الحصة', ref.period || '—'], ['المادة', ref.subject || id.subject]])}
    <div class="pr-box"><b>المكرم ${e(REFERRAL_TO[ref.to_role] || '')} ${toName ? '/ ' + e(toName) : ''}</b> &nbsp; المحترم<br>السلام عليكم ورحمة الله وبركاته، نحيل إليكم الطالب الموضحة بياناته أدناه للاطلاع واتخاذ ما ترونه مناسباً.</div>
    <table class="pr" style="margin:6px 0"><tbody>
      <tr><th style="width:22%">اسم الطالب</th><td class="nm" style="text-align:right">${e(st?.full_name || '')}</td><th style="width:12%">الفصل</th><td>${e(className(cls))}</td></tr>
      <tr><th>درجة المشكلة</th><td colspan="3" style="text-align:right">${SEVERITIES.map(s => `${check(ref.severity === s)} ${s}`).join(' &nbsp;&nbsp; ')}</td></tr>
    </tbody></table>
    <div class="pr-box"><h4>سبب الإحالة</h4><div class="pr-checks">${reasons.map(r => `<span>${check((ref.reasons || []).includes(r))} ${e(r)}</span>`).join('')}</div></div>
    <div class="pr-box"><h4>وصف الواقعة</h4><div class="pr-pre">${e(ref.description || '') || '<span class="pr-dots" style="width:100%"></span><br><span class="pr-dots" style="width:100%"></span>'}</div></div>
    <div class="pr-box"><h4>ما سبق اتخاذه من إجراءات</h4>${(ref.prior || []).length ? `<ol class="pr-ol">${ref.prior.map(p => `<li>${e(p)}</li>`).join('')}</ol>` : '<span class="pr-dots" style="width:100%"></span>'}</div>
    <div class="pr-box"><h4>المطلوب من المستلم</h4><div class="pr-pre">${e(ref.requested || '') || '<span class="pr-dots" style="width:100%"></span>'}</div></div>
    <div class="pr-sign"><div>المعلم: ${e(id.teacher || '....................')}</div><div>التوقيع: ....................</div></div>
    <div class="pr-box pr-reply"><h4>رد المستلم</h4>
      <div>تم الاطلاع بتاريخ: ...... / ...... / ............</div>
      <div style="display:flex;gap:6px">الإجراء المتخذ: <span class="pr-dots" style="flex:1"></span></div>
      <div style="display:flex"><span class="pr-dots" style="flex:1"></span></div>
      <div>مدى الاستجابة: ${RESPONSES.map(r => `☐ ${r}`).join(' &nbsp; ')}</div>
      <div class="pr-sign" style="margin-top:8px"><div>الاسم: ....................</div><div>التوقيع: ....................</div></div>
    </div></section>`;
}

// ---------- تقرير ولي الأمر ----------
// لا يتضمن الملاحظات الخاصة ولا التنبيهات الصحية ولا أي مقارنة بطلاب آخرين
export function parentReportSheet({ st, cls, term, g, sections, stats, message, request, label = null }) {
  const id = workspace()?.identity || {};
  const a = g.attendance;
  const parts = [];
  if (sections.attendance) parts.push(`<div class="pr-box"><h4>الحضور</h4>حضر ${a.present + a.late} من ${a.sessions} حصة • تأخر: ${a.late} • غياب بعذر: ${a.absent_excused} • غياب بدون عذر: ${a.absent_unexcused}</div>`);
  if (sections.participation) parts.push(`<div class="pr-box"><h4>المشاركة</h4>مشاركات إيجابية: ${stats.positive} • إجابات صحيحة: ${stats.correct} • مرات السؤال: ${stats.asked}</div>`);
  if (sections.homework) parts.push(`<div class="pr-box"><h4>الواجبات</h4>${stats.hw.total ? `من ${stats.hw.total} واجب: تم ${stats.hw.done} • ناقص ${stats.hw.partial} • متأخر ${stats.hw.late} • لم يحل ${stats.hw.none}` : 'لا توجد واجبات مرصودة في الفترة.'}</div>`);
  if (sections.tests) parts.push(`<div class="pr-box"><h4>الاختبارات</h4>${stats.tests.length ? `<table class="pr"><thead><tr><th>الاختبار</th><th>التاريخ</th><th>الدرجة</th></tr></thead><tbody>${stats.tests.map(t => `<tr><td style="text-align:right">${e(t.title)}</td><td>${fmtDate(t.date, 'g')}</td><td>${t.excluded ? e(t.excluded) : `${fmtNum(t.earned)} / ${t.max}`}</td></tr>`).join('')}</tbody></table>` : 'لا توجد اختبارات مرصودة في الفترة.'}</div>`);
  if (sections.behavior) parts.push(`<div class="pr-box"><h4>السلوك</h4>${stats.behavior.length ? stats.behavior.map(b => `${e(b.name)}: ${b.count}`).join(' • ') : 'لا توجد ملاحظات سلوكية مسجلة — شكراً لانضباطه.'}</div>`);
  if (sections.grade) parts.push(`<div class="pr-box"><h4>الدرجة الأدائية: ${fmtNum(g.total)} من 40${g.monthly.final != null ? ` • الاختبارات الشهرية: ${fmtNum(g.monthly.final)} من ${g.monthly.weight}` : ''}</h4>
    ${sections.breakdown ? `<table class="pr"><thead><tr><th>الفئة</th><th>الوزن</th><th>الدرجة</th></tr></thead><tbody>${g.categories.map(c => `<tr><td style="text-align:right">${e(c.name)}</td><td>${c.weight}</td><td>${c.final == null ? '—' : fmtNum(c.final)}</td></tr>`).join('')}</tbody></table>` : ''}</div>`);
  return `<section class="pr-page">${header('تقرير ولي الأمر', [['الطالب', st.full_name], ['الفصل', className(cls)], ['الفترة', label || (term === 1 ? 'الفصل الدراسي الأول' : 'الفصل الدراسي الثاني')], ['التاريخ', fmtDate(todayISO())]])}
    <div class="pr-box">المكرم ولي أمر الطالب / <b>${e(st.full_name)}</b> &nbsp; حفظه الله<br>السلام عليكم ورحمة الله وبركاته، نضع بين أيديكم ملخص مستوى ابنكم في مادة ${e(id.subject || 'الكيمياء')}.</div>
    ${parts.join('')}
    ${message ? `<div class="pr-box"><h4>رسالة المعلم</h4><div class="pr-pre">${e(message)}</div></div>` : ''}
    ${request?.on ? `<div class="pr-box"><h4>طلب حضور</h4>نأمل تشريفكم للمدرسة ${request.date ? `يوم ${e(fmtDateLong(request.date))}` : ''} ${request.time ? `الساعة ${e(request.time)}` : ''} ${request.purpose ? `— ${e(request.purpose)}` : ''}</div>` : ''}
    <div class="pr-sign"><div>معلم المادة: ${e(id.teacher || '....................')}<br>التوقيع: ....................</div><div>ولي الأمر: ....................<br>التوقيع بالاستلام: ....................<br>التاريخ: ...... / ...... / ............</div></div>
    <div class="pr-cut">✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</div>
    <div class="pr-small">إشعار استلام: استلمتُ تقرير ابني <b>${e(st.full_name)}</b> (${e(className(cls))}). الاسم: .................... التوقيع: .................... التاريخ: ........</div>
  </section>`;
}
export { ATT_STATUS, METHODS };
