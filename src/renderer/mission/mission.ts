// Mission Control renderer: lays out one card per window and tells the main process where to draw
// each live DWM thumbnail. Type to filter, arrows to move, Enter to switch, Esc to close.
import type { MissionWindowDto } from '../../preload/preload';
import { fuzzyScore } from '../../shared/fuzzy';
import { layoutCards } from '../../shared/overviewLayout';
import { el, orelle, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const root = document.getElementById('root')!;
let all: MissionWindowDto[] = [];
let shown: MissionWindowDto[] = [];
let selected = 0;
let cols = 1;
let groupByApp = false;

const input = el('input', { class: 'search', type: 'search', spellcheck: 'false', autocomplete: 'off' });
const stage = el('div', { class: 'stage' });
const groupBtn = el('button', { class: 'chip' });
const count = el('span', { class: 'count' });

function order(list: MissionWindowDto[]) {
  if (!groupByApp) return list;
  return [...list].sort((a, b) => a.app.localeCompare(b.app) || a.title.localeCompare(b.title));
}

function filtered() {
  const q = input.value.trim();
  if (!q) return order(all);
  return order(all)
    .map((w) => ({ w, s: Math.max(fuzzyScore(q, w.title), fuzzyScore(q, w.app)) }))
    .filter((x) => x.s > 0.3)
    .map((x) => x.w);
}

function render() {
  shown = filtered();
  selected = Math.max(0, Math.min(selected, shown.length - 1));
  count.textContent = t('mission.count', { n: shown.length });
  groupBtn.textContent = groupByApp ? t('mission.groupOn') : t('mission.groupOff');
  groupBtn.classList.toggle('on', groupByApp);
  if (!shown.length) {
    stage.replaceChildren(el('div', { class: 'empty' }, el('span', { html: glyph('window') }), el('p', { text: all.length ? t('mission.noMatch') : t('mission.none') })));
    orelle.mission.layout(all.map((w) => ({ hwnd: w.hwnd, x: 0, y: 0, w: 0, h: 0, visible: false })));
    return;
  }
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const cards = layoutCards(shown.map((w) => Math.max(0.4, Math.min(4, w.aspect))), W, H);
  // Column count of the first row, for Up/Down navigation.
  cols = cards.filter((c) => c.y === cards[0].y).length || 1;
  const nodes = shown.map((w, i) => {
    const c = cards[i];
    const close = el('button', { class: 'x', html: glyph('close'), title: t('mission.close'), 'aria-label': t('mission.close') });
    close.addEventListener('click', (e) => { e.stopPropagation(); orelle.mission.close(w.hwnd); });
    const frame = el('div', { class: `frame${w.minimized ? ' minimized' : ''}` },
      w.minimized ? el('div', { class: 'min' }, w.icon ? el('img', { src: w.icon, alt: '' }) : el('span', { html: glyph('window') }), el('small', { text: t('mission.minimized') })) : null);
    const label = el('div', { class: 'label' },
      w.icon ? el('img', { src: w.icon, alt: '', class: 'ico' }) : el('span', { class: 'ico', html: glyph('window') }),
      el('span', { class: 'txt' }, el('strong', { text: w.app }), el('small', { text: w.title })),
      close);
    const card = el('div', { class: `card${i === selected ? ' sel' : ''}${w.active ? ' active' : ''}`, role: 'button', tabindex: '-1', 'aria-label': `${w.app} — ${w.title}` }, frame, label);
    card.style.left = `${c.x}px`;
    card.style.top = `${c.y}px`;
    card.style.width = `${c.w}px`;
    frame.style.height = `${c.h}px`;
    card.style.animationDelay = `${Math.min(i, 12) * 18}ms`;
    card.addEventListener('click', () => orelle.mission.activate(w.hwnd));
    card.addEventListener('mouseenter', () => select(i));
    card.addEventListener('auxclick', (e) => { if (e.button === 1) orelle.mission.close(w.hwnd); });
    return card;
  });
  stage.replaceChildren(...nodes);
  // Thumbnails go exactly over each frame (stage offset included).
  const off = stage.getBoundingClientRect();
  const visible = new Set(shown.map((w) => w.hwnd));
  orelle.mission.layout([
    ...shown.map((w, i) => ({ hwnd: w.hwnd, x: off.left + cards[i].x, y: off.top + cards[i].y, w: cards[i].w, h: cards[i].h, visible: !w.minimized })),
    ...all.filter((w) => !visible.has(w.hwnd)).map((w) => ({ hwnd: w.hwnd, x: 0, y: 0, w: 0, h: 0, visible: false })),
  ]);
}

function select(i: number) {
  if (!shown.length) return;
  selected = (i + shown.length) % shown.length;
  stage.querySelectorAll('.card').forEach((c, j) => c.classList.toggle('sel', j === selected));
}

input.addEventListener('input', () => { selected = 0; render(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); if (input.value) { input.value = ''; render(); } else orelle.mission.hide(); }
  else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); select(selected + 1); }
  else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); select(selected - 1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); select(Math.min(shown.length - 1, selected + cols)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); select(Math.max(0, selected - cols)); }
  else if (e.key === 'Enter') { e.preventDefault(); const w = shown[selected]; if (w) orelle.mission.activate(w.hwnd); }
  else if (e.key === 'Delete' && e.ctrlKey) { const w = shown[selected]; if (w) orelle.mission.close(w.hwnd); }
});
stage.addEventListener('click', (e) => { if (e.target === stage) orelle.mission.hide(); });
groupBtn.addEventListener('click', () => { groupByApp = !groupByApp; render(); });

async function init() {
  const boot = await orelle.bootstrap();
  setLanguage(boot.language);
  applyTheme(boot.settings, boot.darkSystem);
  input.placeholder = t('mission.search');
  root.append(el('div', { class: 'shell' },
    el('header', { class: 'head' },
      el('div', { class: 'title' }, el('span', { html: glyph('grid') }), el('strong', { text: t('mission.title') }), count),
      el('div', { class: 'searchbox' }, el('span', { class: 'lens', html: glyph('search') }), input),
      el('div', { class: 'tools' }, groupBtn, el('span', { class: 'hint', text: t('mission.hint') }))),
    stage));
  orelle.onSettings((p) => { setLanguage(p.language); applyTheme(p.settings, p.darkSystem); });
  orelle.mission.onData((list) => {
    all = list;
    selected = Math.max(0, list.findIndex((w) => w.active) === 0 && list.length > 1 ? 1 : 0);
    input.value = '';
    requestAnimationFrame(() => { render(); input.focus(); });
  });
  window.addEventListener('resize', () => render());
}

void init();
