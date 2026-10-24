import { Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import type { OrelleContext } from './context';

export class OrelleTray {
  private tray: Tray | null = null;

  constructor(private readonly ctx: OrelleContext, private readonly iconsDir: string, private readonly quit: () => void) {}

  sync() {
    const want = this.ctx.settings.get().general.showTrayIcon;
    if (want && !this.tray) this.create();
    else if (!want && this.tray) { this.tray.destroy(); this.tray = null; }
    else if (this.tray) this.tray.setContextMenu(this.menu());
  }

  private create() {
    const img = nativeImage.createFromPath(path.join(this.iconsDir, 'tray.png'));
    img.addRepresentation({ scaleFactor: 2, buffer: nativeImage.createFromPath(path.join(this.iconsDir, 'tray@2x.png')).toPNG() });
    this.tray = new Tray(img);
    this.tray.setToolTip('Orelle');
    this.tray.setContextMenu(this.menu());
    this.tray.on('click', () => this.ctx.actions.toggleLauncher());
  }

  private menu() {
    const t = this.ctx.t;
    return Menu.buildFromTemplate([
      { label: t('tray.launcher'), click: () => this.ctx.actions.toggleLauncher() },
      { label: t('tray.control'), click: () => this.ctx.actions.toggleControlCenter() },
      { label: t('tray.widgets'), click: () => this.ctx.actions.editWidgets() },
      { label: t('tray.toggleDock'), click: () => this.ctx.actions.toggleDock() },
      { label: t('tray.settings'), click: () => this.ctx.actions.openSettings() },
      { type: 'separator' },
      { label: t('tray.quit'), click: this.quit },
    ]);
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
  }
}
