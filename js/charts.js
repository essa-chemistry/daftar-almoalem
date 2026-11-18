// رسوم بيانية SVG بسيطة (بدون مكتبات) تعمل على الشاشة وفي الطباعة
// الألوان عبر أصناف CSS (.vz-*) فتتبدّل مع الوضع الداكن، وكل عنصر بيانات له <title> يظهر عند المرور
import { escapeHTML as e } from './utils.js';

const fmt = n => (n == null || isNaN(n) ? '—' : String(Math.round(n * 10) / 10));

// أعمدة رأسية: items = [{ label, value, sub?, cls?, tip? }]
export function vbars(items, { h = 220, max = null, unit = '', yTicks = 4 } = {}) {
  const W = Math.max(420, items.length * 70), padT = 22, padB = 46, padX = 34;
  let top = max;
  if (top == null) { const m = Math.max(1, ...items.map(i => i.value || 0)); const st = Math.max(1, Math.ceil(m * 1.15 / yTicks)); top = st * yTicks; }
  const bw = Math.min(46, (W - padX * 2) / items.length * 0.62);
  const step = (W - padX * 2) / Math.max(1, items.length);
  const y = v => padT + (h - padT - padB) * (1 - v / top);
  const grid = Array.from({ length: yTicks + 1 }, (_, i) => top / yTicks * i).map(v => `<line class="vz-grid" x1="${padX}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}"/><text class="vz-ax" x="${padX - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join('');
  const bars = items.map((it, i) => {
    const cx = padX + step * i + step / 2; const v = it.value || 0; const yy = y(v); const hh = Math.max(0, y(0) - yy);
    const r = Math.min(4, hh / 2);
    const path = hh > 0 ? `M${cx - bw / 2},${y(0)} V${yy + r} Q${cx - bw / 2},${yy} ${cx - bw / 2 + r},${yy} H${cx + bw / 2 - r} Q${cx + bw / 2},${yy} ${cx + bw / 2},${yy + r} V${y(0)} Z` : '';
    return `<g class="vz-hit"><title>${e(it.tip || `${it.label}: ${fmt(v)}${unit}`)}</title><rect x="${cx - step / 2}" y="${padT}" width="${step}" height="${h - padT - padB}" fill="transparent"/>
      ${path ? `<path class="vz-bar ${it.cls || ''}" d="${path}"/>` : ''}<text class="vz-val" x="${cx}" y="${yy - 6}" text-anchor="middle">${fmt(v)}${unit}${it.sub ? `<tspan class="vz-sub"> ${e(it.sub)}</tspan>` : ''}</text>
      <text class="vz-lbl" x="${cx}" y="${h - padB + 16}" text-anchor="middle">${e(it.label)}</text>${it.label2 ? `<text class="vz-ax" x="${cx}" y="${h - padB + 31}" text-anchor="middle">${e(it.label2)}</text>` : ''}</g>`;
  }).join('');
  return `<svg class="vz" viewBox="0 0 ${W} ${h}" preserveAspectRatio="xMidYMid meet" role="img">${grid}<line class="vz-base" x1="${padX}" x2="${W - 8}" y1="${y(0)}" y2="${y(0)}"/>${bars}</svg>`;
}

// أعمدة أفقية بنسبة مئوية: items = [{ label, value (0..100), right?, cls? }]
export function hbars(items, { max = 100, unit = '%' } = {}) {
  const rowH = 30, W = 470, lab = 172, padR = 58, h = items.length * rowH + 22;
  const x = v => lab + (W - lab - padR) * Math.min(1, (v || 0) / max);
  const ticks = [0, 25, 50, 75, 100].filter(t => t <= max).map(t => `<line class="vz-grid" x1="${x(t)}" x2="${x(t)}" y1="4" y2="${h - 18}"/><text class="vz-ax" x="${x(t)}" y="${h - 4}" text-anchor="middle">${t}</text>`).join('');
  const rows = items.map((it, i) => { const yy = 8 + i * rowH; const w = Math.max(0, x(it.value) - lab);
    return `<g class="vz-hit"><title>${e(it.tip || `${it.label}: ${fmt(it.value)}${unit}`)}</title><rect x="0" y="${yy - 3}" width="${W}" height="${rowH}" fill="transparent"/>
      <text class="vz-lbl" x="${lab - 10}" y="${yy + 15}" text-anchor="end">${e(it.label.length > 24 ? it.label.slice(0, 23) + '…' : it.label)}</text>
      <rect class="vz-track" x="${lab}" y="${yy + 4}" width="${W - lab - padR}" height="14" rx="4"/>
      ${w > 0 ? `<rect class="vz-bar ${it.cls || ''}" x="${lab}" y="${yy + 4}" width="${w}" height="14" rx="4"/>` : ''}
      <text class="vz-val" x="${x(it.value) + 6}" y="${yy + 15}">${fmt(it.value)}${unit}${it.right ? ` <tspan class="vz-sub">${e(it.right)}</tspan>` : ''}</text></g>`; }).join('');
  return `<svg class="vz" viewBox="0 0 ${W} ${h}" preserveAspectRatio="xMidYMid meet" role="img" style="direction:ltr">${ticks}${rows}</svg>`;
}

// خط عبر الزمن مع نقاط ونطاق (أدنى–أعلى): pts = [{ label, value, lo?, hi?, tip }]
export function linechart(pts, { h = 230, max = 100, unit = '%', ref = null } = {}) {
  const W = Math.max(760, pts.length * 80), padT = 18, padB = 52, padX = 36;
  const inset = 46; const step = (W - padX * 2 - inset * 2) / Math.max(1, pts.length - 1 || 1);
  const X = i => (pts.length === 1 ? W / 2 : padX + inset + step * i), Y = v => padT + (h - padT - padB) * (1 - v / max);
  const grid = [0, 25, 50, 75, 100].map(v => `<line class="vz-grid" x1="${padX}" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}"/><text class="vz-ax" x="${padX - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const refl = ref != null ? `<line class="vz-ref" x1="${padX}" x2="${W - 10}" y1="${Y(ref)}" y2="${Y(ref)}"/><text class="vz-ax" x="${W - 10}" y="${Y(ref) - 4}" text-anchor="end">${ref}${unit} حد النجاح</text>` : '';
  const band = pts.map((p, i) => (p.lo != null ? `<line class="vz-range" x1="${X(i)}" x2="${X(i)}" y1="${Y(p.hi)}" y2="${Y(p.lo)}"/>` : '')).join('');
  const line = pts.length > 1 ? `<polyline class="vz-line" points="${pts.map((p, i) => `${X(i)},${Y(p.value)}`).join(' ')}"/>` : '';
  const dots = pts.map((p, i) => `<g class="vz-hit"><title>${e(p.tip || `${p.label}: ${fmt(p.value)}${unit}`)}</title><rect x="${X(i) - step / 2}" y="${padT}" width="${Math.max(step, 40)}" height="${h - padT - padB}" fill="transparent"/>
      <circle class="vz-dot" cx="${X(i)}" cy="${Y(p.value)}" r="5"/><text class="vz-val" x="${X(i)}" y="${Y(p.value) - 10}" text-anchor="middle">${fmt(p.value)}</text>
      <text class="vz-lbl small" x="${X(i)}" y="${h - padB + 16}" text-anchor="middle">${e(String(p.label).slice(0, 14))}</text>${p.label2 ? `<text class="vz-ax" x="${X(i)}" y="${h - padB + 30}" text-anchor="middle">${e(p.label2)}</text>` : ''}</g>`).join('');
  return `<svg class="vz" viewBox="0 0 ${W} ${h}" preserveAspectRatio="xMidYMid meet" role="img" style="direction:ltr">${grid}${refl}${band}${line}${dots}</svg>`;
}

// نقاط مبعثرة: pts = [{ x, y, tip }]
export function scatter(pts, { h = 240, xLabel = '', yLabel = '', yMax = 100 } = {}) {
  const W = 440, padL = 44, padB = 40, padT = 14, padR = 14;
  const xMax = Math.max(4, ...pts.map(p => p.x)) * 1.08;
  const X = v => padL + (W - padL - padR) * (v / xMax), Y = v => padT + (h - padT - padB) * (1 - v / yMax);
  const xt = Array.from({ length: 5 }, (_, i) => Math.round(xMax / 4 * i));
  const grid = [0, 25, 50, 75, 100].map(v => `<line class="vz-grid" x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}"/><text class="vz-ax" x="${padL - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('')
    + [...new Set(xt)].map(v => `<text class="vz-ax" x="${X(v)}" y="${h - padB + 16}" text-anchor="middle">${v}</text>`).join('');
  const dots = pts.map(p => `<g class="vz-hit"><title>${e(p.tip)}</title><circle class="vz-pt ${p.cls || ''}" cx="${X(p.x)}" cy="${Y(p.y)}" r="5"/></g>`).join('');
  return `<svg class="vz" viewBox="0 0 ${W} ${h}" preserveAspectRatio="xMidYMid meet" role="img" style="direction:ltr">${grid}<line class="vz-base" x1="${padL}" x2="${W - padR}" y1="${Y(0)}" y2="${Y(0)}"/>
    <text class="vz-ax" x="${(W + padL) / 2}" y="${h - 4}" text-anchor="middle">${e(xLabel)}</text><text class="vz-ax" x="12" y="${(h - padB) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(h - padB) / 2})">${e(yLabel)}</text>${dots}</svg>`;
}
