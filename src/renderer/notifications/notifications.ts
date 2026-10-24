// Notification center: today's date and a month calendar, Orelle's focus switch, and the history
// of notifications Orelle raised. Other apps' notifications live in the Windows notification
// center (Windows does not let a desktop app read them), which is one click away.
import type { OrelleNotification, Settings } from '../../shared/types';
import { el, orelle, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const root = document.getElementById('root')!;
let settings: Settings;
let lang: 'fr' | 'en' = 'fr';
let items: OrelleNotification[] = [];
let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

const loc = () => (lang === 'fr' ? 'fr-FR' : 'en-US');

function ago(at: number) {
  const s = Math.round((Date.now() - at) / 1000);
  const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto', style: 'short' });
  if (s < 60) return t('notifications.now');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return new Date(at).toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
}

function calendar() {
  const today = new Date();
  const first = (month.getDay() + 6) % 7; // weeks start on Monday
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const head = el('div', { class: 'cal-head' });
  const prev = el('button', { class: 'nav prev', html: glyph('chevron'), 'aria-label': t('notifications.prevMonth') });
  const next = el('button', { class: 'nav', html: glyph('chevron'), 'aria-label': t('notifications.nextMonth') });
  prev.addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); render(); });
  next.addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); render(); });
  const title = el('button', { class: 'month', text: month.toLocaleDateString(loc(), { month: 'long', year: 'numeric' }) });
  title.addEventListener('click', () => { month = new Date(today.getFullYear(), today.getMonth(), 1); render(); });
  head.append(title, el('span', { class: 'grow' }), prev, next);
  const grid = el('div', { class: 'cal' });
  const monday = new Date(2024, 0, 1); // a Monday
  for (let i = 0; i < 7; i++) grid.append(el('span', { class: 'dow', text: new Date(monday.getTime() + i * 86400000).toLocaleDateString(loc(), { weekday: 'narrow' }) }));
  for (let i = 0; i < first; i++) grid.append(el('span'));
  for (let d = 1; d <= days; d++) {
    const isToday = d === today.getDate() && month.getMonth() === today.getMonth() && month.getFullYear() === today.getFullYear();
    grid.append(el('span', { class: `day${isToday ? ' today' : ''}`, text: d }));
  }
  const open = el('button', { class: 'link', html: glyph('calendar') }, t('notifications.openCalendar'));
  open.addEventListener('click', () => orelle.notifications.open('calendar'));
  return el('section', { class: 'card' }, head, grid, open);
}

function list() {
  const wrap = el('section', { class: 'card list' });
  const head = el('div', { class: 'list-head' }, el('strong', { text: t('notifications.title') }));
  if (items.length) {
    const clear = el('button', { class: 'link small', text: t('notifications.clear') });
    clear.addEventListener('click', () => orelle.notifications.clear());
    head.append(clear);
  }
  wrap.append(head);
  if (!items.length) {
    wrap.append(el('p', { class: 'empty', text: settings.notifications.history ? t('notifications.empty') : t('notifications.historyOff') }));
  }
  for (const n of items) {
    const close = el('button', { class: 'x', html: glyph('close'), 'aria-label': t('notifications.dismiss') });
    close.addEventListener('click', (e) => { e.stopPropagation(); orelle.notifications.remove(n.id); });
    const node = el('div', { class: `note${n.read ? '' : ' unread'}${n.action ? ' clickable' : ''}`, role: n.action ? 'button' : 'listitem' },
      el('span', { class: 'n-ico', html: glyph(n.glyph) }),
      el('div', { class: 'n-text' }, el('div', { class: 'n-top' }, el('strong', { text: n.title }), el('span', { class: 'when', text: ago(n.at) })), n.body ? el('p', { text: n.body }) : null),
      close,
    );
    if (n.action) node.addEventListener('click', () => orelle.notifications.activate(n.id));
    wrap.append(node);
  }
  return wrap;
}

function render() {
  const now = new Date();
  const focusOn = settings.notifications.focus;
  const focus = el('button', { class: `focus${focusOn ? ' on' : ''}`, html: glyph(focusOn ? 'bell' : 'bellOn') }, el('span', {}, el('strong', { text: t('notifications.focus') }), el('small', { text: focusOn ? t('notifications.focus.on') : t('notifications.focus.off') })));
  focus.addEventListener('click', () => void orelle.updateSettings({ notifications: { focus: !focusOn } }));
  const winBtn = el('button', { class: 'link', html: glyph('external') }, t('notifications.windows'));
  winBtn.addEventListener('click', () => orelle.notifications.open('windows'));
  const prefs = el('button', { class: 'icon-btn', html: glyph('settings'), title: t('dock.settings') });
  prefs.addEventListener('click', () => orelle.notifications.open('settings'));
  root.replaceChildren(el('div', { class: 'panel' },
    el('header', { class: 'today' },
      el('div', {}, el('div', { class: 'big', text: now.toLocaleDateString(loc(), { weekday: 'long' }) }), el('div', { class: 'sub', text: now.toLocaleDateString(loc(), { day: 'numeric', month: 'long', year: 'numeric' }) })),
      prefs),
    calendar(),
    focus,
    list(),
    winBtn,
  ));
}

async function load() {
  items = (await orelle.notifications.list()) ?? [];
  render();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') orelle.notifications.hide();
});

async function init() {
  const boot = await orelle.bootstrap();
  settings = boot.settings;
  lang = boot.language;
  setLanguage(lang);
  applyTheme(settings, boot.darkSystem);
  orelle.onSettings((p) => {
    settings = p.settings;
    lang = p.language;
    setLanguage(lang);
    applyTheme(settings, p.darkSystem);
    render();
  });
  orelle.notifications.onChanged(() => void load());
  orelle.panel.onShow(() => {
    month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    void load();
  });
  await load();
}

void init();
