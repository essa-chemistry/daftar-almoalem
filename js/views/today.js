// الرئيسية «اليوم»: حصص اليوم من الجدول + تنبيهات
import { html, useEffect, useState } from '../lib.js';
import { workspace, calCtx, get, ws, all, findSession, className, classes, roster, S } from '../store.js';
import { meetingsOn, periodInfo, periodAt, isHeldStatus, isWorkday, holidayOn, EXC_KINDS, termOf } from '../calendar.js';
import { progress } from '../plan.js';
import { useStore, Icon, Btn, Empty, go, formDialog, toast } from '../ui.js';
import { openSession } from '../ops.js';
import { pickStats } from '../picker.js';
import { todayISO, nowMinutes, parseHM, fmtDateLong, fmtDate, daysBetween, addDays, shortName } from '../utils.js';
import { TASK_KINDS } from '../grading.js';

const STATUS_LABEL = { normal: '', extra: 'حصة إضافية', moved: 'مُبدّلة', cancelled: 'ملغاة', teacher_absent: 'غياب المعلم', holiday: 'إجازة' };

export function TodayPage() {
  useStore();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(t); }, []);
  const w = workspace(); const today = todayISO(); const now = nowMinutes();
  const ms = meetingsOn(calCtx(), today);
  const cur = periodAt(w, now);
  const manual = ws('sessions', s => s.date === today && (s.manual || !ms.some(m => m.class_id === s.class_id && m.period === s.period)));

  const start = async m => {
    const s = await openSession({ classId: m.class_id, date: today, period: m.period });
    go('#/session/' + s.id);
  };
  const manualDlg = async () => {
    const cls = classes();
    if (!cls.length) return toast('أضف فصلاً أولاً', 'warn');
    const v = await formDialog({
      title: 'حصة يدوية (تعويض خارج الجدول)', fields: [
        { name: 'classId', label: 'الفصل', type: 'select', options: cls.map(c => ({ value: c.id, label: className(c) })), value: cls[0].id },
        { name: 'date', label: 'التاريخ', type: 'date', value: today, required: true },
        { name: 'period', label: 'رقم الحصة', type: 'select', options: [{ value: '', label: 'بدون رقم' }, ...(w.day?.periods || []).map(p => ({ value: p.n, label: `الحصة ${p.n} (${p.start})` }))], value: cur?.n || '' },
        { name: 'reason', label: 'السبب', placeholder: 'تعويض حصة ملغاة…', full: true },
      ],
    });
    if (!v) return;
    const s = await openSession({ classId: v.classId, date: v.date, period: v.period === '' ? null : +v.period, manual: true });
    if (v.reason) await import('../store.js').then(m => m.patch('sessions', s.id, { reason: v.reason }));
    go('#/session/' + s.id);
  };

  // ---------- التنبيهات ----------
  const alerts = [];
  const dueToday = ws('tasks', t => t.due_date === today && t.kind === 'homework');
  for (const t of dueToday) alerts.push({ icon: 'tasks', text: html`واجب يستحق اليوم: <b>${t.title}</b> — ${(t.class_ids || []).map(id => className(get('classes', id))).join('، ')}`, href: '#/task/' + t.id });
  const soon = ws('tasks', t => ['monthly', 'quiz', 'final'].includes(t.kind) && t.date >= today && t.date <= addDays(today, 7)).sort((a, b) => a.date.localeCompare(b.date));
  for (const t of soon) alerts.push({ icon: 'calendar', warn: true, text: html`${TASK_KINDS[t.kind]} قريب: <b>${t.title}</b> — ${t.date === today ? 'اليوم' : fmtDateLong(t.date, undefined, true)}`, href: '#/task/' + t.id });
  const stale = +(w.options?.picker?.staleDays || 14);
  for (const c of classes()) {
    const picks = ws('picks', p => p.class_id === c.id);
    const nSessions = ws('sessions', s => s.class_id === c.id).length;
    if (nSessions < 3) continue;
    const st = pickStats(picks);
    const forgotten = roster(c.id, today).filter(x => { const s = st.get(x.student.id); return !s?.last || daysBetween(s.last, today) >= stale; });
    if (forgotten.length) alerts.push({ icon: 'users', warn: true, text: html`${className(c)}: لم يُسأل منذ ${stale} يوماً أو أكثر — ${forgotten.slice(0, 5).map(x => shortName(x.student.full_name)).join('، ')}${forgotten.length > 5 ? ` و${forgotten.length - 5} آخرين` : ''}`, href: `#/class/${c.id}?tab=fair` });
  }
  const reminders = all('notes', n => n.kind === 'reminder' && !n.done && n.workspace_id === S.wsId && n.date >= addDays(today, -14));
  for (const n of reminders) alerts.push({ icon: 'note', text: html`تذكير: ${n.text}${n.student_id ? html` — <b>${get('students', n.student_id)?.full_name || ''}</b>` : ''}`, href: n.student_id ? `#/student/${n.student_id}?tab=notes` : null });
  for (const r of ws('referrals', r => r.status !== 'resolved' && r.date <= addDays(today, -2)))
    alerts.push({ icon: 'file', warn: true, text: html`إحالة بانتظار الرد منذ ${fmtDate(r.date, 'g')}: <b>${get('students', r.student_id)?.full_name || ''}</b> — ${{ sent: 'أُرسلت', received: 'استُلمت' }[r.status] || ''}`, href: '#/form/referral?id=' + r.id });
  const photoReq = ws('photo_requests', r => r.status === 'pending').length;
  if (photoReq) alerts.push({ icon: 'users', text: html`${photoReq} صورة طالب بانتظار اعتمادك`, href: '#/portal?tab=photos' });
  const tNow = termOf(w, today);
  if (tNow) for (const c of classes()) { const p = progress(c.id, tNow); if (p.total && p.diff <= -2) alerts.push({ icon: 'book', warn: true, text: html`${className(c)} متأخر ${-p.diff} حصة عن الخطة — التالي: <b>${p.next?.lesson.title || ''}</b>`, href: '#/plan' }); }
  const lastBackup = localStorage.getItem('daftar-last-backup');
  const needBackup = !lastBackup || daysBetween(lastBackup.slice(0, 10), today) >= 7;

  let emptyMsg = 'لا توجد حصص في جدول اليوم';
  if (!isWorkday(w, today)) emptyMsg = 'اليوم ليس من أيام الدوام';
  else if (holidayOn(w, today)) emptyMsg = 'اليوم إجازة: ' + (holidayOn(w, today).label || '');
  else if (!ws('timetables').length) emptyMsg = 'لم يُضبط الجدول الأسبوعي بعد';

  return html`<div class="page">
    <div class="page-head"><div><h1>اليوم</h1><div class="sub">${fmtDateLong(today)}</div></div>
      <div class="actions"><button class="btn soft" onClick=${manualDlg}><${Icon} name="plus" /> حصة يدوية</button></div></div>
    ${needBackup ? html`<div class="notice row" style="margin-bottom:14px"><${Icon} name="archive" /><span class="grow">${lastBackup ? `آخر نسخة احتياطية قبل ${daysBetween(lastBackup.slice(0, 10), today)} يوماً.` : 'لم تأخذ نسخة احتياطية بعد.'} يُنصح بنسخة أسبوعية.</span><a class="btn sm" href="#/settings/backup">نسخ احتياطي</a></div>` : null}
    <div class="today-layout">
      <section>
        <div class="section-title">حصص اليوم</div>
        ${ms.length ? ms.map(m => {
          const per = periodInfo(w, m.period); const c = get('classes', m.class_id);
          const isNow = cur && cur.n === m.period && isHeldStatus(m.status);
          const s = findSession(m.class_id, today, m.period);
          const held = isHeldStatus(m.status);
          const past = per && now >= parseHM(per.end);
          return html`<div class=${'lesson' + (isNow ? ' now' : '') + (held ? '' : ' off')}>
            <span class="pn">${m.period}</span>
            <div><div class="ttl">${className(c)} ${isNow ? html`<span class="now-tag">الآن</span>` : null}</div>
              <div class="tm">${per ? `${per.start} – ${per.end}` : ''} ${m.subject ? ' • ' + m.subject : ''} ${STATUS_LABEL[m.status] ? html` • <span class=${'badge ' + (held ? 'pri' : 'neg')}>${STATUS_LABEL[m.status]}</span>` : null} ${m.reason ? html`<span class="muted small"> (${m.reason})</span>` : null}</div>
              ${s ? html`<div class="small muted">${s.status === 'closed' ? 'انتهت الحصة' : 'الحصة مفتوحة'}</div>` : null}</div>
            <div class="act">${held ? html`<${Btn} cls=${s && s.status === 'open' ? 'primary' : isNow ? 'primary lg' : past && !s ? 'soft' : ''} onClick=${() => start(m)}>
              <${Icon} name=${s ? 'eye' : 'play'} /> ${s ? (s.status === 'open' ? 'متابعة الحصة' : 'فتح الحصة') : 'ابدأ الحصة'}</${Btn}>` : null}</div>
          </div>`;
        }) : html`<div class="card flat"><${Empty} icon="calendar" title=${emptyMsg}>${!ws('timetables').length ? html`<a class="btn soft" href="#/settings/timetable">ضبط الجدول</a>` : html`<span>يمكنك بدء «حصة يدوية» لتعويض حصة.</span>`}</${Empty}></div>`}
        ${manual.length ? html`<div class="section-title" style="margin-top:16px">حصص يدوية اليوم</div>${manual.map(s => html`<div class="lesson"><span class="pn">${s.period || '+'}</span><div><div class="ttl">${className(get('classes', s.class_id))}</div><div class="tm">حصة يدوية ${s.reason ? '• ' + s.reason : ''}</div></div><div class="act"><a class="btn" href=${'#/session/' + s.id}>فتح</a></div></div>`)}` : null}
      </section>
      <aside>
        <div class="section-title">تنبيهات</div>
        <div class="card">
          ${alerts.length ? alerts.map(a => html`<div class=${'alert-item' + (a.warn ? ' warn' : '')} style=${a.href ? 'cursor:pointer' : ''} onClick=${() => a.href && go(a.href)}><${Icon} name=${a.icon} /><div>${a.text}</div></div>`)
          : html`<${Empty} icon="check" title="لا تنبيهات الآن">كل شيء على ما يرام.</${Empty}>`}
        </div>
      </aside>
    </div>
  </div>`;
}
