// Dock folder stack: the folder's latest items as a grid (real thumbnails for images).
import type { StackItemDto } from '../../preload/preload';
import { el, orelle, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const root = document.getElementById('root')!;

function tile(it: StackItemDto) {
  const visual = it.thumb ? el('img', { src: it.thumb, alt: '', class: 'thumb' }) : it.icon ? el('img', { src: it.icon, alt: '', class: 'ico' }) : el('span', { class: 'ico ph', html: glyph(it.dir ? 'folder' : 'file') });
  const b = el('button', { class: 'tile', title: it.name }, visual, el('span', { class: 'name', text: it.name }));
  b.addEventListener('click', () => orelle.stack.open(it.path));
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); orelle.stack.reveal(it.path); });
  return b;
}

async function load() {
  const data = await orelle.stack.data();
  if (!data) return;
  const open = el('button', { class: 'link', html: glyph('folder') }, t('stack.openFolder', { name: data.name }));
  open.addEventListener('click', () => orelle.stack.openFolder());
  root.replaceChildren(el('div', { class: 'panel' },
    el('header', { class: 'head' }, el('strong', { text: data.name }), el('small', { text: t('stack.count', { n: data.items.length }) })),
    data.items.length ? el('div', { class: 'grid' }, ...data.items.map(tile)) : el('p', { class: 'empty', text: t('stack.empty') }),
    el('footer', { class: 'foot' }, open, el('span', { class: 'hint', text: t('stack.hint') }))));
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') orelle.stack.hide(); });

async function init() {
  const boot = await orelle.bootstrap();
  setLanguage(boot.language);
  applyTheme(boot.settings, boot.darkSystem);
  orelle.onSettings((p) => { setLanguage(p.language); applyTheme(p.settings, p.darkSystem); });
  orelle.stack.onRefresh(() => void load());
  // File icons are extracted in the background: redraw when they arrive.
  let iconTimer: number | null = null;
  orelle.onIconsChanged(() => {
    if (iconTimer) return;
    iconTimer = window.setTimeout(() => { iconTimer = null; void load(); }, 150);
  });
  orelle.panel.onShow(() => void load());
  await load();
}

void init();
