// Opt-in clipboard history (Preferences › Privacy). Event-driven (WM_CLIPBOARDUPDATE via
// AddClipboardFormatListener), text and images, kept in memory only. Pinned entries are the one
// exception: they are saved encrypted for the current Windows user (DPAPI via safeStorage).
// Content that password managers mark as private (ExcludeClipboardContentFromMonitorProcessing,
// CanIncludeInClipboardHistory = 0) and copies made in excluded apps are never recorded.
import { BrowserWindow, ClipboardItem, clipboard, nativeImage, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { OrelleContext } from '../context';
import * as w32 from '../native/win32';
import { log } from '../logger';

const WM_CLIPBOARDUPDATE = 0x031d;
const MAX_TEXT = 100_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const raw = (format: string) => `electron application/osclipboard;format="${format}"`;

export interface ClipItem {
  id: string;
  kind: 'text' | 'image';
  text: string;
  /** Small preview for images (data URL). */
  thumb: string | null;
  width?: number;
  height?: number;
  at: number;
  pinned: boolean;
  source: string | null;
}

export class ClipboardHistory extends EventEmitter {
  private items: ClipItem[] = [];
  private images = new Map<string, Buffer>();
  private hwnd = 0;
  private win: BrowserWindow | null = null;
  private ignoreNext = false;
  private pinsFile: string;

  constructor(private readonly ctx: OrelleContext, private readonly foregroundApp: () => { exe: string; name: string } | null) {
    super();
    this.pinsFile = path.join(ctx.dataDir, 'clipboard-pins.bin');
  }

  enable(win: BrowserWindow) {
    if (this.win) return;
    this.win = win;
    this.hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE());
    this.loadPins();
    win.hookWindowMessage(WM_CLIPBOARDUPDATE, () => void this.capture());
    if (!w32.addClipboardListener(this.hwnd)) log.warn('clipboard', 'AddClipboardFormatListener failed');
    else log.info('clipboard', 'Clipboard history enabled');
  }

  disable() {
    if (!this.win) return;
    w32.removeClipboardListener(this.hwnd);
    if (!this.win.isDestroyed()) this.win.unhookWindowMessage(WM_CLIPBOARDUPDATE);
    this.win = null;
    this.items = [];
    this.images.clear();
    this.emit('change');
    log.info('clipboard', 'Clipboard history disabled and cleared');
  }

  get enabled() {
    return this.win !== null;
  }

  private get cfg() {
    return this.ctx.settings.get().clipboard;
  }

  /**
   * Formats password managers set on secrets they copy. CanIncludeInClipboardHistory is only
   * ever added to say "no", so its mere presence is treated as private.
   */
  private async isPrivate(): Promise<boolean> {
    for (const f of ['ExcludeClipboardContentFromMonitorProcessing', 'CanIncludeInClipboardHistory', 'Clipboard Viewer Ignore']) {
      try {
        if (await clipboard.has(raw(f))) return true;
      } catch { /* unsupported query */ }
    }
    return false;
  }

  private async readPng(): Promise<Buffer | null> {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const blob = (await item.getType('image/png')) as Blob;
      if (blob.size > MAX_IMAGE_BYTES) return null;
      return Buffer.from(await blob.arrayBuffer());
    }
    return null;
  }

  private async capture() {
    if (this.ignoreNext) {
      this.ignoreNext = false;
      return;
    }
    try {
      if (await this.isPrivate()) return;
      const app = this.foregroundApp();
      if (app && this.cfg.excludedApps.includes(path.basename(app.exe).toLowerCase())) return;
      const text = await clipboard.readText();
      let item: ClipItem | null = null;
      if (text && text.trim() && text.length <= MAX_TEXT) {
        this.items = this.items.filter((i) => i.pinned || i.kind !== 'text' || i.text !== text);
        item = { id: randomUUID(), kind: 'text', text, thumb: null, at: Date.now(), pinned: false, source: app?.name ?? null };
      } else if (this.cfg.images) {
        const png = await this.readPng();
        if (!png) return;
        const image = nativeImage.createFromBuffer(png);
        if (image.isEmpty()) return;
        const size = image.getSize();
        const thumb = image.resize(size.width > size.height ? { width: Math.min(320, size.width) } : { height: Math.min(200, size.height) }).toDataURL();
        item = { id: randomUUID(), kind: 'image', text: `${size.width} × ${size.height}`, thumb, width: size.width, height: size.height, at: Date.now(), pinned: false, source: app?.name ?? null };
        this.images.set(item.id, png);
      }
      if (!item) return;
      this.items.unshift(item);
      this.trim();
      this.emit('change');
    } catch (err) {
      log.debug('clipboard', 'capture failed', err);
    }
  }

  private trim() {
    const max = this.cfg.maxItems;
    let unpinned = 0;
    this.items = this.items.filter((i) => {
      if (i.pinned) return true;
      unpinned++;
      if (unpinned <= max) return true;
      this.images.delete(i.id);
      return false;
    });
  }

  list() {
    return this.items;
  }

  /** Puts an entry back on the clipboard (without recording it again). */
  async copy(id: string): Promise<boolean> {
    const it = this.items.find((i) => i.id === id);
    if (!it) return false;
    if (it.kind === 'text') {
      this.ignoreNext = true;
      await clipboard.writeText(it.text);
      return true;
    }
    const png = this.images.get(id);
    if (!png) return false;
    this.ignoreNext = true;
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    return true;
  }

  pin(id: string, on: boolean) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return;
    it.pinned = on;
    this.savePins();
    this.trim();
    this.emit('change');
  }

  remove(id: string) {
    const it = this.items.find((i) => i.id === id);
    this.items = this.items.filter((i) => i.id !== id);
    this.images.delete(id);
    if (it?.pinned) this.savePins();
    this.emit('change');
  }

  /** Clears the history; pinned entries stay unless `all`. */
  clear(all = false) {
    for (const i of this.items) if (all || !i.pinned) this.images.delete(i.id);
    this.items = all ? [] : this.items.filter((i) => i.pinned);
    if (all) this.savePins();
    this.emit('change');
  }

  private savePins() {
    const pins = this.items.filter((i) => i.pinned).slice(0, 50).map((i) => ({ ...i, png: i.kind === 'image' ? this.images.get(i.id)?.toString('base64') : undefined }));
    try {
      if (!pins.length) {
        if (fs.existsSync(this.pinsFile)) fs.unlinkSync(this.pinsFile);
        return;
      }
      if (!safeStorage.isEncryptionAvailable()) return;
      fs.writeFileSync(this.pinsFile, safeStorage.encryptString(JSON.stringify(pins)));
    } catch (err) {
      log.warn('clipboard', 'Cannot save pinned entries', err);
    }
  }

  private loadPins() {
    try {
      if (!fs.existsSync(this.pinsFile)) return;
      const pins = JSON.parse(safeStorage.decryptString(fs.readFileSync(this.pinsFile))) as (ClipItem & { png?: string })[];
      for (const p of pins.slice(0, 50)) {
        if (!p || typeof p.id !== 'string' || (p.kind !== 'text' && p.kind !== 'image')) continue;
        if (p.png) this.images.set(p.id, Buffer.from(p.png, 'base64'));
        this.items.push({ id: p.id, kind: p.kind, text: String(p.text ?? ''), thumb: p.thumb ?? null, width: p.width, height: p.height, at: Number(p.at) || Date.now(), pinned: true, source: p.source ?? null });
      }
    } catch (err) {
      log.warn('clipboard', 'Cannot read pinned entries', err);
    }
  }
}
