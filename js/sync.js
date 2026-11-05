// المزامنة مع Supabase: إرسال صندوق الإرسال على دفعات (upsert آمن للإعادة) ثم سحب التغييرات
import { CONFIG } from '../config.js';
import * as db from './db.js';
import { TABLES } from './db.js';
import { S, emit, mergeRemote, raw, setOnWrite } from './store.js';
import { debounce } from './utils.js';

export const SYNC = { mode: 'demo', online: navigator.onLine, user: null, busy: false, error: null, lastSync: null, ready: false };
let sb = null;
export const configured = () => !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
export const client = () => sb;

// أعمدة الفهرسة لكل جدول (بقية الحقول تُحفظ في data jsonb)
const COLS = {
  workspaces: [], classes: ['grade', 'section'], students: ['status'],
  enrollments: ['student_id', 'class_id', 'start_date', 'end_date'], student_private: ['student_id'],
  student_photos: ['student_id', 'status'], notes: ['student_id', 'session_id', 'date'], contacts: ['student_id', 'date'],
  timetables: ['effective_from'], exceptions: ['date', 'date_to'], sessions: ['class_id', 'date', 'period'],
  attendance: ['session_id', 'student_id', 'class_id', 'date', 'status'], event_types: [],
  events: ['session_id', 'class_id', 'student_id', 'type_id', 'date', 'voided'],
  picks: ['session_id', 'class_id', 'student_id', 'date'], picker_state: ['class_id'], tasks: ['kind', 'date'],
  task_results: ['task_id', 'student_id'], grade_schemes: ['grade', 'term'],
  grade_overrides: ['class_id', 'student_id', 'term'], grade_locks: ['class_id', 'term'], audit: ['action', 'at'],
};
const BASE = ['id', 'workspace_id', 'deleted', 'client_updated_at', 'created_at'];
const SKIP = new Set(['owner_id', 'updated_at', 'server_updated_at']);

function toServer(t, r) {
  const cols = COLS[t], out = { data: {} };
  for (const [k, v] of Object.entries(r)) {
    if (SKIP.has(k)) continue;
    if (BASE.includes(k) || cols.includes(k)) out[k] = v === '' ? null : v;
    else out.data[k] = v;
  }
  out.deleted = !!r.deleted;
  if (cols.includes('voided')) out.voided = !!r.voided;
  return out;
}
function fromServer(r) {
  const { data, owner_id, updated_at, ...rest } = r;
  const row = { ...(data || {}) };
  for (const [k, v] of Object.entries(rest)) if (v !== null) row[k] = v;
  row.server_updated_at = updated_at;
  return row;
}

export async function initSync() {
  window.addEventListener('online', () => { SYNC.online = true; emit(); syncNow(); });
  window.addEventListener('offline', () => { SYNC.online = false; emit(); });
  if (!configured()) { SYNC.mode = 'demo'; SYNC.ready = true; return; }
  SYNC.mode = 'cloud';
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    const { data } = await sb.auth.getSession();
    SYNC.user = data.session?.user || null;
    sb.auth.onAuthStateChange((_e, session) => { SYNC.user = session?.user || null; S.user = SYNC.user?.email || null; emit(); });
  } catch (e) {
    // بلا اتصال ولم تُخزَّن المكتبة بعد: نعمل محلياً بآخر مستخدم معروف
    SYNC.error = 'تعذر الاتصال بالخادم — العمل محلياً';
  }
  S.user = SYNC.user?.email || localStorage.getItem('daftar-last-user') || null;
  SYNC.ready = true;
  setOnWrite(debounce(syncNow, 2500));
  setInterval(syncNow, 60000);
}

export async function signIn(email, password) {
  if (!sb) throw new Error('لا يمكن الوصول للخادم الآن');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'البريد أو كلمة المرور غير صحيحة' : error.message);
  SYNC.user = data.user; S.user = data.user.email;
  localStorage.setItem('daftar-last-user', data.user.email);
  emit();
  return data.user;
}
export async function signOut() {
  if (sb) await sb.auth.signOut();
  SYNC.user = null; localStorage.removeItem('daftar-last-user'); emit();
}

let running = null;
export function syncNow() {
  if (SYNC.mode !== 'cloud' || !sb || !SYNC.user || !navigator.onLine) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    SYNC.busy = true; emit();
    try {
      await push();
      await pull();
      SYNC.error = null; SYNC.lastSync = new Date().toISOString();
    } catch (e) {
      SYNC.error = e.message || String(e);
      console.warn('sync', e);
    } finally {
      SYNC.busy = false; S.pending = (await db.getAll('outbox')).length; emit(); running = null;
    }
  })();
  return running;
}

async function push() {
  const entries = (await db.getAll('outbox')).sort((a, b) => a.ts - b.ts);
  if (!entries.length) return;
  // 1) التعديلات (upsert) حسب الجدول — آمنة للإعادة لأن المفتاح هو المعرّف الفريد
  const ups = entries.filter(e => e.op === 'upsert');
  for (const t of TABLES) {
    const mine = ups.filter(e => e.table === t);
    for (let i = 0; i < mine.length; i += 200) {
      const chunk = mine.slice(i, i + 200);
      const rows = chunk.map(e => raw(t, e.row_id)).filter(Boolean).map(r => toServer(t, r));
      if (rows.length) {
        const { error } = await sb.from('tr_' + t).upsert(rows, { onConflict: 'id' });
        if (error) throw new Error(`تعذر إرسال ${t}: ${error.message}`);
      }
      await db.ackOutbox(chunk);
    }
  }
  // 2) الحذف النهائي
  const dels = entries.filter(e => e.op === 'delete');
  for (const t of TABLES) {
    const mine = dels.filter(e => e.table === t);
    for (let i = 0; i < mine.length; i += 200) {
      const chunk = mine.slice(i, i + 200);
      const { error } = await sb.from('tr_' + t).delete().in('id', chunk.map(e => e.row_id));
      if (error) throw new Error(`تعذر الحذف من ${t}: ${error.message}`);
      await db.ackOutbox(chunk);
    }
  }
  // 3) الدوال (مثل بصمة السجل المدني) — بعد وصول صفوف الطلاب
  for (const e of entries.filter(e => e.op === 'rpc')) {
    const { data, error } = await sb.rpc(e.name, e.args);
    if (error) {
      if (/غير موجود/.test(error.message)) continue; // يُعاد لاحقاً
      throw new Error(error.message);
    }
    await db.ackOutbox([e]);
    if (e.name === 'tr_set_student_nid' && data && e.meta?.student_id) {
      const st = raw('students', e.meta.student_id);
      if (st && st.id_last4 !== data) { st.id_last4 = data; await mergeRemote('students', [st]); }
    }
  }
}

async function pull() {
  const since = await db.getMeta('lastPull', '1970-01-01T00:00:00Z');
  const pendingIds = new Set((await db.getAll('outbox')).filter(e => e.op === 'upsert').map(e => `${e.table}:${e.row_id}`));
  let maxTs = since;
  for (const t of TABLES) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('tr_' + t).select('*').gte('updated_at', since).order('updated_at').range(from, from + 999);
      if (error) throw new Error(`تعذر السحب من ${t}: ${error.message}`);
      const rows = data.filter(r => !pendingIds.has(`${t}:${r.id}`)).map(fromServer);
      await mergeRemote(t, rows);
      for (const r of data) if (r.updated_at > maxTs) maxTs = r.updated_at;
      if (data.length < 1000) break;
    }
  }
  await db.setMeta('lastPull', maxTs);
}

// حالة المؤشر
export function syncStatus() {
  if (SYNC.mode === 'demo') return { icon: '◇', text: 'محلي — وضع تجريبي', kind: 'demo' };
  if (!SYNC.online) return { icon: '⚠', text: `بلا اتصال${S.pending ? ` — ${S.pending} بانتظار الإرسال` : ''}`, kind: 'off' };
  if (!SYNC.user) return { icon: '⚠', text: 'لم يتم الدخول', kind: 'off' };
  if (SYNC.busy) return { icon: '⟳', text: 'جارٍ المزامنة…', kind: 'busy' };
  if (SYNC.error) return { icon: '⚠', text: SYNC.error, kind: 'err' };
  if (S.pending) return { icon: '⏳', text: `${S.pending} بانتظار الإرسال`, kind: 'pending' };
  return { icon: '✓', text: 'تمت المزامنة', kind: 'ok' };
}
