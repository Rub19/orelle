// Opt-in clipboard history. Event-driven (WM_CLIPBOARDUPDATE via AddClipboardFormatListener),
// text only, memory only — nothing is ever written to disk.
import { BrowserWindow, clipboard } from 'electron';
import * as w32 from '../native/win32';
import { log } from '../logger';

const WM_CLIPBOARDUPDATE = 0x031d;
const MAX = 50;

export class ClipboardHistory {
  private items: { text: string; at: number }[] = [];
  private hwnd = 0;
  private win: BrowserWindow | null = null;

  enable(win: BrowserWindow) {
    if (this.win) return;
    this.win = win;
    this.hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE());
    win.hookWindowMessage(WM_CLIPBOARDUPDATE, () => this.capture());
    if (!w32.addClipboardListener(this.hwnd)) log.warn('clipboard', 'AddClipboardFormatListener failed');
    else log.info('clipboard', 'Clipboard history enabled');
  }

  disable() {
    if (!this.win) return;
    w32.removeClipboardListener(this.hwnd);
    if (!this.win.isDestroyed()) this.win.unhookWindowMessage(WM_CLIPBOARDUPDATE);
    this.win = null;
    this.items = [];
    log.info('clipboard', 'Clipboard history disabled and cleared');
  }

  get enabled() {
    return this.win !== null;
  }

  private async capture() {
    const text = await clipboard.readText();
    if (!text || !text.trim() || text.length > 20_000) return;
    this.items = [{ text, at: Date.now() }, ...this.items.filter((i) => i.text !== text)].slice(0, MAX);
  }

  list() {
    return this.items;
  }
}
