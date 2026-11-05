// النسخ الاحتياطي الكامل (JSON + Excel) والاستعادة
import * as db from './db.js';
import { TABLES } from './db.js';
import { S, all, loadAll, audit, saveMany, emit } from './store.js';
import { downloadBlob, getXLSX, todayISO } from './utils.js';

const LABELS = {
  workspaces: 'مساحات العمل', classes: 'الفصول', students: 'الطلاب', enrollments: 'التسجيل', student_private: 'بيانات خاصة',
  student_photos: 'الصور', notes: 'الملاحظات', contacts: 'التواصل', timetables: 'الجداول', exceptions: 'الاستثناءات', sessions: 'الحصص',
  attendance: 'الحضور', event_types: 'أنواع الأحداث', events: 'الأحداث', picks: 'الاختيارات', picker_state: 'حالة الاختيار',
  tasks: 'المهام', task_results: 'نتائج المهام', grade_schemes: 'توزيع الدرجات', grade_overrides: 'التعديلات اليدوية', grade_locks: 'الاعتماد', audit: 'سجل التدقيق',
};

export function backupData() {
  const data = {};
  for (const t of TABLES) data[t] = [...S.t[t].values()];
  return { app: 'daftar-almoalem', version: 1, exported_at: new Date().toISOString(), data };
}
export async function exportJSON() {
  const b = backupData();
  downloadBlob(new Blob([JSON.stringify(b)], { type: 'application/json' }), `دفتر-المعلم-نسخة-${todayISO()}.json`);
  localStorage.setItem('daftar-last-backup', new Date().toISOString());
  await audit('نسخة احتياطية', 'JSON');
}
export async function exportExcel() {
  const XLSX = await getXLSX();
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  for (const t of TABLES) {
    const rows = [...S.t[t].values()].map(r => {
      const o = {};
      for (const [k, v] of Object.entries(r)) {
        if (t === 'student_photos' && k === 'data') { o[k] = '(صورة)'; continue; }
        if (t === 'workspaces' && k === 'logos') { o[k] = '(شعارات)'; continue; }
        o[k] = v != null && typeof v === 'object' ? JSON.stringify(v) : v;
      }
      return o;
    });
    const sh = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '—': 'لا بيانات' }]);
    XLSX.utils.book_append_sheet(wb, sh, (LABELS[t] || t).slice(0, 31));
  }
  XLSX.writeFile(wb, `دفتر-المعلم-نسخة-${todayISO()}.xlsx`);
  localStorage.setItem('daftar-last-backup', new Date().toISOString());
  await audit('نسخة احتياطية', 'Excel');
}
export async function restoreJSON(file, { replace = true } = {}) {
  const txt = await file.text();
  let b;
  try { b = JSON.parse(txt); } catch { throw new Error('الملف ليس نسخة احتياطية صالحة'); }
  if (b.app !== 'daftar-almoalem' || !b.data) throw new Error('الملف ليس نسخة احتياطية من دفتر المعلم');
  if (replace) { await db.clearStores(TABLES); for (const t of TABLES) S.t[t] = new Map(); }
  // نكتب عبر المخزن حتى تُرسَل للخادم أيضاً
  for (const t of TABLES) {
    const rows = (b.data[t] || []).filter(r => r && r.id);
    for (let i = 0; i < rows.length; i += 500) await saveMany(t, rows.slice(i, i + 500).map(r => ({ ...r })));
  }
  await loadAll();
  await audit('استعادة نسخة احتياطية', `${b.exported_at || ''}`);
  emit();
}
