// Theme Studio model (pure, unit tested): presets, the portable theme file format and the
// time-based light/dark schedule.
import type { Settings, ThemeId } from './types';

export type RadiusLevel = 'compact' | 'standard' | 'round';

/** What a theme covers: the look of every Orelle surface, never behaviour or personal data. */
export interface ThemeLook {
  theme: ThemeId;
  accent: string;
  glassOpacity: number;
  effects: Settings['appearance']['effects'];
  radius: RadiusLevel;
  dock: { iconSize: number; magnification: boolean; magnifiedSize: number; spacing: number };
}

export interface ThemePreset { id: string; look: ThemeLook }

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'minimal', look: { theme: 'light', accent: '#8e8e93', glassOpacity: 0.9, effects: 'reduced', radius: 'compact', dock: { iconSize: 44, magnification: false, magnifiedSize: 64, spacing: 6 } } },
  { id: 'professional', look: { theme: 'graphite', accent: '#0a84ff', glassOpacity: 0.82, effects: 'reduced', radius: 'standard', dock: { iconSize: 46, magnification: true, magnifiedSize: 64, spacing: 6 } } },
  { id: 'gaming', look: { theme: 'midnight', accent: '#ff375f', glassOpacity: 0.7, effects: 'full', radius: 'compact', dock: { iconSize: 48, magnification: true, magnifiedSize: 76, spacing: 8 } } },
  { id: 'creative', look: { theme: 'aurora', accent: '#bf5af2', glassOpacity: 0.6, effects: 'full', radius: 'round', dock: { iconSize: 54, magnification: true, magnifiedSize: 84, spacing: 10 } } },
  { id: 'macos', look: { theme: 'system', accent: '#0a84ff', glassOpacity: 0.62, effects: 'full', radius: 'round', dock: { iconSize: 52, magnification: true, magnifiedSize: 80, spacing: 6 } } },
  { id: 'orelle', look: { theme: 'dark', accent: '#f2b33d', glassOpacity: 0.72, effects: 'full', radius: 'standard', dock: { iconSize: 48, magnification: true, magnifiedSize: 72, spacing: 8 } } },
];

export function currentLook(s: Settings): ThemeLook {
  const a = s.appearance;
  return { theme: a.theme, accent: a.accent, glassOpacity: a.glassOpacity, effects: a.effects, radius: a.radius, dock: { iconSize: s.dock.iconSize, magnification: s.dock.magnification, magnifiedSize: s.dock.magnifiedSize, spacing: s.dock.spacing } };
}

/** Settings patch that applies a look (normalization clamps every value afterwards). */
export function lookPatch(l: ThemeLook) {
  return {
    appearance: { theme: l.theme, accent: l.accent, glassOpacity: l.glassOpacity, effects: l.effects, radius: l.radius },
    dock: { ...l.dock },
  };
}

export function exportTheme(name: string, l: ThemeLook) {
  return { format: 'orelle-theme', version: 1, name: name.slice(0, 60), look: l };
}

const THEMES: ThemeId[] = ['system', 'dark', 'light', 'midnight', 'graphite', 'aurora'];

/** Validates an imported theme file; unknown or out-of-range values are rejected or clamped. */
export function parseTheme(raw: unknown): { ok: true; name: string; look: ThemeLook } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (r.format !== 'orelle-theme' || r.version !== 1) return { ok: false, error: 'not an Orelle theme (format / version)' };
  const l = r.look as Record<string, unknown> | undefined;
  if (!l || typeof l !== 'object') return { ok: false, error: 'missing look' };
  const d = (l.dock ?? {}) as Record<string, unknown>;
  const n = (v: unknown, min: number, max: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
  if (!THEMES.includes(l.theme as ThemeId)) return { ok: false, error: 'unknown theme' };
  if (typeof l.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(l.accent)) return { ok: false, error: 'invalid accent colour' };
  return {
    ok: true,
    name: typeof r.name === 'string' ? r.name.slice(0, 60) : 'Theme',
    look: {
      theme: l.theme as ThemeId,
      accent: l.accent.toLowerCase(),
      glassOpacity: n(l.glassOpacity, 0.35, 1, 0.72),
      effects: l.effects === 'reduced' || l.effects === 'off' ? l.effects : 'full',
      radius: l.radius === 'compact' || l.radius === 'round' ? l.radius : 'standard',
      dock: { iconSize: Math.round(n(d.iconSize, 32, 80, 48)), magnification: d.magnification !== false, magnifiedSize: Math.round(n(d.magnifiedSize, 48, 128, 72)), spacing: Math.round(n(d.spacing, 2, 20, 8)) },
    },
  };
}

/** Light or dark at `now` for a daily schedule (handles schedules that cross midnight). */
export function scheduledTheme(now: Date, lightAt: string, darkAt: string): 'light' | 'dark' {
  const m = now.getHours() * 60 + now.getMinutes();
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const l = toMin(lightAt);
  const d = toMin(darkAt);
  if (l === d) return 'dark';
  return l < d ? (m >= l && m < d ? 'light' : 'dark') : m >= d && m < l ? 'dark' : 'light';
}
