// Orelle's own applications: Files (multiple windows, tabs) and Monitor (single window).
// Both use the Mica material and native caption buttons, like the Preferences window.
import { BrowserWindow, clipboard, ipcMain, nativeImage, nativeTheme, shell, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { OrelleContext } from '../context';
import type { FileService } from '../services/fileService';
import type { MonitorService, MonitorSample } from '../services/monitorService';
import { log } from '../logger';
import { SensorService } from '../services/sensorService';

type AppKind = 'files' | 'monitor';

export class AppsController {
  private filesWindows = new Set<BrowserWindow>();
  private monitorWin: BrowserWindow | null = null;
  private watchers = new Map<number, fs.FSWatcher>();
  private latest: MonitorSample | null = null;
  private sensors = new SensorService();

  constructor(private readonly ctx: OrelleContext, readonly files: FileService, readonly monitor: MonitorService) {
    files.on('progress', (op) => {
      for (const w of this.filesWindows) if (!w.isDestroyed()) w.webContents.send('files:progress', op);
    });
    monitor.on('sample', (s: MonitorSample) => {
      this.latest = s;
      this.monitorWin?.webContents.send('monitor:sample', s);
    });
  }

  isFiles(wc: WebContents) {
    return [...this.filesWindows].some((w) => !w.isDestroyed() && w.webContents === wc);
  }

  isMonitor(wc: WebContents) {
    return !!this.monitorWin && !this.monitorWin.isDestroyed() && this.monitorWin.webContents === wc;
  }

  private create(kind: AppKind, query: Record<string, string> = {}): BrowserWindow {
    const dark = nativeTheme.shouldUseDarkColors;
    const effects = this.ctx.settings.get().appearance.effects;
    const win = new BrowserWindow({
      width: kind === 'files' ? 1180 : 1100,
      height: kind === 'files' ? 760 : 720,
      minWidth: 720,
      minHeight: 460,
      show: false,
      title: kind === 'files' ? this.ctx.t('files.title') : this.ctx.t('monitor.title'),
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: 44 },
      backgroundColor: '#00000000',
      backgroundMaterial: effects === 'off' ? 'none' : 'mica',
      icon: path.join(__dirname, 'icons', 'orelle.ico'),
      webPreferences: {
        preload: this.ctx.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        additionalArguments: [`--orelle-surface=${kind}`],
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.once('ready-to-show', () => win.show());
    void win.loadFile(this.ctx.rendererFile(kind), { query });
    return win;
  }

  openFiles(dir?: string) {
    const start = dir && fs.existsSync(dir) ? dir : '';
    const win = this.create('files', start ? { path: start } : {});
    this.filesWindows.add(win);
    const wcId = win.webContents.id;
    win.on('closed', () => {
      this.filesWindows.delete(win);
      this.watchers.get(wcId)?.close();
      this.watchers.delete(wcId);
    });
  }

  openMonitor(tab?: string) {
    if (this.monitorWin && !this.monitorWin.isDestroyed()) {
      if (this.monitorWin.isMinimized()) this.monitorWin.restore();
      this.monitorWin.show();
      this.monitorWin.focus();
      if (tab) this.monitorWin.webContents.send('monitor:tab', tab);
      return;
    }
    const win = this.create('monitor', tab ? { tab } : {});
    this.monitorWin = win;
    // Sample only while the window can actually be seen.
    const sync = () => (win.isVisible() && !win.isMinimized() ? this.monitor.start() : this.monitor.stop());
    win.on('show', sync);
    win.on('hide', sync);
    win.on('minimize', sync);
    win.on('restore', sync);
    win.on('closed', () => {
      this.monitor.stop();
      this.monitorWin = null;
    });
  }

  updateTitleBars() {
    const dark = nativeTheme.shouldUseDarkColors;
    const effects = this.ctx.settings.get().appearance.effects;
    for (const w of [...this.filesWindows, this.monitorWin]) {
      if (!w || w.isDestroyed()) continue;
      w.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: 44 });
      w.setBackgroundMaterial(effects === 'off' ? 'none' : 'mica');
    }
  }

  get windows(): BrowserWindow[] {
    return [...this.filesWindows, ...(this.monitorWin ? [this.monitorWin] : [])];
  }

  registerIpc() {
    const fromFiles = (e: IpcMainEvent | IpcMainInvokeEvent) => this.isFiles(e.sender);
    const fromMonitor = (e: IpcMainEvent | IpcMainInvokeEvent) => this.isMonitor(e.sender);
    const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 4096;
    const strs = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 5000 && v.every(str);
    const abs = (v: unknown): v is string => str(v) && path.isAbsolute(v);

    // ---------- Files ----------
    ipcMain.handle('files:places', (e) => (fromFiles(e) ? this.files.places() : []));
    ipcMain.handle('files:recent', (e) => (fromFiles(e) ? this.files.recent() : []));
    ipcMain.handle('files:list', (e, dir: unknown) => (fromFiles(e) && abs(dir) ? this.files.list(dir) : { ok: false, error: 'invalid' }));
    ipcMain.handle('files:icons', (e, items: unknown) => {
      if (!fromFiles(e) || !Array.isArray(items)) return {};
      const out: Record<string, string | null> = {};
      for (const it of items.slice(0, 400) as { path: string; dir: boolean }[]) {
        if (it && abs(it.path)) out[it.path] = this.files.icon(it.path, !!it.dir);
      }
      return out;
    });
    ipcMain.handle('files:thumbnail', (e, p: unknown, size: unknown) => (fromFiles(e) && abs(p) ? this.files.thumbnail(p, typeof size === 'number' ? Math.min(1024, size) : 256) : null));
    ipcMain.handle('files:preview', (e, p: unknown) => (fromFiles(e) && abs(p) ? this.files.preview(p) : { kind: 'none' }));
    ipcMain.handle('files:properties', async (e, p: unknown) => {
      if (!fromFiles(e) || !abs(p)) return null;
      try { return await this.files.properties(p); } catch { return null; }
    });
    ipcMain.handle('files:mkdir', (e, dir: unknown, name: unknown) => (fromFiles(e) && abs(dir) && str(name) ? this.files.mkdir(dir, name) : { ok: false, error: 'invalid' }));
    ipcMain.handle('files:newFile', (e, dir: unknown, name: unknown) => (fromFiles(e) && abs(dir) && str(name) ? this.files.newFile(dir, name) : { ok: false, error: 'invalid' }));
    ipcMain.handle('files:rename', (e, p: unknown, name: unknown) => (fromFiles(e) && abs(p) && str(name) ? this.files.rename(p, name) : { ok: false, error: 'invalid' }));
    ipcMain.handle('files:transfer', (e, paths: unknown, dest: unknown, mode: unknown) =>
      fromFiles(e) && strs(paths) && paths.every((p) => path.isAbsolute(p)) && abs(dest) ? this.files.transfer(paths, dest, mode === 'move' ? 'move' : 'copy') : null);
    ipcMain.handle('files:remove', (e, paths: unknown, permanent: unknown) =>
      fromFiles(e) && strs(paths) && paths.every((p) => path.isAbsolute(p) && p.length > 3) ? this.files.remove(paths, permanent === true) : null);
    ipcMain.handle('files:archive', (e, kind: unknown, paths: unknown, dest: unknown) =>
      fromFiles(e) && (kind === 'compress' || kind === 'extract') && strs(paths) && abs(dest) ? this.files.archive(kind, paths, dest) : null);
    ipcMain.handle('files:search', (e, root: unknown, q: unknown, content: unknown) => (fromFiles(e) && abs(root) && str(q) ? this.files.search(root, q, content === true) : []));
    ipcMain.handle('files:open', async (e, p: unknown) => (fromFiles(e) && abs(p) ? (await this.files.open(p)) || null : 'invalid'));
    ipcMain.on('files:openWith', (e, p: unknown) => { if (fromFiles(e) && abs(p)) this.files.openWith(p); });
    ipcMain.on('files:showInExplorer', (e, p: unknown) => { if (fromFiles(e) && abs(p)) this.files.showInExplorer(p); });
    ipcMain.on('files:copyPath', (e, paths: unknown) => { if (fromFiles(e) && strs(paths)) void clipboard.writeText(paths.join('\r\n')); });
    ipcMain.on('files:newWindow', (e, dir: unknown) => { if (fromFiles(e)) this.openFiles(abs(dir) ? dir : undefined); });
    ipcMain.on('files:terminal', (e, dir: unknown) => {
      if (!fromFiles(e) || !abs(dir)) return;
      const wt = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps', 'wt.exe');
      if (fs.existsSync(wt)) spawn(wt, ['-d', dir], { detached: true, stdio: 'ignore' }).unref();
      else spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoExit'], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
    });
    // Drag files out of Orelle into any app (Explorer, mail, browsers…).
    ipcMain.on('files:startDrag', (e, paths: unknown) => {
      if (!fromFiles(e) || !strs(paths)) return;
      const icon = nativeImage.createFromPath(path.join(__dirname, 'icons', 'orelle-32.png'));
      try {
        e.sender.startDrag({ file: paths[0], files: paths, icon });
      } catch (err) {
        log.warn('files', 'startDrag failed', err);
      }
    });
    // Live refresh of the open folder (OS change notifications, no polling).
    ipcMain.on('files:watch', (e, dir: unknown) => {
      if (!fromFiles(e)) return;
      const id = e.sender.id;
      this.watchers.get(id)?.close();
      this.watchers.delete(id);
      if (!abs(dir)) return;
      try {
        let timer: NodeJS.Timeout | null = null;
        const w = fs.watch(dir, { persistent: false }, () => {
          if (timer) return;
          timer = setTimeout(() => { timer = null; if (!e.sender.isDestroyed()) e.sender.send('files:changed', dir); }, 250);
        });
        w.on('error', () => w.close());
        this.watchers.set(id, w);
      } catch { /* not watchable (e.g. root of an offline drive) */ }
    });
    ipcMain.on('files:openMonitor', (e) => { if (fromFiles(e)) this.openMonitor(); });

    // ---------- Monitor ----------
    ipcMain.handle('monitor:history', (e) => (fromMonitor(e) ? this.monitor.getHistory() : []));
    ipcMain.handle('monitor:latest', (e) => (fromMonitor(e) ? this.latest : null));
    ipcMain.handle('monitor:end', (e, pid: unknown) => (fromMonitor(e) && typeof pid === 'number' ? this.monitor.endProcess(pid, this.monitorWin) : { ok: false }));
    ipcMain.handle('monitor:close', (e, pid: unknown) => (fromMonitor(e) && typeof pid === 'number' ? this.monitor.closeApp(pid) : 0));
    ipcMain.handle('monitor:startup', (e) => (fromMonitor(e) ? this.monitor.startupItems() : []));
    ipcMain.handle('monitor:startupSet', (e, id: unknown, enabled: unknown) => (fromMonitor(e) && str(id) ? this.monitor.setStartupEnabled(id, enabled === true) : false));
    ipcMain.handle('monitor:startupRestore', (e) => (fromMonitor(e) ? this.monitor.restoreStartup() : 0));
    ipcMain.handle('monitor:journal', (e) => (fromMonitor(e) ? this.monitor.journal() : []));
    ipcMain.handle('monitor:services', (e) => (fromMonitor(e) ? this.monitor.services() : []));
    ipcMain.handle('monitor:info', (e) => (fromMonitor(e) ? this.monitor.systemInfo() : null));
    ipcMain.handle('monitor:sensors', (e) => (fromMonitor(e) ? this.sensors.read() : null));
    ipcMain.handle('monitor:export', (e) => (fromMonitor(e) ? this.monitor.exportReport(this.monitorWin, this.latest) : { ok: false }));
    ipcMain.on('monitor:reveal', (e, p: unknown) => { if (fromMonitor(e) && abs(p)) shell.showItemInFolder(p); });
    ipcMain.on('monitor:openFolder', (e, p: unknown) => { if (fromMonitor(e) && abs(p)) this.openFiles(path.dirname(p)); });
    ipcMain.on('monitor:system', (e, what: unknown) => {
      if (!fromMonitor(e)) return;
      if (what === 'services') spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'mmc.exe'), ['services.msc'], { detached: true, stdio: 'ignore' }).unref();
      else if (what === 'startup') void shell.openExternal('ms-settings:startupapps');
      else if (what === 'taskmgr') spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'Taskmgr.exe'), [], { detached: true, stdio: 'ignore' }).unref();
    });
  }
}
