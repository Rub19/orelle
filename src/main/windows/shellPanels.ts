// The Orelle menu (an alternative Start menu: search, pinned apps, every installed app, profiles,
// power) and the notification center (Orelle's notifications + calendar). Both are PanelWindows
// anchored under the top bar when it is on, otherwise above the Dock.
import { ipcMain, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import os from 'node:os';
import type { OrelleContext } from '../context';
import { launchApp, safeLaunch } from '../services/launchService';
import type { NotificationService } from '../services/notificationService';
import type { ProfileService } from '../services/profileService';
import type { SearchService } from '../services/searchService';
import { PanelWindow } from './panelWindow';
import * as w32 from '../native/win32';

function workArea(ctx: OrelleContext) {
  const s = ctx.settings.get();
  const id = s.topBar.enabled ? s.topBar.display : null;
  const d = (id && id !== 'primary' && screen.getAllDisplays().find((x) => String(x.id) === id)) || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return { wa: d.workArea, top: s.topBar.enabled };
}

export interface MenuApp { id: string; name: string; icon: string | null }

export class MenuController {
  readonly panel: PanelWindow;

  constructor(private readonly ctx: OrelleContext, private readonly search: SearchService, private readonly profiles: ProfileService) {
    this.panel = new PanelWindow(ctx, 'menu', 'Orelle Menu', () => {
      const { wa, top } = workArea(ctx);
      const width = Math.min(680, wa.width - 24);
      const height = Math.min(640, wa.height - 24);
      // Under the Orelle button of the top bar, or centred above the Dock like the Start menu.
      return top
        ? { x: wa.x + 8, y: wa.y + 6, width, height }
        : { x: Math.round(wa.x + (wa.width - width) / 2), y: wa.y + wa.height - height - 12, width, height };
    });
  }

  toggle() {
    this.panel.toggle();
  }

  private data() {
    const s = this.ctx.settings.get();
    const apps: MenuApp[] = this.ctx.apps.entries()
      .map((a) => ({ id: a.appId, name: a.name, icon: this.ctx.apps.iconFor(a.appId) }))
      .sort((a, b) => a.name.localeCompare(b.name, this.ctx.language));
    const pinned: MenuApp[] = [];
    for (const item of s.dock.items) {
      if (item.type !== 'app') continue;
      const a = this.ctx.apps.entryFor({ appId: item.appId, exe: item.path });
      if (a && !pinned.some((p) => p.id === a.appId)) pinned.push({ id: a.appId, name: a.name, icon: this.ctx.apps.iconFor(a.appId) });
    }
    for (const rec of this.ctx.usage.recent('app:', 24)) {
      if (pinned.length >= 18) break;
      const a = this.ctx.apps.entryFor({ appId: rec.id.slice(4) });
      if (a && !pinned.some((p) => p.id === a.appId)) pinned.push({ id: a.appId, name: a.name, icon: this.ctx.apps.iconFor(a.appId) });
    }
    let user = '';
    try { user = os.userInfo().username; } catch { /* unavailable */ }
    return {
      apps,
      pinned: pinned.slice(0, 18),
      profiles: s.profiles.list.map((p) => ({ id: p.id, name: p.name, glyph: p.glyph, on: s.profiles.active === p.id })),
      user,
    };
  }

  registerIpc() {
    const from = (e: IpcMainEvent | IpcMainInvokeEvent) => !!this.panel.window && e.sender === this.panel.window.webContents;
    ipcMain.handle('menu:data', (e) => (from(e) ? this.data() : null));
    ipcMain.handle('menu:launch', async (e, appId: unknown) => {
      if (!from(e) || typeof appId !== 'string') return false;
      const a = this.ctx.apps.findByAppId(appId);
      if (!a) return false;
      this.panel.hide();
      const ok = await safeLaunch(() => launchApp({ appId: a.appId, path: a.target ?? undefined }), a.name);
      if (ok) this.ctx.usage.record(`app:${a.appId}`.toLowerCase(), a.name, { appId: a.appId, path: a.target ?? undefined });
      return ok;
    });
    ipcMain.on('menu:pin', (e, appId: unknown) => {
      if (!from(e) || typeof appId !== 'string') return;
      const a = this.ctx.apps.findByAppId(appId);
      if (a) this.ctx.actions.pinToDock({ appId: a.appId, path: a.target ?? undefined, name: a.name });
    });
    ipcMain.on('menu:profile', (e, id: unknown) => {
      if (from(e) && typeof id === 'string') this.profiles.toggle(id);
      setTimeout(() => this.panel.send('menu:refresh'), 300);
    });
    ipcMain.on('menu:action', (e, action: unknown) => {
      if (!from(e) || typeof action !== 'string') return;
      this.panel.hide();
      if (['lock', 'sleep', 'restart', 'shutdown', 'signout'].includes(action)) void this.search.system(action);
      else if (action === 'settings') this.ctx.actions.openSettings();
      else if (action === 'files' || action === 'monitor') this.ctx.actions.openApp(action);
      else if (action === 'launcher') this.ctx.actions.toggleLauncher();
      // The real Start menu stays one click away.
      else if (action === 'windowsStart') setTimeout(() => w32.openStartMenu(), 150);
    });
    ipcMain.on('menu:hide', (e) => from(e) && this.panel.hide());
  }
}

export class NotificationCenterController {
  readonly panel: PanelWindow;

  constructor(private readonly ctx: OrelleContext, private readonly notifications: NotificationService) {
    this.panel = new PanelWindow(ctx, 'notifications', 'Orelle Notifications', () => {
      const { wa, top } = workArea(ctx);
      const width = 380;
      const height = Math.min(720, wa.height - 16);
      return { x: wa.x + wa.width - width - 8, y: top ? wa.y + 6 : wa.y + wa.height - height - 8, width, height };
    }, { onHide: () => this.notifications.markAllRead() });
    notifications.on('change', () => this.panel.send('notifications:changed'));
  }

  toggle() {
    this.panel.toggle();
  }

  registerIpc() {
    const from = (e: IpcMainEvent | IpcMainInvokeEvent) => !!this.panel.window && e.sender === this.panel.window.webContents;
    ipcMain.handle('notifications:list', (e) => (from(e) ? this.notifications.list() : null));
    ipcMain.on('notifications:activate', (e, id: unknown) => {
      if (!from(e) || typeof id !== 'string') return;
      this.panel.hide();
      this.notifications.activate(id);
    });
    ipcMain.on('notifications:remove', (e, id: unknown) => from(e) && typeof id === 'string' && this.notifications.remove(id));
    ipcMain.on('notifications:clear', (e) => from(e) && this.notifications.clear());
    ipcMain.on('notifications:open', (e, what: unknown) => {
      if (!from(e)) return;
      this.panel.hide();
      if (what === 'windows') void shell.openExternal('ms-actioncenter:');
      else if (what === 'calendar') void shell.openExternal('outlookcal:').catch(() => shell.openExternal('ms-settings:dateandtime'));
      else if (what === 'settings') this.ctx.actions.openSettings('notifications');
    });
    ipcMain.on('notifications:hide', (e) => from(e) && this.panel.hide());
  }
}

