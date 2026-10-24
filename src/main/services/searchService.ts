// Launcher search: providers produce scored results; ids are self-describing so favorites and
// history can be re-resolved and executed later without re-running the search.
import { clipboard, dialog, nativeImage } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { evaluate, formatNumber, looksLikeMath } from '../../shared/calc';
import { fuzzyScore } from '../../shared/fuzzy';
import type { StringKey } from '../../shared/i18n';
import type { ResultPreview, SearchResponse, SearchResult } from '../../shared/types';
import { convert } from '../../shared/units';
import { WINDOWS_SETTINGS } from '../../shared/windowsSettings';
import type { OrelleContext } from '../context';
import * as w32 from '../native/win32';
import { log } from '../logger';
import type { ClipboardHistory } from './clipboardHistory';
import type { FileIndex } from './fileIndex';
import type { ScriptService } from './scriptService';
import { launchApp, openPath, openUrl, revealPath, safeLaunch } from './launchService';

type SystemAction = 'lock' | 'sleep' | 'restart' | 'shutdown' | 'signout' | 'recycle';

const SYSTEM_ACTIONS: { id: SystemAction; key: StringKey; keywords: string; confirm: boolean; glyph: string }[] = [
  { id: 'lock', key: 'system.lock', keywords: 'verrouiller lock session ecran', confirm: false, glyph: 'lock' },
  { id: 'sleep', key: 'system.sleep', keywords: 'veille sleep suspend', confirm: true, glyph: 'moon' },
  { id: 'restart', key: 'system.restart', keywords: 'redemarrer restart reboot', confirm: true, glyph: 'restart' },
  { id: 'shutdown', key: 'system.shutdown', keywords: 'arreter eteindre shutdown power off', confirm: true, glyph: 'power' },
  { id: 'signout', key: 'system.signout', keywords: 'deconnecter sign out logout log off', confirm: true, glyph: 'logout' },
  { id: 'recycle', key: 'system.recycle', keywords: 'corbeille recycle bin trash', confirm: false, glyph: 'trash' },
];

const ORELLE_ACTIONS: { id: string; key: StringKey; keywords: string; glyph: string }[] = [
  { id: 'settings', key: 'dock.settings', keywords: 'orelle preferences parametres settings reglages', glyph: 'settings' },
  { id: 'toggleDock', key: 'tray.toggleDock', keywords: 'orelle dock afficher masquer show hide', glyph: 'dock' },
  { id: 'reindex', key: 'settings.about.reindex', keywords: 'orelle reindexer reindex applications', glyph: 'refresh' },
  { id: 'control', key: 'control.title', keywords: 'orelle centre controle control center volume luminosite brightness wifi', glyph: 'sliders' },
  { id: 'widgets', key: 'widgets.edit', keywords: 'orelle widgets bureau desktop modifier edit', glyph: 'grid' },
  { id: 'files', key: 'files.title', keywords: 'orelle fichiers files explorateur explorer finder dossiers folders', glyph: 'folder' },
  { id: 'monitor', key: 'monitor.title', keywords: 'orelle moniteur activite gestionnaire des taches task manager processus process cpu ram', glyph: 'chart' },
];

const URL_RE = /^(https?:\/\/)?(localhost(:\d+)?|[\w-]+(\.[\w-]+)*\.[a-z]{2,})(:\d+)?(\/\S*)?$/i;
const SHUTDOWN = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'shutdown.exe');

/** A source of launcher results owned by another service (extensions, profiles, layouts, AI). */
export interface SearchPlugin {
  /** Id prefix of its results: `<prefix>:<rest>`. */
  prefix: string;
  search(q: string): SearchResult[];
  execute(rest: string, mode: 'primary' | 'alt'): Promise<boolean> | boolean;
  resolve?(rest: string): SearchResult | null;
}

export class SearchService {
  private plugins: SearchPlugin[] = [];

  register(plugin: SearchPlugin) {
    this.plugins.push(plugin);
  }

  constructor(
    private readonly ctx: OrelleContext,
    private readonly files: FileIndex,
    private readonly clip: ClipboardHistory,
    private readonly scripts: ScriptService,
  ) {}

  private get t() {
    return this.ctx.t;
  }

  private numberLocale() {
    return this.ctx.language === 'fr' ? 'fr-FR' : 'en-US';
  }

  search(rawQuery: string): SearchResponse {
    const query = rawQuery.slice(0, 256);
    const q = query.trim();
    const s = this.ctx.settings.get().launcher;
    const p = s.providers;
    const favorites = new Set(s.favorites);
    const out: SearchResult[] = [];

    if (!q) return { query, results: this.emptyState(favorites) };

    const add = (r: SearchResult | null) => {
      if (!r || r.score <= 0) return;
      r.score += this.ctx.usage.boost(usageKey(r.id)) + (favorites.has(r.id) ? 0.08 : 0);
      r.favorite = favorites.has(r.id);
      out.push(r);
    };

    // Instant answers first.
    if (p.units) {
      const c = convert(q);
      if (c) {
        const loc = this.numberLocale();
        const res = `${formatNumber(c.result, loc, 4)} ${c.to}`;
        add({ id: `unit:${q}`, kind: 'unit', title: res, subtitle: `${formatNumber(c.value, loc)} ${c.from}`, glyph: 'ruler', score: 2, action: this.t('launcher.copyResult'), preview: { title: this.t('launcher.kind.unit'), large: res, lines: [{ label: this.t('launcher.preview.expression'), value: q }] } });
      }
    }
    if (p.calculator && looksLikeMath(q)) {
      const v = evaluate(q.replace(/=\s*$/, ''));
      if (v !== null) {
        const res = formatNumber(v, this.numberLocale());
        add({ id: `calc:${q}`, kind: 'calc', title: res, subtitle: `${q} =`, glyph: 'calc', score: 2, action: this.t('launcher.copyResult'), preview: { title: this.t('launcher.kind.calc'), large: res, lines: [{ label: this.t('launcher.preview.expression'), value: q }] } });
      }
    }

    // Custom commands: "<keyword> <query>".
    if (p.commands) {
      const [kw, ...rest] = q.split(/\s+/);
      for (const c of s.customCommands) {
        if (c.keyword === kw.toLowerCase()) {
          const arg = rest.join(' ');
          add({ id: `cmd:${c.id}:${arg}`, kind: 'command', title: arg ? `${c.name} — ${arg}` : c.name, subtitle: c.kind === 'url' ? c.target.replace('{query}', encodeURIComponent(arg)) : c.target, glyph: 'command', score: 1.6, action: this.t('launcher.run') });
        } else {
          add({ id: `cmd:${c.id}:`, kind: 'command', title: c.name, subtitle: `${c.keyword} …`, glyph: 'command', score: Math.max(fuzzyScore(q, c.name), fuzzyScore(q, c.keyword)) * 0.8, action: this.t('launcher.run') });
        }
      }
      // Allowed scripts, by keyword or name.
      for (const sc of s.scripts) {
        const score = sc.keyword === kw.toLowerCase() ? 1.6 : Math.max(fuzzyScore(q, sc.name), fuzzyScore(q, sc.keyword)) * 0.85;
        add({ id: `script:${sc.id}`, kind: 'command', title: sc.name, subtitle: `${sc.keyword} · ${sc.path}`, glyph: 'command', score, action: this.t('launcher.run'), altAction: this.t('launcher.reveal') });
      }
    }

    if (p.apps) {
      for (const a of this.ctx.apps.entries()) {
        const score = fuzzyScore(q, a.name);
        if (score > 0.3) add({ id: `app:${a.appId}`, kind: 'app', title: a.name, subtitle: this.t('launcher.kind.app'), score, action: this.t('launcher.launch'), altAction: a.target ? this.t('launcher.reveal') : undefined });
      }
    }

    if (p.windows) {
      for (const w of this.ctx.tracker.list()) {
        const score = Math.max(fuzzyScore(q, w.title), fuzzyScore(q, path.basename(w.exe, '.exe')) * 0.9) * 0.92;
        if (score > 0.35) {
          const app = this.ctx.apps.findByAppId(w.aumid) ?? this.ctx.apps.findByTarget(w.exe);
          add({ id: `win:${w.hwnd}`, kind: 'window', title: w.title, subtitle: `${this.t('launcher.kind.window')} · ${app?.name ?? path.basename(w.exe)}`, icon: app?.icon ?? null, glyph: 'window', score, action: this.t('launcher.switch') });
        }
      }
    }

    if (p.settings) {
      const lang = this.ctx.language;
      for (const st of WINDOWS_SETTINGS) {
        const title = lang === 'fr' ? st.fr : st.en;
        const score = Math.max(fuzzyScore(q, title), fuzzyScore(q, lang === 'fr' ? st.en : st.fr) * 0.9, fuzzyScore(q, st.keywords) * 0.75) * 0.88;
        if (score > 0.35) add({ id: `set:${st.uri}`, kind: 'setting', title, subtitle: this.t('launcher.kind.setting'), glyph: 'settings', score, action: this.t('launcher.open') });
      }
    }

    if (p.system) {
      for (const a of SYSTEM_ACTIONS) {
        const title = this.t(a.key);
        const score = Math.max(fuzzyScore(q, title), fuzzyScore(q, a.keywords) * 0.8) * 0.85;
        if (score > 0.4) add({ id: `sys:${a.id}`, kind: 'system', title, subtitle: this.t('launcher.kind.system'), glyph: a.glyph, score, action: this.t('launcher.run') });
      }
      for (const a of ORELLE_ACTIONS) {
        const title = this.t(a.key);
        const score = Math.max(fuzzyScore(q, title), fuzzyScore(q, a.keywords) * 0.8) * 0.8;
        if (score > 0.4) add({ id: `orelle:${a.id}`, kind: 'orelle', title, subtitle: 'Orelle', glyph: a.glyph, score, action: this.t('launcher.run') });
      }
    }

    if (p.files && q.length >= 2) {
      if (!this.files.ready) void this.files.build();
      const seen = new Set<string>();
      for (const f of this.files.recent(40)) {
        const score = fuzzyScore(q, f.name) * 0.82;
        if (score > 0.4) { seen.add(f.path.toLowerCase()); add(this.fileResult(f.path, f.dir, score + 0.04)); }
      }
      for (const f of this.files.candidates(q)) {
        if (seen.has(f.path.toLowerCase())) continue;
        const score = fuzzyScore(q, f.name) * (f.dir ? 0.78 : 0.74);
        if (score > 0.4) add(this.fileResult(f.path, f.dir, score));
      }
    }

    if (p.clipboard && this.clip.enabled && /^(clip|cb|presse)/i.test(q)) {
      const rest = q.replace(/^\S+\s*/, '');
      this.clip.list().forEach((c, i) => {
        if (rest && !c.text.toLowerCase().includes(rest.toLowerCase())) return;
        add({ id: `clip:${i}`, kind: 'clipboard', title: c.text.replace(/\s+/g, ' ').slice(0, 120), subtitle: new Date(c.at).toLocaleTimeString(this.numberLocale()), glyph: 'clipboard', score: 1.5 - i * 0.01, action: this.t('launcher.copy'), preview: { title: this.t('launcher.kind.clipboard'), lines: [], large: c.text.slice(0, 2000) } });
      });
    }

    if (URL_RE.test(q) && !/\s/.test(q)) {
      const url = /^https?:\/\//i.test(q) ? q : `https://${q}`;
      add({ id: `url:${url}`, kind: 'url', title: this.t('launcher.openUrl', { url: q }), subtitle: url, glyph: 'globe', score: 1.4, action: this.t('launcher.open') });
    }

    for (const plugin of this.plugins) {
      try {
        for (const r of plugin.search(q)) add(r);
      } catch (err) {
        log.warn('search', `${plugin.prefix} search failed`, err);
      }
    }

    out.sort((a, b) => b.score - a.score);
    const max = s.maxResults;
    const results = out.slice(0, max);
    // Icons are resolved only for what is displayed (missing ones are extracted, then the UI refreshes).
    for (const r of results) if (r.kind === 'app' && r.icon === undefined) r.icon = this.ctx.apps.iconFor(r.id.slice(4));
    if (p.web) {
      results.push({ id: `web:${q}`, kind: 'web', title: this.t('launcher.webSearch', { q }), subtitle: new URL(s.webSearchUrl.replace('{query}', '')).hostname, glyph: 'search', score: 0, action: this.t('launcher.search') });
    }
    return { query, results };
  }

  private fileResult(p: string, dir: boolean, score: number): SearchResult {
    return {
      id: `file:${p}`,
      kind: dir ? 'folder' : 'file',
      title: path.basename(p) || p,
      subtitle: path.dirname(p),
      icon: this.ctx.icons.get(p),
      score,
      action: this.t('launcher.open'),
      altAction: this.t('launcher.reveal'),
    };
  }

  /** Favorites, then recently opened items. */
  private emptyState(favorites: Set<string>): SearchResult[] {
    const out: SearchResult[] = [];
    for (const id of favorites) {
      const r = this.resolve(id);
      if (r) out.push({ ...r, favorite: true, score: 3 });
    }
    if (this.ctx.settings.get().privacy.searchHistory) {
      for (const rec of this.ctx.usage.recent('', 30)) {
        if (favorites.has(rec.id) || !/^(app|file|set|sys|orelle|url|cmd|ext|profile|layout):/.test(rec.id)) continue;
        const r = this.resolve(rec.id);
        if (r && !out.some((o) => o.id === r.id)) out.push({ ...r, score: 1 });
        if (out.length >= this.ctx.settings.get().launcher.maxResults + favorites.size) break;
      }
    }
    return out;
  }

  /** Rebuilds a result from its id (favorites / history). */
  resolve(id: string): SearchResult | null {
    const [kind, ...restParts] = id.split(':');
    const rest = restParts.join(':');
    switch (kind) {
      case 'app': {
        const a = this.ctx.apps.findByAppId(rest) ?? this.ctx.apps.findByTarget(rest);
        return a ? { id: `app:${a.appId}`, kind: 'app', title: a.name, subtitle: this.t('launcher.kind.app'), icon: a.icon, score: 0, action: this.t('launcher.launch'), altAction: a.target ? this.t('launcher.reveal') : undefined } : null;
      }
      case 'file': {
        if (!fs.existsSync(rest)) return null;
        return this.fileResult(rest, fs.statSync(rest).isDirectory(), 0);
      }
      case 'set': {
        const st = WINDOWS_SETTINGS.find((x) => x.uri === rest);
        return st ? { id, kind: 'setting', title: this.ctx.language === 'fr' ? st.fr : st.en, subtitle: this.t('launcher.kind.setting'), glyph: 'settings', score: 0, action: this.t('launcher.open') } : null;
      }
      case 'sys': {
        const a = SYSTEM_ACTIONS.find((x) => x.id === rest);
        return a ? { id, kind: 'system', title: this.t(a.key), subtitle: this.t('launcher.kind.system'), glyph: a.glyph, score: 0, action: this.t('launcher.run') } : null;
      }
      case 'orelle': {
        const a = ORELLE_ACTIONS.find((x) => x.id === rest);
        return a ? { id, kind: 'orelle', title: this.t(a.key), subtitle: 'Orelle', glyph: a.glyph, score: 0, action: this.t('launcher.run') } : null;
      }
      case 'url':
        return /^https?:\/\//i.test(rest) ? { id, kind: 'url', title: rest.replace(/^https?:\/\//i, ''), subtitle: rest, glyph: 'globe', score: 0, action: this.t('launcher.open') } : null;
      case 'cmd': {
        const [cid, ...arg] = rest.split(':');
        const c = this.ctx.settings.get().launcher.customCommands.find((x) => x.id === cid);
        const a = arg.join(':');
        return c ? { id, kind: 'command', title: a ? `${c.name} — ${a}` : c.name, subtitle: `${c.keyword} …`, glyph: 'command', score: 0, action: this.t('launcher.run') } : null;
      }
      default:
        return this.plugins.find((p) => p.prefix === kind)?.resolve?.(rest) ?? null;
    }
  }

  async preview(id: string): Promise<ResultPreview | null> {
    const [kind, ...restParts] = id.split(':');
    const rest = restParts.join(':');
    try {
      if (kind === 'file' && fs.existsSync(rest)) {
        const st = await fs.promises.stat(rest);
        let thumbnail: string | null = null;
        try {
          const img = await nativeImage.createThumbnailFromPath(rest, { width: 320, height: 320 });
          if (!img.isEmpty()) thumbnail = img.toDataURL();
        } catch { /* no thumbnail handler */ }
        const lines = [{ label: this.t('launcher.preview.path'), value: path.dirname(rest) }];
        if (!st.isDirectory()) lines.push({ label: this.t('launcher.preview.size'), value: humanSize(st.size, this.ctx.language) });
        lines.push({ label: this.t('launcher.preview.modified'), value: st.mtime.toLocaleString(this.numberLocale()) });
        return { title: path.basename(rest), thumbnail, lines };
      }
      if (kind === 'app') {
        const a = this.ctx.apps.findByAppId(rest);
        if (!a) return null;
        return { title: a.name, thumbnail: a.icon, lines: [{ label: this.t('launcher.preview.path'), value: a.target ?? a.appId }] };
      }
      if (kind === 'win') {
        const w = this.ctx.tracker.list().find((x) => x.hwnd === Number(rest));
        if (!w) return null;
        return { title: w.title, lines: [{ label: this.t('launcher.preview.process'), value: w.exe }] };
      }
    } catch (err) {
      log.debug('search', 'preview failed', err);
    }
    return null;
  }

  /** Executes a result. Returns true when the launcher should close. */
  async execute(id: string, mode: 'primary' | 'alt'): Promise<boolean> {
    const [kind, ...restParts] = id.split(':');
    const rest = restParts.join(':');
    const record = (title: string, ref?: { appId?: string; path?: string }) => {
      if (this.ctx.settings.get().privacy.searchHistory) this.ctx.usage.record(id, title, ref);
    };

    switch (kind) {
      case 'app': {
        const a = this.ctx.apps.findByAppId(rest);
        if (!a) return false;
        if (mode === 'alt' && a.target) { revealPath(a.target); return true; }
        const ok = await safeLaunch(() => launchApp({ appId: a.appId, path: a.target ?? undefined }), a.name);
        // Same key as the Dock, so launches from either place feed ranking and "recent apps".
        if (ok) this.ctx.usage.record(usageKey(id), a.name, { appId: a.appId, path: a.target ?? undefined });
        return ok;
      }
      case 'win':
        return w32.focusWindow(Number(rest)) || true;
      case 'file':
        if (mode === 'alt') { revealPath(rest); return true; }
        record(path.basename(rest));
        if (this.ctx.settings.get().files.openFoldersInOrelle && fs.existsSync(rest) && fs.statSync(rest).isDirectory()) {
          this.ctx.actions.openApp('files', rest);
          return true;
        }
        return safeLaunch(() => openPath(rest), rest);
      case 'set':
        record(rest);
        return safeLaunch(() => openUrl(rest), rest);
      case 'url':
        record(rest);
        return safeLaunch(() => openUrl(rest), rest);
      case 'web': {
        const url = this.ctx.settings.get().launcher.webSearchUrl.replace('{query}', encodeURIComponent(rest));
        return safeLaunch(() => openUrl(url), url);
      }
      case 'calc':
      case 'unit': {
        const v = kind === 'calc' ? evaluate(rest.replace(/=\s*$/, '')) : convert(rest)?.result ?? null;
        if (v !== null) await clipboard.writeText(v.toLocaleString(this.numberLocale(), { useGrouping: false, maximumFractionDigits: 10 }));
        return true;
      }
      case 'cmd': {
        const [cid, ...arg] = rest.split(':');
        const c = this.ctx.settings.get().launcher.customCommands.find((x) => x.id === cid);
        if (!c) return false;
        record(c.name);
        if (c.kind === 'url') return safeLaunch(() => openUrl(c.target.replace('{query}', encodeURIComponent(arg.join(':')))), c.target);
        return safeLaunch(() => openPath(c.target), c.target);
      }
      case 'script': {
        const sc = this.ctx.settings.get().launcher.scripts.find((x) => x.id === rest);
        if (!sc) return false;
        if (mode === 'alt') { revealPath(sc.path); return true; }
        record(sc.name);
        return this.scripts.run(sc);
      }
      case 'clip': {
        const item = this.clip.list()[Number(rest)];
        if (item) await clipboard.writeText(item.text);
        return true;
      }
      case 'sys':
        return this.runSystem(rest as SystemAction);
      case 'orelle':
        record(rest);
        if (rest === 'settings') this.ctx.actions.openSettings();
        else if (rest === 'toggleDock') this.ctx.actions.toggleDock();
        else if (rest === 'reindex') void this.ctx.apps.refresh();
        else if (rest === 'control') this.ctx.actions.toggleControlCenter();
        else if (rest === 'widgets') this.ctx.actions.editWidgets();
        else if (rest === 'files' || rest === 'monitor') this.ctx.actions.openApp(rest);
        return true;
      default: {
        const plugin = this.plugins.find((p) => p.prefix === kind);
        return plugin ? plugin.execute(rest, mode) : false;
      }
    }
  }

  /** Lock, sleep, restart… with the same confirmation as from the launcher (used by the Orelle menu). */
  system(action: string) {
    return SYSTEM_ACTIONS.some((a) => a.id === action) ? this.runSystem(action as SystemAction) : Promise.resolve(false);
  }

  private async runSystem(action: SystemAction): Promise<boolean> {
    const def = SYSTEM_ACTIONS.find((a) => a.id === action);
    if (!def) return false;
    if (def.confirm) {
      const label = this.t(def.key);
      const res = await dialog.showMessageBox({
        type: 'question',
        title: this.t('system.confirmTitle'),
        message: this.t('system.confirm', { action: label.toLowerCase() }),
        buttons: [label, this.t('system.cancel')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (res.response !== 0) return true;
    }
    this.ctx.usage.record(`sys:${action}`, this.t(def.key));
    log.info('system', `System action: ${action}`);
    switch (action) {
      case 'lock': return w32.lockWorkstation();
      case 'sleep': return w32.suspend();
      case 'recycle': return safeLaunch(() => openPath('shell:RecycleBinFolder'), 'recycle bin');
      // Fixed argument lists only; nothing user-provided reaches the command line.
      case 'restart': spawn(SHUTDOWN, ['/r', '/t', '0'], { detached: true, stdio: 'ignore' }).unref(); return true;
      case 'shutdown': spawn(SHUTDOWN, ['/s', '/t', '0'], { detached: true, stdio: 'ignore' }).unref(); return true;
      case 'signout': spawn(SHUTDOWN, ['/l'], { detached: true, stdio: 'ignore' }).unref(); return true;
    }
  }
}

/** App usage is keyed case-insensitively (the Dock and the launcher may spell an id differently). */
function usageKey(id: string) {
  return id.startsWith('app:') ? id.toLowerCase() : id;
}

function humanSize(n: number, lang: 'fr' | 'en') {
  const units = lang === 'fr' ? ['o', 'Ko', 'Mo', 'Go', 'To'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}
