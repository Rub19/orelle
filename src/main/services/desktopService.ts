// Virtual desktops: listed from Explorer's registry values (read-only, reg.exe) and switched with
// the keyboard shortcuts Windows documents for it (Ctrl+Win+Left/Right, Ctrl+Win+D for a new
// desktop). Windows has no public API to drive desktops or to move another app's windows between
// them, so Orelle does not pretend to.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { parseDesktops, stepsBetween, type VirtualDesktop } from '../../shared/virtualDesktops';
import type { OrelleContext } from '../context';
import * as w32 from '../native/win32';

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VirtualDesktops';
const REG = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');

const query = (args: string[]) => new Promise<string>((resolve) => execFile(REG, ['query', ...args], { windowsHide: true, timeout: 5000 }, (_e, out) => resolve(String(out ?? ''))));
const value = (out: string, name: string) => new RegExp(`${name}\\s+REG_\\w+\\s+(\\S*)`, 'i').exec(out)?.[1] ?? null;

export class DesktopService {
  constructor(private readonly ctx: OrelleContext) {}

  async list(): Promise<VirtualDesktop[]> {
    const root = await query([KEY]);
    const names: Record<string, string> = {};
    const sub = await query([`${KEY}\\Desktops`, '/s', '/v', 'Name']);
    let current = '';
    for (const line of sub.split(/\r?\n/)) {
      const k = /\\Desktops\\(\{[0-9A-F-]+\})/i.exec(line);
      if (k) current = k[1].toUpperCase();
      const n = /^\s+Name\s+REG_SZ\s+(.*)$/i.exec(line);
      if (n && current) names[current] = n[1].trim();
    }
    return parseDesktops(value(root, 'VirtualDesktopIDs'), value(root, 'CurrentVirtualDesktop'), names, (i) => this.ctx.t('desktops.default', { n: i }));
  }

  /** Goes to desktop `index` with Windows' own shortcut. */
  async switchTo(index: number): Promise<void> {
    const list = await this.list();
    const from = list.find((d) => d.current)?.index ?? 0;
    const { key, count } = stepsBetween(from, Math.max(0, Math.min(list.length - 1, index)));
    for (let i = 0; i < count; i++) {
      w32.sendDesktopKey(key);
      await new Promise((r) => setTimeout(r, 180));
    }
  }

  create() {
    w32.sendDesktopKey('new');
  }
}
