// Optional low-level mouse hook for the Orelle desktop menu. Only a right-click released on an
// empty spot of the desktop (the desktop's own list view, outside every icon) is taken; every
// other click — on icons, windows, the taskbar — is passed on untouched, and so are clicks Orelle
// itself synthesizes ("More options" re-opens Windows' own menu). Installed only while the option
// is on; the callback does no more than a window lookup and a rectangle test.
import { log } from '../logger';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const koffi: typeof import('koffi') = require('koffi');

const WH_MOUSE_LL = 14;
const WM_RBUTTONDOWN = 0x204;
const WM_RBUTTONUP = 0x205;
const LLMHF_INJECTED = 0x1;

export interface IconRect { l: number; t: number; r: number; b: number }

let api: ReturnType<typeof bind> | null = null;
function bind() {
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const POINT = koffi.struct('ORELLE_MOUSE_POINT', { x: 'int32', y: 'int32' });
  const MSLL = koffi.struct('ORELLE_MSLLHOOKSTRUCT', { pt: POINT, mouseData: 'uint32', flags: 'uint32', time: 'uint32', extra: 'uintptr_t' });
  const Proc = koffi.proto('intptr_t __stdcall OrelleLLMouseProc(int code, uintptr_t wParam, void *info)');
  return {
    MSLL,
    Proc,
    SetWindowsHookExW: user32.func('intptr_t __stdcall SetWindowsHookExW(int id, OrelleLLMouseProc *proc, intptr_t mod, uint32_t thread)'),
    UnhookWindowsHookEx: user32.func('bool __stdcall UnhookWindowsHookEx(intptr_t hook)'),
    CallNextHookEx: user32.func('intptr_t __stdcall CallNextHookEx(intptr_t hook, int code, uintptr_t wParam, void *lParam)'),
    WindowFromPoint: user32.func('intptr_t __stdcall WindowFromPoint(ORELLE_MOUSE_POINT pt)'),
    GetModuleHandleW: kernel32.func('intptr_t __stdcall GetModuleHandleW(const char16_t *name)'),
    SetCursorPos: user32.func('bool __stdcall SetCursorPos(int x, int y)'),
    mouse_event: user32.func('void __stdcall mouse_event(uint32_t flags, int dx, int dy, uint32_t data, uintptr_t extra)'),
  };
}

export class DesktopClickHook {
  private hook = 0;
  private cb: unknown = null;
  private swallowing = false;
  /** Desktop list view and the icon rectangles on it (physical pixels), refreshed by the owner. */
  listView = 0;
  icons: IconRect[] = [];

  constructor(private readonly onEmptyRightClick: (x: number, y: number) => void) {}

  get active() {
    return this.hook !== 0;
  }

  private onIcon(x: number, y: number) {
    return this.icons.some((r) => x >= r.l && x < r.r && y >= r.t && y < r.b);
  }

  start() {
    if (this.hook || process.platform !== 'win32') return;
    try {
      api ??= bind();
      const a = api;
      this.cb = koffi.register((code: number, wParam: number, ptr: unknown) => {
        if (code === 0 && (wParam === WM_RBUTTONDOWN || wParam === WM_RBUTTONUP) && this.listView) {
          const info = koffi.decode(ptr, a.MSLL) as { pt: { x: number; y: number }; flags: number };
          if (!(info.flags & LLMHF_INJECTED)) {
            if (wParam === WM_RBUTTONDOWN) {
              this.swallowing = Number(a.WindowFromPoint(info.pt)) === this.listView && !this.onIcon(info.pt.x, info.pt.y);
              if (this.swallowing) return 1;
            } else if (this.swallowing) {
              this.swallowing = false;
              const { x, y } = info.pt;
              setImmediate(() => this.onEmptyRightClick(x, y));
              return 1;
            }
          }
        }
        return a.CallNextHookEx(0, code, wParam, ptr);
      }, koffi.pointer(a.Proc));
      this.hook = Number(a.SetWindowsHookExW(WH_MOUSE_LL, this.cb as never, a.GetModuleHandleW(null), 0));
      if (!this.hook) {
        koffi.unregister(this.cb as never);
        this.cb = null;
        log.warn('desktop', 'Mouse hook could not be installed');
      } else log.info('desktop', 'Desktop menu hook installed');
    } catch (err) {
      log.error('desktop', 'mouse hook failed', err);
    }
  }

  stop() {
    if (!api || !this.hook) return;
    api.UnhookWindowsHookEx(this.hook);
    this.hook = 0;
    if (this.cb) koffi.unregister(this.cb as never);
    this.cb = null;
  }

  /** Re-issues the right-click so Windows shows its own desktop menu (injected: the hook lets it through). */
  windowsMenu(x: number, y: number) {
    api ??= bind();
    api.SetCursorPos(x, y);
    api.mouse_event(0x0008 /* RIGHTDOWN */, 0, 0, 0, 0);
    api.mouse_event(0x0010 /* RIGHTUP */, 0, 0, 0, 0);
  }
}
