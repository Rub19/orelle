// Keeps Orelle light without making it slow to reopen. Hidden surfaces are not destroyed (that would
// cost a full reload on the next Win key / shortcut press): their pages stay loaded but their
// physical memory is handed back to Windows (SetProcessWorkingSetSize(-1, -1), the same thing
// Windows does to minimized apps). When the user shows them again, the pages fault back in within
// milliseconds. While another app is in front (a game, a browser), the always-visible surfaces,
// the GPU process and the main process are trimmed the same way.
import { app, BrowserWindow } from 'electron';
import * as w32 from '../native/win32';
import { log } from '../logger';

const CHECK_EVERY = 10_000;

export class MemoryTrimmer {
  private timer: NodeJS.Timeout | null = null;
  private hiddenSince = new Map<number, number>();
  private trimmed = new Set<number>();
  private awaySince = 0;
  private lastAwayTrim = 0;

  /**
   * @param hiddenDelay  trim a hidden window after this long (ms)
   * @param awayDelay    trim everything once Orelle has been in the background this long (ms)
   */
  constructor(private readonly hiddenDelay: number, private readonly awayDelay: number, private readonly orelleInFront: () => boolean) {}

  start() {
    this.timer = setInterval(() => this.check(), CHECK_EVERY);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private trimPid(pid: number): boolean {
    return pid > 0 && w32.trimWorkingSet(pid);
  }

  private check() {
    const now = Date.now();
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      const pid = w.webContents.getOSProcessId();
      if (w.isVisible()) {
        this.hiddenSince.delete(pid);
        this.trimmed.delete(pid);
        continue;
      }
      const since = this.hiddenSince.get(pid) ?? now;
      this.hiddenSince.set(pid, since);
      if (!this.trimmed.has(pid) && now - since >= this.hiddenDelay && this.trimPid(pid)) this.trimmed.add(pid);
    }
    // Orelle in the background: trim the visible surfaces, GPU and main process (at most every 5 min).
    if (this.orelleInFront()) {
      this.awaySince = 0;
      return;
    }
    this.awaySince ||= now;
    if (now - this.awaySince < this.awayDelay || now - this.lastAwayTrim < 300_000) return;
    this.lastAwayTrim = now;
    let n = 0;
    for (const m of app.getAppMetrics()) if (m.type !== 'Browser' && this.trimPid(m.pid)) n++;
    if (w32.trimWorkingSet(process.pid)) n++;
    log.debug('memory', `Background: trimmed ${n} process(es)`);
  }
}
