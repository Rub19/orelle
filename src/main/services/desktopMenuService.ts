// Orelle desktop menu (opt-in, Preferences › General). A right-click on an empty spot of the
// desktop shows Orelle's menu; Windows' own menu stays one click away ("More options") and
// right-clicks on icons are never taken. Icon positions come from UI Automation (shell helper,
// read-only) and are refreshed every 20 s while the option is on.
import { BrowserWindow, Menu, app, dialog, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { OrelleContext } from '../context';
import { DesktopClickHook, type IconRect } from '../native/mouse';
import { runShellHelper } from './shellBridge';
import { log } from '../logger';

export class DesktopMenuService {
  private hook: DesktopClickHook;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly ctx: OrelleContext, private readonly extra: { editWidgets: () => void; mission: () => void; capture: () => void }) {
    this.hook = new DesktopClickHook((x, y) => void this.show(x, y));
  }

  sync() {
    const want = this.ctx.settings.get().general.desktopMenu;
    if (want && !this.hook.active) {
      void this.refresh().then(() => this.hook.start());
      this.timer = setInterval(() => void this.refresh(), 20_000);
    } else if (!want && this.hook.active) this.stop();
  }

  stop() {
    this.hook.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async refresh() {
    try {
      const raw = JSON.parse(await runShellHelper('desktopicons', this.ctx.icons.cacheDir, undefined, 15_000)) as { listView?: number; icons?: IconRect[] };
      this.hook.listView = Number(raw.listView) || 0;
      this.hook.icons = Array.isArray(raw.icons) ? raw.icons : [];
    } catch (err) {
      log.debug('desktop', 'Desktop icons unavailable', err);
    }
  }

  private async show(x: number, y: number) {
    const t = this.ctx.t;
    const dip = screen.screenToDipPoint({ x, y });
    // A 1×1 window at the click gives the menu a foreground owner (so it closes like any menu).
    const host = new BrowserWindow({ x: Math.round(dip.x), y: Math.round(dip.y), width: 1, height: 1, frame: false, transparent: true, skipTaskbar: true, alwaysOnTop: true, show: false, focusable: true, webPreferences: { sandbox: true } });
    host.showInactive();
    host.focus();
    const desktopDir = app.getPath('desktop');
    const menu = Menu.buildFromTemplate([
      { label: t('desktopMenu.wallpaper'), click: async () => {
        const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp'] }] });
        if (!r.canceled && r.filePaths[0]) this.ctx.settings.update({ appearance: { wallpaper: r.filePaths[0] } });
      } },
      { label: t('desktopMenu.widgets'), click: () => this.extra.editWidgets() },
      { label: t('desktopMenu.studio'), click: () => this.ctx.actions.openSettings('studio') },
      { type: 'separator' },
      { label: t('desktopMenu.newFolder'), click: () => {
        let name = t('desktopMenu.folderName');
        for (let i = 2; fs.existsSync(path.join(desktopDir, name)); i++) name = `${t('desktopMenu.folderName')} (${i})`;
        try { fs.mkdirSync(path.join(desktopDir, name)); } catch (err) { log.warn('desktop', 'Cannot create folder', err); }
      } },
      { label: t('desktopMenu.mission'), click: () => this.extra.mission() },
      { label: t('desktopMenu.capture'), click: () => setTimeout(() => this.extra.capture(), 200) },
      { type: 'separator' },
      { label: t('desktopMenu.display'), click: () => void shell.openExternal('ms-settings:display') },
      { label: t('desktopMenu.personalize'), click: () => void shell.openExternal('ms-settings:personalization') },
      { label: t('desktopMenu.preferences'), click: () => this.ctx.actions.openSettings() },
      { type: 'separator' },
      { label: t('desktopMenu.more'), click: () => setTimeout(() => this.hook.windowsMenu(x, y), 120) },
    ]);
    menu.popup({ window: host, x: 0, y: 0, callback: () => setTimeout(() => !host.isDestroyed() && host.destroy(), 50) });
  }
}
