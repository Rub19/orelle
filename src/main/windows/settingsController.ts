// Preferences window (Mica, native caption buttons) and every settings-related IPC endpoint.
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DisplayInfo } from '../../shared/types';
import type { OrelleContext } from '../context';
import { buildDefaultDock } from '../services/firstRun';
import type { WeatherService } from '../services/weatherService';
import { log } from '../logger';

export class SettingsController {
  private win: BrowserWindow | null = null;

  constructor(
    private readonly ctx: OrelleContext,
    private readonly hotkeys: { set(name: string, accel: string): { ok: boolean; error?: string }; suspend(on: boolean): void },
    private readonly weather: WeatherService,
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
      title: `Orelle — ${this.ctx.t('settings.title')}`,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: 44 },
      backgroundColor: '#00000000',
      backgroundMaterial: effects === 'off' ? 'none' : 'mica',
      icon: this.ctx.rendererFile('settings').replace(/renderer[\\/]settings\.html$/, 'icons/orelle.ico'),
      webPreferences: {
        preload: this.ctx.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        additionalArguments: ['--orelle-surface=settings', ...(section ? [`--orelle-section=${section}`] : [])],
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

    ipcMain.handle('settings:setHotkey', (e, name: unknown, accel: unknown) => {
      if (!fromSettings(e) || typeof accel !== 'string' || (name !== 'launcher' && name !== 'control')) return { ok: false, error: 'invalid' };
      this.hotkeys.suspend(false);
      const res = this.hotkeys.set(name, accel);
      if (res.ok) this.ctx.settings.update(name === 'launcher' ? { launcher: { hotkey: accel } } : { controlCenter: { hotkey: accel } });
      return res;
    });

    // Suspends every global shortcut while the user records a new one, so the old one does not fire.
    ipcMain.on('settings:recordingHotkey', (e, on: unknown) => {
      if (this.win && e.sender === this.win.webContents) this.hotkeys.suspend(!!on);
    });

    ipcMain.handle('settings:geocode', async (e, q: unknown) => {
      if (!fromSettings(e) || typeof q !== 'string' || q.trim().length < 2) return [];
      try {
        return await this.weather.geocode(q.trim(), this.ctx.language);
      } catch (err) {
        log.warn('settings', 'geocoding failed', err);
        return null;
      }
    });

    // Allowed scripts are only ever added through this file picker.
    ipcMain.handle('settings:addScript', async (e) => {
      if (!fromSettings(e)) return null;
      const res = await dialog.showOpenDialog(this.win!, { properties: ['openFile'], filters: [{ name: 'Scripts', extensions: ['ps1', 'bat', 'cmd'] }] });
      const p = res.filePaths[0];
      if (res.canceled || !p) return null;
      const base = path.basename(p, path.extname(p));
      const keyword = base.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'script';
      const script = { id: `script-${randomUUID().slice(0, 8)}`, name: base, keyword, path: p, approvedHash: null, showConsole: false };
      this.ctx.settings.update({ launcher: { scripts: [...this.ctx.settings.get().launcher.scripts, script] } });
      return script;
    });

    ipcMain.handle('settings:pickPath', async (e, kind: unknown) => {
      if (!fromSettings(e)) return null;
      const res = await dialog.showOpenDialog(this.win!, { properties: [kind === 'folder' ? 'openDirectory' : 'openFile'] });
      return res.canceled ? null : res.filePaths[0] ?? null;
    });

    ipcMain.on('settings:openApp', (e, which: unknown) => {
      if (this.win && e.sender === this.win.webContents && (which === 'files' || which === 'monitor')) this.ctx.actions.openApp(which);
    });

    ipcMain.on('settings:editWidgets', (e) => {
      if (this.win && e.sender === this.win.webContents) this.ctx.actions.editWidgets();
    });

    ipcMain.handle('settings:export', async (e) => {
      if (!fromSettings(e)) return { ok: false };
      const res = await dialog.showSaveDialog(this.win!, {
        defaultPath: `orelle-profile-${new Date().toISOString().slice(0, 10)}.orelle.json`,
        filters: [{ name: 'Orelle profile', extensions: ['json'] }],
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      const profile = { format: 'orelle-profile', exportedAt: new Date().toISOString(), app: app.getVersion(), settings: this.ctx.settings.get() };
      await fs.promises.writeFile(res.filePath, JSON.stringify(profile, null, 2), 'utf8');
      log.info('settings', 'Profile exported');
      return { ok: true };
    });

    ipcMain.handle('settings:import', async (e) => {
      if (!fromSettings(e)) return { ok: false };
      const res = await dialog.showOpenDialog(this.win!, { properties: ['openFile'], filters: [{ name: 'Orelle profile', extensions: ['json'] }] });
      if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
      try {
        const stat = await fs.promises.stat(res.filePaths[0]);
        if (stat.size > 2_000_000) throw new Error('file too large');
        const raw = JSON.parse(await fs.promises.readFile(res.filePaths[0], 'utf8'));
        if (raw?.format !== 'orelle-profile' || typeof raw.settings !== 'object') throw new Error('not a Orelle profile');
        this.ctx.settings.replace(raw.settings);
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
      this.ctx.settings.replace({});
      this.ctx.settings.update({ dock: { items: buildDefaultDock(this.ctx.apps) } });
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
