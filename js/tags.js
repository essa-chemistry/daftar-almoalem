// مكتبة وسوم المعلم: قائمة واحدة لمساحة العمل، يُختار منها لأي طالب، وتُدار (إضافة/إعادة تسمية/حذف/ترتيب)
import { html, useState } from './lib.js';
import { ws, patch, saveMany, audit, workspace } from './store.js';
import { useStore, Icon, ModalHead, openModal, confirmDialog, toast } from './ui.js';
import { TEACHER_TAGS } from './defaults.js';

const clean = t => String(t || '').replace(/\s+/g, ' ').trim();

// المكتبة = المحفوظة (أو الافتراضية) + أي وسم مستخدم عند طالب ولم يُضف بعد (مثل الوسوم المضافة قبل هذا التحديث)
export function tagLibrary() {
  const w = workspace();
  const base = Array.isArray(w?.tag_library) ? w.tag_library : TEACHER_TAGS;
  const used = ws('student_private').flatMap(p => p.tags || []);
  return [...new Set([...base, ...used].map(clean).filter(Boolean))];
}
export const tagCounts = () => {
  const m = new Map();
  for (const p of ws('student_private')) for (const t of p.tags || []) m.set(t, (m.get(t) || 0) + 1);
  return m;
};
const setLibrary = list => patch('workspaces', workspace().id, { tag_library: [...new Set(list.map(clean).filter(Boolean))] });

export async function addTag(name) {
  const t = clean(name); if (!t) return null;
  const lib = tagLibrary();
  if (!lib.includes(t)) await setLibrary([...lib, t]);
  return t;
}
export async function renameTag(from, to) {
  to = clean(to); if (!to || to === from) return;
  const lib = tagLibrary();
  await setLibrary(lib.includes(to) ? lib.filter(x => x !== from) : lib.map(x => (x === from ? to : x)));
  const rows = ws('student_private', p => (p.tags || []).includes(from));
  await saveMany('student_private', rows.map(p => ({ ...p, tags: [...new Set(p.tags.map(x => (x === from ? to : x)))] })));
  await audit('إعادة تسمية وسم', `«${from}» ← «${to}» (${rows.length} طالب)`);
}
export async function deleteTag(t) {
  const rows = ws('student_private', p => (p.tags || []).includes(t));
  await setLibrary(tagLibrary().filter(x => x !== t));
  if (rows.length) await saveMany('student_private', rows.map(p => ({ ...p, tags: p.tags.filter(x => x !== t) })));
  await audit('حذف وسم', `«${t}»${rows.length ? ` وأُزيل من ${rows.length} طالب` : ''}`);
}
async function moveTag(t, d) {
  const lib = tagLibrary(); const i = lib.indexOf(t); const j = i + d;
  if (i < 0 || j < 0 || j >= lib.length) return;
  [lib[i], lib[j]] = [lib[j], lib[i]]; await setLibrary(lib);
}

function TagManager({ close }) {
  useStore();
  const lib = tagLibrary(); const counts = tagCounts();
  const [nw, setNw] = useState(''); const [edit, setEdit] = useState(null); const [val, setVal] = useState('');
  const add = async e => {
    e?.preventDefault(); const t = clean(nw); if (!t) return;
    if (lib.includes(t)) return toast('الوسم موجود مسبقاً', 'warn');
    await addTag(t); setNw(''); toast(`أُضيف «${t}» — متاح الآن لكل الطلاب`, 'ok');
  };
  const doRename = async t => {
    const to = clean(val); setEdit(null);
    if (!to || to === t) return;
    const n = counts.get(t) || 0;
    if (lib.includes(to) && !(await confirmDialog({ title: 'دمج الوسمين', message: `الوسم «${to}» موجود. سيُدمج «${t}» فيه${n ? ` لدى ${n} طالب` : ''}.`, okText: 'دمج' }))) return;
    await renameTag(t, to); toast('تم التعديل', 'ok');
  };
  const doDelete = async t => {
    const n = counts.get(t) || 0;
    if (!(await confirmDialog({ title: 'حذف وسم', message: n ? `الوسم «${t}» موضوع على ${n} طالب، وسيُزال عنهم أيضاً.` : `حذف «${t}» من قائمة الوسوم؟`, okText: 'حذف', danger: true }))) return;
    await deleteTag(t); toast('حُذف الوسم', 'ok');
  };
  return html`<${ModalHead} title="إدارة وسوم المعلم" close=${close} />
    <div class="modal-body">
      <form class="row" onSubmit=${add} style="margin-bottom:12px"><input class="grow" placeholder="وسم جديد، مثال: ينام في الحصة" value=${nw} onInput=${e => setNw(e.target.value)} maxlength="40" />
        <button class="btn primary sm" disabled=${!clean(nw)}><${Icon} name="plus" size=${16} /> إضافة</button></form>
      <div class="tag-list">${lib.map((t, i) => html`<div class="tag-row" key=${t}>
        ${edit === t ? html`<form class="row grow" onSubmit=${e => { e.preventDefault(); doRename(t); }}><input class="grow" value=${val} onInput=${e => setVal(e.target.value)} autofocus maxlength="40" />
            <button class="btn primary sm">حفظ</button><button type="button" class="btn ghost sm" onClick=${() => setEdit(null)}>إلغاء</button></form>`
          : html`<span class="grow"><b>${t}</b> <span class="muted small">${counts.get(t) ? `${counts.get(t)} طالب` : 'غير مستخدم'}</span></span>
            <button class="icon-btn sm" title="أعلى" disabled=${i === 0} onClick=${() => moveTag(t, -1)}>▲</button>
            <button class="icon-btn sm" title="أسفل" disabled=${i === lib.length - 1} onClick=${() => moveTag(t, 1)}>▼</button>
            <button class="icon-btn sm" title="تعديل الاسم" onClick=${() => { setEdit(t); setVal(t); }}><${Icon} name="edit" size=${16} /></button>
            <button class="icon-btn sm" title="حذف" onClick=${() => doDelete(t)}><${Icon} name="trash" size=${16} /></button>`}
      </div>`)}</div>
      <p class="muted small" style="margin-top:10px">الوسوم مشتركة بين كل طلاب مساحة العمل، وتعديل اسم الوسم يُطبَّق على كل من يحمله. الوسوم خاصة بالمعلم ولا تظهر للطالب ولا في التقارير.</p>
    </div>
    <div class="modal-foot"><button class="btn primary" onClick=${close}>تم</button></div>`;
}
export const openTagManager = () => openModal(close => html`<${TagManager} close=${close} />`, { size: 'sm' });
