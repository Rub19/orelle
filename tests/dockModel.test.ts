import { describe, expect, it } from 'vitest';
import { clickBehaviour, composeDock, magnifiedSize, reorderItems, type WindowInfo } from '../src/shared/dockModel';
import type { DockItem } from '../src/shared/types';

const win = (hwnd: number, exe: string, extra: Partial<WindowInfo> = {}): WindowInfo => ({ hwnd, title: `w${hwnd}`, pid: hwnd, exe, aumid: null, minimized: false, ...extra });

const items: DockItem[] = [
  { id: 'chrome', type: 'app', name: 'Chrome', appId: 'Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
  { id: 'calc', type: 'app', name: 'Calculator', appId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
  { id: 'sep', type: 'separator' },
  { id: 'dl', type: 'folder', name: 'Downloads', path: 'C:\\Users\\me\\Downloads' },
];

const base = {
  items,
  foreground: null,
  showRunning: true,
  showMinimized: false,
  showRecents: false,
  recentsCount: 3,
  recents: [],
  iconFor: () => null,
  nameFor: (w: WindowInfo) => w.exe.split('\\').pop()!,
};

describe('dock composition', () => {
  it('attaches windows to pinned apps by exe path or AUMID, case-insensitively', () => {
    const { entries, windowsByKey } = composeDock({
      ...base,
      windows: [
        win(1, 'c:\\program files\\google\\chrome\\application\\CHROME.EXE'),
        win(2, 'C:\\Program Files\\WindowsApps\\calc.exe', { aumid: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' }),
      ],
      foreground: 2,
    });
    const chrome = entries.find((e) => e.key === 'chrome')!;
    const calc = entries.find((e) => e.key === 'calc')!;
    expect(chrome.running).toBe(true);
    expect(chrome.active).toBe(false);
    expect(calc.running && calc.active).toBe(true);
    expect(windowsByKey.get('chrome')!.map((w) => w.hwnd)).toEqual([1]);
    expect(entries.filter((e) => e.section === 'running')).toHaveLength(0);
  });

  it('groups unpinned windows into running entries after the pinned ones', () => {
    const { entries } = composeDock({
      ...base,
      windows: [win(3, 'C:\\a\\code.exe'), win(4, 'C:\\a\\code.exe'), win(5, 'C:\\b\\spotify.exe')],
    });
    const running = entries.filter((e) => e.section === 'running');
    expect(running.map((e) => e.label)).toEqual(['code.exe', 'spotify.exe']);
    expect(running[0].windowCount).toBe(2);
    expect(entries.findIndex((e) => e.section === 'running')).toBeGreaterThan(entries.findIndex((e) => e.key === 'dl'));
  });

  it('hides running apps when disabled and lists minimized windows when enabled', () => {
    const windows = [win(6, 'C:\\x\\app.exe', { minimized: true })];
    const off = composeDock({ ...base, windows, showRunning: false });
    expect(off.entries.some((e) => e.section === 'running')).toBe(false);
    const minimized = composeDock({ ...base, windows, showMinimized: true });
    expect(minimized.entries.filter((e) => e.section === 'minimized').map((e) => e.key)).toEqual(['win:6']);
  });

  it('shows recent apps that are neither pinned nor running', () => {
    const { entries } = composeDock({
      ...base,
      windows: [win(7, 'C:\\run\\running.exe')],
      showRecents: true,
      recents: [
        { key: 'app:chrome', name: 'Chrome', appId: 'Chrome' },
        { key: 'app:running', name: 'Running', path: 'C:\\run\\running.exe' },
        { key: 'app:notes', name: 'Notes', path: 'C:\\n\\notes.exe' },
      ],
    });
    expect(entries.filter((e) => e.section === 'recent').map((e) => e.label)).toEqual(['Notes']);
  });
});

describe('dock interactions', () => {
  it('reorders by id list and keeps unknown items at the end', () => {
    const next = reorderItems(items, ['dl', 'chrome']);
    expect(next.map((i) => i.id)).toEqual(['dl', 'chrome', 'calc', 'sep']);
  });

  it('magnifies the icon under the pointer the most, falling off with distance', () => {
    const under = magnifiedSize(48, 80, 100, 100);
    const near = magnifiedSize(48, 80, 150, 100);
    const far = magnifiedSize(48, 80, 400, 100);
    expect(under).toBe(80);
    expect(near).toBeGreaterThan(48);
    expect(near).toBeLessThan(80);
    expect(far).toBe(48);
    expect(magnifiedSize(48, 80, 100, null)).toBe(48);
  });

  it('click: launch when not running, focus, minimize when active, cycle when several', () => {
    expect(clickBehaviour([], null)).toEqual({ action: 'launch' });
    expect(clickBehaviour([{ hwnd: 1, minimized: true }], 9)).toEqual({ action: 'focus', hwnd: 1 });
    expect(clickBehaviour([{ hwnd: 1, minimized: false }], 1)).toEqual({ action: 'minimize', hwnd: 1 });
    expect(clickBehaviour([{ hwnd: 1, minimized: false }, { hwnd: 2, minimized: false }], 1)).toEqual({ action: 'focus', hwnd: 2 });
  });
});
