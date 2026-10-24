// NOVA main process: wires services and surfaces, owns the application lifecycle.
import { app, BrowserWindow, ipcMain, nativeTheme, powerMonitor, screen, type IpcMainInvokeEvent, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createTranslator, resolveLanguage } from '../shared/i18n';
import type { Bootstrap, Settings, SurfaceKind } from '../shared/types';
import type { NovaContext } from './context';
import { Hotkeys } from './hotkeys';
import { log } from './logger';
import * as w32 from './native/win32';
import { AppIndex } from './services/appIndex';
import { ClipboardHistory } from './services/clipboardHistory';
import { FileIndex } from './services/fileIndex';
import { buildDefaultDock } from './services/firstRun';
import { IconService, registerIconScheme } from './services/iconService';
import { SearchService } from './services/searchService';
import { SettingsService } from './services/settingsService';
import { UsageService } from './services/usageService';
import { WindowTracker } from './services/windowTracker';
import { NovaTray } from './tray';
import { DockController } from './windows/dockController';
import { LauncherController } from './windows/launcherController';
import { SettingsController } from './windows/settingsController';

const argValue = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const SMOKE = process.argv.includes('--nova-smoke');

// Isolated profile for tests: --nova-user-data=<dir>.
const customData = argValue('nova-user-data') ?? (SMOKE ? path.join(app.getPath('temp'), `nova-smoke-${process.pid}`) : undefined);
if (customData) app.setPath('userData', customData);
else app.setPath('userData', path.join(app.getPath('appData'), 'NOVA'));

app.setAppUserModelId('com.nova.desktop');
registerIconScheme();

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void main();
}

process.on('uncaughtException', (err) => log.error('process', 'Uncaught exception', err));
process.on('unhandledRejection', (err) => log.error('process', 'Unhandled rejection', err));

async function main() {
  await app.whenReady();
  const dataDir = app.getPath('userData');
  const logDir = path.join(dataDir, 'logs');
  log.init(logDir);
  log.info('app', `NOVA ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform} ${process.getSystemVersion()})`);

  const settings = new SettingsService(dataDir);
  const usage = new UsageService(dataDir);
  const icons = new IconService(path.join(dataDir, 'icon-cache'));
  icons.serve();
  const apps = new AppIndex(dataDir, icons);
  const tracker = new WindowTracker(process.pid);
  const files = new FileIndex();
  const clip = new ClipboardHistory();

  const distDir = __dirname;
  const language = () => resolveLanguage(settings.get().general.language, app.getLocale());
  const ctx: NovaContext = {
    dataDir,
    logDir,
    settings,
    usage,
    icons,
    apps,
    tracker,
    capabilities: { win32: w32.win32Available(), windowTracking: false, appBar: w32.win32Available(), acrylic: Number(process.getSystemVersion().split('.')[2] ?? 0) >= 22621 },
    t: createTranslator(language()),
    language: language(),
    preload: path.join(distDir, 'preload.js'),
    rendererFile: (s) => path.join(distDir, 'renderer', `${s}.html`),
    actions: {
      toggleLauncher: () => launcher.toggle(),
      openSettings: (section) => settingsUi.open(section),
      toggleDock: () => dock.toggleVisible(),
      pinToDock: (ref) => dock.pinRef(ref),
    },
  };

  const search = new SearchService(ctx, files, clip);
  const dock = new DockController(ctx);
  const launcher = new LauncherController(ctx, search);
  const hotkeys = new Hotkeys(() => launcher.toggle());
  const settingsUi = new SettingsController(ctx, hotkeys);
  const tray = new NovaTray(ctx, path.join(distDir, 'icons'), () => app.quit());

  applyTheme(settings.get());
  dock.registerIpc();
  launcher.registerIpc();
  settingsUi.registerIpc();
  registerSharedIpc(ctx, { dock, launcher, settingsUi });

  // ---------- First run: build a Dock from installed apps ----------
  if (settings.firstRun || settings.get().dock.items.length === 0) {
    if (!apps.ready) await apps.refresh();
    settings.update({ dock: { items: buildDefaultDock(apps) } });
    log.info('app', 'First run: default Dock created');
  } else {
    void apps.refresh();
  }

  tracker.start();
  ctx.capabilities.windowTracking = tracker.available;
  dock.start();
  launcher.create();
  tray.sync();
  syncLoginItem(settings.get());
  if (settings.get().launcher.enabled) {
    const res = hotkeys.apply(settings.get().launcher.hotkey);
    if (!res.ok) log.warn('app', `Launcher shortcut unavailable (${res.error}); change it in Preferences`);
  }
  if (settings.get().privacy.clipboardHistory && launcher.window) clip.enable(launcher.window);
  if (settings.firstRun && !SMOKE) settingsUi.open('general');

  // Background warm-up, once the UI is up.
  setTimeout(() => {
    apps.warmIcons();
    if (settings.get().launcher.providers.files) void files.build();
  }, SMOKE ? 0 : 8000);

  // ---------- Reactivity ----------
  tracker.on('change', () => dock.pushState());
  tracker.on('foreground', () => dock.pushState());
  tracker.on('fullscreen', (fs: boolean) => dock.onFullscreenChanged(fs));
  apps.on('change', () => dock.pushState());
  icons.on('change', () => {
    dock.pushState();
    broadcast('nova:iconsChanged');
  });

  settings.on('change', (next: Settings, prev: Settings) => {
    const lang = language();
    if (lang !== ctx.language) {
      ctx.language = lang;
      ctx.t = createTranslator(lang);
    }
    applyTheme(next);
    dock.onSettingsChanged(next, prev);
    tray.sync();
    if (next.general.launchAtLogin !== prev.general.launchAtLogin) syncLoginItem(next);
    if (next.launcher.enabled !== prev.launcher.enabled) {
      if (next.launcher.enabled) hotkeys.apply(next.launcher.hotkey);
      else hotkeys.disable();
    }
    if (next.appearance.effects !== prev.appearance.effects) {
      launcher.onEffectsChanged();
      settingsUi.updateTitleBar();
    }
    if (next.privacy.clipboardHistory !== prev.privacy.clipboardHistory) {
      if (next.privacy.clipboardHistory && launcher.window) clip.enable(launcher.window);
      else clip.disable();
    }
    if (next.launcher.providers.files && !prev.launcher.providers.files) void files.build();
    broadcastSettings(ctx);
  });

  nativeTheme.on('updated', () => {
    settingsUi.updateTitleBar();
    broadcastSettings(ctx);
  });

  let displayTimer: NodeJS.Timeout | null = null;
  const onDisplays = () => {
    if (displayTimer) clearTimeout(displayTimer);
    displayTimer = setTimeout(() => dock.onDisplaysChanged(), 300);
  };
  screen.on('display-added', onDisplays);
  screen.on('display-removed', onDisplays);
  screen.on('display-metrics-changed', onDisplays);

  const onWake = () => {
    log.info('app', 'Resumed / unlocked: refreshing integrations');
    hotkeys.refresh();
    tracker.refresh();
    onDisplays();
  };
  powerMonitor.on('resume', onWake);
  powerMonitor.on('unlock-screen', onWake);

  // `NOVA --nova-quit` stops the running instance cleanly (scripts, uninstaller).
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--nova-quit')) app.quit();
    else settingsUi.open(argv.find((a) => a.startsWith('--nova-section='))?.split('=')[1]);
  });
  // NOVA lives in the background: closing the preferences window must not quit it.
  app.on('window-all-closed', () => { /* stay resident */ });
  app.on('before-quit', () => {
    hotkeys.disable();
    tracker.stop();
    files.dispose();
    clip.disable();
    dock.destroy();
    tray.destroy();
    settings.flush();
    usage.flush();
    log.info('app', 'NOVA stopped');
    log.flushSync();
  });

  if (SMOKE) void runSmoke(ctx, { dock, launcher, search, files });
}

function applyTheme(s: Settings) {
  const theme = s.appearance.theme;
  nativeTheme.themeSource = theme === 'system' ? 'system' : theme === 'light' ? 'light' : 'dark';
}

function syncLoginItem(s: Settings) {
  if (SMOKE) return;
  const opts = app.isPackaged
    ? { openAtLogin: s.general.launchAtLogin }
    : { openAtLogin: s.general.launchAtLogin, path: process.execPath, args: [app.getAppPath()] };
  try {
    if (app.getLoginItemSettings(opts).openAtLogin !== s.general.launchAtLogin) app.setLoginItemSettings(opts);
  } catch (err) {
    log.warn('app', 'Cannot update login item', err);
  }
}

function broadcast(channel: string, ...args: unknown[]) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
}

function broadcastSettings(ctx: NovaContext) {
  broadcast('nova:settings', { settings: ctx.settings.get(), language: ctx.language, darkSystem: nativeTheme.shouldUseDarkColors });
}

function registerSharedIpc(
  ctx: NovaContext,
  c: { dock: DockController; launcher: LauncherController; settingsUi: SettingsController },
) {
  const surfaceOf = (wc: WebContents): SurfaceKind | null => {
    if (c.dock.window?.webContents === wc) return 'dock';
    if (c.launcher.window?.webContents === wc) return 'launcher';
    if (c.settingsUi.window?.webContents === wc) return 'settings';
    return null;
  };

  ipcMain.handle('nova:bootstrap', (e: IpcMainInvokeEvent): Bootstrap | null => {
    const surface = surfaceOf(e.sender);
    if (!surface) return null;
    return {
      surface,
      settings: ctx.settings.get(),
      language: ctx.language,
      darkSystem: nativeTheme.shouldUseDarkColors,
      version: app.getVersion(),
      capabilities: ctx.capabilities,
    };
  });

  ipcMain.handle('nova:updateSettings', (e, patch: unknown) => {
    const surface = surfaceOf(e.sender);
    if (surface !== 'settings' && surface !== 'dock') return null;
    if (typeof patch !== 'object' || patch === null) return null;
    return ctx.settings.update(patch);
  });
}

// ---------- Smoke test (npm run smoke) ----------

async function runSmoke(
  ctx: NovaContext,
  c: { dock: DockController; launcher: LauncherController; search: SearchService; files: FileIndex },
) {
  const report: Record<string, unknown> = { ok: false };
  const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => checks.push({ name, ok, detail });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    await wait(2500);
    check('win32 bindings', ctx.capabilities.win32);
    check('window tracking', ctx.tracker.available, { windows: ctx.tracker.list().length });
    check('apps indexed', ctx.apps.entries().length > 10, { count: ctx.apps.entries().length });
    check('default dock built', ctx.settings.get().dock.items.length >= 3, ctx.settings.get().dock.items.map((i) => ('name' in i ? i.name : i.type)));
    check('dock window visible', c.dock.isVisible(), c.dock.window?.getBounds());
    const calc = c.search.search('2+2*3');
    check('calculator', calc.results[0]?.kind === 'calc' && /^8$/.test(calc.results[0].title), calc.results[0]);
    const unit = c.search.search('10 km en mi');
    check('unit conversion', unit.results[0]?.kind === 'unit', unit.results[0]?.title);
    const firstApp = ctx.apps.entries()[0];
    const appRes = c.search.search(firstApp?.name ?? 'x');
    check('app search', appRes.results.some((r) => r.kind === 'app'), appRes.results.slice(0, 3).map((r) => r.title));
    const st = c.search.search(ctx.language === 'fr' ? 'wifi' : 'wifi');
    check('windows settings search', st.results.some((r) => r.kind === 'setting'), st.results.slice(0, 3).map((r) => r.title));
    c.launcher.show();
    await wait(600);
    check('launcher shows', c.launcher.isVisible());
    const capDir = argValue('nova-capture');
    if (capDir) {
      fs.mkdirSync(capDir, { recursive: true });
      const lw = c.launcher.window!;
      await lw.webContents.executeJavaScript(`window.__novaTestQuery && window.__novaTestQuery(${JSON.stringify(argValue('nova-capture-query') ?? 'spo')})`);
      await wait(900);
      fs.writeFileSync(path.join(capDir, 'launcher.png'), (await lw.webContents.capturePage()).toPNG());
      if (c.dock.window) fs.writeFileSync(path.join(capDir, 'dock.png'), (await c.dock.window.webContents.capturePage()).toPNG());
    }
    c.launcher.hide();
    await c.files.build();
    check('file index', c.files.ready);
    report.ok = checks.every((x) => x.ok);
  } catch (err) {
    report.error = String(err);
  }
  report.checks = checks;
  const out = argValue('nova-smoke-report') ?? path.join(ctx.dataDir, 'smoke-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  log.flushSync();
  app.exit(report.ok ? 0 : 1);
}
