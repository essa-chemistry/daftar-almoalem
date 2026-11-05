// القيم الافتراضية المقترحة (يعدّلها المعلم بالكامل من الإعدادات)
import { buildPeriods } from './calendar.js';

export const HEALTH_FLAGS = ['ربو', 'سكري', 'حساسية', 'صرع', 'قلب', 'فقر دم منجلي', 'ضعف بصر', 'ضعف سمع'];
export const TEACHER_TAGS = ['متفوق', 'يحتاج دعم', 'يفهم ولا يبادر', 'كثير المبادرة', 'خجول', 'قائد', 'يحتاج متابعة سلوكية'];
export const NOTE_KINDS = { academic: 'أكاديمي', behavior: 'سلوكي', reminder: 'تذكير', general: 'عام' };
export const CONTACT_METHODS = ['اتصال', 'رسالة نصية', 'واتساب', 'حضور شخصي', 'منصة مدرستي', 'خطاب'];

// sys: مفاتيح يستخدمها التطبيق (الاختيار العشوائي والحضور) — يمكن تعديل الاسم والنقاط ولا يُحذف النوع
export function defaultEventTypes() {
  const T = (o, i) => ({ active: true, visible: true, cap: 0, free: 0, order: i, ...o });
  return [
    { name: 'إجابة صحيحة', code: 'ص', icon: '✓', color: '#16a34a', valence: 'pos', points: 1, category: 'participation', sys: 'answer_correct' },
    { name: 'إجابة شبه صحيحة', code: 'ش', icon: '◐', color: '#65a30d', valence: 'pos', points: 0.5, category: 'participation', sys: 'answer_partial' },
    { name: 'مبادرة / تطوع', code: 'ب', icon: '🙋', color: '#0d9488', valence: 'pos', points: 1, category: 'participation', sys: 'initiative' },
    { name: 'مساعدة زميل', code: 'س', icon: '🤝', color: '#0891b2', valence: 'pos', points: 1, category: 'participation' },
    { name: 'تميّز سلوكي', code: 'ز', icon: '⭐', color: '#ca8a04', valence: 'pos', points: 0.5, category: 'behavior', cap: 1 },
    { name: 'إجابة خاطئة', code: 'خ', icon: '✗', color: '#64748b', valence: 'neu', points: 0, category: 'participation', sys: 'answer_wrong' },
    { name: 'لم يجب', code: 'م', icon: '⊘', color: '#64748b', valence: 'neu', points: 0, category: 'participation', sys: 'no_answer' },
    { name: 'ملاحظة', code: 'ح', icon: '✎', color: '#64748b', valence: 'neu', points: 0, category: '', visible: false },
    { name: 'نوم في الحصة', code: 'ن', icon: '😴', color: '#dc2626', valence: 'neg', points: -1, category: 'behavior', cap: 1 },
    { name: 'تأخر عن الدخول', code: 'ت', icon: '⏰', color: '#ea580c', valence: 'neg', points: -0.5, category: 'behavior', cap: 1, sys: 'late' },
    { name: 'غياب بدون عذر', code: 'غ', icon: '⛔', color: '#b91c1c', valence: 'neg', points: -1, category: 'behavior', cap: 1, sys: 'absent_unexcused' },
    { name: 'غياب بعذر', code: 'ع', icon: '📄', color: '#64748b', valence: 'neu', points: 0, category: '', cap: 1, sys: 'absent_excused' },
    { name: 'هذرة', code: 'هـ', icon: '💬', color: '#e11d48', valence: 'neg', points: -0.5, category: 'behavior', cap: 1, free: 1 },
    { name: 'مجادلة', code: 'ج', icon: '⚡', color: '#dc2626', valence: 'neg', points: -1, category: 'behavior', cap: 1 },
    { name: 'عدم انتباه', code: 'ل', icon: '👀', color: '#f97316', valence: 'neg', points: -0.5, category: 'behavior', cap: 1, free: 1 },
    { name: 'إطالة لسان / قلة أدب', code: 'ق', icon: '🚫', color: '#991b1b', valence: 'neg', points: -2, category: 'behavior', cap: 1 },
    { name: 'عدم إحضار الأدوات', code: 'د', icon: '🎒', color: '#ea580c', valence: 'neg', points: -0.5, category: 'behavior', cap: 1 },
  ].map(T);
}

export function defaultWorkspace({ school = '', year = '' } = {}) {
  return {
    name: school ? `${school} — ${year}` : 'مساحة عمل جديدة',
    year_label: year,
    archived: false,
    identity: {
      country: 'المملكة العربية السعودية', ministry: 'وزارة التعليم',
      school, admin: '', region: '', principal: '', deputy: '', counselor: '', teacher: '', subject: 'كيمياء',
    },
    logos: { school: null, ministry: null },
    calendar: { terms: [{ start: '', end: '' }, { start: '', end: '' }], workdays: [0, 1, 2, 3, 4], holidays: [] },
    day: { start: '07:00', end: '13:15', duration: 50, count: 7, breaks: [{ after: 3, minutes: 25, label: 'الفسحة' }], periods: buildPeriods({ start: '07:00', count: 7, duration: 50, breaks: [{ after: 3, minutes: 25 }] }) },
    options: { picker: { retryFactor: 0.5, volunteerConsumes: false, staleDays: 14 }, quickTypes: [] },
  };
}

// ---------- المرحلة 2: النماذج والإحالات ----------
export const REFERRAL_TO = { deputy: 'الوكيل', counselor: 'المرشد الطلابي', principal: 'المدير' };
export const REFERRAL_STATUS = { sent: 'أُرسلت', received: 'استُلمت', resolved: 'عولجت' };
export const RESPONSES = ['استجاب', 'استجابة جزئية', 'لم يستجب'];
export const SEVERITIES = ['بسيطة', 'متوسطة', 'شديدة'];
export const DEFAULT_REFERRAL_REASONS = ['تكرار الغياب بدون عذر', 'تكرار التأخر', 'النوم المتكرر في الحصة', 'الإخلال بالنظام داخل الفصل', 'عدم احترام المعلم', 'تدني المستوى الدراسي', 'عدم إحضار الأدوات والكتب', 'ظرف صحي أو نفسي يحتاج متابعة', 'أخرى'];
export const DEFAULT_PARENT_TEMPLATES = [
  { title: 'شكر وتقدير', text: 'يسعدنا إبلاغكم بتميّز ابنكم في مادة الكيمياء من حيث المشاركة والانضباط، ونشكر لكم حسن متابعتكم، ونأمل استمرار هذا المستوى المشرّف.' },
  { title: 'مستوى يحتاج متابعة', text: 'نود إحاطتكم بأن مستوى ابنكم في مادة الكيمياء يحتاج إلى مزيد من المتابعة، خصوصاً في حل الواجبات والاستعداد للاختبارات القصيرة. نأمل تعاونكم معنا في متابعته بالمنزل.' },
  { title: 'الغياب والتأخر', text: 'نفيدكم بتكرار غياب ابنكم أو تأخره عن حصص مادة الكيمياء خلال الفترة الماضية، مما يؤثر على تحصيله. نأمل التكرم بمتابعة الأمر.' },
  { title: 'السلوك', text: 'نحيطكم علماً بملاحظات سلوكية على ابنكم داخل حصة الكيمياء، ونأمل تعاونكم في توجيهه بما يحقق مصلحته الدراسية.' },
  { title: 'طلب حضور', text: 'نأمل منكم التكرم بزيارة المدرسة لمناقشة مستوى ابنكم في مادة الكيمياء، وذلك حرصاً على مصلحته.' },
];
// درجة المشكلة الافتراضية حسب نقاط الخصم (يعدّلها المعلم من أنواع الأحداث)
export const severityOf = t => t?.severity || ((+t?.points || 0) <= -2 ? 'شديدة' : (+t?.points || 0) <= -1 ? 'متوسطة' : 'بسيطة');
