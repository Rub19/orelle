// Loads declarative extensions (see shared/extensionModel.ts) from Orelle's bundled folder and
// from %APPDATA%\Orelle\extensions\<id>\manifest.json. Bundled ones are on by default; anything
// the user drops in the folder stays off until they turn it on after reading its permissions.
// Extensions contribute launcher commands only; no extension code is ever run.
import { clipboard, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fuzzyScore } from '../../shared/fuzzy';
import { expandPath, fillTarget, parseManifest, permissionsOf, type ExtensionManifest, type ExtensionPermission } from '../../shared/extensionModel';
import type { SearchResult } from '../../shared/types';
import type { OrelleContext } from '../context';
import { openUrl, safeLaunch } from './launchService';
import type { SearchPlugin } from './searchService';
import { log } from '../logger';

export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  builtin: boolean;
  enabled: boolean;
  commands: { title: string; keyword: string; kind: string }[];
  permissions: ExtensionPermission[];
  error?: string;
  dir: string;
}

export class ExtensionService implements SearchPlugin {
  readonly prefix = 'ext';
  readonly userDir: string;
  private loaded: { manifest: ExtensionManifest | null; builtin: boolean; dir: string; error?: string; folder: string }[] = [];

  constructor(private readonly ctx: OrelleContext, private readonly builtinDir: string) {
    this.userDir = path.join(ctx.dataDir, 'extensions');
  }

  load() {
    this.loaded = [];
    try { fs.mkdirSync(this.userDir, { recursive: true }); } catch { /* read-only profile */ }
    for (const [dir, builtin] of [[this.builtinDir, true], [this.userDir, false]] as const) {
      let names: string[] = [];
      try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
      for (const name of names.slice(0, 100)) {
        const folder = path.join(dir, name);
        const file = path.join(folder, 'manifest.json');
        try {
          if (fs.statSync(file).size > 256 * 1024) throw new Error('manifest too large');
          const res = parseManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
          if (!res.ok) throw new Error(res.error);
          // First one wins: a user folder cannot shadow a bundled extension.
          if (this.loaded.some((l) => l.manifest?.id === res.manifest.id)) throw new Error(`duplicate id ${res.manifest.id}`);
          this.loaded.push({ manifest: res.manifest, builtin, dir, folder });
        } catch (err) {
          this.loaded.push({ manifest: null, builtin, dir, folder, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    log.info('extensions', `${this.loaded.filter((l) => l.manifest).length} extension(s) loaded`);
  }

  private enabled(id: string, builtin: boolean) {
    return this.ctx.settings.get().extensions.enabled[id] ?? builtin;
  }

  list(): ExtensionInfo[] {
    return this.loaded.map((l) => {
      const m = l.manifest;
      return {
        id: m?.id ?? path.basename(l.folder),
        name: m?.name ?? path.basename(l.folder),
        version: m?.version ?? '',
        author: m?.author ?? '',
        description: m?.description ?? '',
        builtin: l.builtin,
        enabled: !!m && this.enabled(m.id, l.builtin),
        commands: m?.commands.map((c) => ({ title: c.title, keyword: c.keyword, kind: c.kind })) ?? [],
        permissions: m ? permissionsOf(m) : [],
        error: l.error,
        dir: l.folder,
      };
    });
  }

  private active() {
    return this.loaded.filter((l): l is typeof l & { manifest: ExtensionManifest } => !!l.manifest && this.enabled(l.manifest.id, l.builtin));
  }

  search(q: string): SearchResult[] {
    const out: SearchResult[] = [];
    const [kw, ...rest] = q.split(/\s+/);
    const arg = rest.join(' ');
    for (const { manifest: m } of this.active()) {
      for (const c of m.commands) {
        const takesQuery = c.target.includes('{query}') && c.kind !== 'path';
        const exact = c.keyword && c.keyword === kw.toLowerCase();
        const score = exact ? 1.6 : Math.max(fuzzyScore(q, c.title), c.keyword ? fuzzyScore(q, c.keyword) : 0) * 0.8;
        if (score <= 0.35) continue;
        const a = exact && takesQuery ? arg : '';
        out.push({
          id: `ext:${m.id}/${c.id}:${a}`,
          kind: 'extension',
          title: a ? `${c.title} — ${a}` : c.title,
          subtitle: c.subtitle || `${m.name}${c.keyword ? ` · ${c.keyword}${takesQuery ? ' …' : ''}` : ''}`,
          glyph: c.kind === 'url' ? 'globe' : c.kind === 'path' ? 'folder' : 'clipboard',
          score,
          action: c.kind === 'copy' ? this.ctx.t('launcher.copy') : this.ctx.t('launcher.open'),
        });
      }
    }
    return out;
  }

  private find(rest: string) {
    const [ref, ...arg] = rest.split(':');
    const [extId, cmdId] = ref.split('/');
    const ext = this.active().find((l) => l.manifest.id === extId);
    const cmd = ext?.manifest.commands.find((c) => c.id === cmdId);
    return ext && cmd ? { m: ext.manifest, c: cmd, arg: arg.join(':') } : null;
  }

  resolve(rest: string): SearchResult | null {
    const f = this.find(rest);
    if (!f) return null;
    return { id: `ext:${rest}`, kind: 'extension', title: f.arg ? `${f.c.title} — ${f.arg}` : f.c.title, subtitle: f.m.name, glyph: f.c.kind === 'url' ? 'globe' : f.c.kind === 'path' ? 'folder' : 'clipboard', score: 0, action: this.ctx.t('launcher.open') };
  }

  async execute(rest: string): Promise<boolean> {
    const f = this.find(rest);
    if (!f) return false;
    const target = fillTarget(f.c, f.arg);
    if (this.ctx.settings.get().privacy.searchHistory) this.ctx.usage.record(`ext:${rest}`, f.c.title);
    if (f.c.kind === 'url') return safeLaunch(() => openUrl(target), target);
    if (f.c.kind === 'copy') {
      clipboard.writeText(target);
      return true;
    }
    // Folders only: an extension can never start a program.
    const p = expandPath(target, process.env as Record<string, string>);
    if (!p || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
      log.warn('extensions', `${f.m.id}: refused path ${target}`);
      return false;
    }
    if (this.ctx.settings.get().files.openFoldersInOrelle) this.ctx.actions.openApp('files', p);
    else await shell.openPath(p);
    return true;
  }
}
