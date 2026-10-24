// Optional low-level keyboard hook for a lone press of the Windows key.
// Win+anything (Win+E, Win+D, Win+L…) is untouched. When Win is pressed and released alone, a
// harmless unassigned virtual key (0xE8) is injected before the release so Windows does not open
// Start, then Orelle runs its own action. The hook is installed only while the option is on.
import { log } from '../logger';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const koffi: typeof import('koffi') = require('koffi');

const WH_KEYBOARD_LL = 13;
const WM_KEYDOWN = 0x100;
const WM_KEYUP = 0x101;
const WM_SYSKEYDOWN = 0x104;
const WM_SYSKEYUP = 0x105;
const VK_LWIN = 0x5b;
const VK_RWIN = 0x5c;
const VK_MASK = 0xe8; // unassigned
const LLKHF_INJECTED = 0x10;

let api: ReturnType<typeof bind> | null = null;
function bind() {
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const KBD = koffi.struct('ORELLE_KBDLLHOOKSTRUCT', { vkCode: 'uint32', scanCode: 'uint32', flags: 'uint32', time: 'uint32', extra: 'uintptr_t' });
  const Proc = koffi.proto('intptr_t __stdcall OrelleLLKeyboardProc(int code, uintptr_t wParam, void *info)');
  return {
    KBD,
    Proc,
    SetWindowsHookExW: user32.func('intptr_t __stdcall SetWindowsHookExW(int id, OrelleLLKeyboardProc *proc, intptr_t mod, uint32_t thread)'),
    UnhookWindowsHookEx: user32.func('bool __stdcall UnhookWindowsHookEx(intptr_t hook)'),
    CallNextHookEx: user32.func('intptr_t __stdcall CallNextHookEx(intptr_t hook, int code, uintptr_t wParam, void *lParam)'),
    GetModuleHandleW: kernel32.func('intptr_t __stdcall GetModuleHandleW(const char16_t *name)'),
    keybd_event: user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)'),
  };
}

export class WinKeyHook {
  private hook = 0;
  private cb: unknown = null;
  private winDown = false;
  private combo = false;

  constructor(private readonly onLonePress: () => void) {}

  get active() {
    return this.hook !== 0;
  }

  start() {
    if (this.hook || process.platform !== 'win32') return;
    try {
      api ??= bind();
      const a = api;
      this.cb = koffi.register((code: number, wParam: number, ptr: unknown) => {
        // Must stay tiny: Windows drops hooks that take too long.
        const info = code === 0 ? (koffi.decode(ptr, a.KBD) as { vkCode: number; flags: number }) : null;
        if (info && !(info.flags & LLKHF_INJECTED)) {
          const isWin = info.vkCode === VK_LWIN || info.vkCode === VK_RWIN;
          const down = wParam === WM_KEYDOWN || wParam === WM_SYSKEYDOWN;
          const up = wParam === WM_KEYUP || wParam === WM_SYSKEYUP;
          if (isWin && down) {
            if (!this.winDown) { this.winDown = true; this.combo = false; }
          } else if (!isWin && down && this.winDown) {
            this.combo = true;
          } else if (isWin && up && this.winDown) {
            this.winDown = false;
            if (!this.combo) {
              // Masks the lone press so Start does not open, then lets the release through.
              a.keybd_event(VK_MASK, 0, 0, 0);
              a.keybd_event(VK_MASK, 0, 2, 0);
              setImmediate(this.onLonePress);
            }
          }
        }
        // The original pointer is passed on untouched to the rest of the hook chain.
        return a.CallNextHookEx(0, code, wParam, ptr);
      }, koffi.pointer(a.Proc));
      this.hook = Number(a.SetWindowsHookExW(WH_KEYBOARD_LL, this.cb as never, a.GetModuleHandleW(null), 0));
      if (!this.hook) {
        koffi.unregister(this.cb as never);
        this.cb = null;
        log.warn('keyboard', 'Windows key hook could not be installed');
      } else log.info('keyboard', 'Windows key hook installed');
    } catch (err) {
      log.error('keyboard', 'hook failed', err);
    }
  }

  stop() {
    if (!api || !this.hook) return;
    api.UnhookWindowsHookEx(this.hook);
    this.hook = 0;
    if (this.cb) koffi.unregister(this.cb as never);
    this.cb = null;
    this.winDown = false;
  }
}
