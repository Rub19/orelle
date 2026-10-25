import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SETTINGS_VERSION, applyPatch, defaultSettings, migrate, normalizeSettings } from '../src/shared/settings';
import { SettingsService } from '../src/main/services/settingsService';

describe('settings normalization', () => {
  it('fills a complete object from nothing', () => {
    const s = normalizeSettings(undefined);
    expect(s).toEqual(defaultSettings());
  });

  it('clamps and rejects invalid values instead of throwing', () => {
    const s = normalizeSettings({
      appearance: { theme: 'neon', accent: 'red', glassOpacity: 7 },
      dock: { iconSize: 500, magnifiedSize: 10, position: 'top', spacing: -3 },
      launcher: { maxResults: 'many', webSearchUrl: 'javascript:alert(1)' },
    });
    expect(s.appearance.theme).toBe('dark');
    expect(s.appearance.accent).toBe(defaultSettings().appearance.accent);
    expect(s.appearance.glassOpacity).toBe(1);
    expect(s.dock.iconSize).toBe(96);
    expect(s.dock.magnifiedSize).toBe(96); // never smaller than the icon size
    expect(s.dock.position).toBe('bottom');
    expect(s.dock.spacing).toBe(0);
    expect(s.launcher.maxResults).toBe(8);
    expect(s.launcher.webSearchUrl).toContain('{query}');
  });

  it('drops malformed dock items and duplicate ids, keeps valid ones', () => {
    const s = normalizeSettings({
      dock: {
        items: [
          { id: 'a', type: 'app', name: 'Chrome', appId: 'Chrome' },
          { id: 'a', type: 'app', name: 'Dup', appId: 'Dup' },
          { id: 'b', type: 'url', name: 'Bad', url: 'file:///C:/Windows' },
          { id: 'c', type: 'app', name: 'NoTarget' },
          { id: 'd', type: 'separator' },
          { id: 'e', type: 'folder', name: 'DL', path: 'C:\\Users\\x\\Downloads' },
          'garbage',
        ],
      },
    });
    expect(s.dock.items.map((i) => i.id)).toEqual(['a', 'd', 'e']);
  });

  it('only accepts http(s) URL custom commands', () => {
    const s = normalizeSettings({
      launcher: {
        customCommands: [
          { keyword: 'gh', name: 'GitHub', kind: 'url', target: 'https://github.com/search?q={query}' },
          { keyword: 'x', name: 'Evil', kind: 'url', target: 'javascript:alert(1)' },
          { keyword: 'two words', name: 'Bad', kind: 'url', target: 'https://example.com' },
        ],
      },
    });
    expect(s.launcher.customCommands.map((c) => c.keyword)).toEqual(['gh']);
  });

  it('migrates v1 transparency to v2 glassOpacity', () => {
    const m = migrate({ version: 1, appearance: { transparency: 0.4 } });
    expect(m.version).toBe(SETTINGS_VERSION);
    expect((m.appearance as Record<string, unknown>).transparency).toBeUndefined();
    expect((m.appearance as Record<string, number>).glassOpacity).toBeCloseTo(0.74);
  });

  it('applies deep partial patches and replaces arrays', () => {
    const base = normalizeSettings({ dock: { items: [{ id: 'a', type: 'separator' }, { id: 'b', type: 'separator' }] } });
    const next = applyPatch(base, { dock: { autoHide: true, items: [{ id: 'b', type: 'separator' }] } });
    expect(next.dock.autoHide).toBe(true);
    expect(next.dock.iconSize).toBe(base.dock.iconSize);
    expect(next.dock.items.map((i) => i.id)).toEqual(['b']);
  });

  it('ignores prototype-polluting keys', () => {
    const next = applyPatch(defaultSettings(), JSON.parse('{"__proto__": {"polluted": true}, "dock": {"autoHide": true}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(next.dock.autoHide).toBe(true);
  });

  it('keeps user options after a service restart', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orelle-settings-'));
    try {
      const first = new SettingsService(dir);
      first.update({
        general: { language: 'en', launchAtLogin: true },
        dock: { iconSize: 76, position: 'left' },
        appearance: { accent: '#ff8800' },
      });
      first.flush();

      const afterUpdate = new SettingsService(dir);
      expect(afterUpdate.firstRun).toBe(false);
      expect(afterUpdate.get().general.language).toBe('en');
      expect(afterUpdate.get().general.launchAtLogin).toBe(true);
      expect(afterUpdate.get().dock.iconSize).toBe(76);
      expect(afterUpdate.get().dock.position).toBe('left');
      expect(afterUpdate.get().appearance.accent).toBe('#ff8800');
      expect(fs.existsSync(path.join(dir, 'settings.json'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
