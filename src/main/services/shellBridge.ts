// Runs resources/helpers/shell-helper.ps1 (read-only Shell queries + icon extraction).
import { app } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { log } from '../logger';

export function helperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'helpers', 'shell-helper.ps1')
    : path.join(app.getAppPath(), 'resources', 'helpers', 'shell-helper.ps1');
}

export function runShellHelper(mode: 'apps' | 'icons', cacheDir: string, stdin?: string, timeoutMs = 180_000, extraArgs: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(
      ps,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath(), '-Mode', mode, '-CacheDir', cacheDir, ...extraArgs],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`shell helper (${mode}) timed out`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else {
        log.warn('shell', `helper ${mode} exited ${code}`, err.slice(0, 2000));
        reject(new Error(`shell helper exited with ${code}`));
      }
    });
    child.stdin.end(stdin ?? '');
  });
}
