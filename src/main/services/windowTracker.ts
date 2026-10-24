// Live list of top-level application windows, event-driven through WinEvent hooks (no polling).
import { EventEmitter } from 'node:events';
import type { WindowInfo } from '../../shared/dockModel';
import * as w32 from '../native/win32';
import { log } from '../logger';

const EVENT_SYSTEM_FOREGROUND = 0x0003;
const EVENT_SYSTEM_MINIMIZESTART = 0x0016;
const EVENT_SYSTEM_MINIMIZEEND = 0x0017;
const EVENT_OBJECT_CREATE = 0x8000;
const EVENT_OBJECT_HIDE = 0x8003;
const EVENT_OBJECT_NAMECHANGE = 0x800c;
const EVENT_OBJECT_CLOAKED = 0x8017;
const EVENT_OBJECT_UNCLOAKED = 0x8018;
const OBJID_WINDOW = 0;

const IGNORED_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow']);

export class WindowTracker extends EventEmitter {
  private windows: WindowInfo[] = [];
  private foreground: number | null = null;
  private hook: w32.WinEventHandle | null = null;
  private timer: NodeJS.Timeout | null = null;
  private procCache = new Map<number, { exe: string; aumid: string | null }>();
  private fullscreen = false;

  constructor(private readonly ownPid: number) {
    super();
  }

  get available() {
    return this.hook !== null;
  }

  start() {
    if (!w32.win32Available()) return;
    this.refresh();
    this.hook = w32.hookWinEvents(
      [
        [EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND],
        [EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND],
        [EVENT_OBJECT_CREATE, EVENT_OBJECT_HIDE],
        [EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE],
        [EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED],
      ],
      (event, hwnd, idObject, idChild) => {
        if (idObject !== OBJID_WINDOW || idChild !== 0) return;
        if (event === EVENT_SYSTEM_FOREGROUND) {
          this.setForeground(hwnd);
          this.schedule(250);
          return;
        }
        if (event === EVENT_OBJECT_NAMECHANGE) {
          // Title changes are frequent (browsers, terminals): only matters for windows we track.
          if (this.windows.some((w) => w.hwnd === hwnd)) this.schedule(400);
          return;
        }
        this.schedule(event === EVENT_OBJECT_CREATE ? 300 : 80);
      },
    );
    log.info('windows', this.hook ? 'Window tracking active (WinEvent hooks)' : 'Window tracking unavailable');
  }

  stop() {
    this.hook?.dispose();
    this.hook = null;
    if (this.timer) clearTimeout(this.timer);
  }

  list(): WindowInfo[] {
    return this.windows;
  }

  getForeground(): number | null {
    return this.foreground;
  }

  isForegroundFullscreen(): boolean {
    return this.fullscreen;
  }

  private setForeground(hwnd: number) {
    this.foreground = hwnd || null;
    const fs = this.foreground !== null && w32.getWindowPid(this.foreground) !== this.ownPid && w32.isFullscreenWindow(this.foreground);
    if (fs !== this.fullscreen) {
      this.fullscreen = fs;
      this.emit('fullscreen', fs);
    }
    this.emit('foreground', this.foreground);
  }

  /** Coalesces bursts of events into one enumeration. */
  schedule(delay: number) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh();
    }, delay);
  }

  refresh() {
    const started = performance.now();
    const next: WindowInfo[] = [];
    const livePids = new Set<number>();
    for (const hwnd of w32.enumTopLevelWindows()) {
      if (!w32.isAppWindow(hwnd)) continue;
      const cls = w32.getClassName(hwnd);
      if (IGNORED_CLASSES.has(cls)) continue;
      let pid = w32.getWindowPid(hwnd);
      if (pid === this.ownPid) continue;
      // UWP apps live in ApplicationFrameHost; the real app owns the CoreWindow child.
      // While minimized/suspended that child is detached, so fall back to the window's AUMID property.
      let frameAumid: string | null = null;
      if (cls === 'ApplicationFrameWindow') {
        const child = w32.enumChildWindows(hwnd).find((c) => w32.getClassName(c) === 'Windows.UI.Core.CoreWindow');
        if (child) pid = w32.getWindowPid(child) || pid;
        else frameAumid = w32.getWindowAumid(hwnd);
        if (!child && !frameAumid) continue; // empty frame (app closing or not yet shown)
      }
      livePids.add(pid);
      let info = this.procCache.get(pid);
      if (!info) {
        info = w32.getProcessInfo(pid) ?? { exe: '', aumid: null };
        this.procCache.set(pid, info);
      }
      next.push({ hwnd, title: w32.getWindowText(hwnd), pid, exe: frameAumid ? '' : info.exe, aumid: frameAumid ?? info.aumid, minimized: w32.isIconic(hwnd) });
    }
    for (const pid of this.procCache.keys()) if (!livePids.has(pid)) this.procCache.delete(pid);

    const fg = w32.getForegroundWindow();
    if (fg !== this.foreground) this.setForeground(fg ?? 0);

    const changed =
      next.length !== this.windows.length ||
      next.some((w, i) => {
        const o = this.windows[i];
        return !o || o.hwnd !== w.hwnd || o.title !== w.title || o.minimized !== w.minimized || o.exe !== w.exe || o.aumid !== w.aumid;
      });
    this.windows = next;
    log.debug('windows', `enumerated ${next.length} windows in ${(performance.now() - started).toFixed(1)} ms`);
    if (changed) this.emit('change', this.windows);
  }
}
