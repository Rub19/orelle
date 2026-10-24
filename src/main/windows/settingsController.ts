// Preferences window (Mica, native caption buttons) and every settings-related IPC endpoint.
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeTheme, screen, shell, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import type { DisplayInfo } from '../../shared/types';
import type { NovaContext } from '../context';
import { buildDefaultDock } from '../services/firstRun';
import { log } from '../logger';

export class SettingsController {
  private win: BrowserWindow | null = null;

  constructor(
    private readonly ctx: NovaContext,
    private readonly hotkeys: { apply(accel: string): { ok: boolean; error?: string } },
  ) {}

  get window() {
    return this.win;
  }

  open(section?: string) {
    if (this.win && !this.win.isDestroyed()) {
      if (section) this.win.webContents.send('settings:section', section);
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      return;
    }
    const dark = nativeTheme.shouldUseDarkColors;
    const effects = this.ctx.settings.get().appearance.effects;
    const win = new BrowserWindow({
      width: 1000,
      height: 700,
      minWidth: 780,
      minHeight: 520,
      show: false,
      title: `NOVA — ${this.ctx.t('settings.title')}`,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: 44 },
      backgroundColor: '#00000000',
      backgroundMaterial: effects === 'off' ? 'none' : 'mica',
      icon: this.ctx.rendererFile('settings').replace(/renderer[\\/]settings\.html$/, 'icons/nova.ico'),
      webPreferences: {
        preload: this.ctx.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        additionalArguments: ['--nova-surface=settings', ...(section ? [`--nova-section=${section}`] : [])],
      },
    });
    this.win = win;
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => { this.win = null; });
    void win.loadFile(this.ctx.rendererFile('settings'));
  }

  updateTitleBar() {
    if (!this.win || this.win.isDestroyed()) return;
    const dark = nativeTheme.shouldUseDarkColors;
    this.win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: 44 });
    this.win.setBackgroundMaterial(this.ctx.settings.get().appearance.effects === 'off' ? 'none' : 'mica');
  }

  registerIpc() {
    const fromSettings = (e: IpcMainInvokeEvent) => !!this.win && e.sender === this.win.webContents;

    ipcMain.handle('settings:apps', (e) => (fromSettings(e) ? this.ctx.apps.all() : []));

    ipcMain.handle('settings:displays', (e): DisplayInfo[] => {
      if (!fromSettings(e)) return [];
      const primary = screen.getPrimaryDisplay().id;
      return screen.getAllDisplays().map((d, i) => ({
        id: String(d.id),
        label: `${d.label || `#${i + 1}`} — ${d.size.width}×${d.size.height}${d.scaleFactor !== 1 ? ` @${Math.round(d.scaleFactor * 100)}%` : ''}`,
        primary: d.id === primary,
      }));
    });

    ipcMain.handle('settings:setHotkey', (e, accel: unknown) => {
      if (!fromSettings(e) || typeof accel !== 'string') return { ok: false, error: 'invalid' };
      const res = this.hotkeys.apply(accel);
      if (res.ok) this.ctx.settings.update({ launcher: { hotkey: accel } });
      return res;
    });

    // Suspends the global shortcut while the user records a new one, so the old one does not fire.
    ipcMain.on('settings:recordingHotkey', (e, on: unknown) => {
      if (!this.win || e.sender !== this.win.webContents) return;
      if (on) globalShortcut.unregisterAll();
      else this.hotkeys.apply(this.ctx.settings.get().launcher.hotkey);
    });

    ipcMain.handle('settings:export', async (e) => {
      if (!fromSettings(e)) return { ok: false };
      const res = await dialog.showSaveDialog(this.win!, {
        defaultPath: `nova-profile-${new Date().toISOString().slice(0, 10)}.nova.json`,
        filters: [{ name: 'NOVA profile', extensions: ['json'] }],
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      const profile = { format: 'nova-profile', exportedAt: new Date().toISOString(), app: app.getVersion(), settings: this.ctx.settings.get() };
      await fs.promises.writeFile(res.filePath, JSON.stringify(profile, null, 2), 'utf8');
      log.info('settings', 'Profile exported');
      return { ok: true };
    });

    ipcMain.handle('settings:import', async (e) => {
      if (!fromSettings(e)) return { ok: false };
      const res = await dialog.showOpenDialog(this.win!, { properties: ['openFile'], filters: [{ name: 'NOVA profile', extensions: ['json'] }] });
      if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
      try {
        const stat = await fs.promises.stat(res.filePaths[0]);
        if (stat.size > 2_000_000) throw new Error('file too large');
        const raw = JSON.parse(await fs.promises.readFile(res.filePaths[0], 'utf8'));
        if (raw?.format !== 'nova-profile' || typeof raw.settings !== 'object') throw new Error('not a NOVA profile');
        this.ctx.settings.replace(raw.settings);
        this.hotkeys.apply(this.ctx.settings.get().launcher.hotkey);
        log.info('settings', 'Profile imported');
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });

    ipcMain.handle('settings:reset', async (e) => {
      if (!fromSettings(e)) return { ok: false };
      const confirm = await dialog.showMessageBox(this.win!, {
        type: 'warning',
        message: this.ctx.t('settings.backup.reset'),
        detail: this.ctx.t('settings.backup.reset.desc'),
        buttons: [this.ctx.t('settings.backup.reset'), this.ctx.t('common.cancel')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (confirm.response !== 0) return { ok: false, canceled: true };
      const next = this.ctx.settings.replace({});
      this.ctx.settings.update({ dock: { items: buildDefaultDock(this.ctx.apps) } });
      this.hotkeys.apply(next.launcher.hotkey);
      return { ok: true };
    });

    ipcMain.handle('settings:clearHistory', (e) => {
      if (fromSettings(e)) this.ctx.usage.clear();
      return true;
    });

    ipcMain.handle('settings:reindex', async (e) => {
      if (fromSettings(e)) await this.ctx.apps.refresh();
      return this.ctx.apps.all().length;
    });

    ipcMain.on('settings:openFolder', (e, which: unknown) => {
      if (!this.win || e.sender !== this.win.webContents) return;
      void shell.openPath(which === 'logs' ? this.ctx.logDir : this.ctx.dataDir);
    });

    ipcMain.on('settings:openWinSettings', (e, uri: unknown) => {
      if (!this.win || e.sender !== this.win.webContents) return;
      if (typeof uri === 'string' && /^ms-settings:[a-z-]+$/.test(uri)) void shell.openExternal(uri);
    });

    ipcMain.handle('settings:pickFolder', async (e) => {
      if (!fromSettings(e)) return null;
      const res = await dialog.showOpenDialog(this.win!, { properties: ['openDirectory'] });
      return res.canceled ? null : res.filePaths[0] ?? null;
    });
  }
}
