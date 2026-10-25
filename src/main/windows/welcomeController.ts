// First-run guided setup: language, Windows taskbar, Windows key, look, Dock and sign-in. Every
// choice is explained and can be changed later in Preferences. Nothing that changes Windows'
// behaviour (hiding the taskbar, the Windows key hook) happens before the user has chosen.
import { BrowserWindow, ipcMain, nativeTheme, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import path from 'node:path';
import type { OrelleContext } from '../context';

export class WelcomeController {
  private win: BrowserWindow | null = null;

  constructor(private readonly ctx: OrelleContext, private readonly onDone: () => void) {}

  get window() {
    return this.win;
  }

  is(wc: WebContents) {
    return !!this.win && !this.win.isDestroyed() && this.win.webContents === wc;
  }

  open() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show();
      this.win.focus();
      return;
    }
    const dark = nativeTheme.shouldUseDarkColors;
    const win = new BrowserWindow({
      width: 820,
      height: 600,
      resizable: false,
      maximizable: false,
      minimizable: false,
      show: false,
      center: true,
      title: 'Orelle',
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: 40 },
      backgroundColor: '#00000000',
      backgroundMaterial: 'mica',
      icon: path.join(__dirname, 'icons', 'orelle.ico'),
      webPreferences: {
        preload: this.ctx.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        additionalArguments: ['--orelle-surface=welcome'],
      },
    });
    this.win = win;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.once('ready-to-show', () => win.show());
    // Closing the window counts as "keep the defaults".
    win.on('closed', () => {
      this.win = null;
      if (!this.ctx.settings.get().general.onboarded) this.finish();
    });
    void win.loadFile(this.ctx.rendererFile('welcome'));
  }

  private finish() {
    this.ctx.settings.update({ general: { onboarded: true } });
    this.onDone();
  }

  registerIpc() {
    const from = (e: IpcMainEvent | IpcMainInvokeEvent) => this.is(e.sender);
    ipcMain.handle('welcome:dock', (e) => {
      if (!from(e)) return [];
      return this.ctx.settings.get().dock.items.flatMap((i) => (i.type === 'app' ? [{ name: i.name, icon: i.appId ? this.ctx.apps.iconFor(i.appId) : i.path ? this.ctx.icons.get(i.path) : null }] : []));
    });
    ipcMain.on('welcome:finish', (e) => {
      if (!from(e)) return;
      this.finish();
      this.win?.close();
    });
  }
}
