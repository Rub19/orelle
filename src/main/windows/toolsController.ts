// Orelle Utilities: Audio Center, Storage Manager and Clipboard Manager in one window (Mica,
// native caption buttons, like Files and Monitor). Created on demand, single instance.
import { BrowserWindow, dialog, ipcMain, nativeTheme, shell, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import os from 'node:os';
import path from 'node:path';
import type { OrelleContext } from '../context';
import * as audio from '../native/audio';
import * as w32 from '../native/win32';
import type { ClipboardHistory } from '../services/clipboardHistory';
import type { StorageService } from '../services/storageService';
import { log } from '../logger';

export type ToolsSection = 'audio' | 'storage' | 'clipboard';

export class ToolsController {
  private win: BrowserWindow | null = null;
  /** The window that was in front before the utilities opened (target of "Paste"). */
  private pasteTarget: number | null = null;

  constructor(
    private readonly ctx: OrelleContext,
    private readonly storage: StorageService,
    private readonly clip: ClipboardHistory,
    private readonly target: () => number | null,
  ) {
    storage.on('progress', (p) => this.send('tools:progress', p));
    clip.on('change', () => this.send('tools:clipChanged'));
  }

  get window() {
    return this.win;
  }

  is(wc: WebContents) {
    return !!this.win && !this.win.isDestroyed() && this.win.webContents === wc;
  }

  private send(channel: string, ...args: unknown[]) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, ...args);
  }

  open(section: ToolsSection = 'audio') {
    this.pasteTarget = this.target();
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      this.send('tools:section', section);
      return;
    }
    const dark = nativeTheme.shouldUseDarkColors;
    const win = new BrowserWindow({
      width: 1080,
      height: 720,
      minWidth: 760,
      minHeight: 480,
      show: false,
      title: this.ctx.t('tools.title'),
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: 44 },
      backgroundColor: '#00000000',
      backgroundMaterial: this.ctx.settings.get().appearance.effects === 'off' ? 'none' : 'mica',
      icon: path.join(__dirname, 'icons', 'orelle.ico'),
      webPreferences: {
        preload: this.ctx.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        additionalArguments: ['--orelle-surface=tools'],
      },
    });
    this.win = win;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      this.storage.cancel();
      this.win = null;
    });
    void win.loadFile(this.ctx.rendererFile('tools'), { query: { section } });
  }

  updateTitleBar() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.setTitleBarOverlay({ color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#f5f5f7' : '#1d1d1f', height: 44 });
    this.win.setBackgroundMaterial(this.ctx.settings.get().appearance.effects === 'off' ? 'none' : 'mica');
  }

  private appOf(pid: number): { name: string; icon: string | null; exe: string } {
    const info = pid ? w32.getProcessInfo(pid) : null;
    const exe = info?.exe ?? '';
    const entry = this.ctx.apps.entryFor({ appId: info?.aumid, exe });
    const base = path.basename(exe, '.exe');
    return {
      name: entry?.name ?? (base ? base.charAt(0).toUpperCase() + base.slice(1) : `PID ${pid}`),
      icon: entry ? this.ctx.apps.iconFor(entry.appId) : exe ? this.ctx.icons.get(exe) : null,
      exe,
    };
  }

  registerIpc() {
    const from = (e: IpcMainEvent | IpcMainInvokeEvent) => this.is(e.sender);
    const abs = (v: unknown): v is string => typeof v === 'string' && v.length < 4096 && path.isAbsolute(v);

    // ---------- Audio ----------
    ipcMain.handle('tools:audio', (e) => {
      if (!from(e)) return null;
      const devices = audio.listDevices();
      const sessions = audio.listSessions().map((s) => ({ ...s, ...(s.system ? { name: this.ctx.t('tools.audio.system'), icon: null, exe: '' } : this.appOf(s.pid)) }));
      return { devices, sessions };
    });
    ipcMain.handle('tools:audioSet', (e, change: unknown) => {
      if (!from(e) || !change || typeof change !== 'object') return false;
      const c = change as { kind?: string; id?: unknown; pid?: unknown; system?: unknown; level?: unknown; muted?: unknown };
      const level = typeof c.level === 'number' && Number.isFinite(c.level) ? c.level : undefined;
      const muted = typeof c.muted === 'boolean' ? c.muted : undefined;
      if (c.kind === 'device' && typeof c.id === 'string') {
        if (level !== undefined) return audio.setDeviceVolume(c.id, level);
        if (muted !== undefined) return audio.setDeviceMuted(c.id, muted);
      }
      if (c.kind === 'session' && typeof c.pid === 'number') return audio.setSession(c.pid, c.system === true, { level, muted });
      return false;
    });
    ipcMain.on('tools:openSound', (e, which: unknown) => {
      if (!from(e)) return;
      const uri = which === 'apps' ? 'ms-settings:apps-volume' : which === 'input' ? 'ms-settings:sound-devices' : 'ms-settings:sound';
      void shell.openExternal(uri);
    });

    // ---------- Storage ----------
    ipcMain.handle('tools:drives', async (e) => (from(e) ? { drives: await this.storage.drives(), home: os.homedir() } : { drives: [], home: '' }));
    ipcMain.handle('tools:analyze', async (e, root: unknown) => (from(e) && abs(root) ? this.storage.analyze(root) : null));
    ipcMain.handle('tools:duplicates', async (e, root: unknown, minMB: unknown) => (from(e) && abs(root) ? this.storage.duplicates(root, Math.max(0.01, Number(minMB) || 1) * 1024 * 1024) : null));
    ipcMain.on('tools:cancel', (e) => from(e) && this.storage.cancel());
    ipcMain.handle('tools:cleanup', (e) => (from(e) ? this.storage.cleanupCandidates() : []));
    ipcMain.handle('tools:clean', (e, id: unknown) => (from(e) && (id === 'temp' || id === 'crashdumps') ? this.storage.clean(id, this.win) : null));
    ipcMain.handle('tools:recycle', (e, paths: unknown) => {
      if (!from(e) || !Array.isArray(paths) || !paths.length || paths.length > 2000 || !paths.every(abs)) return null;
      return this.storage.recycle(paths as string[], this.win);
    });
    ipcMain.handle('tools:pickFolder', async (e) => {
      if (!from(e) || !this.win) return null;
      const r = await dialog.showOpenDialog(this.win, { properties: ['openDirectory'] });
      return r.canceled ? null : r.filePaths[0] ?? null;
    });
    ipcMain.on('tools:reveal', (e, p: unknown) => { if (from(e) && abs(p)) shell.showItemInFolder(p); });
    ipcMain.on('tools:openFolder', (e, p: unknown) => { if (from(e) && abs(p)) this.ctx.actions.openApp('files', p); });

    // ---------- Clipboard ----------
    ipcMain.handle('tools:clipList', (e) => (from(e) ? { enabled: this.clip.enabled, items: this.clip.list() } : null));
    ipcMain.handle('tools:clipCopy', (e, id: unknown) => (from(e) && typeof id === 'string' ? this.clip.copy(id) : false));
    ipcMain.handle('tools:clipPaste', async (e, id: unknown) => {
      if (!from(e) || typeof id !== 'string' || !(await this.clip.copy(id))) return false;
      const target = this.pasteTarget;
      this.win?.minimize();
      if (!target || !w32.isWindow(target)) return true;
      setTimeout(() => {
        w32.focusWindow(target);
        setTimeout(() => w32.sendPaste(), 120);
      }, 150);
      log.info('clipboard', 'Pasted an entry into the previous window');
      return true;
    });
    ipcMain.on('tools:clipPin', (e, id: unknown, on: unknown) => { if (from(e) && typeof id === 'string') this.clip.pin(id, on === true); });
    ipcMain.on('tools:clipRemove', (e, id: unknown) => { if (from(e) && typeof id === 'string') this.clip.remove(id); });
    ipcMain.on('tools:clipClear', (e, all: unknown) => { if (from(e)) this.clip.clear(all === true); });
  }
}
