// Live system data for widgets and the control center. Sampling runs only while at least one
// surface subscribes (a visible system/network/battery widget, or the open control center),
// and stops as soon as the last one unsubscribes.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ControlState, SystemStats } from '../../shared/types';
import * as audio from '../native/audio';
import * as w32 from '../native/win32';
import { log } from '../logger';

const SYS32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');

function run(file: string, args: string[], timeoutMs = 4000): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d) => (out += d));
    child.on('error', () => { clearTimeout(timer); resolve(''); });
    child.on('close', () => { clearTimeout(timer); resolve(out); });
  });
}

export class SystemService extends EventEmitter {
  private subscribers = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private lastCpu: { idle: number; total: number } | null = null;
  private lastNet: { rx: number; tx: number; at: number } | null = null;
  private latest: SystemStats | null = null;
  private brightnessSupported: boolean | null = null;

  subscribe(id: string) {
    this.subscribers.add(id);
    if (!this.timer) {
      void this.sample();
      this.timer = setInterval(() => void this.sample(), 2000);
    }
  }

  unsubscribe(id: string) {
    this.subscribers.delete(id);
    if (this.subscribers.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.lastCpu = null;
      this.lastNet = null;
    }
  }

  get stats() {
    return this.latest;
  }

  private cpuPercent(): number {
    let idle = 0;
    let total = 0;
    for (const c of os.cpus()) {
      const t = c.times;
      idle += t.idle;
      total += t.user + t.nice + t.sys + t.irq + t.idle;
    }
    const prev = this.lastCpu;
    this.lastCpu = { idle, total };
    if (!prev || total === prev.total) return 0;
    return Math.max(0, Math.min(100, 100 * (1 - (idle - prev.idle) / (total - prev.total))));
  }

  /** Total bytes received/sent from `netstat -e` (first line with two counters = bytes, in any language). */
  private async netBytes(): Promise<{ rx: number; tx: number } | null> {
    const out = await run(path.join(SYS32, 'netstat.exe'), ['-e']);
    for (const line of out.split(/\r?\n/)) {
      const m = /^\D*?(\d+)\s+(\d+)\s*$/.exec(line.trim());
      if (m) return { rx: Number(m[1]), tx: Number(m[2]) };
    }
    return null;
  }

  private disks(): SystemStats['disks'] {
    const out: SystemStats['disks'] = [];
    const drive = (process.env.SystemDrive ?? 'C:') + '\\';
    try {
      const s = fs.statfsSync(drive);
      out.push({ mount: drive.slice(0, 2), total: s.blocks * s.bsize, used: (s.blocks - s.bfree) * s.bsize });
    } catch { /* unavailable */ }
    return out;
  }

  private async sample() {
    try {
      const net = await this.netBytes();
      const now = Date.now();
      let netDown = 0;
      let netUp = 0;
      if (net && this.lastNet) {
        const dt = (now - this.lastNet.at) / 1000;
        netDown = Math.max(0, (net.rx - this.lastNet.rx) / dt);
        netUp = Math.max(0, (net.tx - this.lastNet.tx) / dt);
      }
      if (net) this.lastNet = { ...net, at: now };
      this.latest = {
        cpu: this.cpuPercent(),
        memTotal: os.totalmem(),
        memUsed: os.totalmem() - os.freemem(),
        disks: this.disks(),
        netDown,
        netUp,
        battery: w32.getPowerStatus(),
        uptime: os.uptime(),
      };
      this.emit('stats', this.latest);
    } catch (err) {
      log.warn('system', 'sampling failed', err);
    }
  }

  // ---------- Control center ----------

  async wifi(): Promise<ControlState['wifi']> {
    const out = await run(path.join(SYS32, 'netsh.exe'), ['wlan', 'show', 'interfaces']);
    if (!out.trim()) return null;
    const ssid = /^\s*SSID\s*:\s*(.+)$/m.exec(out)?.[1]?.trim() ?? null;
    const signal = /:\s*(\d{1,3})\s*%/.exec(out)?.[1];
    return { connected: !!ssid, ssid, signal: signal ? Number(signal) : null };
  }

  /** Internal panel brightness through WMI (laptops). Returns null on desktops / unsupported panels. */
  async brightness(): Promise<number | null> {
    if (this.brightnessSupported === false) return null;
    const out = await run(path.join(SYS32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness',
    ], 6000);
    const n = Number(out.trim());
    this.brightnessSupported = out.trim() !== '' && Number.isFinite(n);
    return this.brightnessSupported ? n : null;
  }

  private brightnessTimer: NodeJS.Timeout | null = null;
  setBrightness(level: number) {
    const v = Math.round(Math.max(0, Math.min(100, level)));
    if (this.brightnessTimer) clearTimeout(this.brightnessTimer);
    // Debounced: a slider drag produces one WMI call, not dozens.
    this.brightnessTimer = setTimeout(() => {
      void run(path.join(SYS32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
        '-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1;Brightness=${v}} | Out-Null`,
      ], 6000);
    }, 250);
  }

  async controlState(): Promise<ControlState> {
    const [wifi, brightness] = await Promise.all([this.wifi(), this.brightness()]);
    return { volume: audio.getVolume(), brightness, wifi, battery: w32.getPowerStatus() };
  }
}
