// Windows taskbar while Orelle runs: untouched, Windows' own auto-hide (documented AppBar API,
// ABM_SETSTATE), or fully hidden (window hidden; Orelle's top bar and Dock take over).
// Nothing is written to the registry. The state found before Orelle touched it is saved to disk and
// restored on exit — and on the next start after a crash or a forced kill.
import fs from 'node:fs';
import path from 'node:path';
import type { TaskbarMode } from '../../shared/types';
import * as w32 from '../native/win32';
import { log } from '../logger';

const EVENT_OBJECT_SHOW = 0x8002;

export class TaskbarService {
  private file: string;
  private mode: TaskbarMode = 'normal';
  private watch: w32.WinEventHandle | null = null;
  private peekTimer: NodeJS.Timeout | null = null;
  private peeking = false;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'taskbar-original.json');
  }

  private saved(): { autoHide: boolean } | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return typeof raw.autoHide === 'boolean' ? raw : null;
    } catch {
      return null;
    }
  }

  private remember() {
    if (this.saved()) return;
    const original = w32.getTaskbarAutoHide();
    if (original !== null) fs.writeFileSync(this.file, JSON.stringify({ autoHide: original }));
  }

  apply(mode: TaskbarMode) {
    this.mode = mode;
    if (mode === 'normal') {
      this.restore();
      return;
    }
    this.remember();
    if (!w32.setTaskbarAutoHide(true)) log.warn('taskbar', 'Could not enable taskbar auto-hide');
    if (mode === 'hidden') {
      w32.setTaskbarVisible(false);
      // Explorer re-shows the taskbar on some events (Start menu, display changes): hide it again.
      this.watch ??= w32.hookWinEvents([[EVENT_OBJECT_SHOW, EVENT_OBJECT_SHOW]], (_e, hwnd, idObject) => {
        if (idObject !== 0 || this.mode !== 'hidden' || this.peeking) return;
        const cls = w32.getClassName(hwnd);
        if (cls === 'Shell_TrayWnd' || cls === 'Shell_SecondaryTrayWnd') setTimeout(() => !this.peeking && this.mode === 'hidden' && w32.setTaskbarVisible(false), 50);
      });
    } else {
      this.stopWatch();
      w32.setTaskbarVisible(true);
    }
    log.info('taskbar', `Taskbar mode: ${mode}`);
  }

  /** Temporarily shows the hidden taskbar (to reach notification-area icons), then hides it again. */
  peek(seconds = 10) {
    if (this.mode !== 'hidden') return;
    this.peeking = !this.peeking;
    if (this.peekTimer) clearTimeout(this.peekTimer);
    w32.setTaskbarVisible(this.peeking);
    if (this.peeking) {
      this.peekTimer = setTimeout(() => {
        this.peeking = false;
        if (this.mode === 'hidden') w32.setTaskbarVisible(false);
      }, seconds * 1000);
    }
  }

  private stopWatch() {
    this.watch?.dispose();
    this.watch = null;
  }

  /** Puts the taskbar back exactly as it was before Orelle (no-op if Orelle never changed it). */
  restore() {
    this.stopWatch();
    w32.setTaskbarVisible(true);
    const original = this.saved();
    if (!original) return;
    w32.setTaskbarAutoHide(original.autoHide);
    try { fs.unlinkSync(this.file); } catch { /* ignore */ }
    log.info('taskbar', `Taskbar restored (auto-hide ${original.autoHide})`);
  }
}
