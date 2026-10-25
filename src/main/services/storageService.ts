// Storage Manager: where the space goes (per folder), the largest files, true duplicates
// (same size, then same SHA-256) and cleanup candidates. Scans are asynchronous, cancellable and
// report progress. Nothing is ever deleted without an explicit confirmation, deletions go to the
// Recycle Bin, and protected locations (Windows, programs, profile roots, exclusions) are refused.
import { dialog, shell, type BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isProtectedPath, pushLargest, sameSizeGroups, type SafetyEnv } from '../../shared/storageModel';
import type { OrelleContext } from '../context';
import { log } from '../logger';

export interface FileItem { path: string; size: number; mtime: number }
export interface FolderUsage { path: string; name: string; size: number; files: number; dir: boolean }
export interface ScanResult { ok: boolean; canceled?: boolean; root: string; total: number; files: number; skipped: number; children: FolderUsage[]; largest: FileItem[]; ms: number }
export interface DuplicateGroup { size: number; hash: string; files: FileItem[] }
export interface CleanupCandidate { id: 'temp' | 'systemtemp' | 'crashdumps' | 'downloads'; path: string; size: number; files: number; olderThanDays: number }

class Canceled extends Error {}

const SYSTEM_TEMP = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Temp');
const isInside = (p: string, dir: string) => p.toLowerCase().startsWith(`${dir.toLowerCase().replace(/\\+$/, '')}\\`);

export class StorageService extends EventEmitter {
  private job = 0;

  constructor(private readonly ctx: OrelleContext) {
    super();
  }

  env(): SafetyEnv {
    const e = process.env;
    return {
      systemRoot: e.SystemRoot ?? 'C:\\Windows',
      programFiles: [e.ProgramFiles, e['ProgramFiles(x86)'], e.ProgramW6432].filter((x): x is string => !!x),
      programData: e.ProgramData ?? 'C:\\ProgramData',
      userProfile: e.USERPROFILE ?? os.homedir(),
      appData: e.APPDATA ?? '',
      localAppData: e.LOCALAPPDATA ?? '',
    };
  }

  cancel() {
    this.job++;
  }

  /** Iterative walk (no recursion), symlinks and junctions skipped, errors counted. */
  private async walk(root: string, job: number, onFile: (f: FileItem, top: string) => void, onSkip: () => void) {
    const stack: { dir: string; top: string }[] = [{ dir: root, top: '' }];
    let n = 0;
    let lastProgress = 0;
    while (stack.length) {
      if (job !== this.job) throw new Canceled();
      const { dir, top } = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        onSkip();
        continue;
      }
      for (let i = 0; i < entries.length; i += 64) {
        await Promise.all(entries.slice(i, i + 64).map(async (d) => {
          const full = path.join(dir, d.name);
          const t = top || full;
          if (d.isSymbolicLink()) return;
          if (d.isDirectory()) {
            stack.push({ dir: full, top: t });
            return;
          }
          if (!d.isFile()) return;
          try {
            const st = await fs.promises.lstat(full);
            onFile({ path: full, size: st.size, mtime: st.mtimeMs }, t);
          } catch {
            onSkip();
          }
        }));
        n += Math.min(64, entries.length - i);
        if (Date.now() - lastProgress > 250) {
          lastProgress = Date.now();
          this.emit('progress', { scanned: n, current: dir });
        }
      }
    }
  }

  async analyze(root: string): Promise<ScanResult> {
    const job = ++this.job;
    const started = Date.now();
    const children = new Map<string, FolderUsage>();
    const largest: FileItem[] = [];
    let total = 0;
    let files = 0;
    let skipped = 0;
    try {
      await this.walk(root, job, (f, top) => {
        total += f.size;
        files++;
        pushLargest(largest, f, 100);
        let c = children.get(top);
        if (!c) {
          c = { path: top, name: path.basename(top), size: 0, files: 0, dir: top !== f.path };
          children.set(top, c);
        }
        c.size += f.size;
        c.files++;
      }, () => skipped++);
    } catch (err) {
      if (err instanceof Canceled) return { ok: false, canceled: true, root, total, files, skipped, children: [], largest: [], ms: Date.now() - started };
      throw err;
    }
    log.info('storage', `Scanned ${root}: ${files} files, ${(total / 1e9).toFixed(2)} GB in ${Date.now() - started} ms`);
    return { ok: true, root, total, files, skipped, children: [...children.values()].sort((a, b) => b.size - a.size).slice(0, 200), largest, ms: Date.now() - started };
  }

  private async hashFile(p: string, job: number, limit?: number): Promise<string> {
    const h = createHash('sha256');
    const stream = fs.createReadStream(p, limit ? { start: 0, end: limit - 1 } : {});
    for await (const chunk of stream) {
      if (job !== this.job) {
        stream.destroy();
        throw new Canceled();
      }
      h.update(chunk as Buffer);
    }
    return h.digest('hex');
  }

  /** Same size → same first 64 KB → same full SHA-256. Only byte-identical files are reported. */
  async duplicates(root: string, minSize = 1024 * 1024): Promise<{ ok: boolean; canceled?: boolean; groups: DuplicateGroup[]; wasted: number }> {
    const job = ++this.job;
    const all: FileItem[] = [];
    try {
      await this.walk(root, job, (f) => { if (f.size >= minSize) all.push(f); }, () => {});
      const groups: DuplicateGroup[] = [];
      let hashed = 0;
      for (const g of sameSizeGroups(all, minSize).slice(0, 2000)) {
        const byHead = new Map<string, FileItem[]>();
        for (const f of g) {
          try {
            const k = await this.hashFile(f.path, job, 64 * 1024);
            byHead.set(k, [...(byHead.get(k) ?? []), f]);
          } catch (err) {
            if (err instanceof Canceled) throw err;
          }
        }
        for (const same of byHead.values()) {
          if (same.length < 2) continue;
          const byFull = new Map<string, FileItem[]>();
          for (const f of same) {
            try {
              const k = f.size <= 64 * 1024 ? 'head' : await this.hashFile(f.path, job);
              byFull.set(k, [...(byFull.get(k) ?? []), f]);
            } catch (err) {
              if (err instanceof Canceled) throw err;
            }
          }
          for (const [hash, files] of byFull) if (files.length > 1) groups.push({ size: files[0].size, hash, files });
        }
        hashed++;
        this.emit('progress', { scanned: hashed, current: g[0].path, phase: 'hash' });
      }
      groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
      return { ok: true, groups: groups.slice(0, 300), wasted: groups.reduce((s, g) => s + g.size * (g.files.length - 1), 0) };
    } catch (err) {
      if (err instanceof Canceled) return { ok: false, canceled: true, groups: [], wasted: 0 };
      throw err;
    }
  }

  private async sizeOf(dir: string, olderThanMs: number): Promise<{ size: number; files: number }> {
    let size = 0;
    let files = 0;
    const cutoff = Date.now() - olderThanMs;
    const job = this.job;
    try {
      await this.walk(dir, job, (f) => { if (f.mtime < cutoff) { size += f.size; files++; } }, () => {});
    } catch { /* canceled */ }
    return { size, files };
  }

  async cleanupCandidates(): Promise<CleanupCandidate[]> {
    const out: CleanupCandidate[] = [];
    const local = process.env.LOCALAPPDATA ?? '';
    const defs: { id: CleanupCandidate['id']; path: string; days: number }[] = [
      { id: 'temp', path: os.tmpdir(), days: 7 },
      { id: 'crashdumps', path: path.join(local, 'CrashDumps'), days: 0 },
      { id: 'downloads', path: path.join(os.homedir(), 'Downloads'), days: 90 },
    ];
    // Windows' own temp folder is writable only with administrator rights.
    if (this.ctx.capabilities.elevated) defs.splice(1, 0, { id: 'systemtemp', path: SYSTEM_TEMP, days: 7 });
    for (const d of defs) {
      if (!d.path || !fs.existsSync(d.path)) continue;
      const s = await this.sizeOf(d.path, d.days * 86_400_000);
      out.push({ id: d.id, path: d.path, size: s.size, files: s.files, olderThanDays: d.days });
    }
    return out;
  }

  /**
   * Cleans a candidate after confirmation. Temporary files and crash dumps older than the threshold
   * are deleted (files in use are skipped); Downloads are never cleaned automatically.
   */
  async clean(id: CleanupCandidate['id'], parent: BrowserWindow | null): Promise<{ ok: boolean; removed: number; freed: number; canceled?: boolean }> {
    if (id === 'downloads') return { ok: false, removed: 0, freed: 0 };
    const c = (await this.cleanupCandidates()).find((x) => x.id === id);
    if (!c || !c.files) return { ok: true, removed: 0, freed: 0 };
    const t = this.ctx.t;
    const opts = {
      type: 'warning' as const,
      title: t('storage.cleanTitle'),
      message: t('storage.cleanConfirm', { n: c.files, size: (c.size / 1e6).toFixed(1) }),
      detail: t('storage.cleanDetail', { path: c.path, days: c.olderThanDays }),
      buttons: [t('storage.cleanGo'), t('system.cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const res = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    if (res.response !== 0) return { ok: false, removed: 0, freed: 0, canceled: true };
    const cutoff = Date.now() - c.olderThanDays * 86_400_000;
    let removed = 0;
    let freed = 0;
    const job = ++this.job;
    const env = this.env();
    const targets: FileItem[] = [];
    try {
      await this.walk(c.path, job, (f) => { if (f.mtime < cutoff) targets.push(f); }, () => {});
    } catch { /* canceled */ }
    for (const f of targets) {
      // The temp folder lives under LOCALAPPDATA: only its own content may go. Windows\Temp sits
      // inside a protected tree: only files strictly inside it are accepted.
      if (id === 'systemtemp' ? !isInside(f.path, SYSTEM_TEMP) || this.exclusions().some((x) => isInside(f.path, x)) : isProtectedPath(f.path, env, this.exclusions())) continue;
      try {
        await fs.promises.unlink(f.path);
        removed++;
        freed += f.size;
      } catch { /* in use or not ours: skipped */ }
    }
    log.info('storage', `Cleanup ${id}: ${removed} files, ${(freed / 1e6).toFixed(1)} MB`);
    return { ok: true, removed, freed };
  }

  private exclusions() {
    return this.ctx.settings.get().storage.exclusions;
  }

  /** Sends files to the Recycle Bin after one confirmation; protected paths are refused. */
  async recycle(paths: string[], parent: BrowserWindow | null): Promise<{ ok: boolean; removed: number; refused: number; canceled?: boolean }> {
    const env = this.env();
    const allowed = paths.filter((p) => !isProtectedPath(p, env, this.exclusions()) && fs.existsSync(p));
    const refused = paths.length - allowed.length;
    if (!allowed.length) return { ok: false, removed: 0, refused };
    const t = this.ctx.t;
    const size = allowed.reduce((s, p) => { try { return s + fs.statSync(p).size; } catch { return s; } }, 0);
    const opts = {
      type: 'question' as const,
      title: t('storage.recycleTitle'),
      message: t('storage.recycleConfirm', { n: allowed.length, size: (size / 1e6).toFixed(1) }),
      detail: [allowed.slice(0, 8).join('\n'), allowed.length > 8 ? '…' : '', refused ? t('storage.refused', { n: refused }) : ''].filter(Boolean).join('\n'),
      buttons: [t('storage.recycleGo'), t('system.cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const res = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    if (res.response !== 0) return { ok: false, removed: 0, refused, canceled: true };
    let removed = 0;
    for (const p of allowed) {
      try {
        await shell.trashItem(p);
        removed++;
      } catch (err) {
        log.warn('storage', `Cannot recycle ${p}`, err);
      }
    }
    return { ok: true, removed, refused };
  }

  async drives(): Promise<{ root: string; total: number; free: number }[]> {
    const out: { root: string; total: number; free: number }[] = [];
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${letter}:\\`;
      try {
        const s = await fs.promises.statfs(root);
        out.push({ root, total: s.blocks * s.bsize, free: s.bavail * s.bsize });
      } catch { /* no such drive */ }
    }
    return out;
  }
}
