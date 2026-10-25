import { el, orelle, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';
import { trayAreaItems, type TrayAreaItemId, type TrayAreaState } from '../../shared/trayAreaModel';

let language: 'fr' | 'en' = 'fr';
let state: TrayAreaState = {
  wifi: null,
  volume: null,
  battery: null,
  unread: 0,
  windowsUpdatePending: false,
  orelleUpdateAvailable: false,
};

function clockParts() {
  const now = new Date();
  const locale = language === 'fr' ? 'fr-FR' : 'en-US';
  return {
    time: now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    date: now.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }),
  };
}

function statusButton(id: TrayAreaItemId, icon: string, label: string, text?: string) {
  const button = el('button', { class: `status ${id}`, title: label, 'aria-label': label, 'data-id': id }, el('span', { class: 'icon', html: glyph(icon) }));
  if (text) button.append(el('span', { class: 'value', text }));
  if (id !== 'peek') button.addEventListener('click', () => orelle.trayArea.action(id));
  return button;
}

function render() {
  const root = document.getElementById('root')!;
  const row = el('div', { class: 'tray' });
  for (const id of trayAreaItems(state)) {
    if (id === 'network') {
      const wifi = state.wifi;
      row.append(statusButton('network', wifi?.connected ? 'wifi' : 'network', wifi?.connected ? `${t('trayArea.network')} — ${wifi.signal ?? '—'} %` : `${t('trayArea.network')} — ${t('control.wifi.off')}`));
    } else if (id === 'volume') {
      const v = state.volume!;
      row.append(statusButton('volume', v.muted || v.level === 0 ? 'volumeMute' : 'volume', `${t('trayArea.volume')} — ${v.level} %`));
    } else if (id === 'battery') {
      const b = state.battery!;
      row.append(statusButton('battery', b.charging ? 'bolt' : 'battery', `${t('trayArea.battery')} — ${Math.round(b.percent)} %`, `${Math.round(b.percent)} %`));
    } else if (id === 'update') {
      const windows = state.windowsUpdatePending;
      row.append(statusButton('update', 'download', windows ? t('trayArea.windowsUpdate') : t('trayArea.orelleUpdate')));
    } else if (id === 'notifications') {
      const label = state.unread ? `${t('trayArea.notifications')} — ${state.unread}` : t('trayArea.notifications');
      const b = statusButton('notifications', state.unread ? 'bellOn' : 'bell', label);
      if (state.unread) b.append(el('span', { class: 'badge', text: state.unread > 9 ? '9+' : String(state.unread) }));
      row.append(b);
    } else if (id === 'clock') {
      const c = clockParts();
      const b = statusButton('clock', 'clock', t('trayArea.clock'));
      b.append(el('span', { class: 'clock-text' }, el('span', { text: c.time }), el('span', { text: c.date })));
      row.append(b);
    } else if (id === 'peek') {
      const b = statusButton('peek', 'chevronDown', t('trayArea.show'));
      b.addEventListener('click', () => orelle.trayArea.peek());
      row.append(b);
    }
  }
  root.replaceChildren(row);
}

async function init() {
  const boot = await orelle.bootstrap();
  if (!boot) return;
  language = boot.language;
  setLanguage(language);
  applyTheme(boot.settings, boot.darkSystem);
  render();
  setInterval(render, 30_000);
  orelle.trayArea.onState((next) => {
    state = next;
    render();
  });
  orelle.onSettings((p) => {
    language = p.language;
    setLanguage(p.language);
    applyTheme(p.settings, p.darkSystem);
    render();
  });
}

void init();
