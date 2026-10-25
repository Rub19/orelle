// Hardware sensors that Windows lets a standard user read, and nothing else:
// - GPU temperature, load, memory, power and fan through NVIDIA's own nvidia-smi (installed with
//   the driver) — other GPUs do not expose temperatures without a kernel driver;
// - battery health from Windows' battery report (powercfg /batteryreport, design vs full charge
//   capacity, cycle count);
// - CPU/motherboard temperatures need administrator rights (ACPI thermal zones) or a third-party
//   driver: reported as unavailable, never as a made-up value.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface GpuSensor { name: string; tempC: number | null; load: number | null; memUsedMB: number | null; memTotalMB: number | null; powerW: number | null; fan: number | null }
export interface BatteryHealth { id: string; designMWh: number; fullMWh: number; healthPercent: number; cycles: number | null }
export interface Sensors { gpus: GpuSensor[]; gpuSource: 'nvidia-smi' | null; battery: BatteryHealth | null; cpuTemp: null; cpuTempReason: 'admin-or-driver' }

const SYS = process.env.SystemRoot ?? 'C:\\Windows';
const run = (file: string, args: string[], timeout = 10_000) =>
  new Promise<string | null>((resolve) => execFile(file, args, { timeout, windowsHide: true }, (err, out) => resolve(err ? null : String(out))));

const num = (v: string | undefined) => {
  const n = Number.parseFloat((v ?? '').trim());
  return Number.isFinite(n) ? n : null;
};

/** CSV lines from `nvidia-smi --query-gpu=…`. "[N/A]" fields become null. */
export function parseNvidiaSmi(out: string): GpuSensor[] {
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const [name, temp, load, used, total, power, fan] = line.split(',').map((x) => x.trim());
    return { name, tempC: num(temp), load: num(load), memUsedMB: num(used), memTotalMB: num(total), powerW: num(power), fan: num(fan) };
  }).filter((g) => g.name);
}

/** Battery report XML (powercfg /batteryreport /xml): first battery. */
export function parseBatteryReport(xml: string): BatteryHealth | null {
  const block = /<Battery>([\s\S]*?)<\/Battery>/i.exec(xml)?.[1];
  if (!block) return null;
  const tag = (t: string) => new RegExp(`<${t}>([^<]*)</${t}>`, 'i').exec(block)?.[1]?.trim() ?? '';
  const design = Number(tag('DesignCapacity'));
  const full = Number(tag('FullChargeCapacity'));
  if (!design || !full) return null;
  const cycles = Number(tag('CycleCount'));
  return { id: tag('Id') || tag('Manufacturer') || 'Battery', designMWh: design, fullMWh: full, healthPercent: Math.round((full / design) * 1000) / 10, cycles: Number.isFinite(cycles) && cycles > 0 ? cycles : null };
}

export class SensorService {
  private batteryCache: { at: number; value: BatteryHealth | null } | null = null;

  async read(): Promise<Sensors> {
    const smi = path.join(SYS, 'System32', 'nvidia-smi.exe');
    let gpus: GpuSensor[] = [];
    if (fs.existsSync(smi)) {
      const out = await run(smi, ['--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw,fan.speed', '--format=csv,noheader,nounits']);
      if (out) gpus = parseNvidiaSmi(out);
    }
    return { gpus, gpuSource: gpus.length ? 'nvidia-smi' : null, battery: await this.battery(), cpuTemp: null, cpuTempReason: 'admin-or-driver' };
  }

  /** The battery report takes ~1 s to generate: cached for an hour. */
  private async battery(): Promise<BatteryHealth | null> {
    if (this.batteryCache && Date.now() - this.batteryCache.at < 3_600_000) return this.batteryCache.value;
    const file = path.join(os.tmpdir(), `orelle-battery-${process.pid}.xml`);
    let value: BatteryHealth | null = null;
    if ((await run(path.join(SYS, 'System32', 'powercfg.exe'), ['/batteryreport', '/xml', '/output', file], 20_000)) !== null) {
      try {
        value = parseBatteryReport(fs.readFileSync(file, 'utf8'));
      } catch { /* no battery */ }
      try { fs.unlinkSync(file); } catch { /* already gone */ }
    }
    this.batteryCache = { at: Date.now(), value };
    return value;
  }
}
