// Reads back the user's own Windows taskbar pins (pure, unit tested). Input: the taskbar buttons
// in visual order (UI Automation: AppUserModelID + accessible name) and the pinned shortcuts from
// "User Pinned". Output: the pinned apps, in the order the user sees them.

export interface TaskbarButton { id: string; name: string; x: number; y: number }
export interface PinnedLink { file: string; name: string; aumid: string | null; target: string | null }
export interface TaskbarPin { aumid: string | null; name: string; target: string | null }

/** "pinned" in the taskbar's accessible names (Windows display languages). */
const PINNED_WORD = /\b(épinglée?s?|pinned|angeheftet|anclado|fijado|aggiunto|bloccat[oa]|vastgemaakt|fixado|afixado|przypięt[ya]|закреплен[оа]?)\b/i;
/** Suffixes Windows appends to button names ("Discord - 2 running windows", "… épinglé"). */
const NAME_SUFFIX = /\s+(-|–)\s+\d+\s.*$|\s+(épinglée?s?|pinned|angeheftet)$/i;

const KNOWN_FOLDERS: Record<string, string> = {
  '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': 'ProgramFiles(x86)',
  '{6D809377-6AF0-444B-8957-A3773F02200E}': 'ProgramFiles',
  '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': 'SystemRoot',
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': 'System32',
  '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}': 'LOCALAPPDATA',
  '{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}': 'APPDATA',
};

/** "{KnownFolderGuid}\rest\app.exe" (how the shell names desktop apps) → absolute path. */
export function expandKnownFolder(id: string, env: Record<string, string | undefined>): string | null {
  const m = /^(\{[0-9A-F-]{36}\})\\(.+)$/i.exec(id);
  if (!m) return /^[a-z]:\\/i.test(id) ? id : null;
  const key = KNOWN_FOLDERS[m[1].toUpperCase()];
  if (!key) return null;
  const base = key === 'System32' ? (env.SystemRoot ? `${env.SystemRoot}\\System32` : null) : env[key] ?? null;
  return base ? `${base}\\${m[2]}` : null;
}

export function cleanButtonName(name: string): string {
  return name.replace(NAME_SUFFIX, '').trim();
}

/**
 * Pinned apps in visual order. A button is pinned when its name says so, when a pinned shortcut
 * points to the same app, or when the app has no window open (an unpinned app without windows has
 * no button). Pinned shortcuts with no button (e.g. UI Automation unavailable) are appended.
 */
export function mergeTaskbarPins(buttons: TaskbarButton[], links: PinnedLink[], isRunning: (aumid: string) => boolean, env: Record<string, string | undefined> = {}): TaskbarPin[] {
  const lower = (s: string | null | undefined) => (s ?? '').toLowerCase();
  const sorted = [...buttons].sort((a, b) => (Math.abs(a.y - b.y) > 8 ? a.y - b.y : a.x - b.x));
  const used = new Set<PinnedLink>();
  const out: TaskbarPin[] = [];
  const linkFor = (id: string) => {
    const exe = lower(expandKnownFolder(id, env));
    return links.find((l) => !used.has(l) && ((l.aumid && lower(l.aumid) === lower(id)) || (!!exe && lower(l.target) === exe)));
  };
  for (const b of sorted) {
    const link = linkFor(b.id);
    const pinned = PINNED_WORD.test(b.name) || !!link || !isRunning(b.id);
    if (!pinned) continue;
    if (link) used.add(link);
    if (out.some((p) => lower(p.aumid) === lower(b.id))) continue;
    out.push({ aumid: b.id, name: link?.name ?? cleanButtonName(b.name), target: link?.target || expandKnownFolder(b.id, env) });
  }
  for (const l of links) {
    if (used.has(l)) continue;
    if (out.some((p) => (l.aumid && lower(p.aumid) === lower(l.aumid)) || (l.target && lower(p.target) === lower(l.target)))) continue;
    out.push({ aumid: l.aumid, name: l.name, target: l.target || null });
  }
  return out;
}
