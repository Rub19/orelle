// Builds the initial Dock from the user's own Windows taskbar: the same pinned apps, in the same
// order. Only when the taskbar cannot be read at all (no pins found) does Orelle fall back to a
// short list of common apps that are actually installed.
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mergeTaskbarPins, type PinnedLink, type TaskbarButton, type TaskbarPin } from '../../shared/taskbarPins';
import type { DockItem } from '../../shared/types';
import type { AppIndex } from './appIndex';
import { runShellHelper } from './shellBridge';
import type { WindowTracker } from './windowTracker';
import { log } from '../logger';

// Fallback only. Matched by AUMID / app id first, then by display name.
const CANDIDATES: { ids: RegExp; names: RegExp }[] = [
  { ids: /^microsoft\.windows\.explorer$/i, names: /^(explorateur de fichiers|file explorer)$/i },
  { ids: /^msedge$/i, names: /^microsoft edge$/i },
  { ids: /^microsoft\.windowsterminal/i, names: /^(terminal|windows terminal)$/i },
  { ids: /^windows\.immersivecontrolpanel/i, names: /^(paramètres|settings)$/i },
];

/** The user's taskbar pins, in visual order (read-only; see resources/helpers/shell-helper.ps1). */
export async function readTaskbarPins(cacheDir: string, tracker: WindowTracker): Promise<TaskbarPin[]> {
  try {
    const raw = JSON.parse(await runShellHelper('taskbar', cacheDir, undefined, 30_000)) as { buttons?: TaskbarButton[]; links?: PinnedLink[] };
    tracker.refresh();
    const running = new Set<string>();
    for (const w of tracker.list()) {
      if (w.aumid) running.add(w.aumid.toLowerCase());
      if (w.exe) running.add(w.exe.toLowerCase());
    }
    const pins = mergeTaskbarPins(raw.buttons ?? [], raw.links ?? [], (id) => running.has(id.toLowerCase()), process.env);
    log.info('dock', `Windows taskbar: ${raw.buttons?.length ?? 0} button(s), ${pins.length} pinned app(s)`);
    return pins;
  } catch (err) {
    log.warn('dock', 'Cannot read the Windows taskbar pins', err);
    return [];
  }
}

/** Dock items for taskbar pins, resolved against the app index so they launch like the Start menu. */
export function pinsToDockItems(pins: TaskbarPin[], index: AppIndex): DockItem[] {
  const items: DockItem[] = [];
  const seen = new Set<string>();
  for (const p of pins) {
    const target = p.target?.toLowerCase();
    const entry = index.entryFor({ appId: p.aumid, exe: p.target }) ?? (target ? index.entries().find((e) => (e.target ?? '').toLowerCase() === target) : undefined);
    const key = (entry?.appId ?? p.aumid ?? p.target ?? p.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry) items.push({ id: randomUUID(), type: 'app', name: entry.name, appId: entry.appId, path: entry.target ?? undefined });
    else if (p.target && /\.exe$/i.test(p.target) && fs.existsSync(p.target)) items.push({ id: randomUUID(), type: 'app', name: p.name || path.basename(p.target, '.exe'), path: p.target });
    else if (p.aumid) items.push({ id: randomUUID(), type: 'app', name: p.name, appId: p.aumid });
  }
  return items;
}

export async function buildDefaultDock(index: AppIndex, cacheDir: string, tracker: WindowTracker): Promise<DockItem[]> {
  const fr = app.getLocale().startsWith('fr');
  const items: DockItem[] = [
    { id: 'orelle-launcher', type: 'orelle', name: 'Launcher', action: 'launcher' },
    { id: 'orelle-control', type: 'orelle', name: fr ? 'Centre de contrôle' : 'Control Center', action: 'control' },
  ];
  const pinned = pinsToDockItems(await readTaskbarPins(cacheDir, tracker), index);
  if (pinned.length) return [...items, ...pinned];
  // Nothing pinned could be read: a few installed essentials instead.
  const used = new Set<string>();
  for (const c of CANDIDATES) {
    const found = index.all().find((a) => !used.has(a.key) && (c.ids.test(a.appId) || c.names.test(a.name)));
    if (!found) continue;
    used.add(found.key);
    items.push({ id: randomUUID(), type: 'app', name: found.name, appId: found.appId, path: found.target ?? undefined });
  }
  return items;
}

/** Replaces the Dock's apps with the taskbar pins, keeping Orelle buttons, folders, links and separators. */
export async function syncDockWithTaskbar(current: DockItem[], index: AppIndex, cacheDir: string, tracker: WindowTracker): Promise<DockItem[] | null> {
  const pinned = pinsToDockItems(await readTaskbarPins(cacheDir, tracker), index);
  if (!pinned.length) return null;
  const orelle = current.filter((i) => i.type === 'orelle');
  const rest = current.filter((i) => i.type !== 'orelle' && i.type !== 'app');
  return [...orelle, ...pinned, ...rest];
}
