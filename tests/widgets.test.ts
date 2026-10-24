import { describe, expect, it } from 'vitest';
import { migrate, normalizeSettings, sanitizeWidget } from '../src/shared/settings';
import { clampRect, formatBytes, formatClock, formatDuration, monthMatrix, weatherGlyph } from '../src/shared/widgetModel';

describe('widget helpers', () => {
  it('builds a Monday-first 6-week month grid', () => {
    const m = monthMatrix(2026, 9); // October 2026 starts on a Thursday
    expect(m).toHaveLength(42);
    expect(m[0].date.getDay()).toBe(1);
    expect(m[3].date.getDate()).toBe(1);
    expect(m[3].inMonth).toBe(true);
    expect(m[0].inMonth).toBe(false);
  });

  it('formats sizes, durations and clocks', () => {
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(2_500_000, 'fr', true)).toBe('2,4 Mo/s');
    expect(formatDuration(30_000)).toBe('< 1 min');
    expect(formatDuration(95 * 60_000)).toBe('1 h 35');
    expect(formatClock(65_000)).toBe('01:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });

  it('maps WMO weather codes to glyphs', () => {
    expect(weatherGlyph(0)).toBe('sun');
    expect(weatherGlyph(2)).toBe('partly');
    expect(weatherGlyph(61)).toBe('rain');
    expect(weatherGlyph(73)).toBe('snow');
    expect(weatherGlyph(95)).toBe('storm');
  });

  it('keeps widgets inside the screen', () => {
    expect(clampRect({ x: -50, y: 900, w: 300, h: 200 }, { w: 1920, h: 1000 })).toEqual({ x: 0, y: 800, w: 300, h: 200 });
    expect(clampRect({ x: 10, y: 10, w: 5000, h: 100 }, { w: 1920, h: 1000 }).w).toBe(1920);
  });
});

describe('widget and v3 settings', () => {
  it('rejects unknown widget types and clamps geometry', () => {
    expect(sanitizeWidget({ id: 'a', type: 'bitcoin' })).toBeNull();
    const w = sanitizeWidget({ id: 'a', type: 'clock', w: 5, h: 99999, opacity: 0, config: { style: 'analog' } })!;
    expect(w.w).toBe(140);
    expect(w.h).toBe(900);
    expect(w.opacity).toBe(0.3);
    expect(w.config.style).toBe('analog');
  });

  it('migration v2 → v3 adds the control center button after the launcher', () => {
    const m = migrate({ version: 2, dock: { items: [{ id: 'l', type: 'nova', action: 'launcher' }, { id: 'x', type: 'separator' }] } });
    expect((m.dock as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(['l', 'nova-control', 'x']);
    const s = normalizeSettings({ version: 2, dock: { items: [{ id: 'l', type: 'nova', action: 'launcher' }] } });
    expect(s.dock.items.map((i) => i.type === 'nova' && i.action)).toEqual(['launcher', 'control']);
  });

  it('only accepts .ps1/.bat/.cmd scripts with absolute paths and a valid hash', () => {
    const s = normalizeSettings({
      launcher: {
        scripts: [
          { id: 'a', name: 'Backup', keyword: 'backup', path: 'C:\\Scripts\\backup.ps1', approvedHash: 'x'.repeat(64) },
          { id: 'b', name: 'Bad', keyword: 'bad', path: 'C:\\evil.exe' },
          { id: 'c', name: 'Rel', keyword: 'rel', path: 'run.bat' },
        ],
      },
    });
    expect(s.launcher.scripts.map((x) => x.id)).toEqual(['a']);
    expect(s.launcher.scripts[0].approvedHash).toBeNull(); // not a hex SHA-256
  });
});
