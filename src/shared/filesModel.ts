// Pure helpers for the Files app (unit tested): kinds, sorting, grouping, breadcrumbs, filtering.

export interface FileLike {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
  ext: string;
  hidden: boolean;
}

export type FileKind = 'folder' | 'image' | 'video' | 'audio' | 'document' | 'archive' | 'code' | 'app' | 'other';

const KINDS: Record<Exclude<FileKind, 'folder' | 'other'>, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'avif', 'svg', 'ico', 'psd', 'raw'],
  video: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'wmv', 'm4v', 'flv'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'],
  document: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'epub'],
  archive: ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso', 'cab'],
  code: ['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'ps1', 'bat', 'cmd', 'xml', 'yml', 'yaml', 'toml', 'sql', 'ini'],
  app: ['exe', 'msi', 'lnk', 'appx', 'msix', 'url'],
};
const KIND_BY_EXT = new Map<string, FileKind>();
for (const [kind, exts] of Object.entries(KINDS)) for (const e of exts) KIND_BY_EXT.set(e, kind as FileKind);

export function fileKind(f: Pick<FileLike, 'dir' | 'ext'>): FileKind {
  if (f.dir) return 'folder';
  return KIND_BY_EXT.get(f.ext.toLowerCase()) ?? 'other';
}

export const isArchive = (f: Pick<FileLike, 'dir' | 'ext' | 'name'>) => !f.dir && (/\.(zip|7z|tar|tgz|tar\.gz|tar\.bz2|tar\.xz)$/i.test(f.name));

export type SortKey = 'name' | 'mtime' | 'size' | 'kind';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Folders first (like Finder/Explorer), then by key; names compared naturally ("2" < "10"). */
export function sortEntries<T extends FileLike>(list: T[], key: SortKey, desc: boolean): T[] {
  const dir = desc ? -1 : 1;
  return [...list].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    let c = 0;
    if (key === 'mtime') c = a.mtime - b.mtime;
    else if (key === 'size') c = a.size - b.size;
    else if (key === 'kind') c = collator.compare(fileKind(a) + a.ext, fileKind(b) + b.ext);
    if (c === 0) c = collator.compare(a.name, b.name);
    return c * dir;
  });
}

export type GroupBy = 'none' | 'kind' | 'date';

export function dateBucket(mtime: number, now = Date.now()): 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'older' {
  const d = new Date(now);
  const startToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (mtime >= startToday) return 'today';
  if (mtime >= startToday - 86400_000) return 'yesterday';
  if (mtime >= startToday - 6 * 86400_000) return 'week';
  if (mtime >= startToday - 30 * 86400_000) return 'month';
  if (mtime >= new Date(d.getFullYear(), 0, 1).getTime()) return 'year';
  return 'older';
}

export function groupEntries<T extends FileLike>(list: T[], by: GroupBy, now = Date.now()): { key: string; items: T[] }[] {
  if (by === 'none') return [{ key: '', items: list }];
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const f of list) {
    const k = by === 'kind' ? fileKind(f) : dateBucket(f.mtime, now);
    if (!map.has(k)) { map.set(k, []); order.push(k); }
    map.get(k)!.push(f);
  }
  const rank = by === 'date' ? ['today', 'yesterday', 'week', 'month', 'year', 'older'] : ['folder', 'document', 'image', 'video', 'audio', 'archive', 'code', 'app', 'other'];
  order.sort((a, b) => rank.indexOf(a) - rank.indexOf(b));
  return order.map((key) => ({ key, items: map.get(key)! }));
}

export function filterEntries<T extends FileLike>(list: T[], opts: { showHidden: boolean; kind: FileKind | 'all'; text: string }): T[] {
  const q = opts.text.trim().toLowerCase();
  return list.filter((f) => (opts.showHidden || !f.hidden) && (opts.kind === 'all' || fileKind(f) === opts.kind) && (!q || f.name.toLowerCase().includes(q)));
}

/** "C:\Users\me\Docs" → [{name:"C:", path:"C:\"}, {name:"Users"...}, ...] */
export function breadcrumbs(p: string): { name: string; path: string }[] {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  const out: { name: string; path: string }[] = [];
  let acc = '';
  parts.forEach((part, i) => {
    acc = i === 0 ? `${part}\\` : `${acc.replace(/\\$/, '')}\\${part}`;
    out.push({ name: part, path: acc });
  });
  return out;
}

export function parentDir(p: string): string | null {
  const trimmed = p.replace(/[\\/]+$/, '');
  if (/^[a-z]:$/i.test(trimmed)) return null;
  const i = trimmed.lastIndexOf('\\');
  if (i < 0) return null;
  const parent = trimmed.slice(0, i);
  return /^[a-z]:$/i.test(parent) ? `${parent}\\` : parent;
}

// ---------- Tags ----------

export const TAG_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

// ---------- Batch rename ----------

export interface BatchRenameOptions {
  /** Plain text, matched case-insensitively (never interpreted as a regular expression). */
  find: string;
  replace: string;
  prefix: string;
  suffix: string;
  /** Replace the base name by `base` + number (keeps extensions). '' = keep names. */
  base: string;
  start: number;
  digits: number;
  keepExtension: boolean;
}

const INVALID = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

export function splitName(name: string, isDir: boolean): { stem: string; ext: string } {
  const dot = isDir ? -1 : name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' };
}

/**
 * New names for a batch, in order, with an error per item when the result is invalid or collides
 * with another result or with an untouched name in the folder.
 */
export function batchRename(items: { name: string; dir: boolean }[], o: BatchRenameOptions, others: string[] = []): { from: string; to: string; error: 'invalid' | 'duplicate' | null }[] {
  const out = items.map((it, i) => {
    const { stem, ext } = splitName(it.name, it.dir);
    let s = o.base ? `${o.base}${String(o.start + i).padStart(Math.max(1, o.digits), '0')}` : stem;
    if (o.find) s = s.replace(new RegExp(o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), o.replace);
    s = `${o.prefix}${s}${o.suffix}`.trim();
    const to = o.keepExtension || it.dir ? `${s}${ext}` : s;
    return { from: it.name, to, error: null as 'invalid' | 'duplicate' | null };
  });
  const seen = new Map<string, number>();
  const fixed = new Set(others.map((n) => n.toLowerCase()));
  for (const r of out) {
    if (!r.to.replace(/\.+$/, '').trim() || INVALID.test(r.to) || RESERVED.test(r.to) || /[ .]$/.test(r.to) || r.to.length > 240) r.error = 'invalid';
    const k = r.to.toLowerCase();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const r of out) {
    if (r.error) continue;
    const k = r.to.toLowerCase();
    if ((seen.get(k) ?? 0) > 1 || (fixed.has(k) && k !== r.from.toLowerCase())) r.error = 'duplicate';
  }
  return out;
}
