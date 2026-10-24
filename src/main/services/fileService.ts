// File operations for the Files app. Everything goes through the user's own permissions; errors
// are mapped to readable codes. Deletion goes to the Recycle Bin unless explicitly permanent.
import { app, nativeImage, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { FileOperation } from '../../shared/appTypes';
import type { OrelleContext } from '../context';
import type { FileIndex } from './fileIndex';
import { log } from '../logger';

import type { FileEntry, FsError, Place } from '../../shared/appTypes';
export type { FileEntry, FsError, Place };

export function fsError(err: unknown): FsError {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'EACCES' || code === 'EPERM') return 'denied';
  if (code === 'ENOENT') return 'notfound';
  if (code === 'EEXIST' || code === 'ENOTEMPTY') return 'exists';
  if (code === 'EBUSY') return 'busy';
  if (code === 'EINVAL' || code === 'ENAMETOOLONG') return 'invalid';
  return 'unknown';
}

const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]|^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$|[. ]$/i;
export function validName(name: string) {
  return !!name && name.length <= 255 && !INVALID_NAME.test(name);
}

/** "Rapport.docx" → "Rapport (2).docx" until free. */
export function uniqueName(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length).replace(/ \(\d+\)$/, '');
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
  return `${base} ${Date.now()}${ext}`;
}

const THUMB_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|avif|ico|mp4|mov|mkv|avi|webm|wmv|pdf|psd|svg)$/i;
const TEXT_EXT = /\.(txt|md|json|log|csv|ini|cfg|conf|yml|yaml|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|hpp|cs|ps1|bat|cmd|sh|sql|toml|env|gitignore)$/i;
/** Icons that differ per file (executables, shortcuts…) — everything else shares one icon per extension. */
const UNIQUE_ICON_EXT = /\.(exe|lnk|ico|url|appref-ms|msi|scr|cpl)$/i;

type Operation = FileOperation;

export class FileService extends EventEmitter {
  private thumbCache = new Map<string, string | null>();
  private ops = new Map<string, Operation>();

  constructor(private readonly ctx: OrelleContext, private readonly index: FileIndex) {
    super();
  }

  places(): Place[] {
    const p = (k: Parameters<typeof app.getPath>[0]) => { try { return app.getPath(k); } catch { return ''; } };
    const t = this.ctx.t;
    const out: Place[] = [
      { id: 'home', name: path.basename(p('home')), path: p('home'), kind: 'home' },
      { id: 'desktop', name: t('files.place.desktop'), path: p('desktop'), kind: 'desktop' },
      { id: 'documents', name: t('files.place.documents'), path: p('documents'), kind: 'documents' },
      { id: 'downloads', name: t('files.place.downloads'), path: p('downloads'), kind: 'downloads' },
      { id: 'pictures', name: t('files.place.pictures'), path: p('pictures'), kind: 'pictures' },
      { id: 'music', name: t('files.place.music'), path: p('music'), kind: 'music' },
      { id: 'videos', name: t('files.place.videos'), path: p('videos'), kind: 'videos' },
    ].filter((x) => x.path && fs.existsSync(x.path)) as Place[];
    for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${l}:\\`;
      try {
        const s = fs.statfsSync(root);
        out.push({ id: `drive:${l}`, name: `${l}:`, path: root, kind: 'drive', free: s.bavail * s.bsize, total: s.blocks * s.bsize });
      } catch { /* absent */ }
    }
    return out;
  }

  recent(limit = 40) {
    return this.index.recent(limit).map((f) => this.entry(f.path)).filter((e): e is FileEntry => !!e);
  }

  entry(p: string, lst?: fs.Stats): FileEntry | null {
    try {
      const st = lst ?? fs.statSync(p);
      const name = path.basename(p) || p;
      return {
        name,
        path: p,
        dir: st.isDirectory(),
        size: st.isDirectory() ? 0 : st.size,
        mtime: st.mtimeMs,
        ctime: st.birthtimeMs,
        ext: st.isDirectory() ? '' : path.extname(name).slice(1).toLowerCase(),
        hidden: name.startsWith('.') || name.toLowerCase() === 'desktop.ini' || name.startsWith('~$') || name.startsWith('$'),
        link: false,
      };
    } catch {
      return null;
    }
  }

  async list(dir: string): Promise<{ ok: true; entries: FileEntry[] } | { ok: false; error: FsError }> {
    try {
      const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
      const entries: FileEntry[] = [];
      await Promise.all(
        dirents.map(async (d) => {
          const full = path.join(dir, d.name);
          try {
            const st = await fs.promises.stat(full);
            const e = this.entry(full, st);
            if (e) {
              e.link = d.isSymbolicLink();
              entries.push(e);
            }
          } catch {
            // Unreadable item (permissions, broken link): still show it, with what we know.
            entries.push({ name: d.name, path: full, dir: d.isDirectory(), size: 0, mtime: 0, ctime: 0, ext: path.extname(d.name).slice(1).toLowerCase(), hidden: d.name.startsWith('$'), link: d.isSymbolicLink() });
          }
        }),
      );
      return { ok: true, entries };
    } catch (err) {
      return { ok: false, error: fsError(err) };
    }
  }

  /** Icon for a list row: shared per extension (fast, cached), unique for executables/shortcuts. */
  icon(p: string, dir: boolean): string | null {
    if (dir) return this.ctx.icons.get(p.length <= 3 ? p : this.folderKey(p), true);
    if (UNIQUE_ICON_EXT.test(p)) return this.ctx.icons.get(p, true);
    return this.ctx.icons.getByKey(`ext:${path.extname(p).toLowerCase() || 'none'}`, p, true);
  }

  private folderKey(p: string) {
    // Special folders (Desktop, Downloads…) have their own icons; ordinary folders share one.
    const specials = this.places().filter((x) => x.kind !== 'drive').map((x) => x.path.toLowerCase());
    return specials.includes(p.toLowerCase()) ? p : this.genericFolder();
  }

  private genericFolderPath: string | null = null;
  private genericFolder() {
    if (!this.genericFolderPath) {
      this.genericFolderPath = path.join(this.ctx.dataDir, 'icon-cache', 'generic-folder');
      fs.mkdirSync(this.genericFolderPath, { recursive: true });
    }
    return this.genericFolderPath;
  }

  /** Windows shell thumbnail (images, videos, PDFs…) as a data URL, cached by path + mtime. */
  async thumbnail(p: string, size = 256): Promise<string | null> {
    if (!THUMB_EXT.test(p)) return null;
    let key: string;
    try {
      key = `${p}|${fs.statSync(p).mtimeMs}|${size}`;
    } catch {
      return null;
    }
    if (this.thumbCache.has(key)) return this.thumbCache.get(key)!;
    let url: string | null = null;
    try {
      const img = await nativeImage.createThumbnailFromPath(p, { width: size, height: size });
      url = img.isEmpty() ? null : img.toDataURL();
    } catch { url = null; }
    if (this.thumbCache.size > 600) this.thumbCache.delete(this.thumbCache.keys().next().value!);
    this.thumbCache.set(key, url);
    return url;
  }

  async preview(p: string): Promise<{ kind: 'image' | 'text' | 'none'; data?: string; truncated?: boolean }> {
    if (TEXT_EXT.test(p)) {
      try {
        const fh = await fs.promises.open(p, 'r');
        const buf = Buffer.alloc(64 * 1024);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        await fh.close();
        const text = buf.subarray(0, bytesRead).toString('utf8');
        // Binary content disguised as text: don't show garbage.
        if (/\u0000/.test(text)) return { kind: 'none' };
        return { kind: 'text', data: text, truncated: bytesRead === buf.length };
      } catch {
        return { kind: 'none' };
      }
    }
    const thumb = await this.thumbnail(p, 1024);
    return thumb ? { kind: 'image', data: thumb } : { kind: 'none' };
  }

  async properties(p: string) {
    const st = await fs.promises.stat(p);
    let size = st.size;
    let files = 0;
    let folders = 0;
    let partial = false;
    if (st.isDirectory()) {
      size = 0;
      const deadline = Date.now() + 4000;
      const walk = async (d: string) => {
        if (Date.now() > deadline) { partial = true; return; }
        let list: fs.Dirent[] = [];
        try { list = await fs.promises.readdir(d, { withFileTypes: true }); } catch { partial = true; return; }
        for (const e of list) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) { folders++; await walk(full); }
          else { files++; try { size += (await fs.promises.stat(full)).size; } catch { partial = true; } }
        }
      };
      await walk(p);
    }
    return { path: p, name: path.basename(p) || p, dir: st.isDirectory(), size, files, folders, partial, created: st.birthtimeMs, modified: st.mtimeMs, accessed: st.atimeMs, readonly: (st.mode & 0o200) === 0 };
  }

  // ---------- Mutations ----------

  async mkdir(dir: string, name: string) {
    if (!validName(name)) return { ok: false as const, error: 'invalid' as FsError };
    const final = uniqueName(dir, name);
    try {
      await fs.promises.mkdir(path.join(dir, final));
      return { ok: true as const, path: path.join(dir, final) };
    } catch (err) {
      return { ok: false as const, error: fsError(err) };
    }
  }

  async newFile(dir: string, name: string) {
    if (!validName(name)) return { ok: false as const, error: 'invalid' as FsError };
    const final = uniqueName(dir, name);
    try {
      await fs.promises.writeFile(path.join(dir, final), '', { flag: 'wx' });
      return { ok: true as const, path: path.join(dir, final) };
    } catch (err) {
      return { ok: false as const, error: fsError(err) };
    }
  }

  async rename(p: string, name: string) {
    if (!validName(name)) return { ok: false as const, error: 'invalid' as FsError };
    const target = path.join(path.dirname(p), name);
    if (target.toLowerCase() !== p.toLowerCase() && fs.existsSync(target)) return { ok: false as const, error: 'exists' as FsError };
    try {
      await fs.promises.rename(p, target);
      return { ok: true as const, path: target };
    } catch (err) {
      return { ok: false as const, error: fsError(err) };
    }
  }

  private newOp(kind: Operation['kind'], total: number): Operation {
    const op: Operation = { id: createHash('sha1').update(`${Date.now()}${Math.random()}`).digest('hex').slice(0, 10), kind, total, done: 0, current: '', finished: false };
    this.ops.set(op.id, op);
    return op;
  }

  private progress(op: Operation) {
    this.emit('progress', { ...op });
    if (op.finished) setTimeout(() => this.ops.delete(op.id), 10_000);
  }

  /** Copies or moves items into `dest`; name clashes get " (2)" suffixes; progress per item. */
  transfer(paths: string[], dest: string, mode: 'copy' | 'move'): string {
    const op = this.newOp(mode, paths.length);
    void (async () => {
      for (const src of paths) {
        op.current = path.basename(src);
        this.progress(op);
        try {
          if (mode === 'move' && path.dirname(src).toLowerCase() === dest.toLowerCase()) { op.done++; continue; }
          if ((dest.toLowerCase() + path.sep).startsWith(src.toLowerCase() + path.sep)) throw Object.assign(new Error('into itself'), { code: 'EINVAL' });
          const target = path.join(dest, uniqueName(dest, path.basename(src)));
          if (mode === 'move') {
            try {
              await fs.promises.rename(src, target);
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
              // Different volume: copy then remove.
              await fs.promises.cp(src, target, { recursive: true, errorOnExist: true });
              await fs.promises.rm(src, { recursive: true });
            }
          } else {
            await fs.promises.cp(src, target, { recursive: true, errorOnExist: true });
          }
        } catch (err) {
          op.error = fsError(err);
          log.warn('files', `${mode} failed: ${src}`, err);
        }
        op.done++;
        this.progress(op);
      }
      op.finished = true;
      this.progress(op);
    })();
    return op.id;
  }

  /** Recycle Bin by default (reversible). Permanent deletion only when asked explicitly. */
  remove(paths: string[], permanent: boolean): string {
    const op = this.newOp('delete', paths.length);
    void (async () => {
      for (const p of paths) {
        op.current = path.basename(p);
        this.progress(op);
        try {
          if (permanent) await fs.promises.rm(p, { recursive: true });
          else await shell.trashItem(p);
        } catch (err) {
          op.error = fsError(err);
          log.warn('files', `delete failed: ${p}`, err);
        }
        op.done++;
        this.progress(op);
      }
      op.finished = true;
      this.progress(op);
    })();
    return op.id;
  }

  /**
   * Archives through Windows' built-in tar.exe (libarchive): creates .zip, extracts .zip, .tar(.gz/.bz2/.xz)
   * and .7z where supported. No third-party binaries are bundled.
   */
  archive(kind: 'compress' | 'extract', paths: string[], dest: string): string {
    const op = this.newOp(kind, 1);
    const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    void (async () => {
      try {
        let args: string[];
        let cwd: string;
        if (kind === 'compress') {
          cwd = path.dirname(paths[0]);
          const base = paths.length === 1 ? path.basename(paths[0], path.extname(paths[0])) : path.basename(cwd) || 'Archive';
          const out = path.join(dest, uniqueName(dest, `${base}.zip`));
          op.current = path.basename(out);
          args = ['-a', '-c', '-f', out, ...paths.map((p) => path.relative(cwd, p))];
        } else {
          const name = path.basename(paths[0]).replace(/\.(zip|7z|tar(\.(gz|bz2|xz))?|tgz)$/i, '');
          const target = path.join(dest, uniqueName(dest, name));
          await fs.promises.mkdir(target);
          op.current = path.basename(paths[0]);
          cwd = target;
          args = ['-x', '-f', paths[0], '-C', target];
        }
        this.progress(op);
        const code = await new Promise<number>((resolve) => {
          const child = spawn(tar, args, { cwd, windowsHide: true });
          child.on('error', () => resolve(-1));
          child.on('close', (c) => resolve(c ?? -1));
        });
        if (code !== 0) op.error = 'unknown';
      } catch (err) {
        op.error = fsError(err);
      }
      op.done = 1;
      op.finished = true;
      this.progress(op);
    })();
    return op.id;
  }

  /** Name search under `root` (bounded), optionally inside small text files. */
  async search(root: string, query: string, content: boolean, limit = 300): Promise<FileEntry[]> {
    const q = query.toLowerCase();
    const out: FileEntry[] = [];
    const deadline = Date.now() + 6000;
    const queue = [root];
    while (queue.length && out.length < limit && Date.now() < deadline) {
      const dir = queue.shift()!;
      let list: fs.Dirent[] = [];
      try { list = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const d of list) {
        if (d.name.startsWith('.') || d.name === 'node_modules' || d.name.startsWith('$')) continue;
        const full = path.join(dir, d.name);
        let hit = d.name.toLowerCase().includes(q);
        if (!hit && content && d.isFile() && TEXT_EXT.test(d.name)) {
          try {
            const st = await fs.promises.stat(full);
            if (st.size < 2_000_000) hit = (await fs.promises.readFile(full, 'utf8')).toLowerCase().includes(q);
          } catch { /* unreadable */ }
        }
        if (hit) {
          const e = this.entry(full);
          if (e) out.push(e);
          if (out.length >= limit) break;
        }
        if (d.isDirectory()) queue.push(full);
      }
    }
    return out;
  }

  open(p: string) {
    return shell.openPath(p);
  }

  /** Opens the classic "Open with" chooser (rundll32 is the documented entry point for it). */
  openWith(p: string) {
    spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'rundll32.exe'), ['shell32.dll,OpenAs_RunDLL', p], { detached: true, stdio: 'ignore' }).unref();
  }

  showInExplorer(p: string) {
    shell.showItemInFolder(p);
  }
}
