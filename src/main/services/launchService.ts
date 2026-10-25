// Opens apps, files, folders and URLs. Only targets that come from the app index, the user's
// own Dock items / commands, or launcher results are ever opened — never arbitrary command lines.
import { shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';

const EXPLORER = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe');

export interface AppTarget {
  appId?: string;
  path?: string;
  args?: string[];
}

// Set when Orelle runs in administrator mode: apps, files and folders it opens go through Explorer,
// which starts them at the signed-in user's normal level, so they don't inherit administrator rights.
let deElevate = false;
export function setDeElevatedLaunch(on: boolean) {
  deElevate = on;
}

function spawnDetached(file: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { detached: true, stdio: 'ignore', cwd, windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/** Launches an application, preferring its Start-menu identity (keeps jump lists, AUMID grouping). */
export async function launchApp(t: AppTarget): Promise<void> {
  const exe = t.path && /\.exe$/i.test(t.path) && fs.existsSync(t.path) ? t.path : null;
  // Explorer cannot pass arguments: items with arguments start directly (elevated in administrator mode).
  if (t.args?.length && exe) return spawnDetached(exe, t.args, path.dirname(exe));
  if (t.appId) {
    // A filesystem path used as app id: open it directly.
    if (/^[a-z]:\\/i.test(t.appId) && fs.existsSync(t.appId)) return openPath(t.appId);
    return spawnDetached(EXPLORER, [`shell:AppsFolder\\${t.appId}`]);
  }
  if (exe) return deElevate ? spawnDetached(EXPLORER, [exe]) : spawnDetached(exe, [], path.dirname(exe));
  if (t.path) return openPath(t.path);
  throw new Error('Nothing to launch');
}

export async function openPath(p: string): Promise<void> {
  if (p.startsWith('shell:') || deElevate) return spawnDetached(EXPLORER, [p]);
  const err = await shell.openPath(p);
  if (err) throw new Error(err);
}

export function revealPath(p: string) {
  shell.showItemInFolder(p);
}

const SAFE_SCHEMES = /^(https?:|mailto:|ms-settings:)/i;

export async function openUrl(url: string): Promise<void> {
  if (!SAFE_SCHEMES.test(url)) throw new Error(`Blocked URL scheme: ${url.slice(0, 40)}`);
  await shell.openExternal(url);
}

export function safeLaunch(fn: () => Promise<void>, what: string): Promise<boolean> {
  return fn().then(
    () => true,
    (err) => {
      log.error('launch', `Failed to open ${what}`, err);
      return false;
    },
  );
}
