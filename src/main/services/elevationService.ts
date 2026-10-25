// Administrator mode, only on request and only for the current session. Orelle normally runs as
// a standard user; "Enable administrator mode" relaunches it through Windows' own UAC prompt
// (Start-Process -Verb RunAs) and "Back to normal mode" relaunches it as the signed-in user
// through Explorer. Nothing is installed or changed system-wide: the next sign-in starts Orelle
// as a standard user again.
//
// The two instances hand over through `relaunch.json` (userData): the new one waits for the old
// one to exit before taking the single-instance lock, so the taskbar and AppBars are given back
// and reserved again in order.
import { app } from 'electron';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';

const SYS = process.env.SystemRoot ?? 'C:\\Windows';
const PS = path.join(SYS, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const EXPLORER = path.join(SYS, 'explorer.exe');
const HANDOFF_MAX_AGE = 60_000;

interface Handoff { pid: number; at: number }

const handoffFile = () => path.join(app.getPath('userData'), 'relaunch.json');

/** The previous instance this one replaces (written just before a relaunch), if recent. */
export function readHandoff(): Handoff | null {
  try {
    const h = JSON.parse(fs.readFileSync(handoffFile(), 'utf8')) as Handoff;
    fs.unlinkSync(handoffFile());
    return Number.isInteger(h.pid) && h.pid !== process.pid && Date.now() - h.at < HANDOFF_MAX_AGE ? h : null;
  } catch {
    return null;
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // A standard process cannot open an elevated one: EPERM still means "running".
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** Resolves once `pid` has exited (or after `timeoutMs`). */
export function waitForExit(pid: number, timeoutMs = 15_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => (!alive(pid) || Date.now() > end ? resolve() : setTimeout(tick, 150));
    tick();
  });
}

/** Single-quoted PowerShell literal. */
const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

export class ElevationService {
  /** Set while handing over, so the closing instance ignores the newcomer's second-instance ping. */
  relaunching = false;

  constructor(readonly elevated: boolean) {}

  private writeHandoff() {
    fs.writeFileSync(handoffFile(), JSON.stringify({ pid: process.pid, at: Date.now() } satisfies Handoff));
  }

  private dropHandoff() {
    try { fs.unlinkSync(handoffFile()); } catch { /* none */ }
  }

  /**
   * Shows the UAC prompt and, once accepted, hands over to the elevated instance and quits.
   * Resolves `{ ok: false, canceled: true }` when the prompt is declined.
   */
  async enable(): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
    if (this.elevated) return { ok: true };
    const args = process.argv.slice(1).filter((a) => !a.startsWith('--orelle-'));
    const list = args.length ? ` -ArgumentList ${args.map(psq).join(',')}` : '';
    this.writeHandoff();
    this.relaunching = true;
    const res = await new Promise<{ ok: boolean; canceled?: boolean; error?: string }>((resolve) => {
      execFile(PS, ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${psq(process.execPath)}${list} -Verb RunAs`], { windowsHide: true, timeout: 120_000 }, (err, _out, stderr) => {
        if (!err) return resolve({ ok: true });
        // Declining the prompt makes Start-Process fail with "operation canceled by the user".
        const canceled = /annul|cancel/i.test(String(stderr));
        resolve({ ok: false, canceled, error: canceled ? undefined : String(stderr).trim().split(/\r?\n/)[0] });
      });
    });
    if (!res.ok) {
      this.relaunching = false;
      this.dropHandoff();
      log.info('elevation', res.canceled ? 'UAC prompt declined' : `Elevation failed: ${res.error}`);
      return res;
    }
    log.info('elevation', 'Handing over to the elevated instance');
    app.quit();
    return res;
  }

  /**
   * Relaunches Orelle as the signed-in (non-elevated) user. Explorer starts programs at the
   * user's own level, so it is used as the launcher. Packaged builds only (Explorer cannot pass
   * the dev build's arguments).
   */
  disable(): { ok: boolean; error?: string } {
    if (!this.elevated) return { ok: true };
    if (!app.isPackaged) return { ok: false, error: 'dev' };
    this.writeHandoff();
    this.relaunching = true;
    spawn(EXPLORER, [process.execPath], { detached: true, stdio: 'ignore' }).unref();
    log.info('elevation', 'Handing over to a standard instance');
    app.quit();
    return { ok: true };
  }
}
