// Desktop widgets: one transparent layer per Orelle (not one window per widget, to keep memory low),
// kept at the bottom of the z-order and click-through everywhere except on the widgets themselves.
import { BrowserWindow, ipcMain, screen, shell, type Display, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WIDGET_SIZES } from '../../shared/settings';
import type { Settings, WidgetInstance, WidgetType } from '../../shared/types';
import type { OrelleContext } from '../context';
import * as w32 from '../native/win32';
import { launchApp, safeLaunch } from '../services/launchService';
import type { ScreenTimeService } from '../services/screenTimeService';
import type { SystemService } from '../services/systemService';
import type { WeatherService } from '../services/weatherService';
import { log } from '../logger';
import { lockNavigation, openSurfaceWindow, whenReady } from './sharedHost';

const SYS32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');

export class WidgetsController {
  private win: BrowserWindow | null = null;
  private hwnd = 0;
  private editing = false;
  private statsListener = (s: unknown) => this.win?.webContents.send('widgets:stats', s);

  constructor(
    private readonly ctx: OrelleContext,
    private readonly system: SystemService,
    private readonly weather: WeatherService,
    private readonly screenTime: ScreenTimeService,
  ) {}

  get window() {
    return this.win;
  }

  start() {
    const s = this.ctx.settings.get();
    if (!s.widgets.enabled) return;
    this.seed();
    void this.create();
  }

  /** The Dock's window, whose renderer process the widget layer shares (set by main). */
  host: () => BrowserWindow | null = () => null;
  private creating = false;

  /** First run: a clock and a system monitor in the top-right corner. */
  private seed() {
    const s = this.ctx.settings.get();
    if (s.widgets.seeded) return;
    const wa = this.display().workArea;
    const mk = (type: WidgetType, y: number, config: Record<string, unknown> = {}): WidgetInstance => ({
      id: randomUUID(), type, x: wa.width - WIDGET_SIZES[type].w - 28, y, ...WIDGET_SIZES[type], opacity: 1, hidden: false, config,
    });
    const clock = mk('clock', 28, { style: 'digital' });
    const sys = mk('system', 28 + clock.h + 16);
    this.ctx.settings.update({ widgets: { seeded: true, items: s.widgets.items.length ? s.widgets.items : [clock, sys] } });
  }

  private display(): Display {
    const id = this.ctx.settings.get().widgets.display;
    return screen.getAllDisplays().find((d) => String(d.id) === id) ?? screen.getPrimaryDisplay();
  }

  private async create() {
    if (this.win || this.creating) return;
    this.creating = true;
    const win = await openSurfaceWindow(this.ctx, 'widgets', {
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
      hasShadow: false,
      title: 'Orelle Widgets',
      webPreferences: { backgroundThrottling: true },
    }, this.host());
    this.creating = false;
    this.win = win;
    this.hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE());
    win.setIgnoreMouseEvents(true, { forward: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    lockNavigation(this.ctx, win, 'widgets');
    win.webContents.on('render-process-gone', (_e, d) => {
      log.error('widgets', `Renderer gone (${d.reason}); reloading`);
      setTimeout(() => !win.isDestroyed() && win.reload(), 500);
    });
    // Widgets live on the desktop: whenever the layer loses focus it goes back under every window.
    win.on('blur', () => w32.sendToBottom(this.hwnd));
    whenReady(win, () => {
      this.layout();
      if (!w32.attachToDesktop(this.hwnd)) log.warn('widgets', 'Could not attach the widget layer to the desktop');
      win.showInactive();
      w32.sendToBottom(this.hwnd);
    });
    win.on('closed', () => {
      this.system.unsubscribe('widgets');
      this.system.off('stats', this.statsListener);
      this.win = null;
    });
  }

  destroy() {
    this.win?.destroy();
    this.win = null;
  }

  layout() {
    if (!this.win) return;
    this.win.setBounds(this.display().workArea);
  }

  onSettingsChanged(next: Settings, prev: Settings) {
    if (!next.widgets.enabled) {
      this.destroy();
      return;
    }
    if (!this.win) return this.start();
    if (next.widgets.display !== prev.widgets.display) this.layout();
  }

  setEditing(on: boolean) {
    if (!this.win) {
      if (!on) return;
      this.ctx.settings.update({ widgets: { enabled: true } });
    }
    this.editing = on;
    this.win?.webContents.send('widgets:edit', on);
    if (on && this.win) {
      this.win.showInactive();
      this.win.focus();
    }
  }

  toggleEditing() {
    this.setEditing(!this.editing);
  }

  registerIpc() {
    const fromWidgets = (e: IpcMainEvent | IpcMainInvokeEvent) => !!this.win && e.sender === this.win.webContents;

    ipcMain.on('widgets:interactive', (e, on: boolean) => {
      if (fromWidgets(e)) this.win!.setIgnoreMouseEvents(!on, { forward: true });
    });
    ipcMain.on('widgets:edit', (e, on: boolean) => {
      if (fromWidgets(e)) this.setEditing(!!on);
    });
    ipcMain.on('widgets:subscribeStats', (e, on: boolean) => {
      if (!fromWidgets(e)) return;
      this.system.off('stats', this.statsListener);
      if (on) {
        this.system.on('stats', this.statsListener);
        this.system.subscribe('widgets');
        if (this.system.stats) this.statsListener(this.system.stats);
      } else this.system.unsubscribe('widgets');
    });
    ipcMain.handle('widgets:weather', async (e, force: unknown) => {
      if (!fromWidgets(e)) return null;
      const w = this.ctx.settings.get().widgets.weather;
      if (w.latitude === null || w.longitude === null) return null;
      return this.weather.get(w.city, w.latitude, w.longitude, w.unit, force === true);
    });
    ipcMain.handle('widgets:recentApps', (e) => {
      if (!fromWidgets(e)) return [];
      return this.ctx.usage
        .recent('app:', 12)
        .filter((r) => r.ref)
        .slice(0, 8)
        .map((r) => {
          const app = this.ctx.apps.entryFor({ appId: r.ref?.appId, exe: r.ref?.path });
          return { id: r.id, name: r.title, icon: app ? this.ctx.apps.iconFor(app.appId, true) : r.ref?.path ? this.ctx.icons.get(r.ref.path, true) : null };
        });
    });
    ipcMain.handle('widgets:launchRecent', async (e, id: unknown) => {
      if (!fromWidgets(e) || typeof id !== 'string') return false;
      const rec = this.ctx.usage.recent('app:', 50).find((r) => r.id === id);
      if (!rec?.ref) return false;
      const ok = await safeLaunch(() => launchApp(rec.ref!), rec.title);
      if (ok) this.ctx.usage.record(rec.id, rec.title, rec.ref);
      return ok;
    });
    ipcMain.handle('widgets:screenTime', (e) => (fromWidgets(e) ? this.screenTime.today(6) : []));
    ipcMain.on('widgets:media', (e, key: unknown) => {
      if (fromWidgets(e) && (key === 'playPause' || key === 'next' || key === 'previous')) w32.sendMediaKey(key);
    });
    ipcMain.handle('widgets:open', async (e, target: unknown) => {
      if (!fromWidgets(e) || typeof target !== 'string') return false;
      if (/^https?:\/\//i.test(target)) return safeLaunch(() => shell.openExternal(target), target);
      if (path.isAbsolute(target) && fs.existsSync(target)) return safeLaunch(async () => { const err = await shell.openPath(target); if (err) throw new Error(err); }, target);
      return false;
    });
    ipcMain.handle('widgets:shortcutIcon', (e, target: unknown) => {
      if (!fromWidgets(e) || typeof target !== 'string' || !path.isAbsolute(target)) return null;
      return this.ctx.icons.get(target, true);
    });
    // Fixed system destinations only (clock → Alarms & Clock, calendar → Calendar, system → Task Manager).
    ipcMain.on('widgets:openSystem', (e, what: unknown) => {
      if (!fromWidgets(e)) return;
      if (what === 'clock') spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe'), ['shell:AppsFolder\\Microsoft.WindowsAlarms_8wekyb3d8bbwe!App'], { detached: true, stdio: 'ignore' }).unref();
      else if (what === 'calendar') void shell.openExternal('outlookcal:');
      else if (what === 'system') spawn(path.join(SYS32, 'Taskmgr.exe'), [], { detached: true, stdio: 'ignore' }).unref();
      else if (what === 'network') void shell.openExternal('ms-settings:network-status');
      else if (what === 'battery') void shell.openExternal('ms-settings:batterysaver');
    });
  }
}
