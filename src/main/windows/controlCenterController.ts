// Control center: an Acrylic panel with the quick controls Windows actually lets an app drive
// (volume, brightness, media keys, Orelle theme…) and shortcuts to Settings for everything else.
import { BrowserWindow, ipcMain, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { OrelleContext } from '../context';
import * as audio from '../native/audio';
import * as w32 from '../native/win32';
import type { SystemService } from '../services/systemService';
import { log } from '../logger';

const WIDTH = 380;
const HEIGHT = 660;

export class ControlCenterController {
  private win: BrowserWindow | null = null;
  private shownAt = 0;
  private refreshTimer: NodeJS.Timeout | null = null;
  private releaseTimer: NodeJS.Timeout | null = null;
  private statsListener = (s: unknown) => this.win?.webContents.send('control:stats', s);

  constructor(private readonly ctx: OrelleContext, private readonly system: SystemService, private readonly toggleWidgetsEdit: () => void) {}

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
      title: 'Orelle Control Center',
      backgroundColor: '#00000000',
      backgroundMaterial: effects === 'off' ? 'none' : 'acrylic',
      webPreferences: {
        preload: this.ctx.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        additionalArguments: ['--orelle-surface=control'],
      },
    });
    this.win = win;
    w32.setRoundedCorners(Number(win.getNativeWindowHandle().readBigUInt64LE()));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('blur', () => {
      if (Date.now() - this.shownAt > 200) this.hide();
    });
    win.webContents.on('did-finish-load', () => void this.pushState());
    win.webContents.on('render-process-gone', () => {
      this.win = null;
      if (!win.isDestroyed()) win.destroy();
    });
    void win.loadFile(this.ctx.rendererFile('control'));
  }

  isVisible() {
    return !!this.win?.isVisible();
  }

  toggle() {
    if (this.isVisible()) this.hide();
    else this.show();
  }

  show() {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    if (!this.win) {
      // First open (or after release): show once the page is painted, with fresh state.
      this.create();
      this.win!.once('ready-to-show', () => this.show());
      return;
    }
    const win = this.win;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const wa = display.workArea;
    // Under the top bar's right side when it is on; otherwise bottom-right, like Windows quick settings.
    const top = this.ctx.settings.get().topBar.enabled;
    win.setBounds({ x: wa.x + wa.width - WIDTH - 8, y: top ? wa.y + 6 : wa.y + wa.height - HEIGHT - 12, width: WIDTH, height: Math.min(HEIGHT, wa.height - 12) });
    this.shownAt = Date.now();
    void this.pushState();
    win.show();
    win.focus();
    w32.focusWindow(Number(win.getNativeWindowHandle().readBigUInt64LE()));
    // Volume and Wi-Fi can change outside Orelle: refresh while the panel is open only.
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => void this.pushState(), 4000);
    this.system.off('stats', this.statsListener);
    this.system.on('stats', this.statsListener);
    this.system.subscribe('control');
  }

  hide() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.system.off('stats', this.statsListener);
    this.system.unsubscribe('control');
    if (this.win?.isVisible()) this.win.hide();
    // Free the renderer if the panel stays closed for a while; reopening recreates it.
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => this.release(), 60_000);
  }

  release() {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    if (this.win && !this.win.isVisible()) {
      this.win.destroy();
      this.win = null;
    }
  }

  onEffectsChanged() {
    this.win?.setBackgroundMaterial(this.ctx.settings.get().appearance.effects === 'off' ? 'none' : 'acrylic');
  }

  private async pushState() {
    try {
      const state = await this.system.controlState();
      this.win?.webContents.send('control:state', state);
    } catch (err) {
      log.warn('control', 'state failed', err);
    }
  }

  registerIpc() {
    const from = (e: IpcMainEvent | IpcMainInvokeEvent) => !!this.win && e.sender === this.win.webContents;
    ipcMain.handle('control:setVolume', (e, v: unknown) => (from(e) && typeof v === 'number' ? audio.setVolume(v) : false));
    ipcMain.handle('control:setMuted', (e, v: unknown) => (from(e) ? audio.setMuted(!!v) : false));
    ipcMain.handle('control:setMicMuted', (e, v: unknown) => (from(e) ? audio.setMicrophoneMuted(!!v) : false));
    ipcMain.on('control:setBrightness', (e, v: unknown) => {
      if (from(e) && typeof v === 'number') this.system.setBrightness(v);
    });
    ipcMain.on('control:media', (e, key: unknown) => {
      if (from(e) && (key === 'playPause' || key === 'next' || key === 'previous')) w32.sendMediaKey(key);
    });
    ipcMain.on('control:openSettings', (e, uri: unknown) => {
      if (!from(e) || typeof uri !== 'string' || !/^ms-settings:[a-z-]*$/.test(uri)) return;
      this.hide();
      void shell.openExternal(uri);
    });
    ipcMain.on('control:action', (e, action: unknown) => {
      if (!from(e)) return;
      const s = this.ctx.settings.get();
      if (action === 'toggleTheme') {
        const light = s.appearance.theme === 'light';
        this.ctx.settings.update({ appearance: { theme: light ? 'dark' : 'light' } });
      } else if (action === 'toggleDock') this.ctx.actions.toggleDock();
      else if (action === 'toggleTaskbar') {
        const order = ['normal', 'autohide', 'hidden'] as const;
        this.ctx.settings.update({ general: { taskbarMode: order[(order.indexOf(s.general.taskbarMode) + 1) % order.length] } });
      }
      else if (action === 'editWidgets') {
        this.hide();
        this.toggleWidgetsEdit();
      } else if (action === 'lock') {
        this.hide();
        w32.lockWorkstation();
      } else if (action === 'preferences') {
        this.hide();
        this.ctx.actions.openSettings();
      } else if (action === 'launcher') {
        this.hide();
        this.ctx.actions.toggleLauncher();
      } else if (action === 'files' || action === 'monitor') {
        this.hide();
        this.ctx.actions.openApp(action);
      }
    });
    ipcMain.on('control:hide', (e) => {
      if (from(e)) this.hide();
    });
  }
}
