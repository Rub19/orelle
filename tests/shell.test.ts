import { describe, expect, it } from 'vitest';
import { expandPath, fillTarget, parseManifest, permissionsOf } from '../src/shared/extensionModel';
import { defaultExtras, normalizeExtras } from '../src/shared/settingsExtras';
import { snapRect } from '../src/shared/windowGeometry';

const wa = { left: 0, top: 30, right: 1920, bottom: 1030 };

describe('window snapping geometry', () => {
  it('splits the work area into halves, quarters and thirds', () => {
    expect(snapRect(wa, 'left')).toEqual({ left: 0, top: 30, right: 960, bottom: 1030 });
    expect(snapRect(wa, 'bottomRight')).toEqual({ left: 960, top: 530, right: 1920, bottom: 1030 });
    expect(snapRect(wa, 'centerThird')).toEqual({ left: 640, top: 30, right: 1280, bottom: 1030 });
    expect(snapRect(wa, 'rightTwoThirds')).toEqual({ left: 640, top: 30, right: 1920, bottom: 1030 });
  });

  it('centres a window without growing it past the work area', () => {
    expect(snapRect(wa, 'center', { left: 0, top: 0, right: 800, bottom: 600 })).toEqual({ left: 560, top: 230, right: 1360, bottom: 830 });
    const huge = snapRect(wa, 'center', { left: 0, top: 0, right: 5000, bottom: 5000 });
    expect(huge).toEqual(wa);
  });
});

describe('extension manifests', () => {
  const good = {
    id: 'demo.ext',
    name: 'Demo',
    commands: [
      { id: 'w', title: 'Wiki', keyword: 'wiki', url: 'https://fr.wikipedia.org/w/index.php?search={query}' },
      { id: 'd', title: 'Downloads', path: '%USERPROFILE%\\Downloads' },
      { id: 'c', title: 'Mail', copy: 'me@example.com' },
      { id: 'bad1', title: 'Http', url: 'http://insecure.example' },
      { id: 'bad2', title: 'Script', url: 'javascript:alert(1)' },
      { id: 'bad3', title: 'Relative', path: '..\\..\\Windows' },
    ],
  };

  it('keeps only safe commands', () => {
    const r = parseManifest(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.commands.map((c) => c.id)).toEqual(['w', 'd', 'c']);
    expect(permissionsOf(r.manifest)).toEqual([
      { kind: 'web', hosts: ['fr.wikipedia.org'] },
      { kind: 'files', paths: ['%USERPROFILE%\\Downloads'] },
      { kind: 'clipboard' },
    ]);
  });

  it('rejects manifests without a valid id or command', () => {
    expect(parseManifest({ id: '../x', name: 'X', commands: good.commands }).ok).toBe(false);
    expect(parseManifest({ id: 'x', name: 'X', commands: [{ id: 'a', title: 'A', url: 'ftp://x' }] }).ok).toBe(false);
    expect(parseManifest(null).ok).toBe(false);
  });

  it('encodes queries in URLs and never lets them change a path', () => {
    const r = parseManifest(good);
    if (!r.ok) throw new Error('parse');
    expect(fillTarget(r.manifest.commands[0], 'Saint-Étienne & co')).toBe('https://fr.wikipedia.org/w/index.php?search=Saint-%C3%89tienne%20%26%20co');
    expect(fillTarget(r.manifest.commands[1], '..\\..\\Windows')).toBe('%USERPROFILE%\\Downloads');
  });

  it('expands only allowed environment variables', () => {
    expect(expandPath('%USERPROFILE%\\Downloads', { USERPROFILE: 'C:\\Users\\a' })).toBe('C:\\Users\\a\\Downloads');
    expect(expandPath('%WINDIR%\\System32', { WINDIR: 'C:\\Windows' })).toBeNull();
    expect(expandPath('Downloads', {})).toBeNull();
  });
});

describe('shell settings (v5)', () => {
  it('provides the four default profiles and a complete top bar', () => {
    const d = defaultExtras();
    expect(d.profiles.list.map((p) => p.id)).toEqual(['gaming', 'dev', 'streaming', 'focus']);
    expect(d.topBar.items.length).toBe(11);
    expect(d.ai.provider).toBe('none');
    expect(d.ai.consent).toBe(false);
  });

  it('drops invalid automations, layouts and AI endpoints', () => {
    const n = normalizeExtras({
      automations: [
        { id: 'a', name: 'ok', trigger: { kind: 'time', at: '08:30', days: [1, 9] }, actions: [{ kind: 'notify', text: 'hi' }] },
        { id: 'b', trigger: { kind: 'time', at: '25:00' }, actions: [{ kind: 'notify', text: 'x' }] },
        { id: 'c', trigger: { kind: 'startup' }, actions: [{ kind: 'open', target: 'cmd /c del' }] },
      ],
      windows: { layouts: [{ id: 'l', name: 'L', windows: [{ app: 'C:\\A.EXE', x: 1, y: 2, w: 3, h: 4 }, { app: '' }] }] },
      ai: { provider: 'anthropic', endpoint: 'file:///etc/passwd', consent: 'yes' },
      profiles: { active: 'ghost', list: [{ id: 'x', name: 'X' }, { id: 'x', name: 'dup' }] },
    });
    expect(n.automations.map((a) => a.id)).toEqual(['a']);
    expect(n.automations[0].trigger).toEqual({ kind: 'time', at: '08:30', days: [1] });
    expect(n.windows.layouts[0].windows).toEqual([{ app: 'c:\\a.exe', title: '', x: 1, y: 2, w: 50, h: 50, maximized: false }]);
    expect(n.ai).toEqual({ provider: 'anthropic', model: '', endpoint: '', consent: false });
    expect(n.profiles.list.map((p) => p.name)).toEqual(['X']);
    expect(n.profiles.active).toBeNull();
  });

  it('keeps the user order of top bar items and appends new ones', () => {
    const n = normalizeExtras({ topBar: { items: [{ id: 'clock', visible: true }, { id: 'nope' }, { id: 'cpu', visible: true }] } });
    expect(n.topBar.items.slice(0, 2).map((i) => i.id)).toEqual(['clock', 'cpu']);
    expect(n.topBar.items.length).toBe(11);
  });
});

describe('v4 → v5 migration', () => {
  it('keeps the taskbar behaviour of existing profiles and gives new ones the v5 defaults', async () => {
    const { normalizeSettings } = await import('../src/shared/settings');
    const old = normalizeSettings({ version: 4, general: { hideTaskbar: true } });
    expect(old.general.taskbarMode).toBe('autohide');
    expect(old.general.winKey).toBe('windows');
    const fresh = normalizeSettings(undefined);
    expect(fresh.general.taskbarMode).toBe('hidden');
    expect(fresh.general.winKey).toBe('menu');
  });
});

describe('Mission Control layout', async () => {
  const { layoutCards } = await import('../src/shared/overviewLayout');
  it('keeps every card inside the stage and preserves aspect ratios', () => {
    const aspects = [16 / 9, 4 / 3, 1, 16 / 10, 0.6];
    const cards = layoutCards(aspects, 1600, 900);
    expect(cards).toHaveLength(5);
    cards.forEach((c, i) => {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(1600);
      expect(c.y + c.h).toBeLessThanOrEqual(900);
      expect(Math.abs(c.w / c.h - aspects[i])).toBeLessThan(0.05);
    });
  });
  it('handles one window and none', () => {
    expect(layoutCards([], 800, 600)).toEqual([]);
    const [one] = layoutCards([16 / 9], 1600, 900);
    expect(one.w).toBeGreaterThan(800);
  });
});
