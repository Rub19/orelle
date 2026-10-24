// Preferences UI. Every control writes through nova.updateSettings; the main process normalizes
// and persists, then broadcasts the new settings to every surface (Dock, launcher, this window).
import { ACCENTS, THEMES } from '../../shared/settings';
import type { StringKey } from '../../shared/i18n';
import type { AppInfo, Bootstrap, DeepPartial, DisplayInfo, DockItem, LauncherProviders, Settings } from '../../shared/types';
import { el, nova, setLanguage, t } from '../common/env';
import { glyph } from '../common/glyphs';
import { applyTheme } from '../common/theme';

type Section = 'general' | 'appearance' | 'dock' | 'launcher' | 'privacy' | 'backup' | 'about';
const SECTIONS: { id: Section; glyph: string; color: string }[] = [
  { id: 'general', glyph: 'sliders', color: '#8e8e93' },
  { id: 'appearance', glyph: 'palette', color: '#bf5af2' },
  { id: 'dock', glyph: 'dock', color: '#0a84ff' },
  { id: 'launcher', glyph: 'search', color: '#5e5ce6' },
  { id: 'privacy', glyph: 'shield', color: '#30d158' },
  { id: 'backup', glyph: 'archive', color: '#ff9f0a' },
  { id: 'about', glyph: 'info', color: '#64d2ff' },
];

let boot: Bootstrap;
let settings: Settings;
let darkSystem = true;
let current: Section = 'general';
let query = '';
let suppressRerender = 0;
let apps: AppInfo[] | null = null;
let displays: DisplayInfo[] = [];

const nav = document.getElementById('nav')!;
const content = document.getElementById('content')!;
const search = document.getElementById('search') as HTMLInputElement;
document.getElementById('searchIcon')!.innerHTML = glyph('search');

async function update(patch: DeepPartial<Settings>) {
  // Local edits do not re-render the page (keeps slider drags and focus intact).
  suppressRerender++;
  const next = await nova.updateSettings(patch);
  if (next) settings = next;
  applyTheme(settings, darkSystem);
  setTimeout(() => suppressRerender--, 50);
}

// ---------- Building blocks ----------

function row(labelKey: StringKey, control: HTMLElement | null, descKey?: StringKey, extra?: HTMLElement): HTMLElement {
  const label = el('div', { class: 'label' }, el('strong', { text: t(labelKey) }), descKey ? el('small', { text: t(descKey) }) : null, extra ?? null);
  const r = el('div', { class: 'row', 'data-search': `${t(labelKey)} ${descKey ? t(descKey) : ''}`.toLowerCase() }, label, control);
  return r;
}

function group(titleKey: StringKey | null, ...rows: (HTMLElement | null)[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (titleKey) out.push(el('div', { class: 'group-title', text: t(titleKey) }));
  out.push(el('div', { class: 'group' }, ...rows));
  return out;
}

function toggle(value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const b = el('button', { class: 'switch', role: 'switch', 'aria-checked': String(value) });
  b.addEventListener('click', () => {
    const v = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return b;
}

function segmented<T extends string>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  const wrap = el('div', { class: 'seg', role: 'radiogroup' });
  for (const o of options) {
    const b = el('button', { class: o.value === value ? 'on' : '', role: 'radio', 'aria-checked': String(o.value === value), text: o.label });
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
      b.classList.add('on');
      b.setAttribute('aria-checked', 'true');
      onChange(o.value);
    });
    wrap.append(b);
  }
  return wrap;
}

function selectBox(options: { value: string; label: string }[], value: string, onChange: (v: string) => void): HTMLElement {
  const s = el('select');
  for (const o of options) {
    const opt = el('option', { value: o.value, text: o.label });
    if (o.value === value) opt.selected = true;
    s.append(opt);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function slider(min: number, max: number, step: number, value: number, format: (v: number) => string, onChange: (v: number) => void): HTMLElement {
  const input = el('input', { type: 'range', min, max, step, value });
  const out = el('output', { text: format(value) });
  let timer: number | null = null;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    // Throttle writes while dragging; the Dock follows live.
    if (timer) return;
    timer = window.setTimeout(() => { timer = null; onChange(Number(input.value)); }, 60);
  });
  input.addEventListener('change', () => onChange(Number(input.value)));
  return el('div', { class: 'slider' }, input, out);
}

function button(label: string, onClick: () => void, cls = 'btn', glyphName?: string): HTMLButtonElement {
  const b = el('button', { class: cls });
  if (glyphName) b.insertAdjacentHTML('beforeend', glyph(glyphName));
  b.append(label);
  b.addEventListener('click', onClick);
  return b;
}

// ---------- Pages ----------

function pageGeneral(): HTMLElement[] {
  const g = settings.general;
  return [
    ...group(
      null,
      row('settings.language', selectBox([
        { value: 'auto', label: t('settings.language.auto') },
        { value: 'fr', label: 'Français' },
        { value: 'en', label: 'English' },
      ], g.language, (v) => void update({ general: { language: v as Settings['general']['language'] } }))),
      row('settings.launchAtLogin', toggle(g.launchAtLogin, (v) => void update({ general: { launchAtLogin: v } })), 'settings.launchAtLogin.desc'),
      row('settings.tray', toggle(g.showTrayIcon, (v) => void update({ general: { showTrayIcon: v } })), 'settings.tray.desc'),
    ),
  ];
}

function themeCard(id: Settings['appearance']['theme']): HTMLElement {
  const preview = id === 'system' ? (darkSystem ? 'dark' : 'light') : id;
  const art = el('div', { class: `art${id === 'system' ? ' system' : ''}`, 'data-theme': preview });
  art.append(el('div', { class: 'mini-win' }), el('div', { class: 'mini-dock' }, el('i'), el('i'), el('i'), el('i')));
  const card = el('button', { class: `theme-card${settings.appearance.theme === id ? ' on' : ''}` }, art, el('span', { text: t(`settings.theme.${id}` as StringKey) }));
  card.addEventListener('click', () => {
    document.querySelectorAll('.theme-card').forEach((c) => c.classList.remove('on'));
    card.classList.add('on');
    void update({ appearance: { theme: id } });
  });
  return card;
}

function pageAppearance(): HTMLElement[] {
  const a = settings.appearance;
  const swatches = el('div', { class: 'swatches' });
  const setOn = (c: string) => swatches.querySelectorAll<HTMLElement>('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.color === c));
  for (const c of ACCENTS) {
    const s = el('button', { class: 'swatch', 'data-color': c, 'aria-label': c });
    s.style.background = c;
    s.addEventListener('click', () => { setOn(c); void update({ appearance: { accent: c } }); });
    swatches.append(s);
  }
  const custom = el('label', { class: 'swatch custom', title: 'Personnalisée' });
  const picker = el('input', { type: 'color', value: a.accent });
  picker.addEventListener('input', () => { setOn(''); custom.classList.add('on'); void update({ appearance: { accent: picker.value } }); });
  custom.append(picker);
  swatches.append(custom);
  setOn(a.accent);
  if (!ACCENTS.includes(a.accent)) custom.classList.add('on');

  return [
    el('div', { class: 'group-title', text: t('settings.theme') }),
    el('div', { class: 'group' }, el('div', { class: 'themes', 'data-search': `${t('settings.theme')} ${THEMES.map((x) => t(`settings.theme.${x}` as StringKey)).join(' ')}`.toLowerCase() }, ...THEMES.map(themeCard))),
    ...group(
      null,
      row('settings.accent', swatches),
      row('settings.glass', slider(0.35, 1, 0.01, a.glassOpacity, (v) => `${Math.round(v * 100)} %`, (v) => void update({ appearance: { glassOpacity: v } })), 'settings.glass.desc'),
      row('settings.effects', segmented([
        { value: 'full', label: t('settings.effects.full') },
        { value: 'reduced', label: t('settings.effects.reduced') },
        { value: 'off', label: t('settings.effects.off') },
      ], a.effects, (v) => void update({ appearance: { effects: v } })), 'settings.effects.desc'),
    ),
  ];
}

function dockItemRow(item: DockItem, index: number): HTMLElement {
  const items = settings.dock.items;
  const move = (dir: -1 | 1) => {
    const next = [...items];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    void update({ dock: { items: next } }).then(rerender);
  };
  const up = button('', () => move(-1), 'btn icon-only', 'arrowUp');
  up.disabled = index === 0;
  const actions = el('div', { class: 'item-actions' },
    up,
    button('', () => void update({ dock: { items: items.filter((i) => i.id !== item.id) } }).then(rerender), 'btn icon-only danger', 'close'),
  );
  if (item.type === 'separator') {
    return el('li', { class: 'sep-item' }, el('div', { class: 'it-ico' }, el('div', { class: 'ph', html: glyph('separator') })), el('div', { class: 'it-name' }, el('strong', { text: t('settings.dock.addSeparator') })), actions);
  }
  let icon: HTMLElement;
  const app = item.type === 'app' && apps ? apps.find((a) => (item.appId && a.appId.toLowerCase() === item.appId.toLowerCase()) || (item.path && a.target?.toLowerCase() === item.path.toLowerCase())) : undefined;
  if (app?.icon) icon = el('img', { src: app.icon, alt: '' });
  else icon = el('div', { class: 'ph', html: glyph(item.type === 'folder' ? 'folder' : item.type === 'url' ? 'globe' : item.type === 'nova' ? 'sparkle' : item.type === 'file' ? 'file' : 'window') });
  const detail = item.type === 'url' ? item.url : item.type === 'folder' || item.type === 'file' ? item.path : item.type === 'app' ? (item.path ?? item.appId ?? '') : 'NOVA';
  return el('li', {}, el('div', { class: 'it-ico' }, icon), el('div', { class: 'it-name' }, el('strong', { text: item.name }), el('small', { text: detail })), actions);
}

let pickerOpen: 'app' | 'url' | null = null;

function dockItemsGroup(): HTMLElement[] {
  const list = el('ul', { class: 'items' }, ...settings.dock.items.map(dockItemRow));
  const toolbar = el('div', { class: 'toolbar' },
    button(t('settings.dock.addApp'), () => { pickerOpen = pickerOpen === 'app' ? null : 'app'; rerender(); }, 'btn', 'plus'),
    button(t('settings.dock.addUrl'), () => { pickerOpen = pickerOpen === 'url' ? null : 'url'; rerender(); }, 'btn', 'globe'),
    button(t('settings.dock.addFolder'), async () => {
      const p = await nova.settings.pickFolder();
      if (!p) return;
      const name = p.split(/[\\/]/).filter(Boolean).pop() ?? p;
      await update({ dock: { items: [...settings.dock.items, { id: crypto.randomUUID(), type: 'folder', name, path: p }] } });
      rerender();
    }, 'btn', 'folder'),
    button(t('settings.dock.addSeparator'), () => void update({ dock: { items: [...settings.dock.items, { id: crypto.randomUUID(), type: 'separator' }] } }).then(rerender), 'btn', 'separator'),
  );
  const parts: HTMLElement[] = [list, toolbar];
  if (pickerOpen === 'app') parts.push(appPicker());
  if (pickerOpen === 'url') parts.push(urlForm());
  return [
    el('div', { class: 'group-title', text: t('settings.dock.items') }),
    el('div', { class: 'group', 'data-search': t('settings.dock.items').toLowerCase() }, ...parts),
    el('p', { class: 'note', text: t('settings.dock.items.desc') }),
  ];
}

function appPicker(): HTMLElement {
  const input = el('input', { class: 'input', type: 'search', placeholder: t('settings.dock.searchApps') });
  const listEl = el('div', { class: 'picker-list' });
  const fill = () => {
    const q = input.value.trim().toLowerCase();
    const matches = (apps ?? []).filter((a) => !q || a.name.toLowerCase().includes(q)).slice(0, 120);
    listEl.replaceChildren(...matches.map((a) => {
      const b = el('button', { title: a.name }, a.icon ? el('img', { src: a.icon, alt: '' }) : el('span', { html: glyph('window') }), el('span', { text: a.name }));
      b.addEventListener('click', async () => {
        const items = [...settings.dock.items];
        const sep = items.findIndex((i) => i.type === 'separator');
        items.splice(sep === -1 ? items.length : sep, 0, { id: crypto.randomUUID(), type: 'app', name: a.name, appId: a.appId, path: a.target ?? undefined });
        await update({ dock: { items } });
        pickerOpen = null;
        rerender();
      });
      return b;
    }));
  };
  input.addEventListener('input', fill);
  if (!apps) {
    void nova.settings.apps().then((list) => { apps = list; fill(); });
  } else fill();
  setTimeout(() => input.focus(), 30);
  return el('div', { class: 'picker' }, input, listEl);
}

function urlForm(): HTMLElement {
  const name = el('input', { class: 'input', placeholder: t('settings.dock.urlName') });
  const url = el('input', { class: 'input', placeholder: t('settings.dock.urlAddress'), type: 'url' });
  const err = el('div', { class: 'error-text' });
  const add = button(t('common.add'), async () => {
    const u = url.value.trim();
    if (!/^https?:\/\/\S+\.\S+/i.test(u)) { err.textContent = t('settings.dock.urlAddress'); return; }
    await update({ dock: { items: [...settings.dock.items, { id: crypto.randomUUID(), type: 'url', name: name.value.trim() || new URL(u).hostname, url: u }] } });
    pickerOpen = null;
    rerender();
  }, 'btn primary');
  return el('div', {}, el('div', { class: 'form-inline' }, name, url, add), err);
}

function pageDock(): HTMLElement[] {
  const d = settings.dock;
  const displayOptions = [{ value: 'primary', label: t('settings.dock.display.primary') }, ...displays.filter((x) => !x.primary).map((x) => ({ value: x.id, label: x.label }))];
  return [
    ...group(
      null,
      row('settings.dock.enabled', toggle(d.enabled, (v) => void update({ dock: { enabled: v } }))),
      row('settings.dock.position', segmented([
        { value: 'bottom', label: t('settings.dock.position.bottom') },
        { value: 'left', label: t('settings.dock.position.left') },
        { value: 'right', label: t('settings.dock.position.right') },
      ], d.position, (v) => void update({ dock: { position: v } }))),
      displays.length > 1 ? row('settings.dock.display', selectBox(displayOptions, d.display, (v) => void update({ dock: { display: v } }))) : null,
    ),
    ...group(
      'settings.dock.magnification',
      row('settings.dock.size', slider(32, 96, 1, d.iconSize, (v) => `${v} px`, (v) => void update({ dock: { iconSize: v, magnifiedSize: Math.max(v, settings.dock.magnifiedSize) } }))),
      row('settings.dock.magnification', toggle(d.magnification, (v) => void update({ dock: { magnification: v } }))),
      row('settings.dock.magnifiedSize', slider(32, 128, 1, d.magnifiedSize, (v) => `${v} px`, (v) => void update({ dock: { magnifiedSize: v } }))),
      row('settings.dock.spacing', slider(0, 20, 1, d.spacing, (v) => `${v} px`, (v) => void update({ dock: { spacing: v } }))),
      row('settings.dock.labels', toggle(d.showLabels, (v) => void update({ dock: { showLabels: v } }))),
    ),
    ...group(
      'settings.dock.autoHide',
      row('settings.dock.autoHide', toggle(d.autoHide, (v) => void update({ dock: { autoHide: v } })), 'settings.dock.autoHide.desc'),
      row('settings.dock.reserve', toggle(d.reserveSpace, (v) => void update({ dock: { reserveSpace: v } })), 'settings.dock.reserve.desc'),
      row('settings.dock.fullscreen', toggle(d.hideOnFullscreen, (v) => void update({ dock: { hideOnFullscreen: v } }))),
      row('settings.dock.taskbar', button(t('settings.dock.taskbar.open'), () => nova.settings.openWinSettings('ms-settings:taskbar'), 'btn', 'external'), 'settings.dock.taskbar.desc'),
    ),
    ...group(
      'settings.dock.running',
      row('settings.dock.running', toggle(d.showRunning, (v) => void update({ dock: { showRunning: v } }))),
      row('settings.dock.recents', toggle(d.showRecents, (v) => void update({ dock: { showRecents: v } }))),
      row('settings.dock.minimized', toggle(d.showMinimized, (v) => void update({ dock: { showMinimized: v } }))),
    ),
    ...dockItemsGroup(),
  ];
}

function hotkeyControl(): HTMLElement {
  const wrap = el('div', {});
  const btn = el('button', { class: 'hotkey' });
  const msg = el('div', {});
  const show = (accel: string) => btn.replaceChildren(...accel.split('+').map((k) => el('kbd', { text: k === 'Space' ? (document.documentElement.lang === 'fr' ? 'Espace' : 'Space') : k })));
  show(settings.launcher.hotkey);
  let recording = false;
  const stop = () => {
    recording = false;
    btn.classList.remove('recording');
    nova.settings.recordingHotkey(false);
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = async (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { stop(); show(settings.launcher.hotkey); return; }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[];
    const key = e.code === 'Space' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const accel = [...mods, key].join('+');
    stop();
    const res = await nova.settings.setHotkey(accel);
    if (res.ok) {
      settings.launcher.hotkey = accel;
      msg.replaceChildren(el('span', { class: 'ok-text', text: '✓' }));
    } else {
      msg.replaceChildren(el('div', { class: 'error-text', text: t(res.error === 'invalid' ? 'settings.launcher.hotkey.invalid' : 'settings.launcher.hotkey.conflict') }));
    }
    show(settings.launcher.hotkey);
  };
  btn.addEventListener('click', () => {
    if (recording) return;
    recording = true;
    btn.classList.add('recording');
    btn.textContent = t('settings.launcher.hotkey.record');
    msg.replaceChildren();
    nova.settings.recordingHotkey(true);
    window.addEventListener('keydown', onKey, true);
  });
  btn.addEventListener('blur', () => { if (recording) { stop(); show(settings.launcher.hotkey); } });
  wrap.append(btn, msg);
  return wrap;
}

const ENGINES = [
  { value: 'https://duckduckgo.com/?q={query}', label: 'DuckDuckGo' },
  { value: 'https://www.google.com/search?q={query}', label: 'Google' },
  { value: 'https://www.bing.com/search?q={query}', label: 'Bing' },
  { value: 'https://www.qwant.com/?q={query}', label: 'Qwant' },
  { value: 'https://search.brave.com/search?q={query}', label: 'Brave Search' },
  { value: 'https://www.ecosia.org/search?q={query}', label: 'Ecosia' },
];

function commandsGroup(): HTMLElement[] {
  const cmds = settings.launcher.customCommands;
  const list = el('ul', { class: 'items' }, ...cmds.map((c) =>
    el('li', {},
      el('div', { class: 'it-ico' }, el('div', { class: 'ph', html: glyph('command') })),
      el('div', { class: 'it-name' }, el('strong', { text: `${c.keyword} — ${c.name}` }), el('small', { text: c.target })),
      button('', () => void update({ launcher: { customCommands: cmds.filter((x) => x.id !== c.id) } }).then(rerender), 'btn icon-only danger', 'close'),
    ),
  ));
  const kw = el('input', { class: 'input', placeholder: t('settings.launcher.commands.keyword') });
  kw.style.maxWidth = '120px';
  const name = el('input', { class: 'input', placeholder: t('settings.launcher.commands.name') });
  const target = el('input', { class: 'input', placeholder: 'https://example.com/search?q={query}' });
  const err = el('div', { class: 'error-text' });
  const add = button(t('settings.launcher.commands.add'), async () => {
    const k = kw.value.trim().toLowerCase();
    const tg = target.value.trim();
    const kind = /^https?:\/\//i.test(tg) ? 'url' : 'open';
    if (!k || /\s/.test(k) || !tg) { err.textContent = t('settings.launcher.commands.keyword'); return; }
    await update({ launcher: { customCommands: [...cmds, { id: `cmd-${crypto.randomUUID().slice(0, 8)}`, keyword: k, name: name.value.trim() || k, kind, target: tg }] } });
    rerender();
  }, 'btn primary', 'plus');
  return [
    el('div', { class: 'group-title', text: t('settings.launcher.commands') }),
    el('div', { class: 'group', 'data-search': t('settings.launcher.commands').toLowerCase() }, list, el('div', { class: 'form-inline' }, kw, name, target, add), err),
    el('p', { class: 'note', text: t('settings.launcher.commands.desc') }),
  ];
}

function pageLauncher(): HTMLElement[] {
  const l = settings.launcher;
  const providers = Object.keys(l.providers) as (keyof LauncherProviders)[];
  const engineValue = ENGINES.some((e) => e.value === l.webSearchUrl) ? l.webSearchUrl : ENGINES[0].value;
  return [
    ...group(
      null,
      row('settings.launcher.enabled', toggle(l.enabled, (v) => void update({ launcher: { enabled: v } }))),
      row('settings.launcher.hotkey', hotkeyControl(), 'settings.launcher.hotkey.desc'),
      row('settings.launcher.maxResults', slider(4, 20, 1, l.maxResults, (v) => String(v), (v) => void update({ launcher: { maxResults: v } }))),
      row('settings.launcher.web', selectBox(ENGINES, engineValue, (v) => void update({ launcher: { webSearchUrl: v } }))),
    ),
    ...group(
      'settings.launcher.providers',
      ...providers.map((p) => row(`provider.${p}` as StringKey, toggle(l.providers[p], (v) => {
        if (p === 'clipboard' && v && !settings.privacy.clipboardHistory) void update({ launcher: { providers: { clipboard: v } }, privacy: { clipboardHistory: true } });
        else void update({ launcher: { providers: { [p]: v } } });
      }))),
    ),
    ...commandsGroup(),
  ];
}

function pagePrivacy(): HTMLElement[] {
  const p = settings.privacy;
  const cleared = el('span', { class: 'ok-text' });
  return [
    ...group(
      null,
      row('settings.privacy.history', toggle(p.searchHistory, (v) => void update({ privacy: { searchHistory: v } })), 'settings.privacy.history.desc'),
      row('settings.privacy.clearHistory', el('div', { class: 'slider' }, cleared, button(t('settings.privacy.clearHistory'), async () => {
        await nova.settings.clearHistory();
        cleared.textContent = '✓';
      }, 'btn', 'trash'))),
      row('settings.privacy.clipboard', toggle(p.clipboardHistory, (v) => void update({ privacy: { clipboardHistory: v }, launcher: { providers: { clipboard: v } } })), 'settings.privacy.clipboard.desc'),
    ),
    el('p', { class: 'note', text: t('settings.privacy.local') }),
  ];
}

function pageBackup(): HTMLElement[] {
  const status = (target: HTMLElement, res: { ok: boolean; canceled?: boolean; error?: string }) => {
    if (res.canceled) return;
    target.replaceChildren(res.ok ? el('span', { class: 'ok-text', text: `✓ ${t('settings.backup.done')}` }) : el('div', { class: 'error-text', text: t('settings.backup.failed', { error: res.error ?? '' }) }));
  };
  const s1 = el('div', {});
  const s2 = el('div', {});
  const s3 = el('div', {});
  return [
    ...group(
      null,
      row('settings.backup.export', el('div', { class: 'slider' }, s1, button(t('settings.backup.export'), async () => status(s1, await nova.settings.exportProfile()), 'btn', 'archive')), 'settings.backup.export.desc'),
      row('settings.backup.import', el('div', { class: 'slider' }, s2, button(t('settings.backup.import'), async () => {
        const res = await nova.settings.importProfile();
        status(s2, res);
      }, 'btn', 'external')), 'settings.backup.import.desc'),
      row('settings.backup.reset', el('div', { class: 'slider' }, s3, button(t('settings.backup.reset'), async () => status(s3, await nova.settings.reset()), 'btn danger', 'refresh')), 'settings.backup.reset.desc'),
    ),
  ];
}

function pageAbout(): HTMLElement[] {
  const c = boot.capabilities;
  const cap = (on: boolean) => el('span', { class: `cap${on ? '' : ' off'}` }, el('i'), t(on ? 'settings.about.available' : 'settings.about.unavailable'));
  const reindexStatus = el('span', { class: 'ok-text' });
  return [
    el('div', { class: 'group' }, el('div', { class: 'about-hero' },
      el('img', { src: '../icons/nova-128.png', alt: '' }),
      el('div', {}, el('h2', { text: 'NOVA' }), el('p', { text: `${t('app.tagline')} · ${t('settings.about.version', { v: boot.version })}` })),
    )),
    ...group(
      'settings.about.capabilities',
      row('settings.about.cap.win32', cap(c.win32)),
      row('settings.about.cap.tracking', cap(c.windowTracking)),
      row('settings.about.cap.appbar', cap(c.appBar)),
      row('settings.about.cap.acrylic', cap(c.acrylic)),
    ),
    ...group(
      null,
      row('settings.about.reindex', el('div', { class: 'slider' }, reindexStatus, button(t('settings.about.reindex'), async () => {
        reindexStatus.textContent = '…';
        const n = await nova.settings.reindex();
        apps = null;
        reindexStatus.textContent = `✓ ${n}`;
      }, 'btn', 'refresh'))),
      row('settings.about.logs', button(t('settings.about.logs'), () => nova.settings.openFolder('logs'), 'btn', 'external')),
      row('settings.about.data', button(t('settings.about.data'), () => nova.settings.openFolder('data'), 'btn', 'folder')),
    ),
  ];
}

const PAGES: Record<Section, () => HTMLElement[]> = {
  general: pageGeneral,
  appearance: pageAppearance,
  dock: pageDock,
  launcher: pageLauncher,
  privacy: pagePrivacy,
  backup: pageBackup,
  about: pageAbout,
};

// ---------- Navigation & search ----------

function renderNav() {
  nav.replaceChildren(...SECTIONS.map((s) => {
    const ico = el('span', { class: 'nav-ico', html: glyph(s.glyph) });
    ico.style.background = s.color;
    const b = el('button', { class: s.id === current && !query ? 'active' : '' }, ico, t(`settings.section.${s.id}` as StringKey));
    b.addEventListener('click', () => {
      query = '';
      search.value = '';
      current = s.id;
      renderNav();
      rerender();
      content.scrollTop = 0;
    });
    return el('li', {}, b);
  }));
}

function rerender() {
  const scroll = content.scrollTop;
  const page = el('div', { class: 'page' });
  if (query) {
    // Search mode: every section, only matching rows.
    for (const s of SECTIONS) {
      const parts = PAGES[s.id]();
      const holder = el('div', {}, ...parts);
      let hits = 0;
      holder.querySelectorAll<HTMLElement>('[data-search]').forEach((r) => {
        const match = r.dataset.search!.includes(query);
        if (match) hits++;
        else r.classList.add('hidden-by-search');
      });
      if (!hits) continue;
      holder.querySelectorAll<HTMLElement>('.group').forEach((g) => {
        if (!g.querySelector('[data-search]:not(.hidden-by-search)')) {
          g.style.display = 'none';
          const title = g.previousElementSibling as HTMLElement | null;
          if (title?.classList.contains('group-title')) title.style.display = 'none';
        }
      });
      holder.querySelectorAll<HTMLElement>('.note').forEach((n) => (n.style.display = 'none'));
      page.append(el('h1', { text: t(`settings.section.${s.id}` as StringKey) }), holder);
    }
  } else {
    page.append(el('h1', { text: t(`settings.section.${current}` as StringKey) }), ...PAGES[current]());
  }
  content.replaceChildren(page);
  content.scrollTop = scroll;
}

search.addEventListener('input', () => {
  query = search.value.trim().toLowerCase();
  renderNav();
  rerender();
});

function applyStrings() {
  search.placeholder = t('settings.search');
  document.getElementById('brandSub')!.textContent = t('settings.title');
  document.getElementById('winTitle')!.textContent = '';
  document.title = `NOVA — ${t('settings.title')}`;
}

async function init() {
  boot = await nova.bootstrap();
  settings = boot.settings;
  darkSystem = boot.darkSystem;
  setLanguage(boot.language);
  applyTheme(settings, darkSystem);
  applyStrings();
  const initial = nova.settings.initialSection();
  if (initial && SECTIONS.some((s) => s.id === initial)) current = initial as Section;
  displays = await nova.settings.displays();
  void nova.settings.apps().then((list) => {
    apps = list;
    if (current === 'dock' && !suppressRerender) rerender();
  });
  renderNav();
  rerender();

  nova.onSettings((p) => {
    const langChanged = p.language !== document.documentElement.lang;
    settings = p.settings;
    darkSystem = p.darkSystem;
    setLanguage(p.language);
    applyTheme(settings, darkSystem);
    if (langChanged) {
      applyStrings();
      renderNav();
      rerender();
    } else if (!suppressRerender) rerender();
  });
  nova.settings.onSection((s) => {
    if (SECTIONS.some((x) => x.id === s)) {
      current = s as Section;
      query = '';
      search.value = '';
      renderNav();
      rerender();
    }
  });
  nova.onIconsChanged(() => {
    if (current === 'dock') void nova.settings.apps().then((list) => { apps = list; if (!suppressRerender) rerender(); });
  });
}

void init();
