// Storage Manager rules (pure, unit tested): which locations may never be cleaned, and how
// duplicate candidates are narrowed before any file is hashed.

export interface SafetyEnv { systemRoot: string; programFiles: string[]; programData: string; userProfile: string; appData: string; localAppData: string }

const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const under = (p: string, root: string) => {
  const a = norm(p);
  const r = norm(root);
  return !!r && (a === r || a.startsWith(`${r}\\`));
};

/**
 * True when Orelle must refuse to delete `p`: system and program folders, drive roots, the profile
 * and AppData roots themselves, and any user-excluded folder.
 */
export function isProtectedPath(p: string, env: SafetyEnv, exclusions: string[] = []): boolean {
  if (!/^[a-z]:\\/i.test(p)) return true;
  const n = norm(p);
  if (/^[a-z]:$/.test(n)) return true; // drive root
  if ([env.userProfile, env.appData, env.localAppData].some((r) => r && n === norm(r))) return true;
  if ([env.systemRoot, ...env.programFiles, env.programData].some((r) => under(p, r))) return true;
  if (/\\(\$recycle\.bin|system volume information)(\\|$)/i.test(n)) return true;
  return exclusions.some((x) => under(p, x));
}

/** Files that share a size with at least one other file (the only possible duplicates). */
export function sameSizeGroups<T extends { size: number }>(files: T[], minSize: number): T[][] {
  const bySize = new Map<number, T[]>();
  for (const f of files) {
    if (f.size < minSize) continue;
    const list = bySize.get(f.size);
    if (list) list.push(f);
    else bySize.set(f.size, [f]);
  }
  return [...bySize.values()].filter((g) => g.length > 1).sort((a, b) => b[0].size * b.length - a[0].size * a.length);
}

/** Keeps the N largest items seen so far (sorted, descending). */
export function pushLargest<T extends { size: number }>(list: T[], item: T, max: number) {
  if (list.length >= max && item.size <= list[list.length - 1].size) return;
  let i = list.length;
  while (i > 0 && list[i - 1].size < item.size) i--;
  list.splice(i, 0, item);
  if (list.length > max) list.pop();
}
