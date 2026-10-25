import type { Settings } from '../../shared/types';

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance of an sRGB hex colour. */
export function relativeLuminance(hex: string): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Text colour on top of the accent: whichever of near-black / white has the higher contrast ratio. */
export function accentTextColor(accent: string): string {
  const l = relativeLuminance(accent);
  const onDark = (l + 0.05) / (relativeLuminance('#1d1d1f') + 0.05);
  const onLight = 1.05 / (l + 0.05);
  return onDark >= onLight ? '#1d1d1f' : '#ffffff';
}

/** Applies theme, accent, glass opacity and effects level to the document. */
export function applyTheme(settings: Settings, darkSystem: boolean) {
  const root = document.documentElement;
  const a = settings.appearance;
  const theme = a.theme === 'system' ? (darkSystem ? 'dark' : 'light') : a.theme;
  root.dataset.theme = theme;
  root.dataset.effects = a.effects;
  root.dataset.radius = a.radius;
  const [r, g, b] = hexToRgb(a.accent);
  root.style.setProperty('--accent', a.accent);
  root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  root.style.setProperty('--accent-text', accentTextColor(a.accent));
  root.style.setProperty('--glass-opacity', String(a.effects === 'off' ? 1 : a.glassOpacity));
}
