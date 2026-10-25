// Always-visible surfaces (Dock, top bar, desktop widgets) share one renderer process: the top bar
// and the widgets are opened by the Dock's page with window.open, which Chromium keeps in the
// opener's process. Each still is a normal BrowserWindow with its own page, preload and IPC
// identity; only the process (≈ 30 MB each) is shared. When the Dock is disabled or not ready,
// a surface falls back to a window of its own. `--orelle-separate-processes` turns sharing off.
import { BrowserWindow, type BrowserWindowConstructorOptions, type WebContents } from 'electron';
import { pathToFileURL } from 'node:url';
import type { SurfaceKind } from '../../shared/types';
import type { OrelleContext } from '../context';
import { log } from '../logger';

const pending = new Map<string, BrowserWindowConstructorOptions>();
const SHARE = !process.argv.includes('--orelle-separate-processes');
let counter = 0;

/** Lets `host` open guest surfaces (and nothing else: every other window.open is denied). */
export function makeHost(host: BrowserWindow) {
  host.webContents.setWindowOpenHandler(({ frameName, url }) => {
    const options = pending.get(frameName);
    if (!options || !url.startsWith('file:')) return { action: 'deny' };
    pending.delete(frameName);
    return { action: 'allow', overrideBrowserWindowOptions: options };
  });
}

function loaded(wc: WebContents): Promise<boolean> {
  if (!wc.isLoading()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 4000);
    wc.once('did-finish-load', () => { clearTimeout(t); resolve(true); });
  });
}

/** Creates the window of `surface`, inside the host's process when possible, and loads its page. */
export async function openSurfaceWindow(ctx: OrelleContext, surface: SurfaceKind, options: BrowserWindowConstructorOptions, host: BrowserWindow | null): Promise<BrowserWindow> {
  const full: BrowserWindowConstructorOptions = {
    ...options,
    webPreferences: { preload: ctx.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, ...options.webPreferences, additionalArguments: [`--orelle-surface=${surface}`] },
  };
  if (SHARE && host && !host.isDestroyed() && !host.webContents.isCrashed() && (await loaded(host.webContents))) {
    const name = `orelle-guest-${surface}-${++counter}`;
    pending.set(name, full);
    const guest = await new Promise<BrowserWindow | null>((resolve) => {
      const t = setTimeout(() => resolve(null), 3000);
      const onCreate = (w: BrowserWindow, details: { frameName: string }) => {
        if (details.frameName !== name) return;
        clearTimeout(t);
        host.webContents.off('did-create-window', onCreate);
        resolve(w);
      };
      host.webContents.on('did-create-window', onCreate);
      const url = pathToFileURL(ctx.rendererFile(surface)).href;
      void host.webContents.executeJavaScript(`void window.open(${JSON.stringify(url)}, ${JSON.stringify(name)})`, true).catch(() => resolve(null));
    });
    pending.delete(name);
    if (guest) {
      log.info('windows', `${surface} shares the Dock's renderer process`);
      return guest;
    }
    log.warn('windows', `${surface}: shared window failed, using its own process`);
  }
  const win = new BrowserWindow(full);
  void win.loadFile(ctx.rendererFile(surface));
  return win;
}

/** Runs `fn` once the window's first paint is ready (immediately if that already happened). */
export function whenReady(win: BrowserWindow, fn: () => void) {
  let done = false;
  const run = () => { if (!done && !win.isDestroyed()) { done = true; fn(); } };
  win.once('ready-to-show', run);
  if (!win.webContents.isLoading()) setTimeout(run, 50);
  else win.webContents.once('did-finish-load', () => setTimeout(run, 100));
}

/** Blocks every navigation except to the surface's own page (a guest's first load is one). */
export function lockNavigation(ctx: OrelleContext, win: BrowserWindow, surface: SurfaceKind) {
  const own = pathToFileURL(ctx.rendererFile(surface)).href.toLowerCase();
  win.webContents.on('will-navigate', (e, url) => {
    if (url.split(/[?#]/)[0].toLowerCase() !== own) e.preventDefault();
  });
}
