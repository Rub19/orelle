// A small, non-activating affordance for the Windows notification area when Orelle hides
// the taskbar. The other applications' icons remain owned and rendered by Explorer.
import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron';
import type { Settings } from '../../shared/types';
import type { OrelleContext } from '../context';
import type { TaskbarService } from '../services/taskbarService';
import { lockNavigation, openSurfaceWindow, whenReady } from './sharedHost';

const WIDTH = 48;
const HEIGHT = 36;
const GAP = 8;
const PEEK_SECONDS = 10;

export class TrayAreaController {
  private win: BrowserWindow | null = null;
  private creating = false;
  private restoreTimer: NodeJS.Timeout | null = null;
  private fullscreenHidden = false;

  /** The Dock's renderer is reused when available to keep the always-visible surfaces light. */
  host: () => BrowserWindow | null = () => null;

  constructor(private readonly ctx: OrelleContext, private readonly taskbar: TaskbarService) {}

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
      if (!this.fullscreenHidden && this.ctx.settings.get().general.taskbarMode === 'hidden') win.showInactive();
    });
    win.on('closed', () => {
      this.win = null;
      if (this.restoreTimer) clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    });
  }

  destroy() {
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.restoreTimer = null;
    this.win?.destroy();
    this.win = null;
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
  }
}
