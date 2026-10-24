// Orelle menu: search, pinned and recent apps, every installed app (A–Z), profiles and power.
// Apps come from the same index as the launcher (shell:AppsFolder), so the list matches Start.
import type { MenuAppDto, MenuDataDto } from '../../preload/preload';
import { fuzzyScore } from '../../shared/fuzzy';
import { el, orelle, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const root = document.getElementById('root')!;
let data: MenuDataDto | null = null;
let query = '';
let selected = 0;
let shown: MenuAppDto[] = [];

const input = el('input', { class: 'search', type: 'search', spellcheck: 'false', autocomplete: 'off' });
const body = el('div', { class: 'body' });
const profilesRow = el('div', { class: 'profiles' });
const footer = el('footer', { class: 'foot' });

function appIcon(a: MenuAppDto, size: string) {
  return a.icon ? el('img', { src: a.icon, alt: '', class: `app-ico ${size}`, draggable: 'false' }) : el('span', { class: `app-ico ${size} blank`, html: glyph('window') });
}

function toast(text: string) {
  document.querySelector('.toast')?.remove();
  const n = el('div', { class: 'toast', text });
  document.body.append(n);
  setTimeout(() => n.remove(), 1400);
}

function wire(node: HTMLElement, a: MenuAppDto) {
  node.addEventListener('click', () => void orelle.menu.launch(a.id));
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    orelle.menu.pin(a.id);
    toast(t('menu.pinned', { name: a.name }));
  });
  node.title = a.name;
  return node;
}

function tile(a: MenuAppDto) {
  return wire(el('button', { class: 'tile' }, appIcon(a, 'lg'), el('span', { text: a.name })), a);
}

function row(a: MenuAppDto, i: number) {
  return wire(el('button', { class: `row${i === selected ? ' sel' : ''}`, 'data-i': i }, appIcon(a, 'sm'), el('span', { text: a.name })), a);
}

function renderBody() {
  if (!data) return;
  const parts: HTMLElement[] = [];
  if (query) {
    shown = data.apps
      .map((a) => ({ a, s: fuzzyScore(query, a.name) }))
      .filter((x) => x.s > 0.3)
      .sort((x, y) => y.s - x.s)
      .slice(0, 40)
      .map((x) => x.a);
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    parts.push(el('h3', { text: t('menu.results') }));
    if (shown.length) parts.push(el('div', { class: 'list' }, ...shown.map(row)));
    const more = el('button', { class: 'more', html: glyph('search') }, t('menu.searchLauncher', { q: query }));
    more.addEventListener('click', () => orelle.menu.action('launcher'));
    parts.push(more);
  } else {
    shown = [];
    if (data.pinned.length) parts.push(el('h3', { text: t('menu.pinnedTitle') }), el('div', { class: 'tiles' }, ...data.pinned.map(tile)));
    parts.push(el('h3', { text: t('menu.allApps', { n: data.apps.length }) }));
    let letter = '';
    const list = el('div', { class: 'list all' });
    data.apps.forEach((a, i) => {
      const first = a.name.charAt(0).toLocaleUpperCase(document.documentElement.lang);
      const l = /\p{L}/u.test(first) ? first.normalize('NFD').charAt(0) : '#';
      if (l !== letter) {
        letter = l;
        list.append(el('div', { class: 'letter', text: l }));
      }
      list.append(row(a, i + 100000));
    });
    parts.push(list);
  }
  body.replaceChildren(...parts);
}

function renderProfiles() {
  if (!data) return;
  profilesRow.replaceChildren(...data.profiles.map((p) => {
    const b = el('button', { class: `chip${p.on ? ' on' : ''}`, html: glyph(p.glyph), title: p.on ? t('profiles.turnOff', { name: p.name }) : t('profiles.turnOn', { name: p.name }) }, p.name);
    b.addEventListener('click', () => orelle.menu.profile(p.id));
    return b;
  }));
  profilesRow.hidden = !data.profiles.length;
}

function renderFooter() {
  const power = (g: string, label: string, a: Parameters<typeof orelle.menu.action>[0]) => {
    const b = el('button', { class: 'pw', html: glyph(g), title: label, 'aria-label': label });
    b.addEventListener('click', () => orelle.menu.action(a));
    return b;
  };
  const user = el('div', { class: 'user' }, el('span', { class: 'avatar', html: glyph('user') }), el('span', { text: data?.user ?? '' }));
  footer.replaceChildren(
    user,
    el('div', { class: 'pws' },
      power('folder', t('files.title'), 'files'),
      power('settings', t('dock.settings'), 'settings'),
      power('grid', t('mission.title'), 'mission'),
      power('window', t('menu.windowsStart'), 'windowsStart'),
      el('span', { class: 'sep' }),
      power('lock', t('system.lock'), 'lock'),
      power('moon', t('system.sleep'), 'sleep'),
      power('restart', t('system.restart'), 'restart'),
      power('power', t('system.shutdown'), 'shutdown'),
    ),
  );
}

function select(i: number) {
  if (!shown.length) return;
  selected = (i + shown.length) % shown.length;
  body.querySelectorAll('.row').forEach((r) => r.classList.toggle('sel', Number((r as HTMLElement).dataset.i) === selected));
  body.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' });
}

input.addEventListener('input', () => {
  query = input.value.trim();
  selected = 0;
  renderBody();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); select(selected + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); select(selected - 1); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const a = shown[selected];
    if (a) void orelle.menu.launch(a.id);
    else if (query) orelle.menu.action('launcher');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (input.value) {
      input.value = '';
      query = '';
      renderBody();
    } else orelle.menu.hide();
  }
});

async function load() {
  data = await orelle.menu.data();
  renderBody();
  renderProfiles();
  renderFooter();
}

async function init() {
  const boot = await orelle.bootstrap();
  setLanguage(boot.language);
  applyTheme(boot.settings, boot.darkSystem);
  input.placeholder = t('menu.placeholder');
  root.append(el('div', { class: 'panel' }, el('header', { class: 'head' }, el('span', { class: 'lens', html: glyph('search') }), input), body, profilesRow, footer));
  orelle.onSettings((p) => {
    setLanguage(p.language);
    applyTheme(p.settings, p.darkSystem);
    input.placeholder = t('menu.placeholder');
    void load();
  });
  orelle.panel.onShow(() => {
    input.value = '';
    query = '';
    body.scrollTop = 0;
    void load();
    input.focus();
  });
  orelle.menu.onRefresh(() => void load());
  orelle.onIconsChanged(() => void load());
  await load();
  input.focus();
}

window.addEventListener('focus', () => input.focus());
void init();
