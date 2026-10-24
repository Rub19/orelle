// Optional: turn on Windows' own "automatically hide the taskbar" while NOVA runs.
// Uses the documented AppBar API (ABM_SETSTATE), never the registry. The state found before NOVA
// changed it is saved to disk, so it is restored on exit — and on the next start after a crash.
import fs from 'node:fs';
import path from 'node:path';
import * as w32 from '../native/win32';
import { log } from '../logger';

export class TaskbarService {
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'taskbar-original.json');
  }

  private saved(): boolean | null {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')).autoHide === true;
    } catch {
      return null;
    }
  }

  apply(hide: boolean) {
    if (hide) {
      if (this.saved() === null) {
        const original = w32.getTaskbarAutoHide();
        if (original === null) return;
        fs.writeFileSync(this.file, JSON.stringify({ autoHide: original }));
      }
      if (!w32.setTaskbarAutoHide(true)) log.warn('taskbar', 'Could not enable taskbar auto-hide');
    } else {
      this.restore();
    }
  }

  /** Puts the taskbar back the way it was before NOVA touched it (no-op if NOVA never did). */
  restore() {
    const original = this.saved();
    if (original === null) return;
    w32.setTaskbarAutoHide(original);
    try { fs.unlinkSync(this.file); } catch { /* ignore */ }
    log.info('taskbar', `Taskbar auto-hide restored to ${original}`);
  }
}
