// Petits utilitaires DOM : tout le contenu dynamique passe par textContent
// (jamais innerHTML) afin qu'un QR malveillant ne puisse injecter du code.
const SVGNS = 'http://www.w3.org/2000/svg';

export function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'hidden') n.hidden = !!v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

export function icon(name, cls = '') {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', ('ic ' + cls).trim());
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVGNS, 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u);
  return s;
}

const fr = 'fr-FR';
export const fmtTime = d => new Date(d).toLocaleTimeString(fr, { hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = d => new Date(d).toLocaleString(fr, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function dayLabel(iso) {
  const d = new Date(iso), now = new Date();
  const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  return d.toLocaleDateString(fr, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function relTime(iso) {
  if (!iso) return 'Jamais';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "À l'instant";
  if (s < 3600) return `Il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `Il y a ${Math.floor(s / 3600)} h`;
  return dayLabel(iso) + ' · ' + fmtTime(iso);
}
