// Top bar renderer. Every item reflects real state pushed by the main process (foreground window,
// Core Audio volume, PDH counters, power status, Orelle notifications) and every click maps to a
// real action; nothing is decorative.
import type { TopBarStateDto } from '../../preload/preload';
import type { Settings, TopBarItemId } from '../../shared/types';
import { formatBytes } from '../../shared/widgetModel';
import { el, orelle, setLanguage, t } from '../common/env';
import { brandMark, glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const root = document.getElementById('root')!;
let settings: Settings;
let lang: 'fr' | 'en' = 'fr';
let state: TopBarStateDto | null = null;

function btn(cls: string, label: string, action: string, ...children: (Node | string)[]) {
  const b = el('button', { class: `item ${cls}`, title: label, 'aria-label': label }, ...children);
  b.addEventListener('click', () => orelle.topbar.action(action, b.getBoundingClientRect().left));
  return b;
}

function ico(name: string) {
  const s = el('span', { class: 'ico', html: glyph(name) });
  return s;
}

function clockText() {
  const now = new Date();
  const loc = lang === 'fr' ? 'fr-FR' : 'en-US';
  const time = now.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: settings.topBar.showSeconds ? '2-digit' : undefined });
  if (!settings.topBar.showDate) return time;
  const date = now.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${date.replace(/\.$/, '')}  ${time}`;
}

const ITEMS: Record<TopBarItemId, () => HTMLElement | null> = {
  media() {
    const wrap = el('span', { class: 'group media' });
    for (const [a, g, k] of [['previous', 'previous', 'topbar.previous'], ['playPause', 'play', 'topbar.playPause'], ['next', 'next', 'topbar.next']] as const) {
      wrap.append(btn('mini', t(k), a, ico(g)));
    }
    return wrap;
  },
  cpu() {
    const s = state?.stats;
    return btn('stat', t('topbar.cpu'), 'cpu', ico('cpu'), el('span', { class: 'num', text: s ? `${Math.round(s.cpu)} %` : '—' }));
  },
  network() {
    const s = state?.stats;
    return btn('stat', t('topbar.network'), 'network', ico('network'), el('span', { class: 'num', text: s ? `↓ ${formatBytes(s.netDown, lang, true)}` : '—' }));
  },
  volume() {
    const v = state?.volume;
    if (!v) return null;
    const b = btn('stat', `${t('control.volume')} ${v.level} %`, 'volume', ico(v.muted || v.level === 0 ? 'volumeMute' : 'volume'));
    b.addEventListener('wheel', (e) => {
      e.preventDefault();
      orelle.topbar.volume(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    return b;
  },
  battery() {
    const bat = state?.stats?.battery;
    if (!bat?.present) return null;
    const b = btn('stat', t('topbar.battery'), 'battery', ico(bat.charging ? 'bolt' : 'battery'), el('span', { class: 'num', text: `${Math.round(bat.percent)} %` }));
    if (bat.percent <= 15 && !bat.charging) b.classList.add('warn');
    return b;
  },
  notifications() {
    const n = state?.unread ?? 0;
    const b = btn('bell', t('topbar.notifications'), 'notifications', ico(state?.focus ? 'bell' : 'bellOn'));
    if (n) b.append(el('span', { class: 'badge', text: n > 9 ? '9+' : String(n) }));
    return b;
  },
  search: () => btn('icon', t('topbar.search'), 'search', ico('search')),
  control: () => btn('icon', t('control.title'), 'control', ico('sliders')),
  taskbar: () => (state?.taskbarHidden ? btn('icon', t('topbar.taskbarPeek'), 'taskbar', ico('taskbar')) : null),
  clock: () => btn('clock', t('topbar.clock'), 'clock', el('span', { class: 'time', text: clockText() })),
};

function render() {
  const left = el('div', { class: 'left' });
  const brand = btn('brand', t('topbar.menu'), 'menu');
  brand.innerHTML = brandMark();
  left.append(brand);
  if (settings.topBar.showActiveApp) {
    const a = state?.app;
    const app = btn('app', a ? `${a.name} — ${a.title}` : 'Orelle', 'app');
    if (a?.icon) app.append(el('img', { src: a.icon, alt: '', class: 'app-icon' }));
    app.append(el('strong', { text: a?.name ?? t('topbar.desktop') }), el('span', { class: 'chev', html: glyph('chevronDown') }));
    left.append(app);
  }
  if (state?.profile) {
    const p = btn('profile', t('topbar.profile'), 'profile', ico(state.profile.glyph), el('span', { text: state.profile.name }));
    left.append(p);
  } else if (settings.profiles.list.length) {
    left.append(btn('profile ghost', t('topbar.profile'), 'profile', ico('sparkle')));
  }
  const right = el('div', { class: 'right' });
  for (const item of settings.topBar.items) {
    if (!item.visible) continue;
    const node = ITEMS[item.id]();
    if (node) {
      node.dataset.id = item.id;
      right.append(node);
    }
  }
  root.replaceChildren(el('div', { class: 'bar' }, left, right));
}

// The clock is the only thing that changes on its own: update it in place.
setInterval(() => {
  const time = document.querySelector('.item.clock .time');
  if (time && settings) time.textContent = clockText();
}, 1000);

// Only the visible strip catches the mouse; the transparent margin below lets clicks through.
let interactive = false;
document.addEventListener('mousemove', (e) => {
  const on = e.clientY < 30;
  if (on !== interactive) {
    interactive = on;
    orelle.topbar.setInteractive(on);
  }
});
document.addEventListener('mouseleave', () => {
  if (interactive) {
    interactive = false;
    orelle.topbar.setInteractive(false);
  }
});

root.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  orelle.topbar.contextMenu();
});

async function init() {
  const boot = await orelle.bootstrap();
  settings = boot.settings;
  lang = boot.language;
  setLanguage(lang);
  applyTheme(settings, boot.darkSystem);
  render();
  orelle.onSettings((p) => {
    settings = p.settings;
    lang = p.language;
    setLanguage(lang);
    applyTheme(settings, p.darkSystem);
    render();
  });
  orelle.topbar.onState((s) => {
    state = s;
    render();
  });
  orelle.onIconsChanged(() => render());
}

void init();
