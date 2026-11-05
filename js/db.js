// طبقة IndexedDB: جدول محلي لكل جدول على الخادم + صندوق الإرسال (outbox) + بيانات وصفية
export const TABLES = [
  'workspaces', 'classes', 'students', 'enrollments', 'student_private', 'student_photos',
  'notes', 'contacts', 'timetables', 'exceptions', 'sessions', 'attendance', 'event_types',
  'events', 'picks', 'picker_state', 'tasks', 'task_results', 'grade_schemes',
  'grade_overrides', 'grade_locks', 'audit',
];
const DB_NAME = 'daftar-almoalem';
const VERSION = 1;
let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(new Error('تعذر فتح قاعدة البيانات المحلية (IndexedDB). هل التصفح الخاص مفعّل؟'));
  });
  return dbp;
}

function wrap(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
function done(tx) { return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('أُلغيت العملية')); }); }

export async function getAll(store) {
  const db = await openDB();
  return wrap(db.transaction(store).objectStore(store).getAll());
}
export async function putMany(store, rows) {
  if (!rows.length) return;
  const db = await openDB(); const tx = db.transaction(store, 'readwrite'); const os = tx.objectStore(store);
  for (const r of rows) os.put(r);
  return done(tx);
}
export async function deleteMany(store, ids) {
  if (!ids.length) return;
  const db = await openDB(); const tx = db.transaction(store, 'readwrite'); const os = tx.objectStore(store);
  for (const id of ids) os.delete(id);
  return done(tx);
}
export async function clearStores(stores) {
  const db = await openDB(); const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) tx.objectStore(s).clear();
  return done(tx);
}
// كتابة صفوف + مدخلات الإرسال في معاملة واحدة (لا يضيع حدث ولا يُسجَّل نصفه)
export async function writeWithOutbox(store, rows, outboxEntries, deleteIds = []) {
  const db = await openDB();
  const tx = db.transaction(store === 'outbox' ? ['outbox'] : [store, 'outbox'], 'readwrite');
  const os = tx.objectStore(store), ob = tx.objectStore('outbox');
  for (const r of rows) os.put(r);
  for (const id of deleteIds) os.delete(id);
  for (const e of outboxEntries) ob.put(e);
  return done(tx);
}
// حذف مدخل من صندوق الإرسال فقط إن لم يتغير منذ قراءته (حماية التعديلات المتزامنة)
export async function ackOutbox(entries) {
  if (!entries.length) return;
  const db = await openDB(); const tx = db.transaction('outbox', 'readwrite'); const ob = tx.objectStore('outbox');
  for (const e of entries) {
    const req = ob.get(e.id);
    req.onsuccess = () => { if (req.result && req.result.at === e.at) ob.delete(e.id); };
  }
  return done(tx);
}
export async function getMeta(k, def = null) {
  const db = await openDB();
  const r = await wrap(db.transaction('meta').objectStore('meta').get(k));
  return r ? r.v : def;
}
export async function setMeta(k, v) {
  const db = await openDB(); const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ k, v });
  return done(tx);
}
