// Lightweight file-name index of the user's main folders, kept fresh with recursive fs.watch
// (change notifications from the OS — no periodic rescans).
import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { normalize } from '../../shared/fuzzy';
import { log } from '../logger';

export interface FileEntry {
  name: string;
  norm: string;
  path: string;
  dir: boolean;
}

const MAX_ENTRIES = 80_000;
const MAX_DEPTH = 7;
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv', '.cache', 'AppData', '$RECYCLE.BIN', 'System Volume Information', 'dist', 'build', '.next', 'target', 'obj', 'bin']);

export class FileIndex {
  private entries = new Map<string, FileEntry>();
  private watchers: fs.FSWatcher[] = [];
  private building: Promise<void> | null = null;
  private recentCache: { at: number; items: FileEntry[] } = { at: 0, items: [] };
  ready = false;

  roots(): string[] {
    const keys = ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'] as const;
    const out = new Set<string>();
    for (const k of keys) {
      try {
        const p = app.getPath(k);
        if (p && fs.existsSync(p)) out.add(p);
      } catch { /* not available */ }
    }
    return [...out];
  }

  build(): Promise<void> {
    if (this.building) return this.building;
    this.building = this.doBuild().finally(() => { this.building = null; });
    return this.building;
  }

  private async doBuild() {
    const started = Date.now();
    const next = new Map<string, FileEntry>();
    let visited = 0;
    const walk = async (dir: string, depth: number) => {
      if (next.size >= MAX_ENTRIES) return;
      let dirents: fs.Dirent[];
      try { dirents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const d of dirents) {
        if (next.size >= MAX_ENTRIES) return;
        // Shortcuts duplicate the app index; hidden/system files are noise.
        if (d.name.startsWith('.') || d.name.startsWith('~$') || d.name === 'desktop.ini' || /\.lnk$/i.test(d.name)) continue;
        const full = path.join(dir, d.name);
        const isDir = d.isDirectory();
        next.set(full.toLowerCase(), { name: d.name, norm: normalize(d.name), path: full, dir: isDir });
        if (++visited % 2000 === 0) await new Promise((r) => setImmediate(r));
        if (isDir && depth < MAX_DEPTH && !SKIP_DIRS.has(d.name)) await walk(full, depth + 1);
      }
    };
    for (const root of this.roots()) await walk(root, 0);
    this.entries = next;
    this.ready = true;
    log.info('files', `Indexed ${next.size} files/folders in ${Date.now() - started} ms`);
    this.watch();
  }

  private watch() {
    this.watchers.forEach((w) => w.close());
    this.watchers = [];
    for (const root of this.roots()) {
      try {
        const w = fs.watch(root, { recursive: true, persistent: false }, (_type, filename) => {
          if (filename) this.onChange(path.join(root, filename.toString()));
        });
        w.on('error', () => w.close());
        this.watchers.push(w);
      } catch (err) {
        log.warn('files', `Cannot watch ${root}`, err);
      }
    }
  }

  private onChange(full: string) {
    const parts = full.split(path.sep);
    if (parts.some((p) => SKIP_DIRS.has(p) || p.startsWith('.')) || /\.lnk$/i.test(full)) return;
    fs.stat(full, (err, st) => {
      const key = full.toLowerCase();
      if (err) {
        // Deleted or renamed away: drop it and anything below it.
        this.entries.delete(key);
        const prefix = key + path.sep;
        for (const k of this.entries.keys()) if (k.startsWith(prefix)) this.entries.delete(k);
        return;
      }
      if (this.entries.size >= MAX_ENTRIES && !this.entries.has(key)) return;
      const name = path.basename(full);
      this.entries.set(key, { name, norm: normalize(name), path: full, dir: st.isDirectory() });
    });
  }

  /** Cheap pre-filter: entries whose normalized name contains every query token. */
  candidates(query: string, limit = 400): FileEntry[] {
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const out: FileEntry[] = [];
    for (const e of this.entries.values()) {
      if (tokens.every((t) => e.norm.includes(t))) {
        out.push(e);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /** Files from Windows' own "Recent items" folder (shortcuts resolved on demand). */
  recent(limit = 30): FileEntry[] {
    if (Date.now() - this.recentCache.at < 10_000) return this.recentCache.items.slice(0, limit);
    const dir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Recent');
    let items: FileEntry[] = [];
    try {
      const links = fs
        .readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.lnk'))
        .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)
        .slice(0, 60);
      for (const { f } of links) {
        try {
          const target = shell.readShortcutLink(path.join(dir, f)).target;
          if (!target || !fs.existsSync(target)) continue;
          const name = path.basename(target);
          items.push({ name, norm: normalize(name), path: target, dir: fs.statSync(target).isDirectory() });
        } catch { /* broken shortcut */ }
      }
    } catch { items = []; }
    this.recentCache = { at: Date.now(), items };
    return items.slice(0, limit);
  }

  dispose() {
    this.watchers.forEach((w) => w.close());
  }
}
