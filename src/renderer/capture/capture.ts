// Screenshot overlay: the frozen screen, dimmed; drag to select a region, click a window to take
// it, Enter for the whole screen, Esc to cancel.
import { el, orelle, setLanguage, t } from '../common/env';
import { applyTheme } from '../common/theme';

const root = document.getElementById('root')!;
const img = el('img', { class: 'frame', alt: '' });
const sel = el('div', { class: 'sel' });
const size = el('div', { class: 'size' });
const hint = el('div', { class: 'hint' });
let windows: { x: number; y: number; w: number; h: number; title: string }[] = [];
let start: { x: number; y: number } | null = null;
let rect: { x: number; y: number; w: number; h: number } | null = null;
let hover: (typeof windows)[number] | null = null;

function draw(r: typeof rect, label = true) {
  sel.hidden = !r;
  size.hidden = !r || !label;
  if (!r) return;
  sel.style.left = `${r.x}px`;
  sel.style.top = `${r.y}px`;
  sel.style.width = `${r.w}px`;
  sel.style.height = `${r.h}px`;
  const dpr = window.devicePixelRatio;
  size.textContent = `${Math.round(r.w * dpr)} × ${Math.round(r.h * dpr)}`;
  size.style.left = `${r.x}px`;
  size.style.top = `${Math.max(0, r.y - 26)}px`;
}

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  rect = null;
});
document.addEventListener('mousemove', (e) => {
  if (start) {
    rect = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
    draw(rect);
    return;
  }
  // Not dragging: highlight the window under the cursor.
  hover = windows.find((w) => e.clientX >= w.x && e.clientX < w.x + w.w && e.clientY >= w.y && e.clientY < w.y + w.h) ?? null;
  draw(hover, false);
});
document.addEventListener('mouseup', () => {
  if (!start) return;
  const dragged = rect && rect.w > 4 && rect.h > 4;
  start = null;
  if (dragged) orelle.capture.done(rect);
  else if (hover) orelle.capture.done(hover);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') orelle.capture.cancel();
  else if (e.key === 'Enter') orelle.capture.done(null);
});
document.addEventListener('contextmenu', (e) => { e.preventDefault(); orelle.capture.cancel(); });

async function init() {
  const boot = await orelle.bootstrap();
  setLanguage(boot.language);
  applyTheme(boot.settings, boot.darkSystem);
  hint.textContent = t('capture.hint');
  root.append(img, el('div', { class: 'dim' }), sel, size, hint);
  draw(null);
  orelle.capture.onFrame((f) => {
    img.src = f.image;
    windows = f.windows;
    rect = null;
    start = null;
    draw(null);
  });
}

void init();
