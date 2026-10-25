// Activity monitor data: processes (CPU, memory, disk, GPU per process), system totals with history,
// startup apps, services and hardware info. Sampling only runs while the Monitor window is visible.
import { app, dialog, type BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OrelleContext } from '../context';
import { hungProcessIds, isCriticalProcess, listProcesses, PdhCounters, terminateProcess, windowedProcessIds } from '../native/processes';
import * as w32 from '../native/win32';
import { log } from '../logger';

const SYS32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const HISTORY = 240; // samples (~6 min at 1.5 s)
const INTERVAL = 1500;

import type { MonitorSampleDto, ProcRow, StartupItemDto } from '../../shared/appTypes';
export type MonitorSample = MonitorSampleDto;
type StartupItem = StartupItemDto;

function run(file: string, args: string[], timeoutMs = 15000): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d) => (out += d));
    child.on('error', () => { clearTimeout(timer); resolve(''); });
    child.on('close', () => { clearTimeout(timer); resolve(out); });
  });
}

const REG = path.join(SYS32, 'reg.exe');
const PS = path.join(SYS32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const RUN_KEYS = {
  HKCU: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  HKLM: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  HKLM32: 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
} as const;
// Where Windows itself (Task Manager / Settings > Startup apps) records enabled/disabled state.
const APPROVED = {
  HKCU: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  HKLM: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
  HKLM32: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32',
  StartupUser: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
  StartupCommon: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
} as const;

async function regValues(key: string): Promise<{ name: string; type: string; data: string }[]> {
  const out = await run(REG, ['query', key]);
  const values: { name: string; type: string; data: string }[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s{4}(.+?)\s{4}(REG_\w+)\s{4}(.*)$/.exec(line);
    if (m) values.push({ name: m[1], type: m[2], data: m[3] });
  }
  return values;
}

export class MonitorService extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private prev = new Map<number, { cpu: number | null; io: number; at: number }>();
  private lastCpu: { idle: number; total: number } | null = null;
  private pdh: PdhCounters | null = null;
  private history: Omit<MonitorSample, 'processes'>[] = [];
  private nameCache = new Map<string, string>();

  constructor(private readonly ctx: OrelleContext) {
    super();
  }

  get running() {
    return this.timer !== null;
  }

  start() {
    if (this.timer) return;
    this.pdh ??= new PdhCounters({
      gpu: '\\GPU Engine(*)\\Utilization Percentage',
      diskBytes: '\\PhysicalDisk(_Total)\\Disk Bytes/sec',
      diskBusy: '\\PhysicalDisk(_Total)\\% Disk Time',
      netDown: '\\Network Interface(*)\\Bytes Received/sec',
      netUp: '\\Network Interface(*)\\Bytes Sent/sec',
    });
    this.sample();
    this.timer = setInterval(() => this.sample(), INTERVAL);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pdh?.close();
    this.pdh = null;
    this.prev.clear();
    this.lastCpu = null;
  }

  getHistory() {
    return this.history;
  }

  private cpuTotal(): number {
    let idle = 0;
    let total = 0;
    for (const c of os.cpus()) {
      idle += c.times.idle;
      total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle;
    }
    const prev = this.lastCpu;
    this.lastCpu = { idle, total };
    if (!prev || total === prev.total) return 0;
    return Math.max(0, Math.min(100, 100 * (1 - (idle - prev.idle) / (total - prev.total))));
  }

  private displayName(p: { name: string; path: string | null }) {
    if (!p.path) return p.name.replace(/\.exe$/i, '');
    const key = p.path.toLowerCase();
    let n = this.nameCache.get(key);
    if (!n) {
      n = this.ctx.apps.entryFor({ exe: p.path })?.name ?? p.name.replace(/\.exe$/i, '');
      this.nameCache.set(key, n);
    }
    return n;
  }

  private sample() {
    try {
      const now = Date.now();
      const cores = os.cpus().length || 1;
      const raw = listProcesses();
      const hung = hungProcessIds();
      const windowed = windowedProcessIds();
      const counters = this.pdh?.sample() ?? {};

      // GPU: per process = busiest engine type; system = busiest engine type overall.
      const gpuByPid = new Map<number, Map<string, number>>();
      const gpuByType = new Map<string, number>();
      for (const it of counters.gpu ?? []) {
        const m = /pid_(\d+)_.*engtype_(\w+)/.exec(it.name);
        if (!m) continue;
        const pid = Number(m[1]);
        const type = m[2];
        const per = gpuByPid.get(pid) ?? new Map<string, number>();
        per.set(type, (per.get(type) ?? 0) + it.value);
        gpuByPid.set(pid, per);
        gpuByType.set(type, (gpuByType.get(type) ?? 0) + it.value);
      }
      const sum = (k: string) => (counters[k]?.length ? counters[k].reduce((a, b) => a + b.value, 0) : null);

      let threads = 0;
      const rows: ProcRow[] = [];
      const seen = new Set<number>();
      for (const p of raw) {
        seen.add(p.pid);
        threads += p.threads;
        const prev = this.prev.get(p.pid);
        const io = (p.ioRead ?? 0) + (p.ioWrite ?? 0);
        let cpu = 0;
        let disk = 0;
        if (prev && p.cpuTime !== null && prev.cpu !== null) {
          const dt = (now - prev.at) / 1000;
          cpu = Math.max(0, Math.min(100, ((p.cpuTime - prev.cpu) / 1e7 / dt / cores) * 100));
          disk = Math.max(0, (io - prev.io) / dt);
        }
        this.prev.set(p.pid, { cpu: p.cpuTime, io, at: now });
        const gpu = Math.min(100, Math.max(0, ...(gpuByPid.get(p.pid)?.values() ?? [0])));
        const critical = isCriticalProcess(p.name, p.pid);
        rows.push({
          pid: p.pid,
          ppid: p.ppid,
          name: p.name,
          display: p.pid === 0 ? 'System Idle Process' : this.displayName(p),
          path: p.path,
          icon: p.path ? this.ctx.icons.get(p.path) : null,
          cpu,
          memory: p.privateBytes ?? p.workingSet ?? 0,
          disk,
          gpu,
          threads: p.threads,
          kind: windowed.has(p.pid) ? 'app' : critical || !p.path || p.path.toLowerCase().startsWith((process.env.SystemRoot ?? 'C:\\Windows').toLowerCase()) ? 'system' : 'background',
          hung: hung.has(p.pid),
          critical,
        });
      }
      for (const pid of this.prev.keys()) if (!seen.has(pid)) this.prev.delete(pid);

      const sample: MonitorSample = {
        at: now,
        cpu: this.cpuTotal(),
        memUsed: os.totalmem() - os.freemem(),
        memTotal: os.totalmem(),
        gpu: gpuByType.size ? Math.min(100, Math.max(...gpuByType.values())) : null,
        diskBytes: sum('diskBytes'),
        diskBusy: sum('diskBusy') === null ? null : Math.min(100, sum('diskBusy')!),
        netDown: sum('netDown'),
        netUp: sum('netUp'),
        processes: rows,
        counts: { processes: rows.length, threads, apps: windowed.size, hung: hung.size },
      };
      const { processes: _omit, ...point } = sample;
      void _omit;
      this.history.push(point);
      if (this.history.length > HISTORY) this.history.shift();
      this.emit('sample', sample);
    } catch (err) {
      log.warn('monitor', 'sample failed', err);
    }
  }

  // ---------- Process actions ----------

  /** Asks the process's windows to close (the app may prompt to save). */
  closeApp(pid: number): number {
    let n = 0;
    for (const w of this.ctx.tracker.list()) if (w.pid === pid) { w32.closeWindow(w.hwnd); n++; }
    return n;
  }

  async endProcess(pid: number, parent: BrowserWindow | null): Promise<{ ok: boolean; error?: string; canceled?: boolean }> {
    const proc = listProcesses().find((p) => p.pid === pid);
    if (!proc) return { ok: false, error: 'gone' };
    if (isCriticalProcess(proc.name, pid)) return { ok: false, error: 'critical' };
    if (pid === process.pid || proc.ppid === process.pid) return { ok: false, error: 'self' };
    const t = this.ctx.t;
    const opts = {
      type: 'warning' as const,
      title: t('monitor.end.title'),
      message: t('monitor.end.message', { name: this.displayName(proc) }),
      detail: t('monitor.end.detail', { pid, path: proc.path ?? proc.name }),
      buttons: [t('monitor.end.confirm'), t('common.cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const res = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    if (res.response !== 0) return { ok: false, canceled: true };
    const r = terminateProcess(pid);
    log.info('monitor', `End process ${proc.name} (${pid}): ${r.ok ? 'ok' : r.error}`);
    return r;
  }

  // ---------- Startup apps ----------

  private journalFile() {
    return path.join(this.ctx.dataDir, 'startup-changes.json');
  }

  journal(): { at: number; id: string; name: string; source: string; previous: string | null }[] {
    try { return JSON.parse(fs.readFileSync(this.journalFile(), 'utf8')); } catch { return []; }
  }

  async startupItems(): Promise<StartupItem[]> {
    const items: StartupItem[] = [];
    const approved: Record<string, Map<string, string>> = {};
    for (const [src, key] of Object.entries(APPROVED)) {
      approved[src] = new Map((await regValues(key)).map((v) => [v.name.toLowerCase(), v.data]));
    }
    const isEnabled = (src: string, name: string) => {
      const data = approved[src]?.get(name.toLowerCase());
      // First byte even (02/06) = enabled, odd (03/07) = disabled; no record = enabled.
      return !data || parseInt(data.slice(0, 2), 16) % 2 === 0;
    };
    const exeOf = (cmd: string) => /^"([^"]+)"/.exec(cmd)?.[1] ?? cmd.split(/\s+(?=[-/])/)[0];
    for (const src of ['HKCU', 'HKLM', 'HKLM32'] as const) {
      for (const v of await regValues(RUN_KEYS[src])) {
        if (v.type !== 'REG_SZ' && v.type !== 'REG_EXPAND_SZ') continue;
        const exe = exeOf(v.data);
        items.push({
          id: `${src}:${v.name}`, name: v.name, command: v.data, source: src, enabled: isEnabled(src, v.name), canToggle: this.canToggle(src),
          icon: exe && fs.existsSync(exe) ? this.ctx.icons.get(exe, true) : null,
        });
      }
    }
    const folders = {
      StartupUser: path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
      StartupCommon: path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'StartUp'),
    } as const;
    for (const [src, dir] of Object.entries(folders) as [keyof typeof folders, string][]) {
      let files: string[] = [];
      try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase() !== 'desktop.ini'); } catch { /* none */ }
      for (const f of files) {
        const full = path.join(dir, f);
        items.push({
          id: `${src}:${f}`, name: f.replace(/\.lnk$/i, ''), command: full, source: src, enabled: isEnabled(src, f), canToggle: this.canToggle(src),
          icon: this.ctx.icons.get(full, true),
        });
      }
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Per-user entries always; machine-wide ones (HKLM, all-users Startup folder) in administrator mode. */
  private canToggle(src: string) {
    return src === 'HKCU' || src === 'StartupUser' || (this.ctx.capabilities.elevated && src in APPROVED);
  }

  /**
   * Enables/disables a per-user startup entry the way Windows itself does (StartupApproved flag);
   * the entry is never deleted, and the previous flag is journaled so it can be restored.
   */
  async setStartupEnabled(id: string, enabled: boolean): Promise<boolean> {
    const [src, ...rest] = id.split(':');
    const name = rest.join(':');
    if (!this.canToggle(src)) return false;
    const key = APPROVED[src as keyof typeof APPROVED];
    const previous = (await regValues(key)).find((v) => v.name.toLowerCase() === name.toLowerCase())?.data ?? null;
    const data = (enabled ? '02' : '03') + '0'.repeat(22);
    const out = await run(REG, ['add', key, '/v', name, '/t', 'REG_BINARY', '/d', data, '/f']);
    const ok = /succès|success|operation/i.test(out) || (await regValues(key)).some((v) => v.name.toLowerCase() === name.toLowerCase() && v.data.startsWith(data.slice(0, 2)));
    if (ok) {
      const journal = this.journal();
      if (!journal.some((j) => j.id === id)) journal.push({ at: Date.now(), id, name, source: src, previous });
      fs.writeFileSync(this.journalFile(), JSON.stringify(journal, null, 2));
      log.info('monitor', `Startup ${name} -> ${enabled ? 'enabled' : 'disabled'}`);
    }
    return ok;
  }

  /** Puts every startup flag Orelle changed back to its original value. */
  async restoreStartup(): Promise<number> {
    let n = 0;
    const kept: ReturnType<MonitorService['journal']> = [];
    for (const j of this.journal()) {
      const key = APPROVED[j.source as keyof typeof APPROVED];
      if (!key) continue;
      // Machine-wide flags can only be put back in administrator mode: kept for later until then.
      if (!this.canToggle(j.source)) { kept.push(j); continue; }
      if (j.previous === null) await run(REG, ['delete', key, '/v', j.name, '/f']);
      else await run(REG, ['add', key, '/v', j.name, '/t', 'REG_BINARY', '/d', j.previous, '/f']);
      n++;
    }
    try {
      if (kept.length) fs.writeFileSync(this.journalFile(), JSON.stringify(kept, null, 2));
      else fs.unlinkSync(this.journalFile());
    } catch { /* none */ }
    return n;
  }

  // ---------- Services & system info (read-only) ----------

  async services(): Promise<{ name: string; display: string; state: string; start: string; pid: number }[]> {
    const out = await run(PS, ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Service | Select-Object Name,DisplayName,State,StartMode,ProcessId | ConvertTo-Json -Compress'], 30000);
    try {
      const raw = JSON.parse(out) as { Name: string; DisplayName: string; State: string; StartMode: string; ProcessId: number }[];
      return raw.map((s) => ({ name: s.Name, display: s.DisplayName, state: s.State, start: s.StartMode, pid: s.ProcessId })).sort((a, b) => a.display.localeCompare(b.display));
    } catch {
      return [];
    }
  }

  private infoCache: Record<string, unknown> | null = null;
  async systemInfo(): Promise<Record<string, unknown>> {
    if (this.infoCache) return { ...this.infoCache, uptime: os.uptime() };
    const out = await run(PS, ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $o=Get-CimInstance Win32_OperatingSystem; $c=Get-CimInstance Win32_Processor | Select-Object -First 1; $g=@(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }); $m=Get-CimInstance Win32_ComputerSystem; @{ os=$o.Caption; build=$o.BuildNumber; cpu=$c.Name; cores=$c.NumberOfCores; threads=$c.NumberOfLogicalProcessors; gpus=$g; model=($m.Manufacturer + " " + $m.Model) } | ConvertTo-Json -Compress'], 30000);
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(out); } catch { /* fall back to Node data */ }
    const drives: { mount: string; total: number; free: number }[] = [];
    for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      try {
        const s = fs.statfsSync(`${l}:\\`);
        if (s.blocks > 0) drives.push({ mount: `${l}:`, total: s.blocks * s.bsize, free: s.bavail * s.bsize });
      } catch { /* no drive */ }
    }
    this.infoCache = {
      os: parsed.os ?? `Windows ${os.release()}`,
      build: parsed.build ?? os.release(),
      cpu: parsed.cpu ?? os.cpus()[0]?.model,
      cores: parsed.cores ?? null,
      threads: parsed.threads ?? os.cpus().length,
      gpus: parsed.gpus ?? [],
      model: parsed.model ?? null,
      memory: os.totalmem(),
      host: os.hostname(),
      drives,
    };
    return { ...this.infoCache, uptime: os.uptime() };
  }

  async exportReport(parent: BrowserWindow | null, latest: MonitorSample | null): Promise<{ ok: boolean; canceled?: boolean }> {
    const opts = { defaultPath: `orelle-diagnostic-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }, { name: 'JSON', extensions: ['json'] }] };
    const res = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    const info = await this.systemInfo();
    const startup = await this.startupItems();
    const procs = (latest?.processes ?? []).slice().sort((a, b) => b.memory - a.memory);
    if (res.filePath.toLowerCase().endsWith('.json')) {
      await fs.promises.writeFile(res.filePath, JSON.stringify({ generatedAt: new Date().toISOString(), app: `Orelle ${app.getVersion()}`, system: info, history: this.history, processes: procs, startup }, null, 2));
      return { ok: true };
    }
    const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;
    const lines = [
      `Orelle diagnostic report — ${new Date().toLocaleString()}`,
      `Orelle ${app.getVersion()} · Electron ${process.versions.electron}`,
      '',
      '== System ==',
      ...Object.entries(info).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)).join(', ') : v}`),
      '',
      '== Current load ==',
      latest ? `CPU ${latest.cpu.toFixed(1)} % · RAM ${mb(latest.memUsed)} / ${mb(latest.memTotal)} · GPU ${latest.gpu?.toFixed(1) ?? 'n/a'} % · Disk ${latest.diskBusy?.toFixed(1) ?? 'n/a'} %` : 'n/a',
      latest ? `${latest.counts.processes} processes, ${latest.counts.threads} threads, ${latest.counts.apps} apps, ${latest.counts.hung} not responding` : '',
      '',
      '== Processes by memory (top 40) ==',
      ...procs.slice(0, 40).map((p) => `${String(p.pid).padStart(6)}  ${mb(p.memory).padStart(8)}  CPU ${p.cpu.toFixed(1).padStart(5)} %  ${p.hung ? '[NOT RESPONDING] ' : ''}${p.display} (${p.name})`),
      '',
      '== Startup apps ==',
      ...startup.map((s) => `${s.enabled ? '[on] ' : '[off]'} ${s.name}  (${s.source})  ${s.command}`),
    ];
    await fs.promises.writeFile(res.filePath, lines.join('\r\n'), 'utf8');
    return { ok: true };
  }
}
