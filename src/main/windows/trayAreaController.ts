// A small, non-activating affordance for the Windows notification area when Orelle hides
// the taskbar. The other applications' icons remain owned and rendered by Explorer.
import { BrowserWindow, ipcMain, screen, shell, type IpcMainEvent } from 'electron';
import type { Settings } from '../../shared/types';
import type { TrayAreaState } from '../../shared/trayAreaModel';
import type { OrelleContext } from '../context';
import * as audio from '../native/audio';
import type { SystemService } from '../services/systemService';
import type { TaskbarService } from '../services/taskbarService';
import type { NotificationService } from '../services/notificationService';
import type { UpdateService } from '../services/updateService';
import { lockNavigation, openSurfaceWindow, whenReady } from './sharedHost';

const WIDTH = 420;
const HEIGHT = 38;
const GAP = 8;
const PEEK_SECONDS = 10;

export class TrayAreaController {
  private win: BrowserWindow | null = null;
  private creating = false;
  private restoreTimer: NodeJS.Timeout | null = null;
  private fullscreenHidden = false;
  private statsTimer: NodeJS.Timeout | null = null;
  private wifiTimer: NodeJS.Timeout | null = null;
  private stats: TrayAreaState['battery'] = null;
  private wifi: TrayAreaState['wifi'] = null;
  private windowsUpdatePending = false;
  private statsListener = (s: { battery: TrayAreaState['battery'] }) => {
    this.stats = s.battery;
    this.pushState();
  };

  /** The Dock's renderer is reused when available to keep the always-visible surfaces light. */
  host: () => BrowserWindow | null = () => null;

  constructor(
    private readonly ctx: OrelleContext,
    private readonly taskbar: TaskbarService,
    private readonly d: { system: SystemService; notifications: NotificationService; updates: UpdateService; toggleNotifications: () => void },
  ) {}

  get window() {
    return this.win;
  }

  isVisible() {
    return !!this.win?.isVisible();
  }

  start() {
    if (this.ctx.settings.get().general.taskbarMode === 'hidden') void this.create();
  }

  private async create() {
    if (this.win || this.creating) return;
    this.creating = true;
    const win = await openSurfaceWindow(this.ctx, 'trayarea', {
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
      title: 'Orelle Notification Area',
    }, this.host());
    this.creating = false;
    this.win = win;
    win.setAlwaysOnTop(true, 'pop-up-menu');
    lockNavigation(this.ctx, win, 'trayarea');
    whenReady(win, () => {
      this.layout();
      this.startPolling();
      this.pushState();
      if (!this.fullscreenHidden && this.ctx.settings.get().general.taskbarMode === 'hidden') win.showInactive();
    });
    win.on('closed', () => {
      this.stopPolling();
      this.win = null;
      if (this.restoreTimer) clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    });
  }

  destroy() {
    this.stopPolling();
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.restoreTimer = null;
    this.win?.destroy();
    this.win = null;
  }

  private startPolling() {
    if (this.statsTimer) return;
    this.d.system.on('stats', this.statsListener);
    this.d.system.subscribe('trayarea');
    void this.refreshWifi();
    void this.refreshWindowsUpdate();
    this.statsTimer = setInterval(() => this.pushState(), 5_000);
    this.wifiTimer = setInterval(() => void this.refreshWifi(), 30_000);
  }

  private stopPolling() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.wifiTimer) clearInterval(this.wifiTimer);
    this.statsTimer = null;
    this.wifiTimer = null;
    this.d.system.off('stats', this.statsListener);
    this.d.system.unsubscribe('trayarea');
  }

  private async refreshWifi() {
    this.wifi = await this.d.system.wifi();
    this.pushState();
  }

  private async refreshWindowsUpdate() {
    this.windowsUpdatePending = await this.d.system.windowsUpdatePending();
    this.pushState();
  }

  private pushState() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send('trayarea:state', this.state());
  }

  private state(): TrayAreaState {
    const updateState = this.d.updates.status.state;
    const volume = audio.getVolume();
    const microphone = audio.getMicrophone();
    return {
      wifi: this.wifi,
      volume: volume ? { level: volume.level, muted: volume.muted } : null,
      battery: this.stats,
      microphone: microphone ? { level: microphone.level, muted: microphone.muted } : null,
      keyboard: this.ctx.language === 'fr' ? 'FRA' : 'ENG',
      displayCount: screen.getAllDisplays().length,
      focus: this.d.notifications.focus,
      unread: this.d.notifications.unread(),
      windowsUpdatePending: this.windowsUpdatePending,
      orelleUpdateAvailable: updateState === 'available' || updateState === 'ready',
    };
  }

  layout() {
    if (!this.win) return;
    const area = screen.getPrimaryDisplay().workArea;
    this.win.setBounds({ x: area.x + area.width - WIDTH - GAP, y: area.y + area.height - HEIGHT - GAP, width: WIDTH, height: HEIGHT });
  }

  onSettingsChanged(next: Settings) {
    if (next.general.taskbarMode !== 'hidden') {
      if (this.win) this.destroy();
      return;
    }
    if (!this.win) void this.create();
    else this.layout();
  }

  onDisplaysChanged() {
    this.layout();
  }

  onFullscreenChanged(fullscreen: boolean) {
    this.fullscreenHidden = fullscreen;
    if (!this.win) return;
    if (fullscreen) this.win.hide();
    else if (this.ctx.settings.get().general.taskbarMode === 'hidden') {
      this.layout();
      this.win.showInactive();
    }
  }

  private showAfterPeek() {
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.restoreTimer = setTimeout(() => {
      this.restoreTimer = null;
      if (!this.fullscreenHidden && this.ctx.settings.get().general.taskbarMode === 'hidden') {
        this.layout();
        this.win?.showInactive();
      }
    }, PEEK_SECONDS * 1000);
  }

  registerIpc() {
    const from = (e: IpcMainEvent) => !!this.win && e.sender === this.win.webContents;
    ipcMain.on('trayarea:peek', (e) => {
      if (!from(e) || this.ctx.settings.get().general.taskbarMode !== 'hidden') return;
      this.taskbar.peek(PEEK_SECONDS);
      this.win?.hide();
      this.showAfterPeek();
    });
    ipcMain.on('trayarea:action', (e, action: unknown) => {
      if (!from(e)) return;
      if (action === 'network') void shell.openExternal('ms-settings:network-status');
      else if (action === 'microphone') {
        const mic = audio.getMicrophone();
        if (mic) { audio.setMicrophoneMuted(!mic.muted); this.pushState(); }
      }
      else if (action === 'keyboard') void shell.openExternal('ms-settings:regionlanguage');
      else if (action === 'display') void shell.openExternal('ms-settings:display');
      else if (action === 'volume') this.ctx.actions.toggleControlCenter();
      else if (action === 'battery') void shell.openExternal('ms-settings:batterysaver');
      else if (action === 'focus') {
        this.ctx.settings.update({ notifications: { focus: !this.d.notifications.focus } });
        this.pushState();
      }
      else if (action === 'notifications' || action === 'clock') this.d.toggleNotifications();
      else if (action === 'update') {
        if (this.windowsUpdatePending) void shell.openExternal('ms-settings:windowsupdate');
        else this.ctx.actions.openSettings('about');
      }
    });
  }
}
