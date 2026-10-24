import type { Settings } from '../../shared/types';

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Applies theme, accent, glass opacity and effects level to the document. */
export function applyTheme(settings: Settings, darkSystem: boolean) {
  const root = document.documentElement;
  const a = settings.appearance;
  const theme = a.theme === 'system' ? (darkSystem ? 'dark' : 'light') : a.theme;
  root.dataset.theme = theme;
  root.dataset.effects = a.effects;
  const [r, g, b] = hexToRgb(a.accent);
  root.style.setProperty('--accent', a.accent);
  root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  // Readable text on the accent: dark text on very light accents.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  root.style.setProperty('--accent-text', luminance > 0.72 ? '#1d1d1f' : '#ffffff');
  root.style.setProperty('--glass-opacity', String(a.effects === 'off' ? 1 : a.glassOpacity));
}
