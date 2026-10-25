// Mission Control: a full-screen overview of open windows with live DWM thumbnails, search,
// keyboard navigation and grouping by app. The renderer lays the cards out and reports where each
// thumbnail goes; DWM draws the live content there. Windows does not expose a public API to switch
// or create virtual desktops, so this covers the windows of the current desktop only.
import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { OrelleContext } from '../context';
import * as dwm from '../native/dwm';
import * as w32 from '../native/win32';
import { log } from '../logger';
import type { DesktopService } from '../services/desktopService';
import { panelTiming } from './panelWindow';

export interface MissionWindow {
  hwnd: number;
  title: string;
  app: string;
  icon: string | null;
  minimized: boolean;
  aspect: number;
  active: boolean;
}

export class MissionControlController {
  private win: BrowserWindow | null = null;
  private hwnd = 0;
  private thumbs = new Map<number, number>();
  private scale = 1;
  private shownAt = 0;
  private releaseTimer: NodeJS.Timeout | null = null;

  constructor(private readonly ctx: OrelleContext, private readonly nameFor: (hwnd: number) => string, private readonly desktops: DesktopService) {}

  get window() {
    return this.win;
  }

  get thumbnailCount() {
    return this.thumbs.size;
  }

  isVisible() {
    return !!this.win?.isVisible();
  }

  toggle() {
    if (this.isVisible()) this.hide();
    else this.show();
  }

  private create() {
    const win = new BrowserWindow({
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'Orelle Mission Control',
      backgroundColor: '#00000000',
      backgroundMaterial: this.ctx.settings.get().appearance.effects === 'off' ? 'none' : 'acrylic',
      webPreferences: {
        preload: this.ctx.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        additionalArguments: ['--orelle-surface=mission'],
      },
    });
    this.win = win;
    this.hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE());
    win.setAlwaysOnTop(true, 'screen-saver');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('blur', () => {
      if (Date.now() - this.shownAt > 300) this.hide();
    });
    win.webContents.on('render-process-gone', () => {
      this.clearThumbs();
      this.win = null;
      if (!win.isDestroyed()) win.destroy();
    });
    void win.loadFile(this.ctx.rendererFile('mission'));
  }

  /** Current app windows, the one in front first. */
  private windows(): MissionWindow[] {
    const fg = this.ctx.tracker.getForeground();
    return this.ctx.tracker.list().map((w) => {
      const r = w.minimized ? null : w32.getVisibleRect(w.hwnd);
      const entry = this.ctx.apps.entryFor({ appId: w.aumid, exe: w.exe });
      return {
        hwnd: w.hwnd,
        title: w.title,
        app: this.nameFor(w.hwnd),
        icon: entry ? this.ctx.apps.iconFor(entry.appId) : w.exe ? this.ctx.icons.get(w.exe) : null,
        minimized: w.minimized,
        aspect: r && r.bottom > r.top ? (r.right - r.left) / (r.bottom - r.top) : 16 / 10,
        active: w.hwnd === fg,
      };
    });
  }

  show() {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    if (!this.win) {
      this.create();
      this.win!.once('ready-to-show', () => this.show());
      return;
    }
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.scale = display.scaleFactor;
    this.ctx.tracker.refresh();
    const list = this.windows();
    this.win.setBounds(display.bounds);
    this.shownAt = Date.now();
    this.win.webContents.send('mission:data', list);
    void this.desktops.list().then((d) => this.win?.webContents.send('mission:desktops', d));
    this.win.show();
    this.win.focus();
    w32.focusWindow(this.hwnd);
    log.info('mission', `Overview of ${list.length} windows`);
  }

  hide() {
    this.clearThumbs();
    if (this.win?.isVisible()) this.win.hide();
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => {
      if (this.win && !this.win.isVisible()) {
        this.win.destroy();
        this.win = null;
      }
    }, panelTiming.releaseAfter);
  }

  private clearThumbs() {
    for (const t of this.thumbs.values()) dwm.unregisterThumbnail(t);
    this.thumbs.clear();
  }

  /** Places (or hides, with null) each live thumbnail; rects are CSS pixels of the overview. */
  private layout(rects: { hwnd: number; x: number; y: number; w: number; h: number; visible: boolean }[]) {
    if (!this.win) return;
    const s = this.scale;
    const wanted = new Set<number>();
    for (const r of rects.slice(0, 80)) {
      if (!w32.isWindow(r.hwnd) || w32.isIconic(r.hwnd)) continue;
      wanted.add(r.hwnd);
      let thumb = this.thumbs.get(r.hwnd);
      if (thumb === undefined) {
        const t = dwm.registerThumbnail(this.hwnd, r.hwnd);
        if (t === null) continue;
        thumb = t;
        this.thumbs.set(r.hwnd, t);
      }
      dwm.updateThumbnail(thumb, r.visible ? { left: Math.round(r.x * s), top: Math.round(r.y * s), right: Math.round((r.x + r.w) * s), bottom: Math.round((r.y + r.h) * s) } : null);
    }
    for (const [h, t] of this.thumbs) {
      if (!wanted.has(h)) {
        dwm.unregisterThumbnail(t);
        this.thumbs.delete(h);
      }
    }
  }

  onEffectsChanged() {
    this.win?.setBackgroundMaterial(this.ctx.settings.get().appearance.effects === 'off' ? 'none' : 'acrylic');
  }

  registerIpc() {
    const from = (e: IpcMainEvent | IpcMainInvokeEvent) => !!this.win && e.sender === this.win.webContents;
    ipcMain.on('mission:layout', (e, rects: unknown) => {
      if (!from(e) || !Array.isArray(rects)) return;
      const clean = rects.filter((r): r is { hwnd: number; x: number; y: number; w: number; h: number; visible: boolean } =>
        !!r && typeof r === 'object' && ['hwnd', 'x', 'y', 'w', 'h'].every((k) => Number.isFinite((r as Record<string, unknown>)[k])));
      this.layout(clean.map((r) => ({ ...r, visible: r.visible !== false })));
    });
    ipcMain.on('mission:activate', (e, hwnd: unknown) => {
      if (!from(e) || typeof hwnd !== 'number') return;
      this.hide();
      w32.focusWindow(hwnd);
    });
    ipcMain.on('mission:close', (e, hwnd: unknown) => {
      if (!from(e) || typeof hwnd !== 'number') return;
      // Polite WM_CLOSE: the app may ask to save; never a forced kill.
      w32.closeWindow(hwnd);
      setTimeout(() => {
        if (!this.win?.isVisible()) return;
        this.ctx.tracker.refresh();
        this.win.webContents.send('mission:data', this.windows());
      }, 500);
    });
    ipcMain.on('mission:hide', (e) => from(e) && this.hide());
    ipcMain.on('mission:desktop', (e, index: unknown) => {
      if (!from(e)) return;
      this.hide();
      if (index === 'new') setTimeout(() => this.desktops.create(), 150);
      else if (typeof index === 'number') setTimeout(() => void this.desktops.switchTo(index), 150);
    });
  }
}
