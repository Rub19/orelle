// Allowed scripts: only files the user added in Preferences, run with a fixed interpreter.
// The SHA-256 of the approved content is stored; if the file changes, Orelle asks again before running it.
import { dialog } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AllowedScript } from '../../shared/types';
import type { OrelleContext } from '../context';
import { log } from '../logger';

const SYS32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');

export async function fileHash(p: string): Promise<string> {
  return createHash('sha256').update(await fs.promises.readFile(p)).digest('hex');
}

export class ScriptService {
  constructor(private readonly ctx: OrelleContext) {}

  async run(script: AllowedScript): Promise<boolean> {
    if (!fs.existsSync(script.path)) {
      log.warn('scripts', `Missing script ${script.path}`);
      return false;
    }
    const hash = await fileHash(script.path);
    if (hash !== script.approvedHash) {
      const t = this.ctx.t;
      const res = await dialog.showMessageBox({
        type: 'warning',
        title: t('scripts.confirmTitle'),
        message: t(script.approvedHash ? 'scripts.changed' : 'scripts.firstRun', { name: script.name }),
        detail: `${script.path}\nSHA-256 ${hash}`,
        buttons: [t('scripts.allow'), t('common.cancel')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (res.response !== 0) return false;
      const scripts = this.ctx.settings.get().launcher.scripts.map((s) => (s.id === script.id ? { ...s, approvedHash: hash } : s));
      this.ctx.settings.update({ launcher: { scripts } });
    }
    const ext = path.extname(script.path).toLowerCase();
    const cwd = path.dirname(script.path);
    const ps = path.join(SYS32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const cmd = path.join(SYS32, 'cmd.exe');
    log.info('scripts', `Running ${script.path}`);
    let child;
    if (script.showConsole) {
      // `start` opens a visible console window that stays open after the script ends.
      const inner = ext === '.ps1' ? `"${ps}" -NoProfile -ExecutionPolicy Bypass -NoExit -File "${script.path}"` : `"${cmd}" /k "${script.path}"`;
      child = spawn(cmd, ['/d', '/c', `start "${script.name.replace(/"/g, '')}" ${inner}`], { cwd, detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
    } else {
      const [file, args] = ext === '.ps1' ? [ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script.path]] : [cmd, ['/d', '/c', script.path]];
      child = spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true });
    }
    child.on('error', (err) => log.error('scripts', 'spawn failed', err));
    child.unref();
    return true;
  }
}
