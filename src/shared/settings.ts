// Default settings, migrations and normalization. Pure functions: unit tested.
import type { CustomCommand, DockItem, Settings, ThemeId } from './types';

export const SETTINGS_VERSION = 2;

export const THEMES: ThemeId[] = ['system', 'dark', 'light', 'midnight', 'graphite', 'aurora'];
export const ACCENTS = ['#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ff9f0a', '#30d158', '#64d2ff', '#8e8e93'];

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    general: { language: 'auto', launchAtLogin: false, showTrayIcon: true },
    appearance: { theme: 'dark', accent: '#0a84ff', glassOpacity: 0.72, effects: 'full' },
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
    },
    privacy: { searchHistory: true, clipboardHistory: false },
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
    case 'nova':
      if (raw.action !== 'launcher' && raw.action !== 'settings') return null;
      return { id, type: 'nova', name: name || 'NOVA', action: raw.action };
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
    },
    privacy: {
      searchHistory: bool(p.searchHistory, d.privacy.searchHistory),
      clipboardHistory: bool(p.clipboardHistory, d.privacy.clipboardHistory),
    },
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
