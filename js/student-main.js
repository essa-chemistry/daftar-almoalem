// المرحلة 3 — بوابة الطالب (student.html): الدخول بالسجل المدني + رمز من 6 أرقام عبر دوال الخادم فقط
import { html, render, useState, useEffect } from './lib.js';
import { CONFIG } from '../config.js';
import { PortalView } from './portal-view.js';
import { compressImage, normDigits } from './utils.js';

const TOKEN = 'daftar-portal-token';
let sb = null;
async function rpc(name, args) {
  if (!sb) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message || 'تعذر الاتصال بالخادم');
  return data;
}
const getTok = () => { try { return sessionStorage.getItem(TOKEN); } catch { return null; } };
const setTok = t => { try { t ? sessionStorage.setItem(TOKEN, t) : sessionStorage.removeItem(TOKEN); } catch { } };

function Brand() { return html`<span class="brand" style="margin:0 auto 6px"></span>`; }

function Login({ onIn }) {
  const [nid, setNid] = useState(''); const [code, setCode] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); if (busy) return;
    setErr(''); setBusy(true);
    try {
      const r = await rpc('tr_portal_login', { p_nid: normDigits(nid).replace(/\D/g, ''), p_code: normDigits(code).replace(/\D/g, '') });
      if (!r?.ok) return setErr(r?.error || 'تعذر الدخول');
      setTok(r.token); onIn(r);
    } catch (x) { setErr(navigator.onLine ? x.message : 'لا يوجد اتصال بالإنترنت'); }
    finally { setBusy(false); }
  };
  return html`<div class="login"><form class="card stack" onSubmit=${submit} style="text-align:center">
    <${Brand} /><h1 style="font-size:1.45rem">بوابة الطالب</h1><p class="muted" style="margin:0">متابعة مادة الكيمياء</p>
    <label class="field" style="text-align:start"><span>رقم السجل المدني</span><input class="ltr" inputmode="numeric" autocomplete="username" maxlength="14" value=${nid} onInput=${e => setNid(e.target.value)} required /></label>
    <label class="field" style="text-align:start"><span>رمز الدخول (6 أرقام)</span><input class="ltr" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" value=${code} onInput=${e => setCode(e.target.value)} /><small>اتركه فارغاً إن أخبرك معلمك أن الدخول بالسجل المدني فقط.</small></label>
    ${err ? html`<div class="error">${err}</div>` : null}
    <button class=${'btn primary lg block' + (busy ? ' busy' : '')} disabled=${busy}>دخول</button>
  </form></div>`;
}

function ChangeCode({ done }) {
  const [v, setV] = useState({ old: '', n1: '', n2: '' }); const [msg, setMsg] = useState(null);
  const submit = async e => {
    e.preventDefault();
    const n1 = normDigits(v.n1);
    if (!/^\d{6}$/.test(n1)) return setMsg({ k: 'error', t: 'الرمز الجديد يجب أن يكون 6 أرقام' });
    if (n1 !== normDigits(v.n2)) return setMsg({ k: 'error', t: 'الرمزان غير متطابقين' });
    try { const r = await rpc('tr_portal_change_code', { p_token: getTok(), p_old: normDigits(v.old), p_new: n1 }); if (!r.ok) return setMsg({ k: 'error', t: r.error }); setMsg({ k: 'info', t: 'تم تغيير الرمز' }); setTimeout(done, 900); }
    catch (x) { setMsg({ k: 'error', t: x.message }); }
  };
  return html`<form class="card stack" onSubmit=${submit}><h2>تغيير رمز الدخول</h2>
    ${['old', 'n1', 'n2'].map((k, i) => html`<label class="field"><span>${['الرمز الحالي', 'الرمز الجديد (6 أرقام)', 'تأكيد الرمز الجديد'][i]}</span><input class="ltr" type="password" inputmode="numeric" maxlength="6" value=${v[k]} onInput=${e => setV({ ...v, [k]: e.target.value })} /></label>`)}
    ${msg ? html`<div class=${msg.k}>${msg.t}</div>` : null}
    <div class="row"><button class="btn primary">حفظ</button><button type="button" class="btn ghost" onClick=${done}>إلغاء</button></div></form>`;
}

function Photo({ d, done }) {
  const [img, setImg] = useState(null); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const pick = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { setImg(await compressImage(f, { maxDim: 400, maxBytes: 60000 })); } catch (x) { setMsg({ k: 'error', t: x.message }); } };
  const send = async () => {
    setBusy(true);
    try { const r = await rpc('tr_portal_upload_photo', { p_token: getTok(), p_data: img }); if (!r.ok) return setMsg({ k: 'error', t: r.error }); setMsg({ k: 'info', t: 'أُرسلت الصورة. لن تظهر حتى يعتمدها المعلم.' }); setTimeout(done, 1300); }
    catch (x) { setMsg({ k: 'error', t: x.message }); } finally { setBusy(false); }
  };
  return html`<div class="card stack"><h2>الصورة الشخصية</h2>
    ${d.photo_request === 'pending' ? html`<div class="notice">لديك صورة بانتظار اعتماد المعلم. رفع صورة جديدة يستبدلها.</div>` : d.photo_request === 'rejected' ? html`<div class="notice">لم يعتمد المعلم صورتك السابقة. يمكنك رفع صورة أخرى.</div>` : null}
    <p class="muted small" style="margin:0">صورة واضحة للوجه. تُصغَّر على جهازك قبل الإرسال، ولا تظهر في أي مكان حتى يعتمدها المعلم.</p>
    <label class="btn" style="justify-self:start">اختيار صورة<input type="file" accept="image/*" hidden onChange=${pick} /></label>
    ${img ? html`<img src=${img} alt="" style="width:140px;height:140px;border-radius:50%;object-fit:cover" />` : null}
    ${msg ? html`<div class=${msg.k}>${msg.t}</div>` : null}
    <div class="row"><button class=${'btn primary' + (busy ? ' busy' : '')} disabled=${!img || busy} onClick=${send}>إرسال للاعتماد</button><button class="btn ghost" onClick=${done}>رجوع</button></div></div>`;
}

function App() {
  const [d, setD] = useState(null); const [view, setView] = useState('home'); const [err, setErr] = useState(''); const [loading, setLoading] = useState(!!getTok());
  const [mustChange, setMustChange] = useState(false);
  const load = async () => {
    setLoading(true); setErr('');
    try { const r = await rpc('tr_portal_me', { p_token: getTok() }); if (!r.ok) { setErr(r.error); setD(null); } else setD(r); }
    catch (x) { if (/الجلسة/.test(x.message)) { setTok(null); setD(null); } else setErr(x.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (getTok()) load(); }, []);
  const logout = async () => { try { await rpc('tr_portal_logout', { p_token: getTok() }); } catch { } setTok(null); setD(null); setView('home'); };
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return html`<div class="login"><div class="card stack" style="text-align:center"><${Brand} /><h1 style="font-size:1.4rem">بوابة الطالب</h1><p class="muted" style="margin:0">البوابة غير مفعّلة بعد. سيفعّلها معلمك قريباً.</p></div></div>`;
  if (loading) return html`<div class="loading"><span class="brand"></span><span>جارٍ التحميل…</span></div>`;
  if (!d) return html`${err ? html`<div class="page" style="max-width:520px"><div class="error">${err}</div></div>` : null}<${Login} onIn=${r => { setMustChange(!!r.must_change); load(); }} />`;
  return html`<div class="page" style="max-width:860px">
    <div class="page-head"><div><h1>بوابة الطالب</h1><div class="sub">بياناتك فقط — كما يتيحها معلمك</div></div>
      <div class="actions"><button class="btn sm" onClick=${() => setView('photo')}>الصورة</button><button class="btn sm" onClick=${() => setView('code')}>تغيير الرمز</button><button class="btn sm" onClick=${load}>تحديث</button><button class="btn sm danger-soft" onClick=${logout}>خروج</button></div></div>
    ${mustChange && view === 'home' ? html`<div class="notice row" style="margin-bottom:12px"><span class="grow">ننصحك بتغيير الرمز الذي استلمته من معلمك.</span><button class="btn sm" onClick=${() => setView('code')}>تغيير الآن</button></div>` : null}
    ${view === 'code' ? html`<${ChangeCode} done=${() => { setMustChange(false); setView('home'); }} />` : view === 'photo' ? html`<${Photo} d=${d} done=${() => { setView('home'); load(); }} />` : html`<${PortalView} d=${d} />`}
    <p class="muted small" style="text-align:center;margin-top:18px">للخروج من جهاز مشترك اضغط «خروج». تنتهي الجلسة تلقائياً بعد 12 ساعة.</p>
  </div>`;
}
render(html`<${App} />`, document.getElementById('app'));
