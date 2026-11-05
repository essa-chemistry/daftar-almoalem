// البيانات التجريبية: مساحة عمل، فصلان، 12 طالباً، جدول أسبوعي، حصص وأحداث ومهام لتجربة كل الشاشات
import { saveMany, save, ws, get } from './store.js';
import { createWorkspace, setWorkspace } from './ops.js';
import { meetingsRange, isHeldStatus } from './calendar.js';
import { choose } from './picker.js';
import { todayISO, addDays, uuid } from './utils.js';

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export async function seedDemo() {
  const R = rng(1448);
  const w = await createWorkspace({ school: 'ثانوية النموذج التجريبية', year: '1448هـ' });
  setWorkspace(w.id);
  const T1 = { start: '2026-08-23', end: '2027-01-07' }, T2 = { start: '2027-01-17', end: '2027-06-10' };
  await save('workspaces', {
    ...w,
    identity: { ...w.identity, admin: 'الإدارة العامة للتعليم بمحافظة الأحساء', region: 'الأحساء', principal: 'أ. خالد العبدالله', deputy: 'أ. سامي الناصر', counselor: 'أ. ماجد الصالح', teacher: 'أ. عيسى', subject: 'كيمياء' },
    calendar: {
      ...w.calendar, terms: [T1, T2],
      holidays: [
        { id: uuid(), from: '2026-09-23', to: '2026-09-23', kind: 'holiday', label: 'اليوم الوطني' },
        { id: uuid(), from: '2026-10-15', to: '2026-10-15', kind: 'off', label: 'إجازة نهاية أسبوع مطولة' },
        { id: uuid(), from: '2027-01-03', to: '2027-01-07', kind: 'exams', label: 'اختبارات نهاية الفصل' },
      ],
    },
  });
  // الفصول
  const [A, B] = await saveMany('classes', [
    { grade: 1, section: '1', grade_label: 'أول ثانوي', name: 'أول ثانوي / 1', subject: 'كيمياء' },
    { grade: 2, section: '3', grade_label: 'ثاني ثانوي', name: 'ثاني ثانوي / 3', subject: 'كيمياء' },
  ]);
  const namesA = ['عبدالله محمد العتيبي', 'فيصل خالد الدوسري', 'تركي سعد القحطاني', 'يوسف أحمد الهاجري', 'سلمان ناصر الشمري', 'حمد عبدالعزيز المطيري'];
  const namesB = ['محمد علي الخالدي', 'عمر فهد الغامدي', 'راكان سامي العنزي', 'زياد ماجد الحربي', 'نواف بندر الزهراني', 'مشعل إبراهيم السبيعي'];
  const mk = (n, i) => ({ full_name: n, seat_no: i + 1, id_last4: String(1000 + Math.floor(R() * 8999)), guardian_phone: '05' + String(Math.floor(R() * 1e8)).padStart(8, '0'), status: 'active' });
  const sA = await saveMany('students', namesA.map(mk));
  const sB = await saveMany('students', namesB.map(mk));
  const lateJoin = '2026-10-04', withdrawOn = '2026-10-20';
  await saveMany('enrollments', [
    ...sA.map((s, i) => ({ student_id: s.id, class_id: A.id, start_date: i === 5 ? lateJoin : T1.start, end_date: null })),
    ...sB.map((s, i) => ({ student_id: s.id, class_id: B.id, start_date: T1.start, end_date: i === 5 ? withdrawOn : null, end_reason: i === 5 ? 'انسحاب' : undefined })),
  ]);
  await save('students', { ...sB[5], status: 'withdrawn', withdraw_date: withdrawOn, withdraw_reason: 'انتقل إلى مدرسة أخرى' });
  await save('students', { ...sA[5], join_note: 'ملتحق من مدرسة أخرى' });
  await saveMany('student_private', [
    { id: sA[3].id, student_id: sA[3].id, health: ['ربو'], health_note: 'يحمل بخاخاً في حقيبته', tags: ['يفهم ولا يبادر'], starred: true },
    { id: sA[0].id, student_id: sA[0].id, health: [], tags: ['متفوق'], starred: false },
    { id: sB[2].id, student_id: sB[2].id, health: ['حساسية'], health_note: 'حساسية من بعض المواد الكيميائية — يُراعى في المختبر', tags: ['يحتاج دعم'], starred: true },
  ]);
  // الجدول
  await save('timetables', {
    effective_from: T1.start, label: 'جدول الفصل الأول',
    slots: [
      { day: 0, period: 2, class_id: A.id, subject: 'كيمياء' }, { day: 2, period: 4, class_id: A.id, subject: 'كيمياء' }, { day: 4, period: 1, class_id: A.id, subject: 'كيمياء' },
      { day: 0, period: 5, class_id: B.id, subject: 'كيمياء' }, { day: 1, period: 3, class_id: B.id, subject: 'كيمياء' }, { day: 2, period: 1, class_id: B.id, subject: 'كيمياء' },
      { day: 3, period: 6, class_id: B.id, subject: 'كيمياء' }, { day: 4, period: 3, class_id: B.id, subject: 'كيمياء' },
    ],
  });
  await saveMany('exceptions', [
    { kind: 'cancel', date: '2026-10-26', period: 3, class_id: B.id, reason: 'نشاط مدرسي' },
    { kind: 'teacher_absent', date: '2026-10-08', date_to: '2026-10-08', reason: 'دورة تدريبية' },
  ]);

  // حصص سابقة: من بداية الفصل الأول حتى أمس
  const today = todayISO();
  const end = addDays(today < T1.end ? today : T1.end, -1);
  const start = T1.start;
  const ctx = { ws: get('workspaces', w.id), timetables: ws('timetables'), exceptions: ws('exceptions') };
  const types = Object.fromEntries(ws('event_types').map(t => [t.sys || t.name, t]));
  const neg = ['نوم في الحصة', 'هذرة', 'عدم انتباه', 'عدم إحضار الأدوات'];
  const sessions = [], att = [], evs = [], picks = [], states = {};
  for (const [cls, studs] of [[A, sA], [B, sB]]) {
    states[cls.id] = { id: cls.id, class_id: cls.id, cycle_no: 1, owed: [] };
    if (start > end) continue;
    for (const m of meetingsRange(ctx, cls.id, start, end).filter(m => isHeldStatus(m.status))) {
      const sid = uuid();
      sessions.push({ id: sid, class_id: cls.id, date: m.date, period: m.period, status: 'closed', manual: false, exempt: [], started_at: m.date + 'T07:00:00Z' });
      const enrolled = studs.filter((s, i) => !(cls === A && i === 5 && m.date < lateJoin) && !(cls === B && i === 5 && m.date > withdrawOn));
      const present = [];
      for (const s of enrolled) {
        const r = R();
        const st = r < 0.05 ? 'absent_unexcused' : r < 0.09 ? 'absent_excused' : r < 0.14 ? 'late' : 'present';
        if (st !== 'present') att.push({ id: uuid(), session_id: sid, student_id: s.id, class_id: cls.id, date: m.date, status: st, late_minutes: st === 'late' ? 5 + Math.floor(R() * 10) : null });
        if (!st.startsWith('absent')) present.push(s.id);
      }
      // اختيارات عشوائية عادلة
      const nPick = 1 + Math.floor(R() * 2.6);
      for (let k = 0; k < nPick; k++) {
        const res = choose({ candidates: present, members: enrolled.map(s => s.id), picks, state: states[cls.id], sessionId: sid, today: m.date });
        if (!res.studentId) break;
        states[cls.id] = { ...states[cls.id], ...res.state };
        const r = R(); const outcome = r < 0.55 ? 'correct' : r < 0.75 ? 'partial' : r < 0.92 ? 'wrong' : 'no_answer';
        const sys = { correct: 'answer_correct', partial: 'answer_partial', wrong: 'answer_wrong', no_answer: 'no_answer' }[outcome];
        picks.push({ id: uuid(), class_id: cls.id, session_id: sid, student_id: res.studentId, date: m.date, at: m.date + 'T07:1' + k + ':00Z', outcome, consumed: true, cycle_no: states[cls.id].cycle_no });
        evs.push({ id: uuid(), session_id: sid, class_id: cls.id, student_id: res.studentId, type_id: types[sys].id, date: m.date, voided: false, created_at: m.date + 'T07:1' + k + ':00Z' });
      }
      if (R() < 0.3 && present.length) {
        const s = present[Math.floor(R() * present.length)];
        evs.push({ id: uuid(), session_id: sid, class_id: cls.id, student_id: s, type_id: types[neg[Math.floor(R() * neg.length)]].id, date: m.date, voided: false, created_at: m.date + 'T07:30:00Z' });
      }
      if (R() < 0.15 && present.length) {
        const s = present[Math.floor(R() * present.length)];
        evs.push({ id: uuid(), session_id: sid, class_id: cls.id, student_id: s, type_id: types['initiative'].id, date: m.date, voided: false, created_at: m.date + 'T07:35:00Z' });
      }
    }
  }
  await saveMany('sessions', sessions); await saveMany('attendance', att); await saveMany('events', evs); await saveMany('picks', picks);
  await saveMany('picker_state', Object.values(states));

  // مهام ونتائج
  const tasks = [], results = [];
  const tDates = [addDays(end, -30), addDays(end, -20), addDays(end, -12), addDays(end, -5)];
  for (const [cls, studs] of [[A, sA], [B, sB]]) {
    const defs = [
      { kind: 'homework', title: 'واجب: المول والكتلة المولية', date: tDates[0], max_score: 1 },
      { kind: 'homework', title: 'واجب: الصيغة الأولية والجزيئية', date: tDates[1], max_score: 1 },
      { kind: 'worksheet', title: 'ورقة عمل مختبر: تعيين كثافة سائل', date: tDates[1], max_score: 10 },
      { kind: 'quiz', title: 'اختبار قصير 1', date: tDates[2], max_score: 10 },
      { kind: 'monthly', title: 'الاختبار الشهري الأول', date: tDates[3], max_score: 20 },
    ];
    for (const d of defs) {
      const t = { id: uuid(), ...d, due_date: d.date, class_ids: [cls.id] };
      tasks.push(t);
      for (const [i, s] of studs.entries()) {
        if (cls === A && i === 5 && d.date < lateJoin) continue;
        if (cls === B && i === 5 && d.date > withdrawOn) continue;
        if (d.kind === 'homework') {
          const r = R(); results.push({ id: uuid(), task_id: t.id, student_id: s.id, status: r < 0.6 ? 'done' : r < 0.75 ? 'partial' : r < 0.85 ? 'late' : r < 0.95 ? 'none' : 'excused' });
        } else results.push({ id: uuid(), task_id: t.id, student_id: s.id, score: Math.round((0.5 + R() * 0.5) * d.max_score * 2) / 2 });
      }
    }
  }
  tasks.push({ id: uuid(), kind: 'homework', title: 'واجب: حل أسئلة نهاية الدرس', date: todayISO(), due_date: todayISO(), max_score: 1, class_ids: [A.id, B.id] });
  await saveMany('tasks', tasks); await saveMany('task_results', results);
  await saveMany('notes', [
    { student_id: sA[2].id, date: addDays(today, -6), kind: 'academic', text: 'يحتاج مراجعة حسابات المول — اقترحت عليه ورقة إثرائية' },
    { student_id: sB[1].id, date: addDays(today, -3), kind: 'reminder', text: 'التواصل مع ولي الأمر بخصوص التأخر المتكرر' },
  ]);
  await save('contacts', { student_id: sB[1].id, date: addDays(today, -2), method: 'اتصال', summary: 'تم إبلاغ ولي الأمر بتكرار التأخر، ووعد بالمتابعة' });
  // المرحلة 2: إحالتان وصور توضيحية لتجربة «اختبر نفسك في الأسماء»
  await saveMany('referrals', [
    { student_id: sB[1].id, class_id: B.id, date: addDays(today, -4), period: 3, subject: 'كيمياء', to_role: 'counselor', reasons: ['تكرار التأخر'], description: 'تأخر متكرر عن بداية الحصة رغم التنبيه.', severity: 'متوسطة', prior: ['تنبيه الطالب شفهياً', 'تواصل مع ولي الأمر (اتصال)'], requested: 'الاطلاع واتخاذ الإجراء المناسب وإفادتنا بالنتيجة.', status: 'received', history: [{ status: 'sent', date: addDays(today, -4) }, { status: 'received', date: addDays(today, -3) }] },
    { student_id: sA[2].id, class_id: A.id, date: addDays(today, -20), period: 2, subject: 'كيمياء', to_role: 'deputy', reasons: ['النوم المتكرر في الحصة'], description: '', severity: 'بسيطة', prior: [], requested: 'الاطلاع.', status: 'resolved', response: 'استجاب', outcome: 'تم توجيه الطالب والتواصل مع ولي أمره', history: [] },
  ]);
  // المرحلة 3: خطة سنوية للصفين، خريطة مقاعد، وتقدّم في الشرح
  const planA = [['المادة وتصنيفها', 'المادة والطاقة', 2], ['المادة وتصنيفها', 'الخواص والتغيرات', 2], ['المادة وتصنيفها', 'المخاليط والعناصر والمركبات', 3], ['بناء الذرة', 'النماذج الذرية', 2], ['بناء الذرة', 'تركيب الذرة', 3], ['بناء الذرة', 'النظائر والكتلة الذرية', 2], ['الجدول الدوري', 'تطور الجدول الدوري', 2], ['الجدول الدوري', 'تصنيف العناصر', 3], ['الجدول الدوري', 'التدرج في الخواص', 3], ['المركبات الأيونية', 'تكوين الأيونات', 2], ['المركبات الأيونية', 'الروابط الأيونية', 3], ['المركبات الأيونية', 'الفلزات وروابطها', 2], ['مراجعة', 'مراجعة عامة', 3]];
  const planB = [['المول', 'قياس المادة', 3], ['المول', 'الكتلة والمول', 4], ['المول', 'مولات المركبات', 4], ['المول', 'الصيغة الأولية والجزيئية', 4], ['المول', 'صيغ الأملاح المائية', 2], ['الحسابات الكيميائية', 'المقصود بالحسابات الكيميائية', 3], ['الحسابات الكيميائية', 'حسابات المعادلات', 5], ['الحسابات الكيميائية', 'المادة المحددة للتفاعل', 4], ['الحسابات الكيميائية', 'نسبة المردود المئوية', 4], ['الغازات', 'قوانين الغازات', 5], ['الغازات', 'قانون الغاز المثالي', 5], ['مراجعة', 'مراجعة واختبارات', 6]];
  await saveMany('plan_lessons', [
    ...planA.map(([unit, title, periods], i) => ({ grade: 1, term: 1, unit, title, periods, order: i })),
    ...planB.map(([unit, title, periods], i) => ({ grade: 2, term: 1, unit, title, periods, order: i })),
  ]);
  // تقدّم الشرح: الشعبة الأولى وفق الخطة تقريباً، والثانية متأخرة قليلاً
  const doneRows = [];
  for (const [cls, keepEvery] of [[A, 1], [B, 1.25]]) {
    const ss = sessions.filter(x => x.class_id === cls.id).sort((a, b) => a.date.localeCompare(b.date));
    let acc = 0; for (const x of ss) { acc += 1 / keepEvery; if (acc >= 1) { acc -= 1; doneRows.push({ ...x, plan_done: true, plan_units: 1 }); } }
  }
  await saveMany('sessions', doneRows);
  const cellsA = {}; sA.forEach((st, i) => { cellsA[`${Math.floor(i / 3)}-${(i % 3) + (i % 3 >= 1 ? 1 : 0)}`] = st.id; });
  cellsA['0-1'] = 'x'; cellsA['1-1'] = 'x';
  await save('classes', { ...A, seat_map: { rows: 2, cols: 4, cells: cellsA } });
  if (typeof document !== 'undefined') {
    const photos = [...sA, ...sB].map((s, i) => ({ id: s.id, student_id: s.id, data: demoPortrait(i), status: 'approved', source: 'demo' }));
    await saveMany('student_photos', photos);
  }
  return w;
}

// صورة توضيحية مرسومة (ليست صورة حقيقية) لتجربة شاشة الأسماء في الوضع التجريبي
function demoPortrait(i) {
  const c = document.createElement('canvas'); c.width = c.height = 240; const g = c.getContext('2d');
  const hue = (i * 47) % 360;
  const bg = g.createLinearGradient(0, 0, 240, 240); bg.addColorStop(0, `hsl(${hue} 55% 78%)`); bg.addColorStop(1, `hsl(${(hue + 40) % 360} 50% 58%)`);
  g.fillStyle = bg; g.fillRect(0, 0, 240, 240);
  const skin = ['#e8b98f', '#d9a679', '#c68e5f', '#b07a4f'][i % 4];
  g.fillStyle = i % 3 === 0 ? '#f4f4f4' : '#c0392b'; // الشماغ أو الغترة
  g.beginPath(); g.moveTo(52, 240); g.quadraticCurveTo(120, 70, 188, 240); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.ellipse(120, 232, 70, 46, 0, Math.PI, 0); g.fill();
  g.fillStyle = skin; g.beginPath(); g.ellipse(120, 112, 38, 46, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = i % 3 === 0 ? '#f4f4f4' : '#c0392b'; g.beginPath(); g.ellipse(120, 92, 46, 34, 0, Math.PI, 0); g.fill();
  if (i % 3 === 1) { g.strokeStyle = '#fff'; g.lineWidth = 3; for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(80 + k * 14, 70); g.lineTo(80 + k * 14 + 8, 96); g.stroke(); } }
  g.strokeStyle = '#111'; g.lineWidth = 6; g.beginPath(); g.ellipse(120, 64, 40, 9, 0, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#2b2b2b'; g.beginPath(); g.arc(106, 112, 4, 0, 7); g.arc(134, 112, 4, 0, 7); g.fill();
  if (i % 4 === 2) { g.strokeStyle = '#333'; g.lineWidth = 3; g.strokeRect(94, 104, 22, 15); g.strokeRect(124, 104, 22, 15); }
  if (i % 2 === 1) { g.fillStyle = '#3b2a20'; g.beginPath(); g.ellipse(120, 146, 20 + (i % 3) * 4, 9, 0, 0, Math.PI); g.fill(); }
  g.strokeStyle = '#7a4a35'; g.lineWidth = 3; g.beginPath(); g.arc(120, 132, 10, 0.2, Math.PI - 0.2); g.stroke();
  return c.toDataURL('image/webp', 0.8).startsWith('data:image/webp') ? c.toDataURL('image/webp', 0.8) : c.toDataURL('image/jpeg', 0.8);
}
