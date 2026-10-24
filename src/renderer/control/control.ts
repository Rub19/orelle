// Control center UI. Every control either really drives Windows (volume, mute, brightness, media
// keys, taskbar auto-hide) or opens the exact Settings page; nothing is simulated.
import type { ControlState, Settings } from '../../shared/types';
import { el, nova, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const panel = document.getElementById('panel')!;
let settings: Settings;
let state: ControlState | null = null;
let dragging = false;

function setFill(input: HTMLInputElement) {
  // The fill ends under the thumb's centre, so low values never look like two knobs.
  input.style.setProperty('--fill', `calc(11px + (100% - 22px) * ${Number(input.value) / 100})`);
}

function tile(g: string, label: string, sub: string, on: boolean, onClick: () => void) {
  const b = el('button', { class: `tile${on ? ' on' : ''}` }, el('span', { class: 'ico', html: glyph(g) }), el('span', { class: 'txt' }, el('strong', { text: label }), el('small', { text: sub })));
  b.addEventListener('click', onClick);
  return b;
}

function render() {
  if (dragging) return;
  const s = state;
  const vol = s?.volume;
  const volInput = el('input', { type: 'range', min: 0, max: 100, step: 1, value: vol?.level ?? 0, 'aria-label': t('control.volume') });
  if (!vol) volInput.disabled = true;
  setFill(volInput);
  volInput.addEventListener('pointerdown', () => (dragging = true));
  volInput.addEventListener('pointerup', () => (dragging = false));
  volInput.addEventListener('input', () => {
    setFill(volInput);
    void nova.control.setVolume(Number(volInput.value));
  });
  const muteBtn = el('button', { html: glyph(vol?.muted || vol?.level === 0 ? 'volumeMute' : 'volume'), title: t('control.mute') });
  muteBtn.addEventListener('click', async () => {
    if (!vol) return;
    await nova.control.setMuted(!vol.muted);
    vol.muted = !vol.muted;
    render();
  });

  const brInput = el('input', { type: 'range', min: 0, max: 100, step: 1, value: s?.brightness ?? 0, 'aria-label': t('control.brightness') });
  setFill(brInput);
  brInput.addEventListener('pointerdown', () => (dragging = true));
  brInput.addEventListener('pointerup', () => (dragging = false));
  brInput.addEventListener('input', () => {
    setFill(brInput);
    nova.control.setBrightness(Number(brInput.value));
  });

  const wifi = s?.wifi;
  const bat = s?.battery;
  const light = settings.appearance.theme === 'light';
  const openSettings = (uri: string) => () => nova.control.openSettings(uri);

  const head = el('div', { class: 'head' }, el('strong', { text: t('control.title') }), el('div', { class: 'icons' },
    iconBtn('search', t('dock.launcher'), () => nova.control.action('launcher')),
    iconBtn('lock', t('control.lock'), () => nova.control.action('lock')),
    iconBtn('settings', t('control.prefs'), () => nova.control.action('preferences')),
  ));

  const tiles = el('div', { class: 'tiles' },
    tile('wifi', t('control.wifi'), wifi?.connected ? `${wifi.ssid ?? ''}${wifi.signal !== null ? ` · ${wifi.signal} %` : ''}` : t('control.wifi.off'), !!wifi?.connected, openSettings('ms-settings:network-wifi')),
    tile('bluetooth', t('control.bluetooth'), t('control.bluetooth.open'), false, openSettings('ms-settings:bluetooth')),
    tile('bell', t('control.focus'), t('control.bluetooth.open'), false, openSettings('ms-settings:notifications')),
    tile(light ? 'sun' : 'moon', light ? t('control.lightMode') : t('control.darkMode'), 'NOVA', !light, () => nova.control.action('toggleTheme')),
    tile('taskbar', t('control.taskbar'), settings.general.hideTaskbar ? t('common.off') : t('common.on'), !settings.general.hideTaskbar, () => nova.control.action('toggleTaskbar')),
    tile('grid', t('control.widgets'), t('widgets.edit'), false, () => nova.control.action('editWidgets')),
  );

  const volCard = el('div', { class: 'card' },
    el('div', { class: 'label' }, t('control.volume'), el('span', { text: vol ? (vol.muted ? '—' : `${vol.level} %`) : '' })),
    el('div', { class: 'slider-row' }, muteBtn, volInput),
    el('div', { class: 'device' }, el('span', { text: vol?.device ? t('control.device', { name: vol.device }) : '' }), linkBtn(t('control.sound'), openSettings('ms-settings:sound'))),
  );

  const brCard = el('div', { class: 'card' },
    el('div', { class: 'label' }, t('control.brightness'), el('span', { text: s?.brightness != null ? `${s.brightness} %` : '' })),
    s?.brightness != null
      ? el('div', { class: 'slider-row', html: glyph('sun') }, brInput)
      : el('div', { class: 'device' }, el('span', { class: 'na', text: t('control.brightness.na') }), linkBtn(t('control.display'), openSettings('ms-settings:display'))),
  );

  const mediaCard = el('div', { class: 'card media' },
    el('div', { class: 'meta' }, el('strong', { text: t('control.media') }), el('small', { text: t('control.media.hint') })),
    roundBtn('previous', () => nova.control.media('previous')),
    roundBtn('playPause', () => nova.control.media('playPause'), true),
    roundBtn('next', () => nova.control.media('next')),
  );

  const parts: HTMLElement[] = [head, tiles, volCard, brCard, mediaCard];
  if (bat?.present) {
    parts.push(el('div', { class: 'card' },
      el('div', { class: 'label' }, t('control.battery'), el('span', { text: `${bat.percent} % · ${bat.charging ? t('control.charging') : t('control.battery')}` })),
      el('div', { class: 'device' }, el('span', { text: bat.minutesLeft && !bat.charging ? `≈ ${Math.floor(bat.minutesLeft / 60)} h ${String(bat.minutesLeft % 60).padStart(2, '0')}` : bat.charging ? t('control.onAc') : '' }), linkBtn(t('control.power'), openSettings('ms-settings:powersleep'))),
    ));
  }
  parts.push(el('div', { class: 'links' },
    linkBtn(t('control.settings'), openSettings('ms-settings:'), 'settings'),
    linkBtn(t('control.display'), openSettings('ms-settings:display'), 'monitor'),
    linkBtn(t('control.power'), openSettings('ms-settings:powersleep'), 'bolt'),
  ));
  panel.replaceChildren(...parts);
}

function iconBtn(g: string, label: string, onClick: () => void) {
  const b = el('button', { class: 'icon-btn', html: glyph(g), title: label, 'aria-label': label });
  b.addEventListener('click', onClick);
  return b;
}

function roundBtn(g: string, onClick: () => void, primary = false) {
  const b = el('button', { class: `round${primary ? ' primary' : ''}`, html: glyph(g) });
  b.addEventListener('click', onClick);
  return b;
}

function linkBtn(label: string, onClick: () => void, g?: string) {
  const b = el('button', { html: g ? glyph(g) : '' }, label);
  b.addEventListener('click', onClick);
  return b;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') nova.control.hide();
});

async function init() {
  const boot = await nova.bootstrap();
  settings = boot.settings;
  setLanguage(boot.language);
  applyTheme(settings, boot.darkSystem);
  render();
  nova.onSettings((p) => {
    settings = p.settings;
    setLanguage(p.language);
    applyTheme(settings, p.darkSystem);
    render();
  });
  nova.control.onState((s) => {
    state = s;
    render();
  });
}

void init();
