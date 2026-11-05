// المظهر: الوضع الفاتح/الداكن واللون الرئيسي (إعداد خاص بالجهاز)
import { emit } from './store.js';
export const getUI = () => { try { return JSON.parse(localStorage.getItem('daftar-ui') || '{}'); } catch { return {}; } };
export function applyTheme() {
  const ui = getUI();
  const root = document.documentElement;
  if (ui.theme === 'light' || ui.theme === 'dark') root.dataset.theme = ui.theme; else delete root.dataset.theme;
  if (ui.primary) root.style.setProperty('--primary', ui.primary); else root.style.removeProperty('--primary');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', ui.primary || '#0f8b8d');
}
export function setUI(changes) {
  localStorage.setItem('daftar-ui', JSON.stringify({ ...getUI(), ...changes }));
  applyTheme(); emit();
}
