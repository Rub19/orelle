// Default settings, migrations and normalization. Pure functions: unit tested.
import type { AllowedScript, CustomCommand, DockItem, Settings, ThemeId, WidgetInstance, WidgetType } from './types';

export const SETTINGS_VERSION = 4;

export const WIDGET_TYPES: WidgetType[] = ['clock', 'calendar', 'weather', 'system', 'network', 'battery', 'media', 'notes', 'todo', 'timer', 'recentApps', 'shortcuts', 'appUsage'];

/** Default size (DIP) of each widget type. */
export const WIDGET_SIZES: Record<WidgetType, { w: number; h: number }> = {
  clock: { w: 260, h: 132 },
  calendar: { w: 260, h: 250 },
  weather: { w: 260, h: 150 },
  system: { w: 260, h: 176 },
  network: { w: 260, h: 120 },
  battery: { w: 200, h: 110 },
  media: { w: 260, h: 110 },
  notes: { w: 260, h: 220 },
  todo: { w: 260, h: 240 },
  timer: { w: 260, h: 150 },
  recentApps: { w: 280, h: 120 },
  shortcuts: { w: 280, h: 120 },
  appUsage: { w: 280, h: 210 },
};

export const THEMES: ThemeId[] = ['system', 'dark', 'light', 'midnight', 'graphite', 'aurora'];
export const ACCENTS = ['#f2b33d', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#64d2ff', '#8e8e93'];

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    general: { language: 'auto', launchAtLogin: false, showTrayIcon: true, hideTaskbar: false, hardwareAcceleration: true },
    appearance: { theme: 'dark', accent: '#f2b33d', glassOpacity: 0.72, effects: 'full' },
    dock: {
      enabled: true,
      position: 'bottom',
      display: 'primary',
      iconSize: 52,
      magnification: true,
      magnifiedSize: 84,
      spacing: 6,
      autoHide: false,
      reserveSpace: true,
      hideOnFullscreen: true,
      showRunning: true,
      showRecents: false,
      recentsCount: 3,
      showMinimized: false,
      showLabels: true,
      // Populated on first run from the installed apps (see main/services/firstRun.ts).
      items: [],
    },
    launcher: {
      enabled: true,
      hotkey: 'Alt+Space',
      maxResults: 8,
      webSearchUrl: 'https://duckduckgo.com/?q={query}',
      providers: {
        apps: true,
        windows: true,
        files: true,
        settings: true,
        system: true,
        calculator: true,
        units: true,
        web: true,
        commands: true,
        clipboard: false,
      },
      favorites: [],
      customCommands: [
        { id: 'cmd-gh', keyword: 'gh', name: 'GitHub', kind: 'url', target: 'https://github.com/search?q={query}' },
        { id: 'cmd-yt', keyword: 'yt', name: 'YouTube', kind: 'url', target: 'https://www.youtube.com/results?search_query={query}' },
      ],
      scripts: [],
    },
    privacy: { searchHistory: true, clipboardHistory: false },
    widgets: {
      enabled: true,
      display: 'primary',
      // Seeded on first run with a clock and a system monitor (see main/windows/widgetsController.ts).
      items: [],
      seeded: false,
      weather: { city: '', latitude: null, longitude: null, unit: 'c' },
    },
    controlCenter: { hotkey: 'Ctrl+Alt+C' },
  };
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Sequential migrations. Each receives the raw object of version N and returns version N+1. */
const MIGRATIONS: Record<number, (s: Json) => Json> = {
  // v1 stored the glass setting as `appearance.transparency` (0 = opaque, 1 = clear).
  1: (s) => {
    const appearance = isObj(s.appearance) ? { ...s.appearance } : {};
    if (typeof appearance.transparency === 'number') {
      appearance.glassOpacity = 1 - (appearance.transparency as number) * 0.65;
      delete appearance.transparency;
    }
    return { ...s, appearance, version: 2 };
  },
  // v3 introduced the control center: give existing Docks its button right after the launcher.
  2: (s) => {
    const dock = isObj(s.dock) ? { ...s.dock } : {};
    if (Array.isArray(dock.items) && dock.items.length && !dock.items.some((i) => isObj(i) && i.action === 'control')) {
      const items = [...dock.items];
      const at = items.findIndex((i) => isObj(i) && i.action === 'launcher');
      // Only Docks that still have Orelle's own launcher button get the new one next to it.
      if (at !== -1) {
        items.splice(at + 1, 0, { id: 'orelle-control', type: 'orelle', name: 'Control', action: 'control' });
        dock.items = items;
      }
    }
    return { ...s, dock, version: 3 };
  },
  // v4: the product was renamed from NOVA to Orelle; built-in Dock buttons and launcher ids follow.
  3: (s) => {
    const dock = isObj(s.dock) ? { ...s.dock } : {};
    if (Array.isArray(dock.items)) dock.items = dock.items.map((i) => (isObj(i) && i.type === 'nova' ? { ...i, type: 'orelle' } : i));
    const launcher = isObj(s.launcher) ? { ...s.launcher } : {};
    if (Array.isArray(launcher.favorites)) launcher.favorites = launcher.favorites.map((f) => (typeof f === 'string' ? f.replace(/^nova:/, 'orelle:') : f));
    return { ...s, dock, launcher, version: 4 };
  },
};

export function migrate(raw: unknown): Json {
  let s: Json = isObj(raw) ? { ...raw } : {};
  let v = typeof s.version === 'number' ? s.version : 1;
  while (v < SETTINGS_VERSION) {
    const step = MIGRATIONS[v];
    s = step ? step(s) : { ...s, version: v + 1 };
    v = s.version as number;
  }
  return s;
}

const clamp = (n: unknown, min: number, max: number, def: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : def;
const str = (v: unknown, def: string, max = 2048) => (typeof v === 'string' && v.length <= max ? v : def);
const color = (v: unknown, def: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : def);

export function sanitizeDockItem(raw: unknown): DockItem | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const id = raw.id.slice(0, 64);
  const name = str(raw.name, '', 260);
  switch (raw.type) {
    case 'separator':
      return { id, type: 'separator' };
    case 'app': {
      const appId = typeof raw.appId === 'string' ? raw.appId.slice(0, 1024) : undefined;
      const path = typeof raw.path === 'string' ? raw.path.slice(0, 1024) : undefined;
      if (!appId && !path) return null;
      const args = Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === 'string').slice(0, 32) : undefined;
      return { id, type: 'app', name: name || 'App', appId, path, args };
    }
    case 'folder':
    case 'file':
      if (typeof raw.path !== 'string' || !raw.path) return null;
      return { id, type: raw.type, name: name || raw.path, path: raw.path.slice(0, 1024) };
    case 'url':
      if (typeof raw.url !== 'string' || !/^https?:\/\//i.test(raw.url)) return null;
      return { id, type: 'url', name: name || raw.url, url: raw.url.slice(0, 2048) };
    case 'orelle':
      if (raw.action !== 'launcher' && raw.action !== 'settings' && raw.action !== 'control') return null;
      return { id, type: 'orelle', name: name || 'Orelle', action: raw.action };
    default:
      return null;
  }
}

function sanitizeCommand(raw: unknown): CustomCommand | null {
  if (!isObj(raw)) return null;
  const keyword = str(raw.keyword, '', 32).trim().toLowerCase();
  const target = str(raw.target, '', 2048).trim();
  if (!keyword || !target || /\s/.test(keyword)) return null;
  const kind = oneOf(raw.kind, ['url', 'open'] as const, 'url');
  if (kind === 'url' && !/^https?:\/\//i.test(target)) return null;
  return { id: str(raw.id, `cmd-${keyword}`, 64), keyword, name: str(raw.name, keyword, 120), kind, target };
}

function sanitizeScript(raw: unknown): AllowedScript | null {
  if (!isObj(raw)) return null;
  const path = str(raw.path, '', 1024);
  const keyword = str(raw.keyword, '', 32).trim().toLowerCase();
  if (!/^[a-z]:\\.+\.(ps1|bat|cmd)$/i.test(path) || !keyword || /\s/.test(keyword)) return null;
  return {
    id: str(raw.id, `script-${keyword}`, 64),
    name: str(raw.name, keyword, 120),
    keyword,
    path,
    approvedHash: typeof raw.approvedHash === 'string' && /^[a-f0-9]{64}$/.test(raw.approvedHash) ? raw.approvedHash : null,
    showConsole: bool(raw.showConsole, false),
  };
}

export function sanitizeWidget(raw: unknown): WidgetInstance | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.type !== 'string' || !(WIDGET_TYPES as string[]).includes(raw.type)) return null;
  const type = raw.type as WidgetType;
  const size = WIDGET_SIZES[type];
  let config: Record<string, unknown> = {};
  if (isObj(raw.config)) {
    // Config is user content (notes, todos…): keep it JSON-sized and plain.
    try {
      const text = JSON.stringify(raw.config);
      if (text.length <= 100_000) config = JSON.parse(text);
    } catch { config = {}; }
  }
  return {
    id: raw.id.slice(0, 64),
    type,
    x: Math.round(clamp(raw.x, -4000, 16000, 40)),
    y: Math.round(clamp(raw.y, -4000, 16000, 40)),
    w: Math.round(clamp(raw.w, 140, 900, size.w)),
    h: Math.round(clamp(raw.h, 80, 900, size.h)),
    opacity: clamp(raw.opacity, 0.3, 1, 1),
    hidden: bool(raw.hidden, false),
    config,
  };
}

/** Migrates then coerces any input into a complete, valid Settings object. Never throws. */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  const s = migrate(raw);
  const g = isObj(s.general) ? s.general : {};
  const a = isObj(s.appearance) ? s.appearance : {};
  const k = isObj(s.dock) ? s.dock : {};
  const l = isObj(s.launcher) ? s.launcher : {};
  const p = isObj(s.privacy) ? s.privacy : {};
  const lp = isObj(l.providers) ? l.providers : {};
  const wg = isObj(s.widgets) ? s.widgets : {};
  const wth = isObj(wg.weather) ? wg.weather : {};
  const cc = isObj(s.controlCenter) ? s.controlCenter : {};
  const seenWidgets = new Set<string>();
  const widgets = (Array.isArray(wg.items) ? wg.items : [])
    .map(sanitizeWidget)
    .filter((w): w is WidgetInstance => !!w && !seenWidgets.has(w.id) && !!seenWidgets.add(w.id))
    .slice(0, 40);
  const coord = (v: unknown, lim: number) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : null);

  const seen = new Set<string>();
  const items = (Array.isArray(k.items) ? k.items : d.dock.items)
    .map(sanitizeDockItem)
    .filter((i): i is DockItem => !!i && !seen.has(i.id) && !!seen.add(i.id));

  const iconSize = clamp(k.iconSize, 32, 96, d.dock.iconSize);
  const providers = { ...d.launcher.providers };
  for (const key of Object.keys(providers) as (keyof typeof providers)[]) providers[key] = bool(lp[key], providers[key]);

  return {
    version: SETTINGS_VERSION,
    general: {
      language: oneOf(g.language, ['auto', 'fr', 'en'] as const, d.general.language),
      launchAtLogin: bool(g.launchAtLogin, d.general.launchAtLogin),
      showTrayIcon: bool(g.showTrayIcon, d.general.showTrayIcon),
      hideTaskbar: bool(g.hideTaskbar, d.general.hideTaskbar),
      hardwareAcceleration: bool(g.hardwareAcceleration, d.general.hardwareAcceleration),
    },
    appearance: {
      theme: oneOf(a.theme, THEMES, d.appearance.theme),
      accent: color(a.accent, d.appearance.accent),
      glassOpacity: clamp(a.glassOpacity, 0.35, 1, d.appearance.glassOpacity),
      effects: oneOf(a.effects, ['full', 'reduced', 'off'] as const, d.appearance.effects),
    },
    dock: {
      enabled: bool(k.enabled, d.dock.enabled),
      position: oneOf(k.position, ['bottom', 'left', 'right'] as const, d.dock.position),
      display: str(k.display, d.dock.display, 64),
      iconSize,
      magnification: bool(k.magnification, d.dock.magnification),
      magnifiedSize: clamp(k.magnifiedSize, iconSize, 128, Math.max(iconSize, d.dock.magnifiedSize)),
      spacing: clamp(k.spacing, 0, 24, d.dock.spacing),
      autoHide: bool(k.autoHide, d.dock.autoHide),
      reserveSpace: bool(k.reserveSpace, d.dock.reserveSpace),
      hideOnFullscreen: bool(k.hideOnFullscreen, d.dock.hideOnFullscreen),
      showRunning: bool(k.showRunning, d.dock.showRunning),
      showRecents: bool(k.showRecents, d.dock.showRecents),
      recentsCount: Math.round(clamp(k.recentsCount, 1, 8, d.dock.recentsCount)),
      showMinimized: bool(k.showMinimized, d.dock.showMinimized),
      showLabels: bool(k.showLabels, d.dock.showLabels),
      items,
    },
    launcher: {
      enabled: bool(l.enabled, d.launcher.enabled),
      hotkey: str(l.hotkey, d.launcher.hotkey, 64),
      maxResults: Math.round(clamp(l.maxResults, 4, 20, d.launcher.maxResults)),
      webSearchUrl: /^https?:\/\/.+\{query\}/i.test(String(l.webSearchUrl ?? '')) ? String(l.webSearchUrl) : d.launcher.webSearchUrl,
      providers,
      favorites: Array.isArray(l.favorites) ? l.favorites.filter((f): f is string => typeof f === 'string').slice(0, 100) : [],
      customCommands: Array.isArray(l.customCommands)
        ? l.customCommands.map(sanitizeCommand).filter((c): c is CustomCommand => !!c)
        : d.launcher.customCommands,
      scripts: Array.isArray(l.scripts) ? l.scripts.map(sanitizeScript).filter((x): x is AllowedScript => !!x).slice(0, 50) : [],
    },
    privacy: {
      searchHistory: bool(p.searchHistory, d.privacy.searchHistory),
      clipboardHistory: bool(p.clipboardHistory, d.privacy.clipboardHistory),
    },
    widgets: {
      enabled: bool(wg.enabled, d.widgets.enabled),
      display: str(wg.display, d.widgets.display, 64),
      items: widgets,
      seeded: bool(wg.seeded, false),
      weather: {
        city: str(wth.city, '', 120),
        latitude: coord(wth.latitude, 90),
        longitude: coord(wth.longitude, 180),
        unit: oneOf(wth.unit, ['c', 'f'] as const, 'c'),
      },
    },
    controlCenter: { hotkey: str(cc.hotkey, d.controlCenter.hotkey, 64) },
  };
}

/** Deep-merges a partial patch into settings. Arrays are replaced, not merged. */
export function applyPatch(base: Settings, patch: unknown): Settings {
  const merge = (a: unknown, b: unknown): unknown => {
    if (!isObj(a) || !isObj(b)) return b === undefined ? a : b;
    const out: Json = { ...a };
    for (const [key, val] of Object.entries(b)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      out[key] = merge(a[key], val);
    }
    return out;
  };
  return normalizeSettings(merge(base, patch));
}
