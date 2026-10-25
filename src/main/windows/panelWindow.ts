// A pop-over panel (Orelle menu, notification center): Acrylic, frameless, hidden when it loses
// focus, created on first use, kept loaded (and trimmed) while closed so it reopens instantly, freed after a long idle.
import { BrowserWindow, type Rectangle } from 'electron';
import type { SurfaceKind } from '../../shared/types';
import type { OrelleContext } from '../context';
import * as w32 from '../native/win32';

/** How long a closed panel stays loaded (hidden and trimmed) before being freed; set by main. */
export const panelTiming = { releaseAfter: 60_000 };

export class PanelWindow {
  private win: BrowserWindow | null = null;
  private shownAt = 0;
  private hiddenAt = 0;
  private releaseTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ctx: OrelleContext,
    private readonly surface: SurfaceKind,
    private readonly title: string,
    private readonly bounds: () => Rectangle,
    private readonly hooks: { onShow?: () => void; onHide?: () => void } = {},
  ) {}

  get window() {
    return this.win;
  }

  isVisible() {
    return !!this.win?.isVisible();
  }

  send(channel: string, ...args: unknown[]) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, ...args);
  }

  private create() {
    const effects = this.ctx.settings.get().appearance.effects;
    const b = this.bounds();
    const win = new BrowserWindow({
      ...b,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: this.title,
      backgroundColor: '#00000000',
      backgroundMaterial: effects === 'off' ? 'none' : 'acrylic',
      webPreferences: {
        preload: this.ctx.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        additionalArguments: [`--orelle-surface=${this.surface}`],
      },
    });
    this.win = win;
    w32.setRoundedCorners(Number(win.getNativeWindowHandle().readBigUInt64LE()));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('blur', () => {
      if (Date.now() - this.shownAt > 200) this.hide();
    });
    win.webContents.on('render-process-gone', () => {
      this.win = null;
      if (!win.isDestroyed()) win.destroy();
    });
    void win.loadFile(this.ctx.rendererFile(this.surface));
  }

  /** Creates the window without showing it, so the next show is instant. */
  prewarm() {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    if (!this.win) this.create();
  }

  toggle() {
    // A click on the top bar button that opened the panel first blurs it (hiding it): don't reopen.
    if (this.isVisible() || Date.now() - this.hiddenAt < 250) this.hide();
    else this.show();
  }

  show() {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    if (!this.win) {
      this.create();
      this.win!.once('ready-to-show', () => this.show());
      return;
    }
    const win = this.win;
    win.setBounds(this.bounds());
    this.shownAt = Date.now();
    this.hooks.onShow?.();
    win.webContents.send('panel:show');
    win.show();
    win.focus();
    w32.focusWindow(Number(win.getNativeWindowHandle().readBigUInt64LE()));
  }

  hide() {
    if (this.win?.isVisible()) {
      this.win.hide();
      this.hiddenAt = Date.now();
      this.hooks.onHide?.();
    }
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => this.release(), panelTiming.releaseAfter);
  }

  release() {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    if (this.win && !this.win.isVisible()) {
      this.win.destroy();
      this.win = null;
    }
  }

  onEffectsChanged() {
    this.win?.setBackgroundMaterial(this.ctx.settings.get().appearance.effects === 'off' ? 'none' : 'acrylic');
  }
}
