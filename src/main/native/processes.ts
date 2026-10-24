// Process enumeration and per-process metrics (Toolhelp32 + process times/memory/IO), PDH performance
// counters (GPU, disk, network), hung-window detection and guarded termination. All through koffi.
import { log } from '../logger';
import { enumTopLevelWindows, getWindowPid, isAppWindow, koffiApi } from './win32';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const koffi: typeof import('koffi') = require('koffi');

const TH32CS_SNAPPROCESS = 0x2;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_TERMINATE = 0x1;
const PROCESS_VM_READ = 0x10;

function bind() {
  const kernel32 = koffi.load('kernel32.dll');
  const psapi = koffi.load('psapi.dll');
  const user32 = koffi.load('user32.dll');
  const pdh = koffi.load('pdh.dll');
  const PROCESSENTRY32W = koffi.struct('ORELLE_PROCESSENTRY32W', {
    dwSize: 'uint32', cntUsage: 'uint32', th32ProcessID: 'uint32', th32DefaultHeapID: 'uintptr_t', th32ModuleID: 'uint32',
    cntThreads: 'uint32', th32ParentProcessID: 'uint32', pcPriClassBase: 'int32', dwFlags: 'uint32', szExeFile: koffi.array('char16_t', 260, 'String'),
  });
  const FILETIME = koffi.struct('ORELLE_FILETIME', { lo: 'uint32', hi: 'uint32' });
  const PMC = koffi.struct('ORELLE_PROCESS_MEMORY_COUNTERS_EX', {
    cb: 'uint32', PageFaultCount: 'uint32', PeakWorkingSetSize: 'size_t', WorkingSetSize: 'size_t', QuotaPeakPagedPoolUsage: 'size_t',
    QuotaPagedPoolUsage: 'size_t', QuotaPeakNonPagedPoolUsage: 'size_t', QuotaNonPagedPoolUsage: 'size_t', PagefileUsage: 'size_t',
    PeakPagefileUsage: 'size_t', PrivateUsage: 'size_t',
  });
  const IO = koffi.struct('ORELLE_IO_COUNTERS', {
    ReadOperationCount: 'uint64', WriteOperationCount: 'uint64', OtherOperationCount: 'uint64',
    ReadTransferCount: 'uint64', WriteTransferCount: 'uint64', OtherTransferCount: 'uint64',
  });
  const PDH_ITEM = koffi.struct('ORELLE_PDH_FMT_COUNTERVALUE_ITEM_W', {
    szName: 'void *', CStatus: 'uint32', pad: 'uint32', doubleValue: 'double',
  });
  return {
    PROCESSENTRY32W, FILETIME, PMC, IO, PDH_ITEM,
    CreateToolhelp32Snapshot: kernel32.func('intptr_t __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)'),
    Process32FirstW: kernel32.func('bool __stdcall Process32FirstW(intptr_t snap, _Inout_ ORELLE_PROCESSENTRY32W *e)'),
    Process32NextW: kernel32.func('bool __stdcall Process32NextW(intptr_t snap, _Inout_ ORELLE_PROCESSENTRY32W *e)'),
    OpenProcess: kernel32.func('intptr_t __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(intptr_t h)'),
    GetProcessTimes: kernel32.func('bool __stdcall GetProcessTimes(intptr_t h, _Out_ ORELLE_FILETIME *c, _Out_ ORELLE_FILETIME *e, _Out_ ORELLE_FILETIME *k, _Out_ ORELLE_FILETIME *u)'),
    GetProcessIoCounters: kernel32.func('bool __stdcall GetProcessIoCounters(intptr_t h, _Out_ ORELLE_IO_COUNTERS *io)'),
    QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(intptr_t h, uint32_t flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)'),
    TerminateProcess: kernel32.func('bool __stdcall TerminateProcess(intptr_t h, uint32_t code)'),
    GetLastError: kernel32.func('uint32_t __stdcall GetLastError()'),
    GetProcessMemoryInfo: psapi.func('bool __stdcall GetProcessMemoryInfo(intptr_t h, _Out_ ORELLE_PROCESS_MEMORY_COUNTERS_EX *pmc, uint32_t cb)'),
    IsHungAppWindow: user32.func('bool __stdcall IsHungAppWindow(intptr_t hwnd)'),
    PdhOpenQueryW: pdh.func('uint32_t __stdcall PdhOpenQueryW(const char16_t *src, uintptr_t user, _Out_ intptr_t *query)'),
    PdhAddEnglishCounterW: pdh.func('uint32_t __stdcall PdhAddEnglishCounterW(intptr_t query, const char16_t *path, uintptr_t user, _Out_ intptr_t *counter)'),
    PdhCollectQueryData: pdh.func('uint32_t __stdcall PdhCollectQueryData(intptr_t query)'),
    PdhGetFormattedCounterArrayW: pdh.func('uint32_t __stdcall PdhGetFormattedCounterArrayW(intptr_t counter, uint32_t fmt, _Inout_ uint32_t *size, _Out_ uint32_t *count, void *items)'),
    PdhCloseQuery: pdh.func('uint32_t __stdcall PdhCloseQuery(intptr_t query)'),
  };
}

let api: ReturnType<typeof bind> | null = null;
try {
  if (process.platform === 'win32') api = bind();
} catch (err) {
  log.error('processes', 'bindings unavailable', err);
}

export interface RawProcess {
  pid: number;
  ppid: number;
  name: string;
  threads: number;
  path: string | null;
  /** 100-ns units of kernel + user CPU time. */
  cpuTime: number | null;
  workingSet: number | null;
  privateBytes: number | null;
  ioRead: number | null;
  ioWrite: number | null;
}

const ft = (f: { lo: number; hi: number }) => f.hi * 4294967296 + f.lo;

export function listProcesses(): RawProcess[] {
  if (!api) return [];
  const a = api;
  const snap = a.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (!snap || snap === -1) return [];
  const out: RawProcess[] = [];
  try {
    const e = { dwSize: koffi.sizeof(a.PROCESSENTRY32W) } as Record<string, unknown>;
    if (!a.Process32FirstW(snap, e)) return [];
    do {
      const pid = e.th32ProcessID as number;
      const p: RawProcess = {
        pid, ppid: e.th32ParentProcessID as number, name: String(e.szExeFile), threads: e.cntThreads as number,
        path: null, cpuTime: null, workingSet: null, privateBytes: null, ioRead: null, ioWrite: null,
      };
      const h = pid ? a.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, false, pid) || a.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) : 0;
      if (h) {
        try {
          const c = {}, x = {}, k = {} as { lo: number; hi: number }, u = {} as { lo: number; hi: number };
          if (a.GetProcessTimes(h, c, x, k, u)) p.cpuTime = ft(k) + ft(u);
          const pmc = { cb: koffi.sizeof(a.PMC) } as Record<string, number>;
          if (a.GetProcessMemoryInfo(h, pmc, koffi.sizeof(a.PMC))) {
            p.workingSet = Number(pmc.WorkingSetSize);
            p.privateBytes = Number(pmc.PrivateUsage);
          }
          const io = {} as Record<string, number | bigint>;
          if (a.GetProcessIoCounters(h, io)) {
            p.ioRead = Number(io.ReadTransferCount);
            p.ioWrite = Number(io.WriteTransferCount);
          }
          const buf = new Uint16Array(1024);
          const size = [1024];
          if (a.QueryFullProcessImageNameW(h, 0, buf, size)) p.path = Buffer.from(buf.buffer, 0, size[0] * 2).toString('utf16le');
        } finally {
          a.CloseHandle(h);
        }
      }
      out.push(p);
      e.dwSize = koffi.sizeof(a.PROCESSENTRY32W);
    } while (a.Process32NextW(snap, e));
  } finally {
    a.CloseHandle(snap);
  }
  return out;
}

/** PIDs owning at least one visible app window that Windows reports as not responding. */
export function hungProcessIds(): Set<number> {
  const out = new Set<number>();
  if (!api) return out;
  for (const hwnd of enumTopLevelWindows()) {
    if (isAppWindow(hwnd) && api.IsHungAppWindow(hwnd)) out.add(getWindowPid(hwnd));
  }
  return out;
}

/** PIDs that own at least one visible app window (they are "Apps", the rest are background). */
export function windowedProcessIds(): Set<number> {
  const out = new Set<number>();
  for (const hwnd of enumTopLevelWindows()) if (isAppWindow(hwnd)) out.add(getWindowPid(hwnd));
  return out;
}

// Never offered for termination: killing these crashes or logs off Windows.
const CRITICAL = new Set(['system', 'system idle process', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe', 'lsaiso.exe', 'svchost.exe', 'fontdrvhost.exe', 'dwm.exe', 'memory compression', 'secure system', 'msmpeng.exe', 'sgrmbroker.exe']);

export function isCriticalProcess(name: string, pid: number): boolean {
  return pid <= 4 || CRITICAL.has(name.toLowerCase());
}

export function terminateProcess(pid: number): { ok: boolean; error?: 'denied' | 'gone' | 'failed' } {
  if (!api) return { ok: false, error: 'failed' };
  const h = api.OpenProcess(PROCESS_TERMINATE, false, pid);
  if (!h) {
    const err = api.GetLastError();
    return { ok: false, error: err === 5 ? 'denied' : err === 87 ? 'gone' : 'failed' };
  }
  try {
    return api.TerminateProcess(h, 1) ? { ok: true } : { ok: false, error: api.GetLastError() === 5 ? 'denied' : 'failed' };
  } finally {
    api.CloseHandle(h);
  }
}

// ---------- PDH counters ----------

const PDH_FMT_DOUBLE = 0x200;
const PDH_MORE_DATA = 0x800007d2;

export class PdhCounters {
  private query = 0;
  private counters = new Map<string, number>();

  constructor(paths: Record<string, string>) {
    if (!api) return;
    const q = [0];
    if (api.PdhOpenQueryW(null, 0, q) !== 0) return;
    this.query = q[0];
    for (const [key, p] of Object.entries(paths)) {
      const c = [0];
      if (api.PdhAddEnglishCounterW(this.query, p, 0, c) === 0) this.counters.set(key, c[0]);
      else log.debug('pdh', `counter unavailable: ${p}`);
    }
    api.PdhCollectQueryData(this.query); // first sample primes rate counters
  }

  get available() {
    return this.query !== 0 && this.counters.size > 0;
  }

  /** Collects a sample and returns every instance value of every counter. */
  sample(): Record<string, { name: string; value: number }[]> {
    const out: Record<string, { name: string; value: number }[]> = {};
    if (!api || !this.query) return out;
    api.PdhCollectQueryData(this.query);
    for (const [key, counter] of this.counters) {
      const size = [0];
      const count = [0];
      const st = api.PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, size, count, null);
      if (st !== PDH_MORE_DATA || !size[0]) { out[key] = []; continue; }
      const buf = Buffer.alloc(size[0]);
      if (api.PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, size, count, buf) !== 0) { out[key] = []; continue; }
      const itemSize = koffi.sizeof(api.PDH_ITEM);
      const list: { name: string; value: number }[] = [];
      for (let i = 0; i < count[0]; i++) {
        const item = koffi.decode(buf, i * itemSize, api.PDH_ITEM) as { szName: unknown; CStatus: number; doubleValue: number };
        if (item.CStatus !== 0 && item.CStatus !== 1) continue;
        const name = item.szName ? (koffi.decode(item.szName, 'char16_t', -1) as string) : '';
        list.push({ name, value: item.doubleValue });
      }
      out[key] = list;
    }
    return out;
  }

  close() {
    if (api && this.query) api.PdhCloseQuery(this.query);
    this.query = 0;
  }
}

export const processesAvailable = () => api !== null && koffiApi() !== null;
