// Installed applications, from shell:AppsFolder (desktop + Microsoft Store apps, as in the Start menu).
// A cached copy loads instantly at startup; a background refresh follows. Icons are resolved lazily
// (Dock items first, launcher results on demand, the rest warmed in the background).
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { AppInfo } from '../../shared/types';
import { runShellHelper } from './shellBridge';
import { IconService } from './iconService';
import { log } from '../logger';

interface RawApp { name: string; appId: string; target: string | null }
type Entry = Omit<AppInfo, 'icon'>;

const NOISE = /(uninstall|d[ée]sinstall|readme|lisez-moi|license|licence|release notes|documentation|manuals?\b|help\b|aide\b|website|site web)/i;
const DOC_EXT = /\.(url|html?|pdf|chm|txt|rtf|md|ini|log|xml)$/i;

/** Prefer the real executable when the shell index gives us one. */
export function iconParsingName(app: Pick<RawApp, 'appId' | 'target'>): string {
  const target = app.target?.trim();
  if (target && !/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return target;
  return `shell:AppsFolder\\${app.appId}`;
}

export class AppIndex extends EventEmitter {
  private apps: Entry[] = [];
  private byTarget = new Map<string, Entry>();
  private byAppId = new Map<string, Entry>();
  private cacheFile: string;
  private refreshing: Promise<void> | null = null;
  ready = false;

  constructor(dataDir: string, private readonly icons: IconService) {
    super();
    this.cacheFile = path.join(dataDir, 'apps.json');
    try {
      this.set(JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')) as RawApp[]);
      this.ready = this.apps.length > 0;
    } catch { /* first run */ }
  }

  private withIcon(e: Entry | undefined): AppInfo | undefined {
    return e ? { ...e, icon: this.icons.get(iconParsingName(e)) } : undefined;
  }

  /** Raw entries without touching icons (cheap; used for searching). */
  entries(): readonly Entry[] {
    return this.apps;
  }

  /** All apps with icons (queues extraction of missing ones). */
  all(): AppInfo[] {
    return this.apps.map((a) => this.withIcon(a)!);
  }

  iconFor(appId: string, urgent = false): string | null {
    const entry = this.byAppId.get(appId.toLowerCase());
    return this.icons.get(entry ? iconParsingName(entry) : `shell:AppsFolder\\${appId}`, urgent);
  }

  /** Lookup without resolving icons. */
  entryFor(ref: { appId?: string | null; exe?: string | null }): Entry | undefined {
    return (ref.appId ? this.byAppId.get(ref.appId.toLowerCase()) : undefined) ?? (ref.exe ? this.byTarget.get(ref.exe.toLowerCase()) : undefined);
  }

  findByTarget(exe: string | null | undefined): AppInfo | undefined {
    return exe ? this.withIcon(this.byTarget.get(exe.toLowerCase())) : undefined;
  }

  findByAppId(id: string | null | undefined): AppInfo | undefined {
    return id ? this.withIcon(this.byAppId.get(id.toLowerCase())) : undefined;
  }

  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const started = Date.now();
    this.refreshing = runShellHelper('apps', this.icons.cacheDir, undefined, 60_000, ['-NoIcons'])
      .then((out) => {
        const raw = JSON.parse(out || '[]') as RawApp[] | RawApp;
        const list = Array.isArray(raw) ? raw : [raw];
        this.set(list);
        fs.writeFile(this.cacheFile, JSON.stringify(list.map(({ name, appId, target }) => ({ name, appId, target }))), () => {});
        this.ready = true;
        log.info('apps', `Indexed ${this.apps.length} applications in ${Date.now() - started} ms`);
        this.emit('change');
      })
      .catch((err) => log.error('apps', 'App enumeration failed', err))
      .finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  /** Pre-extracts every app icon in the background so launcher results never wait. */
  warmIcons() {
    for (const a of this.apps) this.icons.get(`shell:AppsFolder\\${a.appId}`);
  }

  private set(raw: RawApp[]) {
    const seen = new Set<string>();
    const apps: Entry[] = [];
    for (const r of raw) {
      if (!r || typeof r.name !== 'string' || typeof r.appId !== 'string') continue;
      if (NOISE.test(r.name)) continue;
      const target = typeof r.target === 'string' && r.target ? r.target : null;
      if ((target && DOC_EXT.test(target)) || DOC_EXT.test(r.appId)) continue;
      const key = r.appId.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      apps.push({ key, name: r.name, appId: r.appId, target });
    }
    apps.sort((a, b) => a.name.localeCompare(b.name));
    this.apps = apps;
    this.byTarget.clear();
    this.byAppId.clear();
    for (const a of apps) {
      this.byAppId.set(a.key, a);
      if (a.target && /\.exe$/i.test(a.target) && !this.byTarget.has(a.target.toLowerCase())) this.byTarget.set(a.target.toLowerCase(), a);
    }
  }
}
