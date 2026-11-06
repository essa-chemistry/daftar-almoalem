// المرحلة 3 — عرض بيانات بوابة الطالب (يُستخدم في student.html وفي معاينة المعلم)
// لا يعرض إلا ما أرسله الخادم بعد الفلترة: لا ملاحظات خاصة ولا تنبيهات صحية ولا بيانات زملاء
import { html } from './lib.js';
import { fmtDate } from './utils.js';

const HW = { done: 'تم', partial: 'ناقص', none: 'لم يحل', late: 'متأخر', excused: 'معذور' };
const ATT = { absent_excused: 'غياب بعذر', absent_unexcused: 'غياب بدون عذر', late: 'تأخر' };
const KIND = { quiz: 'اختبار قصير', monthly: 'اختبار شهري', final: 'اختبار نهائي', worksheet: 'ورقة عمل', performance: 'مهمة أدائية', project: 'مشروع' };
const num = v => v == null || v === '' ? '—' : String(Math.round(+v * 100) / 100);
const initial = n => (String(n || '؟').trim()[0] || '؟');

function counts(list) { const m = {}; for (const e of list) m[e.name] = (m[e.name] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); }
const Section = ({ title, children }) => html`<div class="card stack"><h2>${title}</h2>${children}</div>`;

export function PortalView({ d }) {
  if (!d) return null;
  const s = d.student || {};
  const ev = d.events || [];
  const part = ev.filter(e => e.group === 'participation'), beh = ev.filter(e => e.group === 'behavior'), sleep = ev.filter(e => e.group === 'sleep');
  const a = d.attendance;
  return html`<div class="stack">
    <div class="card row" style="gap:16px">
      <span class="avatar" style="--sz:84px;--c:var(--primary)">${d.photo ? html`<img src=${d.photo} alt="" />` : html`<span class="av-letter">${initial(s.name)}</span>`}</span>
      <div class="grow"><h1 style="font-size:1.4rem">${s.name}</h1><div class="muted">${s.class || ''} ${s.seat_no ? `• رقم ${s.seat_no}` : ''}</div><div class="muted small">${s.school || ''} ${s.subject ? `• ${s.subject}` : ''} ${s.teacher ? `• ${s.teacher}` : ''}</div></div>
    </div>
    ${a ? html`<${Section} title="الحضور"><div class="stats">
      <div class="stat"><b>${a.sessions}</b><span>حصة منعقدة</span></div>
      ${a.absent_unexcused != null ? html`<div class="stat"><b>${a.absent_unexcused}</b><span>غياب بدون عذر</span></div><div class="stat"><b>${a.absent_excused}</b><span>غياب بعذر</span></div>` : null}
      ${a.late != null ? html`<div class="stat"><b>${a.late}</b><span>تأخر</span></div>` : null}</div>
      ${a.list?.length ? html`<div class="chips">${a.list.slice(0, 30).map(x => html`<span class=${'badge ' + (x.status === 'absent_unexcused' ? 'neg' : x.status === 'late' ? 'warn' : '')}>${fmtDate(x.date, 'g')} — ${ATT[x.status]}</span>`)}</div>` : null}</${Section}>` : null}
    ${d.show?.participation ? html`<${Section} title="المشاركة">${part.length ? html`<div class="chips">${counts(part).map(([n, c]) => html`<span class="badge pos">${n}: ${c}</span>`)}</div>
      <div class="timeline">${part.slice(0, 12).map(e => html`<div class="tl-item"><span class="when">${fmtDate(e.date, 'g')}</span><span>${e.icon || ''} ${e.name}</span></div>`)}</div>` : html`<p class="muted" style="margin:0">لا توجد مشاركات مسجلة بعد.</p>`}</${Section}>` : null}
    ${d.show?.behavior || d.show?.sleep ? html`<${Section} title="السلوك">${[...(d.show?.behavior ? beh : []), ...(d.show?.sleep ? sleep : [])].length
      ? html`<div class="chips">${counts([...beh, ...sleep]).map(([n, c]) => html`<span class="badge neg">${n}: ${c}</span>`)}</div>
        <div class="timeline">${[...beh, ...sleep].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 12).map(e => html`<div class="tl-item"><span class="when">${fmtDate(e.date, 'g')}</span><span>${e.name}</span></div>`)}</div>`
      : html`<p class="muted" style="margin:0">لا توجد ملاحظات سلوكية — أحسنت.</p>`}</${Section}>` : null}
    ${d.homework ? html`<${Section} title="الواجبات">${d.homework.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>الواجب</th><th>التاريخ</th><th>الحالة</th></tr></thead><tbody>${d.homework.map(h => html`<tr><td>${h.title}</td><td class="small">${fmtDate(h.date, 'g')}</td><td>${h.status ? html`<span class=${'badge ' + (h.status === 'done' ? 'pos' : h.status === 'none' ? 'neg' : h.status === 'excused' ? '' : 'warn')}>${HW[h.status]}</span>` : html`<span class="muted small">لم يُرصد</span>`}</td></tr>`)}</tbody></table></div>` : html`<p class="muted" style="margin:0">لا توجد واجبات بعد.</p>`}</${Section}>` : null}
    ${d.tests ? html`<${Section} title="الاختبارات والمهام">${d.tests.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>العنوان</th><th>النوع</th><th>التاريخ</th><th class="num">الدرجة</th></tr></thead><tbody>${d.tests.map(t => html`<tr><td>${t.title}</td><td class="small">${KIND[t.kind] || ''}</td><td class="small">${fmtDate(t.date, 'g')}</td><td class="num">${t.status === 'excused' ? 'معذور' : t.score == null ? html`<span class="muted small">لم تُرصد</span>` : `${num(t.score)} / ${num(t.max)}`}</td></tr>`)}</tbody></table></div>` : html`<p class="muted" style="margin:0">لا توجد اختبارات بعد.</p>`}</${Section}>` : null}
    ${d.show?.grade ? html`<${Section} title="الدرجة الأدائية">${!d.grades_visible ? html`<p class="muted" style="margin:0">تظهر الدرجات بعد ${fmtDate(d.grades_after)}.</p>`
      : d.grades?.length ? d.grades.map(g => html`<div class="g-cat"><div class="g-top"><b>${g.label || `الفصل الدراسي ${g.term === 1 ? 'الأول' : 'الثاني'}`}</b>${g.approved ? html`<span class="badge pos">معتمدة</span>` : html`<span class="badge">مبدئية</span>`}<span class="g-score">${num(g.total)} <small>/ 40</small></span></div>
          ${g.monthly != null ? html`<div class="small">الاختبارات الشهرية: <b>${num(g.monthly)}</b> من ${g.monthly_of || 20}</div>` : null}
          ${g.categories ? html`<div class="g-items">${g.categories.map(c => html`<div style="display:grid;gap:2px"><span class="row" style="justify-content:space-between"><b>${c.name}</b><span class="tnum">${num(c.final)} / ${c.weight}</span></span>${c.text ? html`<span class="muted small">${c.text}</span>` : null}</div>`)}</div>` : null}</div>`)
      : html`<p class="muted" style="margin:0">لم تُنشر الدرجات بعد.</p>`}</${Section}>` : null}
  </div>`;
}
