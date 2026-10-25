// Screenshot tool (Ctrl+Alt+S, launcher, Orelle menu). The screen under the cursor is captured
// first (desktopCapturer), then shown frozen in a full-screen overlay where the user drags a
// region, clicks a window, or presses Enter for the whole screen. The result is saved as PNG in
// Pictures\Screenshots (or the chosen folder) and copied to the clipboard.
import { BrowserWindow, ClipboardItem, clipboard, desktopCapturer, ipcMain, screen, type Display, type IpcMainEvent, type NativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { OrelleContext } from '../context';
import * as w32 from '../native/win32';
import { log } from '../logger';

export class CaptureController {
  private win: BrowserWindow | null = null;
  private shot: { image: NativeImage; display: Display } | null = null;

  constructor(private readonly ctx: OrelleContext, private readonly notify: (file: string) => void) {}

  get window() {
    return this.win;
  }

  folder(): string {
    const custom = this.ctx.settings.get().capture.folder;
    return custom && fs.existsSync(custom) ? custom : path.join(app.getPath('pictures'), 'Screenshots');
  }

  /** Grabs the display under the cursor at its physical resolution. */
  private async grab(display: Display): Promise<NativeImage | null> {
    const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    return src && !src.thumbnail.isEmpty() ? src.thumbnail : null;
  }

  async start() {
    if (this.win?.isVisible()) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const image = await this.grab(display);
    if (!image) {
      log.warn('capture', 'Screen capture unavailable');
      return;
    }
    this.shot = { image, display };
    if (!this.win) {
      this.win = new BrowserWindow({
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        fullscreenable: false,
        backgroundColor: '#000000',
        title: 'Orelle Capture',
        webPreferences: { preload: this.ctx.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, additionalArguments: ['--orelle-surface=capture'] },
      });
      this.win.setAlwaysOnTop(true, 'screen-saver');
      this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      this.win.on('blur', () => this.cancel());
      this.win.on('closed', () => { this.win = null; });
      await this.win.loadFile(this.ctx.rendererFile('capture'));
    }
    this.win.setBounds(display.bounds);
    // Windows the user can click, top-most first, in overlay (CSS) coordinates.
    const s = display.scaleFactor;
    const b = screen.dipToScreenRect(null, display.bounds);
    const windows = this.ctx.tracker.list().filter((w) => !w.minimized).flatMap((w) => {
      const r = w32.getVisibleRect(w.hwnd);
      return r ? [{ x: (r.left - b.x) / s, y: (r.top - b.y) / s, w: (r.right - r.left) / s, h: (r.bottom - r.top) / s, title: w.title }] : [];
    });
    this.win.webContents.send('capture:frame', { image: image.toDataURL(), windows });
    this.win.show();
    this.win.focus();
    w32.focusWindow(Number(this.win.getNativeWindowHandle().readBigUInt64LE()));
  }

  private cancel() {
    this.win?.hide();
    this.shot = null;
  }

  /** Crops (CSS-pixel rect of the overlay), saves and copies. */
  private async finish(rect: { x: number; y: number; w: number; h: number } | null): Promise<string | null> {
    const shot = this.shot;
    this.cancel();
    if (!shot) return null;
    const s = shot.display.scaleFactor;
    const full = shot.image.getSize();
    const crop = rect
      ? {
        x: Math.max(0, Math.round(rect.x * s)),
        y: Math.max(0, Math.round(rect.y * s)),
        width: Math.min(full.width, Math.round(rect.w * s)),
        height: Math.min(full.height, Math.round(rect.h * s)),
      }
      : null;
    const img = crop && crop.width > 2 && crop.height > 2 ? shot.image.crop(crop) : shot.image;
    const png = img.toPNG();
    const dir = this.folder();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const file = path.join(dir, `Capture ${stamp}.png`);
    fs.writeFileSync(file, png);
    if (this.ctx.settings.get().capture.copy) {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    }
    log.info('capture', `Saved ${img.getSize().width}×${img.getSize().height}`);
    this.notify(file);
    return file;
  }

  registerIpc() {
    const from = (e: IpcMainEvent) => !!this.win && e.sender === this.win.webContents;
    ipcMain.on('capture:done', (e, rect: unknown) => {
      if (!from(e)) return;
      const r = rect as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | null;
      const ok = r && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite((r as Record<string, unknown>)[k]));
      void this.finish(ok ? (r as { x: number; y: number; w: number; h: number }) : null);
    });
    ipcMain.on('capture:cancel', (e) => from(e) && this.cancel());
  }
}
