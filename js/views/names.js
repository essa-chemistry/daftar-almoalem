// المرحلة 2 — «اختبر نفسك في الأسماء»: صورة الطالب وتتذكر اسمه، بتكرار متباعد (صناديق لايتنر)
import { html, useState, useMemo } from '../lib.js';
import { get, all, save, classes, className, roster, photoOf } from '../store.js';
import { useStore, Icon, Btn, Empty, Avatar } from '../ui.js';
import { todayISO, addDays, randFloat, shortName } from '../utils.js';

const INTERVALS = [0, 1, 2, 4, 8, 16]; // أيام حتى المراجعة التالية لكل صندوق
const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(randFloat() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

function buildQueue(list, size) {
  const today = todayISO();
  const withRec = list.map(x => ({ x, r: get('name_practice', x.student.id) }));
  const due = withRec.filter(o => !o.r || !o.r.due || o.r.due <= today).sort((a, b) => (a.r?.box || 0) - (b.r?.box || 0) || randFloat() - 0.5);
  const later = shuffle(withRec.filter(o => o.r && o.r.due > today));
  return [...due, ...later].slice(0, size).map(o => o.x.student.id);
}

export function NamesPage({ q = {} }) {
  useStore();
  const cls = classes();
  const [cid, setCid] = useState(q.class || cls[0]?.id || '');
  const [mode, setMode] = useState('choices'); // choices | recall
  const [size, setSize] = useState(10);
  const [queue, setQueue] = useState(null);
  const [pos, setPos] = useState(0);
  const [ans, setAns] = useState(null); // { ok, chosen }
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState({ ok: 0, bad: 0 });
  const list = cid ? roster(cid, todayISO()) : [];
  const withPhoto = list.filter(x => photoOf(x.student.id));
  const today = todayISO();
  const boxes = [1, 2, 3, 4, 5].map(b => withPhoto.filter(x => (get('name_practice', x.student.id)?.box || 1) === b).length);
  const dueN = withPhoto.filter(x => { const r = get('name_practice', x.student.id); return !r || !r.due || r.due <= today; }).length;

  const start = () => { setQueue(buildQueue(withPhoto, size)); setPos(0); setAns(null); setRevealed(false); setScore({ ok: 0, bad: 0 }); };
  const curId = queue?.[pos];
  const cur = curId ? get('students', curId) : null;
  const options = useMemo(() => {
    if (!cur) return [];
    const others = shuffle(list.filter(x => x.student.id !== cur.id)).slice(0, 3).map(x => x.student);
    return shuffle([cur, ...others]);
  }, [curId, pos]);

  const grade = async ok => {
    const r = get('name_practice', cur.id) || { id: cur.id, student_id: cur.id, box: 1, correct: 0, wrong: 0 };
    const box = ok ? Math.min(5, (r.box || 1) + 1) : 1;
    await save('name_practice', { ...r, box, due: addDays(today, ok ? INTERVALS[box] : 0), correct: (r.correct || 0) + (ok ? 1 : 0), wrong: (r.wrong || 0) + (ok ? 0 : 1), last: today });
    setScore(s => ({ ok: s.ok + (ok ? 1 : 0), bad: s.bad + (ok ? 0 : 1) }));
    // الخطأ يعود بعد ثلاث بطاقات في الجلسة نفسها
    if (!ok) setQueue(qu => { const n = [...qu]; n.splice(Math.min(n.length, pos + 4), 0, cur.id); return n; });
  };
  const choose = async st => { if (ans) return; const ok = st.id === cur.id; setAns({ ok, chosen: st.id }); await grade(ok); };
  const next = () => { setAns(null); setRevealed(false); setPos(p => p + 1); };

  const head = html`<div class="page-head"><a class="icon-btn" href=${cid ? '#/class/' + cid : '#/classes'}><${Icon} name="back" /></a><div><h1>اختبر نفسك في الأسماء</h1><div class="sub">ترى صورة الطالب وتتذكر اسمه؛ ما تخطئ فيه يعود إليك أسرع.</div></div></div>`;
  if (!queue || pos >= queue.length) {
    const finished = queue && pos >= queue.length;
    return html`<div class="page">${head}
      <div class="grid-2" style="align-items:start">
        <div class="card stack">
          ${finished ? html`<div class="info">انتهت الجلسة: ${score.ok} صحيحة و${score.bad} خطأ.</div>` : null}
          <label class="field"><span>الفصل</span><select value=${cid} onChange=${e => { setCid(e.target.value); setQueue(null); }}>${cls.map(c => html`<option value=${c.id}>${className(c)}</option>`)}</select></label>
          <div class="chips"><button class=${'chip' + (mode === 'choices' ? ' on' : '')} onClick=${() => setMode('choices')}>اختيار من 4 أسماء</button><button class=${'chip' + (mode === 'recall' ? ' on' : '')} onClick=${() => setMode('recall')}>تذكّر ثم اكشف</button></div>
          <label class="field"><span>عدد البطاقات</span><select value=${size} onChange=${e => setSize(+e.target.value)}>${[5, 10, 20, 40].map(n => html`<option value=${n}>${n}</option>`)}</select></label>
          ${withPhoto.length >= 2 ? html`<${Btn} cls="primary lg" onClick=${start}><${Icon} name="play" /> ${finished ? 'جلسة جديدة' : 'ابدأ'} ${dueN ? `(${dueN} مستحقة)` : ''}</${Btn}>` : html`<div class="notice">تحتاج صورتين على الأقل. ارفع صور الطلاب من بطاقة كل طالب.</div>`}
          ${list.length > withPhoto.length ? html`<p class="muted small" style="margin:0">${list.length - withPhoto.length} طالب بلا صورة لا يدخلون التدريب.</p>` : null}
        </div>
        <div class="card"><h2>صناديق التكرار المتباعد</h2>
          <div class="stats">${boxes.map((n, i) => html`<div class="stat"><b>${n}</b><span>الصندوق ${i + 1}${i ? ` (كل ${INTERVALS[i + 1]} يوم)` : ' (يومياً)'}</span></div>`)}</div>
          <p class="muted small">كل إجابة صحيحة ترفع الطالب صندوقاً فتتباعد مراجعته، والخطأ يعيده للصندوق الأول.</p></div>
      </div></div>`;
  }
  return html`<div class="page">${head}
    <div class="card picker" style="max-width:560px;margin:0 auto">
      <div class="row" style="justify-content:space-between"><span class="badge pri">${pos + 1} / ${queue.length}</span><span class="badge pos">✓ ${score.ok}</span><span class="badge neg">✗ ${score.bad}</span></div>
      <div class="pop-in" key=${pos}><${Avatar} student=${cur} size=${190} cls="big-av" />
        ${mode === 'recall' ? (revealed || ans ? html`<div class="pname">${cur.full_name}</div>` : html`<div class="pname muted">؟</div>`) : (ans ? html`<div class="pname" style=${`color:var(--${ans.ok ? 'pos' : 'neg'})`}>${cur.full_name}</div>` : null)}</div>
      ${mode === 'choices' ? html`<div class="outcomes" style="grid-template-columns:1fr 1fr">${options.map(o => html`<button class=${'btn' + (ans ? (o.id === cur.id ? ' ok' : o.id === ans.chosen ? ' no' : '') : '')} onClick=${() => choose(o)}>${shortName(o.full_name)}</button>`)}</div>`
        : !revealed && !ans ? html`<button class="btn primary xl block" style="margin-top:16px" onClick=${() => setRevealed(true)}>اكشف الاسم</button>`
        : !ans ? html`<div class="outcomes" style="grid-template-columns:1fr 1fr"><button class="btn ok" onClick=${async () => { setAns({ ok: true }); await grade(true); }}>✓ عرفته</button><button class="btn no" onClick=${async () => { setAns({ ok: false }); await grade(false); }}>✗ لم أعرفه</button></div>` : null}
      ${ans ? html`<button class="btn primary lg block" style="margin-top:14px" onClick=${next}>التالي</button>` : null}
    </div></div>`;
}
