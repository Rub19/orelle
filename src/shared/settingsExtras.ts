// Defaults and normalization for the v5 settings groups: top bar, windows, profiles,
// notifications, extensions, automations and AI. Pure functions, unit tested.
import type { ActivityProfile, Automation, AutomationAction, AutomationTrigger, SavedLayout, Settings, ThemeId, TopBarItemId } from './types';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d: string, max = 512) => (typeof v === 'string' && v.length <= max ? v : d);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d);
const num = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);

const THEMES: ThemeId[] = ['system', 'dark', 'light', 'midnight', 'graphite', 'aurora'];
export const TOP_BAR_ITEMS: TopBarItemId[] = ['media', 'cpu', 'network', 'volume', 'battery', 'notifications', 'search', 'control', 'taskbar', 'clock'];
const DEFAULT_HIDDEN: TopBarItemId[] = ['media', 'cpu'];

export type Extras = Pick<Settings, 'topBar' | 'windows' | 'profiles' | 'notifications' | 'extensions' | 'automations' | 'ai'>;

export function defaultProfiles(lang: 'fr' | 'en' = 'fr'): ActivityProfile[] {
  const fr = lang === 'fr';
  const base = { launch: [], layoutId: null, theme: null, taskbarMode: null, hideWidgets: false, focus: false, muteAlerts: false };
  return [
    { ...base, id: 'gaming', name: 'Gaming', glyph: 'gamepad', hideWidgets: true, focus: true, muteAlerts: true },
    { ...base, id: 'dev', name: fr ? 'Développement' : 'Development', glyph: 'code' },
    { ...base, id: 'streaming', name: 'Streaming', glyph: 'broadcast', focus: true, muteAlerts: true },
    { ...base, id: 'focus', name: fr ? 'Productivité' : 'Productivity', glyph: 'check', focus: true },
  ];
}

export function defaultExtras(): Extras {
  return {
    topBar: {
      enabled: true,
      display: 'primary',
      showActiveApp: true,
      showSeconds: false,
      showDate: true,
      items: TOP_BAR_ITEMS.map((id) => ({ id, visible: !DEFAULT_HIDDEN.includes(id) })),
    },
    windows: { snapping: true, layouts: [] },
    profiles: { active: null, list: defaultProfiles() },
    notifications: { enabled: true, history: true, focus: false },
    extensions: { enabled: {} },
    automations: [],
    ai: { provider: 'none', model: '', endpoint: '', consent: false },
  };
}

function normLayout(raw: unknown): SavedLayout | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !Array.isArray(raw.windows)) return null;
  const windows = raw.windows
    .filter(isObj)
    .slice(0, 60)
    .map((w) => ({
      app: str(w.app, '', 1024).toLowerCase(),
      title: str(w.title, '', 260),
      x: Math.round(num(w.x, -32000, 32000, 0)),
      y: Math.round(num(w.y, -32000, 32000, 0)),
      w: Math.round(num(w.w, 50, 32000, 800)),
      h: Math.round(num(w.h, 50, 32000, 600)),
      maximized: bool(w.maximized, false),
    }))
    .filter((w) => w.app);
  return { id: raw.id.slice(0, 64), name: str(raw.name, 'Layout', 80), createdAt: num(raw.createdAt, 0, 1e15, Date.now()), windows };
}

function normProfile(raw: unknown): ActivityProfile | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const launch = (Array.isArray(raw.launch) ? raw.launch : [])
    .filter(isObj)
    .slice(0, 20)
    .map((a) => ({ appId: typeof a.appId === 'string' ? a.appId.slice(0, 1024) : undefined, path: typeof a.path === 'string' ? a.path.slice(0, 1024) : undefined, name: str(a.name, 'App', 260) }))
    .filter((a) => a.appId || a.path);
  return {
    id: raw.id.slice(0, 64),
    name: str(raw.name, 'Profil', 60),
    glyph: str(raw.glyph, 'sparkle', 32),
    launch,
    layoutId: typeof raw.layoutId === 'string' ? raw.layoutId.slice(0, 64) : null,
    theme: typeof raw.theme === 'string' && THEMES.includes(raw.theme as ThemeId) ? (raw.theme as ThemeId) : null,
    taskbarMode: raw.taskbarMode === 'normal' || raw.taskbarMode === 'autohide' || raw.taskbarMode === 'hidden' ? raw.taskbarMode : null,
    hideWidgets: bool(raw.hideWidgets, false),
    focus: bool(raw.focus, false),
    muteAlerts: bool(raw.muteAlerts, false),
  };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function normTrigger(raw: unknown): AutomationTrigger | null {
  if (!isObj(raw)) return null;
  if (raw.kind === 'time' && typeof raw.at === 'string' && TIME_RE.test(raw.at)) {
    const days = Array.isArray(raw.days) ? [...new Set(raw.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
    return { kind: 'time', at: raw.at, days: days.length ? days : [0, 1, 2, 3, 4, 5, 6] };
  }
  if (raw.kind === 'appLaunched' && typeof raw.app === 'string' && raw.app.trim()) return { kind: 'appLaunched', app: raw.app.trim().toLowerCase().slice(0, 260) };
  if (raw.kind === 'startup') return { kind: 'startup' };
  if (raw.kind === 'hotkey' && typeof raw.accel === 'string' && raw.accel.includes('+')) return { kind: 'hotkey', accel: raw.accel.slice(0, 64) };
  return null;
}

function normAction(raw: unknown): AutomationAction | null {
  if (!isObj(raw)) return null;
  switch (raw.kind) {
    case 'profile': return typeof raw.id === 'string' ? { kind: 'profile', id: raw.id.slice(0, 64) } : null;
    case 'layout': return typeof raw.id === 'string' ? { kind: 'layout', id: raw.id.slice(0, 64) } : null;
    case 'open': return typeof raw.target === 'string' && (/^https?:\/\//i.test(raw.target) || /^[a-z]:\\/i.test(raw.target)) ? { kind: 'open', target: raw.target.slice(0, 2048) } : null;
    case 'theme': return THEMES.includes(raw.theme as ThemeId) ? { kind: 'theme', theme: raw.theme as ThemeId } : null;
    case 'notify': return typeof raw.text === 'string' && raw.text.trim() ? { kind: 'notify', text: raw.text.slice(0, 300) } : null;
    case 'focus': return { kind: 'focus', on: bool(raw.on, true) };
    default: return null;
  }
}

function normAutomation(raw: unknown): Automation | null {
  if (!isObj(raw) || typeof raw.id !== 'string') return null;
  const trigger = normTrigger(raw.trigger);
  const actions = (Array.isArray(raw.actions) ? raw.actions : []).map(normAction).filter((a): a is AutomationAction => !!a).slice(0, 10);
  if (!trigger || !actions.length) return null;
  return { id: raw.id.slice(0, 64), name: str(raw.name, 'Automation', 80), enabled: bool(raw.enabled, true), trigger, actions };
}

export function normalizeExtras(s: Json): Extras {
  const d = defaultExtras();
  const tb = isObj(s.topBar) ? s.topBar : {};
  const wi = isObj(s.windows) ? s.windows : {};
  const pr = isObj(s.profiles) ? s.profiles : {};
  const no = isObj(s.notifications) ? s.notifications : {};
  const ex = isObj(s.extensions) ? s.extensions : {};
  const ai = isObj(s.ai) ? s.ai : {};

  // Top bar items: keep the user's order, drop unknown ids, append new ones.
  const items: Extras['topBar']['items'] = [];
  for (const it of Array.isArray(tb.items) ? tb.items : []) {
    if (isObj(it) && TOP_BAR_ITEMS.includes(it.id as TopBarItemId) && !items.some((x) => x.id === it.id)) items.push({ id: it.id as TopBarItemId, visible: bool(it.visible, true) });
  }
  for (const def of d.topBar.items) if (!items.some((x) => x.id === def.id)) items.push(def);

  const seen = new Set<string>();
  const profiles = (Array.isArray(pr.list) ? pr.list : d.profiles.list).map(normProfile).filter((p): p is ActivityProfile => !!p && !seen.has(p.id) && !!seen.add(p.id)).slice(0, 20);
  const enabled: Record<string, boolean> = {};
  if (isObj(ex.enabled)) for (const [k, v] of Object.entries(ex.enabled)) if (/^[a-z0-9._-]{1,64}$/i.test(k) && typeof v === 'boolean') enabled[k] = v;

  return {
    topBar: {
      enabled: bool(tb.enabled, d.topBar.enabled),
      display: str(tb.display, d.topBar.display, 64),
      showActiveApp: bool(tb.showActiveApp, d.topBar.showActiveApp),
      showSeconds: bool(tb.showSeconds, d.topBar.showSeconds),
      showDate: bool(tb.showDate, d.topBar.showDate),
      items,
    },
    windows: {
      snapping: bool(wi.snapping, d.windows.snapping),
      layouts: (Array.isArray(wi.layouts) ? wi.layouts : []).map(normLayout).filter((l): l is SavedLayout => !!l).slice(0, 30),
    },
    profiles: {
      active: typeof pr.active === 'string' && profiles.some((p) => p.id === pr.active) ? pr.active : null,
      list: profiles,
    },
    notifications: {
      enabled: bool(no.enabled, d.notifications.enabled),
      history: bool(no.history, d.notifications.history),
      focus: bool(no.focus, d.notifications.focus),
    },
    extensions: { enabled },
    automations: (Array.isArray(s.automations) ? s.automations : []).map(normAutomation).filter((a): a is Automation => !!a).slice(0, 50),
    ai: {
      provider: oneOf(ai.provider, ['none', 'anthropic', 'openai', 'ollama'] as const, 'none'),
      model: str(ai.model, '', 120),
      endpoint: /^https?:\/\/[^\s]+$/i.test(String(ai.endpoint ?? '')) ? String(ai.endpoint).slice(0, 300) : '',
      consent: bool(ai.consent, false),
    },
  };
}
