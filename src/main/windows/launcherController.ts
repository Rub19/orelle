// The launcher: a pre-created, hidden acrylic window shown instantly on the global shortcut.
import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import type { OrelleContext } from '../context';
import * as w32 from '../native/win32';
import { SearchService } from '../services/searchService';
import { log } from '../logger';

const WIDTH = 760;
const HEIGHT = 492;

export class LauncherController {
  private win: BrowserWindow | null = null;
  private shownAt = 0;

  constructor(private readonly ctx: OrelleContext, private readonly search: SearchService) {}

  get window() {
    return this.win;
  }

  create() {
    if (this.win) return;
    const effects = this.ctx.settings.get().appearance.effects;
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'Orelle Launcher',
      backgroundColor: '#00000000',
      backgroundMaterial: effects === 'off' ? 'none' : 'acrylic',
      webPreferences: {
        preload: this.ctx.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        additionalArguments: ['--orelle-surface=launcher'],
      },
    });
    this.win = win;
    w32.setRoundedCorners(Number(win.getNativeWindowHandle().readBigUInt64LE()));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('blur', () => {
      // Ignore the blur that can follow the show call itself.
      if (Date.now() - this.shownAt > 150 && !process.argv.includes('--orelle-keep-launcher')) this.hide();
    });
    win.webContents.on('render-process-gone', (_e, d) => {
      log.error('launcher', `Renderer gone (${d.reason}); recreating`);
      this.win = null;
      if (!win.isDestroyed()) win.destroy();
      this.create();
    });
    win.on('closed', () => { if (this.win === win) this.win = null; });
    void win.loadFile(this.ctx.rendererFile('launcher'));
  }

  isVisible() {
    return !!this.win?.isVisible();
  }

  toggle() {
    if (this.isVisible()) this.hide();
    else this.show();
  }

  show() {
    if (!this.ctx.settings.get().launcher.enabled) return;
    if (!this.win) this.create();
    const win = this.win!;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const wa = display.workArea;
    win.setBounds({ x: Math.round(wa.x + (wa.width - WIDTH) / 2), y: Math.round(wa.y + wa.height * 0.2), width: WIDTH, height: HEIGHT });
    this.shownAt = Date.now();
    win.webContents.send('launcher:show', randomUUID());
    win.show();
    win.focus();
    // Windows may refuse focus to a background process; force it so typing goes to the field.
    w32.focusWindow(Number(win.getNativeWindowHandle().readBigUInt64LE()));
  }

  hide() {
    if (!this.win?.isVisible()) return;
    this.win.webContents.send('launcher:hide');
    this.win.hide();
  }

  onEffectsChanged() {
    const effects = this.ctx.settings.get().appearance.effects;
    this.win?.setBackgroundMaterial(effects === 'off' ? 'none' : 'acrylic');
  }

  registerIpc() {
    const fromLauncher = (e: IpcMainInvokeEvent | Electron.IpcMainEvent) => !!this.win && e.sender === this.win.webContents;
    ipcMain.handle('launcher:search', (e, q: unknown) => {
      if (!fromLauncher(e) || typeof q !== 'string') return null;
      return this.search.search(q);
    });
    ipcMain.handle('launcher:preview', (e, id: unknown) => {
      if (!fromLauncher(e) || typeof id !== 'string') return null;
      return this.search.preview(id);
    });
    ipcMain.handle('launcher:execute', async (e, id: unknown, mode: unknown) => {
      if (!fromLauncher(e) || typeof id !== 'string') return false;
      // Hide first so focus returns to the target app immediately.
      const closes = !id.startsWith('sys:') || id === 'sys:lock';
      if (closes) this.hide();
      const ok = await this.search.execute(id, mode === 'alt' ? 'alt' : 'primary');
      if (!closes) this.hide();
      return ok;
    });
    ipcMain.handle('launcher:toggleFavorite', (e, id: unknown) => {
      if (!fromLauncher(e) || typeof id !== 'string') return false;
      const favs = this.ctx.settings.get().launcher.favorites;
      const next = favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id];
      this.ctx.settings.update({ launcher: { favorites: next } });
      return next.includes(id);
    });
    ipcMain.handle('launcher:pin', (e, id: unknown) => {
      if (!fromLauncher(e) || typeof id !== 'string' || !id.startsWith('app:')) return false;
      const app = this.ctx.apps.findByAppId(id.slice(4));
      if (!app) return false;
      this.ctx.actions.pinToDock({ appId: app.appId, path: app.target ?? undefined, name: app.name });
      return true;
    });
    ipcMain.on('launcher:hide', (e) => {
      if (fromLauncher(e)) this.hide();
    });
  }
}
