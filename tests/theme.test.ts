import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../src/shared/settings';
import { THEME_PRESETS, currentLook, exportTheme, lookPatch, parseTheme, scheduledTheme } from '../src/shared/themeModel';

describe('Theme Studio', () => {
  it('round-trips a look through the theme file format', () => {
    const look = currentLook(normalizeSettings(undefined));
    const parsed = parseTheme(JSON.parse(JSON.stringify(exportTheme('Mine', look))));
    expect(parsed).toEqual({ ok: true, name: 'Mine', look });
  });

  it('rejects foreign or invalid files and clamps numbers', () => {
    expect(parseTheme({ format: 'other', version: 1 }).ok).toBe(false);
    expect(parseTheme({ format: 'orelle-theme', version: 1, look: { theme: 'neon', accent: '#ffffff' } }).ok).toBe(false);
    expect(parseTheme({ format: 'orelle-theme', version: 1, look: { theme: 'dark', accent: 'red' } }).ok).toBe(false);
    const r = parseTheme({ format: 'orelle-theme', version: 1, look: { theme: 'dark', accent: '#AABBCC', glassOpacity: 9, dock: { iconSize: 500 } } });
    expect(r.ok && r.look.glassOpacity).toBe(1);
    expect(r.ok && r.look.dock.iconSize).toBe(80);
    expect(r.ok && r.look.accent).toBe('#aabbcc');
  });

  it('every preset survives settings normalization unchanged', () => {
    for (const p of THEME_PRESETS) {
      const s = normalizeSettings(lookPatch(p.look));
      expect(currentLook(s), p.id).toEqual(p.look);
    }
  });

  it('computes the light/dark schedule, including across midnight', () => {
    const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m);
    expect(scheduledTheme(at(12), '07:30', '19:30')).toBe('light');
    expect(scheduledTheme(at(20), '07:30', '19:30')).toBe('dark');
    expect(scheduledTheme(at(7, 29), '07:30', '19:30')).toBe('dark');
    expect(scheduledTheme(at(23), '22:00', '06:00')).toBe('light');
    expect(scheduledTheme(at(3), '22:00', '06:00')).toBe('light');
    expect(scheduledTheme(at(12), '22:00', '06:00')).toBe('dark');
  });
});
