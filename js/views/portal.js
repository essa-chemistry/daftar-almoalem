// المرحلة 3 — إدارة بوابة الطالب: الإعدادات والصلاحيات، الرموز وقصاصاتها، طلبات الصور، المعاينة
import { html, useState, useEffect } from '../lib.js';
import { get, ws, save, patch, audit, workspace, classes, className, roster } from '../store.js';
import { useStore, Icon, Btn, Tabs, Empty, go, confirmDialog, toast, Avatar } from '../ui.js';
import { SYNC } from '../sync.js';
import { SHOW_KEYS, portalCfg, publishSnapshots, buildPortalData, generateCodes, accessStatus, unlockStudent, slipsSheet, studentPortalUrl } from '../portal.js';
import { PortalView } from '../portal-view.js';
import { printHTML } from '../print.js';
import { todayISO, fmtDateTime } from '../utils.js';

export function PortalPage({ q = {} }) {
  useStore();
  const tab = q.tab || 'access';
  const pending = ws('photo_requests', r => r.status === 'pending').length;
  const w = workspace(); const cfg = portalCfg(w, null);
  return html`<div class="page">
    <div class="page-head"><a class="icon-btn" href="#/classes"><${Icon} name="back" /></a><div><h1>بوابة الطالب</h1><div class="sub">الطالب يرى بياناته فقط عبر دوال على الخادم؛ لا ملاحظات خاصة ولا تنبيهات صحية ولا بيانات زملاء.</div></div>
      <div class="actions">${cfg.enabled ? html`<span class=${'badge ' + (cfg.paused ? 'warn' : 'pos')}>${cfg.paused ? 'متوقفة مؤقتاً' : 'مفعّلة'}</span>` : html`<span class="badge neg">غير مفعّلة</span>`}</div></div>
    ${SYNC.mode === 'demo' ? html`<div class="notice" style="margin-bottom:12px">البوابة تحتاج ربط التطبيق بـ Supabase وتشغيل phase3.sql. في الوضع التجريبي يمكنك ضبط الإعدادات ومعاينة ما سيراه الطالب فقط.</div>` : null}
    <${Tabs} active=${tab} onChange=${t => go('#/portal?tab=' + t)} tabs=${[{ key: 'access', label: 'الرموز والدخول' }, { key: 'photos', label: 'طلبات الصور', badge: pending || null }, { key: 'settings', label: 'الإعدادات والصلاحيات' }, { key: 'preview', label: 'معاينة كطالب' }]} />
    ${tab === 'access' ? html`<${Access} q=${q} />` : tab === 'photos' ? html`<${Photos} />` : tab === 'settings' ? html`<${PortalSettings} />` : html`<${Preview} q=${q} />`}
  </div>`;
}

function Access({ q }) {
  const cls = classes();
  const [cid, setCid] = useState(q.class || cls[0]?.id || '');
  const [st, setSt] = useState(null); const [err, setErr] = useState('');
  const list = cid ? roster(cid, todayISO()) : [];
  const ids = list.map(x => x.student.id).join(',');
  const refresh = async () => { setErr(''); try { setSt(await accessStatus(list.map(x => x.student.id))); } catch (e) { setErr(e.message); } };
  useEffect(() => { refresh(); }, [cid, ids]);
  const issue = async (targets, label) => {
    if (!targets.length) return toast('لا يوجد طلاب', 'warn');
    if (!await confirmDialog({ title: label, message: `سيُولَّد رمز جديد لـ ${targets.length} طالب ويُلغى أي رمز سابق لهم. الرموز تظهر مرة واحدة في القصاصات المطبوعة فقط ولا تُحفظ في أي مكان.`, okText: 'توليد وطباعة' })) return;
    const res = await generateCodes(targets.map(x => x.student.id));
    await audit('توليد رموز البوابة', `${className(get('classes', cid))}: ${res.length} طالب`);
    printHTML(await slipsSheet(res.map(r => ({ student: get('students', r.id), code: r.code }))));
    toast('وُلّدت الرموز — احفظ القصاصات أو اطبعها الآن', 'ok', 5000);
    refresh();
  };
  const unlock = async x => { await unlockStudent(x.student.id); await audit('إعادة ضبط دخول البوابة', x.student.full_name); toast('أُلغي الإيقاف', 'ok'); refresh(); };
  const noCode = list.filter(x => st && !st.get(x.student.id)?.has_code);
  return html`<div class="stack">
    <div class="card row"><select style="max-width:220px" value=${cid} onChange=${e => setCid(e.target.value)}>${cls.map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select>
      <span class="grow"></span>
      <${Btn} cls="soft" disabled=${!st} onClick=${() => issue(noCode, 'رموز لمن ليس لديه رمز')}>رموز لمن ليس لديه (${noCode.length})</${Btn}>
      <${Btn} cls="primary" disabled=${!st} onClick=${() => issue(list, 'رموز جديدة للفصل كله')}><${Icon} name="print" /> رموز جديدة للجميع وطباعتها</${Btn}></div>
    <div class="info small">رابط البوابة للطلاب: <b class="ltr">${studentPortalUrl()}</b> — يُطبع على القصاصات مع رمز QR.</div>
    ${err ? html`<div class="error">${err}</div>` : !st && SYNC.mode === 'cloud' ? html`<div class="notice">اتصل بالإنترنت لعرض حالة الرموز.</div>` : null}
    <div class="table-wrap"><table class="tbl nowrap"><thead><tr><th>الطالب</th><th>السجل المدني</th><th>الرمز</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${list.map(x => { const s = st?.get(x.student.id); return html`<tr>
        <td><span class="row" style="flex-wrap:nowrap"><${Avatar} student=${x.student} size=${30} /> ${x.student.full_name}</span></td>
        <td>${x.student.id_last4 ? html`<span class="ltr">••••••${x.student.id_last4}</span>` : html`<span class="badge neg">غير مسجل</span>`} ${s && !s.has_nid ? html`<span class="badge warn" title="لم تصل بصمة السجل للخادم بعد">بانتظار المزامنة</span>` : null}</td>
        <td>${!s ? '—' : s.has_code ? html`<span class="badge pos">موجود${s.changed ? ' — غيّره الطالب' : ''}</span>` : html`<span class="badge">لا يوجد</span>`}</td>
        <td>${s?.locked ? html`<span class="badge neg">موقوف مؤقتاً</span>` : '—'}</td>
        <td><${Btn} cls="sm" disabled=${!st} onClick=${() => issue([x], 'رمز جديد')}>رمز جديد</${Btn}>${s?.locked ? html` <${Btn} cls="sm ghost" onClick=${() => unlock(x)}>فك الإيقاف</${Btn}>` : null}</td></tr>`; })}
    </tbody></table></div>
    <p class="muted small">الرمز يُحفظ على الخادم كبصمة مشفرة فقط، لذلك لا يمكن عرضه لاحقاً؛ إن ضاع يُولَّد رمز جديد. بعد 5 محاولات خاطئة خلال 15 دقيقة يُوقف الدخول 15 دقيقة.</p>
  </div>`;
}

function Photos() {
  useStore();
  const pending = ws('photo_requests', r => r.status === 'pending').sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  const done = ws('photo_requests', r => r.status !== 'pending').sort((a, b) => (b.decided_at || '').localeCompare(a.decided_at || '')).slice(0, 10);
  const approve = async r => {
    await save('student_photos', { id: r.student_id, student_id: r.student_id, data: r.data, status: 'approved', source: 'student', approved_at: new Date().toISOString() });
    await patch('photo_requests', r.id, { status: 'approved', decided_at: new Date().toISOString() });
    toast('اعتُمدت الصورة', 'ok');
  };
  const reject = async r => { await patch('photo_requests', r.id, { status: 'rejected', decided_at: new Date().toISOString() }); toast('رُفضت الصورة'); };
  return html`<div class="stack">
    ${pending.length ? html`<div class="grid-3">${pending.map(r => { const st = get('students', r.student_id); return html`<div class="card stack" style="justify-items:center;text-align:center">
      <div class="row" style="justify-content:center;gap:18px"><div><div class="muted small">الحالية</div>${st ? html`<${Avatar} student=${st} size=${70} />` : null}</div><span class="muted">←</span><div><div class="muted small">الجديدة</div><img src=${r.data} alt="" style="width:110px;height:110px;border-radius:50%;object-fit:cover" /></div></div>
      <b>${st?.full_name || 'طالب محذوف'}</b><span class="muted small">${fmtDateTime(r.uploaded_at || r.created_at)}</span>
      <div class="row"><${Btn} cls="primary sm" onClick=${() => approve(r)}>اعتماد</${Btn}><${Btn} cls="sm danger-soft" onClick=${() => reject(r)}>رفض</${Btn}></div></div>`; })}</div>`
    : html`<div class="card"><${Empty} icon="check" title="لا توجد صور بانتظار الاعتماد">الصور التي يرفعها الطلاب تظهر هنا، ولا تظهر في أي مكان آخر حتى تعتمدها.</${Empty}></div>`}
    ${done.length ? html`<div class="card"><h2>آخر القرارات</h2><div class="list">${done.map(r => html`<div class="li"><span class="grow">${get('students', r.student_id)?.full_name || '—'}</span><span class=${'badge ' + (r.status === 'approved' ? 'pos' : 'neg')}>${r.status === 'approved' ? 'اعتُمدت' : 'رُفضت'}</span><span class="muted small">${fmtDateTime(r.decided_at)}</span></div>`)}</div></div>` : null}
  </div>`;
}

export function PortalSettings() {
  useStore();
  const w = workspace(); const p = w.portal || {};
  const set = ch => patch('workspaces', w.id, { portal: { ...p, ...ch } });
  const [cid, setCid] = useState(classes()[0]?.id || '');
  const clsCfg = p.classes?.[cid] || {};
  const setCls = ch => set({ classes: { ...(p.classes || {}), [cid]: { ...clsCfg, ...ch } } });
  const show = { ...Object.fromEntries(Object.keys(SHOW_KEYS).map(k => [k, true])), ...(p.show || {}) };
  const toggleReq = async on => {
    if (!on && !await confirmDialog({ title: 'الدخول بالسجل المدني فقط', message: 'هذا أقل أماناً: زملاء الطالب قد يعرفون رقم سجله المدني فيدخلون بياناته. يُنصح بإبقاء الرمز.', danger: true, okText: 'تعطيل الرمز رغم ذلك' })) return;
    await set({ require_code: on }); await audit('إعداد البوابة', on ? 'تفعيل اشتراط الرمز' : 'تعطيل اشتراط الرمز');
  };
  return html`<div class="grid-2" style="align-items:start">
    <div class="card stack"><h2>تشغيل البوابة</h2>
      <label class="check"><input type="checkbox" checked=${!!p.enabled} onChange=${async e => { await set({ enabled: e.target.checked }); await audit('إعداد البوابة', e.target.checked ? 'تفعيل' : 'إيقاف'); }} /> تفعيل بوابة الطالب</label>
      <label class="check"><input type="checkbox" checked=${!!p.paused} onChange=${e => set({ paused: e.target.checked })} /> إيقاف البوابة مؤقتاً (لكل الفصول)</label>
      <label class="check"><input type="checkbox" checked=${p.require_code !== false} onChange=${e => toggleReq(e.target.checked)} /> اشتراط رمز الدخول (موصى به)</label>
      ${p.require_code === false ? html`<div class="error small">الدخول بالسجل المدني وحده أقل أماناً.</div>` : null}
      <label class="field"><span>إظهار الدرجات بعد تاريخ (اختياري)</span><input type="date" value=${p.grades_after || ''} onChange=${e => set({ grades_after: e.target.value || null })} /></label>
      <${Btn} cls="soft" onClick=${async () => { const n = await publishSnapshots(); toast(n ? `نُشرت درجات ${n} طالب` : 'الدرجات المنشورة محدّثة', 'ok'); }}>نشر الدرجات للبوابة الآن</${Btn}>
      <p class="muted small" style="margin:0">تُنشر لقطة الدرجة تلقائياً كل بضع دقائق عند الاتصال. بعد «اعتماد درجات الفصل» تظهر للطالب القيم المعتمدة.</p></div>
    <div class="card stack"><h2>ما يراه الطالب (كل الفصول)</h2>
      <div class="chips">${Object.entries(SHOW_KEYS).map(([k, l]) => html`<button class=${'chip' + (show[k] ? ' on' : '')} onClick=${() => set({ show: { ...show, [k]: !show[k] } })}>${show[k] ? '✓' : '✗'} ${l}</button>`)}</div>
      <p class="muted small" style="margin:0">ولكل نوع حدث خيار «يظهر للطالب» في الإعدادات ← أنواع الأحداث. يرى الطالب نوع الحدث وتاريخه فقط، لا نص الملاحظة.</p>
      <h3 style="margin-top:8px">تخصيص فصل بعينه</h3>
      <select value=${cid} onChange=${e => setCid(e.target.value)}>${classes().map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select>
      <label class="check"><input type="checkbox" checked=${!!clsCfg.paused} onChange=${e => setCls({ paused: e.target.checked })} /> إيقاف البوابة مؤقتاً لهذا الفصل</label>
      <div class="table-wrap"><table class="tbl"><tbody>${Object.entries(SHOW_KEYS).map(([k, l]) => { const v = clsCfg.show?.[k]; const setV = nv => { const s2 = { ...(clsCfg.show || {}) }; if (nv == null) delete s2[k]; else s2[k] = nv; setCls({ show: s2 }); }; return html`<tr><td>${l}</td><td><div class="chips">
        <button class=${'chip' + (v == null ? ' on' : '')} onClick=${() => setV(null)}>كالعام (${show[k] ? 'يظهر' : 'مخفي'})</button><button class=${'chip' + (v === true ? ' on' : '')} onClick=${() => setV(true)}>يظهر</button><button class=${'chip' + (v === false ? ' on' : '')} onClick=${() => setV(false)}>مخفي</button></div></td></tr>`; })}</tbody></table></div>
      <p class="muted small" style="margin:0">كل هذه الفلاتر تُطبَّق على الخادم داخل دوال البوابة، ولا يُكتفى بإخفائها في الواجهة.</p></div>
  </div>`;
}

function Preview({ q }) {
  useStore();
  const cls = classes();
  const [cid, setCid] = useState(cls[0]?.id || '');
  const list = cid ? roster(cid, todayISO()) : [];
  const [sid, setSid] = useState(q.student || '');
  const id = sid || list[0]?.student.id;
  const d = id ? buildPortalData(id) : null;
  return html`<div class="stack">
    <div class="card row"><select style="max-width:220px" value=${cid} onChange=${e => { setCid(e.target.value); setSid(''); }}>${cls.map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select>
      <select style="max-width:300px" value=${id || ''} onChange=${e => setSid(e.target.value)}>${list.map(x => html`<option value=${x.student.id}>${x.student.full_name}</option>`)}</select></div>
    <div class="info small">معاينة على هذا الجهاز بالإعدادات الحالية. البوابة الفعلية تجلب البيانات نفسها مفلترة من الخادم${!portalCfg(workspace(), null).enabled ? ' — البوابة غير مفعّلة الآن، فلن يستطيع الطلاب الدخول' : ''}.</div>
    ${d ? html`<div style="max-width:860px"><${PortalView} d=${d} /></div>` : html`<${Empty} title="لا يوجد طلاب" />`}
  </div>`;
}
