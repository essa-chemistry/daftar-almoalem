// نقطة البداية: التحميل، المزامنة، الهيكل، التنقل
import { html, render, useState, useEffect, Component } from './lib.js';
import * as db from './db.js';
import { S, loadAll, all, get, workspace, emit } from './store.js';
import { initSync, SYNC, signIn, syncNow, syncStatus, configured, signOut } from './sync.js';
import { useStore, Icon, ModalHost, ToastHost, openModal, ModalHead, Btn, toast, confirmDialog, go } from './ui.js';
import { setWorkspace } from './ops.js';
import { applyTheme, setUI, getUI } from './theme.js';
import { seedDemo } from './demo.js';
import { todayISO, fmtDateLong, setDateMode } from './utils.js';
import { TodayPage } from './views/today.js';
import { SessionPage } from './views/session.js';
import { ClassesPage, ClassPage } from './views/classes.js';
import { StudentPage } from './views/student.js';
import { ImportPage } from './views/importer.js';
import { TasksPage, TaskPage } from './views/tasks.js';
import { GradesPage, GradeDetailPage } from './views/grades.js';
import { PrintPage } from './views/printview.js';
import { SettingsPage, WorkspaceSetup } from './views/settings.js';
import { PaperEntryPage } from './views/paper.js';
import { NamesPage } from './views/names.js';
import { PlanPage } from './views/plan.js';
import { PortalPage } from './views/portal.js';
import { publishSnapshots } from './portal.js';
import { BehaviorFormPage, ReferralPage, ParentReportPage } from './views/forms.js';

// ---------- التوجيه ----------
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, q = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { name: parts[0] || 'today', args: parts.slice(1), q: Object.fromEntries(new URLSearchParams(q)) };
}
function useRoute() {
  const [r, set] = useState(parseRoute());
  useEffect(() => { const f = () => { set(parseRoute()); window.scrollTo(0, 0); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return r;
}

const NAV = [
  { k: 'today', label: 'اليوم', icon: 'today' },
  { k: 'classes', label: 'الفصول', icon: 'users', also: ['class', 'student', 'import', 'names', 'portal'] },
  { k: 'tasks', label: 'المهام', icon: 'tasks', also: ['task'] },
  { k: 'grades', label: 'الدرجات', icon: 'grades', also: ['grade'] },
  { k: 'plan', label: 'الخطة', icon: 'book' },
  { k: 'print', label: 'الطباعة والنماذج', icon: 'print', also: ['paper', 'form'] },
  { k: 'settings', label: 'الإعدادات', icon: 'settings' },
];
const NavItems = ({ route }) => NAV.map(n => html`<a href=${'#/' + n.k} class=${'nav-item' + (route.name === n.k || n.also?.includes(route.name) ? ' on' : '')}><${Icon} name=${n.icon} size=${22} /><span>${n.label}</span></a>`);

function WsSwitcher() {
  const choose = () => openModal(close => html`<${ModalHead} title="مساحات العمل" close=${close} />
    <div class="modal-body"><div class="list">${all('workspaces').filter(w => !w.archived).map(w => html`<div class=${'li click' + (w.id === S.wsId ? ' sel' : '')} onClick=${() => { setWorkspace(w.id); emit(); close(); go('#/today'); }}>
      <span class="hexmark" style="width:40px;height:40px"><${Icon} name="hex" /></span><div class="grow"><div class="main-t">${w.name}</div><div class="sub-t">${w.identity?.school || ''} ${w.year_label ? '• ' + w.year_label : ''}</div></div>${w.id === S.wsId ? html`<span class="badge pri">الحالية</span>` : null}</div>`)}</div></div>
    <div class="modal-foot"><button class="btn soft" onClick=${() => { close(); go('#/settings/workspaces'); }}>إدارة وإنشاء مساحات العمل</button></div>`, { size: 'sm' });
  const w = workspace();
  return html`<button class="ws-switch" onClick=${choose} title="تبديل مساحة العمل"><${Icon} name="hex" size=${18} /><span>${w?.name || 'اختر مساحة عمل'}</span></button>`;
}

function SyncPill() {
  const st = syncStatus();
  const open = () => openModal(close => html`<${ModalHead} title="المزامنة" close=${close} />
    <div class="modal-body stack">
      <div class="info">${st.icon} ${st.text}</div>
      ${SYNC.mode === 'demo' ? html`<p>التطبيق يعمل في الوضع التجريبي: البيانات محفوظة على هذا الجهاز فقط. لربطه بحسابك على Supabase ضع بيانات المشروع في <code>config.js</code> (انظر README).</p>`
      : html`<dl class="kv"><dt>الحساب</dt><dd>${SYNC.user?.email || S.user || '—'}</dd><dt>بانتظار الإرسال</dt><dd>${S.pending}</dd><dt>الاتصال</dt><dd>${SYNC.online ? 'متصل' : 'غير متصل'}</dd><dt>آخر مزامنة</dt><dd>${SYNC.lastSync ? new Date(SYNC.lastSync).toLocaleString('ar-SA-u-nu-latn') : '—'}</dd></dl>
         <p class="muted small">كل ما تسجله يُحفظ على الجهاز أولاً ثم يُرسَل تلقائياً عند توفر الاتصال، ولا يتكرر أي سجل عند إعادة الإرسال.</p>`}
    </div>
    <div class="modal-foot">${SYNC.mode === 'cloud' ? html`<${Btn} cls="primary" onClick=${() => syncNow().then(() => toast('تمت المزامنة', 'ok'))}>مزامنة الآن</${Btn}>` : null}<button class="btn ghost" onClick=${close}>إغلاق</button></div>`, { size: 'sm' });
  return html`<button class=${'sync-pill ' + st.kind} onClick=${open} title=${st.text}><span>${st.icon}</span><span>${st.text}</span></button>`;
}

function ThemeBtn() {
  const ui = getUI(); const next = { auto: 'light', light: 'dark', dark: 'auto' }[ui.theme || 'auto'];
  return html`<button class="icon-btn" title=${'المظهر: ' + ({ auto: 'تلقائي', light: 'فاتح', dark: 'داكن' }[ui.theme || 'auto'])} onClick=${() => setUI({ theme: next })}><${Icon} name=${ui.theme === 'dark' ? 'moon' : 'today'} /></button>`;
}

// حاجز أخطاء: لا تتجمد الواجهة إن حدث خطأ في شاشة واحدة
class Guard extends Component {
  constructor() { super(); this.state = { err: null }; }
  componentDidCatch(err) { console.error(err); this.setState({ err }); }
  render() {
    if (this.state.err) return html`<div class="page"><div class="card stack"><div class="error">حدث خطأ غير متوقع في هذه الشاشة: ${String(this.state.err.message || this.state.err)}</div><p class="muted" style="margin:0">بياناتك محفوظة. جرّب الرجوع أو إعادة تحميل الصفحة.</p><div class="row"><button class="btn" onClick=${() => { this.setState({ err: null }); history.back(); }}>رجوع</button><button class="btn primary" onClick=${() => location.reload()}>إعادة التحميل</button></div></div></div>`;
    return this.props.children;
  }
}

function Page({ route }) {
  const a = route.args, q = route.q;
  switch (route.name) {
    case 'today': return html`<${TodayPage} />`;
    case 'session': return html`<${SessionPage} id=${a[0]} />`;
    case 'classes': return html`<${ClassesPage} />`;
    case 'class': return html`<${ClassPage} id=${a[0]} tab=${q.tab} />`;
    case 'student': return html`<${StudentPage} id=${a[0]} tab=${q.tab} />`;
    case 'import': return html`<${ImportPage} />`;
    case 'tasks': return html`<${TasksPage} q=${q} />`;
    case 'task': return html`<${TaskPage} id=${a[0]} classId=${q.class} />`;
    case 'grades': return html`<${GradesPage} q=${q} />`;
    case 'grade': return html`<${GradeDetailPage} classId=${a[0]} term=${+a[1]} studentId=${a[2]} />`;
    case 'print': return html`<${PrintPage} q=${q} />`;
    case 'settings': return html`<${SettingsPage} tab=${a[0]} />`;
    case 'paper': return html`<${PaperEntryPage} q=${q} />`;
    case 'names': return html`<${NamesPage} q=${q} />`;
    case 'plan': return html`<${PlanPage} />`;
    case 'portal': return html`<${PortalPage} q=${q} />`;
    case 'form': return a[0] === 'behavior' ? html`<${BehaviorFormPage} q=${q} />` : a[0] === 'referral' ? html`<${ReferralPage} q=${q} />` : html`<${ParentReportPage} q=${q} />`;
    default: return html`<div class="page"><h1>الصفحة غير موجودة</h1></div>`;
  }
}

function App() {
  useStore();
  const route = useRoute();
  const w = workspace();
  if (w) setDateMode(w.options?.dateMode || 'both');
  if (SYNC.mode === 'cloud' && !SYNC.user && !S.user) return html`<${Login} /><${ToastHost} />`;
  if (!w) return html`<div class="page" style="max-width:720px"><${WorkspaceSetup} first=${true} /></div><${ModalHost} /><${ToastHost} />`;
  const sessionMode = route.name === 'session';
  return html`<div class=${'app' + (sessionMode ? ' in-session' : '')}>
    <aside class="rail"><a class="brand" href="#/today" title="دفتر المعلم"><${Icon} name="hex" size=${26} /></a><${NavItems} route=${route} /><span class="spacer"></span></aside>
    <div class="main">
      <header class="topbar"><${WsSwitcher} /><span class="today-date">${fmtDateLong(todayISO())}</span><${SyncPill} /><${ThemeBtn} /></header>
      ${SYNC.mode === 'demo' ? html`<div class="demo-bar">وضع تجريبي: البيانات محفوظة على هذا الجهاز فقط ولا تُرفع لأي خادم. لربط التطبيق بحسابك اتبع خطوات README.</div>` : null}
      <${Guard} key=${route.name + route.args.join('/') + (route.name === 'form' ? JSON.stringify(route.q) : '')}><${Page} route=${route} /></${Guard}>
    </div>
    <nav class="bottom-nav"><${NavItems} route=${route} /></nav>
  </div><${Guard}><${ModalHost} /></${Guard}><${ToastHost} />`;
}

function Login() {
  const [email, setEmail] = useState(localStorage.getItem('daftar-last-user') || '');
  const [pw, setPw] = useState(''); const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    try { await signIn(email.trim(), pw); await afterLogin(); }
    catch (e) { setErr(e.message); }
  };
  return html`<div class="login"><div class="card stack" style="text-align:center">
    <span class="brand"><${Icon} name="hex" size=${32} /></span>
    <h1 style="font-size:1.5rem">دفتر المعلم</h1><p class="muted" style="margin:0">دخول المعلم</p>
    <form class="stack" style="text-align:start" onSubmit=${e => { e.preventDefault(); }}>
      <label class="field"><span>البريد الإلكتروني</span><input type="email" class="ltr" value=${email} onInput=${e => setEmail(e.target.value)} autocomplete="username" /></label>
      <label class="field"><span>كلمة المرور</span><input type="password" class="ltr" value=${pw} onInput=${e => setPw(e.target.value)} autocomplete="current-password" /></label>
      ${err ? html`<div class="error">${err}</div>` : null}
      ${!SYNC.online ? html`<div class="notice">لا يوجد اتصال بالإنترنت. يلزم الاتصال لأول دخول فقط.</div>` : null}
      <${Btn} type="submit" cls="primary lg block" onClick=${submit}>دخول</${Btn}>
    </form></div></div>`;
}

async function afterLogin() {
  const mode = await db.getMeta('mode');
  const hasLocal = all('workspaces').length > 0;
  if (mode === 'demo' && hasLocal) {
    const up = await confirmDialog({ title: 'بيانات محلية من الوضع التجريبي', message: 'يوجد على هذا الجهاز بيانات أُدخلت في الوضع التجريبي.\nهل تريد رفعها إلى حسابك؟ اختر «إلغاء» لحذفها والبدء من بيانات حسابك فقط.', okText: 'رفعها إلى حسابي' });
    if (!up) { await db.clearStores([...db.TABLES, 'outbox']); await db.setMeta('lastPull', null); await loadAll(); }
  }
  await db.setMeta('mode', 'cloud');
  toast('جارٍ جلب بياناتك…');
  await syncNow();
  if (!S.wsId || !get('workspaces', S.wsId)) setWorkspace(all('workspaces').find(w => !w.archived)?.id || null);
  emit();
}
export { signOut };

// ---------- التشغيل ----------
async function boot() {
  applyTheme();
  const root = document.getElementById('app');
  try {
    await db.openDB();
    await loadAll();
    await initSync();
    if (SYNC.mode === 'demo') {
      await db.setMeta('mode', 'demo');
      if (!all('workspaces').length) await seedDemo();
    }
    const saved = localStorage.getItem('daftar-ws');
    setWorkspace(saved && get('workspaces', saved) ? saved : (all('workspaces').find(w => !w.archived)?.id || null));
    render(html`<${App} />`, root);
    // نشر لقطات الدرجات للبوابة دورياً (عند تفعيلها وفي الوضع المتصل فقط)
    if (SYNC.mode === 'cloud') { const pub = () => { if (workspace()?.portal?.enabled && SYNC.user && navigator.onLine) publishSnapshots().catch(() => {}); }; setTimeout(pub, 20000); setInterval(pub, 5 * 60000); }
    if (SYNC.mode === 'cloud' && SYNC.user) syncNow().then(() => { if (!S.wsId) { setWorkspace(all('workspaces').find(w => !w.archived)?.id || null); emit(); } });
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="loading"><div class="error">تعذر تشغيل التطبيق: ${e.message}</div></div>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
}
boot();
