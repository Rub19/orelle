// The Dock: a transparent, non-activating, always-on-top window anchored to a screen edge.
// Click-through outside the visible bar; optional AppBar space reservation; hides for fullscreen apps.
import { BrowserWindow, Menu, MenuItemConstructorOptions, dialog, ipcMain, screen, shell, type Display, type IpcMainEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { clickBehaviour, composeDock, reorderItems, sameApp, type WindowInfo } from '../../shared/dockModel';
import type { DockEntry, DockItem, DockLayout, DockPosition, Settings } from '../../shared/types';
import type { OrelleContext } from '../context';
import * as w32 from '../native/win32';
import { launchApp, openPath, openUrl, revealPath, safeLaunch } from '../services/launchService';
import { log } from '../logger';
import { makeHost } from './sharedHost';

const BAR_PAD = 8;
const EDGE_GAP = 6;
const LABEL_SPACE = 46;
const APPBAR_MSG = 0x0400 + 0x4e; // WM_USER + 'N'

export class DockController {
  private win: BrowserWindow | null = null;
  private windowsByKey = new Map<string, WindowInfo[]>();
  private entries: DockEntry[] = [];
  private launching = new Map<string, NodeJS.Timeout>();
  private pushQueued = false;
  private appBar = false;
  private appBarFailed = false;
  private userHidden = false;
  private fullscreenHidden = false;
  private hwnd = 0;

  constructor(private readonly ctx: OrelleContext) {}

  start() {
    const s = this.ctx.settings.get();
    if (!s.dock.enabled) return;
    this.create();
  }

  private create() {
    const win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      hasShadow: false,
      thickFrame: false,
      title: 'Orelle Dock',
      webPreferences: {
        preload: this.ctx.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        additionalArguments: ['--orelle-surface=dock'],
      },
    });
    this.win = win;
    this.hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE());
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.setIgnoreMouseEvents(true, { forward: true });
    // The Dock's page also hosts the top bar and widget windows (one shared renderer process).
    makeHost(win);
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('render-process-gone', (_e, details) => {
      log.error('dock', `Renderer gone (${details.reason}); reloading`);
      if (!win.isDestroyed()) setTimeout(() => !win.isDestroyed() && win.reload(), 500);
    });
    win.hookWindowMessage(APPBAR_MSG, (wParam) => {
      // ABN_POSCHANGED = 1: another bar or the taskbar moved; renegotiate.
      if (wParam.readUInt32LE(0) === 1) this.layout();
    });
    win.once('ready-to-show', () => {
      this.layout();
      this.pushLayout();
      this.pushState();
      if (!this.userHidden) win.showInactive();
    });
    win.on('closed', () => {
      this.releaseAppBar();
      this.win = null;
    });
    void win.loadFile(this.ctx.rendererFile('dock'));
  }

  destroy() {
    this.releaseAppBar();
    this.win?.destroy();
    this.win = null;
  }

  get window() {
    return this.win;
  }

  isVisible() {
    return !!this.win && this.win.isVisible();
  }

  toggleVisible() {
    if (!this.win) return this.start();
    this.userHidden = this.win.isVisible();
    if (this.userHidden) {
      this.win.hide();
      this.releaseAppBar();
    } else {
      this.win.showInactive();
      this.layout();
    }
  }

  // ---------- Settings & environment ----------

  onSettingsChanged(next: Settings, prev: Settings) {
    if (!next.dock.enabled) {
      if (this.win) this.destroy();
      return;
    }
    if (!this.win) return this.create();
    const geometryKeys: (keyof Settings['dock'])[] = ['position', 'display', 'iconSize', 'magnifiedSize', 'magnification', 'autoHide', 'reserveSpace', 'spacing'];
    if (geometryKeys.some((k) => next.dock[k] !== prev.dock[k])) this.layout();
    this.pushLayout();
    this.pushState();
  }

  onDisplaysChanged() {
    this.layout();
  }

  onFullscreenChanged(fullscreen: boolean) {
    const s = this.ctx.settings.get();
    if (!this.win || !s.dock.hideOnFullscreen || this.userHidden) return;
    if (fullscreen && !this.fullscreenHidden) {
      this.fullscreenHidden = true;
      this.win.hide();
    } else if (!fullscreen && this.fullscreenHidden) {
      this.fullscreenHidden = false;
      this.win.showInactive();
    }
  }

  private targetDisplay(): Display {
    const id = this.ctx.settings.get().dock.display;
    if (id !== 'primary') {
      const d = screen.getAllDisplays().find((x) => String(x.id) === id);
      if (d) return d;
    }
    return screen.getPrimaryDisplay();
  }

  /** Depth of the visible bar (the part that may be reserved as an AppBar), in DIP. */
  private barDepth(s: Settings) {
    return s.dock.iconSize + BAR_PAD * 2 + EDGE_GAP;
  }

  private windowDepth(s: Settings) {
    const max = s.dock.magnification ? s.dock.magnifiedSize : s.dock.iconSize;
    return EDGE_GAP + BAR_PAD * 2 + max + LABEL_SPACE;
  }

  layout() {
    const win = this.win;
    if (!win) return;
    const s = this.ctx.settings.get();
    const display = this.targetDisplay();
    const pos = s.dock.position;
    const depth = this.windowDepth(s);
    const wantAppBar = s.dock.reserveSpace && !s.dock.autoHide && !this.userHidden && w32.win32Available() && !this.appBarFailed;

    // Edge rectangle (DIP) along which the bar sits.
    let edge = { ...display.workArea };
    if (wantAppBar) {
      const granted = this.reserve(display, pos, this.barDepth(s));
      if (granted) edge = granted;
    } else {
      this.releaseAppBar();
    }

    let bounds: Electron.Rectangle;
    if (pos === 'bottom') bounds = { x: edge.x, y: edge.y + edge.height - depth, width: edge.width, height: depth };
    else if (pos === 'left') bounds = { x: edge.x, y: edge.y, width: depth, height: edge.height };
    else bounds = { x: edge.x + edge.width - depth, y: edge.y, width: depth, height: edge.height };
    win.setBounds(bounds);
    log.debug('dock', `layout ${pos} on display ${display.id}`, bounds);
  }

  /** Reserves the bar area via SHAppBarMessage and returns the edge rect (DIP) the bar should hug. */
  private reserve(display: Display, pos: DockPosition, thickness: number): Electron.Rectangle | null {
    if (!this.hwnd) return null;
    if (!this.appBar) {
      this.appBar = w32.appBarRegister(this.hwnd, APPBAR_MSG);
      if (!this.appBar) {
        this.appBarFailed = true;
        log.warn('dock', 'AppBar registration failed; space will not be reserved');
        return null;
      }
    }
    const phys = screen.dipToScreenRect(null, display.bounds);
    const t = Math.round(thickness * display.scaleFactor);
    const rc = { left: phys.x, top: phys.y, right: phys.x + phys.width, bottom: phys.y + phys.height };
    const edge = pos === 'bottom' ? w32.ABE.bottom : pos === 'left' ? w32.ABE.left : w32.ABE.right;
    if (pos === 'bottom') rc.top = rc.bottom - t;
    else if (pos === 'left') rc.right = rc.left + t;
    else rc.left = rc.right - t;
    const granted = w32.appBarSetPos(this.hwnd, edge, rc, t);
    if (!granted) return null;
    const g = screen.screenToDipRect(null, { x: granted.left, y: granted.top, width: granted.right - granted.left, height: granted.bottom - granted.top });
    // Extend the edge rect across the remaining work area so the window can host magnified icons.
    const wa = display.workArea;
    if (pos === 'bottom') return { x: g.x, y: wa.y, width: g.width, height: g.y + g.height - wa.y };
    if (pos === 'left') return { x: g.x, y: g.y, width: wa.x + wa.width - g.x, height: g.height };
    return { x: wa.x, y: g.y, width: g.x + g.width - wa.x, height: g.height };
  }

  private releaseAppBar() {
    if (this.appBar && this.hwnd) w32.appBarRemove(this.hwnd);
    this.appBar = false;
  }

  /** Last-chance cleanup from process 'exit' (synchronous FFI call; safe even if the window is gone). */
  releaseAppBarSync() {
    try { this.releaseAppBar(); } catch { /* exiting */ }
  }

  // ---------- State ----------

  // Dock icons are visible immediately, so they are extracted with priority.
  private iconForWindow(w: WindowInfo): string | null {
    const app = this.ctx.apps.entryFor({ appId: w.aumid, exe: w.exe });
    if (app) return this.ctx.apps.iconFor(app.appId, true);
    if (w.aumid) return this.ctx.icons.get(`shell:AppsFolder\\${w.aumid}`, true);
    return this.ctx.icons.get(w.exe, true);
  }

  private iconForItem(item: DockItem): string | null {
    if (item.type === 'app') {
      const app = this.ctx.apps.entryFor({ appId: item.appId, exe: item.path });
      if (app) return this.ctx.apps.iconFor(app.appId, true);
      if (item.path && fs.existsSync(item.path)) return this.ctx.icons.get(item.path, true);
      return item.appId ? this.ctx.icons.get(`shell:AppsFolder\\${item.appId}`, true) : null;
    }
    if (item.type === 'folder' || item.type === 'file') return this.ctx.icons.get(item.path, true);
    return null;
  }

  nameForWindow(w: WindowInfo): string {
    const app = this.ctx.apps.entryFor({ appId: w.aumid, exe: w.exe });
    if (app) return app.name;
    const base = path.basename(w.exe || '', '.exe');
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : w.title;
  }

  private compose() {
    const s = this.ctx.settings.get();
    const recents = this.ctx.usage.recent('app:', 12).map((r) => ({ key: r.id, name: r.title, ...(r.ref ?? {}) }));
    // Orelle's own buttons are always labelled in the current language.
    const orelleLabel = { launcher: this.ctx.t('dock.launcher'), control: this.ctx.t('control.title'), settings: this.ctx.t('dock.settings'), files: this.ctx.t('files.title'), monitor: this.ctx.t('monitor.title') };
    const composed = composeDock({
      items: s.dock.items.map((i) => (i.type === 'orelle' ? { ...i, name: orelleLabel[i.action] } : i)),
      windows: this.ctx.tracker.list(),
      foreground: this.ctx.tracker.getForeground(),
      showRunning: s.dock.showRunning,
      showMinimized: s.dock.showMinimized,
      showRecents: s.dock.showRecents,
      recentsCount: s.dock.recentsCount,
      recents,
      iconFor: ({ item, window, recent }) =>
        item ? this.iconForItem(item) : window ? this.iconForWindow(window) : recent ? this.iconForItem({ id: '', type: 'app', name: '', ...recent }) : null,
      nameFor: (w) => this.nameForWindow(w),
    });
    this.entries = composed.entries;
    this.windowsByKey = composed.windowsByKey;
    // A launch is complete as soon as the entry owns a window.
    for (const e of this.entries) {
      if (e.running && this.launching.has(e.key)) {
        clearTimeout(this.launching.get(e.key));
        this.launching.delete(e.key);
      }
    }
  }

  pushState() {
    if (this.pushQueued) return;
    this.pushQueued = true;
    setImmediate(() => {
      this.pushQueued = false;
      if (!this.win || this.win.isDestroyed()) return;
      this.compose();
      this.win.webContents.send('dock:state', { entries: this.entries, launching: [...this.launching.keys()] });
    });
  }

  pushLayout() {
    if (!this.win || this.win.isDestroyed()) return;
    const s = this.ctx.settings.get();
    const layout: DockLayout = {
      position: s.dock.position,
      iconSize: s.dock.iconSize,
      magnifiedSize: s.dock.magnifiedSize,
      magnification: s.dock.magnification && s.appearance.effects !== 'off',
      spacing: s.dock.spacing,
      autoHide: s.dock.autoHide,
      showLabels: s.dock.showLabels,
      hidden: false,
    };
    this.win.webContents.send('dock:layout', layout);
  }

  // ---------- Actions ----------

  private findItem(key: string): DockItem | undefined {
    return this.ctx.settings.get().dock.items.find((i) => i.id === key);
  }

  private markLaunching(key: string) {
    clearTimeout(this.launching.get(key));
    this.launching.set(
      key,
      setTimeout(() => {
        this.launching.delete(key);
        this.pushState();
      }, 8000),
    );
    this.pushState();
  }

  /** Resolves any entry key to something launchable. */
  private appRefFor(key: string): { appId?: string; path?: string; args?: string[]; name: string } | null {
    const item = this.findItem(key);
    if (item?.type === 'app') return item;
    if (key.startsWith('recent:')) {
      const rec = this.ctx.usage.recent('app:', 50).find((r) => `recent:${r.id}` === key);
      return rec?.ref ? { ...rec.ref, name: rec.title } : null;
    }
    const w = this.windowsByKey.get(key)?.[0];
    if (w) {
      const app = this.ctx.apps.entryFor({ appId: w.aumid, exe: w.exe });
      return app ? { appId: app.appId, path: app.target ?? undefined, name: app.name } : { path: w.exe, name: this.nameForWindow(w) };
    }
    return null;
  }

  async activate(key: string, opts: { newInstance?: boolean }) {
    const item = this.findItem(key);
    if (item?.type === 'orelle') {
      if (item.action === 'launcher') this.ctx.actions.toggleLauncher();
      else if (item.action === 'control') this.ctx.actions.toggleControlCenter();
      else if (item.action === 'files' || item.action === 'monitor') this.ctx.actions.openApp(item.action);
      else this.ctx.actions.openSettings();
      return;
    }
    if (item?.type === 'folder' || item?.type === 'file') {
      if (item.type === 'folder' && this.ctx.settings.get().files.openFoldersInOrelle && !item.path.startsWith('shell:')) this.ctx.actions.openApp('files', item.path);
      else await safeLaunch(() => openPath(item.path), item.path);
      return;
    }
    if (item?.type === 'url') {
      await safeLaunch(() => openUrl(item.url), item.url);
      return;
    }
    const wins = this.windowsByKey.get(key) ?? [];
    const behaviour = opts.newInstance ? { action: 'launch' as const } : clickBehaviour(wins, this.ctx.tracker.getForeground());
    if (behaviour.action === 'focus') {
      w32.focusWindow(behaviour.hwnd);
      return;
    }
    if (behaviour.action === 'minimize') {
      w32.minimizeWindow(behaviour.hwnd);
      return;
    }
    const ref = this.appRefFor(key);
    if (!ref) return;
    this.markLaunching(key);
    const ok = await safeLaunch(() => launchApp(ref), ref.name);
    if (ok) this.ctx.usage.record(`app:${(ref.appId ?? ref.path ?? '').toLowerCase()}`, ref.name, { appId: ref.appId, path: ref.path });
    else {
      clearTimeout(this.launching.get(key));
      this.launching.delete(key);
      this.pushState();
    }
  }

  private updateItems(items: DockItem[]) {
    this.ctx.settings.update({ dock: { items } });
  }

  pin(key: string, index?: number) {
    const ref = this.appRefFor(key);
    if (ref) this.pinRef(ref, index);
  }

  pinRef(ref: { appId?: string; path?: string; args?: string[]; name: string }, index?: number) {
    const items = [...this.ctx.settings.get().dock.items];
    if (items.some((i) => i.type === 'app' && sameApp(i, ref))) return;
    const item: DockItem = { id: randomUUID(), type: 'app', name: ref.name, appId: ref.appId, path: ref.path, args: ref.args };
    const sepIndex = items.findIndex((i) => i.type === 'separator');
    items.splice(index ?? (sepIndex === -1 ? items.length : sepIndex), 0, item);
    this.updateItems(items);
  }

  remove(key: string) {
    this.updateItems(this.ctx.settings.get().dock.items.filter((i) => i.id !== key));
  }

  reorder(ids: string[]) {
    this.updateItems(reorderItems(this.ctx.settings.get().dock.items, ids));
  }

  /** Items dropped from Explorer (files, folders, shortcuts, executables, .url files). */
  addPaths(paths: string[], index?: number) {
    const items = [...this.ctx.settings.get().dock.items];
    const added: DockItem[] = [];
    for (const p of paths.slice(0, 20)) {
      try {
        const item = this.itemFromPath(p);
        if (item) added.push(item);
      } catch (err) {
        log.warn('dock', `Cannot pin ${p}`, err);
      }
    }
    if (!added.length) return;
    items.splice(index ?? items.length, 0, ...added);
    this.updateItems(items);
  }

  private itemFromPath(p: string): DockItem | null {
    if (!path.isAbsolute(p) || !fs.existsSync(p)) return null;
    const id = randomUUID();
    const stat = fs.statSync(p);
    const name = path.basename(p).replace(/\.(lnk|exe|url)$/i, '');
    if (stat.isDirectory()) return { id, type: 'folder', name, path: p };
    const ext = path.extname(p).toLowerCase();
    if (ext === '.exe') {
      const app = this.ctx.apps.findByTarget(p);
      return { id, type: 'app', name: app?.name ?? name, appId: app?.appId, path: p };
    }
    if (ext === '.lnk') {
      const link = shell.readShortcutLink(p);
      if (link.target && /\.exe$/i.test(link.target)) {
        const app = this.ctx.apps.findByTarget(link.target);
        const args = link.args ? link.args.match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, '')) : undefined;
        return { id, type: 'app', name: app?.name ?? name, appId: args?.length ? undefined : app?.appId, path: link.target, args };
      }
      if (link.target && fs.existsSync(link.target)) return this.itemFromPath(link.target);
      return null;
    }
    if (ext === '.url') {
      const m = /^URL=(https?:\/\/.+)$/im.exec(fs.readFileSync(p, 'utf8'));
      return m ? { id, type: 'url', name, url: m[1].trim() } : null;
    }
    return { id, type: 'file', name, path: p };
  }

  // ---------- Context menus ----------

  showContextMenu(key: string | null) {
    const t = this.ctx.t;
    const s = this.ctx.settings.get();
    const template: MenuItemConstructorOptions[] = [];
    const entry = key ? this.entries.find((e) => e.key === key) : undefined;
    const item = key ? this.findItem(key) : undefined;

    if (entry && entry.kind !== 'separator') {
      const wins = this.windowsByKey.get(entry.key) ?? [];
      if (wins.length) {
        template.push({ label: t('dock.windows'), enabled: false });
        for (const w of wins.slice(0, 12)) {
          template.push({ label: (w.minimized ? '◦ ' : '') + truncate(w.title, 60), click: () => w32.focusWindow(w.hwnd) });
        }
        template.push({ type: 'separator' });
      }
      if (entry.kind === 'app') {
        template.push({ label: wins.length ? t('dock.newWindow') : t('dock.open'), click: () => void this.activate(entry.key, { newInstance: true }) });
      } else if (item?.type !== 'orelle') {
        template.push({ label: t('dock.open'), click: () => void this.activate(entry.key, {}) });
      }
      const ref = this.appRefFor(entry.key);
      const fsPath = item && 'path' in item ? item.path : ref?.path;
      if (fsPath && path.isAbsolute(fsPath)) template.push({ label: t('dock.showInExplorer'), click: () => revealPath(fsPath) });
      template.push({ type: 'separator' });
      if (entry.section === 'pinned') template.push({ label: t('dock.remove'), click: () => this.remove(entry.key) });
      else if (entry.section !== 'minimized') template.push({ label: t('dock.keep'), click: () => this.pin(entry.key) });
      if (wins.length) {
        template.push({ type: 'separator' });
        template.push({
          label: wins.length > 1 ? t('dock.quitAll', { n: wins.length }) : t('dock.quit'),
          click: () => wins.forEach((w) => w32.closeWindow(w.hwnd)),
        });
      }
    } else {
      if (entry?.kind === 'separator') template.push({ label: t('dock.remove'), click: () => this.remove(entry.key) }, { type: 'separator' });
      template.push(
        { label: s.dock.autoHide ? t('dock.autoHideOff') : t('dock.autoHideOn'), click: () => this.ctx.settings.update({ dock: { autoHide: !s.dock.autoHide } }) },
        {
          label: t('dock.position'),
          submenu: (['bottom', 'left', 'right'] as const).map((p) => ({
            label: t(`settings.dock.position.${p}`),
            type: 'radio' as const,
            checked: s.dock.position === p,
            click: () => this.ctx.settings.update({ dock: { position: p } }),
          })),
        },
        { type: 'separator' },
        { label: t('dock.addApp'), click: () => this.ctx.actions.openSettings('dock') },
        { label: t('dock.addFolder'), click: () => void this.pickAndAdd('openDirectory') },
        { label: t('dock.addFile'), click: () => void this.pickAndAdd('openFile') },
        { label: t('dock.addSeparator'), click: () => this.updateItems([...s.dock.items, { id: randomUUID(), type: 'separator' }]) },
        { type: 'separator' },
        { label: t('dock.prefs'), click: () => this.ctx.actions.openSettings('dock') },
      );
    }
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: this.win ?? undefined });
  }

  private async pickAndAdd(kind: 'openDirectory' | 'openFile') {
    const res = await dialog.showOpenDialog({ properties: [kind, 'multiSelections'] });
    if (!res.canceled) this.addPaths(res.filePaths);
  }

  // ---------- IPC ----------

  registerIpc() {
    const fromDock = (e: IpcMainEvent | Electron.IpcMainInvokeEvent) => !!this.win && e.sender === this.win.webContents;
    ipcMain.on('dock:interactive', (e, on: boolean) => {
      if (fromDock(e)) this.win!.setIgnoreMouseEvents(!on, { forward: true });
    });
    ipcMain.on('dock:activate', (e, key: string, opts: { newInstance?: boolean; anchor?: { x: number; y: number; width: number; height: number } }) => {
      if (!fromDock(e) || typeof key !== 'string') return;
      // Folders: a stack above the icon (Shift+click opens the folder itself).
      const item = this.ctx.settings.get().dock.items.find((i) => i.id === key);
      const a = opts?.anchor;
      if (item?.type === 'folder' && !item.path.startsWith('shell:') && !opts?.newInstance && this.ctx.settings.get().dock.folderStacks && a && this.win && [a.x, a.y, a.width, a.height].every(Number.isFinite)) {
        const b = this.win.getBounds();
        this.ctx.actions.openStack?.(item.path, { x: Math.round(b.x + a.x), y: Math.round(b.y + a.y), width: Math.round(a.width), height: Math.round(a.height) });
        return;
      }
      void this.activate(key, { newInstance: !!opts?.newInstance });
    });
    ipcMain.on('dock:context', (e, key: string | null) => {
      if (fromDock(e)) this.showContextMenu(typeof key === 'string' ? key : null);
    });
    ipcMain.on('dock:reorder', (e, ids: unknown) => {
      if (fromDock(e) && Array.isArray(ids)) this.reorder(ids.filter((x): x is string => typeof x === 'string'));
    });
    ipcMain.on('dock:remove', (e, key: string) => {
      if (fromDock(e) && typeof key === 'string') this.remove(key);
    });
    ipcMain.on('dock:pin', (e, key: string, index?: number) => {
      if (fromDock(e) && typeof key === 'string') this.pin(key, typeof index === 'number' ? index : undefined);
    });
    ipcMain.on('dock:addPaths', (e, paths: unknown, index?: number) => {
      if (fromDock(e) && Array.isArray(paths)) this.addPaths(paths.filter((x): x is string => typeof x === 'string'), typeof index === 'number' ? index : undefined);
    });
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
