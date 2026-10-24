// Window management: snapping the foreground window to halves, quarters and thirds of its
// monitor's work area, and saving / restoring window layouts. Everything goes through the
// documented Win32 window APIs (SetWindowPos, ShowWindow) on windows the user already has open.
import { randomUUID } from 'node:crypto';
import { fuzzyScore } from '../../shared/fuzzy';
import type { StringKey } from '../../shared/i18n';
import type { SavedLayout, SavedWindow, SearchResult } from '../../shared/types';
import type { OrelleContext } from '../context';
import * as w32 from '../native/win32';
import { SNAP_HOTKEYS, SNAP_TARGETS, snapRect, type SnapTarget } from '../../shared/windowGeometry';
import { launchApp } from './launchService';
import type { SearchPlugin } from './searchService';
import { log } from '../logger';

export { SNAP_HOTKEYS, SNAP_TARGETS, snapRect, type SnapTarget } from '../../shared/windowGeometry';

export class WindowService implements SearchPlugin {
  readonly prefix = 'layout';
  /** The window that was in front when the launcher opened (the launcher itself takes focus). */
  private lastTarget: number | null = null;

  constructor(private readonly ctx: OrelleContext) {
    ctx.tracker.on('foreground', (h: number | null) => {
      if (h && w32.getWindowPid(h) !== process.pid) this.lastTarget = h;
    });
  }

  /** The window the user is working in (never one of Orelle's own). */
  target(): number | null {
    const fg = this.ctx.tracker.getForeground();
    const h = fg && w32.getWindowPid(fg) !== process.pid ? fg : this.lastTarget;
    return h && this.ctx.tracker.list().some((w) => w.hwnd === h) ? h : null;
  }

  snap(target: SnapTarget, hwnd = this.target()): boolean {
    if (!hwnd) return false;
    if (target === 'minimize') return w32.minimizeWindow(hwnd);
    if (target === 'close') return w32.closeWindow(hwnd);
    if (target === 'maximize') {
      w32.maximizeWindow(hwnd);
      return true;
    }
    const wa = w32.getMonitorWorkArea(hwnd);
    if (!wa) return false;
    return w32.placeWindow(hwnd, snapRect(wa, target, w32.getVisibleRect(hwnd) ?? undefined));
  }

  /** Captures every visible, non-minimized app window. */
  capture(name: string): SavedLayout {
    const windows: SavedWindow[] = [];
    for (const w of this.ctx.tracker.list()) {
      if (w.minimized) continue;
      const r = w32.getVisibleRect(w.hwnd);
      const app = (w.aumid ?? w.exe).toLowerCase();
      if (!r || !app) continue;
      windows.push({ app, title: w.title.slice(0, 260), x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top, maximized: w32.isZoomed(w.hwnd) });
    }
    return { id: randomUUID(), name: name.slice(0, 80) || 'Layout', createdAt: Date.now(), windows };
  }

  saveCurrent(name: string): SavedLayout {
    const layout = this.capture(name);
    const layouts = [layout, ...this.ctx.settings.get().windows.layouts].slice(0, 30);
    this.ctx.settings.update({ windows: { layouts } });
    log.info('windows', `Layout saved: ${layout.name} (${layout.windows.length} windows)`);
    return layout;
  }

  /**
   * Puts open windows back where the layout says. Apps from the layout that are not running are
   * launched (from the app index only) and placed once their window appears.
   */
  async restore(id: string, launchMissing = true): Promise<number> {
    const layout = this.ctx.settings.get().windows.layouts.find((l) => l.id === id);
    if (!layout) return 0;
    const used = new Set<number>();
    const pending: SavedWindow[] = [];
    let placed = 0;
    const place = (sw: SavedWindow) => {
      const candidates = this.ctx.tracker.list().filter((w) => !used.has(w.hwnd) && (w.aumid ?? w.exe).toLowerCase() === sw.app);
      const w = candidates.find((c) => c.title === sw.title) ?? candidates[0];
      if (!w) return false;
      used.add(w.hwnd);
      w32.placeWindow(w.hwnd, { left: sw.x, top: sw.y, right: sw.x + sw.w, bottom: sw.y + sw.h });
      if (sw.maximized) w32.maximizeWindow(w.hwnd);
      placed++;
      return true;
    };
    for (const sw of layout.windows) if (!place(sw)) pending.push(sw);
    if (launchMissing && pending.length) {
      const launched = new Set<string>();
      for (const sw of pending) {
        if (launched.has(sw.app)) continue;
        const entry = this.ctx.apps.entryFor(sw.app.includes('\\') ? { exe: sw.app } : { appId: sw.app });
        if (!entry) continue;
        launched.add(sw.app);
        try { await launchApp({ appId: entry.appId, path: entry.target ?? undefined }); } catch (err) { log.warn('windows', `Cannot launch ${entry.name}`, err); }
      }
      // Windows appear asynchronously: retry placement for a few seconds.
      for (let i = 0; i < 16 && pending.length; i++) {
        await new Promise((r) => setTimeout(r, 500));
        this.ctx.tracker.refresh();
        for (let j = pending.length - 1; j >= 0; j--) if (place(pending[j])) pending.splice(j, 1);
      }
    }
    log.info('windows', `Layout ${layout.name} restored: ${placed}/${layout.windows.length}`);
    return placed;
  }

  removeLayout(id: string) {
    this.ctx.settings.update({ windows: { layouts: this.ctx.settings.get().windows.layouts.filter((l) => l.id !== id) } });
  }

  // ---------- Launcher ----------

  search(q: string): SearchResult[] {
    const t = this.ctx.t;
    const out: SearchResult[] = [];
    const word = t('launcher.kind.layout');
    for (const l of this.ctx.settings.get().windows.layouts) {
      const score = Math.max(fuzzyScore(q, l.name), fuzzyScore(q, `${word} ${l.name}`) * 0.9) * 0.88;
      if (score > 0.45) out.push({ id: `layout:${l.id}`, kind: 'layout', title: t('windows.restoreNamed', { name: l.name }), subtitle: t('windows.count', { n: l.windows.length }), glyph: 'grid', score, action: t('launcher.run') });
    }
    const save = t('windows.saveCurrent');
    const sScore = Math.max(fuzzyScore(q, save), fuzzyScore(q, word)) * 0.75;
    if (sScore > 0.45) out.push({ id: 'layout:@save', kind: 'layout', title: save, subtitle: t('windows.saveHint'), glyph: 'plus', score: sScore, action: t('launcher.run') });
    if (this.ctx.settings.get().windows.snapping) {
      for (const target of SNAP_TARGETS) {
        if (target === 'minimize' || target === 'close') continue;
        const title = t(`windows.snap.${target}` as StringKey);
        const score = Math.max(fuzzyScore(q, title), fuzzyScore(q, `${t('windows.snapWord')} ${title}`) * 0.9) * 0.7;
        if (score > 0.5) out.push({ id: `layout:@snap:${target}`, kind: 'layout', title, subtitle: SNAP_HOTKEYS[target] ?? t('windows.snapWord'), glyph: 'window', score, action: t('launcher.run') });
      }
    }
    return out;
  }

  async execute(rest: string): Promise<boolean> {
    if (rest === '@save') {
      const l = this.saveCurrent(new Date().toLocaleString(this.ctx.language === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }));
      this.ctx.actions.notify?.({ title: this.ctx.t('windows.saved'), body: this.ctx.t('windows.count', { n: l.windows.length }), source: 'windows', glyph: 'grid' });
      return true;
    }
    if (rest.startsWith('@snap:')) {
      // Let the launcher hide first so the target window is in front again.
      setTimeout(() => this.snap(rest.slice(6) as SnapTarget), 120);
      return true;
    }
    void this.restore(rest, true);
    return true;
  }
}
