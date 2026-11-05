// أدوات عامة: معرّفات، تواريخ الرياض، تنسيق، عشوائية آمنة، ضغط الصور
export const TZ = 'Asia/Riyadh';
export const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const DAY_SHORT = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
export const GRADE_NAMES = { 1: 'أول ثانوي', 2: 'ثاني ثانوي', 3: 'ثالث ثانوي' };

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- التاريخ بتوقيت الرياض (نصوص YYYY-MM-DD) ----------
const partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function riyadhNow(d = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (+p.hour) * 60 + (+p.minute) };
}
export const todayISO = () => riyadhNow().date;
export const nowMinutes = () => riyadhNow().minutes;

function toUTC(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function fromUTC(dt) { return dt.toISOString().slice(0, 10); }
export const addDays = (iso, n) => { const d = toUTC(iso); d.setUTCDate(d.getUTCDate() + n); return fromUTC(d); };
export const dow = iso => toUTC(iso).getUTCDay(); // 0 = الأحد
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
export function weekStart(iso, firstDay = 0) { const w = dow(iso); return addDays(iso, -((w - firstDay + 7) % 7)); }
export function* dateRange(from, to) { for (let d = from; d <= to; d = addDays(d, 1)) yield d; }
export const isISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

const gFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'numeric', year: 'numeric' });
const hFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'numeric', year: 'numeric' });
const gLong = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const hLong = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const clean = s => s.replace(/‏|‎/g, '').replace(/\s?هـ$/, '') ;

let DATE_MODE = 'both';
export const setDateMode = m => { DATE_MODE = m || 'both'; };
export function fmtDate(iso, mode = DATE_MODE) {
  if (!iso) return '—';
  const d = toUTC(iso);
  const g = clean(gFmt.format(d)), h = clean(hFmt.format(d)) + 'هـ';
  return mode === 'g' ? g : mode === 'h' ? h : `${g} • ${h}`;
}
export function fmtDateLong(iso, mode = DATE_MODE, withDay = true) {
  if (!iso) return '—';
  const d = toUTC(iso);
  const day = withDay ? DAY_NAMES[d.getUTCDay()] + ' ' : '';
  const g = clean(gLong.format(d)), h = clean(hLong.format(d)) + 'هـ';
  return day + (mode === 'g' ? g : mode === 'h' ? h : `${g} — ${h}`);
}
export const fmtShort = iso => { const d = toUTC(iso); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };
export const fmtHijriShort = iso => clean(new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', day: 'numeric', month: 'numeric' }).format(toUTC(iso)));
export function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date(ts));
}

export const parseHM = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
export const hm = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// ---------- أرقام ----------
export function roundStep(x, step) {
  if (x == null || isNaN(x)) return x;
  if (!step) return Math.round(x * 100) / 100;
  return Math.round(x / step) * step;
}
export function fmtNum(n, digits = 2) {
  if (n == null || isNaN(n)) return '—';
  const v = Math.round(n * 10 ** digits) / 10 ** digits;
  return String(v);
}
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------- عشوائية آمنة ----------
export function randFloat() {
  const a = crypto.getRandomValues(new Uint32Array(2));
  return (a[0] * 2 ** 21 + (a[1] >>> 11)) / 2 ** 53;
}
export function weightedPick(items, weightFn) {
  const ws = items.map(weightFn);
  const total = ws.reduce((a, b) => a + b, 0);
  if (!items.length || total <= 0) return null;
  let r = randFloat() * total;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}
export function randomDigits(n) {
  const a = crypto.getRandomValues(new Uint32Array(n));
  return [...a].map(x => String(x % 10)).join('');
}

// ---------- نصوص عربية ----------
export const normDigits = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
export function normAr(s) {
  return String(s || '').replace(/[ً-ْـ]/g, '').replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim().toLowerCase();
}
export const initial = name => (String(name || '؟').trim()[0] || '؟');
export function colorFor(id) {
  let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 42%)`;
}
export function shortName(full) {
  const p = String(full || '').trim().split(/\s+/);
  return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : full;
}

// ---------- منع الاستدعاء المتكرر ----------
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------- تحميل سكربت خارجي (SheetJS) ----------
const loaded = {};
export function loadScript(src) {
  if (!loaded[src]) loaded[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res;
    s.onerror = () => { delete loaded[src]; rej(new Error('تعذر تحميل مكتبة خارجية — تحقق من الاتصال')); };
    document.head.appendChild(s);
  });
  return loaded[src];
}
export async function getXLSX() {
  await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  return window.XLSX;
}

// ---------- ضغط الصور في المتصفح ----------
function readAsImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('ملف الصورة غير صالح')); };
    img.src = url;
  });
}
const dataUrlBytes = u => Math.ceil((u.length - u.indexOf(',') - 1) * 3 / 4);
// يضغط الصورة حتى maxBytes؛ keepAlpha للشعارات
export async function compressImage(file, { maxDim = 400, maxBytes = 60000, keepAlpha = false } = {}) {
  const img = await readAsImage(file);
  let dim = maxDim;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, dim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!keepAlpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    for (const q of [0.86, 0.75, 0.62, 0.5]) {
      let url = c.toDataURL('image/webp', q);
      if (!url.startsWith('data:image/webp')) url = keepAlpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', q);
      if (dataUrlBytes(url) <= maxBytes) return url;
    }
    dim = Math.round(dim * 0.8);
  }
  throw new Error('تعذر ضغط الصورة إلى الحجم المطلوب');
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
