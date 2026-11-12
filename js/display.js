// تفضيلات عرض الطلاب: صيغة الاسم (ثنائي/ثلاثي/رباعي/كامل)، الصورة أو الحرف، الترتيب (رقم/أبجدي/مجمّع بالحرف)، والاتجاه
import { workspace, patch, privateOf } from './store.js';
import { normAr } from './utils.js';
import { formDialog, toast } from './ui.js';

export const NAME_FMT = { 2: 'ثنائي (الاسم والعائلة)', 3: 'ثلاثي', 4: 'رباعي', full: 'كامل كما في السجل' };
export const AVATAR_MODE = { initial: 'الحرف الأول أو الصورة', photo: 'الصورة فقط (إن وُجدت)', none: 'بدون صورة ولا حرف' };
export const ORDER = { seat: 'رقم المقعد', alpha: 'أبجدي', letters: 'أبجدي — كل حرف في صف' };
export const FLOW = { row: 'أفقي (صفوف)', col: 'عمودي (أعمدة)' };

export const dispCfg = () => ({ name: 2, avatar: 'initial', order: 'seat', flow: 'row', ...(workspace()?.display || {}) });
export const setDisp = ch => patch('workspaces', workspace().id, { display: { ...dispCfg(), ...ch } });

// تقسيم الاسم إلى أجزاء مع ضم المركّب (عبد الله، أبو بكر، نور الدين) وحذف «بن/ابن/بنت»
const JOIN_NEXT = new Set(['عبد', 'ابو', 'أبو', 'ابي', 'أبي']);
const JOIN_PREV = new Set(['الله', 'الدين', 'الرحمن', 'الرحيم', 'الكريم', 'العزيز']);
const SKIP = new Set(['بن', 'ابن', 'بنت']);
export function nameParts(full) {
  const raw = String(full || '').trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    if (SKIP.has(w) && out.length) continue;
    if (JOIN_NEXT.has(w) && raw[i + 1]) { out.push(w + ' ' + raw[++i]); continue; }
    if (JOIN_PREV.has(w) && out.length && !/\s/.test(out[out.length - 1]) && !JOIN_NEXT.has(out[out.length - 1])) { out[out.length - 1] += ' ' + w; continue; }
    out.push(w);
  }
  return out;
}
export function formatName(full, fmt = dispCfg().name) {
  if (fmt === 'full') return String(full || '').trim();
  const p = nameParts(full); const n = +fmt || 2;
  if (p.length <= n) return p.join(' ');
  return [...p.slice(0, n - 1), p[p.length - 1]].join(' ');
}
export const displayName = st => formatName(st?.full_name);

// الحرف الأول للتجميع: كل أشكال الألف تُجمع تحت «أ»
export function letterOf(full) {
  const c = String(full || '').trim().charAt(0);
  return 'اأإآٱ'.includes(c) ? 'أ' : c === 'ة' ? 'ه' : c === 'ى' ? 'ي' : c || '؟';
}
const sortKey = s => normAr(s.full_name || '').replace(/\s+/g, ' ');
export function sortRows(rows, order = dispCfg().order) {
  if (order === 'seat') return rows;
  return [...rows].sort((a, b) => sortKey(a.student).localeCompare(sortKey(b.student), 'ar'));
}
export function groupByLetter(rows) {
  const m = new Map();
  for (const x of sortRows(rows, 'alpha')) { const l = letterOf(x.student.full_name); if (!m.has(l)) m.set(l, []); m.get(l).push(x); }
  return [...m.entries()].map(([letter, items]) => ({ letter, items }));
}
export { privateOf };

export async function openDisplayDialog() {
  const c = dispCfg();
  const v = await formDialog({ title: 'ترتيب الطلاب وعرضهم', okText: 'حفظ', fields: [
    { name: 'name', label: 'اسم الطالب', type: 'select', value: String(c.name), options: Object.entries(NAME_FMT).map(([value, label]) => ({ value, label })) },
    { name: 'avatar', label: 'الصورة / الحرف الكبير', type: 'select', value: c.avatar, options: Object.entries(AVATAR_MODE).map(([value, label]) => ({ value, label })) },
    { name: 'order', label: 'الترتيب', type: 'select', value: c.order, options: Object.entries(ORDER).map(([value, label]) => ({ value, label })) },
    { name: 'flow', label: 'الاتجاه', type: 'select', value: c.flow, options: Object.entries(FLOW).map(([value, label]) => ({ value, label })), hint: 'العمودي: يتتابع الطلاب من أعلى إلى أسفل، ومع «كل حرف» يصير كل حرف عموداً' },
  ] });
  if (!v) return;
  await setDisp({ name: v.name === 'full' ? 'full' : +v.name, avatar: v.avatar, order: v.order, flow: v.flow });
  toast('حُفظ — يُطبَّق على شاشة الحصة وصفحة الفصل', 'ok');
}
