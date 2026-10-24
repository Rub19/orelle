// Thin, typed Win32 bindings through koffi (prebuilt N-API FFI, no compiler needed).
// Every function used by NOVA is declared here; nothing else touches FFI directly.
// If loading fails (non-Windows, missing DLL), `win32` is null and features degrade gracefully.
import { log } from '../logger';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const koffi: typeof import('koffi') = require('koffi');

export type HWND = number;

export interface Rect { left: number; top: number; right: number; bottom: number }

const GW_OWNER = 4;
const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_APPWINDOW = 0x40000;
const WS_EX_NOACTIVATE = 0x08000000;
const WS_CHILD = 0x40000000;
const DWMWA_CLOAKED = 14;
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const SW_RESTORE = 9;
const SW_MINIMIZE = 6;
const WM_CLOSE = 0x0010;
const MONITOR_DEFAULTTONEAREST = 2;

function bind() {
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const shell32 = koffi.load('shell32.dll');
  const powrprof = koffi.load('powrprof.dll');

  const RECT = koffi.struct('NOVA_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  const MONITORINFO = koffi.struct('NOVA_MONITORINFO', { cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32' });
  const APPBARDATA = koffi.struct('NOVA_APPBARDATA', {
    cbSize: 'uint32', hWnd: 'intptr_t', uCallbackMessage: 'uint32', uEdge: 'uint32', rc: RECT, lParam: 'intptr_t',
  });
  const EnumProc = koffi.proto('bool __stdcall NovaEnumProc(intptr_t hwnd, intptr_t lp)');
  const WinEventProc = koffi.proto(
    'void __stdcall NovaWinEventProc(intptr_t hook, uint32_t event, intptr_t hwnd, long idObject, long idChild, uint32_t thread, uint32_t time)',
  );

  return {
    koffi,
    RECT,
    MONITORINFO,
    APPBARDATA,
    EnumProc,
    WinEventProc,
    EnumWindows: user32.func('bool __stdcall EnumWindows(NovaEnumProc *cb, intptr_t lp)'),
    EnumChildWindows: user32.func('bool __stdcall EnumChildWindows(intptr_t parent, NovaEnumProc *cb, intptr_t lp)'),
    IsWindow: user32.func('bool __stdcall IsWindow(intptr_t hwnd)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)'),
    IsIconic: user32.func('bool __stdcall IsIconic(intptr_t hwnd)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, _Out_ uint16_t *buf, int max)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hwnd, _Out_ uint16_t *buf, int max)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
    GetWindow: user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32_t cmd)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)'),
    GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
    SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(intptr_t hwnd)'),
    BringWindowToTop: user32.func('bool __stdcall BringWindowToTop(intptr_t hwnd)'),
    ShowWindow: user32.func('bool __stdcall ShowWindow(intptr_t hwnd, int cmd)'),
    PostMessageW: user32.func('bool __stdcall PostMessageW(intptr_t hwnd, uint32_t msg, uintptr_t wp, intptr_t lp)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ NOVA_RECT *rect)'),
    GetShellWindow: user32.func('intptr_t __stdcall GetShellWindow()'),
    GetDesktopWindow: user32.func('intptr_t __stdcall GetDesktopWindow()'),
    MonitorFromWindow: user32.func('intptr_t __stdcall MonitorFromWindow(intptr_t hwnd, uint32_t flags)'),
    GetMonitorInfoW: user32.func('bool __stdcall GetMonitorInfoW(intptr_t mon, _Inout_ NOVA_MONITORINFO *info)'),
    SetWinEventHook: user32.func(
      'intptr_t __stdcall SetWinEventHook(uint32_t min, uint32_t max, intptr_t mod, NovaWinEventProc *cb, uint32_t pid, uint32_t tid, uint32_t flags)',
    ),
    UnhookWinEvent: user32.func('bool __stdcall UnhookWinEvent(intptr_t hook)'),
    LockWorkStation: user32.func('bool __stdcall LockWorkStation()'),
    keybd_event: user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)'),
    AddClipboardFormatListener: user32.func('bool __stdcall AddClipboardFormatListener(intptr_t hwnd)'),
    RemoveClipboardFormatListener: user32.func('bool __stdcall RemoveClipboardFormatListener(intptr_t hwnd)'),
    OpenProcess: kernel32.func('intptr_t __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(intptr_t h)'),
    QueryFullProcessImageNameW: kernel32.func(
      'bool __stdcall QueryFullProcessImageNameW(intptr_t h, uint32_t flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)',
    ),
    GetApplicationUserModelId: kernel32.func(
      'long __stdcall GetApplicationUserModelId(intptr_t h, _Inout_ uint32_t *len, _Out_ uint16_t *buf)',
    ),
    DwmGetWindowAttribute: dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attr, _Out_ int32_t *value, uint32_t size)'),
    DwmSetWindowAttribute: dwmapi.func('long __stdcall DwmSetWindowAttribute(intptr_t hwnd, uint32_t attr, int32_t *value, uint32_t size)'),
    SHAppBarMessage: shell32.func('uintptr_t __stdcall SHAppBarMessage(uint32_t msg, _Inout_ NOVA_APPBARDATA *data)'),
    SHGetPropertyStoreForWindow: shell32.func('long __stdcall SHGetPropertyStoreForWindow(intptr_t hwnd, const uint8_t *riid, _Out_ void **store)'),
    PropVariantClear: koffi.load('ole32.dll').func('long __stdcall PropVariantClear(void *pv)'),
    PROPERTYKEY: koffi.struct('NOVA_PROPERTYKEY', { fmtid: koffi.array('uint8_t', 16), pid: 'uint32_t' }),
    PROPVARIANT: koffi.struct('NOVA_PROPVARIANT', { vt: 'uint16_t', r1: 'uint16_t', r2: 'uint16_t', r3: 'uint16_t', data: 'void *', extra: 'void *' }),
    GetValueProto: koffi.proto('long __stdcall NovaPropStoreGetValue(void *self, NOVA_PROPERTYKEY *key, void *pv)'),
    ReleaseProto: koffi.proto('uint32_t __stdcall NovaRelease(void *self)'),
    SetSuspendState: powrprof.func('bool __stdcall SetSuspendState(bool hibernate, bool force, bool wakeupEventsDisabled)'),
    SYSTEM_POWER_STATUS: koffi.struct('NOVA_SYSTEM_POWER_STATUS', {
      ACLineStatus: 'uint8_t', BatteryFlag: 'uint8_t', BatteryLifePercent: 'uint8_t', SystemStatusFlag: 'uint8_t',
      BatteryLifeTime: 'uint32_t', BatteryFullLifeTime: 'uint32_t',
    }),
    GetSystemPowerStatus: kernel32.func('bool __stdcall GetSystemPowerStatus(_Out_ NOVA_SYSTEM_POWER_STATUS *s)'),
    FindWindowW: user32.func('intptr_t __stdcall FindWindowW(const char16_t *cls, const char16_t *title)'),
    SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
    DwmGetWindowAttributeRect: dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attr, _Out_ NOVA_RECT *value, uint32_t size)'),
    IsZoomed: user32.func('bool __stdcall IsZoomed(intptr_t hwnd)'),
    SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)'),
    CoInitializeEx: koffi.load('ole32.dll').func('long __stdcall CoInitializeEx(void *reserved, uint32_t flags)'),
    CoCreateInstance: koffi.load('ole32.dll').func(
      'long __stdcall CoCreateInstance(const uint8_t *clsid, void *outer, uint32_t ctx, const uint8_t *iid, _Out_ void **ppv)',
    ),
    CoTaskMemFree: koffi.load('ole32.dll').func('void __stdcall CoTaskMemFree(void *p)'),
  };
}

type Api = ReturnType<typeof bind>;

let api: Api | null = null;
try {
  if (process.platform === 'win32') api = bind();
} catch (err) {
  log.error('win32', 'FFI bindings unavailable', err);
  api = null;
}

export const win32Available = () => api !== null;

const utf16 = (buf: Uint16Array, len: number) => Buffer.from(buf.buffer, buf.byteOffset, len * 2).toString('utf16le');

export function getWindowText(hwnd: HWND): string {
  if (!api) return '';
  const buf = new Uint16Array(512);
  const n = api.GetWindowTextW(hwnd, buf, 512);
  return n > 0 ? utf16(buf, n) : '';
}

export function getClassName(hwnd: HWND): string {
  if (!api) return '';
  const buf = new Uint16Array(256);
  const n = api.GetClassNameW(hwnd, buf, 256);
  return n > 0 ? utf16(buf, n) : '';
}

export function getWindowPid(hwnd: HWND): number {
  if (!api) return 0;
  const pid = [0];
  api.GetWindowThreadProcessId(hwnd, pid);
  return pid[0];
}

export function getProcessInfo(pid: number): { exe: string; aumid: string | null } | null {
  if (!api || !pid) return null;
  const h = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!h) return null;
  try {
    const buf = new Uint16Array(1024);
    const size = [1024];
    const exe = api.QueryFullProcessImageNameW(h, 0, buf, size) ? utf16(buf, size[0]) : '';
    let aumid: string | null = null;
    const len = [512];
    const abuf = new Uint16Array(512);
    if (api.GetApplicationUserModelId(h, len, abuf) === 0 && len[0] > 1) aumid = utf16(abuf, len[0] - 1);
    return { exe, aumid };
  } finally {
    api.CloseHandle(h);
  }
}

export function guidBytes(guid: string): number[] {
  const h = guid.replace(/[{}-]/g, '');
  const le = (s: string) => s.match(/../g)!.reverse().map((b) => parseInt(b, 16));
  return [...le(h.slice(0, 8)), ...le(h.slice(8, 12)), ...le(h.slice(12, 16)), ...h.slice(16).match(/../g)!.map((b) => parseInt(b, 16))];
}
const IID_IPropertyStore = guidBytes('886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99');
const PKEY_AppUserModel_ID = { fmtid: guidBytes('9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3'), pid: 5 };
const VT_LPWSTR = 31;

/**
 * Explicit AppUserModelID set on a window (System.AppUserModel.ID in its property store).
 * Needed for Store apps whose frame window is detached from the app process while minimized.
 */
export function getWindowAumid(hwnd: HWND): string | null {
  if (!api) return null;
  const k = api.koffi;
  const out: unknown[] = [null];
  try {
    if (api.SHGetPropertyStoreForWindow(hwnd, IID_IPropertyStore, out) !== 0 || !out[0]) return null;
    const store = out[0];
    const vtbl = k.decode(store, 'void *');
    const getValue = k.decode(vtbl, 5 * k.sizeof('void *'), 'void *');
    const release = k.decode(vtbl, 2 * k.sizeof('void *'), 'void *');
    const pv = Buffer.alloc(k.sizeof(api.PROPVARIANT));
    try {
      if (k.call(getValue, api.GetValueProto, store, PKEY_AppUserModel_ID, pv) !== 0) return null;
      const vt = pv.readUInt16LE(0);
      if (vt !== VT_LPWSTR) return null;
      const strPtr = k.decode(pv, 8, 'void *');
      const s = strPtr ? (k.decode(strPtr, 'char16_t', -1) as string) : '';
      return s || null;
    } finally {
      api.PropVariantClear(pv);
      k.call(release, api.ReleaseProto, store);
    }
  } catch (err) {
    log.debug('win32', 'getWindowAumid failed', err);
    return null;
  }
}

export function isCloaked(hwnd: HWND): boolean {
  if (!api) return false;
  const v = [0];
  return api.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, v, 4) === 0 && v[0] !== 0;
}

/** Alt+Tab-like filter: visible, uncloaked, unowned, non-tool top-level windows with a title. */
export function isAppWindow(hwnd: HWND): boolean {
  if (!api || !api.IsWindowVisible(hwnd)) return false;
  const style = Number(api.GetWindowLongPtrW(hwnd, GWL_STYLE));
  if (style & WS_CHILD) return false;
  const ex = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  const appWindow = (ex & WS_EX_APPWINDOW) !== 0;
  if (!appWindow) {
    if (ex & WS_EX_TOOLWINDOW) return false;
    if (ex & WS_EX_NOACTIVATE) return false;
    if (api.GetWindow(hwnd, GW_OWNER)) return false;
  }
  if (isCloaked(hwnd)) return false;
  return getWindowText(hwnd).length > 0;
}

export function enumTopLevelWindows(): HWND[] {
  if (!api) return [];
  const out: HWND[] = [];
  const cb = api.koffi.register((h: number) => { out.push(h); return true; }, api.koffi.pointer(api.EnumProc));
  try { api.EnumWindows(cb, 0); } finally { api.koffi.unregister(cb); }
  return out;
}

export function enumChildWindows(parent: HWND): HWND[] {
  if (!api) return [];
  const out: HWND[] = [];
  const cb = api.koffi.register((h: number) => { out.push(h); return true; }, api.koffi.pointer(api.EnumProc));
  try { api.EnumChildWindows(parent, cb, 0); } finally { api.koffi.unregister(cb); }
  return out;
}

export const isIconic = (hwnd: HWND) => !!api?.IsIconic(hwnd);
export const isWindow = (hwnd: HWND) => !!api?.IsWindow(hwnd);
export const getForegroundWindow = (): HWND | null => (api ? Number(api.GetForegroundWindow()) || null : null);

const VK_MENU = 0x12;
const KEYEVENTF_KEYUP = 0x2;

/** Brings a window to the front, restoring it if minimized. */
export function focusWindow(hwnd: HWND): boolean {
  if (!api || !api.IsWindow(hwnd)) return false;
  if (api.IsIconic(hwnd)) api.ShowWindow(hwnd, SW_RESTORE);
  if (api.SetForegroundWindow(hwnd) && Number(api.GetForegroundWindow()) === hwnd) return true;
  // Foreground lock: a synthetic Alt tap marks this process as having the last input event,
  // which Windows requires before it lets a background process change the foreground window.
  api.keybd_event(VK_MENU, 0, 0, 0);
  api.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
  api.SetForegroundWindow(hwnd);
  api.BringWindowToTop(hwnd);
  return Number(api.GetForegroundWindow()) === hwnd;
}

export const minimizeWindow = (hwnd: HWND) => !!api?.ShowWindow(hwnd, SW_MINIMIZE);
/** Politely asks the window to close (the app may prompt to save). */
export const closeWindow = (hwnd: HWND) => !!api?.PostMessageW(hwnd, WM_CLOSE, 0, 0);

export function getWindowRect(hwnd: HWND): Rect | null {
  if (!api) return null;
  const r: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  return api.GetWindowRect(hwnd, r) ? r : null;
}

export function getMonitorRectForWindow(hwnd: HWND): Rect | null {
  if (!api) return null;
  const mon = api.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  if (!mon) return null;
  const info = { cbSize: api.koffi.sizeof(api.MONITORINFO), rcMonitor: {}, rcWork: {}, dwFlags: 0 } as unknown as { rcMonitor: Rect };
  return api.GetMonitorInfoW(mon, info) ? info.rcMonitor : null;
}

/** True when the window covers its whole monitor (games, videos, presentations). */
export function isFullscreenWindow(hwnd: HWND): boolean {
  if (!api || !hwnd) return false;
  if (hwnd === Number(api.GetShellWindow()) || hwnd === Number(api.GetDesktopWindow())) return false;
  const cls = getClassName(hwnd);
  if (cls === 'WorkerW' || cls === 'Progman') return false;
  const r = getWindowRect(hwnd);
  const m = getMonitorRectForWindow(hwnd);
  if (!r || !m) return false;
  return r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom;
}

export function setRoundedCorners(hwnd: HWND, round = true) {
  if (!api) return;
  // DWMWCP_ROUND = 2, DWMWCP_DONOTROUND = 1
  api.DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, [round ? 2 : 1], 4);
}

export interface WinEventHandle { dispose(): void }

/** Out-of-context WinEvent hook. Callbacks arrive on the main thread through Electron's message loop. */
export function hookWinEvents(
  ranges: [number, number][],
  handler: (event: number, hwnd: HWND, idObject: number, idChild: number) => void,
): WinEventHandle | null {
  if (!api) return null;
  const a = api;
  const cb = a.koffi.register(
    (_hook: number, event: number, hwnd: number, idObject: number, idChild: number) => {
      try { handler(event, hwnd, idObject, idChild); } catch (err) { log.error('win32', 'WinEvent handler failed', err); }
    },
    a.koffi.pointer(a.WinEventProc),
  );
  const WINEVENT_OUTOFCONTEXT = 0;
  const WINEVENT_SKIPOWNPROCESS = 2;
  const hooks = ranges.map(([min, max]) => a.SetWinEventHook(min, max, 0, cb, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS));
  if (hooks.some((h) => !h)) log.warn('win32', 'Some WinEvent hooks failed to install');
  return {
    dispose() {
      for (const h of hooks) if (h) a.UnhookWinEvent(h);
      a.koffi.unregister(cb);
    },
  };
}

export const lockWorkstation = () => !!api?.LockWorkStation();
export const suspend = () => !!api?.SetSuspendState(false, false, false);

export function addClipboardListener(hwnd: HWND): boolean { return !!api?.AddClipboardFormatListener(hwnd); }
export function removeClipboardListener(hwnd: HWND): boolean { return !!api?.RemoveClipboardFormatListener(hwnd); }

// ---------- AppBar (space reservation) ----------

export const ABE = { left: 0, top: 1, right: 2, bottom: 3 } as const;

function appBarData(hwnd: HWND, edge = 0, rc: Rect = { left: 0, top: 0, right: 0, bottom: 0 }, callbackMessage = 0) {
  return { cbSize: api!.koffi.sizeof(api!.APPBARDATA), hWnd: hwnd, uCallbackMessage: callbackMessage, uEdge: edge, rc: { ...rc }, lParam: 0 };
}

export function appBarRegister(hwnd: HWND, callbackMessage: number): boolean {
  if (!api) return false;
  return Number(api.SHAppBarMessage(0 /* ABM_NEW */, appBarData(hwnd, 0, undefined, callbackMessage))) !== 0;
}

/** Negotiates and reserves `rc` (physical pixels) on `edge`. Returns the rect granted by the shell. */
export function appBarSetPos(hwnd: HWND, edge: number, rc: Rect, thickness: number): Rect | null {
  if (!api) return null;
  const d = appBarData(hwnd, edge, rc);
  api.SHAppBarMessage(2 /* ABM_QUERYPOS */, d);
  // QUERYPOS may move the side we anchor to (e.g. above the taskbar); restore the thickness.
  if (edge === ABE.bottom) d.rc.top = d.rc.bottom - thickness;
  else if (edge === ABE.left) d.rc.right = d.rc.left + thickness;
  else if (edge === ABE.right) d.rc.left = d.rc.right - thickness;
  api.SHAppBarMessage(3 /* ABM_SETPOS */, d);
  return d.rc;
}

export function appBarRemove(hwnd: HWND) {
  if (!api) return;
  api.SHAppBarMessage(1 /* ABM_REMOVE */, appBarData(hwnd));
}

// ---------- Power ----------

export function getPowerStatus(): { percent: number; charging: boolean; present: boolean; minutesLeft: number | null } | null {
  if (!api) return null;
  const s = {} as { ACLineStatus: number; BatteryFlag: number; BatteryLifePercent: number; BatteryLifeTime: number };
  if (!api.GetSystemPowerStatus(s)) return null;
  // BatteryFlag 128 = no system battery; 255 = unknown.
  const present = s.BatteryFlag !== 128 && s.BatteryFlag !== 255 && s.BatteryLifePercent !== 255;
  return {
    percent: present ? s.BatteryLifePercent : 100,
    charging: s.ACLineStatus === 1,
    present,
    minutesLeft: s.BatteryLifeTime === 0xffffffff ? null : Math.round(s.BatteryLifeTime / 60),
  };
}

// ---------- Taskbar auto-hide (the same switch as Windows Settings > Taskbar) ----------

const ABS_AUTOHIDE = 0x1;
const ABS_ALWAYSONTOP = 0x2;

function trayWindow(): number {
  return api ? Number(api.FindWindowW('Shell_TrayWnd', null)) : 0;
}

/** Returns true when the taskbar is currently set to auto-hide. */
export function getTaskbarAutoHide(): boolean | null {
  if (!api) return null;
  const d = appBarData(trayWindow());
  return (Number(api.SHAppBarMessage(4 /* ABM_GETSTATE */, d)) & ABS_AUTOHIDE) !== 0;
}

export function setTaskbarAutoHide(on: boolean): boolean {
  if (!api) return false;
  const hwnd = trayWindow();
  if (!hwnd) return false;
  const d = appBarData(hwnd);
  d.lParam = on ? ABS_AUTOHIDE : ABS_ALWAYSONTOP;
  api.SHAppBarMessage(10 /* ABM_SETSTATE */, d);
  return getTaskbarAutoHide() === on;
}

// ---------- Media keys ----------

const MEDIA_VK = { playPause: 0xb3, next: 0xb0, previous: 0xb1, volumeMute: 0xad } as const;
const KEYEVENTF_EXTENDEDKEY = 0x1;

/** Sends a hardware media key: works with every player that honours media keys (Spotify, browsers, Groove…). */
export function sendMediaKey(key: keyof typeof MEDIA_VK) {
  if (!api) return;
  const vk = MEDIA_VK[key];
  api.keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, 0);
  api.keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
}

// ---------- Window placement ----------

const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOZORDER = 0x4;
const SWP_NOACTIVATE = 0x10;
const SWP_FRAMECHANGED = 0x20;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const SW_SHOWNORMAL = 1;

/**
 * Makes `hwnd` owned by the desktop window (Progman). Owned windows stay above their owner, so the
 * window lives just over the wallpaper, under every app — and "Show desktop" (Win+D) keeps it visible.
 */
export function attachToDesktop(hwnd: HWND): boolean {
  if (!api) return false;
  const progman = Number(api.FindWindowW('Progman', null));
  if (!progman) return false;
  api.SetWindowLongPtrW(hwnd, -8 /* GWLP_HWNDPARENT */, progman);
  return true;
}

export function sendToBottom(hwnd: HWND) {
  api?.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

export const isZoomed = (hwnd: HWND) => !!api?.IsZoomed(hwnd);

/** Visible frame (without the invisible resize borders Windows 10/11 add around windows). */
export function getVisibleRect(hwnd: HWND): Rect | null {
  if (!api) return null;
  const r: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  if (api.DwmGetWindowAttributeRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) === 0) return r;
  return getWindowRect(hwnd);
}

/** Moves a window so that its *visible* frame matches `target` (physical pixels). */
export function placeWindow(hwnd: HWND, target: Rect): boolean {
  if (!api || !api.IsWindow(hwnd)) return false;
  if (api.IsIconic(hwnd) || api.IsZoomed(hwnd)) api.ShowWindow(hwnd, SW_SHOWNORMAL);
  const outer = getWindowRect(hwnd);
  const visible = getVisibleRect(hwnd);
  // Compensate the invisible borders measured on this very window.
  const dl = outer && visible ? visible.left - outer.left : 0;
  const dt = outer && visible ? visible.top - outer.top : 0;
  const dr = outer && visible ? outer.right - visible.right : 0;
  const db = outer && visible ? outer.bottom - visible.bottom : 0;
  return !!api.SetWindowPos(
    hwnd, 0,
    target.left - dl, target.top - dt,
    target.right - target.left + dl + dr, target.bottom - target.top + dt + db,
    SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
  );
}

export function maximizeWindow(hwnd: HWND) {
  api?.ShowWindow(hwnd, 3 /* SW_MAXIMIZE */);
}

export function getMonitorWorkArea(hwnd: HWND): Rect | null {
  if (!api) return null;
  const mon = api.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  if (!mon) return null;
  const info = { cbSize: api.koffi.sizeof(api.MONITORINFO), rcMonitor: {}, rcWork: {}, dwFlags: 0 } as unknown as { rcWork: Rect };
  return api.GetMonitorInfoW(mon, info) ? info.rcWork : null;
}

// ---------- Minimal COM helpers ----------

let comReady = false;
export function ensureCom() {
  if (!api || comReady) return;
  api.CoInitializeEx(null, 0x2 /* COINIT_APARTMENTTHREADED */); // S_FALSE / RPC_E_CHANGED_MODE are fine
  comReady = true;
}

export function coCreate(clsid: string, iid: string): unknown | null {
  if (!api) return null;
  ensureCom();
  const out: unknown[] = [null];
  const hr = api.CoCreateInstance(guidBytes(clsid), null, 0x17 /* CLSCTX_ALL */, guidBytes(iid), out);
  return hr === 0 ? out[0] : null;
}

/** Calls vtable method `index` of a COM interface pointer with the given prototype. */
export function comCall(obj: unknown, index: number, proto: unknown, ...args: unknown[]): number {
  const k = api!.koffi;
  const vtbl = k.decode(obj, 'void *');
  const fn = k.decode(vtbl, index * k.sizeof('void *'), 'void *');
  return k.call(fn, proto as never, obj, ...args) as number;
}

export function comRelease(obj: unknown) {
  if (obj && api) comCall(obj, 2, api.ReleaseProto);
}

export function koffiApi() {
  return api;
}
