// Network diagnostics (Utilities › Network): adapters and their addresses, then a step-by-step
// check from the PC outwards — gateway, DNS, Internet (Windows' own connectivity probe) — so the
// user sees where a connection breaks. Only fixed commands (ping.exe with numeric arguments,
// PowerShell Get-NetIPConfiguration read-only) and well-known hosts are used.
import { net } from 'electron';
import { execFile } from 'node:child_process';
import { promises as dns } from 'node:dns';
import os from 'node:os';
import path from 'node:path';

export interface Adapter { name: string; ipv4: string[]; ipv6: string[]; mac: string; gateway: string | null; dns: string[] }
export interface Probe { id: 'gateway' | 'dns' | 'internet' | 'latency'; ok: boolean; ms: number | null; detail: string }

const SYS = process.env.SystemRoot ?? 'C:\\Windows';
const run = (file: string, args: string[], timeout = 15_000) =>
  new Promise<string>((resolve) => execFile(file, args, { timeout, windowsHide: true }, (_err, out) => resolve(String(out ?? ''))));

/** Average round-trip from `ping -n 3` (null when unreachable). Locale-independent: reads the numbers. */
export function parsePing(out: string): number | null {
  const times = [...out.matchAll(/[=<]\s*(\d+)\s*ms/gi)].map((m) => Number(m[1]));
  return times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
}

async function ping(host: string): Promise<number | null> {
  if (!/^[\w.:-]+$/.test(host)) return null;
  return parsePing(await run(path.join(SYS, 'System32', 'PING.EXE'), ['-n', '3', '-w', '1500', host]));
}

export async function adapters(): Promise<Adapter[]> {
  let config: { alias?: string; gw?: string | null; dns?: string[] | string | null }[] = [];
  try {
    const cmd = 'Get-NetIPConfiguration | ForEach-Object { [pscustomobject]@{ alias = $_.InterfaceAlias; gw = ($_.IPv4DefaultGateway | Select-Object -First 1).NextHop; dns = @($_.DNSServer | ForEach-Object { $_.ServerAddresses }) } } | ConvertTo-Json -Compress';
    const out = await run(path.join(SYS, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', cmd]);
    const parsed = JSON.parse(out || '[]');
    config = Array.isArray(parsed) ? parsed : [parsed];
  } catch { /* fall back to Node only */ }
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);
  return Object.entries(os.networkInterfaces()).flatMap(([name, addrs]) => {
    if (!addrs || addrs.every((a) => a.internal)) return [];
    const c = config.find((x) => x.alias === name);
    const gw = c?.gw && c.gw !== '0.0.0.0' ? c.gw : null;
    const dnsList = list(c?.dns);
    return [{
      name,
      ipv4: addrs.filter((a) => a.family === 'IPv4').map((a) => `${a.address}/${a.cidr?.split('/')[1] ?? ''}`),
      ipv6: addrs.filter((a) => a.family === 'IPv6' && !a.address.startsWith('fe80')).map((a) => a.address),
      mac: addrs[0]?.mac ?? '',
      gateway: gw,
      dns: [...new Set(dnsList)].slice(0, 4),
    }];
  });
}

export async function diagnose(): Promise<{ adapters: Adapter[]; probes: Probe[] }> {
  const ads = await adapters();
  const probes: Probe[] = [];
  const gw = ads.find((a) => a.gateway)?.gateway ?? null;
  const g = gw ? await ping(gw) : null;
  probes.push({ id: 'gateway', ok: g !== null, ms: g, detail: gw ?? '—' });
  let t = Date.now();
  try {
    const r = await dns.lookup('www.msftconnecttest.com');
    probes.push({ id: 'dns', ok: true, ms: Date.now() - t, detail: r.address });
  } catch (err) {
    probes.push({ id: 'dns', ok: false, ms: null, detail: (err as NodeJS.ErrnoException).code ?? 'error' });
  }
  t = Date.now();
  try {
    // The same probe Windows uses to decide whether a network has Internet access.
    const res = await net.fetch('http://www.msftconnecttest.com/connecttest.txt', { cache: 'no-store' });
    const body = await res.text();
    probes.push({ id: 'internet', ok: res.ok && body.trim() === 'Microsoft Connect Test', ms: Date.now() - t, detail: res.ok ? (body.trim() === 'Microsoft Connect Test' ? 'OK' : 'portal') : String(res.status) });
  } catch {
    probes.push({ id: 'internet', ok: false, ms: null, detail: 'unreachable' });
  }
  const p = await ping('1.1.1.1');
  probes.push({ id: 'latency', ok: p !== null, ms: p, detail: '1.1.1.1' });
  return { adapters: ads, probes };
}
