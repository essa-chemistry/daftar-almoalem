// مكونات واجهة مشتركة: أيقونات، صورة الطالب، نوافذ حوار، تنبيهات، أزرار آمنة من الضغط المزدوج
import { html, useState, useEffect, useRef } from './lib.js';
import { S, subscribe, photoOf, privateOf } from './store.js';
import { colorFor, initial } from './utils.js';

// إعادة الرسم عند تغير المخزن
export function useStore() {
  const [, set] = useState(0);
  useEffect(() => subscribe(() => set(v => v + 1)), []);
  return S.version;
}

// ---------- أيقونات SVG ----------
const P = {
  today: 'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  tasks: 'M9 4h6v3H9zM8 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H16M8.5 12.5l2 2 4-4M8.5 17.5h7',
  grades: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  print: 'M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.6-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.6 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z',
  plus: 'M12 5v14M5 12h14', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16', download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  back: 'M9 6l6 6-6 6', close: 'M6 6l12 12M18 6L6 18', check: 'M5 12.5l4.5 4.5L19 7',
  shuffle: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  play: 'M7 4.5v15l12-7.5z', stop: 'M6 6h12v12H6z', mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11', alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  calendar: 'M8 2v4M16 2v4M3.5 9h17M5 4h14a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 19 21H5a1.5 1.5 0 0 1-1.5-1.5v-14A1.5 1.5 0 0 1 5 4z',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13a1.5 1.5 0 0 0 1.5 1.4h9a1.5 1.5 0 0 0 1.5-1.4L19 7M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4', eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  cloud: 'M7 18a5 5 0 0 1-.7-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z', logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  hex: 'M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z', screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
  note: 'M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 17h5', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  file: 'M6 3h8l5 5v13H6zM14 3v5h5', archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4', swap: 'M7 4l-4 4 4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z', phone: 'M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z',
  menu: 'M4 6h16M4 12h16M4 18h16', pip: 'M3 5h18v14H3zM12 12h7v5h-7z', book: 'M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20M8 7h8M8 11h6', moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
};
export const Icon = ({ name, size = 20, cls = '' }) => html`<svg class=${'ic ' + cls} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${P[name] || P.hex} /></svg>`;

// ---------- صورة الطالب الدائرية ----------
export function Avatar({ student, size = 52, health = false, cls = '' }) {
  if (!student) return null;
  const src = photoOf(student.id);
  const pv = health ? privateOf(student.id) : null;
  const hasHealth = pv && ((pv.health || []).length || pv.health_note);
  return html`<span class=${'avatar ' + cls} style=${`--sz:${size}px;--c:${colorFor(student.id)}`}>
    ${src ? html`<img src=${src} alt="" loading="lazy" />` : html`<span class="av-letter">${initial(student.full_name)}</span>`}
    ${hasHealth ? html`<span class="av-health" title=${'تنبيه صحي: ' + [...(pv.health || []), pv.health_note].filter(Boolean).join('، ')}>+</span>` : null}
  </span>`;
}

// ---------- تنبيهات منبثقة ----------
let toasts = [], toastListeners = new Set();
export function toast(text, kind = 'info', ms = 3200) {
  const t = { id: Math.random(), text, kind };
  toasts = [...toasts, t]; toastListeners.forEach(f => f());
  setTimeout(() => { toasts = toasts.filter(x => x !== t); toastListeners.forEach(f => f()); }, ms);
}
export function ToastHost() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set(v => v + 1); toastListeners.add(f); return () => toastListeners.delete(f); }, []);
  return html`<div class="toasts" role="status" aria-live="polite">${toasts.map(t => html`<div key=${t.id} class=${'toast ' + t.kind}>${t.text}</div>`)}</div>`;
}

// ---------- نوافذ حوار ----------
let modals = [], modalListeners = new Set();
const notify = () => modalListeners.forEach(f => f());
export function openModal(render, opts = {}) {
  const m = { id: Math.random(), render, opts };
  m.close = () => { modals = modals.filter(x => x !== m); notify(); opts.onClose?.(); };
  modals = [...modals, m]; notify();
  return m.close;
}
export function ModalHost() {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set(v => v + 1); modalListeners.add(f); return () => modalListeners.delete(f); }, []);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && modals.length && !modals[modals.length - 1].opts.locked) modals[modals.length - 1].close(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  return html`${modals.map((m, i) => html`<div key=${m.id} class=${'modal-back' + (m.opts.full ? ' full' : '')} style=${`z-index:${100 + i}`} onClick=${e => { if (e.target === e.currentTarget && !m.opts.locked) m.close(); }}>
    <div class=${'modal ' + (m.opts.size || '')} role="dialog" aria-modal="true">${m.render(m.close)}</div>
  </div>`)}`;
}
export const ModalHead = ({ title, close, children }) => html`<div class="modal-head"><h3>${title}</h3>${children}<button class="icon-btn" onClick=${close} aria-label="إغلاق"><${Icon} name="close" /></button></div>`;

function ConfirmBody({ title, message, okText, danger, typeToConfirm, done }) {
  const [txt, setTxt] = useState('');
  const ok = !typeToConfirm || txt.trim() === typeToConfirm;
  return html`<${ModalHead} title=${title} close=${() => done(false)} />
    <div class="modal-body"><p class="pre">${message}</p>
    ${typeToConfirm ? html`<label class="field"><span>للتأكيد اكتب: <b>${typeToConfirm}</b></span><input value=${txt} onInput=${e => setTxt(e.target.value)} autofocus /></label>` : null}</div>
    <div class="modal-foot"><button class="btn ghost" onClick=${() => done(false)}>إلغاء</button>
    <button class=${'btn ' + (danger ? 'danger' : 'primary')} disabled=${!ok} onClick=${() => done(true)}>${okText}</button></div>`;
}
export function confirmDialog({ title = 'تأكيد', message = '', okText = 'تأكيد', danger = false, typeToConfirm = '' }) {
  return new Promise(res => {
    let settled = false;
    const close = openModal(() => html`<${ConfirmBody} ...${{ title, message, okText, danger, typeToConfirm }} done=${v => { settled = true; close(); res(v); }} />`,
      { size: 'sm', onClose: () => { if (!settled) res(false); } });
  });
}

function FormBody({ title, fields, okText, validate, done }) {
  const [vals, setVals] = useState(() => Object.fromEntries(fields.map(f => [f.name, f.value ?? (f.type === 'checkbox' ? false : f.type === 'multi' ? [] : '')])));
  const [err, setErr] = useState('');
  const set = (k, v) => setVals(o => ({ ...o, [k]: v }));
  const submit = e => {
    e?.preventDefault();
    for (const f of fields) if (f.required && (vals[f.name] === '' || vals[f.name] == null)) return setErr(`الحقل «${f.label}» مطلوب`);
    const msg = validate?.(vals); if (msg) return setErr(msg);
    done(vals);
  };
  return html`<form onSubmit=${submit}><${ModalHead} title=${title} close=${() => done(null)} />
    <div class="modal-body form-grid">
      ${fields.map(f => html`<${FieldInput} key=${f.name} f=${f} value=${vals[f.name]} onChange=${v => set(f.name, v)} />`)}
      ${err ? html`<div class="error full">${err}</div>` : null}
    </div>
    <div class="modal-foot"><button type="button" class="btn ghost" onClick=${() => done(null)}>إلغاء</button><button class="btn primary">${okText}</button></div></form>`;
}
// نموذج سريع بحقول متعددة — يرجع القيم أو null
export function formDialog({ title, fields, okText = 'حفظ', size = 'sm', validate }) {
  return new Promise(res => {
    let settled = false;
    const close = openModal(() => html`<${FormBody} ...${{ title, fields, okText, validate }} done=${v => { settled = true; close(); res(v); }} />`,
      { size, onClose: () => { if (!settled) res(null); } });
  });
}
export function FieldInput({ f, value, onChange }) {
  const lab = html`<span>${f.label}${f.required ? html` <b class="req">*</b>` : ''}</span>`;
  const full = f.full ? ' full' : '';
  if (f.type === 'select') return html`<label class=${'field' + full}>${lab}<select value=${value} onChange=${e => onChange(e.target.value)}>${(f.options || []).map(o => html`<option value=${o.value ?? o}>${o.label ?? o}</option>`)}</select>${f.hint ? html`<small>${f.hint}</small>` : null}</label>`;
  if (f.type === 'textarea') return html`<label class=${'field full'}>${lab}<textarea rows=${f.rows || 3} value=${value} placeholder=${f.placeholder || ''} onInput=${e => onChange(e.target.value)}></textarea></label>`;
  if (f.type === 'checkbox') return html`<label class=${'check' + full}><input type="checkbox" checked=${!!value} onChange=${e => onChange(e.target.checked)} /> ${f.label}</label>`;
  if (f.type === 'multi') return html`<div class="field full">${lab}<div class="chips">${f.options.map(o => { const on = (value || []).includes(o.value ?? o); return html`<button type="button" class=${'chip' + (on ? ' on' : '')} onClick=${() => onChange(on ? value.filter(x => x !== (o.value ?? o)) : [...(value || []), o.value ?? o])}>${o.label ?? o}</button>`; })}</div></div>`;
  return html`<label class=${'field' + full}>${lab}<input type=${f.type || 'text'} value=${value} step=${f.step} min=${f.min} max=${f.max} placeholder=${f.placeholder || ''} inputmode=${f.inputmode} onInput=${e => onChange(e.target.value)} />${f.hint ? html`<small>${f.hint}</small>` : null}</label>`;
}

// زر يمنع الضغط المزدوج ويعرض حالة التحميل للعمليات غير المتزامنة
export function Btn({ onClick, cls = '', children, title, disabled, type = 'button' }) {
  const [busy, setBusy] = useState(false);
  const run = async e => {
    if (busy) return;
    const r = onClick?.(e);
    if (r && typeof r.then === 'function') {
      setBusy(true);
      try { await r; } catch (err) { toast(err.message || 'حدث خطأ غير متوقع', 'err', 5000); console.error(err); } finally { setBusy(false); }
    }
  };
  return html`<button type=${type} class=${'btn ' + cls + (busy ? ' busy' : '')} disabled=${disabled || busy} title=${title} onClick=${run}>${children}</button>`;
}

export function Tabs({ tabs, active, onChange }) {
  return html`<div class="tabs" role="tablist">${tabs.map(t => html`<button role="tab" class=${t.key === active ? 'on' : ''} onClick=${() => onChange(t.key)}>${t.label}${t.badge ? html`<span class="tab-badge">${t.badge}</span>` : null}</button>`)}</div>`;
}
export const Empty = ({ icon = 'hex', title, children }) => html`<div class="empty"><span class="hexmark"><${Icon} name=${icon} size=${26} /></span><h4>${title}</h4>${children}</div>`;
export const go = hash => { location.hash = hash; };

// ضغطة مطولة
export function useLongPress(onLong, onShort, ms = 520) {
  const t = useRef(null), fired = useRef(false);
  const start = e => { fired.current = false; clearTimeout(t.current); t.current = setTimeout(() => { fired.current = true; navigator.vibrate?.(20); onLong(e); }, ms); };
  const cancel = () => clearTimeout(t.current);
  return {
    onPointerDown: start, onPointerUp: e => { cancel(); if (!fired.current) onShort(e); }, onPointerLeave: cancel,
    onContextMenu: e => { e.preventDefault(); }, onPointerCancel: cancel,
  };
}
