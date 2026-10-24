// Control center. Modules are laid out on a 6-column grid from settings.controlCenter.modules
// (order, size, visibility), editable in place ("Customize"). Every control either really drives
// Windows (volume, mute, microphone, brightness, media keys, taskbar auto-hide) or opens the exact
// Settings page — nothing is simulated.
import type { StringKey } from '../../shared/i18n';
import type { ControlModule, ControlModuleId, ControlState, Settings, SystemStats } from '../../shared/types';
import { formatBytes, formatDuration } from '../../shared/widgetModel';
import { el, orelle, setLanguage, t } from '../common/env';
import { brandMark, glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

const panel = document.getElementById('panel')!;
let settings: Settings;
let lang: 'fr' | 'en' = 'fr';
let state: ControlState | null = null;
let stats: SystemStats | null = null;
let dragging = false;
let customizing = false;
let modules: ControlModule[] = [];

const openSettings = (uri: string) => () => orelle.control.openSettings(uri);

function setFill(input: HTMLInputElement) {
  // The fill ends under the thumb's centre, so low values never look like two knobs.
  input.style.setProperty('--fill', `calc(11px + (100% - 22px) * ${Number(input.value) / 100})`);
}

function slider(value: number, label: string, enabled: boolean, onInput: (v: number) => void) {
  const input = el('input', { type: 'range', min: 0, max: 100, step: 1, value, 'aria-label': label });
  input.disabled = !enabled;
  setFill(input);
  input.addEventListener('pointerdown', () => (dragging = true));
  input.addEventListener('pointerup', () => (dragging = false));
  input.addEventListener('input', () => {
    setFill(input);
    onInput(Number(input.value));
  });
  return input;
}

function toggleTile(g: string, label: string, sub: string, on: boolean, onClick: () => void) {
  const b = el('button', { class: `tile${on ? ' on' : ''}` }, el('span', { class: 'ico', html: glyph(g) }), el('span', { class: 'txt' }, el('strong', { text: label }), el('small', { text: sub })));
  b.addEventListener('click', onClick);
  return b;
}

function linkBtn(label: string, onClick: () => void, g?: string) {
  const b = el('button', { class: 'link', html: g ? glyph(g) : '' }, label);
  b.addEventListener('click', onClick);
  return b;
}

function roundBtn(g: string, label: string, onClick: () => void, primary = false) {
  const b = el('button', { class: `round${primary ? ' primary' : ''}`, html: glyph(g), 'aria-label': label, title: label });
  b.addEventListener('click', onClick);
  return b;
}

function tool(g: string, label: string, onClick: () => void) {
  const b = el('button', { class: 'tool', html: glyph(g) }, el('span', { text: label }));
  b.addEventListener('click', onClick);
  return b;
}

// ---------- Modules ----------

const BUILD: Record<ControlModuleId, () => HTMLElement> = {
  wifi() {
    const w = state?.wifi;
    return toggleTile('wifi', t('control.wifi'), w?.connected ? `${w.ssid ?? ''}${w.signal !== null ? ` · ${w.signal} %` : ''}` : t('control.wifi.off'), !!w?.connected, openSettings('ms-settings:network-wifi'));
  },
  bluetooth: () => toggleTile('bluetooth', t('control.bluetooth'), t('control.open'), false, openSettings('ms-settings:bluetooth')),
  focus: () => toggleTile('bell', t('control.focus'), t('control.open'), false, openSettings('ms-settings:notifications')),
  nightlight: () => toggleTile('moon', t('control.nightlight'), t('control.open'), false, openSettings('ms-settings:nightlight')),
  airplane: () => toggleTile('send', t('control.airplane'), t('control.open'), false, openSettings('ms-settings:network-airplanemode')),
  theme() {
    const light = settings.appearance.theme === 'light';
    return toggleTile(light ? 'sun' : 'moon', light ? t('control.lightMode') : t('control.darkMode'), 'Orelle', !light, () => orelle.control.action('toggleTheme'));
  },
  taskbar: () => toggleTile('taskbar', t('control.taskbar'), settings.general.hideTaskbar ? t('common.off') : t('common.on'), !settings.general.hideTaskbar, () => orelle.control.action('toggleTaskbar')),
  widgets: () => toggleTile('grid', t('control.widgets'), t('widgets.edit'), false, () => orelle.control.action('editWidgets')),
  volume() {
    const vol = state?.volume;
    const mic = state?.microphone;
    const mute = roundBtn(vol?.muted || vol?.level === 0 ? 'volumeMute' : 'volume', t('control.mute'), async () => {
      if (!vol) return;
      await orelle.control.setMuted(!vol.muted);
      vol.muted = !vol.muted;
      render();
    });
    const micBtn = el('button', { class: `chip${mic?.muted ? ' warn' : ''}`, html: glyph(mic?.muted ? 'micOff' : 'mic') }, mic ? (mic.muted ? t('control.mic.muted') : t('control.mic.on')) : t('control.mic'));
    micBtn.disabled = !mic;
    micBtn.addEventListener('click', async () => {
      if (!mic) return;
      await orelle.control.setMicMuted(!mic.muted);
      mic.muted = !mic.muted;
      render();
    });
    return el('div', { class: 'card' },
      el('div', { class: 'label' }, t('control.volume'), el('span', { text: vol ? (vol.muted ? '—' : `${vol.level} %`) : '' })),
      el('div', { class: 'slider-row' }, mute, slider(vol?.level ?? 0, t('control.volume'), !!vol, (v) => void orelle.control.setVolume(v))),
      el('div', { class: 'device' }, el('span', { class: 'ellipsis', text: vol?.device ? t('control.device', { name: vol.device }) : '' }), micBtn, linkBtn(t('control.sound'), openSettings('ms-settings:sound'))),
    );
  },
  brightness() {
    const b = state?.brightness;
    return el('div', { class: 'card' },
      el('div', { class: 'label' }, t('control.brightness'), el('span', { text: b != null ? `${b} %` : '' })),
      b != null
        ? el('div', { class: 'slider-row', html: glyph('sun') }, slider(b, t('control.brightness'), true, (v) => orelle.control.setBrightness(v)))
        : el('div', { class: 'device' }, el('span', { class: 'na', text: t('control.brightness.na') }), linkBtn(t('control.display'), openSettings('ms-settings:display'))),
    );
  },
  media: () =>
    el('div', { class: 'card media' },
      el('div', { class: 'meta' }, el('strong', { text: t('control.media') }), el('small', { text: t('control.media.hint') })),
      roundBtn('previous', 'previous', () => orelle.control.media('previous')),
      roundBtn('playPause', 'play/pause', () => orelle.control.media('playPause'), true),
      roundBtn('next', 'next', () => orelle.control.media('next')),
    ),
  battery() {
    const bat = state?.battery;
    const card = el('button', { class: `card stat${bat?.present && bat.percent <= 20 && !bat.charging ? ' low' : ''}` });
    card.addEventListener('click', openSettings('ms-settings:powersleep'));
    if (!bat?.present) {
      card.append(el('span', { class: 'stat-ico', html: glyph('bolt') }), el('strong', { text: t('control.onAc') }), el('small', { text: t('control.power') }));
      return card;
    }
    const fill = el('i');
    fill.style.width = `${bat.percent}%`;
    card.append(
      el('span', { class: 'stat-ico', html: glyph(bat.charging ? 'bolt' : 'battery') }),
      el('strong', { text: `${bat.percent} %` }),
      el('small', { text: bat.charging ? t('control.charging') : bat.minutesLeft ? `≈ ${formatDuration(bat.minutesLeft * 60000)}` : t('control.battery') }),
      el('div', { class: 'meter' }, fill),
    );
    return card;
  },
  system() {
    const s = stats;
    const fill = el('i');
    fill.style.width = `${s ? Math.round(s.cpu) : 0}%`;
    const card = el('button', { class: 'card stat' },
      el('span', { class: 'stat-ico', html: glyph('cpu') }),
      el('strong', { text: s ? `${Math.round(s.cpu)} %` : '…' }),
      el('small', { text: s ? `${t('widgets.ram')} ${Math.round((s.memUsed / s.memTotal) * 100)} % · ${formatBytes(s.memUsed, lang)}` : t('control.system') }),
      el('div', { class: 'meter' }, fill),
    );
    card.addEventListener('click', () => orelle.control.action('monitor'));
    return card;
  },
  tools: () =>
    el('div', { class: 'card tools' },
      tool('folder', t('control.files'), () => orelle.control.action('files')),
      tool('chart', t('control.monitor'), () => orelle.control.action('monitor')),
      tool('search', t('dock.launcher'), () => orelle.control.action('launcher')),
      tool('grid', t('control.widgets'), () => orelle.control.action('editWidgets')),
      tool('lock', t('control.lock'), () => orelle.control.action('lock')),
    ),
  links: () =>
    el('div', { class: 'links' },
      linkBtn(t('control.settings'), openSettings('ms-settings:'), 'settings'),
      linkBtn(t('control.display'), openSettings('ms-settings:display'), 'monitor'),
      linkBtn(t('control.power'), openSettings('ms-settings:powersleep'), 'bolt'),
      linkBtn(t('control.sound'), openSettings('ms-settings:sound'), 'volume'),
    ),
};

// ---------- Customize mode ----------

function saveModules() {
  void orelle.updateSettings({ controlCenter: { modules } });
}

function customizeChrome(m: ControlModule, index: number): HTMLElement {
  const eye = el('button', { class: 'cz-btn', html: glyph(m.visible ? 'eye' : 'eyeOff'), title: t('widgets.hide') });
  eye.addEventListener('click', () => { modules[index] = { ...m, visible: !m.visible }; saveModules(); render(); });
  const sizes = el('div', { class: 'cz-sizes' }, ...(['s', 'm', 'l'] as const).map((s) => {
    const b = el('button', { class: `cz-size${m.size === s ? ' on' : ''}`, text: s.toUpperCase(), 'aria-label': s });
    b.addEventListener('click', () => { modules[index] = { ...m, size: s }; saveModules(); render(); });
    return b;
  }));
  return el('div', { class: 'cz' }, el('span', { class: 'cz-grip', html: glyph('grip') }), el('span', { class: 'cz-name', text: t(`control.module.${m.id}` as StringKey) }), sizes, eye);
}

function enableReorder(cell: HTMLElement, index: number) {
  const grip = cell.querySelector<HTMLElement>('.cz-grip')!;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    cell.classList.add('moving');
    let target = index;
    const move = (ev: PointerEvent) => {
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.cell');
      document.querySelectorAll('.cell.drop').forEach((c) => c.classList.remove('drop'));
      if (over && over !== cell) {
        over.classList.add('drop');
        target = Number(over.dataset.index);
      }
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      if (target !== index) {
        const [m] = modules.splice(index, 1);
        modules.splice(target, 0, m);
        saveModules();
      }
      render();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
}

// ---------- Render ----------

function iconBtn(g: string, label: string, onClick: () => void) {
  const b = el('button', { class: 'icon-btn', html: glyph(g), title: label, 'aria-label': label });
  b.addEventListener('click', onClick);
  return b;
}

function render() {
  if (dragging) return;
  const scroll = panel.scrollTop;
  const head = el('div', { class: 'head' },
    el('span', { class: 'brand', html: brandMark() }),
    el('strong', { text: t('control.title') }),
    el('div', { class: 'icons' },
      iconBtn(customizing ? 'check' : 'pencil', customizing ? t('control.done') : t('control.customize'), () => { customizing = !customizing; render(); }),
      iconBtn('settings', t('control.prefs'), () => orelle.control.action('preferences')),
    ),
  );
  const grid = el('div', { class: `grid${customizing ? ' customizing' : ''}` });
  modules.forEach((m, index) => {
    if (!m.visible && !customizing) return;
    const cell = el('div', { class: `cell size-${m.size}${m.visible ? '' : ' off'}`, 'data-index': index, 'data-id': m.id });
    cell.append(BUILD[m.id]());
    if (customizing) {
      cell.prepend(customizeChrome(m, index));
      enableReorder(cell, index);
    }
    grid.append(cell);
  });
  const parts: HTMLElement[] = [head];
  if (customizing) parts.push(el('div', { class: 'hint', text: t('control.customize.hint') }));
  parts.push(grid);
  panel.replaceChildren(...parts);
  panel.scrollTop = scroll;
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (customizing) {
    customizing = false;
    render();
  } else orelle.control.hide();
});

async function init() {
  const boot = await orelle.bootstrap();
  settings = boot.settings;
  lang = boot.language;
  modules = settings.controlCenter.modules.map((m) => ({ ...m }));
  setLanguage(lang);
  applyTheme(settings, boot.darkSystem);
  render();
  orelle.onSettings((p) => {
    settings = p.settings;
    lang = p.language;
    modules = settings.controlCenter.modules.map((m) => ({ ...m }));
    setLanguage(lang);
    applyTheme(settings, p.darkSystem);
    render();
  });
  orelle.control.onState((s) => {
    state = s;
    render();
  });
  orelle.control.onStats((s) => {
    stats = s;
    if (customizing || dragging) return;
    // Only the system tile changes: update it in place instead of re-rendering the panel.
    const cell = document.querySelector<HTMLElement>('.cell[data-id="system"]');
    if (cell) cell.replaceChildren(BUILD.system());
  });
}

void init();
