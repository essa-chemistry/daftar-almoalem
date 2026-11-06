// Service Worker: يعمل التطبيق بلا إنترنت (الملفات محلياً + مكتبات CDN بعد أول تحميل)
const VERSION = 'daftar-v3.0.4';
const SHELL = [
  './', './index.html', './student.html', './config.js', './manifest.json', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './css/app.css', './css/print.css',
  './js/main.js', './js/lib.js', './js/ui.js', './js/theme.js', './js/utils.js', './js/db.js', './js/store.js', './js/sync.js', './js/calendar.js',
  './js/grading.js', './js/gradeutil.js', './js/tags.js', './js/planprint.js', './js/picker.js', './js/defaults.js', './js/ops.js', './js/demo.js', './js/print.js', './js/backup.js',
  './js/views/today.js', './js/views/session.js', './js/views/classes.js', './js/views/student.js', './js/views/importer.js',
  './js/views/tasks.js', './js/views/grades.js', './js/views/printview.js', './js/views/settings.js',
  './js/forms.js', './js/views/forms.js', './js/views/paper.js', './js/views/names.js',
  './js/portal.js', './js/portal-view.js', './js/student-main.js', './js/plan.js', './js/views/plan.js', './js/views/portal.js', './js/views/seatmap.js',
];
const CDN = ['https://unpkg.com/htm@3.1.1/preact/standalone.module.js'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    await Promise.all(CDN.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // طلبات Supabase لا تُخزَّن أبداً
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;
  const sameOrigin = url.origin === location.origin;
  const isCDN = /(^|\.)(unpkg\.com|jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (!sameOrigin && !isCDN) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(req, { ignoreSearch: sameOrigin });
    // الشبكة أولاً لملفات التطبيق (لتصل التحديثات)، والذاكرة عند انقطاع الاتصال
    if (sameOrigin) {
      // no-cache: يتحقق من الخادم في كل مرة فتصل تحديثات الملفات فوراً بدل انتظار ذاكرة المتصفح
      try { const res = await fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }); if (res.ok) c.put(req, res.clone()); return res; }
      catch { return hit || (req.mode === 'navigate' ? c.match('./index.html') : Response.error()); }
    }
    // المكتبات الخارجية: من الذاكرة ثم تحديث في الخلفية
    const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
