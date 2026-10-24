// Builds a sensible initial Dock from the applications actually installed on this PC.
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import type { DockItem } from '../../shared/types';
import type { AppIndex } from './appIndex';

// Matched by AUMID / app id first, then by display name. Order = Dock order.
const CANDIDATES: { ids: RegExp; names: RegExp }[] = [
  { ids: /^microsoft\.windows\.explorer$/i, names: /^(explorateur de fichiers|file explorer)$/i },
  { ids: /^msedge$/i, names: /^microsoft edge$/i },
  { ids: /^chrome$/i, names: /^google chrome$/i },
  { ids: /^308046b0af4a39cb$/i, names: /^firefox$/i },
  { ids: /^microsoft\.windowsterminal/i, names: /^(terminal|windows terminal)$/i },
  { ids: /^microsoft\.visualstudiocode$/i, names: /^visual studio code$/i },
  { ids: /spotify/i, names: /^spotify$/i },
  { ids: /discord/i, names: /^discord$/i },
  { ids: /^microsoft\.windowsnotepad/i, names: /^(bloc-notes|notepad)$/i },
  { ids: /^microsoft\.windowscalculator/i, names: /^(calculatrice|calculator)$/i },
  { ids: /^microsoft\.windows\.photos/i, names: /^(photos)$/i },
  { ids: /^windows\.immersivecontrolpanel/i, names: /^(paramètres|settings)$/i },
];

export function buildDefaultDock(index: AppIndex): DockItem[] {
  const items: DockItem[] = [
    { id: 'orelle-launcher', type: 'orelle', name: 'Launcher', action: 'launcher' },
    { id: 'orelle-control', type: 'orelle', name: app.getLocale().startsWith('fr') ? 'Centre de contrôle' : 'Control Center', action: 'control' },
  ];
  const used = new Set<string>();
  for (const c of CANDIDATES) {
    const found = index.all().find((a) => !used.has(a.key) && (c.ids.test(a.appId) || c.names.test(a.name)));
    if (!found) continue;
    used.add(found.key);
    items.push({ id: randomUUID(), type: 'app', name: found.name, appId: found.appId, path: found.target ?? undefined });
    if (items.length >= 11) break;
  }
  items.push({ id: randomUUID(), type: 'separator' });
  items.push({ id: randomUUID(), type: 'folder', name: app.getLocale().startsWith('fr') ? 'Téléchargements' : 'Downloads', path: app.getPath('downloads') });
  items.push({ id: randomUUID(), type: 'folder', name: app.getLocale().startsWith('fr') ? 'Corbeille' : 'Recycle Bin', path: 'shell:RecycleBinFolder' });
  return items;
}
