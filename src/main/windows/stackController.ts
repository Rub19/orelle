// Dock folder stacks: clicking a folder in the Dock fans its latest items out in a pop-over above
// the icon (like macOS stacks) instead of opening a window. Items open with their default app; the
// folder itself is one click away in Orelle Files or Explorer. Read-only.
import { ipcMain, nativeImage, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { OrelleContext } from '../context';
import { openPath, safeLaunch } from '../services/launchService';
import { PanelWindow } from './panelWindow';

const MAX_ITEMS = 60;
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|heic)$/i;

export interface StackItem { path: string; name: string; dir: boolean; mtime: number; icon: string | null; thumb: string | null }

export class StackController {
  readonly panel: PanelWindow;
  private folder = '';
  private anchor: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  constructor(private readonly ctx: OrelleContext) {
    this.panel = new PanelWindow(ctx, 'stack', 'Orelle Stack', () => {
      const d = screen.getDisplayNearestPoint({ x: this.anchor.x, y: this.anchor.y });
      const wa = d.workArea;
      const width = 440;
      const height = Math.min(500, wa.height - 24);
      const pos = this.ctx.settings.get().dock.position;
      const cx = this.anchor.x + this.anchor.width / 2;
      const cy = this.anchor.y + this.anchor.height / 2;
      const clampX = (x: number) => Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - width - 8));
      const clampY = (y: number) => Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - height - 8));
      if (pos === 'left') return { x: this.anchor.x + this.anchor.width + 10, y: clampY(cy - height / 2), width, height };
      if (pos === 'right') return { x: this.anchor.x - width - 10, y: clampY(cy - height / 2), width, height };
      return { x: clampX(cx - width / 2), y: this.anchor.y - height - 10, width, height };
    });
  }

  /** Shows the stack of `folder` next to the Dock icon at `anchor` (screen DIP). */
  open(folder: string, anchor: Rectangle) {
    const same = this.folder === folder && this.panel.isVisible();
    this.folder = folder;
    this.anchor = anchor;
    if (same) this.panel.hide();
    else {
      this.panel.send('stack:refresh');
      this.panel.show();
    }
  }

  private async items(): Promise<StackItem[]> {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(this.folder, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: StackItem[] = [];
    for (const d of entries) {
      if (d.name.startsWith('.') || /^desktop\.ini$/i.test(d.name) || d.isSymbolicLink()) continue;
      const p = path.join(this.folder, d.name);
      try {
        const st = await fs.promises.stat(p);
        out.push({ path: p, name: d.name, dir: st.isDirectory(), mtime: st.mtimeMs, icon: null, thumb: null });
      } catch { /* vanished or locked */ }
    }
    out.sort((a, b) => b.mtime - a.mtime);
    const shown = out.slice(0, MAX_ITEMS);
    for (const it of shown) it.icon = this.ctx.icons.get(it.path);
    // Real previews for the most recent images (Windows thumbnail cache).
    await Promise.all(shown.filter((i) => IMAGE.test(i.name)).slice(0, 24).map(async (i) => {
      try {
        const img = await nativeImage.createThumbnailFromPath(i.path, { width: 160, height: 160 });
        if (!img.isEmpty()) i.thumb = img.toDataURL();
      } catch { /* no thumbnail handler */ }
    }));
    return shown;
  }

  registerIpc() {
    const from = (e: IpcMainEvent | IpcMainInvokeEvent) => !!this.panel.window && e.sender === this.panel.window.webContents;
    const inFolder = (p: unknown): p is string => typeof p === 'string' && path.dirname(p).toLowerCase() === this.folder.toLowerCase();
    ipcMain.handle('stack:data', async (e) => (from(e) ? { folder: this.folder, name: path.basename(this.folder) || this.folder, items: await this.items() } : null));
    ipcMain.on('stack:open', (e, p: unknown) => {
      if (!from(e) || !inFolder(p)) return;
      this.panel.hide();
      if (fs.existsSync(p) && fs.statSync(p).isDirectory() && this.ctx.settings.get().files.openFoldersInOrelle) this.ctx.actions.openApp('files', p);
      else void safeLaunch(() => openPath(p), p);
    });
    ipcMain.on('stack:reveal', (e, p: unknown) => {
      if (from(e) && inFolder(p)) shell.showItemInFolder(p);
    });
    ipcMain.on('stack:openFolder', (e) => {
      if (!from(e)) return;
      this.panel.hide();
      if (this.ctx.settings.get().files.openFoldersInOrelle) this.ctx.actions.openApp('files', this.folder);
      else void safeLaunch(() => openPath(this.folder), this.folder);
    });
    ipcMain.on('stack:hide', (e) => from(e) && this.panel.hide());
  }
}
