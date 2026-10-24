// Pure Dock logic: composing entries from pinned items + live windows, reordering, magnification.
import type { DockEntry, DockItem } from './types';

export interface WindowInfo {
  hwnd: number;
  title: string;
  pid: number;
  exe: string;
  aumid: string | null;
  minimized: boolean;
}

export interface AppRef {
  appId?: string;
  path?: string;
}

const lc = (s: string | undefined | null) => (s ?? '').toLowerCase();

/** Identity used to group windows into one Dock entry: AUMID when present, else the exe path. */
export function windowAppKey(w: WindowInfo): string {
  return w.aumid ? `aumid:${lc(w.aumid)}` : `exe:${lc(w.exe)}`;
}

export function itemMatchesWindow(item: AppRef, w: WindowInfo): boolean {
  if (item.appId && w.aumid && lc(item.appId) === lc(w.aumid)) return true;
  if (item.path && w.exe && lc(item.path) === lc(w.exe)) return true;
  // Desktop apps indexed by path as their appId.
  if (item.appId && w.exe && lc(item.appId) === lc(w.exe)) return true;
  return false;
}

export interface ComposeInput {
  items: DockItem[];
  windows: WindowInfo[];
  foreground: number | null;
  showRunning: boolean;
  showMinimized: boolean;
  recents: (AppRef & { name: string; key: string })[];
  showRecents: boolean;
  recentsCount: number;
  iconFor: (ref: { item?: DockItem; window?: WindowInfo; recent?: AppRef }) => string | null;
  /** Display name for a running app that is not pinned. */
  nameFor: (w: WindowInfo) => string;
}

export interface ComposedDock {
  entries: DockEntry[];
  /** Windows owned by each entry key, in z-order. */
  windowsByKey: Map<string, WindowInfo[]>;
}

export function composeDock(input: ComposeInput): ComposedDock {
  const windowsByKey = new Map<string, WindowInfo[]>();
  const claimed = new Set<number>();
  const entries: DockEntry[] = [];

  for (const item of input.items) {
    if (item.type === 'separator') {
      entries.push({ key: item.id, section: 'pinned', kind: 'separator', label: '', icon: null, running: false, active: false, windowCount: 0 });
      continue;
    }
    let wins: WindowInfo[] = [];
    if (item.type === 'app') {
      wins = input.windows.filter((w) => !claimed.has(w.hwnd) && itemMatchesWindow(item, w));
      wins.forEach((w) => claimed.add(w.hwnd));
    }
    windowsByKey.set(item.id, wins);
    entries.push({
      key: item.id,
      section: 'pinned',
      kind: item.type,
      label: item.name,
      icon: input.iconFor({ item }),
      running: wins.length > 0,
      active: input.foreground !== null && wins.some((w) => w.hwnd === input.foreground),
      windowCount: wins.length,
      ...(item.type === 'orelle' ? { action: item.action } : {}),
    });
  }

  if (input.showRunning) {
    const groups = new Map<string, WindowInfo[]>();
    for (const w of input.windows) {
      if (claimed.has(w.hwnd)) continue;
      const k = windowAppKey(w);
      const g = groups.get(k);
      if (g) g.push(w);
      else groups.set(k, [w]);
    }
    const running: DockEntry[] = [];
    for (const [k, wins] of groups) {
      const key = `run:${k}`;
      windowsByKey.set(key, wins);
      wins.forEach((w) => claimed.add(w.hwnd));
      running.push({
        key,
        section: 'running',
        kind: 'app',
        label: input.nameFor(wins[0]),
        icon: input.iconFor({ window: wins[0] }),
        running: true,
        active: input.foreground !== null && wins.some((w) => w.hwnd === input.foreground),
        windowCount: wins.length,
      });
    }
    entries.push(...running);
  }

  if (input.showRecents) {
    const recents = input.recents
      .filter((r) => !entries.some((e) => e.key === `recent:${r.key}`))
      .filter((r) => !input.items.some((i) => i.type === 'app' && sameApp(i, r)))
      .filter((r) => !input.windows.some((w) => itemMatchesWindow(r, w)))
      .slice(0, input.recentsCount);
    for (const r of recents) {
      entries.push({
        key: `recent:${r.key}`,
        section: 'recent',
        kind: 'app',
        label: r.name,
        icon: input.iconFor({ recent: r }),
        running: false,
        active: false,
        windowCount: 0,
      });
    }
  }

  if (input.showMinimized) {
    for (const w of input.windows.filter((x) => x.minimized)) {
      const key = `win:${w.hwnd}`;
      windowsByKey.set(key, [w]);
      entries.push({
        key,
        section: 'minimized',
        kind: 'app',
        label: w.title,
        icon: input.iconFor({ window: w }),
        running: true,
        active: false,
        windowCount: 1,
      });
    }
  }

  return { entries, windowsByKey };
}

export function sameApp(a: AppRef, b: AppRef): boolean {
  if (a.appId && b.appId && lc(a.appId) === lc(b.appId)) return true;
  if (a.path && b.path && lc(a.path) === lc(b.path)) return true;
  return false;
}

/** Moves pinned items so that their order follows `orderedIds`; unknown ids are ignored, missing ones kept at the end. */
export function reorderItems(items: DockItem[], orderedIds: string[]): DockItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: DockItem[] = [];
  for (const id of orderedIds) {
    const it = byId.get(id);
    if (it) { out.push(it); byId.delete(id); }
  }
  return [...out, ...byId.values()];
}

/**
 * macOS-style magnification. Returns the size of an icon whose resting centre is at `center`
 * when the pointer is at `pointer` (both along the Dock axis, in px).
 */
export function magnifiedSize(base: number, max: number, center: number, pointer: number | null, spread = 3): number {
  if (pointer === null || max <= base) return base;
  const range = base * spread;
  const d = Math.abs(center - pointer);
  if (d >= range) return base;
  const t = Math.cos((d / range) * (Math.PI / 2));
  return base + (max - base) * t * t;
}

/** Decides what a click on a running entry should do (macOS + Windows taskbar semantics). */
export function clickBehaviour(windows: { hwnd: number; minimized: boolean }[], foreground: number | null): { action: 'launch' } | { action: 'focus'; hwnd: number } | { action: 'minimize'; hwnd: number } {
  if (windows.length === 0) return { action: 'launch' };
  const fgIndex = windows.findIndex((w) => w.hwnd === foreground);
  if (fgIndex === -1) return { action: 'focus', hwnd: windows[0].hwnd };
  if (windows.length === 1) return { action: 'minimize', hwnd: windows[0].hwnd };
  // Several windows and one is active: cycle to the next one.
  return { action: 'focus', hwnd: windows[(fgIndex + 1) % windows.length].hwnd };
}
