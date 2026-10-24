// Top bar (menu bar): a thin non-activating strip along the top edge, reserved through the AppBar
// API so maximized windows stop below it. Left: Orelle menu, the app in front and its window
// actions, the active profile. Right: configurable status items (media, CPU, network, volume,
// battery, notifications, search, control center, taskbar peek, clock).
import { BrowserWindow, Menu, ipcMain, screen, shell, type Display, type IpcMainEvent, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import type { StringKey } from '../../shared/i18n';
import type { Settings, SystemStats } from '../../shared/types';
import type { OrelleContext } from '../context';
import * as audio from '../native/audio';
import * as w32 from '../native/win32';
import type { NotificationService } from '../services/notificationService';
import type { ProfileService } from '../services/profileService';
import type { SystemService } from '../services/systemService';
import type { TaskbarService } from '../services/taskbarService';
import { SNAP_HOTKEYS, type SnapTarget, type WindowService } from '../services/windowService';
import { log } from '../logger';

export const TOP_BAR_HEIGHT = 30;
// The window reaches a little below the reserved strip (transparent and click-through there):
// Windows enforces a minimum window height above 30 px, and Chromium moves windows that sit
// entirely outside the work area back into it.
const WINDOW_HEIGHT = 48;
const APPBAR_MSG = 0x0400 + 0x54; // WM_USER + 'T'

export interface TopBarState {
  app: { name: string; title: string; icon: string | null } | null;
  profile: { name: string; glyph: string } | null;
  unread: number;
  focus: boolean;
  volume: { level: number; muted: boolean } | null;
  stats: Pick<SystemStats, 'cpu' | 'netDown' | 'netUp' | 'battery'> | null;
  taskbarHidden: boolean;
}

export class TopBarController {
  private win: BrowserWindow | null = null;
  private hwnd = 0;
  private appBar = false;
  private appBarFailed = false;
  private fullscreenHidden = false;
  private volumeTimer: NodeJS.Timeout | null = null;
  private stats: TopBarState['stats'] = null;
  private statsOn = false;
  private pushQueued = false;
  private statsListener = (s: SystemStats) => {
    this.stats = { cpu: s.cpu, netDown: s.netDown, netUp: s.netUp, battery: s.battery };
    this.pushState();
  };

  constructor(
    private readonly ctx: OrelleContext,
    private readonly d: {
      system: SystemService;
      notifications: NotificationService;
      profiles: ProfileService;
      windows: WindowService;
      taskbar: TaskbarService;
      nameFor: (hwnd: number) => string | null;
      toggleMenu: () => void;
      toggleNotifications: () => void;
      toggleControl: () => void;
      toggleLauncher: () => void;
    },
  ) {}

  get window() {
    return this.win;
  }

  isVisible() {
    return !!this.win?.isVisible();
  }

  start() {
    if (this.ctx.settings.get().topBar.enabled) this.create();
  }

  private create() {
    const win = new BrowserWindow({
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
      title: 'Orelle Top Bar',
      webPreferences: {
        preload: this.ctx.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        additionalArguments: ['--orelle-surface=topbar'],
      },
    });
    this.win = win;
    this.hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE());
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.setIgnoreMouseEvents(true, { forward: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('render-process-gone', (_e, details) => {
      log.error('topbar', `Renderer gone (${details.reason}); reloading`);
      if (!win.isDestroyed()) setTimeout(() => !win.isDestroyed() && win.reload(), 500);
    });
    win.hookWindowMessage(APPBAR_MSG, (wParam) => {
      if (wParam.readUInt32LE(0) === 1) this.layout(); // ABN_POSCHANGED
    });
    win.once('ready-to-show', () => {
      this.layout();
      this.pushState();
      win.showInactive();
    });
    win.on('closed', () => {
      this.releaseAppBar();
      this.win = null;
    });
    void win.loadFile(this.ctx.rendererFile('topbar'));
    this.syncPolling();
  }

  destroy() {
    this.stopPolling();
    this.releaseAppBar();
    this.win?.destroy();
    this.win = null;
  }

  private display(): Display {
    const id = this.ctx.settings.get().topBar.display;
    return (id !== 'primary' && screen.getAllDisplays().find((x) => String(x.id) === id)) || screen.getPrimaryDisplay();
  }

  layout() {
    const win = this.win;
    if (!win) return;
    const display = this.display();
    let bounds = { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: WINDOW_HEIGHT };
    if (w32.win32Available() && !this.appBarFailed) {
      if (!this.appBar) {
        this.appBar = w32.appBarRegister(this.hwnd, APPBAR_MSG);
        if (!this.appBar) {
          this.appBarFailed = true;
          log.warn('topbar', 'AppBar registration failed; windows may cover the bar');
        }
      }
      if (this.appBar) {
        const phys = screen.dipToScreenRect(null, display.bounds);
        const t = Math.round(TOP_BAR_HEIGHT * display.scaleFactor);
        const granted = w32.appBarSetPos(this.hwnd, w32.ABE.top, { left: phys.x, top: phys.y, right: phys.x + phys.width, bottom: phys.y + t }, t);
        if (granted) {
          const g = screen.screenToDipRect(null, { x: granted.left, y: granted.top, width: granted.right - granted.left, height: granted.bottom - granted.top });
          bounds = { x: g.x, y: g.y, width: g.width, height: WINDOW_HEIGHT };
        }
      }
    }
    win.setBounds(bounds);
    const phys = screen.dipToScreenRect(null, bounds);
    w32.setWindowRect(this.hwnd, { left: phys.x, top: phys.y, right: phys.x + phys.width, bottom: phys.y + phys.height });
    log.debug('topbar', `layout on display ${display.id}`, w32.getWindowRect(this.hwnd));
  }

  private releaseAppBar() {
    if (this.appBar && this.hwnd) w32.appBarRemove(this.hwnd);
    this.appBar = false;
  }

  releaseAppBarSync() {
    try { this.releaseAppBar(); } catch { /* exiting */ }
  }

  onSettingsChanged(next: Settings, prev: Settings) {
    if (!next.topBar.enabled) {
      if (this.win) this.destroy();
      return;
    }
    if (!this.win) return this.create();
    if (next.topBar.display !== prev.topBar.display) this.layout();
    this.syncPolling();
    this.pushState();
  }

  onDisplaysChanged() {
    this.layout();
  }

  onFullscreenChanged(fullscreen: boolean) {
    if (!this.win) return;
    if (fullscreen && !this.fullscreenHidden) {
      this.fullscreenHidden = true;
      this.win.hide();
    } else if (!fullscreen && this.fullscreenHidden) {
      this.fullscreenHidden = false;
      this.win.showInactive();
    }
  }

  // ---------- State ----------

  private visibleItems() {
    return new Set(this.ctx.settings.get().topBar.items.filter((i) => i.visible).map((i) => i.id));
  }

  /** Samples only what a visible item needs. */
  private syncPolling() {
    const items = this.visibleItems();
    const wantStats = !!this.win && (items.has('cpu') || items.has('network') || items.has('battery'));
    if (wantStats !== this.statsOn) {
      this.statsOn = wantStats;
      if (wantStats) {
        this.d.system.on('stats', this.statsListener);
        this.d.system.subscribe('topbar');
      } else {
        this.d.system.off('stats', this.statsListener);
        this.d.system.unsubscribe('topbar');
        this.stats = null;
      }
    }
    const wantVolume = !!this.win && items.has('volume');
    if (wantVolume && !this.volumeTimer) this.volumeTimer = setInterval(() => this.pushState(), 5000);
    else if (!wantVolume && this.volumeTimer) {
      clearInterval(this.volumeTimer);
      this.volumeTimer = null;
    }
  }

  private stopPolling() {
    if (this.statsOn) {
      this.d.system.off('stats', this.statsListener);
      this.d.system.unsubscribe('topbar');
      this.statsOn = false;
    }
    if (this.volumeTimer) clearInterval(this.volumeTimer);
    this.volumeTimer = null;
  }

  /** Coalesced: foreground and title changes can come in bursts. */
  pushState() {
    if (!this.win || this.pushQueued) return;
    this.pushQueued = true;
    setTimeout(() => {
      this.pushQueued = false;
      this.win?.webContents.send('topbar:state', this.state());
    }, 30);
  }

  private state(): TopBarState {
    const hwnd = this.d.windows.target();
    const w = hwnd ? this.ctx.tracker.list().find((x) => x.hwnd === hwnd) : undefined;
    let app: TopBarState['app'] = null;
    if (w) {
      const entry = this.ctx.apps.entryFor({ appId: w.aumid, exe: w.exe });
      app = {
        name: this.d.nameFor(w.hwnd) ?? (path.basename(w.exe || '', '.exe') || w.title),
        title: w.title,
        icon: entry ? this.ctx.apps.iconFor(entry.appId) : w.exe ? this.ctx.icons.get(w.exe) : null,
      };
    }
    const p = this.d.profiles.active;
    const vol = this.visibleItems().has('volume') ? audio.getVolume() : null;
    return {
      app,
      profile: p ? { name: p.name, glyph: p.glyph } : null,
      unread: this.d.notifications.unread(),
      focus: this.d.notifications.focus,
      volume: vol ? { level: vol.level, muted: vol.muted } : null,
      stats: this.stats,
      taskbarHidden: this.ctx.settings.get().general.taskbarMode === 'hidden',
    };
  }

  // ---------- Menus ----------

  private popup(template: MenuItemConstructorOptions[], x?: number) {
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: this.win ?? undefined, x: x !== undefined ? Math.round(x) : undefined, y: TOP_BAR_HEIGHT });
  }

  private appMenu(x: number) {
    const t = this.ctx.t;
    const hwnd = this.d.windows.target();
    const snap = (target: SnapTarget): MenuItemConstructorOptions => ({
      label: t(`windows.snap.${target}` as StringKey),
      accelerator: this.ctx.settings.get().windows.snapping ? SNAP_HOTKEYS[target] : undefined,
      registerAccelerator: false,
      enabled: !!hwnd,
      click: () => hwnd && this.d.windows.snap(target, hwnd),
    });
    const layouts = this.ctx.settings.get().windows.layouts;
    this.popup([
      snap('maximize'),
      { label: t('windows.snap.minimize'), enabled: !!hwnd, click: () => hwnd && this.d.windows.snap('minimize', hwnd) },
      snap('center'),
      { type: 'separator' },
      { label: t('windows.halves'), submenu: [snap('left'), snap('right'), snap('top'), snap('bottom')] },
      { label: t('windows.quarters'), submenu: [snap('topLeft'), snap('topRight'), snap('bottomLeft'), snap('bottomRight')] },
      { label: t('windows.thirds'), submenu: [snap('leftThird'), snap('centerThird'), snap('rightThird'), { type: 'separator' }, snap('leftTwoThirds'), snap('rightTwoThirds')] },
      { type: 'separator' },
      {
        label: t('windows.layouts'),
        submenu: [
          { label: t('windows.saveCurrent'), click: () => void this.d.windows.execute('@save') },
          ...(layouts.length ? [{ type: 'separator' as const }] : []),
          ...layouts.slice(0, 12).map((l) => ({ label: `${l.name} (${l.windows.length})`, click: () => void this.d.windows.restore(l.id, true) })),
        ],
      },
      { type: 'separator' },
      { label: t('windows.close'), enabled: !!hwnd, click: () => hwnd && this.d.windows.snap('close', hwnd) },
    ], x);
  }

  private profilesMenu(x: number) {
    const s = this.ctx.settings.get().profiles;
    this.popup([
      ...s.list.map((p) => ({ label: p.name, type: 'checkbox' as const, checked: s.active === p.id, click: () => this.d.profiles.toggle(p.id) })),
      { type: 'separator' },
      { label: this.ctx.t('profiles.manage'), click: () => this.ctx.actions.openSettings('profiles') },
    ], x);
  }

  registerIpc() {
    const from = (e: IpcMainEvent) => !!this.win && e.sender === this.win.webContents;
    ipcMain.on('topbar:action', (e, action: unknown, x: unknown) => {
      if (!from(e)) return;
      const px = typeof x === 'number' && Number.isFinite(x) ? x : undefined;
      switch (action) {
        case 'menu': this.d.toggleMenu(); break;
        case 'app': this.appMenu(px ?? 0); break;
        case 'profile': this.profilesMenu(px ?? 0); break;
        case 'notifications':
        case 'clock': this.d.toggleNotifications(); break;
        case 'control':
        case 'volume': this.d.toggleControl(); break;
        case 'search': this.d.toggleLauncher(); break;
        case 'taskbar': this.d.taskbar.peek(); break;
        case 'cpu': this.ctx.actions.openApp('monitor'); break;
        case 'network': void shell.openExternal('ms-settings:network-status'); break;
        case 'battery': void shell.openExternal('ms-settings:batterysaver'); break;
        case 'playPause': w32.sendMediaKey('playPause'); break;
        case 'next': w32.sendMediaKey('next'); break;
        case 'previous': w32.sendMediaKey('previous'); break;
      }
    });
    ipcMain.on('topbar:interactive', (e, on: unknown) => {
      if (from(e)) this.win?.setIgnoreMouseEvents(!on, { forward: true });
    });
    ipcMain.on('topbar:volume', (e, delta: unknown) => {
      if (!from(e) || typeof delta !== 'number') return;
      const v = audio.getVolume();
      if (v) audio.setVolume(Math.max(0, Math.min(100, v.level + Math.sign(delta) * 2)));
      this.pushState();
    });
    ipcMain.on('topbar:context', (e) => {
      if (!from(e)) return;
      this.popup([
        { label: this.ctx.t('topbar.customize'), click: () => this.ctx.actions.openSettings('topbar') },
        { label: this.ctx.t('topbar.hide'), click: () => this.ctx.settings.update({ topBar: { enabled: false } }) },
      ]);
    });
  }
}
